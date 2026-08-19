// =====================================================
//  AVISOS · Transición Legacy → AVISOS — Etapa 2
//  AvisosStrategy — segunda implementación del contrato del Provider.
//  Lee EXCLUSIVAMENTE GET /api/avisos/mios (lectura segura por identidad
//  de JWT, ver src/routes/avisos-mios.js en croma-backend) — nunca
//  GET /api/avisos (gestión, admin/jefe únicamente, 403 para empleado).
//
//  A diferencia de LegacyStrategy, acá no hace falta resolver
//  destinatarios/sucursal en el cliente: el backend ya devuelve
//  únicamente los avisos visibles para el usuario autenticado (Node
//  resuelve identidad desde el JWT, GAS filtra contra USUARIOS/EMPLEADOS
//  o contra los claims de admin/jefe, según corresponda — ver Code-
//  Jornada.js, accionGetAvisosVisiblesUsuario). Este archivo confía en
//  ese filtrado y solo normaliza al formato del contrato.
//
//  ESTADO DE LEÍDOS (Etapa "Leídos" — cierra lo que Etapa 2 dejó
//  provisional): banner:true ahora usa el `leido` real que ya resuelve
//  GET /api/avisos/mios server-side (GAS, contra la hoja AVISOS_LEIDOS —
//  ver accionGetAvisosVisiblesUsuario). banner:false sigue siendo
//  leido:null, sin cambios. marcarLeido() hace el POST real contra
//  /api/avisos/mios/:id/marcar-leido. Cumple el contrato v1.1 completo,
//  sin ninguna divergencia pendiente.
// =====================================================

