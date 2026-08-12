// =====================================================
//  AVISOS · Transición Legacy → AVISOS — Etapa 1
//  LegacyStrategy — primera implementación real del contrato del
//  Provider (ver ADR-CONTRATO-PROVIDER). Lee EVENTOS + ANUNCIOS
//  (las mismas dos fuentes y los mismos endpoints que hoy consumen
//  cargarEventosEmpleado()/verificarAnunciosEmpleado() en app.js) y
//  normaliza el resultado al formato único del contrato.
//
//  EXCEPCIÓN DOCUMENTADA A "EVITAR DUPLICAR LÓGICA" (ajuste aprobado
//  antes de esta implementación):
//  La resolución de DESTINATARIOS y el cálculo de vigencia de
//  ANUNCIOS están duplicados acá en vez de extraídos como helper
//  compartido con app.js, por dos motivos, no por comodidad:
//    1. Extraer esa lógica de app.js implicaría MODIFICAR app.js
//       (cambiar sus funciones para llamar a un helper externo), y
//       esta etapa tiene prohibido tocar pantallas/consumidores reales
//       — el riesgo de producción de tocar el archivo que hoy sirve al
//       empleado real es mayor que el costo de esta duplicación
//       puntual. La extracción real queda para cuando app.js se toque
//       de todas formas (Etapas 2-3, al reemplazar estos mismos
//       consumidores).
//    2. La resolución de destinatarios que vive en Code-Jornada.js
//       (GAS) no es extraíble hacia acá: es otro runtime, desplegado
//       aparte (Apps Script vs. navegador), sin mecanismo de módulos
//       compartido entre ambos.
//  La lógica de acá replica fielmente el comportamiento ya relevado en
//  el diagnóstico (formatos de destinatarios, cálculo de vigencia de
//  anuncios) — no lo reinterpreta ni lo "mejora".
// =====================================================

