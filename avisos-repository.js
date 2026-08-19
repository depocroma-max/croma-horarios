// =====================================================
//  AVISOS · Fase 3B.1 — Repository (fuente de datos)
//  Interfaz común entre MockRepository y ApiRepository.
//  Solo `listar()` en esta fase — las mutaciones (crear/editar/
//  archivar/restaurar) se agregan recién en Fase 3B.2.
//
//  Modo: 'api' (default, producción) | 'mock' (QA/desarrollo).
//  Activación EXPLÍCITA y NO persistente — se lee de un query param
//  en cada carga de página (?avisos_modo=mock), nunca de localStorage.
//  Así nadie queda "atrapado" en modo mock sin darse cuenta en una
//  sesión futura: hay que pedirlo a propósito cada vez.
// =====================================================

(function () {
  'use strict';

  function clonarDestinatarios(d) {
    if (d.modo === 'sucursal') return { modo: 'sucursal', ids: (d.ids || []).slice() };
    if (d.modo === 'empleado') return { modo: 'empleado', nombres: (d.nombres || []).slice(), sucursalId: d.sucursalId };
    if (d.modo === 'administracion') return { modo: 'administracion' };
    return { modo: 'todos' };
  }
  function clonarAviso(a) {
    return Object.assign({}, a, {
      destinatarios: clonarDestinatarios(a.destinatarios),
      canales: Object.assign({}, a.canales),
    });
  }

  function mockHoyISO() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  }
  function mockNuevoId() { return 'AVI-' + Date.now() + '-' + Math.floor(Math.random() * 1000); }

  // ── MockRepository — mismo dataset y comportamiento que Fase 1/2 ─────
  // Nota de esta fase (3B.2, ajuste aprobado #3): estas 4 mutaciones son
  // implementaciones NUEVAS y autocontenidas acá, no una migración de
  // crearAviso/actualizarAviso/duplicarAviso/archivarAviso/restaurarAviso
  // que siguen viviendo (sin usarse por ahora) en avisos.js. Es deuda
  // temporal aceptada a propósito — mover esas funciones acá es un
  // refactor aparte, a evaluar recién con la integración ya validada, para
  // no mezclar "conectar la API" con "reorganizar el código existente".
  // No mantienen estado propio (igual que ApiRepository no lo mantiene):
  // el estado en memoria de la sesión sigue viviendo en avisos.js
  // (state.avisos), poblado por listar() y actualizado por cada mutación
  // con el objeto que este repository devuelve — mismo contrato para
  // ambos repositories.
  const MockRepository = {
    listar: function () {
      return Promise.resolve({ ok: true, avisos: (window.CROMA_AVISOS_MOCK || []).map(clonarAviso) });
    },
    crear: function (datos) {
      const ahora = mockHoyISO();
      const aviso = Object.assign({}, datos, {
        id: mockNuevoId(),
        destinatarios: clonarDestinatarios(datos.destinatarios),
        canales: Object.assign({}, datos.canales),
        archivado: false,
        autor: 'Admin',
        fechaCreacion: ahora,
        modificadoPor: 'Admin',
        fechaModificacion: ahora,
        version: 1,
      });
      return Promise.resolve({ ok: true, aviso: aviso });
    },
    // `avisoActual` (3er parámetro, opcional): el payload que arma el
    // formulario (wirePanelForm) solo trae los campos editables — nunca
    // id/version/archivado/autor/fechaCreacion (esos los controla el
    // servidor). La API real los preserva porque GAS mergea contra el
    // registro ya guardado; acá, sin servidor propio, hace falta que
    // quien llama pase el objeto actual para no perderlos. Bug real
    // encontrado en el QA de esta fase: sin este merge, editar un aviso
    // en modo mock dejaba autor/fechaCreacion en undefined y rompía
    // fmtCorta() en el panel de detalle.
    editar: function (id, datos, avisoActual) {
      const aviso = Object.assign({}, avisoActual, datos, {
        id: id,
        destinatarios: clonarDestinatarios(datos.destinatarios),
        canales: Object.assign({}, datos.canales),
        modificadoPor: 'Admin',
        fechaModificacion: mockHoyISO(),
        version: ((avisoActual && avisoActual.version) || 1) + 1,
      });
      return Promise.resolve({ ok: true, aviso: aviso });
    },
    // `avisoActual` (2do parámetro, opcional): Mock no guarda estado
    // propio — a diferencia de la API (donde GAS ya tiene el registro
    // completo guardado), acá hace falta que quien llama pase el objeto
    // que ya tiene en memoria (avisos.js siempre lo tiene vía
    // obtenerAviso(id) antes de llamar al repository) para no perder el
    // resto de sus campos al togglear archivado. ApiRepository ignora
    // este parámetro — misma firma en ambos repositories, se le puede
    // pasar siempre sin romper ninguno de los dos.
    _cambiarArchivado: function (id, archivado, avisoActual) {
      return Promise.resolve({ ok: true, aviso: Object.assign({}, avisoActual, {
        id: id, archivado: archivado, modificadoPor: 'Admin', fechaModificacion: mockHoyISO(),
      }) });
    },
    archivar: function (id, avisoActual) { return MockRepository._cambiarArchivado(id, true, avisoActual); },
    restaurar: function (id, avisoActual) { return MockRepository._cambiarArchivado(id, false, avisoActual); },
  };

  // ── Normalización de campos API (snake_case) ⇄ frontend (camelCase) ──
  // Hallazgo de auditoría (Prioridad 0, previo a las mutaciones de 3B.2):
  // listar() devolvía los avisos de la API tal cual (snake_case), pero
  // TODO el resto de avisos.js lee fechaDesde/fechaHasta/fechaCreacion/
  // destinatarios.sucursalId en camelCase (estadoDe, avisosFiltrados,
  // render de Hoy/Calendario/Lista, el panel de detalle — 42 usos en
  // total). Sin esta normalización, cualquier aviso real devuelto por la
  // API se hubiera mostrado con fechas "undefined" y clasificado siempre
  // como "vencido" en estadoDe(). No se detectó antes porque la hoja
  // AVISOS estaba vacía durante todo el QA de 3B.1 — el bug nunca se
  // ejerció visualmente. Corregido acá, antes de tocar ninguna mutación.
  function desdeApiDestinatarios(d) {
    if (!d) return { modo: 'todos' };
    if (d.modo === 'sucursal') return { modo: 'sucursal', ids: (d.ids || []).slice() };
    if (d.modo === 'empleado') return { modo: 'empleado', nombres: (d.nombres || []).slice(), sucursalId: d.sucursal_id || '' };
    if (d.modo === 'administracion') return { modo: 'administracion' };
    return { modo: 'todos' };
  }
  // fmtCorta()/fmtRango() en avisos.js esperan fecha simple "yyyy-mm-dd"
  // (así vienen fechaDesde/fechaHasta). fecha_creacion/fecha_modificacion
  // de la API viajan como datetime ISO completo ("...T12:30:57.141Z") —
  // se recorta acá a los primeros 10 caracteres, el único formato que
  // avisos.js sabe mostrar hoy (fmtCorta(a.fechaCreacion) en el panel de
  // detalle). Encontrado en el mismo QA de esta auditoría, junto con el
  // mapeo de campos.
  function soloFecha(iso) { return iso ? String(iso).slice(0, 10) : ''; }

  function desdeApi(a) {
    return {
      id: a.id,
      titulo: a.titulo,
      mensaje: a.mensaje,
      tipo: a.tipo,
      fechaDesde: a.fecha_desde || '',
      fechaHasta: a.fecha_hasta || a.fecha_desde || '',
      destinatarios: desdeApiDestinatarios(a.destinatarios),
      canales: Object.assign({}, a.canales),
      prioridad: a.prioridad || 'normal',
      archivado: a.archivado === true,
      autor: a.autor || '',
      fechaCreacion: soloFecha(a.fecha_creacion),
      modificadoPor: a.modificado_por || '',
      fechaModificacion: soloFecha(a.fecha_modificacion),
      version: a.version || 1,
    };
  }

  // ── Frontend (camelCase) → API (snake_case), para crear/editar ───────
  // Contraparte de desdeApi(). Solo se usa al enviar — nunca se manda
  // id/version/archivado/autor/fechaCreacion/modificadoPor/fechaModificacion:
  // esos campos los controla el servidor.
  function paraApiDestinatarios(d) {
    if (d.modo === 'sucursal') return { modo: 'sucursal', ids: (d.ids || []).slice() };
    if (d.modo === 'empleado') return { modo: 'empleado', nombres: (d.nombres || []).slice(), sucursal_id: d.sucursalId || '' };
    if (d.modo === 'administracion') return { modo: 'administracion' };
    return { modo: 'todos' };
  }
  function paraApi(b) {
    return {
      tipo: b.tipo,
      titulo: b.titulo,
      mensaje: b.mensaje,
      fecha_desde: b.fechaDesde || '',
      fecha_hasta: b.fechaHasta || b.fechaDesde || '',
      destinatarios: paraApiDestinatarios(b.destinatarios),
      canales: Object.assign({}, b.canales),
      prioridad: b.prioridad || 'normal',
    };
  }

  // ── ApiRepository — croma-backend → Apps Script → Sheets ─────────────
  const MENSAJES_POR_STATUS = {
    400: 'Los datos enviados no son válidos.',
    401: 'Tu sesión venció. Volvé a iniciar sesión.',
    403: 'No tenés permiso para esta acción.',
    404: 'No se encontró el aviso solicitado.',
  };
  function mensajePorStatus(status) {
    return MENSAJES_POR_STATUS[status] || 'No pudimos completar la operación. Probá de nuevo.';
  }

  // Fetch crudo (no _apiFetch de app.js) porque necesitamos el status HTTP
  // real para el mapeo de mensajes — mismo motivo documentado en app.js
  // para _fetchRecibosPortalRaw().
  async function fetchAvisosApi(path, opciones) {
    opciones = opciones || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opciones.headers || {});
    const token = window.CromaSesion ? window.CromaSesion.obtenerToken() : null;
    if (token) headers['Authorization'] = 'Bearer ' + token;
    let resp;
    try {
      const base = window.CromaSesion ? window.CromaSesion.BACKEND_URL : '';
      resp = await fetch(base + '/api/avisos' + path,
        Object.assign({}, opciones, { headers: headers }));
    } catch (e) {
      return { ok: false, status: 0, error: 'No pudimos conectarnos. Probá de nuevo.' };
    }
    let data = null;
    try { data = await resp.json(); } catch (e) {}
    if (!resp.ok) {
      return { ok: false, status: resp.status, error: (data && data.error) || mensajePorStatus(resp.status), errores: data && data.errores };
    }
    if (!data || data.ok !== true) {
      return { ok: false, status: resp.status, error: (data && data.error) || 'Respuesta inválida del servidor.', errores: data && data.errores };
    }
    return data;
  }

  // Envoltorio común: normaliza data.aviso con desdeApi() en éxito, deja
  // pasar el error tal cual en fallo (incluye el caso "200 pero ok:false"
  // que GAS usa para 'Aviso no encontrado' — fetchAvisosApi ya lo detecta
  // porque chequea data.ok, no solo resp.ok).
  function normalizarRespuestaAviso(data) {
    if (!data.ok) return data;
    return { ok: true, aviso: desdeApi(data.aviso) };
  }

  const ApiRepository = {
    listar: async function () {
      const data = await fetchAvisosApi('', { method: 'GET' });
      if (!data.ok) return data;
      return { ok: true, avisos: (data.avisos || []).map(desdeApi) };
    },
    crear: async function (datosCamelCase) {
      const data = await fetchAvisosApi('', { method: 'POST', body: JSON.stringify(paraApi(datosCamelCase)) });
      return normalizarRespuestaAviso(data);
    },
    // avisoActual (3er parámetro): no hace falta acá — GAS ya mergea
    // contra el registro guardado. Se acepta igual para la misma firma
    // que MockRepository (donde sí es necesario, ver comentario ahí).
    editar: async function (id, datosCamelCase, avisoActual) {
      const data = await fetchAvisosApi('/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(paraApi(datosCamelCase)) });
      return normalizarRespuestaAviso(data);
    },
    // avisoActual (2do parámetro): no hace falta acá — GAS ya tiene el
    // registro completo guardado — se acepta igual para mantener la misma
    // firma que MockRepository (donde sí es necesario). Ver comentario en
    // MockRepository._cambiarArchivado.
    archivar: async function (id, avisoActual) {
      const data = await fetchAvisosApi('/' + encodeURIComponent(id) + '/archivar', { method: 'POST' });
      return normalizarRespuestaAviso(data);
    },
    restaurar: async function (id, avisoActual) {
      const data = await fetchAvisosApi('/' + encodeURIComponent(id) + '/restaurar', { method: 'POST' });
      return normalizarRespuestaAviso(data);
    },
  };

  // ── Selección de modo — explícita, no persistente ─────────────────────
  function resolverModo() {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('avisos_modo') === 'mock') return 'mock';
    } catch (e) {}
    return 'api';
  }

  const modo = resolverModo();

  window.CromaAvisosConfig = { modo: modo };
  window.CromaAvisosRepository = modo === 'mock' ? MockRepository : ApiRepository;
})();