(function () {
  'use strict';

  function _ahora() {
    return (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
  }

  // Misma regla de estado que LegacyStrategy (fecha_desde/fecha_hasta vs.
  // hoy) — duplicada a propósito: es una regla genérica de calendario, no
  // específica de ninguna fuente, y ambos archivos deben poder leerse de
  // forma independiente sin que uno dependa del otro.
  function _hoyISO() {
    return new Date().toISOString().slice(0, 10);
  }
  function _calcularEstado(fechaDesde, fechaHasta) {
    const hoy = _hoyISO();
    if (fechaDesde && fechaDesde > hoy) return 'futuro';
    if (fechaHasta && fechaHasta < hoy) return 'vencido';
    return 'vigente';
  }
  function _dentroDeRango(item, rango) {
    if (!rango || (!rango.desde && !rango.hasta)) return true;
    const desde = rango.desde || '0000-01-01';
    const hasta = rango.hasta || '9999-12-31';
    const itemHasta = item.fechaHasta || item.fechaDesde;
    return item.fechaDesde <= hasta && itemHasta >= desde;
  }

  function adaptarAviso(crudo) {
    const fechaDesde = crudo.fecha_desde || '';
    const fechaHasta = crudo.fecha_hasta || fechaDesde;
    const banner = !!(crudo.canales && crudo.canales.banner === true);
    return {
      id: crudo.id,
      titulo: crudo.titulo || '',
      mensaje: crudo.mensaje || '',
      tipo: crudo.tipo,
      fechaDesde: fechaDesde,
      fechaHasta: fechaHasta,
      // Ya resuelto por el backend antes de llegar acá — este endpoint
      // nunca devuelve un aviso que no le corresponda al consultante.
      aplicaAlConsultante: true,
      superficies: {
        calendario: !!(crudo.canales && crudo.canales.calendario === true),
        banner: banner,
      },
      estado: _calcularEstado(fechaDesde, fechaHasta),
      // Etapa "Leídos": crudo.leido ya viene resuelto server-side (GAS,
      // contra AVISOS_LEIDOS) para TODO aviso, sin importar canal — es
      // este adaptador quien aplica la regla del contrato v1.1: solo
      // banner:true tiene un leído real, el resto es null ("no aplica").
      // Ya no es provisional — cumple el contrato completo.
      leido: banner ? (crudo.leido === true) : null,
      // Contrato v1.2: AVISOS sí tiene fecha+hora real de creación.
      fechaPublicacion: crudo.fecha_creacion || null,
      // Contrato v1.3 (fechaHastaExplicita) — LIMITACIÓN REAL, no
      // heurística inventada: tanto el POST de croma-backend
      // (routes/avisos.js: `fecha_hasta: req.body.fecha_hasta ||
      // req.body.fecha_desde || ''`) como accionGuardarAviso en GAS
      // colapsan "sin fecha_hasta" contra fecha_desde ANTES de guardar —
      // para cuando este adaptador lee el aviso, el dato de si el admin
      // cargó una fecha_hasta explícita ya se perdió, no existe forma de
      // recuperarlo desde acá. false es el valor conservador (nunca
      // muestra "hasta" de más), no una inferencia real. No bloquea esta
      // etapa (AvisosStrategy no alimenta Novedades mientras
      // Strategy activa = legacy) — a resolver en el backend de AVISOS
      // el día que una superficie real dependa de este campo para AVISOS.
      fechaHastaExplicita: false,
    };
  }

  function _apiUrl() {
    const base = window.CromaSesion ? window.CromaSesion.BACKEND_URL : '';
    return base + '/api/avisos/mios';
  }

  function _token() {
    return window.CromaSesion ? window.CromaSesion.obtenerToken() : null;
  }

  async function _fetchMisAvisos() {
    const token = _token();
    let resp;
    try {
      resp = await fetch(_apiUrl(), {
        headers: token ? { Authorization: 'Bearer ' + token } : {},
      });
    } catch (e) {
      return { ok: false, error: 'No pudimos conectarnos a AVISOS.' };
    }
    let data = null;
    try { data = await resp.json(); } catch (e) {}
    if (!resp.ok || !data || data.ok !== true) {
      return { ok: false, error: (data && data.error) || 'Respuesta inválida de AVISOS.' };
    }
    return data;
  }

  const AvisosStrategy = {
    consultar: async function (entrada) {
      const resp = await _fetchMisAvisos();
      if (!resp.ok) return { ok: false, error: resp.error };

      const tNormInicio = _ahora();
      let items = (resp.avisos || []).map(adaptarAviso);
      if (entrada.rango) items = items.filter(function (item) { return _dentroDeRango(item, entrada.rango); });
      const tNormFin = _ahora();

      return { ok: true, items: items, _tiempoNormalizacionMs: tNormFin - tNormInicio };
    },

    // Etapa "Leídos": POST real contra el backend seguro. `empleado` (1er
    // parámetro de la interfaz común del Provider) no se usa acá —la
    // identidad la resuelve el backend desde el JWT, nunca desde acá— se
    // mantiene solo para cumplir la misma firma que LegacyStrategy.
    marcarLeido: async function (empleado, itemId) {
      const token = _token();
      let resp;
      try {
        resp = await fetch(_apiUrl() + '/' + encodeURIComponent(itemId) + '/marcar-leido', {
          method: 'POST',
          headers: token ? { Authorization: 'Bearer ' + token } : {},
        });
      } catch (e) {
        return { ok: false, error: 'No pudimos conectarnos a AVISOS.' };
      }
      let data = null;
      try { data = await resp.json(); } catch (e) {}
      if (!resp.ok || !data || data.ok !== true) {
        return { ok: false, error: (data && data.error) || 'No se pudo marcar como leído.' };
      }
      return { ok: true };
    },
    // contarNoLeidos: no forma parte del alcance de esta etapa (Campana
    // sigue calculando su propio conteo, ver actualizarBadgeAnunciosEmp en
    // app.js) — se deja explícitamente no disponible, sin simular éxito.
    contarNoLeidos: async function () {
      return { ok: false, error: 'No disponible todavía.' };
    },

    // Uso exclusivo del Provider Sandbox.
    _crudo: async function () {
      return { avisosMios: await _fetchMisAvisos() };
    },
  };

  if (window.CromaAvisosProvider && typeof window.CromaAvisosProvider.registrarStrategy === 'function') {
    window.CromaAvisosProvider.registrarStrategy('avisos', AvisosStrategy);
  }
})();
