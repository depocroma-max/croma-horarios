// =====================================================
//  AVISOS · Fase 2 — interacción, panel lateral y
//  creación/edición/duplicación/archivado con datos mock.
//  Sin backend, sin Apps Script. Encapsulado en CromaAvisos.
// =====================================================

(function () {
  'use strict';

  const SUCURSALES = [
    { id: 'todas',    label: 'Todas' },
    { id: '01',       label: 'Paseo',          var: '--suc-01' },
    { id: '05',       label: 'Wave',           var: '--suc-05' },
    { id: '09',       label: 'Cipo',           var: '--suc-09' },
    { id: '10',       label: 'Perito Moreno',  var: '--suc-10' },
    { id: '12',       label: 'Centenario',     var: '--suc-12' },
    { id: '14',       label: 'Roca',           var: '--suc-14' },
    { id: 'DEPO',     label: 'Depo',           var: '--suc-depo' },
    { id: 'OFICINA',  label: 'Oficina',        var: '--suc-oficina' },
  ];
  const SUCURSALES_SELECCIONABLES = SUCURSALES.filter(function (s) { return s.id !== 'todas'; });

  const TIPO_META = {
    informacion:   { label: 'Información',   icono: 'ⓘ' },
    evento:        { label: 'Evento',        icono: '●' },
    local_cerrado: { label: 'Local cerrado', icono: '▓' },
  };

  // Defaults por tipo — documentados y aprobados en el plan técnico.
  // Evento: Novedades queda OFF por default (el calendario ya lo
  // comunica visualmente; el banner es un refuerzo opcional, no
  // obligatorio, a diferencia de Información y Local cerrado).
  const DEFAULTS_POR_TIPO = {
    informacion: {
      canales: { calendario: false, banner: true, email: false, whatsapp: false },
      prioridad: 'normal',
      destinatarios: { modo: 'todos' },
    },
    evento: {
      canales: { calendario: true, banner: false, email: false, whatsapp: false },
      prioridad: 'normal',
      destinatarios: { modo: 'todos' },
    },
    local_cerrado: {
      canales: { calendario: true, banner: true, email: true, whatsapp: false },
      prioridad: 'normal',
      destinatarios: { modo: 'sucursal', ids: [] },
    },
  };

  const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
    'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const MAX_INDICADORES_POR_CELDA = 3;

  const state = {
    sucursal: 'todas',
    vista: 'hoy',
    busqueda: '',
    calAnio: null,
    calMes: null, // 0-11
    archivadosAbiertos: false,

    // Copia de trabajo en memoria — poblada por el repository (Fase 3B.1:
    // API o Mock según CromaAvisosConfig.modo), nunca leída/escrita directo
    // desde window.CROMA_AVISOS_MOCK.
    avisos: [],

    // Estado de la carga inicial (Fase 3B.1) — una sola carga por sesión,
    // reutilizada por Hoy/Calendario/Lista. 'idle'|'cargando'|'listo'|'error'.
    carga: {
      estado: 'idle',
      error: null,      // { status, mensaje } | null
      generacion: 0,    // anti-carrera: descarta respuestas obsoletas
      ultimaCarga: null, // Date | null — para CromaAvisos.debug()
    },

    // Panel lateral único (detalle / form / cerrar-local / resumen-dia /
    // detalle-vacacion)
    panel: {
      abierto: false,
      modo: null,
      avisoId: null,
      vacacionId: null,   // Fase 5 — nunca comparte lógica con avisoId/obtenerAviso()
      fechaPrecargada: null,
      borrador: null,
      original: null,       // JSON.stringify del borrador al abrir, para dirty-check
      dirty: false,
      intentoPublicar: false,
      masOpcionesAbiertas: false,
      elementoOrigen: null,
      guardando: false,      // true mientras se espera confirmación real del servidor (Fase 3B.2)
      errorGuardado: null,   // { mensaje, errores? } | null
    },

    // ids de fila (Lista) con una mutación en curso — deshabilita solo esa
    // fila, no toda la lista (Fase 3B.2).
    filasEnCurso: new Set(),

    // Vacaciones aprobadas (Fase 3, calendario nuevo) — colección
    // independiente de `avisos`, nunca mezclada en memoria. GAS ya
    // resuelve sucursalId contra EMPLEADOS — acá solo se consume tal
    // cual, nunca se recalcula. Se combina con `avisos` únicamente al
    // momento de renderizar (Fase 4), no acá.
    vacaciones: [],
    cargaVacaciones: {
      estado: 'idle',   // 'idle'|'cargando'|'listo'|'error' — mismo vocabulario que state.carga
      error: null,
      generacion: 0,    // anti-carrera, mismo patrón que state.carga.generacion
    },
  };

  let inicializado = false;

  // ── Helpers de fecha ──────────────────────────────────
  function hoyDate() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function hoyISO() { return isoDeDate(hoyDate()); }
  function isoDeDate(d) { return d.toISOString().slice(0, 10); }
  function fmtCorta(iso) {
    const [y, m, d] = iso.split('-');
    return d + '/' + m;
  }
  function fmtRango(desde, hasta) {
    return desde === hasta ? fmtCorta(desde) : fmtCorta(desde) + ' → ' + fmtCorta(hasta);
  }
  function diffDias(isoA, isoB) {
    const a = new Date(isoA + 'T00:00:00');
    const b = new Date(isoB + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  }
  function fechaLargaHoy() {
    const d = new Date();
    const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    return dias[d.getDay()] + ', ' + d.getDate() + ' de ' + MESES[d.getMonth()].toLowerCase();
  }
  function fechaLarga(iso) {
    const d = new Date(iso + 'T00:00:00');
    const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    return dias[d.getDay()] + ', ' + d.getDate() + ' de ' + MESES[d.getMonth()].toLowerCase();
  }

  function escapeAttr(s) { return String(s || '').replace(/"/g, '&quot;'); }
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;';
    });
  }

  function sucursalPorId(id) { return SUCURSALES.find(function (s) { return s.id === id; }); }
  function empleadosMock() { return window.CROMA_EMPLEADOS_MOCK || []; }


  // ── Carga inicial (una sola vez por sesión, ver activar()) ─────────────
  function cargarAvisosIniciales() {
    if (state.carga.estado === 'cargando') return;
    if (!window.CromaAvisosRepository) return; // avisos-repository.js no cargó — no debería pasar
    state.carga.estado = 'cargando';
    state.carga.error = null;
    const generacion = ++state.carga.generacion;
    render();

    window.CromaAvisosRepository.listar().then(function (resultado) {
      if (generacion !== state.carga.generacion) return; // respuesta obsoleta, se descarta
      state.carga.ultimaCarga = new Date();
      if (resultado.ok) {
        state.avisos = resultado.avisos;
        state.carga.estado = 'listo';
      } else {
        state.carga.estado = 'error';
        state.carga.error = { status: resultado.status, mensaje: resultado.error };
      }
      render();
    });
  }

  // ── Vacaciones — carga de la capa visual (Fase 3, calendario nuevo) ────
  // Colección deliberadamente aparte de CromaAvisosRepository/state.avisos:
  // una vacación no es un aviso, y forzarla por ese repository implicaría
  // fingir que lo es. Función de lectura chica y propia, mismo patrón de
  // fetch (BACKEND_URL + _getToken + Authorization Bearer) que ya usa
  // fetchAvisosApi en avisos-repository.js, sin duplicar su normalización
  // snake_case↔camelCase (no hace falta acá: el endpoint ya devuelve el
  // shape final tal cual lo necesita el calendario).
  async function fetchVacacionesAprobadas() {
    const token = window.CromaSesion ? window.CromaSesion.obtenerToken() : null;
    let resp;
    try {
      const base = window.CromaSesion ? window.CromaSesion.BACKEND_URL : '';
      resp = await fetch(base + '/api/avisos/vacaciones-aprobadas', {
        headers: token ? { Authorization: 'Bearer ' + token } : {},
      });
    } catch (e) {
      return { ok: false, error: 'No pudimos conectarnos. Probá de nuevo.' };
    }
    let data = null;
    try { data = await resp.json(); } catch (e) {}
    if (!resp.ok || !data || data.ok !== true || !Array.isArray(data.solicitudes)) {
      return { ok: false, error: (data && data.error) || 'Respuesta inválida del servidor.' };
    }
    return data;
  }

  // Carga única por sesión (ver activar()), en paralelo con
  // cargarAvisosIniciales — no hay dependencia entre ambas cargas. Mismo
  // patrón de anti-carrera (`generacion`) que cargarAvisosIniciales.
  // sucursalId vacío (GAS no pudo resolver el empleado contra EMPLEADOS,
  // ver Code-Jornada.js) se descarta acá — nunca se muestra, ni siquiera
  // en "Todas" (decisión de producto ya cerrada: preferir omitir un
  // registro antes que mostrar una sucursal potencialmente incorrecta).
  // Error de red/servidor: se conserva la última carga válida de
  // state.vacaciones (si existía) — nunca se vacía en silencio, y nunca
  // rompe la carga de AVISOS (colecciones independientes, error de una no
  // afecta a la otra). Sin fallback a APPS_SCRIPT_URL, sin alert().
  function cargarVacacionesIniciales() {
    if (state.cargaVacaciones.estado === 'cargando') return;
    state.cargaVacaciones.estado = 'cargando';
    state.cargaVacaciones.error = null;
    const generacion = ++state.cargaVacaciones.generacion;

    fetchVacacionesAprobadas().then(function (resultado) {
      if (generacion !== state.cargaVacaciones.generacion) return; // respuesta obsoleta, se descarta

      if (!resultado.ok) {
        state.cargaVacaciones.estado = 'error';
        state.cargaVacaciones.error = resultado.error;
        // No hay pantalla global de error por Vacaciones (a diferencia de
        // AVISOS) — el calendario ya renderizado sigue mostrando AVISOS
        // igual; re-renderizar acá solo asegura que ningún indicador de
        // vacación quede a medio pintar si esto llegó después del primer
        // render.
        render();
        return;
      }

      const descartadasPorSucursal = [];
      state.vacaciones = resultado.solicitudes.filter(function (v) {
        if (!v || !v.sucursalId) { descartadasPorSucursal.push(v && v.id); return false; }
        return true;
      });
      state.cargaVacaciones.estado = 'listo';

      // Señal diagnóstica simple (consola) — mismo criterio que ya usa
      // GAS con Logger.log para el mismo caso: no es un error fatal, solo
      // evidencia para QA. No se agrega ningún sistema de logging nuevo.
      if (descartadasPorSucursal.length) {
        console.warn('cargarVacacionesIniciales: vacaciones excluidas por sucursalId vacío (no se muestran en ningún filtro):', descartadasPorSucursal);
      }

      // Re-render — si Vacaciones resuelve después de que AVISOS ya se
      // pintó (carga en paralelo, sin orden garantizado), el calendario
      // necesita este segundo pintado para incorporarlas.
      render();
    });
  }

  // ── Estado mock mutable ────────────────────────────────
  function clonarDestinatarios(d) {
    if (d.modo === 'sucursal') return { modo: 'sucursal', ids: d.ids.slice() };
    if (d.modo === 'empleado') return { modo: 'empleado', nombres: d.nombres.slice(), sucursalId: d.sucursalId };
    if (d.modo === 'administracion') return { modo: 'administracion' };
    return { modo: 'todos' };
  }
  function clonarAviso(a) {
    return Object.assign({}, a, {
      destinatarios: clonarDestinatarios(a.destinatarios),
      canales: Object.assign({}, a.canales),
    });
  }
  function nuevoId() { return 'AVI-' + Date.now() + '-' + Math.floor(Math.random() * 1000); }
  function obtenerAviso(id) { return state.avisos.find(function (a) { return a.id === id; }); }

  // ── Sincronización tras una mutación confirmada por el servidor
  //    (Fase 3B.2) — nunca se vuelve a pedir GET /api/avisos completo:
  //    se usa directo el objeto que devolvió la propia mutación. ────────
  function aplicarAvisoEnMemoria(aviso) {
    const idx = state.avisos.findIndex(function (a) { return a.id === aviso.id; });
    if (idx === -1) state.avisos.push(aviso);
    else state.avisos[idx] = aviso;
    render();
  }

  // ── Mutaciones compartidas (panel de detalle Y fila de Lista) ─────────
  // Duplicar: excluye explícitamente id/version/archivado/autor/
  // fechaCreacion/modificadoPor/fechaModificacion — esos los pone el
  // servidor al crear. Fechas se copian tal cual, incluso si están
  // vencidas (sin UX nueva de "correr fechas"). Sufijo " (copia)" en el
  // título, igual que en Fase 2.
  function ejecutarDuplicar(id) {
    const original = obtenerAviso(id);
    if (!original) return Promise.resolve({ ok: false, error: 'Este aviso ya no existe.' });
    const datos = {
      tipo: original.tipo,
      titulo: original.titulo + ' (copia)',
      mensaje: original.mensaje,
      fechaDesde: original.fechaDesde,
      fechaHasta: original.fechaHasta,
      destinatarios: clonarDestinatarios(original.destinatarios),
      canales: Object.assign({}, original.canales),
      prioridad: original.prioridad,
    };
    return window.CromaAvisosRepository.crear(datos).then(function (resultado) {
      if (resultado.ok) aplicarAvisoEnMemoria(resultado.aviso);
      return resultado;
    });
  }
  function ejecutarArchivar(id) {
    const actual = obtenerAviso(id);
    return window.CromaAvisosRepository.archivar(id, actual).then(function (resultado) {
      if (resultado.ok) aplicarAvisoEnMemoria(resultado.aviso);
      return resultado;
    });
  }
  function ejecutarRestaurar(id) {
    const actual = obtenerAviso(id);
    return window.CromaAvisosRepository.restaurar(id, actual).then(function (resultado) {
      if (resultado.ok) aplicarAvisoEnMemoria(resultado.aviso);
      return resultado;
    });
  }

  function crearAviso(datos) {
    const nuevo = Object.assign({}, datos, {
      id: nuevoId(),
      archivado: false,
      autor: 'Admin',
      fechaCreacion: hoyISO(),
    });
    state.avisos.push(nuevo);
    render();
    return nuevo;
  }
  function actualizarAviso(id, datos) {
    const idx = state.avisos.findIndex(function (a) { return a.id === id; });
    if (idx === -1) return;
    state.avisos[idx] = Object.assign({}, state.avisos[idx], datos);
    render();
  }
  function duplicarAviso(id) {
    const original = obtenerAviso(id);
    if (!original) return;
    const copia = clonarAviso(original);
    copia.id = nuevoId();
    copia.titulo = original.titulo + ' (copia)';
    copia.archivado = false;
    copia.autor = 'Admin';
    copia.fechaCreacion = hoyISO();
    state.avisos.push(copia);
    render();
    return copia;
  }
  function archivarAviso(id) {
    const a = obtenerAviso(id);
    if (!a) return;
    a.archivado = true;
    render();
    mostrarToastDeshacer('Aviso archivado.', function () {
      a.archivado = false;
      render();
    });
  }
  function restaurarAviso(id) {
    const a = obtenerAviso(id);
    if (!a) return;
    a.archivado = false;
    render();
    showToast('Aviso restaurado.');
  }

  function estadoDe(aviso) {
    if (aviso.archivado) return 'archivado';
    const hoy = hoyISO();
    if (aviso.fechaDesde > hoy) return 'programado';
    if (aviso.fechaHasta >= hoy) return 'activo';
    return 'vencido';
  }

  // Regla de visibilidad por tab de sucursal (modelo funcional aprobado):
  // - "todos" siempre visible en cualquier tab, incluida "Todas"
  // - "sucursal" visible en "Todas" y en cada sucursal incluida
  // - "administracion" es visible SIEMPRE, independientemente de la tab
  //   (es una excepción explícita: no depende de ubicación, sino de rol)
  // - "empleado" se ubica en la tab de la sucursal de ese empleado
  function visibleEnTab(aviso, sucId) {
    const d = aviso.destinatarios;
    if (d.modo === 'administracion') return true;
    if (sucId === 'todas') return true;
    if (d.modo === 'todos') return true;
    if (d.modo === 'sucursal') return d.ids.indexOf(sucId) !== -1;
    if (d.modo === 'empleado') return d.sucursalId === sucId;
    return false;
  }

  function labelDestinatarios(d) {
    if (d.modo === 'todos') return 'Todos';
    if (d.modo === 'administracion') return 'Administración';
    if (d.modo === 'empleado') return (d.nombres && d.nombres.length) ? d.nombres.join(', ') : 'Sin empleados';
    if (d.modo === 'sucursal') {
      if (!d.ids || !d.ids.length) return 'Sin sucursal';
      return d.ids.map(function (id) {
        const s = sucursalPorId(id);
        return s ? s.label : id;
      }).join(' + ');
    }
    return '';
  }

  function coincideBusqueda(aviso, q) {
    if (!q) return true;
    q = q.toLowerCase();
    return aviso.titulo.toLowerCase().indexOf(q) !== -1 ||
           aviso.mensaje.toLowerCase().indexOf(q) !== -1;
  }

  function avisosFiltrados() {
    return state.avisos
      .filter(function (a) { return visibleEnTab(a, state.sucursal); })
      .filter(function (a) { return coincideBusqueda(a, state.busqueda); });
  }

  function avisosDelDia(iso) {
    return avisosFiltrados()
      .filter(function (a) { return a.fechaDesde <= iso && a.fechaHasta >= iso && !a.archivado; })
      .sort(function (a, b) {
        const pa = a.prioridad === 'urgente' ? 0 : 1;
        const pb = b.prioridad === 'urgente' ? 0 : 1;
        return pa - pb;
      });
  }

  // Vacaciones aprobadas del día (Fase 4, calendario nuevo) — lee
  // ÚNICAMENTE state.vacaciones, nunca EMPLEADOS_PERFILES ni recalcula
  // sucursal: GAS ya la resolvió (ver Code-Jornada.js) y Fase 3 ya
  // descartó al cargar cualquier registro con sucursalId vacío, así que
  // acá no hace falta re-chequear esa invariante. Mismo criterio de rango
  // que avisosDelDia. Filtro de sucursal: 'todas' muestra todo lo que ya
  // quedó en state.vacaciones (con sucursal resuelta); una tab específica
  // exige coincidencia exacta — nunca "sin sucursal = ver todo".
  function vacacionesDelDia(iso) {
    return state.vacaciones.filter(function (v) {
      if (state.sucursal !== 'todas' && v.sucursalId !== state.sucursal) return false;
      return v.fechaDesde <= iso && v.fechaHasta >= iso;
    });
  }

  function colorSucursalDeAviso(aviso) {
    if (aviso.destinatarios.modo === 'sucursal' && aviso.destinatarios.ids.length === 1) {
      const s = sucursalPorId(aviso.destinatarios.ids[0]);
      if (s && s.var) return s.var;
    }
    if (aviso.destinatarios.modo === 'empleado') {
      const s = sucursalPorId(aviso.destinatarios.sucursalId);
      if (s && s.var) return s.var;
    }
    return null;
  }

  // ── Toasts ──────────────────────────────────────────────
  // Fase 3B.2: "Deshacer" ya no es una reversión en memoria — dispara la
  // mutación inversa real (restaurar_aviso vía el repository) y espera su
  // confirmación antes de dar el archivado por deshecho. Si esa mutación
  // inversa falla, el estado remoto (archivado) es la verdad: no se
  // revierte nada localmente sin confirmación, se avisa con mensajeError.
  function mostrarToastDeshacer(mensaje, onDeshacerAsync, mensajeError) {
    const existing = document.getElementById('avzToast');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.id = 'avzToast';
    el.className = 'avz-toast';
    el.innerHTML = '<span>' + escapeHtml(mensaje) + '</span>' +
      '<button class="avz-toast-deshacer" id="avzToastDeshacer" type="button">Deshacer</button>';
    document.body.appendChild(el);
    const t = setTimeout(function () { el.remove(); }, 5000);
    el.querySelector('#avzToastDeshacer').addEventListener('click', function () {
      clearTimeout(t);
      const btn = el.querySelector('#avzToastDeshacer');
      btn.disabled = true;
      btn.textContent = 'Deshaciendo…';
      onDeshacerAsync().then(function (resultado) {
        el.remove();
        if (resultado && resultado.ok === false) {
          showToast(mensajeError || 'No se pudo deshacer.');
        }
      });
    });
  }

  // ── Render: shell general ─────────────────────────────
  function render() {
    const cont = document.getElementById('avisosContainer');
    if (!cont) return;

    const sucOpts = SUCURSALES.map(function (s) {
      const activo = s.id === state.sucursal ? ' active' : '';
      const dotStyle = s.var ? ' style="--suc-dot:var(' + s.var + ')"' : '';
      return '<button class="avz-suc-tab' + activo + '" data-suc="' + s.id + '" aria-selected="' + (s.id === state.sucursal) + '"' + dotStyle + '>' +
        (s.var ? '<span class="avz-suc-dot"></span>' : '') + s.label + '</button>';
    }).join('');

    cont.innerHTML =
      '<div class="avz-shell">' +
        '<div class="avz-header">' +
          '<h1 class="avz-titulo">AVISOS</h1>' +
          '<div class="avz-header-acciones">' +
            '<div class="avz-view-toggle">' +
              btnVista('hoy', 'Hoy') + btnVista('calendario', 'Calendario') + btnVista('lista', 'Lista') +
              // Solicitudes pendientes (mudado desde el viejo menú Calendario
              // → tab "Solicitudes pendientes") — reusa cargarSolicitudesAdmin()
              // de app.js tal cual, solo cambia dónde vive el contenedor.
              '<button class="avz-view-btn' + (state.vista === 'solicitudes' ? ' active' : '') + '" id="avzTabSolicitudes" data-vista="solicitudes" aria-selected="' + (state.vista === 'solicitudes') + '">Solicitudes</button>' +
            '</div>' +
            '<div class="avz-search">' + icon('search', 'icon-16') +
              '<label class="avz-visually-hidden" for="avzBuscar">Buscar avisos</label>' +
              '<input type="search" id="avzBuscar" placeholder="Buscar avisos..." value="' + escapeAttr(state.busqueda) + '" />' +
            '</div>' +
            '<button class="btn btn-primary" id="avzBtnNuevo" type="button">' +
              icon('plus', 'icon-16') + ' Nuevo aviso' +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div class="avz-suc-tabs" id="avzSucTabs" role="tablist" aria-label="Sucursal">' + sucOpts + '</div>' +
        '<div class="avz-quick-actions">' +
          '<button class="btn btn-outline" id="avzBtnCerrarLocal" type="button">🔒 Cerrar local</button>' +
          '<button class="btn btn-outline avz-btn-beta" disabled title="Disponible en una próxima fase">⧉ Duplicar último</button>' +
        '</div>' +
        '<div class="avz-body" id="avzBody"></div>' +
      '</div>';

    document.getElementById('avzSucTabs').addEventListener('click', function (e) {
      const btn = e.target.closest('.avz-suc-tab');
      if (!btn) return;
      state.sucursal = btn.dataset.suc;
      render();
    });
    cont.querySelectorAll('.avz-view-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        state.vista = b.dataset.vista;
        render();
      });
    });
    document.getElementById('avzBuscar').addEventListener('input', function (e) {
      state.busqueda = e.target.value;
      renderBody();
    });
    document.getElementById('avzBtnNuevo').addEventListener('click', function () {
      abrirPanel('form', {});
    });
    document.getElementById('avzBtnCerrarLocal').addEventListener('click', function () {
      abrirPanel('cerrar-local', {});
    });

    renderBody();
  }

  function btnVista(id, label) {
    const activo = state.vista === id ? ' active' : '';
    return '<button class="avz-view-btn' + activo + '" data-vista="' + id + '" aria-selected="' + (state.vista === id) + '">' + label + '</button>';
  }

  function renderBody() {
    const body = document.getElementById('avzBody');
    if (!body) return;

    if (state.carga.estado === 'idle' || state.carga.estado === 'cargando') {
      body.innerHTML = renderCargando();
      return;
    }
    if (state.carga.estado === 'error') {
      body.innerHTML = renderErrorCarga();
      wireErrorCarga(body);
      return;
    }

    if (state.vista === 'hoy') body.innerHTML = renderHoy();
    else if (state.vista === 'calendario') { body.innerHTML = renderCalendarioShell(); wireCalendario(); }
    else if (state.vista === 'solicitudes') {
      body.innerHTML = '<div id="avzSolicitudesContainer"><div style="padding:1.5rem"><p style="color:#94a3b8;font-size:13px">Cargando...</p></div></div>';
      // cargarSolicitudesAdmin() vive en app.js (global, no en este IIFE) —
      // reusada tal cual, solo se le cambió el id de contenedor de destino.
      if (typeof cargarSolicitudesAdmin === 'function') cargarSolicitudesAdmin();
      return;
    }
    else body.innerHTML = renderLista();
    wireAccionesFila(body);
    wireClicksAbrirDetalle(body);
  }

  function renderCargando() {
    return '<div class="ajuste-empty-state">' +
      '<div class="spinner" role="status" aria-label="Cargando"></div>' +
      '<p class="text-secondary">Cargando avisos…</p>' +
    '</div>';
  }

  function renderErrorCarga() {
    const err = state.carga.error || {};
    return '<div class="avz-vacio">' +
      '<div class="avz-vacio-titulo">No pudimos cargar los avisos.</div>' +
      '<div class="avz-vacio-sub">' + escapeHtml(err.mensaje || 'Probá de nuevo en unos segundos.') + '</div>' +
      '<button class="btn btn-outline" id="avzReintentarCarga" type="button" style="margin-top:12px">Reintentar</button>' +
    '</div>';
  }

  function wireErrorCarga(body) {
    const btn = body.querySelector('#avzReintentarCarga');
    if (btn) btn.addEventListener('click', cargarAvisosIniciales);
  }

  // Delegación única: cualquier elemento con data-abrir-aviso abre el
  // detalle de ese aviso (usado en Hoy, Lista y Calendario).
  function wireClicksAbrirDetalle(root) {
    root.querySelectorAll('[data-abrir-aviso]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        if (e.target.closest('[data-fila-accion]')) return; // los botones de acción manejan su propio click
        abrirPanel('detalle', { avisoId: el.dataset.abrirAviso, elementoOrigen: el });
      });
    });
  }

  // ── Vista Hoy ──────────────────────────────────────────
  function renderHoy() {
    const avisos = avisosFiltrados();
    const hoy = hoyISO();
    const activos = avisos.filter(function (a) { return estadoDe(a) === 'activo'; });
    const cierresHoy = activos.filter(function (a) {
      return a.tipo === 'local_cerrado' && a.fechaDesde <= hoy && a.fechaHasta >= hoy;
    });
    const urgentes = activos.filter(function (a) { return a.prioridad === 'urgente'; });
    const en7dias = avisos.filter(function (a) {
      const st = estadoDe(a);
      if (st !== 'programado' && st !== 'activo') return false;
      const dias = diffDias(hoy, a.fechaDesde);
      return dias >= 0 && dias <= 7 && a.prioridad !== 'urgente' &&
        !(a.tipo === 'local_cerrado' && cierresHoy.indexOf(a) !== -1);
    }).sort(function (a, b) { return a.fechaDesde < b.fechaDesde ? -1 : 1; });

    if (!cierresHoy.length && !urgentes.length && !en7dias.length) {
      return '<div class="avz-vacio">' +
        '<div class="avz-vacio-titulo">Nada activo por ahora.</div>' +
        '<div class="avz-vacio-sub">Todo tranquilo en ' + (state.sucursal === 'todas' ? 'todas las sucursales' : 'esta sucursal') + '.</div>' +
      '</div>';
    }

    let html = '<div class="avz-hoy-fecha">' + fechaLargaHoy() + '</div>';

    cierresHoy.forEach(function (a) {
      const cv = colorSucursalDeAviso(a);
      const bg = cv ? ' style="background:var(' + cv + '-light,var(--gray-50))"' : '';
      html += '<div class="avz-card avz-card-cierre" data-abrir-aviso="' + a.id + '" tabindex="0" role="button"' + bg + '>' +
        '<span class="avz-card-icono">▓</span>' +
        '<div class="avz-card-texto">' +
          '<div class="avz-card-titulo">' + escapeHtml(a.titulo) + '</div>' +
          '<div class="avz-card-sub">' + escapeHtml(labelDestinatarios(a.destinatarios)) + '</div>' +
        '</div>' +
        '<div class="avz-card-fecha">' + fmtRango(a.fechaDesde, a.fechaHasta) + '</div>' +
      '</div>';
    });

    urgentes.forEach(function (a) {
      html += '<div class="avz-card avz-card-urgente" data-abrir-aviso="' + a.id + '" tabindex="0" role="button">' +
        '<span class="avz-card-icono">🔴</span>' +
        '<div class="avz-card-texto">' +
          '<div class="avz-card-titulo">Urgente · ' + escapeHtml(a.titulo) + '</div>' +
          '<div class="avz-card-sub">' + escapeHtml(labelDestinatarios(a.destinatarios)) + '</div>' +
        '</div>' +
      '</div>';
    });

    if (en7dias.length) {
      html += '<div class="avz-proximos-label">Próximos 7 días</div>';
      en7dias.forEach(function (a) {
        html += '<div class="avz-proximo-fila" data-abrir-aviso="' + a.id + '" tabindex="0" role="button">' +
          '<span class="avz-card-icono">' + TIPO_META[a.tipo].icono + '</span>' +
          '<span class="avz-proximo-fecha">' + fmtCorta(a.fechaDesde) + '</span>' +
          '<span class="avz-proximo-titulo">' + escapeHtml(a.titulo) + '</span>' +
          '<span class="avz-proximo-dest">' + escapeHtml(labelDestinatarios(a.destinatarios)) + '</span>' +
        '</div>';
      });
    }

    return html;
  }

  // ── Vista Lista ────────────────────────────────────────
  function renderLista() {
    const avisos = avisosFiltrados();
    if (!avisos.length) {
      return '<div class="avz-lista-toolbar">' + selectsListaInertes() + '</div>' +
        '<div class="avz-vacio">' +
          '<div class="avz-vacio-titulo">' + (state.busqueda ? 'No encontramos avisos que coincidan con "' + escapeHtml(state.busqueda) + '"' : 'Todavía no hay avisos') + '</div>' +
          '<div class="avz-vacio-sub">' + (state.busqueda ? 'Probá con otra búsqueda.' : 'Los avisos que se publiquen van a aparecer acá.') + '</div>' +
        '</div>';
    }

    const grupos = { activo: [], programado: [], vencido: [] };
    const archivados = [];
    avisos.forEach(function (a) {
      const st = estadoDe(a);
      if (st === 'archivado') archivados.push(a);
      else grupos[st].push(a);
    });

    let html = '<div class="avz-lista-toolbar">' + selectsListaInertes() + '</div>';
    html += renderGrupo('Activos', grupos.activo);
    html += renderGrupo('Programados', grupos.programado);
    html += renderGrupo('Vencidos', grupos.vencido);

    if (archivados.length) {
      html += '<button class="avz-archivados-toggle" id="avzToggleArchivados" aria-expanded="' + state.archivadosAbiertos + '">' +
        (state.archivadosAbiertos ? '▾' : '▸') + ' Archivados (' + archivados.length + ')</button>';
      if (state.archivadosAbiertos) html += renderGrupo(null, archivados);
    }
    return html;
  }

  function selectsListaInertes() {
    return '<select class="avz-select" disabled title="Disponible en una próxima fase"><option>Tipo</option></select>' +
      '<select class="avz-select" disabled title="Disponible en una próxima fase"><option>Estado</option></select>' +
      '<select class="avz-select" disabled title="Disponible en una próxima fase"><option>Prioridad</option></select>';
  }

  function botonFilaAccion(accion, id, label, iconoHtml) {
    const enCurso = state.filasEnCurso.has(id);
    return '<button class="avz-fila-accion-btn" type="button" data-fila-accion="' + accion + '" data-id="' + id + '"' +
      (enCurso ? ' disabled' : '') +
      ' title="' + (enCurso ? 'Procesando…' : label) + '" aria-label="' + label + ' aviso">' + iconoHtml + '</button>';
  }

  function renderGrupo(label, avisos) {
    if (!avisos.length) return '';
    let html = label ? '<div class="avz-lista-grupo-label">' + label + '</div>' : '';
    avisos.forEach(function (a) {
      const archivado = a.archivado;
      html += '<div class="avz-fila" data-abrir-aviso="' + a.id + '" tabindex="0" role="button">' +
        '<span class="avz-fila-icono">' + TIPO_META[a.tipo].icono + '</span>' +
        '<div class="avz-fila-info">' +
          '<div class="avz-fila-titulo">' +
            (a.prioridad === 'urgente' ? '<span class="avz-urgente-dot"></span>' : '') +
            escapeHtml(a.titulo) +
          '</div>' +
          '<div class="avz-fila-dest">' + escapeHtml(labelDestinatarios(a.destinatarios)) + '</div>' +
        '</div>' +
        '<span class="avz-fila-fecha">' + fmtRango(a.fechaDesde, a.fechaHasta) + '</span>' +
        '<div class="avz-fila-acciones">' +
          botonFilaAccion('editar', a.id, 'Editar', icon('edit', 'icon-14')) +
          botonFilaAccion('duplicar', a.id, 'Duplicar', '⧉') +
          (archivado
            ? botonFilaAccion('restaurar', a.id, 'Restaurar', icon('refresh', 'icon-14'))
            : botonFilaAccion('archivar', a.id, 'Archivar', icon('trash', 'icon-14'))) +
        '</div>' +
      '</div>';
    });
    return html;
  }

  function wireAccionesFila(body) {
    const toggle = body.querySelector('#avzToggleArchivados');
    if (toggle) toggle.addEventListener('click', function () {
      state.archivadosAbiertos = !state.archivadosAbiertos;
      renderBody();
    });

    body.querySelectorAll('[data-fila-accion]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const id = btn.dataset.id;
        const accion = btn.dataset.filaAccion;
        if (state.filasEnCurso.has(id)) return; // doble submit

        if (accion === 'editar') { abrirPanel('form', { avisoId: id, elementoOrigen: btn }); return; }

        state.filasEnCurso.add(id);
        renderBody();

        if (accion === 'duplicar') {
          ejecutarDuplicar(id).then(function (resultado) {
            state.filasEnCurso.delete(id);
            renderBody();
            if (resultado.ok) showToast('Aviso duplicado.');
            else showToast(resultado.error);
          });
        } else if (accion === 'archivar') {
          ejecutarArchivar(id).then(function (resultado) {
            state.filasEnCurso.delete(id);
            renderBody();
            if (resultado.ok) {
              mostrarToastDeshacer('Aviso archivado.', function () { return ejecutarRestaurar(id); },
                'No se pudo deshacer. El aviso sigue archivado.');
            } else showToast(resultado.error);
          });
        } else if (accion === 'restaurar') {
          ejecutarRestaurar(id).then(function (resultado) {
            state.filasEnCurso.delete(id);
            renderBody();
            if (resultado.ok) showToast('Aviso restaurado.');
            else showToast(resultado.error);
          });
        }
      });
    });
  }

  // ── Vista Calendario ─────────────────────────────────────
  function renderCalendarioShell() {
    if (state.calAnio === null) {
      const hoy = hoyDate();
      state.calAnio = hoy.getFullYear();
      state.calMes = hoy.getMonth();
    }
    const cabeceraDias = DIAS_SEMANA.map(function (d) { return '<span>' + d + '</span>'; }).join('');
    return '<div class="avz-cal-toolbar">' +
        '<div class="avz-cal-nav">' +
          '<button class="avz-cal-nav-btn" id="avzMesPrev" aria-label="Mes anterior">' + icon('chevronLeft', 'icon-16') + '</button>' +
          '<span class="avz-cal-mes">' + MESES[state.calMes] + ' ' + state.calAnio + '</span>' +
          '<button class="avz-cal-nav-btn" id="avzMesNext" aria-label="Mes siguiente">' + icon('chevronRight', 'icon-16') + '</button>' +
        '</div>' +
        '<button class="avz-cal-hoy-btn" id="avzMesHoy" type="button">Hoy</button>' +
      '</div>' +
      '<div class="avz-cal-grid">' +
        '<div class="avz-cal-dias-header">' + cabeceraDias + '</div>' +
        '<div class="avz-cal-semanas" id="avzCalSemanas">' + renderSemanas(state.calAnio, state.calMes) + '</div>' +
      '</div>' +
      '<div class="avz-cal-legenda">' +
        '<span>● Evento</span><span>▓ Local cerrado</span><span>ⓘ Información</span><span>🔴 Urgente</span>' +
      '</div>';
  }

  function renderSemanas(anio, mes) {
    const primerDia = new Date(anio, mes, 1);
    const offset = (primerDia.getDay() + 6) % 7; // lunes = 0
    const diasEnMes = new Date(anio, mes + 1, 0).getDate();
    const hoy = hoyISO();

    const celdas = [];
    for (let i = 0; i < offset; i++) {
      const fecha = new Date(anio, mes, 1 - (offset - i));
      celdas.push({ num: fecha.getDate(), fuera: true, iso: isoDeDate(fecha) });
    }
    for (let d = 1; d <= diasEnMes; d++) {
      celdas.push({ num: d, fuera: false, iso: isoDeDate(new Date(anio, mes, d)) });
    }
    let siguiente = 1;
    while (celdas.length % 7 !== 0) {
      const fecha = new Date(anio, mes + 1, siguiente++);
      celdas.push({ num: fecha.getDate(), fuera: true, iso: isoDeDate(fecha) });
    }

    let html = '';
    for (let s = 0; s < celdas.length; s += 7) {
      html += '<div class="avz-cal-semana">';
      for (let i = s; i < s + 7; i++) {
        const c = celdas[i];
        const esHoy = !c.fuera && c.iso === hoy;
        const avisosDia = avisosDelDia(c.iso);
        const vacacionesDia = vacacionesDelDia(c.iso);

        // Prioridad visual (Fase 4, aprobada): Local Cerrado primero —
        // nunca debe quedar oculto detrás de Vacaciones por overflow —
        // después el resto de avisos, y por último Vacaciones. Partición
        // ESTABLE: avisosDelDia() no se toca ni se reordena, solo se
        // antepone local_cerrado — el orden urgente-primero ya existente
        // entre "otros avisos" queda intacto.
        const localCerrado = avisosDia.filter(function (a) { return a.tipo === 'local_cerrado'; });
        const otrosAvisos = avisosDia.filter(function (a) { return a.tipo !== 'local_cerrado'; });
        const itemsCelda = localCerrado.concat(otrosAvisos)
          .map(function (a) { return { esVacacion: false, aviso: a }; })
          .concat(vacacionesDia.map(function (v) { return { esVacacion: true, vacacion: v }; }));

        // MAX_INDICADORES_POR_CELDA se aplica al total combinado
        // (avisos + vacaciones), nunca solo a avisos.
        const visibles = itemsCelda.slice(0, MAX_INDICADORES_POR_CELDA);
        const restantes = itemsCelda.length - visibles.length;

        const itemsHtml = visibles.map(function (it) {
          if (it.esVacacion) {
            const v = it.vacacion;
            return '<div class="avz-cal-vacacion-item" data-vacacion-id="' + v.id + '" tabindex="0" role="button" title="' + escapeAttr(v.empleado + ' — ' + fmtRango(v.fechaDesde, v.fechaHasta)) + '">' +
              '<span class="avz-cal-aviso-icono">' + icon('palmtree', 'icon-10') + '</span>' +
              '<span class="avz-cal-aviso-titulo">' + escapeHtml(v.empleado) + '</span>' +
            '</div>';
          }
          const a = it.aviso;
          return '<div class="avz-cal-aviso-item" data-abrir-aviso="' + a.id + '" tabindex="0" role="button" title="' + escapeAttr(a.titulo) + '">' +
            (a.prioridad === 'urgente' ? '<span class="avz-urgente-dot"></span>' : '<span class="avz-cal-aviso-icono">' + TIPO_META[a.tipo].icono + '</span>') +
            '<span class="avz-cal-aviso-titulo">' + escapeHtml(a.titulo) + '</span>' +
          '</div>';
        }).join('');
        const masHtml = restantes > 0
          ? '<button class="avz-cal-mas" type="button" data-resumen-dia="' + c.iso + '">+' + restantes + ' más</button>'
          : '';

        html += '<div class="avz-cal-celda' + (c.fuera ? ' fuera-de-mes' : '') + (esHoy ? ' es-hoy' : '') + '" data-celda-fecha="' + c.iso + '">' +
          '<div class="avz-cal-num">' + c.num + '</div>' +
          '<div class="avz-cal-avisos">' + itemsHtml + masHtml + '</div>' +
        '</div>';
      }
      html += '</div>';
    }
    return html;
  }

  function wireCalendario() {
    const prev = document.getElementById('avzMesPrev');
    const next = document.getElementById('avzMesNext');
    const hoyBtn = document.getElementById('avzMesHoy');
    if (prev) prev.addEventListener('click', function () { cambiarMes(-1); });
    if (next) next.addEventListener('click', function () { cambiarMes(1); });
    if (hoyBtn) hoyBtn.addEventListener('click', function () {
      const hoy = hoyDate();
      state.calAnio = hoy.getFullYear();
      state.calMes = hoy.getMonth();
      renderBody();
    });

    const semanas = document.getElementById('avzCalSemanas');
    if (!semanas) return;
    semanas.addEventListener('click', function (e) {
      // Clase separada de ".avz-cal-aviso-item" a propósito, para que no
      // ambigüe con ese primer chequeo de abajo ni caiga al handler de
      // ".avz-cal-celda" (que abriría por error el form de "nuevo aviso").
      const vacItem = e.target.closest('.avz-cal-vacacion-item');
      if (vacItem) { abrirPanel('detalle-vacacion', { vacacionId: vacItem.dataset.vacacionId, elementoOrigen: vacItem }); return; }
      const item = e.target.closest('.avz-cal-aviso-item');
      if (item) { abrirPanel('detalle', { avisoId: item.dataset.abrirAviso, elementoOrigen: item }); return; }
      const masBtn = e.target.closest('.avz-cal-mas');
      if (masBtn) { abrirPanel('resumen-dia', { fecha: masBtn.dataset.resumenDia, elementoOrigen: masBtn }); return; }
      const celda = e.target.closest('.avz-cal-celda');
      if (celda) { abrirPanel('form', { fecha: celda.dataset.celdaFecha, elementoOrigen: celda }); }
    });
  }

  function cambiarMes(delta) {
    state.calMes += delta;
    if (state.calMes < 0) { state.calMes = 11; state.calAnio--; }
    else if (state.calMes > 11) { state.calMes = 0; state.calAnio++; }
    renderBody();
  }

  // =======================================================
  //  PANEL LATERAL ÚNICO
  //  Modos: 'detalle' | 'form' | 'cerrar-local' | 'resumen-dia'
  // =======================================================

  function nuevoBorradorForm(opts) {
    opts = opts || {};
    if (opts.avisoId) {
      const original = obtenerAviso(opts.avisoId);
      return {
        tipo: original.tipo,
        titulo: original.titulo,
        mensaje: original.mensaje,
        fechaDesde: original.fechaDesde,
        fechaHasta: original.fechaHasta,
        destinatarios: clonarDestinatarios(original.destinatarios),
        canales: Object.assign({}, original.canales),
        prioridad: original.prioridad,
      };
    }
    const tipo = opts.tipo || 'informacion';
    const def = DEFAULTS_POR_TIPO[tipo];
    return {
      tipo: tipo,
      titulo: tipo === 'local_cerrado' ? 'LOCAL CERRADO' : '',
      mensaje: '',
      fechaDesde: opts.fecha || '',
      fechaHasta: opts.fecha || '',
      destinatarios: clonarDestinatarios(def.destinatarios),
      canales: Object.assign({}, def.canales),
      prioridad: def.prioridad,
    };
  }

  function nuevoBorradorCerrarLocal(opts) {
    opts = opts || {};
    const sucInicial = (state.sucursal && state.sucursal !== 'todas') ? [state.sucursal] : [];
    return {
      sucursalIds: opts.sucursalIds || sucInicial,
      fechaDesde: opts.fecha || hoyISO(),
      fechaHasta: opts.fecha || hoyISO(),
      motivo: '',
    };
  }

  function abrirPanel(modo, opts) {
    opts = opts || {};
    state.panel.abierto = true;
    state.panel.modo = modo;
    state.panel.avisoId = opts.avisoId || null;
    // Fase 5: identidad separada de avisoId a propósito — una vacación
    // nunca se busca con obtenerAviso() ni comparte namespace de ID con
    // un aviso (los prefijos ya son distintos, "vac_" vs "AVI-", pero
    // conceptualmente son colecciones independientes y el campo lo refleja).
    state.panel.vacacionId = opts.vacacionId || null;
    state.panel.fechaPrecargada = opts.fecha || null;
    state.panel.elementoOrigen = opts.elementoOrigen || document.activeElement;
    state.panel.dirty = false;
    state.panel.intentoPublicar = false;
    state.panel.masOpcionesAbiertas = false;
    state.panel.guardando = false;
    state.panel.errorGuardado = null;

    if (modo === 'form') {
      state.panel.borrador = nuevoBorradorForm(opts);
      state.panel.original = JSON.stringify(state.panel.borrador);
    } else if (modo === 'cerrar-local') {
      state.panel.borrador = nuevoBorradorCerrarLocal(opts);
      state.panel.original = JSON.stringify(state.panel.borrador);
    } else {
      state.panel.borrador = null;
      state.panel.original = null;
    }

    montarPanel();
    document.addEventListener('keydown', onPanelKeydown, true);
  }

  function cerrarPanel(force) {
    // Nunca se cierra mientras hay una mutación esperando confirmación del
    // servidor — ni por Cancelar, ni por Escape, ni por clic afuera (Fase
    // 3B.2). "force" es de uso interno (después de una mutación EXITOSA),
    // nunca lo dispara directamente una interacción del usuario.
    if (!force && state.panel.guardando) return;
    if (!force && state.panel.dirty) {
      mostrarConfirm({
        titulo: '¿Descartar cambios?',
        mensaje: 'Tenés cambios sin guardar en este aviso. Si salís ahora se van a perder.',
        textoOk: 'Descartar cambios',
        textoCancel: 'Seguir editando',
        peligro: true,
        onOk: function () { cerrarPanel(true); },
      });
      return;
    }
    document.removeEventListener('keydown', onPanelKeydown, true);
    const overlay = document.getElementById('avzPanelOverlay');
    if (overlay) overlay.remove();
    const origen = state.panel.elementoOrigen;
    state.panel = {
      abierto: false, modo: null, avisoId: null, vacacionId: null, fechaPrecargada: null,
      borrador: null, original: null, dirty: false, intentoPublicar: false,
      masOpcionesAbiertas: false, elementoOrigen: null,
      guardando: false, errorGuardado: null,
    };
    if (origen && typeof origen.focus === 'function') origen.focus();
  }

  function onPanelKeydown(e) {
    if (!state.panel.abierto) return;
    if (e.key === 'Escape') {
      if (state.panel.guardando) { e.preventDefault(); return; } // ignorado mientras se guarda
      e.preventDefault(); cerrarPanel(); return;
    }
    if (e.key === 'Tab') {
      const panel = document.getElementById('avzPanel');
      if (!panel) return;
      const focusables = Array.prototype.slice.call(
        panel.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
      ).filter(function (el) { return el.offsetParent !== null; });
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!panel.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    }
  }

  function montarPanel() {
    const existing = document.getElementById('avzPanelOverlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'avzPanelOverlay';
    overlay.className = 'avz-panel-overlay';
    overlay.innerHTML = '<div class="avz-panel" id="avzPanel" role="dialog" aria-modal="true" aria-label="' + escapeAttr(tituloPanelActual()) + '">' + renderPanelContenido() + '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay && !state.panel.guardando) cerrarPanel();
    });
    wirePanelContenido();
    const panelEl = document.getElementById('avzPanel');
    const foco = panelEl.querySelector('[data-autofocus]') || panelEl.querySelector('button, input, select, textarea');
    if (foco) foco.focus();
  }

  function tituloPanelActual() {
    const m = state.panel.modo;
    if (m === 'detalle') return 'Detalle del aviso';
    if (m === 'detalle-vacacion') return 'Vacación';
    if (m === 'cerrar-local') return 'Cerrar local';
    if (m === 'resumen-dia') return 'Avisos del día';
    return state.panel.avisoId ? 'Editar aviso' : 'Nuevo aviso';
  }

  function renderPanelContenido() {
    const m = state.panel.modo;
    if (m === 'detalle') return renderPanelDetalle();
    if (m === 'detalle-vacacion') return renderPanelDetalleVacacion();
    if (m === 'cerrar-local') return renderPanelCerrarLocal();
    if (m === 'resumen-dia') return renderPanelResumenDia();
    return renderPanelForm();
  }

  function wirePanelContenido() {
    const cerrar = document.getElementById('avzPanelClose');
    if (cerrar) cerrar.addEventListener('click', function () { cerrarPanel(); });

    const m = state.panel.modo;
    if (m === 'detalle') wirePanelDetalle();
    // detalle-vacacion: nada que wire-ar además del botón cerrar (ya
    // wireado arriba, genérico) — solo lectura, sin campos ni acciones.
    else if (m === 'detalle-vacacion') { /* no-op a propósito */ }
    else if (m === 'cerrar-local') wirePanelCerrarLocal();
    else if (m === 'resumen-dia') wirePanelResumenDia();
    else wirePanelForm();
  }

  function headerPanel(titulo) {
    return '<div class="avz-panel-header">' +
      '<h2 class="avz-panel-titulo">' + escapeHtml(titulo) + '</h2>' +
      '<button class="avz-panel-close" id="avzPanelClose" type="button" aria-label="Cerrar panel">×</button>' +
    '</div>';
  }

  // ── Panel: Detalle ──────────────────────────────────────
  function renderPanelDetalle() {
    const a = obtenerAviso(state.panel.avisoId);
    if (!a) {
      return headerPanel('Detalle del aviso') +
        '<div class="avz-panel-body"><div class="avz-vacio-sub">Este aviso ya no existe.</div></div>';
    }
    const st = estadoDe(a);
    const canalesActivos = Object.keys(a.canales).filter(function (k) { return a.canales[k]; });
    const canalesLabel = { calendario: 'Calendario', banner: 'Novedades', email: 'Email', whatsapp: 'WhatsApp' };

    const g = state.panel.guardando;
    return headerPanel(tituloPanelActual()) +
      '<div class="avz-panel-body">' +
        '<div class="avz-detalle-tipo">' + TIPO_META[a.tipo].icono + ' ' + TIPO_META[a.tipo].label + '</div>' +
        '<h3 class="avz-detalle-titulo">' + escapeHtml(a.titulo) + '</h3>' +
        '<div class="avz-detalle-meta">' +
          '<span class="badge badge-neutral" title="Versión ' + (a.version || 1) + '">' + labelEstado(st) + '</span>' +
          (a.prioridad === 'urgente' ? '<span class="badge badge-danger">Urgente</span>' : '') +
        '</div>' +
        '<div class="avz-detalle-fecha">' + fmtRango(a.fechaDesde, a.fechaHasta) + '</div>' +
        '<p class="avz-detalle-mensaje">' + escapeHtml(a.mensaje) + '</p>' +
        '<div class="avz-detalle-fila"><span>Destinatarios</span><strong>' + escapeHtml(labelDestinatarios(a.destinatarios)) + '</strong></div>' +
        '<div class="avz-detalle-fila"><span>Canales</span><strong>' + (canalesActivos.length ? canalesActivos.map(function (c) { return canalesLabel[c]; }).join(', ') : 'Ninguno') + '</strong></div>' +
        '<div class="avz-detalle-fila"><span>Autor</span><strong>' + escapeHtml(a.autor) + '</strong></div>' +
        '<div class="avz-detalle-fila"><span>Creado</span><strong>' + fmtCorta(a.fechaCreacion) + '</strong></div>' +
        (state.panel.errorGuardado ? '<div class="avz-field-error" style="margin-top:8px">' + escapeHtml(state.panel.errorGuardado.mensaje) + '</div>' : '') +
      '</div>' +
      '<div class="avz-panel-footer">' +
        '<button class="btn btn-outline" id="avzDetEditar" type="button"' + (g ? ' disabled' : '') + '>Editar</button>' +
        '<button class="btn btn-outline" id="avzDetDuplicar" type="button"' + (g ? ' disabled' : '') + '>' + (g ? 'Duplicando…' : 'Duplicar') + '</button>' +
        (a.archivado
          ? '<button class="btn btn-primary" id="avzDetRestaurar" type="button"' + (g ? ' disabled' : '') + '>' + (g ? 'Restaurando…' : 'Restaurar') + '</button>'
          : '<button class="btn btn-danger" id="avzDetArchivar" type="button"' + (g ? ' disabled' : '') + '>' + (g ? 'Archivando…' : 'Archivar') + '</button>') +
      '</div>';
  }

  function labelEstado(st) {
    return { activo: 'Activo', programado: 'Programado', vencido: 'Vencido', archivado: 'Archivado' }[st] || st;
  }

  // ── Panel: Detalle de Vacación (Fase 5) — exclusivamente informativo ───
  // Busca SOLO en state.vacaciones, nunca en obtenerAviso()/state.avisos —
  // una vacación no es un aviso y no se adapta a su shape acá. Reutiliza
  // sucursalPorId() (ya existente, mismo array SUCURSALES que usan los
  // avisos) para el label — sin fetch, sin recalcular sucursal, sin tocar
  // EMPLEADOS_PERFILES. Sin footer de acciones: el único cierre es el
  // botón de header + Escape + click afuera, todos ya genéricos del
  // panel — no se agrega ningún botón nuevo.
  function obtenerVacacion(id) {
    return state.vacaciones.find(function (v) { return v.id === id; });
  }

  function renderPanelDetalleVacacion() {
    const v = obtenerVacacion(state.panel.vacacionId);
    if (!v) {
      return headerPanel('Vacación') +
        '<div class="avz-panel-body"><div class="avz-vacio-sub">Esta vacación ya no está disponible.</div></div>';
    }
    const suc = sucursalPorId(v.sucursalId);
    const dias = v.dias === 1 ? '1 día' : v.dias + ' días';

    return headerPanel('Vacación') +
      '<div class="avz-panel-body">' +
        '<div class="avz-detalle-tipo">' + icon('palmtree', 'icon-16') + ' Vacación</div>' +
        '<h3 class="avz-detalle-titulo">' + escapeHtml(v.empleado) + '</h3>' +
        '<div class="avz-detalle-meta">' +
          '<span class="badge badge-success">Aprobada</span>' +
        '</div>' +
        '<div class="avz-detalle-fecha">' + fmtRango(v.fechaDesde, v.fechaHasta) + '</div>' +
        '<div class="avz-detalle-fila"><span>Días</span><strong>' + dias + '</strong></div>' +
        '<div class="avz-detalle-fila"><span>Sucursal</span><strong>' + escapeHtml(suc ? suc.label : (v.sucursalId || '—')) + '</strong></div>' +
      '</div>';
  }

  function wirePanelDetalle() {
    const id = state.panel.avisoId;
    const btnEditar = document.getElementById('avzDetEditar');
    const btnDup = document.getElementById('avzDetDuplicar');
    const btnArch = document.getElementById('avzDetArchivar');
    const btnRest = document.getElementById('avzDetRestaurar');
    if (btnEditar) btnEditar.addEventListener('click', function () {
      if (state.panel.guardando) return;
      const origen = state.panel.elementoOrigen;
      abrirPanel('form', { avisoId: id, elementoOrigen: origen });
    });
    if (btnDup) btnDup.addEventListener('click', function () {
      if (state.panel.guardando) return;
      state.panel.guardando = true;
      state.panel.errorGuardado = null;
      montarPanel();
      ejecutarDuplicar(id).then(function (resultado) {
        if (!state.panel.abierto) return;
        state.panel.guardando = false;
        if (resultado.ok) {
          cerrarPanel(true);
          showToast('Aviso duplicado.');
        } else {
          state.panel.errorGuardado = { mensaje: resultado.error };
          montarPanel();
        }
      });
    });
    if (btnArch) btnArch.addEventListener('click', function () {
      if (state.panel.guardando) return;
      state.panel.guardando = true;
      state.panel.errorGuardado = null;
      montarPanel();
      ejecutarArchivar(id).then(function (resultado) {
        if (!state.panel.abierto) return;
        state.panel.guardando = false;
        if (resultado.ok) {
          cerrarPanel(true);
          mostrarToastDeshacer('Aviso archivado.', function () { return ejecutarRestaurar(id); },
            'No se pudo deshacer. El aviso sigue archivado.');
        } else {
          state.panel.errorGuardado = { mensaje: resultado.error };
          montarPanel();
        }
      });
    });
    if (btnRest) btnRest.addEventListener('click', function () {
      if (state.panel.guardando) return;
      state.panel.guardando = true;
      state.panel.errorGuardado = null;
      montarPanel();
      ejecutarRestaurar(id).then(function (resultado) {
        if (!state.panel.abierto) return;
        state.panel.guardando = false;
        if (resultado.ok) {
          cerrarPanel(true);
          showToast('Aviso restaurado.');
        } else {
          state.panel.errorGuardado = { mensaje: resultado.error };
          montarPanel();
        }
      });
    });
  }

  // ── Panel: Resumen de un día ─────────────────────────────
  function renderPanelResumenDia() {
    const fecha = state.panel.fechaPrecargada;
    const avisos = avisosDelDia(fecha);
    const vacaciones = vacacionesDelDia(fecha);
    const itemsAvisos = avisos.map(function (a) {
      return '<button class="avz-resumen-item" type="button" data-abrir-aviso="' + a.id + '">' +
        '<span class="avz-fila-icono">' + TIPO_META[a.tipo].icono + '</span>' +
        '<span class="avz-resumen-item-titulo">' + escapeHtml(a.titulo) + (a.prioridad === 'urgente' ? ' <span class="avz-urgente-dot"></span>' : '') + '</span>' +
        '<span class="avz-fila-dest">' + escapeHtml(labelDestinatarios(a.destinatarios)) + '</span>' +
      '</button>';
    }).join('');

    // Vacaciones: solo lectura, sin acciones — por eso <div>, no <button>
    // (no hay ningún handler que las escuche; el detalle individual llega
    // en Fase 5). Bloque separado del de avisos, nunca mezclados en el
    // mismo array/objeto.
    const itemsVacaciones = vacaciones.map(function (v) {
      const dias = v.dias === 1 ? '1 día' : v.dias + ' días';
      return '<div class="avz-resumen-item avz-resumen-item-vacacion" data-vacacion-id="' + v.id + '" tabindex="0" role="button">' +
        '<span class="avz-fila-icono">' + icon('palmtree', 'icon-14') + '</span>' +
        '<span class="avz-resumen-item-titulo">' + escapeHtml(v.empleado) + '</span>' +
        '<span class="avz-fila-dest">' + fmtRango(v.fechaDesde, v.fechaHasta) + ' · ' + dias + '</span>' +
      '</div>';
    }).join('');

    const bloqueAvisos = '<div class="avz-resumen-seccion-titulo">Avisos</div>' +
      (itemsAvisos || '<div class="avz-vacio-sub">No hay avisos este día.</div>');
    const bloqueVacaciones = vacaciones.length
      ? '<div class="avz-resumen-seccion-titulo">Vacaciones</div>' + itemsVacaciones
      : '';

    return headerPanel(fechaLarga(fecha)) +
      '<div class="avz-panel-body">' + bloqueAvisos + bloqueVacaciones + '</div>' +
      '<div class="avz-panel-footer">' +
        '<button class="btn btn-primary" id="avzResumenNuevo" type="button">' + icon('plus', 'icon-16') + ' Nuevo aviso</button>' +
      '</div>';
  }

  function wirePanelResumenDia() {
    const panel = document.getElementById('avzPanel');
    panel.querySelectorAll('[data-abrir-aviso]').forEach(function (el) {
      el.addEventListener('click', function () {
        abrirPanel('detalle', { avisoId: el.dataset.abrirAviso });
      });
    });
    // Vacaciones del resumen (Fase 5) — mismo detalle-vacacion que desde
    // el calendario, no un panel/UI aparte.
    panel.querySelectorAll('[data-vacacion-id]').forEach(function (el) {
      el.addEventListener('click', function () {
        abrirPanel('detalle-vacacion', { vacacionId: el.dataset.vacacionId });
      });
    });
    const btnNuevo = document.getElementById('avzResumenNuevo');
    if (btnNuevo) btnNuevo.addEventListener('click', function () {
      abrirPanel('form', { fecha: state.panel.fechaPrecargada });
    });
  }

  // ── Panel: Cerrar local (flujo rápido) ──────────────────
  function renderPanelCerrarLocal() {
    const b = state.panel.borrador;
    const val = validarCerrarLocal(b);
    const sucCheckboxes = SUCURSALES_SELECCIONABLES.map(function (s) {
      const marcado = b.sucursalIds.indexOf(s.id) !== -1;
      return '<label class="avz-check-row">' +
        '<input type="checkbox" class="avz-cl-suc" value="' + s.id + '"' + (marcado ? ' checked' : '') + ' /> ' + s.label +
      '</label>';
    }).join('');
    const todasMarcadas = SUCURSALES_SELECCIONABLES.every(function (s) { return b.sucursalIds.indexOf(s.id) !== -1; });

    return headerPanel('Cerrar local') +
      '<div class="avz-panel-body">' +
        '<div class="avz-field">' +
          '<div class="avz-field-label-row">' +
            '<span class="avz-field-label">Sucursal(es)</span>' +
            '<button class="avz-link-btn" type="button" id="avzClTodas">' + (todasMarcadas ? 'Quitar selección' : 'Seleccionar todas') + '</button>' +
          '</div>' +
          '<div class="avz-check-grid">' + sucCheckboxes + '</div>' +
          (state.panel.intentoPublicar && val.errores.sucursal ? '<div class="avz-field-error">' + val.errores.sucursal + '</div>' : '') +
        '</div>' +
        '<div class="avz-field-row">' +
          '<div class="avz-field">' +
            '<label class="avz-field-label" for="avzClDesde">Desde</label>' +
            '<input type="date" class="form-control" id="avzClDesde" value="' + escapeAttr(b.fechaDesde) + '" />' +
          '</div>' +
          '<div class="avz-field">' +
            '<label class="avz-field-label" for="avzClHasta">Hasta</label>' +
            '<input type="date" class="form-control" id="avzClHasta" value="' + escapeAttr(b.fechaHasta) + '" />' +
          '</div>' +
        '</div>' +
        (state.panel.intentoPublicar && val.errores.fecha ? '<div class="avz-field-error">' + val.errores.fecha + '</div>' : '') +
        '<div class="avz-field">' +
          '<label class="avz-field-label" for="avzClMotivo">Motivo (opcional)</label>' +
          '<textarea class="form-textarea" id="avzClMotivo" rows="2" placeholder="Ej: refacciones">' + escapeHtml(b.motivo) + '</textarea>' +
        '</div>' +
        '<div class="avz-resumen-canales">Se va a mostrar en <strong>Calendario, Novedades y Email</strong> de la sucursal seleccionada.</div>' +
        '<button class="avz-link-btn" type="button" id="avzClMasOpciones"' + (state.panel.guardando ? ' disabled' : '') + '>Más opciones →</button>' +
        (state.panel.errorGuardado ? '<div class="avz-field-error" style="margin-top:8px">' + escapeHtml(state.panel.errorGuardado.mensaje) + '</div>' : '') +
      '</div>' +
      '<div class="avz-panel-footer">' +
        '<button class="btn btn-outline" id="avzClCancelar" type="button"' + (state.panel.guardando ? ' disabled' : '') + '>Cancelar</button>' +
        '<button class="btn btn-danger" id="avzClConfirmar" type="button"' + (val.valido && !state.panel.guardando ? '' : ' disabled') + '>' +
          (state.panel.guardando ? 'Cerrando…' : 'Cerrar local') +
        '</button>' +
      '</div>';
  }

  function validarCerrarLocal(b) {
    const errores = {};
    if (!b.sucursalIds.length) errores.sucursal = 'Elegí al menos una sucursal.';
    if (!b.fechaDesde) errores.fecha = 'La fecha "desde" es obligatoria.';
    else if (b.fechaHasta < b.fechaDesde) errores.fecha = 'La fecha "hasta" no puede ser anterior a "desde".';
    return { valido: Object.keys(errores).length === 0, errores: errores };
  }

  function wirePanelCerrarLocal() {
    const b = state.panel.borrador;
    const panel = document.getElementById('avzPanel');

    function marcarDirty() { state.panel.dirty = JSON.stringify(b) !== state.panel.original; }
    function refrescarBoton() {
      const val = validarCerrarLocal(b);
      const btn = document.getElementById('avzClConfirmar');
      if (btn) btn.disabled = !val.valido;
    }

    panel.querySelectorAll('.avz-cl-suc').forEach(function (cb) {
      cb.addEventListener('change', function () {
        const idx = b.sucursalIds.indexOf(cb.value);
        if (cb.checked && idx === -1) b.sucursalIds.push(cb.value);
        else if (!cb.checked && idx !== -1) b.sucursalIds.splice(idx, 1);
        marcarDirty();
        refrescarBoton();
        // El label "Seleccionar todas" puede haber cambiado — re-render completo del panel es aceptable acá (checkbox, no texto).
        montarPanel();
      });
    });
    const btnTodas = document.getElementById('avzClTodas');
    if (btnTodas) btnTodas.addEventListener('click', function () {
      const todasIds = SUCURSALES_SELECCIONABLES.map(function (s) { return s.id; });
      const todasMarcadas = todasIds.every(function (id) { return b.sucursalIds.indexOf(id) !== -1; });
      b.sucursalIds = todasMarcadas ? [] : todasIds.slice();
      marcarDirty();
      montarPanel();
    });
    const desde = document.getElementById('avzClDesde');
    const hasta = document.getElementById('avzClHasta');
    if (desde) desde.addEventListener('input', function () {
      b.fechaDesde = desde.value;
      if (hasta.value < desde.value) hasta.value = desde.value;
      b.fechaHasta = hasta.value;
      marcarDirty();
      refrescarBoton();
    });
    if (hasta) hasta.addEventListener('input', function () {
      b.fechaHasta = hasta.value;
      marcarDirty();
      refrescarBoton();
    });
    const motivo = document.getElementById('avzClMotivo');
    if (motivo) motivo.addEventListener('input', function () {
      b.motivo = motivo.value;
      marcarDirty();
    });
    const btnMas = document.getElementById('avzClMasOpciones');
    if (btnMas) btnMas.addEventListener('click', function () {
      if (state.panel.guardando) return;
      convertirCerrarLocalAForm();
    });
    const btnCancelar = document.getElementById('avzClCancelar');
    if (btnCancelar) btnCancelar.addEventListener('click', function () {
      if (state.panel.guardando) return;
      cerrarPanel();
    });
    const btnConfirmar = document.getElementById('avzClConfirmar');
    if (btnConfirmar) btnConfirmar.addEventListener('click', function () {
      if (state.panel.guardando) return; // doble submit
      state.panel.intentoPublicar = true;
      const val = validarCerrarLocal(b);
      if (!val.valido) { montarPanel(); return; }

      state.panel.guardando = true;
      state.panel.errorGuardado = null;
      montarPanel();

      window.CromaAvisosRepository.crear({
        tipo: 'local_cerrado',
        titulo: 'LOCAL CERRADO',
        mensaje: b.motivo.trim() || 'El local permanecerá cerrado.',
        fechaDesde: b.fechaDesde,
        fechaHasta: b.fechaHasta,
        destinatarios: { modo: 'sucursal', ids: b.sucursalIds.slice() },
        canales: Object.assign({}, DEFAULTS_POR_TIPO.local_cerrado.canales),
        prioridad: 'normal',
      }).then(function (resultado) {
        if (!state.panel.abierto) return;
        state.panel.guardando = false;
        if (resultado.ok) {
          aplicarAvisoEnMemoria(resultado.aviso);
          cerrarPanel(true);
          showToast('Local cerrado publicado.');
        } else {
          state.panel.errorGuardado = { mensaje: resultado.error };
          montarPanel();
        }
      });
    });
  }

  function convertirCerrarLocalAForm() {
    const b = state.panel.borrador;
    const formBorrador = {
      tipo: 'local_cerrado',
      titulo: 'LOCAL CERRADO',
      mensaje: b.motivo || '',
      fechaDesde: b.fechaDesde,
      fechaHasta: b.fechaHasta,
      destinatarios: { modo: 'sucursal', ids: b.sucursalIds.slice() },
      canales: Object.assign({}, DEFAULTS_POR_TIPO.local_cerrado.canales),
      prioridad: 'normal',
    };
    state.panel.modo = 'form';
    state.panel.avisoId = null;
    state.panel.borrador = formBorrador;
    state.panel.original = JSON.stringify(formBorrador);
    state.panel.dirty = false;
    state.panel.intentoPublicar = false;
    state.panel.masOpcionesAbiertas = true;
    montarPanel();
  }

  // ── Panel: Nuevo aviso / Editar (formulario completo) ────
  function requiereFecha(b) { return b.tipo !== 'informacion' || b.canales.calendario || !!b.fechaDesde; }

  function validarBorradorForm(b) {
    const errores = {};
    if (!b.titulo.trim()) errores.titulo = 'El título es obligatorio.';
    if (!b.mensaje.trim()) errores.mensaje = 'El mensaje es obligatorio.';
    if (requiereFecha(b)) {
      if (!b.fechaDesde) errores.fecha = 'La fecha es obligatoria para este tipo de aviso.';
      else if (b.fechaHasta < b.fechaDesde) errores.fecha = 'La fecha "hasta" no puede ser anterior a "desde".';
    }
    if (b.destinatarios.modo === 'sucursal' && !b.destinatarios.ids.length) {
      errores.destinatarios = b.tipo === 'local_cerrado'
        ? 'Elegí al menos una sucursal para el cierre.'
        : 'Elegí al menos una sucursal.';
    }
    if (b.destinatarios.modo === 'empleado' && !b.destinatarios.nombres.length) {
      errores.destinatarios = 'Elegí al menos un empleado.';
    }
    return { valido: Object.keys(errores).length === 0, errores: errores };
  }

  function textoVistaPrevia(b) {
    const titulo = b.titulo.trim() || '(sin título)';
    const dest = labelDestinatarios(b.destinatarios);
    const fecha = b.fechaDesde ? fmtRango(b.fechaDesde, b.fechaHasta || b.fechaDesde) : '';
    const canales = Object.keys(b.canales).filter(function (k) { return b.canales[k]; });
    const canalesLabel = { calendario: 'Calendario', banner: 'Novedades', email: 'Email', whatsapp: 'WhatsApp' };
    let txt = titulo + ' — ' + dest;
    if (fecha) txt += ', ' + fecha;
    txt += '. Se muestra en: ' + (canales.length ? canales.map(function (c) { return canalesLabel[c]; }).join(', ') : 'ningún canal') + '.';
    return txt;
  }

  function renderPanelForm() {
    const b = state.panel.borrador;
    const val = validarBorradorForm(b);
    // Errores de servidor (400 real) se fusionan con los de validación
    // local — mismos nombres de campo de un lado y del otro (confirmado
    // contra _validarDatosAviso en Code-Jornada.js: titulo/mensaje/tipo/
    // destinatarios/fecha/prioridad), así que se muestran en el mismo
    // lugar sin distinguir origen.
    const erroresServidor = (state.panel.errorGuardado && state.panel.errorGuardado.errores) || {};
    const err = Object.assign({}, state.panel.intentoPublicar ? val.errores : {}, erroresServidor);
    const errorGeneral = state.panel.errorGuardado && !Object.keys(erroresServidor).length ? state.panel.errorGuardado.mensaje : null;
    const esEdicion = !!state.panel.avisoId;

    const tipoChips = Object.keys(TIPO_META).map(function (t) {
      const activo = b.tipo === t;
      return '<button class="avz-tipo-chip' + (activo ? ' active' : '') + '" type="button" data-tipo="' + t + '" role="radio" aria-checked="' + activo + '">' +
        TIPO_META[t].icono + ' ' + TIPO_META[t].label + '</button>';
    }).join('');

    const destRadios = [
      ['todos', 'Todos'], ['sucursal', 'Sucursal(es)'], ['empleado', 'Empleado(s)'], ['administracion', 'Administración'],
    ].map(function (d) {
      const marcado = b.destinatarios.modo === d[0];
      return '<label class="avz-radio-row"><input type="radio" name="avzDest" value="' + d[0] + '"' + (marcado ? ' checked' : '') + ' /> ' + d[1] + '</label>';
    }).join('');

    let destDetalle = '';
    if (b.destinatarios.modo === 'sucursal') {
      const todasMarcadas = SUCURSALES_SELECCIONABLES.every(function (s) { return b.destinatarios.ids.indexOf(s.id) !== -1; });
      destDetalle = '<div class="avz-field-label-row">' +
          '<span></span><button class="avz-link-btn" type="button" id="avzFormSucTodas">' + (todasMarcadas ? 'Quitar selección' : 'Seleccionar todas') + '</button>' +
        '</div>' +
        '<div class="avz-check-grid">' + SUCURSALES_SELECCIONABLES.map(function (s) {
          const marcado = b.destinatarios.ids.indexOf(s.id) !== -1;
          return '<label class="avz-check-row"><input type="checkbox" class="avz-form-suc" value="' + s.id + '"' + (marcado ? ' checked' : '') + ' /> ' + s.label + '</label>';
        }).join('') + '</div>';
    } else if (b.destinatarios.modo === 'empleado') {
      destDetalle = '<div class="avz-check-grid">' + empleadosMock().map(function (emp) {
        const marcado = b.destinatarios.nombres.indexOf(emp.nombre) !== -1;
        return '<label class="avz-check-row"><input type="checkbox" class="avz-form-emp" value="' + escapeAttr(emp.nombre) + '"' + (marcado ? ' checked' : '') + ' /> ' + escapeHtml(emp.nombre) + '</label>';
      }).join('') + '</div>';
    }

    const mostrarFecha = requiereFecha(b);

    return headerPanel(esEdicion ? 'Editar aviso' : 'Nuevo aviso') +
      '<div class="avz-panel-body">' +
        '<div class="avz-field">' +
          '<span class="avz-field-label">¿Qué querés comunicar?</span>' +
          '<div class="avz-tipo-chips" role="radiogroup" aria-label="Tipo de aviso">' + tipoChips + '</div>' +
        '</div>' +
        '<div class="avz-field">' +
          '<label class="avz-field-label" for="avzFormTitulo">Título</label>' +
          '<input type="text" class="form-control" id="avzFormTitulo" maxlength="80" value="' + escapeAttr(b.titulo) + '" data-autofocus />' +
          (err.titulo ? '<div class="avz-field-error">' + err.titulo + '</div>' : '') +
        '</div>' +
        '<div class="avz-field">' +
          '<label class="avz-field-label" for="avzFormMensaje">Mensaje</label>' +
          '<textarea class="form-textarea" id="avzFormMensaje" rows="3">' + escapeHtml(b.mensaje) + '</textarea>' +
          (err.mensaje ? '<div class="avz-field-error">' + err.mensaje + '</div>' : '') +
        '</div>' +
        '<div class="avz-field">' +
          '<span class="avz-field-label">A quién le llega</span>' +
          '<div class="avz-radio-group" role="radiogroup" aria-label="Destinatarios">' + destRadios + '</div>' +
          destDetalle +
          (err.destinatarios ? '<div class="avz-field-error">' + err.destinatarios + '</div>' : '') +
        '</div>' +
        (mostrarFecha ? (
          '<div class="avz-field-row">' +
            '<div class="avz-field"><label class="avz-field-label" for="avzFormDesde">Desde</label>' +
              '<input type="date" class="form-control" id="avzFormDesde" value="' + escapeAttr(b.fechaDesde) + '" /></div>' +
            '<div class="avz-field"><label class="avz-field-label" for="avzFormHasta">Hasta</label>' +
              '<input type="date" class="form-control" id="avzFormHasta" value="' + escapeAttr(b.fechaHasta) + '" /></div>' +
          '</div>' +
          (err.fecha ? '<div class="avz-field-error">' + err.fecha + '</div>' : '')
        ) : '') +
        '<button class="avz-mas-opciones-btn" type="button" id="avzFormMasOpciones" aria-expanded="' + state.panel.masOpcionesAbiertas + '" aria-controls="avzFormMasOpcionesBody">' +
          (state.panel.masOpcionesAbiertas ? '▾' : '▸') + ' Más opciones' +
        '</button>' +
        (state.panel.masOpcionesAbiertas ? (
          '<div class="avz-mas-opciones-body" id="avzFormMasOpcionesBody">' +
            '<div class="avz-field">' +
              '<span class="avz-field-label">Prioridad</span>' +
              '<label class="avz-radio-row"><input type="radio" name="avzPrioridad" value="normal"' + (b.prioridad === 'normal' ? ' checked' : '') + ' /> Normal</label>' +
              '<label class="avz-radio-row"><input type="radio" name="avzPrioridad" value="urgente"' + (b.prioridad === 'urgente' ? ' checked' : '') + ' /> Urgente</label>' +
            '</div>' +
            '<div class="avz-field">' +
              '<span class="avz-field-label">Canales</span>' +
              canalCheckbox('calendario', 'Calendario', b) +
              canalCheckbox('banner', 'Novedades', b) +
              canalCheckbox('email', 'Email a sucursal', b) +
              canalCheckbox('whatsapp', 'WhatsApp', b) +
            '</div>' +
          '</div>'
        ) : '') +
        '<div class="avz-preview-box"><strong>Vista previa:</strong> <span id="avzPreviewTexto">' + escapeHtml(textoVistaPrevia(b)) + '</span></div>' +
        (errorGeneral ? '<div class="avz-field-error" id="avzFormErrorGeneral" style="margin-top:8px">' + escapeHtml(errorGeneral) + '</div>' : '') +
      '</div>' +
      '<div class="avz-panel-footer">' +
        '<button class="btn btn-outline" id="avzFormCancelar" type="button"' + (state.panel.guardando ? ' disabled' : '') + '>Cancelar</button>' +
        '<button class="btn btn-primary" id="avzFormPublicar" type="button"' + (val.valido && !state.panel.guardando ? '' : ' disabled') + '>' +
          (state.panel.guardando ? 'Guardando…' : (esEdicion ? 'Guardar cambios' : 'Publicar aviso')) +
        '</button>' +
      '</div>';
  }

  function canalCheckbox(clave, label, b) {
    return '<label class="avz-check-row"><input type="checkbox" class="avz-form-canal" data-canal="' + clave + '"' + (b.canales[clave] ? ' checked' : '') + ' /> ' + label + '</label>';
  }

  function wirePanelForm() {
    const b = state.panel.borrador;
    const panel = document.getElementById('avzPanel');

    function marcarDirty() { state.panel.dirty = JSON.stringify(b) !== state.panel.original; }
    function refrescarLigero() {
      const val = validarBorradorForm(b);
      const btn = document.getElementById('avzFormPublicar');
      if (btn) btn.disabled = !val.valido;
      const prev = document.getElementById('avzPreviewTexto');
      if (prev) prev.textContent = textoVistaPrevia(b);
    }

    panel.querySelectorAll('[data-tipo]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        const nuevoTipo = chip.dataset.tipo;
        if (nuevoTipo === b.tipo) return;
        const def = DEFAULTS_POR_TIPO[nuevoTipo];
        if (b.titulo.trim() === '' || b.titulo === 'LOCAL CERRADO') {
          b.titulo = nuevoTipo === 'local_cerrado' ? 'LOCAL CERRADO' : '';
        }
        b.tipo = nuevoTipo;
        b.canales = Object.assign({}, def.canales);
        b.prioridad = def.prioridad;
        b.destinatarios = clonarDestinatarios(def.destinatarios);
        marcarDirty();
        montarPanel();
      });
    });

    const inpTitulo = document.getElementById('avzFormTitulo');
    if (inpTitulo) inpTitulo.addEventListener('input', function () {
      b.titulo = inpTitulo.value;
      marcarDirty();
      refrescarLigero();
    });
    const inpMensaje = document.getElementById('avzFormMensaje');
    if (inpMensaje) inpMensaje.addEventListener('input', function () {
      b.mensaje = inpMensaje.value;
      marcarDirty();
      refrescarLigero();
    });

    panel.querySelectorAll('input[name="avzDest"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (radio.value === 'sucursal') b.destinatarios = { modo: 'sucursal', ids: [] };
        else if (radio.value === 'empleado') b.destinatarios = { modo: 'empleado', nombres: [], sucursalId: '' };
        else if (radio.value === 'administracion') b.destinatarios = { modo: 'administracion' };
        else b.destinatarios = { modo: 'todos' };
        marcarDirty();
        montarPanel();
      });
    });
    panel.querySelectorAll('.avz-form-suc').forEach(function (cb) {
      cb.addEventListener('change', function () {
        const ids = b.destinatarios.ids;
        const idx = ids.indexOf(cb.value);
        if (cb.checked && idx === -1) ids.push(cb.value);
        else if (!cb.checked && idx !== -1) ids.splice(idx, 1);
        marcarDirty();
        montarPanel();
      });
    });
    const btnSucTodas = document.getElementById('avzFormSucTodas');
    if (btnSucTodas) btnSucTodas.addEventListener('click', function () {
      const todasIds = SUCURSALES_SELECCIONABLES.map(function (s) { return s.id; });
      const todasMarcadas = todasIds.every(function (id) { return b.destinatarios.ids.indexOf(id) !== -1; });
      b.destinatarios.ids = todasMarcadas ? [] : todasIds.slice();
      marcarDirty();
      montarPanel();
    });
    panel.querySelectorAll('.avz-form-emp').forEach(function (cb) {
      cb.addEventListener('change', function () {
        const nombres = b.destinatarios.nombres;
        const idx = nombres.indexOf(cb.value);
        if (cb.checked && idx === -1) nombres.push(cb.value);
        else if (!cb.checked && idx !== -1) nombres.splice(idx, 1);
        const emp = empleadosMock().find(function (e) { return e.nombre === cb.value; });
        if (cb.checked && emp) b.destinatarios.sucursalId = emp.sucursalId;
        marcarDirty();
        montarPanel();
      });
    });

    const desde = document.getElementById('avzFormDesde');
    const hasta = document.getElementById('avzFormHasta');
    if (desde) desde.addEventListener('input', function () {
      b.fechaDesde = desde.value;
      if (hasta && hasta.value < desde.value) hasta.value = desde.value;
      if (hasta) b.fechaHasta = hasta.value;
      marcarDirty();
      refrescarLigero();
    });
    if (hasta) hasta.addEventListener('input', function () {
      b.fechaHasta = hasta.value;
      marcarDirty();
      refrescarLigero();
    });

    const btnMas = document.getElementById('avzFormMasOpciones');
    if (btnMas) btnMas.addEventListener('click', function () {
      state.panel.masOpcionesAbiertas = !state.panel.masOpcionesAbiertas;
      montarPanel();
    });
    panel.querySelectorAll('input[name="avzPrioridad"]').forEach(function (radio) {
      radio.addEventListener('change', function () { b.prioridad = radio.value; marcarDirty(); });
    });
    panel.querySelectorAll('.avz-form-canal').forEach(function (cb) {
      cb.addEventListener('change', function () {
        b.canales[cb.dataset.canal] = cb.checked;
        marcarDirty();
        refrescarLigero();
      });
    });

    const btnCancelar = document.getElementById('avzFormCancelar');
    if (btnCancelar) btnCancelar.addEventListener('click', function () {
      if (state.panel.guardando) return;
      cerrarPanel();
    });
    const btnPublicar = document.getElementById('avzFormPublicar');
    if (btnPublicar) btnPublicar.addEventListener('click', function () {
      if (state.panel.guardando) return; // doble submit
      state.panel.intentoPublicar = true;
      const val = validarBorradorForm(b);
      if (!val.valido) { montarPanel(); return; }
      const esEdicion = !!state.panel.avisoId;
      const datos = {
        tipo: b.tipo, titulo: b.titulo.trim(), mensaje: b.mensaje.trim(),
        fechaDesde: b.fechaDesde, fechaHasta: b.fechaHasta || b.fechaDesde,
        destinatarios: clonarDestinatarios(b.destinatarios),
        canales: Object.assign({}, b.canales),
        prioridad: b.prioridad,
      };
      state.panel.guardando = true;
      state.panel.errorGuardado = null;
      montarPanel();

      const promesa = esEdicion
        ? window.CromaAvisosRepository.editar(state.panel.avisoId, datos, obtenerAviso(state.panel.avisoId))
        : window.CromaAvisosRepository.crear(datos);

      promesa.then(function (resultado) {
        if (!state.panel.abierto) return; // el panel ya se cerró (no debería pasar, pero por las dudas)
        state.panel.guardando = false;
        if (resultado.ok) {
          aplicarAvisoEnMemoria(resultado.aviso);
          cerrarPanel(true);
          showToast(esEdicion ? 'Aviso actualizado.' : 'Aviso publicado.');
        } else {
          state.panel.errorGuardado = { mensaje: resultado.error, errores: resultado.errores };
          montarPanel();
        }
      });
    });
  }

  // ── Integración con la navegación existente ───────────
  function activar() {
    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
    document.querySelectorAll('.nav-btn, .drawer-nav-btn').forEach(function (b) { b.classList.remove('active'); });
    const view = document.getElementById('viewAvisos');
    if (view) view.classList.add('active');
    const btnTop = document.getElementById('avzNavBtn');
    const btnDrawer = document.getElementById('avzDrawerNavBtn');
    if (btnTop) btnTop.classList.add('active');
    if (btnDrawer) btnDrawer.classList.add('active');
    const controlsBar = document.querySelector('.controls-bar');
    if (controlsBar) controlsBar.style.display = 'none';
    const statsRow = document.querySelector('.stats-row');
    if (statsRow) statsRow.style.display = 'none';
    localStorage.setItem('croma_vista', 'avisos');

    render();
    if (state.carga.estado === 'idle') cargarAvisosIniciales();
    // En paralelo, sin dependencia entre ambas — Vacaciones no espera a
    // que AVISOS termine de cargar, ni viceversa.
    if (state.cargaVacaciones.estado === 'idle') cargarVacacionesIniciales();

    const drawerOverlay = document.getElementById('drawerOverlay');
    const drawerMenu = document.getElementById('drawerMenu');
    if (drawerOverlay) drawerOverlay.classList.remove('open');
    if (drawerMenu) drawerMenu.classList.remove('open');
  }

  function sincronizarVisibilidadAdmin() {
    const ref = document.getElementById('navBtnAdmin');
    const btnTop = document.getElementById('avzNavBtn');
    const btnDrawer = document.getElementById('avzDrawerNavBtn');
    if (!ref) return;
    const visible = ref.style.display !== 'none';
    if (btnTop) btnTop.style.display = visible ? '' : 'none';
    if (btnDrawer) btnDrawer.style.display = visible ? '' : 'none';
  }

  // El badge "Beta" ya existe en el HTML estático (index.html) — acá solo
  // se le agrega el sufijo "· Mock" cuando corresponde, sin tocar el markup
  // original ni agregar ningún elemento nuevo.
  function marcarBadgeSiEsMock() {
    if (!window.CromaAvisosConfig || window.CromaAvisosConfig.modo !== 'mock') return;
    document.querySelectorAll('.avz-beta-badge').forEach(function (el) {
      if (el.textContent.indexOf('Mock') === -1) el.textContent = el.textContent.trim() + ' · Mock';
    });
  }

  function init() {
    if (inicializado) return;
    inicializado = true;
    marcarBadgeSiEsMock();
    const btnTop = document.getElementById('avzNavBtn');
    const btnDrawer = document.getElementById('avzDrawerNavBtn');
    if (btnTop) btnTop.addEventListener('click', activar);
    if (btnDrawer) btnDrawer.addEventListener('click', activar);

    const ref = document.getElementById('navBtnAdmin');
    if (ref) {
      new MutationObserver(sincronizarVisibilidadAdmin)
        .observe(ref, { attributes: true, attributeFilter: ['style'] });
    }
    sincronizarVisibilidadAdmin();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Herramienta de debugging (Fase 3B.1): vuelve a pedir la carga inicial
  // al repository activo sin recargar la página. No agrega ningún botón ni
  // cambia la UX — es exclusivamente para invocar desde la consola.
  function reload() {
    state.carga.estado = 'idle';
    cargarAvisosIniciales();
  }

  // Herramienta de debugging (Fase 3B.2) — solo consola, sin UI. Muestra
  // el estado interno relevante para diagnosticar sin tener que inspeccionar
  // el closure a mano.
  function debug() {
    const info = {
      repository: window.CromaAvisosRepository === window.CromaAvisosRepository
        ? (window.CromaAvisosConfig && window.CromaAvisosConfig.modo === 'mock' ? 'MockRepository' : 'ApiRepository')
        : 'desconocido',
      modo: window.CromaAvisosConfig ? window.CromaAvisosConfig.modo : 'desconocido',
      estadoCarga: state.carga.estado,
      cantidadAvisos: state.avisos.length,
      ultimaCarga: state.carga.ultimaCarga ? state.carga.ultimaCarga.toISOString() : null,
      panelAbierto: state.panel.abierto,
      panelGuardando: state.panel.guardando,
      sucursalActual: state.sucursal,
      vistaActual: state.vista,
      cantidadVacaciones: state.vacaciones.length,
      estadoCargaVacaciones: state.cargaVacaciones.estado,
    };
    console.table ? console.table(info) : console.log(info);
    return info;
  }

  // Exposición mínima para integración/debug — el resto queda privado.
  window.CromaAvisos = { activar: activar, reload: reload, debug: debug };
})();