(function () {
  'use strict';

  function _ahora() {
    return (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
  }

  function _apiUrl(accion, params) {
    const base = (typeof APPS_SCRIPT_URL !== 'undefined') ? APPS_SCRIPT_URL : '';
    // _ts: evita que el navegador reproduzca una 302 de GAS vieja cacheada
    // (script.google.com → googleusercontent.com/macros/echo?...&lib=…) de
    // un momento en que GAS estaba caído — ver misma nota en app.js/vacApiUrl.
    let url = base + '?accion=' + accion + '&_ts=' + Date.now();
    if (params) {
      Object.entries(params).forEach(function (kv) {
        if (kv[1] !== undefined && kv[1] !== null) url += '&' + kv[0] + '=' + encodeURIComponent(kv[1]);
      });
    }
    return url;
  }

  async function _fetchJson(url) {
    let resp;
    try {
      resp = await fetch(url, { cache: 'no-store' });
    } catch (e) {
      return { ok: false, error: 'No pudimos conectarnos a la fuente legacy.' };
    }
    let data = null;
    try { data = await resp.json(); } catch (e) {}
    if (!resp.ok || !data) {
      return { ok: false, error: 'Respuesta inválida de la fuente legacy.' };
    }
    return data;
  }

  // ── Helpers — destinatarios (replica de la lógica ya relevada en el
  //    diagnóstico, ver Code-Jornada.js/app.js) ───────────────────────

  // EVENTOS: 'todos' | 'personal' | 'suc_XX' | '["suc_.."...]' | '["Nombre",...]'
  function _eventoAplica(destinatariosStr, empleado, sucursalId) {
    if (destinatariosStr === 'todos') return true;
    if (destinatariosStr === 'personal') return false; // nunca visible para empleados
    if (destinatariosStr.indexOf('suc_') === 0) {
      return destinatariosStr === 'suc_' + sucursalId;
    }
    try {
      const lista = JSON.parse(destinatariosStr);
      if (!Array.isArray(lista)) return false;
      if (lista.length && String(lista[0]).indexOf('suc_') === 0) {
        return lista.indexOf('suc_' + sucursalId) !== -1;
      }
      return lista.some(function (n) { return String(n).toLowerCase() === String(empleado).toLowerCase(); });
    } catch (e) {
      return false;
    }
  }

  // ANUNCIOS: 'todos' | '["Nombre",...]' | (soporte legado, nunca escrito
  // por la UI actual pero sí leído por getAnuncios) 'suc_XX' / array suc_.
  //
  // Detección de "es un array de sucursales" replicada EXACTAMENTE como
  // hace hoy verificarAnunciosEmpleado() en app.js: `lista[0].startsWith
  // ('suc_')`, case-SENSIBLE. Encontrado en QA de la Etapa 3.1: esta
  // Strategy tenía antes `.toLowerCase()` en esa detección, lo cual la
  // volvía más permisiva que el legacy real (ej. ["SUC_09"] pasaba acá
  // pero no en app.js). Corregido para ser una réplica fiel, no una
  // versión mejorada — un array como ["SUC_09"] cae al branch de
  // nombres de empleado (igual que en app.js) y no matchea a nadie. La
  // comparación DENTRO del branch de sucursales sigue siendo
  // case-insensible porque así es como ya la hace app.js una vez que
  // detecta el array (ver comentario "Comparación case-insensitive
  // como fallback" en la función original).
  function _anuncioAplica(destinatariosStr, empleado, sucursalId) {
    if (destinatariosStr === 'todos') return true;
    if (destinatariosStr.toLowerCase() === ('suc_' + sucursalId).toLowerCase()) return true;
    try {
      const lista = JSON.parse(destinatariosStr);
      if (!Array.isArray(lista)) return false;
      if (lista.length && String(lista[0]).indexOf('suc_') === 0) {
        return lista.some(function (s) { return String(s).toLowerCase() === ('suc_' + sucursalId).toLowerCase(); });
      }
      return lista.some(function (n) { return String(n).toLowerCase() === String(empleado).toLowerCase(); });
    } catch (e) {
      return String(destinatariosStr).toLowerCase() === String(empleado).toLowerCase();
    }
  }

  // ── Helpers — vigencia ──────────────────────────────────────────────

  function _hoyISO() {
    return new Date().toISOString().slice(0, 10);
  }

  // Replica anuncioVencido() de app.js: vigencia explícita si existe;
  // si no, caduca a los 30 días de la fecha de creación.
  function _anuncioFechaHasta(anuncio) {
    if (anuncio.vigencia) return anuncio.vigencia;
    if (anuncio.fecha) {
      const fechaCreacion = String(anuncio.fecha).substring(0, 10);
      const partes = fechaCreacion.split('-').map(Number);
      const d = new Date(partes[0], partes[1] - 1, partes[2]);
      d.setDate(d.getDate() + 30);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    return '';
  }

  function _calcularEstado(fechaDesde, fechaHasta) {
    const hoy = _hoyISO();
    if (fechaDesde && fechaDesde > hoy) return 'futuro';
    if (fechaHasta && fechaHasta < hoy) return 'vencido';
    return 'vigente';
  }

  // ── Adaptadores — crudo de cada fuente → item normalizado del contrato ─

  // NOTA sobre `tipo`: EVENTOS nunca tuvo en la práctica un valor
  // explícito 'evento' (el diagnóstico confirmó que el campo TIPO real
  // solo toma 'local_cerrado' o '' vacío). Mapear '' → 'evento' es una
  // decisión provisional de esta Strategy para poder cumplir el
  // contrato (que exige un tipo válido) — corresponde a la Decisión #1
  // todavía pendiente del diagnóstico. No hay datos reales de
  // producción hoy con tipo vacío, así que esto no tiene efecto visible
  // en la Validación real de esta etapa, pero queda documentado acá
  // para no perderlo de vista.
  function adaptarEvento(crudo, empleado, sucursalId) {
    const tipo = crudo.tipo === 'local_cerrado' ? 'local_cerrado' : 'evento';
    const fechaDesde = crudo.fecha || '';
    const fechaHasta = crudo.fecha_fin || fechaDesde;
    // Contrato v1.3 (fechaHastaExplicita): GAS (getEventos) ya resuelve el
    // fallback `fecha_fin: fechaFinVal || fechaVal` ANTES de que el crudo
    // llegue acá — para cuando este adaptador lo ve, ya no puede distinguir
    // con certeza "FECHA_FIN se cargó igual a FECHA a propósito" de
    // "FECHA_FIN estaba vacía y cayó al fallback". Mejor esfuerzo posible
    // sin ese dato: si difieren, es inequívocamente explícita; si son
    // iguales, se trata como no-explícita (mismo criterio conservador que
    // ya se usó para no inventar "· hasta" de más en Novedades). No afecta
    // hoy a Novedades (solo consume ANUNCIOS), documentado para cuando
    // Mi Semana/AVISOS calendario lo necesiten.
    const fechaHastaExplicita = !!(crudo.fecha_fin && crudo.fecha_fin !== fechaDesde);
    return {
      id: crudo.id,
      titulo: crudo.titulo || '',
      mensaje: crudo.descripcion || '',
      tipo: tipo,
      fechaDesde: fechaDesde,
      fechaHasta: fechaHasta,
      aplicaAlConsultante: _eventoAplica(crudo.destinatarios || 'todos', empleado, sucursalId),
      superficies: { calendario: true, banner: false },
      estado: _calcularEstado(fechaDesde, fechaHasta),
      // Contrato v1.1 (ADR-CONTRATO-PROVIDER): leido solo es aplicable a
      // items con superficies.banner=true. EVENTOS nunca participa de esa
      // superficie, así que acá es siempre null — "no aplica", no una
      // afirmación de que fue leído.
      leido: null,
      // Contrato v1.2: EVENTOS no tiene un datetime de publicación
      // distinto de su propia fecha (que ya es solo fecha, sin hora) —
      // null es correcto acá, no una omisión.
      fechaPublicacion: null,
      fechaHastaExplicita: fechaHastaExplicita,
    };
  }

  function adaptarAnuncio(crudo, empleado, sucursalId) {
    const fechaDesde = (crudo.fecha || '').substring(0, 10);
    const fechaHasta = _anuncioFechaHasta(crudo);
    return {
      id: crudo.id,
      titulo: crudo.titulo || '',
      mensaje: crudo.mensaje || '',
      tipo: 'informacion',
      fechaDesde: fechaDesde,
      fechaHasta: fechaHasta,
      aplicaAlConsultante: _anuncioAplica(crudo.destinatarios || 'todos', empleado, sucursalId),
      superficies: { calendario: false, banner: true },
      estado: _calcularEstado(fechaDesde, fechaHasta),
      leido: _estaLeido(crudo.id),
      // Contrato v1.2: ANUNCIOS sí tiene fecha+hora real de publicación
      // (crudo.fecha, sin truncar) — es exactamente lo que el Banner
      // legacy mostraba antes de la Etapa 3.1.
      fechaPublicacion: crudo.fecha || null,
      // Contrato v1.3: acá SÍ se puede distinguir con precisión — crudo.
      // vigencia es el campo crudo de la hoja (vacío si el admin no la
      // definió). true solo si vino con valor explícito; false si
      // fechaHasta salió del fallback de 30 días (_anuncioFechaHasta).
      fechaHastaExplicita: !!crudo.vigencia,
    };
  }

  // ── Leídos — misma clave de localStorage que usa app.js hoy
  //    (croma_anuncios_leidos), leída directamente, sin depender del
  //    estado en memoria de ninguna pantalla (el Provider no conoce
  //    app.js). Ver invariantes del ADR: el estado de lectura es
  //    siempre consultable/modificable a través del Provider. ────────
  const LEIDOS_KEY = 'croma_anuncios_leidos';

  function _leerSetLeidos() {
    try {
      return new Set(JSON.parse(localStorage.getItem(LEIDOS_KEY) || '[]'));
    } catch (e) {
      return new Set();
    }
  }

  function _estaLeido(id) {
    return _leerSetLeidos().has(id);
  }

  function _marcarLeidoEnStorage(id) {
    const set = _leerSetLeidos();
    set.add(id);
    localStorage.setItem(LEIDOS_KEY, JSON.stringify(Array.from(set)));
  }

  // ── Filtro de ventana de interés (contrato de entrada, `rango`) ────
  function _dentroDeRango(item, rango) {
    if (!rango || (!rango.desde && !rango.hasta)) return true;
    const desde = rango.desde || '0000-01-01';
    const hasta = rango.hasta || '9999-12-31';
    const itemHasta = item.fechaHasta || item.fechaDesde;
    return item.fechaDesde <= hasta && itemHasta >= desde;
  }

  // ── LegacyStrategy ───────────────────────────────────────────────────

  const LegacyStrategy = {
    consultar: async function (entrada) {
      const empleado = entrada.empleado;
      const sucursalId = entrada.sucursalId || '';

      const [eventosResp, anunciosResp] = await Promise.all([
        _fetchJson(_apiUrl('get_eventos', { empleado: empleado })),
        _fetchJson(_apiUrl('get_anuncios', { empleado: empleado, sucursal: sucursalId })),
      ]);

      if (!eventosResp.ok) return { ok: false, error: eventosResp.error || 'Error al leer eventos.' };
      if (!anunciosResp.ok) return { ok: false, error: anunciosResp.error || 'Error al leer anuncios.' };

      const tNormInicio = _ahora();
      const itemsEventos = (eventosResp.eventos || [])
        .map(function (e) { return adaptarEvento(e, empleado, sucursalId); })
        .filter(function (item) { return item.aplicaAlConsultante; });

      const itemsAnuncios = (anunciosResp.anuncios || [])
        .map(function (a) { return adaptarAnuncio(a, empleado, sucursalId); })
        .filter(function (item) { return item.aplicaAlConsultante; });

      let items = itemsEventos.concat(itemsAnuncios);
      if (entrada.rango) items = items.filter(function (item) { return _dentroDeRango(item, entrada.rango); });
      const tNormFin = _ahora();

      return { ok: true, items: items, _tiempoNormalizacionMs: tNormFin - tNormInicio };
    },

    marcarLeido: async function (empleado, itemId) {
      _marcarLeidoEnStorage(itemId);
      return { ok: true };
    },

    contarNoLeidos: async function (entrada) {
      const resultado = await LegacyStrategy.consultar(entrada);
      if (!resultado.ok) return resultado;
      const noLeidos = resultado.items.filter(function (item) {
        return item.superficies.banner && item.estado === 'vigente' && !item.leido;
      });
      return { ok: true, cantidad: noLeidos.length };
    },

    // Uso exclusivo del Provider Sandbox (diagnóstico manual) — no es
    // parte del contrato ni se invoca desde el Provider en su flujo
    // normal.
    _crudo: async function (empleado, sucursalId) {
      const [eventosResp, anunciosResp] = await Promise.all([
        _fetchJson(_apiUrl('get_eventos', { empleado: empleado })),
        _fetchJson(_apiUrl('get_anuncios', { empleado: empleado, sucursal: sucursalId })),
      ]);
      return { eventos: eventosResp, anuncios: anunciosResp };
    },
  };

  if (window.CromaAvisosProvider && typeof window.CromaAvisosProvider.registrarStrategy === 'function') {
    window.CromaAvisosProvider.registrarStrategy('legacy', LegacyStrategy);
  }
})();
