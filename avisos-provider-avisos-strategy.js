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
//  ESTADO DE LEÍDOS (Etapa 2, provisional — documentado, no silencioso):
//  Por contrato v1.1, banner:false → leido:null (correcto y definitivo).
//  Para banner:true, el contrato exige true/false real, pero AVISOS
//  todavía no tiene mecanismo de lectura implementado (eso es Etapa 3).
//  Esta Strategy devuelve leido:null también para banner:true en esta
//  etapa — una aproximación provisional que diverge de la letra estricta
//  del contrato, aceptada porque el alcance de Etapa 2 (Mi Semana +
//  Local Cerrado) nunca consume items con banner:true. Debe resolverse
//  antes de que Etapa 3 conecte Banner/Novedades/Campana sobre AVISOS.
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
        banner: !!(crudo.canales && crudo.canales.banner === true),
      },
      estado: _calcularEstado(fechaDesde, fechaHasta),
      leido: null, // ver nota de cabecera — provisional para banner:true
    };
  }

  function _apiUrl() {
    const base = (typeof BACKEND_URL !== 'undefined') ? BACKEND_URL : '';
    return base + '/api/avisos/mios';
  }

  async function _fetchMisAvisos() {
    const token = (typeof _getToken === 'function') ? _getToken() : null;
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

    // Leídos real de AVISOS es Etapa 3 — acá se declara explícitamente no
    // disponible en vez de simular un éxito que no hace nada.
    marcarLeido: async function () {
      return { ok: false, error: 'No disponible todavía — leídos de AVISOS es Etapa 3.' };
    },
    contarNoLeidos: async function () {
      return { ok: false, error: 'No disponible todavía — leídos de AVISOS es Etapa 3.' };
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
