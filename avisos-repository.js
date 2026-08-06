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

  // ── MockRepository — mismo dataset y comportamiento que Fase 1/2 ─────
  const MockRepository = {
    listar: function () {
      return Promise.resolve({ ok: true, avisos: (window.CROMA_AVISOS_MOCK || []).map(clonarAviso) });
    },
  };

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
    const token = typeof _getToken === 'function' ? _getToken() : null;
    if (token) headers['Authorization'] = 'Bearer ' + token;
    let resp;
    try {
      resp = await fetch((typeof BACKEND_URL !== 'undefined' ? BACKEND_URL : '') + '/api/avisos' + path,
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
      return { ok: false, status: resp.status, error: (data && data.error) || 'Respuesta inválida del servidor.' };
    }
    return data;
  }

  const ApiRepository = {
    listar: async function () {
      const data = await fetchAvisosApi('', { method: 'GET' });
      if (!data.ok) return data;
      return { ok: true, avisos: data.avisos || [] };
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
