// =====================================================
//  CROMA · JORNADA LABORAL — API web (horarios)
// =====================================================

// ── HELPER: FORMATEAR HORA ─────────────────────────────
// Maneja Date, string "9:00:00" y número decimal (fracción del día)
function formatearHora(valor) {
  if (!valor) return '';

  if (valor instanceof Date) {
    return valor.getHours().toString().padStart(2, '0') + ':' +
           valor.getMinutes().toString().padStart(2, '0');
  }

  if (typeof valor === 'string') {
    const p = valor.split(':');
    if (p.length >= 2) return p[0].padStart(2, '0') + ':' + p[1].padStart(2, '0');
  }

  if (typeof valor === 'number') {
    const tot = Math.round(valor * 24 * 60);
    return Math.floor(tot / 60).toString().padStart(2, '0') + ':' +
           (tot % 60).toString().padStart(2, '0');
  }

  return String(valor);
}

// =====================================================
//  API WEB — endpoints para croma-horarios (GitHub Pages)
// =====================================================

// ── doPost: recibe JSON del frontend (crearEvento) ────
function doPost(e) {
  try {
    const accion = (e.parameter && e.parameter.accion) || '';
    if (accion === 'crearEvento') {
      const datos = JSON.parse(e.postData.contents || '{}');
      const ss   = SpreadsheetApp.getActiveSpreadsheet();
      let hoja   = ss.getSheetByName('EVENTOS');
      if (!hoja) {
        hoja = ss.insertSheet('EVENTOS');
        hoja.getRange(1,1,1,8).setValues([['ID','TITULO','FECHA','FECHA_FIN','DESCRIPCION','DESTINATARIOS','AUTOR','TIPO']]);
      }
      if (!datos.titulo || !datos.fecha) throw new Error('Faltan datos obligatorios');
      const id       = 'EVT-' + Date.now();
      const destStr  = datos.destinatario || datos.destinatarios || 'todos';
      const fechaFin = datos.fecha_fin || datos.fecha;
      const tipoEvt  = datos.tipo || '';
      hoja.appendRow([id, datos.titulo, datos.fecha, fechaFin, datos.descripcion || '', destStr, 'Admin', tipoEvt]);
      // Enviar emails a sucursales
      try { enviarEmailsEvento(ss, datos.titulo, datos.fecha, fechaFin, datos.descripcion || '', destStr); } catch(mailErr) { Logger.log('Email error: ' + mailErr.message); }
      return ContentService.createTextOutput(JSON.stringify({ ok: true, id }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (accion === 'guardarFichada')  return guardarFichada(e);
    if (accion === 'acreditarBanco') return _accionRetirada(e, 'acreditarBanco', 'BANCO_HORAS');
    if (accion === 'usarBanco')      return _accionRetirada(e, 'usarBanco', 'BANCO_HORAS');
    if (accion === 'ajustar_jornada') return ajustarJornada(e);

    // ── Acciones administrativas nuevas (Node → GAS) ──
    // Estas nunca llegan con accion en la query string (a diferencia de
    // todas las de arriba) — viajan en un sobre JSON dentro del body:
    // { accion, clave_backend, datos }. Si no hay accion por query, se
    // intenta interpretar el body como ese sobre; si no lo es, se cae al
    // mismo error de siempre, sin afectar ninguna acción existente.
    if (!accion && e.postData && e.postData.contents) {
      let envelope = null;
      try { envelope = JSON.parse(e.postData.contents); } catch (parseErr) { envelope = null; }
      if (envelope && envelope.accion) return despacharAccionSegura(envelope);
    }

    return ContentService.createTextOutput(JSON.stringify({ error: 'Acción POST no reconocida' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── Helper: leer CONFIG como objeto ───────────────────
function getConfigObj(ss) {
  const hoja = ss.getSheetByName('CONFIG');
  if (!hoja) return {};
  const config = {};
  hoja.getDataRange().getValues().slice(1).forEach(function(r) {
    if (r[0]) config[String(r[0]).trim()] = String(r[1] || '').trim();
  });
  return config;
}

// ── Helper: formatear fecha ISO → dd/mm/yyyy ──────────
function fmtFecha(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[3] + '/' + m[2] + '/' + m[1] : String(iso);
}

// ── Enviar emails de evento a sucursales ──────────────
function enviarEmailsEvento(ss, titulo, fecha, fechaFin, descripcion, destinatarios) {
  const config = getConfigObj(ss);

  // Determinar qué sucursales notificar
  const sucursales = [
    { id: '01', nombre: '01 PASEO' }, { id: '05', nombre: '05 WAVE' },
    { id: '09', nombre: '09 CIPO' }, { id: '10', nombre: '10 PERITO MORENO' },
    { id: '12', nombre: '12 CENTENARIO' }, { id: '14', nombre: '14 ROCA' },
    { id: 'DEPO', nombre: 'DEPO' }, { id: 'OFICINA', nombre: 'OFICINA' },
  ];

  let sucANotificar = [];
  if (destinatarios === 'todos') {
    sucANotificar = sucursales;
  } else if (destinatarios === 'personal') {
    return; // evento personal, no se notifica
  } else if (destinatarios.startsWith('suc_')) {
    const id = destinatarios.replace('suc_', '');
    sucANotificar = sucursales.filter(function(s) { return s.id === id; });
  } else {
    try {
      const lista = JSON.parse(destinatarios);
      if (lista[0] && lista[0].startsWith('suc_')) {
        const ids = lista.map(function(x) { return x.replace('suc_', ''); });
        sucANotificar = sucursales.filter(function(s) { return ids.indexOf(s.id) >= 0; });
      }
      // Si es lista de empleados, no hay email de sucursal al que mandar
    } catch(e) {}
  }

  const fechaStr    = fmtFecha(fecha);
  const fechaFinStr = fechaFin && fechaFin !== fecha ? fmtFecha(fechaFin) : null;
  const rangoFechas = fechaFinStr ? fechaStr + ' al ' + fechaFinStr : fechaStr;

  // Emails a sucursales
  sucANotificar.forEach(function(suc) {
    const email = config['email_suc_' + suc.id] || '';
    if (!email) return;
    MailApp.sendEmail({
      to:       email,
      subject:  '📌 Nuevo evento: ' + titulo,
      htmlBody: buildEmailEvento({ titulo, rangoFechas, descripcion, destinatarioLabel: suc.nombre }),
    });
  });
}

// ── Template HTML del email de evento ────────────────
function buildEmailEvento({ titulo, rangoFechas, descripcion, destinatarioLabel, sucNombre }) {
  destinatarioLabel = destinatarioLabel || sucNombre || '';
  const descHtml = descripcion
    ? '<tr><td style="padding:0 36px 24px"><p style="margin:0;font-size:14px;color:#64748b;line-height:1.6">' + descripcion + '</p></td></tr>'
    : '';
  return '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
  '<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif">' +
  '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0"><tr><td align="center">' +
  '<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">' +

  // Header
  '<tr><td style="background:#0d0d0d;border-radius:12px 12px 0 0;padding:28px 36px">' +
  '<p style="margin:0;font-size:11px;font-weight:700;letter-spacing:2px;color:#94a3b8;text-transform:uppercase">Croma · ' + destinatarioLabel + '</p>' +
  '<h1 style="margin:8px 0 0;font-size:22px;font-weight:700;color:#ffffff">📌 ' + titulo + '</h1>' +
  '</td></tr>' +

  // Fecha
  '<tr><td style="background:#ffffff;padding:28px 36px 0">' +
  '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px">' +
  '<tr><td style="padding:16px 20px">' +
  '<p style="margin:0;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px">Fecha</p>' +
  '<p style="margin:6px 0 0;font-size:18px;font-weight:700;color:#0d0d0d">' + rangoFechas + '</p>' +
  '</td></tr>' +
  '</table>' +
  '</td></tr>' +

  // Descripción
  (descripcion
    ? '<tr><td style="background:#ffffff;padding:20px 36px 0"><p style="margin:0;font-size:14px;color:#475569;line-height:1.6">' + descripcion + '</p></td></tr>'
    : '') +

  // CTA
  '<tr><td style="background:#ffffff;padding:28px 36px">' +
  '<table cellpadding="0" cellspacing="0"><tr><td style="background:#0d0d0d;border-radius:8px">' +
  '<a href="https://depocroma-max.github.io/croma-horarios/" target="_blank" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none">Ver en la app →</a>' +
  '</td></tr></table>' +
  '</td></tr>' +

  // Footer
  '<tr><td style="background:#f8fafc;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:16px 36px">' +
  '<p style="margin:0;font-size:12px;color:#94a3b8">Croma Horarios · Sistema de gestión de personal</p>' +
  '</td></tr>' +

  '</table></td></tr></table></body></html>';
}

// Caché de lectura (Commit cache-GAS): colapsa ráfagas de pedidos
// simultáneos al mismo dato (ej. varios empleados abriendo la app a la
// vez) en UNA sola ejecución real de GAS — el resto de esa ventana se
// sirve desde CacheService, sin tocar Sheets. TTL corto (20s) a propósito:
// cualquier cambio (guardar_perfil, guardar_certificado, etc., que NO se
// tocan acá) se refleja solo en el próximo pedido después de que venza el
// caché, nunca al instante — tradeoff aceptado por ser casi imperceptible.
// CacheService tiene un límite de ~100KB por valor: si el JSON no entra,
// _cacheableTextOutput() simplemente no cachea ese pedido puntual (nunca
// rompe la respuesta real por un fallo de caché).
const CACHE_TTL_LECTURA_SEG = 20;

function _cacheableTextOutput(cacheKey, computeFn) {
  const cache = CacheService.getScriptCache();
  let cached;
  try { cached = cache.get(cacheKey); } catch (e) { cached = null; }
  if (cached) {
    return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
  }
  const output = computeFn();
  try {
    const content = output.getContent();
    if (content.length < 95000) cache.put(cacheKey, content, CACHE_TTL_LECTURA_SEG);
  } catch (e) { /* nunca romper la respuesta real por un fallo de caché */ }
  return output;
}

// Consolida las 4 llamadas que dispara el Portal Empleado al abrir (perfiles,
// certificados, vacaciones aprobadas, horarios propios) en un solo viaje —
// antes eran 4 ejecuciones de GAS separadas por cada apertura. Reusa las
// funciones existentes tal cual (parseando su JSON de vuelta) para no
// duplicar ninguna lógica ni tocar los otros consumidores de esas acciones.
//
// sin_horarios=1 (Fase 1B) / sin_perfiles=1 (Fase 2A) / sin_certificados=1
// (Fase 4A) / sin_vacaciones=1 (Fase 4B, todas en
// docs/PLAN-SHEETS-API-DIRECTA.md en este repo): variantes aditivas para
// el agregador de croma-backend — evitan ejecutar
// getHorarios()/getPerfiles()/getCertificados()/getSolicitudesVacaciones()
// acá cuando esas piezas ya se leen aparte, directo por Sheets API desde
// Node, para sacarlas de la cola de ejecuciones de GAS. Sin los
// parámetros, comportamiento y contrato 100% idénticos a antes — nadie
// más los manda.
function getDatosPortalEmpleado(e) {
  try {
    const sinHorarios     = String((e && e.parameter && e.parameter.sin_horarios) || '') === '1';
    const sinPerfiles     = String((e && e.parameter && e.parameter.sin_perfiles) || '') === '1';
    const sinCertificados = String((e && e.parameter && e.parameter.sin_certificados) || '') === '1';
    const sinVacaciones   = String((e && e.parameter && e.parameter.sin_vacaciones) || '') === '1';
    const perfiles     = sinPerfiles ? null : JSON.parse(getPerfiles().getContent());
    const certificados = sinCertificados ? null : JSON.parse(getCertificados().getContent());
    const vacaciones    = sinVacaciones ? null : JSON.parse(getSolicitudesVacaciones({ parameter: { estado: 'aprobada' } }).getContent());
    const horarios      = sinHorarios ? null : JSON.parse(getHorarios(e).getContent());
    return ContentService.createTextOutput(JSON.stringify({
      ok: true,
      perfiles: perfiles,
      certificados: certificados,
      vacacionesAprobadas: vacaciones,
      horarios: horarios,
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  const accion = e.parameter.accion || '';

  // Cache key incluye sin_horarios/sin_perfiles/sin_certificados/sin_vacaciones
  // para no mezclar variantes recortadas con la completa (si no, una
  // respuesta recortada podría servirse cacheada para un pedido normal, o
  // viceversa).
  if (accion === 'datos_portal_empleado') return _cacheableTextOutput('datos_portal_empleado|' + (e.parameter.empleado || '') + '|' + (e.parameter.sin_horarios || '') + '|' + (e.parameter.sin_perfiles || '') + '|' + (e.parameter.sin_certificados || '') + '|' + (e.parameter.sin_vacaciones || ''), function() { return getDatosPortalEmpleado(e); });
  if (accion === 'horarios')            return _cacheableTextOutput('horarios|' + (e.parameter.empleado || ''), function() { return getHorarios(e); });
  if (accion === 'perfiles')            return _cacheableTextOutput('perfiles', getPerfiles);
  if (accion === 'guardar_perfil')      return _accionRetirada(e, 'guardar_perfil', 'EMPLEADO');
  if (accion === 'guardar_categoria')   return guardarCategoria(e);
  if (accion === 'cargar_usuarios')     return getUsuarios(e);
  if (accion === 'guardar_usuarios')    return guardarUsuarios(e);
  if (accion === 'cargar_certificados') return _cacheableTextOutput('cargar_certificados', getCertificados);
  if (accion === 'guardar_certificado') return _accionRetirada(e, 'guardar_certificado', 'CERTIFICADO');
  if (accion === 'borrar_certificado')  return _accionRetirada(e, 'borrar_certificado', 'CERTIFICADO');
  if (accion === 'guardar_foto_url')    return guardarFotoUrl(e);
  if (accion === 'get_config')          return _cacheableTextOutput('get_config', getConfig);
  if (accion === 'guardar_config')      return guardarConfig(e);
  if (accion === 'get_vacaciones')      return getVacaciones(e);
  if (accion === 'inicializar_vac')     return _accionRetirada(e, 'inicializar_vac', 'VACACIONES');
  if (accion === 'ajustar_vac')         return _accionRetirada(e, 'ajustar_vac', 'VACACIONES');
  if (accion === 'solicitar_vac')       return _accionRetirada(e, 'solicitar_vac', 'SOLICITUD_VAC');
  if (accion === 'get_solicitudes_vac') return getSolicitudesVacaciones(e);
  if (accion === 'responder_solicitud') return _accionRetirada(e, 'responder_solicitud', 'SOLICITUD_VAC');
  if (accion === 'agregar_vacacion_admin') return _accionRetirada(e, 'agregar_vacacion_admin', 'SOLICITUD_VAC');
  if (accion === 'get_anuncios')        return getAnuncios(e);
  if (accion === 'guardar_anuncio')     return guardarAnuncio(e);
  if (accion === 'eliminar_anuncio')    return eliminarAnuncio(e);
  if (accion === 'get_eventos')           return _cacheableTextOutput('get_eventos|' + (e.parameter.empleado || ''), function() { return getEventos(e); });
  if (accion === 'guardar_evento')        return guardarEvento(e);
  if (accion === 'eliminar_evento')       return eliminarEvento(e);
  if (accion === 'get_sucursales_geo')    return _cacheableTextOutput('get_sucursales_geo', getSucursalesGeo);
  if (accion === 'get_fichadas_empleado') return getFichadasEmpleado(e);
  if (accion === 'get_banco_horas')       return getBancoHoras(e);
  if (accion === 'get_banco_horas_todos')  return getBancoHorasTodos();
  if (accion === 'get_fichadas_hoy_local') return getFichadasHoyLocal();

  return ContentService
    .createTextOutput(JSON.stringify({ error: 'Acción no reconocida' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function getHorarios(e) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const hoja  = ss.getSheetByName('DATOS GENERALES');
  const datos = hoja.getDataRange().getValues();
  const filas = datos.slice(1);

  // Filtro opcional por empleado (para la vista de un solo empleado).
  // Reduce muchísimo el payload y el tiempo de respuesta.
  const filtroEmp = (e && e.parameter && e.parameter.empleado)
    ? String(e.parameter.empleado).trim().toLowerCase()
    : '';

  // Columnas (0-indexed):
  // A=0 LOCAL  B=1 AÑO  C=2 MES  D=3 DIA(texto)  E=4 MARCA_TEMPORAL
  // F=5 EMPLEADO  G=6 H_ENTRADA  H=7 H_SALIDA  I=8 NOTA  J=9 TOTAL

  const registros = filas
    .filter(f => f[0] && f[5])
    .filter(f => !filtroEmp || String(f[5]).trim().toLowerCase() === filtroEmp)
    .map(f => {
      // Día del mes desde MARCA_TEMPORAL (columna E)
      let diaMes = 0;
      const mt = f[4];
      if (mt instanceof Date) {
        diaMes = mt.getDate();
      } else if (typeof mt === 'string' && mt.length > 0) {
        try { diaMes = new Date(mt).getDate(); } catch(e) {}
      }

      return {
        local:    String(f[0]).trim(),
        anio:     f[1],
        mes:      String(f[2]).trim().toUpperCase(),
        dia:      diaMes,
        diaTexto: String(f[3]).toUpperCase().trim(),
        empleado: String(f[5]).trim(),
        entrada:  formatearHora(f[6]),
        salida:   formatearHora(f[7]),
        nota:     String(f[8] || '').trim(),
        total:    parseFloat(f[9]) || 0,
        marca:    mt instanceof Date ? mt.toISOString() : String(mt || ''),
      };
    })
    .filter(r => r.dia > 0);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, data: registros }))
    .setMimeType(ContentService.MimeType.JSON);
}

function getPerfiles() {
  const ss     = SpreadsheetApp.getActiveSpreadsheet();
  const result = { ok: true, categorias: [], empleados: [] };

  try {
    const hCat = ss.getSheetByName('CATEGORIAS');
    if (hCat) {
      result.categorias = hCat.getDataRange().getValues().slice(1)
        .filter(r => r[0]).map(r => ({
          id: r[0], nombre: r[1], descripcion: r[2], regla: r[3],
          percibe_extra: r[4] === true || r[4] === 'TRUE',
        }));
    }
  } catch(e) {}

  try {
    const hEmp = ss.getSheetByName('EMPLEADOS');
    if (hEmp) {
      const vals    = hEmp.getDataRange().getValues();
      const headers = vals[0].map(h => String(h).trim().toUpperCase());
      const col = function(name) { return headers.indexOf(name); };
      result.empleados = vals.slice(1).filter(r => r[0]).map(r => {
        const fiStr = function(v) {
          if (!v) return '';
          if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
          return String(v).trim();
        };
        return {
          nombre:        r[0],
          empresa:       r[col('EMPRESA')]       || '',
          categoria_id:  r[col('CATEGORIA')]     || '',
          hs_base:       parseFloat(r[col('HS_BASE')]) || 0,
          foto_url:      r[col('FOTO_URL')]      || '',
          activo:        r[col('ACTIVO')] !== false && r[col('ACTIVO')] !== 'FALSE',
          regla_custom:  r[col('REGLA_CUSTOM')]  || '',
          sucursal_id:   col('SUCURSAL_ID')  >= 0 ? (r[col('SUCURSAL_ID')]  || '') : '',
          fecha_ingreso: col('FECHA_INGRESO') >= 0 ? fiStr(r[col('FECHA_INGRESO')]) : '',
          // Campos agregados por ADMINISTRACIÓN UNIFICADA DE EMPLEADOS +
          // ACCESO (Commit 2/3) — aditivo, no rompe consumidores viejos que
          // ignoran claves que no conocen. col()>=0 por si la hoja todavía
          // no pasó por _upsertEmpleado ni una vez (columnas no creadas aún).
          numero_vendedor_sysneo: col('NUMERO_VENDEDOR_SYSNEO') >= 0 ? (r[col('NUMERO_VENDEDOR_SYSNEO')] || '') : '',
          celular:                col('CELULAR') >= 0 ? (r[col('CELULAR')] || '') : '',
          estado:                 col('ESTADO') >= 0 ? (r[col('ESTADO')] || 'activo') : 'activo',
          apodo:                  col('APODO') >= 0 ? (r[col('APODO')] || '') : '',
        };
      });
    }
  } catch(e) {}

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function guardarPerfil(e) {
  try {
    const perfil = JSON.parse(decodeURIComponent(e.parameter.datos || '{}'));
    const ss     = SpreadsheetApp.getActiveSpreadsheet();
    let hoja     = ss.getSheetByName('EMPLEADOS');

    if (!hoja) {
      hoja = ss.insertSheet('EMPLEADOS');
      hoja.getRange(1, 1, 1, 9).setValues([[
        'NOMBRE','EMPRESA','CATEGORIA','HS_BASE','FOTO_URL','ACTIVO','REGLA_CUSTOM','FECHA_INGRESO','SUCURSAL_ID'
      ]]);
    } else {
      // Agregar columnas si no existen
      const hdrs = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(h => String(h).trim().toUpperCase());
      if (hdrs.indexOf('FECHA_INGRESO') < 0) hoja.getRange(1, hdrs.length + 1).setValue('FECHA_INGRESO');
      if (hdrs.indexOf('SUCURSAL_ID')   < 0) {
        const newHdrs = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(h => String(h).trim().toUpperCase());
        hoja.getRange(1, newHdrs.length + 1).setValue('SUCURSAL_ID');
      }
    }

    // Leer headers actualizados y mapear posiciones
    const headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(h => String(h).trim().toUpperCase());
    const col = function(name) { return headers.indexOf(name); }; // 0-based

    const vals = hoja.getDataRange().getValues();
    const idx  = vals.findIndex(r => r[0] === perfil.nombre);

    // Construir fila respetando el orden real de columnas. Si la fila ya
    // existe, se parte de sus valores actuales (no de un array en blanco)
    // para no pisar columnas que este flujo legado no conoce — p.ej.
    // NUMERO_VENDEDOR_SYSNEO/CELULAR/ESTADO agregadas por el flujo nuevo
    // (ver ADMINISTRACIÓN UNIFICADA más abajo). Sin este cambio, cualquier
    // edición hecha desde el modal viejo de empleado borraría esos campos.
    const fila = idx > 0 ? vals[idx].slice() : new Array(headers.length).fill('');
    while (fila.length < headers.length) fila.push(''); // por si headers creció
    fila[0]                      = perfil.nombre;
    fila[col('EMPRESA')]         = perfil.empresa       || '';
    fila[col('CATEGORIA')]       = perfil.categoria_id  || '';
    fila[col('HS_BASE')]         = perfil.hs_base       || 0;
    fila[col('FOTO_URL')]        = perfil.foto_url      || '';
    fila[col('ACTIVO')]          = perfil.activo !== false;
    fila[col('REGLA_CUSTOM')]    = perfil.regla_custom  || '';
    if (col('FECHA_INGRESO') >= 0) fila[col('FECHA_INGRESO')] = perfil.fecha_ingreso || '';
    if (col('SUCURSAL_ID')   >= 0) fila[col('SUCURSAL_ID')]   = perfil.sucursal_id   || '';

    if (idx > 0) hoja.getRange(idx + 1, 1, 1, fila.length).setValues([fila]);
    else hoja.appendRow(fila);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function guardarCategoria(e) {
  try {
    const cat  = JSON.parse(decodeURIComponent(e.parameter.datos || '{}'));
    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    let hoja   = ss.getSheetByName('CATEGORIAS');

    if (!hoja) {
      hoja = ss.insertSheet('CATEGORIAS');
      hoja.getRange(1, 1, 1, 5).setValues([[
        'ID','NOMBRE','DESCRIPCION','REGLA','PERCIBE_EXTRA'
      ]]);
    }

    const vals = hoja.getDataRange().getValues();
    const idx  = vals.findIndex(r => r[0] === cat.id);
    const fila = [
      cat.id, cat.nombre, cat.descripcion || '',
      cat.regla || '', cat.percibe_extra === true,
    ];

    if (idx > 0) hoja.getRange(idx + 1, 1, 1, fila.length).setValues([fila]);
    else hoja.appendRow(fila);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
// ── USUARIOS / LOGIN ──────────────────────────────────
// Hoja USUARIOS: NOMBRE | PIN | ROL | EMPLEADO_NOMBRE
// (+ ESTADO | FIN_ACCESO agregadas por el flujo nuevo — ver más abajo
// "ADMINISTRACIÓN UNIFICADA DE EMPLEADOS + ACCESO". guardarUsuarios se deja
// sin tocar; el flujo nuevo usa sus propias funciones de lectura/escritura.)
//
// getUsuarios SÍ se modifica acá (fix de seguridad, posterior al Commit 2):
// ya no devuelve nada sin BACKEND_SECRET — ver _validarBackendSecret más
// abajo en ADMINISTRACIÓN UNIFICADA. Sin secreto válido: 401 lógico
// { ok:false, error:'No autorizado' }, nunca la lista ni el PIN. Con
// secreto válido (query ?clave_backend=...): mantiene la misma respuesta
// de siempre, para no romper ningún consumidor server-to-server que todavía
// dependa de esta ruta GET en vez de la acción interna por POST
// (cargar_usuarios_interno, la que usa Node desde el Commit 1/2).

function getUsuarios(e) {
  try {
    const clave = e && e.parameter && e.parameter.clave_backend;
    if (!_validarBackendSecret(clave)) return _respuestaNoAutorizado();

    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    let hoja   = ss.getSheetByName('USUARIOS');

    // Crear hoja si no existe todavía
    if (!hoja) {
      hoja = ss.insertSheet('USUARIOS');
      hoja.getRange(1, 1, 1, 5).setValues([['NOMBRE','PIN','ROL','EMPLEADO_NOMBRE','CELULAR']]);
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, usuarios: [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const vals = hoja.getDataRange().getValues();
    if (vals.length < 2) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, usuarios: [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const usuarios = vals.slice(1)
      .filter(r => r[0])
      .map(r => ({
        nombre:         String(r[0] || '').trim(),
        pin:            String(r[1] || '').trim(),
        rol:            String(r[2] || 'empleado').trim(),
        empleadoNombre: String(r[3] || '').trim() || null,
        celular:        String(r[4] || '').trim() || null,
      }));

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, usuarios }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// BLOQUEADA (Commit 4, fix de seguridad) — ya no acepta escrituras
// públicas. Hasta acá reescribía toda la hoja (clearContents()) a partir
// de la lista completa que mandaba el cliente por GET, sin
// BACKEND_SECRET ni ningún control de acceso. Confirmado por grep y
// pruebas (suite GAS + smoke test Node) que ningún flujo activo del
// frontend ni del backend depende de esta acción — la administración de
// usuarios real vive en ADMINISTRACIÓN UNIFICADA DE EMPLEADOS + ACCESO
// (más abajo), protegida por BACKEND_SECRET + LockService + operaciones
// puntuales por fila. Se mantiene la función definida (no se borra la
// acción del router de doGet) únicamente por compatibilidad nominal —
// para que `accion=guardar_usuarios` siga siendo una acción reconocida en
// vez de caer en "Acción no reconocida", pero nunca vuelve a tocar la
// hoja USUARIOS. No se sanea/preserva nada del payload recibido: se
// ignora por completo, ni siquiera se parsea.
function guardarUsuarios(e) {
  try {
    // Nunca se registra el valor de "datos" (ahí viajaba la lista con PIN
    // en texto plano) — solo si el intento traía ese parámetro o no.
    const traiaDatos = !!(e && e.parameter && e.parameter.datos);
    registrarAuditoria(
      'anonimo', 'INTENTO_BLOQUEADO_GUARDAR_USUARIOS', 'USUARIO', 'guardar_usuarios',
      null, { traia_parametro_datos: traiaDatos }
    );
  } catch (auditErr) {
    Logger.log('Error registrando intento bloqueado de guardar_usuarios: ' + auditErr.message);
  }
  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, error: 'Acción obsoleta. Utilice la API protegida.' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Fase 6A: cierre de acciones públicas sin blindar su lógica ───────
// Mismo criterio que guardarUsuarios de arriba: la acción deja de poder
// invocarse públicamente, pero la función original (guardarPerfil,
// acreditarBanco, usarBanco) queda intacta y definida más abajo — sin
// tocar, sin borrar — solo que el router ya no le llega a ningún caller.
// acreditarBanco/usarBanco: confirmado por grep exhaustivo (Fase 6,
// verificado de nuevo antes de este cierre) que no tienen ningún
// consumidor real en app.js/fichar.html/kiosco.html ni en ningún otro
// repo del ecosistema — estaban expuestas públicamente sin que nada las
// llamara. guardar_perfil: su único consumidor real (activar/desactivar
// empleado) se migró a PUT /empleados/:nombre (editar_empleado, Node,
// JWT+rol, ya en producción) — no PATCH /acceso/estado, que es un campo
// distinto (login, no si sigue trabajando). No necesita blindarse, se retira.
function _accionRetirada(e, accion, entidad) {
  try {
    const traiaDatos = !!(e && e.parameter && (e.parameter.datos || e.postData));
    registrarAuditoria(
      'anonimo', 'INTENTO_BLOQUEADO_' + accion.toUpperCase(), entidad, accion,
      null, { traia_parametro_datos: traiaDatos }
    );
  } catch (auditErr) {
    Logger.log('Error registrando intento bloqueado de ' + accion + ': ' + auditErr.message);
  }
  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, error: 'Acción obsoleta. Utilice la API protegida.' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// =====================================================
//  ADMINISTRACIÓN UNIFICADA DE EMPLEADOS + ACCESO
// =====================================================
// Todas las acciones de esta sección llegan por doPost, en un sobre JSON
// { accion, clave_backend, datos } (ver despacharAccionSegura). Las llama
// exclusivamente croma-backend (Node), nunca el navegador directo — Node
// agrega clave_backend server-side y el actor sale del JWT, nunca del body
// que mandó el cliente. No confundir con las acciones legadas de arriba
// (cargar_usuarios, guardar_usuarios, guardar_perfil), que siguen
// funcionando exactamente igual, sin este sobre ni el secreto.
//
// No se implementa EMPLEADO_ID ni PIN_HASH todavía — la vinculación sigue
// siendo por EMPLEADO_NOMBRE normalizado (trim/espacios/mayúsculas), sin
// tocar jamás el nombre histórico guardado.

// ── Seguridad: BACKEND_SECRET ─────────────────────────
function _validarBackendSecret(clave) {
  const esperado = PropertiesService.getScriptProperties().getProperty('BACKEND_SECRET');
  if (!esperado) return false; // no configurado en este entorno → nunca autorizar
  if (!clave) return false;
  return String(clave) === String(esperado);
}

function _resp(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function _respuestaNoAutorizado() {
  return _resp({ ok: false, error: 'No autorizado' });
}

// ── Auditoría ──────────────────────────────────────────
// Hoja AUDITORIA: FECHA_HORA | ACTOR | ACCION | ENTIDAD | CLAVE |
//                 DATOS_ANTERIORES | DATOS_NUEVOS
const _CAMPOS_SENSIBLES_AUDITORIA = [
  'pin', 'pin_actual', 'pin_nuevo', 'pin_hash',
  'password', 'token', 'authorization', 'clave_backend', 'backend_secret',
];

// Limpieza RECURSIVA: recorre objetos y arrays a cualquier profundidad y
// reemplaza el valor de cualquier campo sensible por '[omitido]'. Nunca
// deja pasar un PIN/hash/token a la hoja de auditoría, sin importar en qué
// nivel del objeto esté.
function _sanitizarProfundo(valor) {
  if (Array.isArray(valor)) return valor.map(_sanitizarProfundo);
  if (valor && typeof valor === 'object') {
    const limpio = {};
    Object.keys(valor).forEach(function(k) {
      limpio[k] = _CAMPOS_SENSIBLES_AUDITORIA.indexOf(String(k).toLowerCase()) >= 0
        ? '[omitido]'
        : _sanitizarProfundo(valor[k]);
    });
    return limpio;
  }
  return valor;
}

function _asegurarHojaAuditoria() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName('AUDITORIA');
  if (!hoja) {
    hoja = ss.insertSheet('AUDITORIA');
    hoja.getRange(1, 1, 1, 7).setValues([[
      'FECHA_HORA', 'ACTOR', 'ACCION', 'ENTIDAD', 'CLAVE', 'DATOS_ANTERIORES', 'DATOS_NUEVOS',
    ]]);
  }
  return hoja;
}

// Best-effort: un fallo al auditar no debe revertir ni bloquear la
// operación que ya se hizo (Sheets no tiene transacciones — ver diseño,
// punto 6). Se loguea con Logger.log para poder diagnosticarlo aparte.
// antes/despues pueden venir con pin en texto plano (son snapshots de fila
// real) — acá es donde se sanitizan antes de tocar la hoja de auditoría.
function registrarAuditoria(actor, accion, entidad, clave, antes, despues) {
  try {
    const hoja = _asegurarHojaAuditoria();
    hoja.appendRow([
      new Date(),
      String(actor || 'desconocido'),
      accion,
      entidad,
      String(clave || ''),
      antes   ? JSON.stringify(_sanitizarProfundo(antes))   : '',
      despues ? JSON.stringify(_sanitizarProfundo(despues)) : '',
    ]);
  } catch (auditErr) {
    Logger.log('Error registrando auditoría: ' + auditErr.message);
  }
}

// ── EMPLEADOS: helpers del flujo nuevo ────────────────
// Existencia para el admin: EMPLEADOS primero, DATOS GENERALES (columna
// EMPLEADO, col F) como fallback de compatibilidad — igual criterio que
// obtenerEmpleadosAdmin() del frontend. Deliberadamente NO usa FICHADAS
// (eso es _empleadoExiste(), que sirve a un propósito distinto: validar
// fichadas, no administración).
function _empleadoExisteParaAdmin(nombre) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const nombreNorm = _normalizarNombreEmpleado(nombre);

  const hEmp = ss.getSheetByName('EMPLEADOS');
  if (hEmp) {
    const vals = hEmp.getDataRange().getValues();
    for (let i = 1; i < vals.length; i++) {
      if (_normalizarNombreEmpleado(vals[i][0]) === nombreNorm) return true;
    }
  }

  const hDatos = ss.getSheetByName('DATOS GENERALES');
  if (hDatos) {
    const vals = hDatos.getDataRange().getValues();
    for (let i = 1; i < vals.length; i++) {
      if (_normalizarNombreEmpleado(vals[i][5]) === nombreNorm) return true; // F=5 EMPLEADO
    }
  }
  return false;
}

function _numeroSysneoDisponible(numero, nombreExcluirNorm) {
  if (!numero) return true; // opcional — vacío siempre está "disponible"
  const ss   = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName('EMPLEADOS');
  if (!hoja) return true;
  const headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(h => String(h).trim().toUpperCase());
  const cNum = headers.indexOf('NUMERO_VENDEDOR_SYSNEO');
  if (cNum < 0) return true;
  const vals = hoja.getDataRange().getValues();
  const numeroStr = String(numero).trim();
  for (let i = 1; i < vals.length; i++) {
    if (_normalizarNombreEmpleado(vals[i][0]) === nombreExcluirNorm) continue;
    if (String(vals[i][cNum] || '').trim() === numeroStr) return false;
  }
  return true;
}

function _filaEmpleadoAObjeto(headers, fila) {
  const col = function(name) { return headers.indexOf(name); };
  const val = function(name) { const c = col(name); return c >= 0 ? fila[c] : ''; };
  return {
    nombre:                  fila[0],
    nombre_legal:             val('NOMBRE_LEGAL') || '',
    empresa:                 val('EMPRESA') || '',
    categoria_id:             val('CATEGORIA') || '',
    hs_base:                 val('HS_BASE') || 0,
    foto_url:                val('FOTO_URL') || '',
    regla_custom:             val('REGLA_CUSTOM') || '',
    fecha_ingreso:            val('FECHA_INGRESO') || '',
    sucursal_id:              val('SUCURSAL_ID') || '',
    celular:                 val('CELULAR') || '',
    numero_vendedor_sysneo:   val('NUMERO_VENDEDOR_SYSNEO') || '',
    estado:                  val('ESTADO') || 'activo',
    apodo:                   val('APODO') || '',
  };
}

// Alta/edición puntual de EMPLEADOS por fila (sin clearContents, con
// LockService en el llamador). Nunca toca la columna NOMBRE de una fila
// existente — el nombre solo se fija al crear (ver bloqueo de edición en
// el diseño, decisión "NOMBRE DEL EMPLEADO"). Solo pisa los campos que
// vienen definidos (!== undefined) en `perfil`, así que se puede usar
// tanto para el alta completa como para parches puntuales (p.ej. asignar
// solo el número Sysneo).
function _upsertEmpleado(perfil) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName('EMPLEADOS');
  if (!hoja) {
    hoja = ss.insertSheet('EMPLEADOS');
    hoja.getRange(1, 1, 1, 9).setValues([[
      'NOMBRE', 'EMPRESA', 'CATEGORIA', 'HS_BASE', 'FOTO_URL', 'ACTIVO', 'REGLA_CUSTOM', 'FECHA_INGRESO', 'SUCURSAL_ID',
    ]]);
  }
  _asegurarColumna(hoja, 'FECHA_INGRESO');
  _asegurarColumna(hoja, 'SUCURSAL_ID');
  _asegurarColumna(hoja, 'NUMERO_VENDEDOR_SYSNEO');
  _asegurarColumna(hoja, 'CELULAR');
  _asegurarColumna(hoja, 'ESTADO');
  _asegurarColumna(hoja, 'NOMBRE_LEGAL'); // Fase 2 — campo permanente, independiente de NOMBRE
  _asegurarColumna(hoja, 'APODO'); // apodo opcional, solo visual/búsqueda — no reemplaza NOMBRE ni NOMBRE_LEGAL

  const headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(h => String(h).trim().toUpperCase());
  const col = function(name) { return headers.indexOf(name); };

  const vals = hoja.getDataRange().getValues();
  const nombreNorm = _normalizarNombreEmpleado(perfil.nombre);
  let idx = -1;
  for (let i = 1; i < vals.length; i++) {
    if (_normalizarNombreEmpleado(vals[i][0]) === nombreNorm) { idx = i; break; }
  }

  const antes = idx >= 0 ? _filaEmpleadoAObjeto(headers, vals[idx]) : null;

  const fila = idx >= 0 ? vals[idx].slice() : new Array(headers.length).fill('');
  while (fila.length < headers.length) fila.push('');

  if (idx < 0) fila[0] = perfil.nombre; // nombre solo se fija al crear

  if (col('EMPRESA') >= 0 && perfil.empresa !== undefined)             fila[col('EMPRESA')]       = perfil.empresa || '';
  if (col('CATEGORIA') >= 0 && perfil.categoria_id !== undefined)       fila[col('CATEGORIA')]      = perfil.categoria_id || '';
  if (col('HS_BASE') >= 0 && perfil.hs_base !== undefined)             fila[col('HS_BASE')]       = perfil.hs_base || 0;
  if (col('FOTO_URL') >= 0 && perfil.foto_url !== undefined)           fila[col('FOTO_URL')]       = perfil.foto_url || '';
  if (col('REGLA_CUSTOM') >= 0 && perfil.regla_custom !== undefined)    fila[col('REGLA_CUSTOM')]    = perfil.regla_custom || '';
  if (col('FECHA_INGRESO') >= 0 && perfil.fecha_ingreso !== undefined)  fila[col('FECHA_INGRESO')]   = perfil.fecha_ingreso || '';
  if (col('SUCURSAL_ID') >= 0 && perfil.sucursal_id !== undefined)      fila[col('SUCURSAL_ID')]     = perfil.sucursal_id || '';
  if (col('CELULAR') >= 0 && perfil.celular !== undefined)             fila[col('CELULAR')]        = perfil.celular || '';
  if (col('NUMERO_VENDEDOR_SYSNEO') >= 0 && perfil.numero_vendedor_sysneo !== undefined) {
    fila[col('NUMERO_VENDEDOR_SYSNEO')] = perfil.numero_vendedor_sysneo || '';
  }
  // NOMBRE_LEGAL: independiente de NOMBRE, nunca lo pisa ni se deriva de él.
  if (col('NOMBRE_LEGAL') >= 0 && perfil.nombre_legal !== undefined) {
    fila[col('NOMBRE_LEGAL')] = perfil.nombre_legal || '';
  }
  if (col('APODO') >= 0 && perfil.apodo !== undefined) {
    fila[col('APODO')] = perfil.apodo || '';
  }

  const estadoPrevio = antes ? antes.estado : null;
  const estado = perfil.estado || estadoPrevio || 'activo';
  if (col('ESTADO') >= 0) fila[col('ESTADO')] = estado;
  if (col('ACTIVO') >= 0) fila[col('ACTIVO')] = estado !== 'inactivo'; // espejo booleano para el código viejo

  if (idx >= 0) hoja.getRange(idx + 1, 1, 1, fila.length).setValues([fila]);
  else hoja.appendRow(fila);

  return { antes: antes, despues: _filaEmpleadoAObjeto(headers, fila), esNuevo: idx < 0 };
}

// ── USUARIOS: helpers del flujo nuevo (sin clearContents) ─────────────
function _asegurarHojaUsuarios() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName('USUARIOS');
  if (!hoja) {
    hoja = ss.insertSheet('USUARIOS');
    hoja.getRange(1, 1, 1, 5).setValues([['NOMBRE', 'PIN', 'ROL', 'EMPLEADO_NOMBRE', 'CELULAR']]);
  }
  _asegurarColumna(hoja, 'ESTADO');
  _asegurarColumna(hoja, 'FIN_ACCESO');
  return hoja;
}

function _leerUsuariosCrudo(hoja) {
  const headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(h => String(h).trim().toUpperCase());
  const vals = hoja.getDataRange().getValues();
  return { headers: headers, vals: vals };
}

function _usuarioAObjeto(headers, fila) {
  const col = function(name) { return headers.indexOf(name); };
  const val = function(name) { const c = col(name); return c >= 0 ? fila[c] : ''; };
  return {
    nombre:         String(fila[0] || '').trim(),
    pin:            String(val('PIN') || ''),
    rol:            String(val('ROL') || 'empleado').trim() || 'empleado',
    empleadoNombre: String(val('EMPLEADO_NOMBRE') || '').trim() || null,
    celular:        String(val('CELULAR') || '').trim() || null,
    estado:         String(val('ESTADO') || 'activo').trim() || 'activo',
    fin_acceso:     val('FIN_ACCESO') ? String(val('FIN_ACCESO')) : null,
  };
}

function _buscarFilaUsuarioPorEmpleado(headers, vals, empleadoNombreNorm) {
  const cEmp = headers.indexOf('EMPLEADO_NOMBRE');
  if (cEmp < 0) return -1;
  for (let i = 1; i < vals.length; i++) {
    if (!vals[i][0]) continue;
    if (_normalizarNombreEmpleado(vals[i][cEmp]) === empleadoNombreNorm) return i;
  }
  return -1;
}

function _buscarFilaUsuarioPorUsername(headers, vals, usernameNorm, excluirIdx) {
  for (let i = 1; i < vals.length; i++) {
    if (i === excluirIdx) continue;
    if (!vals[i][0]) continue;
    if (String(vals[i][0]).trim().toLowerCase() === usernameNorm) return i;
  }
  return -1;
}

// Crea o actualiza el ÚNICO registro de USUARIOS vinculado a empleadoNombre
// (regla 1-a-1, ver diseño). Si ya existe una fila para ese empleado, la
// reutiliza (reactivación = misma fila) en vez de crear una segunda.
// pin vacío/omitido en una edición conserva el PIN existente. Lanza
// Error('USERNAME_DUPLICADO') si el username ya pertenece a otra fila.
function _upsertUsuarioPorFila(usuarioData, empleadoNombre) {
  const hoja = _asegurarHojaUsuarios();
  const leido = _leerUsuariosCrudo(hoja);
  const headers = leido.headers, vals = leido.vals;
  const empNorm = _normalizarNombreEmpleado(empleadoNombre);

  const idxExistente = _buscarFilaUsuarioPorEmpleado(headers, vals, empNorm);
  const usernameNorm = String(usuarioData.username || '').trim().toLowerCase();
  const idxUsername = _buscarFilaUsuarioPorUsername(headers, vals, usernameNorm, idxExistente);
  if (idxUsername >= 0) throw new Error('USERNAME_DUPLICADO');

  const antes = idxExistente >= 0 ? _usuarioAObjeto(headers, vals[idxExistente]) : null;

  const col = function(name) { return headers.indexOf(name); };
  const fila = idxExistente >= 0 ? vals[idxExistente].slice() : new Array(headers.length).fill('');
  while (fila.length < headers.length) fila.push('');

  fila[0] = usuarioData.username;
  if (usuarioData.pin) fila[col('PIN')] = String(usuarioData.pin); // vacío = conservar el existente
  fila[col('ROL')] = usuarioData.rol || (antes ? antes.rol : 'empleado') || 'empleado';
  fila[col('EMPLEADO_NOMBRE')] = empleadoNombre;
  if (usuarioData.celular !== undefined) fila[col('CELULAR')] = usuarioData.celular || '';
  fila[col('ESTADO')] = usuarioData.estado || (antes ? antes.estado : 'activo') || 'activo';
  if (col('FIN_ACCESO') >= 0) {
    fila[col('FIN_ACCESO')] = usuarioData.fin_acceso !== undefined
      ? (usuarioData.fin_acceso || '')
      : (antes ? (antes.fin_acceso || '') : '');
  }

  if (idxExistente >= 0) hoja.getRange(idxExistente + 1, 1, 1, fila.length).setValues([fila]);
  else hoja.appendRow(fila);

  return { antes: antes, despues: _usuarioAObjeto(headers, fila), esNuevo: idxExistente < 0 };
}

// Parche puntual sobre la fila de USUARIOS vinculada a empleadoNombre.
// `cambios` es un objeto { NOMBRE_DE_COLUMNA: valor }. Devuelve null si ese
// empleado todavía no tiene acceso creado.
function _actualizarCampoUsuarioPorEmpleado(empleadoNombre, cambios) {
  const hoja = _asegurarHojaUsuarios();
  const leido = _leerUsuariosCrudo(hoja);
  const headers = leido.headers, vals = leido.vals;
  const empNorm = _normalizarNombreEmpleado(empleadoNombre);

  const idx = _buscarFilaUsuarioPorEmpleado(headers, vals, empNorm);
  if (idx < 0) return null;

  const antes = _usuarioAObjeto(headers, vals[idx]);
  const fila = vals[idx].slice();
  Object.keys(cambios).forEach(function(campo) {
    const c = headers.indexOf(campo);
    if (c >= 0) fila[c] = cambios[campo];
  });
  hoja.getRange(idx + 1, 1, 1, fila.length).setValues([fila]);

  return { antes: antes, despues: _usuarioAObjeto(headers, fila) };
}

// ── Acciones expuestas (todas vía despacharAccionSegura) ──────────────

// Uso exclusivo de croma-backend (Node) para el login por PIN y el listado
// admin sanitizado — nunca se expone directo al navegador. Devuelve el PIN
// en texto plano porque Node lo necesita para comparar en el login; Node
// es responsable de nunca reenviar este resultado crudo al cliente.
function accionCargarUsuariosInterno() {
  const hoja = _asegurarHojaUsuarios();
  const leido = _leerUsuariosCrudo(hoja);
  const headers = leido.headers, vals = leido.vals;
  const usuarios = [];
  for (let i = 1; i < vals.length; i++) {
    if (!vals[i][0]) continue;
    usuarios.push(_usuarioAObjeto(headers, vals[i]));
  }
  return _resp({ ok: true, usuarios: usuarios });
}

function accionCrearEmpleadoConAcceso(datos) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return _resp({ ok: false, error: 'Sistema ocupado, reintentá en unos segundos' });
  try {
    const actor = String(datos.actor || 'desconocido');
    const empleado = datos.empleado || {};
    const nombre = String(empleado.nombre || '').trim();
    if (!nombre) return _resp({ ok: false, error: 'El nombre del empleado es obligatorio' });

    // NOMBRE_LEGAL es obligatorio solo al CREAR — empleados existentes
    // pueden tenerlo vacío durante la transición (ver diseño Fase 2).
    // Nunca confiar solo en la validación del navegador: se repite acá.
    const nombreLegal = String(empleado.nombre_legal || '').trim();
    if (!nombreLegal) return _resp({ ok: false, error: 'El nombre legal completo es obligatorio' });

    const nombreNorm = _normalizarNombreEmpleado(nombre);
    if (!_numeroSysneoDisponible(empleado.numero_vendedor_sysneo, nombreNorm)) {
      return _resp({ ok: false, error: 'Ese número de vendedor Sysneo ya está asignado a otro empleado' });
    }

    const resultadoEmpleado = _upsertEmpleado(empleado);
    registrarAuditoria(
      actor,
      resultadoEmpleado.esNuevo ? 'EMPLEADO_CREADO' : 'EMPLEADO_EDITADO',
      'EMPLEADO', nombre, resultadoEmpleado.antes, resultadoEmpleado.despues
    );

    if (!datos.crear_acceso) return _resp({ ok: true, usuario_creado: false });

    const usuario = datos.usuario || {};
    if (!usuario.username || !String(usuario.username).trim()) {
      return _resp({
        ok: false, estado: 'empleado_creado_acceso_fallido',
        empleado_guardado: true, usuario_creado: false,
        error: 'Falta el nombre de usuario',
      });
    }
    if (!usuario.pin || String(usuario.pin).length < 4) {
      return _resp({
        ok: false, estado: 'empleado_creado_acceso_fallido',
        empleado_guardado: true, usuario_creado: false,
        error: 'El PIN debe tener al menos 4 caracteres',
      });
    }

    try {
      const resUsuario = _upsertUsuarioPorFila({
        username: String(usuario.username).trim(),
        pin:      String(usuario.pin),
        rol:      'empleado',
        celular:  empleado.celular || usuario.celular || '',
        estado:   'activo',
      }, nombre);
      registrarAuditoria(
        actor,
        resUsuario.esNuevo ? 'USUARIO_CREADO' : 'USUARIO_EDITADO',
        'USUARIO', usuario.username, resUsuario.antes, resUsuario.despues
      );
      return _resp({ ok: true, usuario_creado: true });
    } catch (errUsuario) {
      const msg = errUsuario.message === 'USERNAME_DUPLICADO'
        ? 'Ese nombre de usuario ya existe'
        : ('No se pudo crear el acceso: ' + errUsuario.message);
      // El empleado YA quedó guardado arriba — no se revierte (ver diseño,
      // punto 6: compensación informativa, no rollback real sobre Sheets).
      return _resp({
        ok: false, estado: 'empleado_creado_acceso_fallido',
        empleado_guardado: true, usuario_creado: false, error: msg,
      });
    }
  } finally {
    lock.releaseLock();
  }
}

// Nombre del empleado siempre sale de datos.empleado_nombre (el path de la
// ruta Node), nunca se deja pisar por lo que venga en datos.empleado.nombre.
function accionEditarEmpleado(datos) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return _resp({ ok: false, error: 'Sistema ocupado, reintentá en unos segundos' });
  try {
    const actor = String(datos.actor || 'desconocido');
    const nombre = String(datos.empleado_nombre || '').trim();
    if (!nombre) return _resp({ ok: false, error: 'Falta el nombre del empleado' });
    if (!_empleadoExisteParaAdmin(nombre)) return _resp({ ok: false, error: 'Empleado no encontrado' });

    const empleado = Object.assign({}, datos.empleado || {}, { nombre: nombre });
    const nombreNorm = _normalizarNombreEmpleado(nombre);
    if (!_numeroSysneoDisponible(empleado.numero_vendedor_sysneo, nombreNorm)) {
      return _resp({ ok: false, error: 'Ese número de vendedor Sysneo ya está asignado a otro empleado' });
    }

    const resultado = _upsertEmpleado(empleado);
    registrarAuditoria(actor, 'EMPLEADO_EDITADO', 'EMPLEADO', nombre, resultado.antes, resultado.despues);
    return _resp({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// Lectura admin-only de NOMBRE_LEGAL — Fase 2. Deliberadamente NO se agrega
// este campo a getPerfiles() (acción pública, sin autenticación, ver
// diseño Fase 2 punto 5): en vez de eso, la Administración pide este par
// nombre→nombre_legal por separado, por el canal seguro (Node JWT admin/jefe
// → GAS BACKEND_SECRET), y lo cruza en el cliente con lo que ya trae
// getPerfiles(). Mínima superficie: solo nombre + nombre_legal, nada más.
function accionListarNombresLegales() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName('EMPLEADOS');
  if (!hoja) return _resp({ ok: true, nombres: [] });
  const vals = hoja.getDataRange().getValues();
  if (vals.length < 2) return _resp({ ok: true, nombres: [] });

  const headers = vals[0].map(function(h) { return String(h).trim().toUpperCase(); });
  const iNom   = headers.indexOf('NOMBRE');
  const iLegal = headers.indexOf('NOMBRE_LEGAL');
  if (iNom < 0) return _resp({ ok: true, nombres: [] });

  const nombres = [];
  for (let i = 1; i < vals.length; i++) {
    const nombre = String(vals[i][iNom] || '').trim();
    if (!nombre) continue;
    nombres.push({ nombre: nombre, nombre_legal: iLegal >= 0 ? String(vals[i][iLegal] || '') : '' });
  }
  return _resp({ ok: true, nombres: nombres });
}

function accionCrearOActivarAcceso(datos) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return _resp({ ok: false, error: 'Sistema ocupado, reintentá en unos segundos' });
  try {
    const actor = String(datos.actor || 'desconocido');
    const nombre = String(datos.empleado_nombre || '').trim();
    if (!nombre) return _resp({ ok: false, error: 'Falta el nombre del empleado' });
    if (!_empleadoExisteParaAdmin(nombre)) return _resp({ ok: false, error: 'Empleado no encontrado' });

    const usuario = datos.usuario || {};
    if (!usuario.username || !String(usuario.username).trim()) {
      return _resp({ ok: false, error: 'Falta el nombre de usuario' });
    }
    if (!usuario.pin || String(usuario.pin).length < 4) {
      return _resp({ ok: false, error: 'El PIN debe tener al menos 4 caracteres' });
    }

    try {
      const res = _upsertUsuarioPorFila({
        username: String(usuario.username).trim(),
        pin:      String(usuario.pin),
        rol:      'empleado',
        celular:  usuario.celular || '',
        estado:   'activo',
      }, nombre);
      registrarAuditoria(
        actor,
        res.esNuevo ? 'USUARIO_CREADO' : 'ACCESO_ACTIVADO',
        'USUARIO', usuario.username, res.antes, res.despues
      );
      return _resp({ ok: true, usuario_creado: res.esNuevo });
    } catch (err) {
      const msg = err.message === 'USERNAME_DUPLICADO' ? 'Ese nombre de usuario ya existe' : err.message;
      return _resp({ ok: false, error: msg });
    }
  } finally {
    lock.releaseLock();
  }
}

function accionCambiarEstadoAcceso(datos) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return _resp({ ok: false, error: 'Sistema ocupado, reintentá en unos segundos' });
  try {
    const actor = String(datos.actor || 'desconocido');
    const nombre = String(datos.empleado_nombre || '').trim();
    const estado = datos.estado;
    if (estado !== 'activo' && estado !== 'inactivo') {
      return _resp({ ok: false, error: "Estado debe ser 'activo' o 'inactivo'" });
    }
    if (!nombre) return _resp({ ok: false, error: 'Falta el nombre del empleado' });

    const cambios = { ESTADO: estado };
    if (datos.fin_acceso !== undefined) cambios.FIN_ACCESO = datos.fin_acceso || '';

    const res = _actualizarCampoUsuarioPorEmpleado(nombre, cambios);
    if (!res) return _resp({ ok: false, error: 'Ese empleado no tiene acceso creado todavía' });

    registrarAuditoria(
      actor,
      estado === 'activo' ? 'ACCESO_ACTIVADO' : 'ACCESO_DESACTIVADO',
      'USUARIO', res.despues.nombre, res.antes, res.despues
    );
    return _resp({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// PIN puesto por un admin — no requiere conocer el PIN anterior. Nunca se
// pasa el valor del PIN a registrarAuditoria (ni antes ni después: se
// manda null explícitamente, doble resguardo además del sanitizador).
function accionCambiarPin(datos) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return _resp({ ok: false, error: 'Sistema ocupado, reintentá en unos segundos' });
  try {
    const actor = String(datos.actor || 'desconocido');
    const nombre = String(datos.empleado_nombre || '').trim();
    const pinNuevo = datos.pin_nuevo;
    if (!nombre) return _resp({ ok: false, error: 'Falta el nombre del empleado' });
    if (!pinNuevo || String(pinNuevo).length < 4) {
      return _resp({ ok: false, error: 'El PIN debe tener al menos 4 caracteres' });
    }

    const res = _actualizarCampoUsuarioPorEmpleado(nombre, { PIN: String(pinNuevo) });
    if (!res) return _resp({ ok: false, error: 'Ese empleado no tiene acceso creado todavía' });

    registrarAuditoria(actor, 'PIN_CAMBIADO', 'USUARIO', res.despues.nombre, null, null);
    return _resp({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// Autoservicio: el propio empleado cambia su PIN. nombre_usuario llega
// desde el JWT de Node (nunca del body que mandó el navegador — Node ya
// lo garantiza, pero acá igual se valida contra la fila real). El PIN
// actual se valida enteramente server-side; nunca se devuelve ni se
// compara en el cliente.
function accionCambiarPinPropio(datos) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return _resp({ ok: false, error: 'Sistema ocupado, reintentá en unos segundos' });
  try {
    const nombreUsuario = String(datos.nombre_usuario || '').trim();
    const pinActual = datos.pin_actual;
    const pinNuevo  = datos.pin_nuevo;
    if (!nombreUsuario || !pinActual || !pinNuevo) return _resp({ ok: false, error: 'Faltan datos' });
    if (String(pinNuevo).length < 4) return _resp({ ok: false, error: 'El PIN nuevo debe tener al menos 4 caracteres' });

    const hoja = _asegurarHojaUsuarios();
    const leido = _leerUsuariosCrudo(hoja);
    const headers = leido.headers, vals = leido.vals;
    const usernameNorm = nombreUsuario.toLowerCase();
    let idx = -1;
    for (let i = 1; i < vals.length; i++) {
      if (String(vals[i][0] || '').trim().toLowerCase() === usernameNorm) { idx = i; break; }
    }
    if (idx < 0) return _resp({ ok: false, error: 'Usuario no encontrado' });

    const cPin = headers.indexOf('PIN');
    const pinGuardado = String(vals[idx][cPin] || '');
    if (pinGuardado !== String(pinActual)) return _resp({ ok: false, error: 'El PIN actual es incorrecto' });

    const fila = vals[idx].slice();
    fila[cPin] = String(pinNuevo);
    hoja.getRange(idx + 1, 1, 1, fila.length).setValues([fila]);

    registrarAuditoria(nombreUsuario, 'PIN_CAMBIADO', 'USUARIO', nombreUsuario, null, null);
    return _resp({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function accionAsignarNumeroSysneo(datos) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return _resp({ ok: false, error: 'Sistema ocupado, reintentá en unos segundos' });
  try {
    const actor = String(datos.actor || 'desconocido');
    const nombre = String(datos.empleado_nombre || '').trim();
    const numero = datos.numero_vendedor_sysneo;
    if (!nombre) return _resp({ ok: false, error: 'Falta el nombre del empleado' });
    if (!_empleadoExisteParaAdmin(nombre)) return _resp({ ok: false, error: 'Empleado no encontrado' });

    const nombreNorm = _normalizarNombreEmpleado(nombre);
    if (!_numeroSysneoDisponible(numero, nombreNorm)) {
      return _resp({ ok: false, error: 'Ese número de vendedor Sysneo ya está asignado a otro empleado' });
    }

    const resultado = _upsertEmpleado({ nombre: nombre, numero_vendedor_sysneo: numero || '' });
    const accion = (resultado.antes && resultado.antes.numero_vendedor_sysneo)
      ? 'NUMERO_SYSNEO_MODIFICADO' : 'NUMERO_SYSNEO_ASIGNADO';
    registrarAuditoria(actor, accion, 'EMPLEADO', nombre, resultado.antes, resultado.despues);
    return _resp({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// Punto de entrada único para las 8 acciones nuevas — valida el secreto acá
// una sola vez, antes de despachar a cualquiera de ellas (ver doPost).
function despacharAccionSegura(envelope) {
  const accion = envelope.accion;
  const clave  = envelope.clave_backend;
  const datos  = envelope.datos || {};

  if (!_validarBackendSecret(clave)) return _respuestaNoAutorizado();

  if (accion === 'cargar_usuarios_interno')   return accionCargarUsuariosInterno();
  if (accion === 'crear_empleado_con_acceso') return accionCrearEmpleadoConAcceso(datos);
  if (accion === 'editar_empleado')           return accionEditarEmpleado(datos);
  if (accion === 'crear_o_activar_acceso')    return accionCrearOActivarAcceso(datos);
  if (accion === 'cambiar_estado_acceso')     return accionCambiarEstadoAcceso(datos);
  if (accion === 'cambiar_pin')               return accionCambiarPin(datos);
  if (accion === 'cambiar_pin_propio')        return accionCambiarPinPropio(datos);
  if (accion === 'asignar_numero_sysneo')     return accionAsignarNumeroSysneo(datos);
  if (accion === 'exportar_fichadas')         return accionExportarFichadas(datos);
  if (accion === 'listar_nombres_legales')    return accionListarNombresLegales();
  if (accion === 'subir_recibo')              return accionSubirRecibo(datos);
  if (accion === 'listar_recibos_empleado')   return accionListarRecibosEmpleado(datos);
  if (accion === 'obtener_recibo_archivo')    return accionObtenerReciboArchivo(datos);
  if (accion === 'obtener_recibo_drive_id')   return accionObtenerReciboDriveId(datos);
  if (accion === 'reemplazar_recibo')         return accionReemplazarRecibo(datos);

  // AVISOS (Fase 3A) — lectura y escritura, todo por acá, nunca por doGet.
  if (accion === 'get_avisos')                return accionGetAvisos();
  if (accion === 'get_aviso')                 return accionGetAviso(datos);
  if (accion === 'guardar_aviso')             return accionGuardarAviso(datos);
  if (accion === 'editar_aviso')              return accionEditarAviso(datos);
  if (accion === 'archivar_aviso')            return accionArchivarAviso(datos);
  if (accion === 'restaurar_aviso')           return accionRestaurarAviso(datos);
  if (accion === 'debug_resolver_destinatarios') return accionDebugResolverDestinatarios(datos);
  if (accion === 'get_avisos_visibles_usuario') return accionGetAvisosVisiblesUsuario(datos);
  if (accion === 'marcar_aviso_leido')          return accionMarcarAvisoLeido(datos);

  // Vacaciones aprobadas — lectura segura para el calendario nuevo de
  // AVISOS (ver accionGetSolicitudesVacAprobadas). No forma parte del
  // módulo AVISOS ni de su hoja — es Vacaciones, consumida como capa
  // visual aparte. Solo lectura, nunca escritura.
  if (accion === 'get_solicitudes_vac_aprobadas') return accionGetSolicitudesVacAprobadas(datos);

  // Vacaciones administrativas + Certificados (Fase 6B) — ver bloque de
  // funciones más abajo, sección "VACACIONES — acciones seguras" y
  // "CERTIFICADOS — acciones seguras".
  if (accion === 'vacaciones_solicitar')     return accionVacacionesSolicitar(datos);
  if (accion === 'vacaciones_responder')     return accionVacacionesResponder(datos);
  if (accion === 'vacaciones_inicializar')   return accionVacacionesInicializar(datos);
  if (accion === 'vacaciones_ajustar')       return accionVacacionesAjustar(datos);
  if (accion === 'vacaciones_agregar_admin') return accionVacacionesAgregarAdmin(datos);
  if (accion === 'certificado_guardar')      return accionCertificadoGuardar(datos);
  if (accion === 'certificado_borrar')       return accionCertificadoBorrar(datos);

  return _resp({ ok: false, error: 'Acción no reconocida' });
}

// ═══════════════════════════════════════════════════════
//  VACACIONES — acciones seguras (Fase 6B)
// ═══════════════════════════════════════════════════════
// Llegan solo por despacharAccionSegura (BACKEND_SECRET, server-to-server
// desde croma-backend) — actor sale de datos.actor, que Node ya resolvió
// desde el JWT, nunca de nada que el navegador mande directo. Las
// funciones legadas de arriba (solicitarVacaciones, responderSolicitud,
// inicializarVacacionesAnio, ajustarDiasVacaciones, agregarVacacionAdmin)
// NO se tocan — siguen intactas como implementación de referencia,
// siguen siendo el camino público (doGet) mientras dure la transición.
// Estas son funciones nuevas y paralelas a propósito, no un refactor de
// las de arriba: agregan lock/idempotencia/auditoría que no vale la pena
// sumarle a un código que va a retirarse. Reutilizan sí los helpers puros
// ya existentes (buildEmailAdminSolicitud, buildEmailEmpleadoRespuesta,
// formatearFechaEmail, descontarDiasVacaciones) para no duplicar esa
// parte.

function accionVacacionesSolicitar(datos) {
  const empleado    = String(datos.empleado    || '').trim();
  const fechaDesde  = String(datos.fecha_desde || '').trim();
  const fechaHasta  = String(datos.fecha_hasta || '').trim();
  const dias        = parseInt(datos.dias) || 1;
  if (!empleado || !fechaDesde || !fechaHasta) return _resp({ ok: false, error: 'Faltan datos' });

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName('SOLICITUDES_VAC');
  if (!hoja) {
    hoja = ss.insertSheet('SOLICITUDES_VAC');
    hoja.getRange(1,1,1,8).setValues([[
      'ID','EMPLEADO','FECHA_DESDE','FECHA_HASTA','DIAS','ESTADO','FECHA_SOLICITUD','NOTA_ADMIN'
    ]]);
  }
  const id    = 'vac_' + Date.now();
  const ahora = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  hoja.appendRow([id, empleado, fechaDesde, fechaHasta, dias, 'pendiente', ahora, '']);

  try {
    const config = getConfigObj(ss);
    const emailAdmin = config['email_admin'];
    if (emailAdmin) {
      const nomMostrar = empleado.replace(/^\d+\s+/, '');
      MailApp.sendEmail({
        to:       emailAdmin,
        subject:  `📅 Nueva solicitud de vacaciones — ${nomMostrar}`,
        htmlBody: buildEmailAdminSolicitud({
          nomMostrar,
          fechaDesdeFmt: formatearFechaEmail(fechaDesde),
          fechaHastaFmt: formatearFechaEmail(fechaHasta),
          dias,
          fechaSolicitud: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'),
        }),
      });
    }
  } catch (mailErr) {
    Logger.log('Error enviando email (vacaciones_solicitar): ' + mailErr.message);
  }

  return _resp({ ok: true, id });
}

// Idempotencia (punto 10): confirmado contra la UI real (renderVacacionesAdminHTML)
// que los botones Aprobar/Rechazar SOLO se muestran cuando estado==='pendiente' —
// no existe ningún flujo del producto que reabra o revierta una solicitud ya
// resuelta. Regla: solo se procesa la transición si el estado actual es
// 'pendiente'; cualquier otro estado actual devuelve error sin tocar nada
// (sin reescribir la fila, sin volver a descontar, sin reenviar email).
function accionVacacionesResponder(datos) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return _resp({ ok: false, error: 'Sistema ocupado, reintentá en unos segundos' });
  try {
    const actor     = String(datos.actor      || 'desconocido');
    const id        = String(datos.id         || '').trim();
    const estado    = String(datos.estado     || '').trim();
    const notaAdmin = String(datos.nota_admin || '').trim();
    if (!id || !estado) return _resp({ ok: false, error: 'Faltan datos' });
    if (['aprobada','rechazada'].indexOf(estado) < 0) return _resp({ ok: false, error: 'Estado inválido' });

    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = ss.getSheetByName('SOLICITUDES_VAC');
    if (!hoja) return _resp({ ok: false, error: 'Hoja no encontrada' });

    const vals = hoja.getDataRange().getValues();
    const idx  = vals.findIndex(r => String(r[0]).trim() === id);
    if (idx < 1) return _resp({ ok: false, error: 'Solicitud no encontrada' });

    const estadoAnterior = String(vals[idx][5] || 'pendiente').trim();
    if (estadoAnterior !== 'pendiente') {
      // No es un error de verdad — es un intento de re-procesar algo ya
      // resuelto (doble click, doble aprobación, retry). Se corta acá,
      // sin tocar la hoja ni reenviar el email.
      return _resp({ ok: false, error: `Esta solicitud ya fue resuelta (estado: ${estadoAnterior})`, ya_resuelta: true });
    }

    const empleado    = String(vals[idx][1]).trim();
    const dias         = parseInt(vals[idx][4]) || 0;
    const fechaDesde   = vals[idx][2];
    const fechaHasta   = vals[idx][3];

    hoja.getRange(idx + 1, 6).setValue(estado);
    hoja.getRange(idx + 1, 8).setValue(notaAdmin);

    if (estado === 'aprobada') {
      descontarDiasVacaciones(ss, empleado, fechaDesde, dias);
    }

    registrarAuditoria(
      actor,
      estado === 'aprobada' ? 'SOLICITUD_VAC_APROBADA' : 'SOLICITUD_VAC_RECHAZADA',
      'SOLICITUD_VAC', id,
      { estado: estadoAnterior },
      { estado, nota_admin: notaAdmin, empleado, dias }
    );

    try {
      const nomMostrar    = empleado.replace(/^\d+\s+/, '');
      const fechaDesdeFmt = formatearFechaEmail(
        fechaDesde instanceof Date
          ? Utilities.formatDate(fechaDesde, Session.getScriptTimeZone(), 'yyyy-MM-dd')
          : String(fechaDesde)
      );
      const fechaHastaFmt = formatearFechaEmail(
        fechaHasta instanceof Date
          ? Utilities.formatDate(fechaHasta, Session.getScriptTimeZone(), 'yyyy-MM-dd')
          : String(fechaHasta)
      );
      const hojaEmp = ss.getSheetByName('EMPLEADOS');
      if (hojaEmp) {
        const empVals  = hojaEmp.getDataRange().getValues();
        const headers  = empVals[0].map(h => String(h).trim().toUpperCase());
        const colEmail = headers.indexOf('EMAIL');
        const colNom   = headers.indexOf('EMPLEADO');
        if (colEmail >= 0 && colNom >= 0) {
          const fila = empVals.slice(1).find(r =>
            String(r[colNom] || '').trim().toLowerCase() === empleado.toLowerCase()
          );
          const emailEmp = fila ? String(fila[colEmail] || '').trim() : '';
          if (emailEmp) {
            MailApp.sendEmail({
              to:       emailEmp,
              subject:  estado === 'aprobada'
                ? `✅ Tus vacaciones fueron aprobadas`
                : `❌ Solicitud de vacaciones rechazada`,
              htmlBody: buildEmailEmpleadoRespuesta({ nomMostrar, estado, fechaDesdeFmt, fechaHastaFmt, diasSol: dias, notaAdmin }),
            });
          }
        }
      }
    } catch (mailErr) {
      Logger.log('Error enviando email al empleado (vacaciones_responder): ' + mailErr.message);
    }

    return _resp({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function accionVacacionesInicializar(datos) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return _resp({ ok: false, error: 'Sistema ocupado, reintentá en unos segundos' });
  try {
    const actor = String(datos.actor || 'desconocido');
    const anio  = parseInt(datos.anio) || new Date().getFullYear();
    const ss    = SpreadsheetApp.getActiveSpreadsheet();

    const hojaEmp = ss.getSheetByName('EMPLEADOS');
    if (!hojaEmp) return _resp({ ok: false, error: 'Hoja EMPLEADOS no encontrada' });

    const valsEmp = hojaEmp.getDataRange().getValues();
    const headers = valsEmp[0].map(h => String(h).trim().toUpperCase());
    let colFI     = headers.indexOf('FECHA_INGRESO');
    if (colFI < 0) {
      colFI = headers.length;
      hojaEmp.getRange(1, colFI + 1).setValue('FECHA_INGRESO');
    }

    let hojaVac = ss.getSheetByName('VACACIONES');
    if (!hojaVac) {
      hojaVac = ss.insertSheet('VACACIONES');
      hojaVac.getRange(1,1,1,7).setValues([[
        'AÑO','EMPLEADO','FECHA_INGRESO','DIAS_BANCO','DIAS_USADOS','DIAS_AJUSTE','DIAS_DISPONIBLES'
      ]]);
    }

    const valsVac  = hojaVac.getDataRange().getValues();
    let procesados = 0;

    valsEmp.slice(1).forEach(row => {
      if (!row[0]) return;
      const nombre = String(row[0]).trim();
      const activo = row[5] !== false && row[5] !== 'FALSE';
      if (!activo) return;
      const fechaIngreso = row[colFI] || null;
      const diasBanco    = calcularDiasVacaciones(fechaIngreso, anio);

      const idxExistente = valsVac.findIndex(r =>
        parseInt(r[0]) === anio && String(r[1]).trim().toLowerCase() === nombre.toLowerCase()
      );

      let fiStr = '';
      if (fechaIngreso instanceof Date) {
        fiStr = Utilities.formatDate(fechaIngreso, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      } else {
        fiStr = String(fechaIngreso || '').trim();
      }

      if (idxExistente >= 1) {
        const usados = parseInt(valsVac[idxExistente][4]) || 0;
        const ajuste = parseInt(valsVac[idxExistente][5]) || 0;
        hojaVac.getRange(idxExistente + 1, 1, 1, 7).setValues([[
          anio, nombre, fiStr, diasBanco, usados, ajuste, diasBanco + ajuste - usados
        ]]);
      } else {
        hojaVac.appendRow([anio, nombre, fiStr, diasBanco, 0, 0, diasBanco]);
      }
      procesados++;
    });

    // No se vuelca el dataset completo (nombres/fechas) — solo el resumen.
    registrarAuditoria(actor, 'VACACIONES_INICIALIZADAS', 'VACACIONES', String(anio), null, { anio, empleados_afectados: procesados });

    return _resp({ ok: true, total: procesados, anio });
  } finally {
    lock.releaseLock();
  }
}

function accionVacacionesAjustar(datos) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return _resp({ ok: false, error: 'Sistema ocupado, reintentá en unos segundos' });
  try {
    const actor       = String(datos.actor    || 'desconocido');
    const empleado    = String(datos.empleado || '').trim();
    const anio        = parseInt(datos.anio) || new Date().getFullYear();
    const ajusteDelta = parseInt(datos.ajuste || '0');
    const nota        = String(datos.nota || '').trim();
    if (!empleado) return _resp({ ok: false, error: 'Falta empleado' });
    if (!ajusteDelta) return _resp({ ok: false, error: 'El ajuste no puede ser 0' });

    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const hojaVac = ss.getSheetByName('VACACIONES');
    if (!hojaVac) return _resp({ ok: false, error: 'Hoja VACACIONES no encontrada' });

    const vals = hojaVac.getDataRange().getValues();
    const idx  = vals.findIndex((r,i) => i>0 &&
      parseInt(r[0]) === anio && String(r[1]).trim().toLowerCase() === empleado.toLowerCase()
    );
    if (idx < 1) return _resp({ ok: false, error: `No se encontró banco para ${empleado} en ${anio}` });

    const banco         = parseInt(vals[idx][3]) || 0;
    const usados         = parseInt(vals[idx][4]) || 0;
    const ajusteAnterior = parseInt(vals[idx][5]) || 0;
    const ajusteNuevo    = ajusteAnterior + ajusteDelta;
    const disponibleAntes = banco + ajusteAnterior - usados;
    const disponibleDespues = banco + ajusteNuevo - usados;

    hojaVac.getRange(idx + 1, 6).setValue(ajusteNuevo);
    hojaVac.getRange(idx + 1, 7).setValue(disponibleDespues);

    if (nota) {
      const totalCols = hojaVac.getLastColumn();
      if (totalCols < 8) hojaVac.getRange(1,8).setValue('NOTAS_AJUSTE');
      const notaExistente = String(hojaVac.getRange(idx + 1, 8).getValue() || '');
      const timestamp     = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy');
      hojaVac.getRange(idx + 1, 8).setValue(
        (notaExistente ? notaExistente + ' | ' : '') + `${timestamp}: ${ajusteDelta>0?'+':''}${ajusteDelta} (${nota})`
      );
    }

    registrarAuditoria(actor, 'VACACIONES_AJUSTADAS', 'VACACIONES', empleado + '|' + anio,
      { ajuste: ajusteAnterior, disponible: disponibleAntes },
      { ajuste: ajusteNuevo, disponible: disponibleDespues, delta: ajusteDelta, nota }
    );

    return _resp({ ok: true, nuevo_ajuste: ajusteNuevo, disponible: disponibleDespues });
  } finally {
    lock.releaseLock();
  }
}

function accionVacacionesAgregarAdmin(datos) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return _resp({ ok: false, error: 'Sistema ocupado, reintentá en unos segundos' });
  try {
    const actor      = String(datos.actor       || 'desconocido');
    const empleado   = String(datos.empleado    || '').trim();
    const fechaDesde = String(datos.fecha_desde || '').trim();
    const fechaHasta = String(datos.fecha_hasta || '').trim();
    const dias       = parseInt(datos.dias) || 1;
    if (!empleado || !fechaDesde || !fechaHasta) return _resp({ ok: false, error: 'Faltan datos' });

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let hoja = ss.getSheetByName('SOLICITUDES_VAC');
    if (!hoja) {
      hoja = ss.insertSheet('SOLICITUDES_VAC');
      hoja.getRange(1,1,1,8).setValues([[
        'ID','EMPLEADO','FECHA_DESDE','FECHA_HASTA','DIAS','ESTADO','FECHA_SOLICITUD','NOTA_ADMIN'
      ]]);
    }

    const id    = 'vac_' + Date.now();
    const ahora = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    hoja.appendRow([id, empleado, fechaDesde, fechaHasta, dias, 'aprobada', ahora, 'Cargado por admin']);

    descontarDiasVacaciones(ss, empleado, fechaDesde, dias);

    registrarAuditoria(actor, 'VACACIONES_AGREGADAS_ADMIN', 'SOLICITUD_VAC', id,
      null, { empleado, fecha_desde: fechaDesde, fecha_hasta: fechaHasta, dias }
    );

    return _resp({ ok: true, id });
  } finally {
    lock.releaseLock();
  }
}

// ── CERTIFICADOS ──────────────────────────────────────
// Hoja CERTIFICADOS: ID | EMPLEADO | FECHA | TIPO | HS | NOTA

function getCertificados() {
  try {
    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    let hoja   = ss.getSheetByName('CERTIFICADOS');
    if (!hoja) {
      hoja = ss.insertSheet('CERTIFICADOS');
      hoja.getRange(1,1,1,6).setValues([['ID','EMPLEADO','FECHA','TIPO','HS','NOTA']]);
      return ContentService.createTextOutput(JSON.stringify({ok:true,certificados:[]}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const vals = hoja.getDataRange().getValues();
    if (vals.length < 2) return ContentService.createTextOutput(JSON.stringify({ok:true,certificados:[]}))
      .setMimeType(ContentService.MimeType.JSON);

    const headers = vals[0].map(h => String(h).trim().toLowerCase());
    const certs = vals.slice(1).filter(r => r[0]).map(r => {
      const fechaVal = r[headers.indexOf('fecha')];
      let fechaStr;
      if (fechaVal instanceof Date) {
        fechaStr = Utilities.formatDate(fechaVal, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      } else {
        fechaStr = String(fechaVal || '').trim();
      }
      return {
        id:       String(r[headers.indexOf('id')]       || '').trim(),
        empleado: String(r[headers.indexOf('empleado')] || '').trim(),
        fecha:    fechaStr,
        tipo:     String(r[headers.indexOf('tipo')]     || '').trim(),
        hs:       parseFloat(r[headers.indexOf('hs')])  || 0,
        nota:     String(r[headers.indexOf('nota')]     || '').trim(),
      };
    });
    return ContentService.createTextOutput(JSON.stringify({ok:true,certificados:certs}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ok:false,error:err.message}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function guardarCertificado(e) {
  try {
    const datos = JSON.parse(decodeURIComponent(e.parameter.datos || '{}'));
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    let hoja    = ss.getSheetByName('CERTIFICADOS');
    if (!hoja) {
      hoja = ss.insertSheet('CERTIFICADOS');
      hoja.getRange(1,1,1,6).setValues([['ID','EMPLEADO','FECHA','TIPO','HS','NOTA']]);
    }
    // Generar ID único
    const id = 'cert_' + Date.now();
    hoja.appendRow([id, datos.empleado||'', datos.fecha||'', datos.tipo||'', datos.hs||0, datos.nota||'']);
    return ContentService.createTextOutput(JSON.stringify({ok:true,id}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ok:false,error:err.message}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function borrarCertificado(e) {
  try {
    const id   = e.parameter.id || '';
    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = ss.getSheetByName('CERTIFICADOS');
    if (!hoja) return ContentService.createTextOutput(JSON.stringify({ok:false,error:'Hoja no encontrada'}))
      .setMimeType(ContentService.MimeType.JSON);
    const vals = hoja.getDataRange().getValues();
    for (let i = 1; i < vals.length; i++) {
      if (String(vals[i][0]).trim() === id) {
        hoja.deleteRow(i + 1);
        return ContentService.createTextOutput(JSON.stringify({ok:true}))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ok:false,error:'No encontrado'}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ok:false,error:err.message}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── CERTIFICADOS — acciones seguras (Fase 6B) ─────────
// Mismo criterio que las de VACACIONES de arriba: llegan solo por
// despacharAccionSegura, actor sale de datos.actor (Node/JWT admin-jefe,
// nunca del navegador). guardarCertificado/borrarCertificado (legadas,
// arriba) quedan intactas mientras dure la transición. `empleado` viene
// especificado por el admin que llama (Node ya validó su rol) — hoy no
// hay ningún flujo real de autoservicio confirmado para certificados
// (ver informe Fase 6B), así que no se deriva de identidad propia.
// No se corrige acá el ID `cert_<Date.now()>` (mismo criterio que la
// función legada) — no bloquea el blindaje, queda documentado como deuda.
function accionCertificadoGuardar(datos) {
  const actor    = String(datos.actor    || 'desconocido');
  const empleado = String(datos.empleado || '').trim();
  const fecha    = String(datos.fecha    || '').trim();
  if (!empleado || !fecha) return _resp({ ok: false, error: 'Faltan datos' });

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName('CERTIFICADOS');
  if (!hoja) {
    hoja = ss.insertSheet('CERTIFICADOS');
    hoja.getRange(1,1,1,6).setValues([['ID','EMPLEADO','FECHA','TIPO','HS','NOTA']]);
  }
  const id = 'cert_' + Date.now();
  hoja.appendRow([id, empleado, fecha, datos.tipo || '', datos.hs || 0, datos.nota || '']);

  registrarAuditoria(actor, 'CERTIFICADO_CREADO', 'CERTIFICADO', id,
    null, { empleado, fecha, tipo: datos.tipo || '' }
  );

  return _resp({ ok: true, id });
}

function accionCertificadoBorrar(datos) {
  const actor = String(datos.actor || 'desconocido');
  const id    = String(datos.id    || '').trim();
  if (!id) return _resp({ ok: false, error: 'Falta id' });

  const ss   = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName('CERTIFICADOS');
  if (!hoja) return _resp({ ok: false, error: 'Hoja no encontrada' });

  const vals = hoja.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === id) {
      const antes = { empleado: String(vals[i][1] || ''), fecha: String(vals[i][2] || ''), tipo: String(vals[i][3] || '') };
      hoja.deleteRow(i + 1);
      registrarAuditoria(actor, 'CERTIFICADO_BORRADO', 'CERTIFICADO', id, antes, null);
      return _resp({ ok: true });
    }
  }
  return _resp({ ok: false, error: 'No encontrado' });
}

// ── GUARDAR URL DE FOTO (subida desde ImgBB) ──────────
function guardarFotoUrl(e) {
  try {
    const empleado = decodeURIComponent(e.parameter.empleado || '');
    const fotoUrl  = decodeURIComponent(e.parameter.foto_url || '');

    if (!empleado || !fotoUrl) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'Faltan datos' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = ss.getSheetByName('EMPLEADOS');
    if (!hoja) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'Hoja EMPLEADOS no encontrada' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const vals = hoja.getDataRange().getValues();
    for (let i = 1; i < vals.length; i++) {
      if (String(vals[i][0]).trim() === empleado) {
        hoja.getRange(i + 1, 5).setValue(fotoUrl);
        return ContentService.createTextOutput(JSON.stringify({ ok: true, foto_url: fotoUrl }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'Empleado no encontrado' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
// ══════════════════════════════════════════════════════
//  VACACIONES — Sistema completo
//  Hojas: CONFIG | VACACIONES | SOLICITUDES_VAC
// ══════════════════════════════════════════════════════

// ── CONFIG ─────────────────────────────────────────────
// Hoja CONFIG: CLAVE | VALOR
function getConfig() {
  try {
    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    let hoja   = ss.getSheetByName('CONFIG');
    if (!hoja) {
      hoja = ss.insertSheet('CONFIG');
      hoja.getRange(1,1,1,2).setValues([['CLAVE','VALOR']]);
      return ContentService.createTextOutput(JSON.stringify({ ok: true, config: {} }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const vals = hoja.getDataRange().getValues();
    const config = {};
    vals.slice(1).forEach(r => {
      if (r[0]) config[String(r[0]).trim()] = String(r[1] || '').trim();
    });
    return ContentService.createTextOutput(JSON.stringify({ ok: true, config }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function guardarConfig(e) {
  try {
    const clave = String(e.parameter.clave || '').trim();
    const valor = String(e.parameter.valor || '').trim();
    if (!clave) throw new Error('Falta clave');
    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    let hoja   = ss.getSheetByName('CONFIG');
    if (!hoja) {
      hoja = ss.insertSheet('CONFIG');
      hoja.getRange(1,1,1,2).setValues([['CLAVE','VALOR']]);
    }
    const vals = hoja.getDataRange().getValues();
    const idx  = vals.findIndex(r => String(r[0]).trim() === clave);
    if (idx >= 1) {
      hoja.getRange(idx+1, 2).setValue(valor);
    } else {
      hoja.appendRow([clave, valor]);
    }
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── VACACIONES: BANCO DE DÍAS ──────────────────────────
// Hoja VACACIONES: AÑO | EMPLEADO | FECHA_INGRESO | DIAS_BANCO | DIAS_USADOS | DIAS_AJUSTE | DIAS_DISPONIBLES

function calcularDiasVacaciones(fechaIngreso, anio) {
  // Ley argentina: antigüedad al 31/12 del año en cuestión
  // < 6 meses: 1 día x mes trabajado (mínimo 0)
  // 6m - 5 años:  14 días
  // 5 - 10 años:  21 días
  // 10 - 20 años: 28 días
  // > 20 años:    35 días
  if (!fechaIngreso) return 14; // fallback
  let fi;
  if (fechaIngreso instanceof Date) {
    fi = fechaIngreso;
  } else {
    const s = String(fechaIngreso);
    const p = s.split('-');
    if (p.length === 3) fi = new Date(parseInt(p[0]), parseInt(p[1])-1, parseInt(p[2]));
    else fi = new Date(s);
  }
  if (isNaN(fi.getTime())) return 14;

  const cierre = new Date(anio, 11, 31); // 31/12 del año
  const meses  = (cierre.getFullYear() - fi.getFullYear()) * 12 + (cierre.getMonth() - fi.getMonth());

  if (meses < 6)   return Math.max(0, meses); // 1 día por mes (proporcional)
  const anios = meses / 12;
  if (anios < 5)   return 14;
  if (anios < 10)  return 21;
  if (anios < 20)  return 28;
  return 35;
}

function getVacaciones(e) {
  try {
    const empleado = String(e.parameter.empleado || '').trim();
    const anio     = parseInt(e.parameter.anio || new Date().getFullYear());
    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    let hoja   = ss.getSheetByName('VACACIONES');
    if (!hoja) {
      hoja = ss.insertSheet('VACACIONES');
      hoja.getRange(1,1,1,7).setValues([[
        'AÑO','EMPLEADO','FECHA_INGRESO','DIAS_BANCO','DIAS_USADOS','DIAS_AJUSTE','DIAS_DISPONIBLES'
      ]]);
      return ContentService.createTextOutput(JSON.stringify({ ok: true, vacaciones: [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const vals = hoja.getDataRange().getValues();
    let filas  = vals.slice(1).filter(r => r[0] && r[1]);

    if (empleado) filas = filas.filter(r => String(r[1]).trim().toLowerCase() === empleado.toLowerCase());
    if (anio)     filas = filas.filter(r => parseInt(r[0]) === anio);

    const vacaciones = filas.map(r => {
      const banco     = parseInt(r[3]) || 0;
      const usados    = parseInt(r[4]) || 0;
      const ajuste    = parseInt(r[5]) || 0;
      const disponible= banco + ajuste - usados;
      return {
        anio:             parseInt(r[0]),
        empleado:         String(r[1]).trim(),
        fecha_ingreso:    r[2] instanceof Date
          ? Utilities.formatDate(r[2], Session.getScriptTimeZone(), 'yyyy-MM-dd')
          : String(r[2] || '').trim(),
        dias_banco:       banco,
        dias_usados:      usados,
        dias_ajuste:      ajuste,
        dias_disponibles: disponible,
      };
    });
    return ContentService.createTextOutput(JSON.stringify({ ok: true, vacaciones }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function inicializarVacacionesAnio(e) {
  try {
    const anio = parseInt((e && e.parameter && e.parameter.anio) || new Date().getFullYear());
    const ss   = SpreadsheetApp.getActiveSpreadsheet();

    // Leer hoja EMPLEADOS para obtener nombres y fecha de ingreso
    const hojaEmp = ss.getSheetByName('EMPLEADOS');
    if (!hojaEmp) throw new Error('Hoja EMPLEADOS no encontrada');

    // Columnas EMPLEADOS: NOMBRE | EMPRESA | CATEGORIA | HS_BASE | FOTO_URL | ACTIVO | REGLA_CUSTOM | FECHA_INGRESO
    // FECHA_INGRESO puede estar en col 7 (índice 7) — se crea si no existe
    const valsEmp = hojaEmp.getDataRange().getValues();
    const headers = valsEmp[0].map(h => String(h).trim().toUpperCase());
    let colFI     = headers.indexOf('FECHA_INGRESO');
    if (colFI < 0) {
      // Agregar columna FECHA_INGRESO al final
      colFI = headers.length;
      hojaEmp.getRange(1, colFI+1).setValue('FECHA_INGRESO');
    }

    let hojaVac = ss.getSheetByName('VACACIONES');
    if (!hojaVac) {
      hojaVac = ss.insertSheet('VACACIONES');
      hojaVac.getRange(1,1,1,7).setValues([[
        'AÑO','EMPLEADO','FECHA_INGRESO','DIAS_BANCO','DIAS_USADOS','DIAS_AJUSTE','DIAS_DISPONIBLES'
      ]]);
    }

    const valsVac  = hojaVac.getDataRange().getValues();
    let procesados = 0;

    valsEmp.slice(1).forEach(row => {
      if (!row[0]) return; // nombre vacío
      const nombre     = String(row[0]).trim();
      const activo     = row[5] !== false && row[5] !== 'FALSE';
      if (!activo) return;
      const fechaIngreso = row[colFI] || null;
      const diasBanco    = calcularDiasVacaciones(fechaIngreso, anio);

      // Buscar fila existente para este empleado/año
      const idxExistente = valsVac.findIndex(r =>
        parseInt(r[0]) === anio && String(r[1]).trim().toLowerCase() === nombre.toLowerCase()
      );

      let fiStr = '';
      if (fechaIngreso instanceof Date) {
        fiStr = Utilities.formatDate(fechaIngreso, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      } else {
        fiStr = String(fechaIngreso || '').trim();
      }

      if (idxExistente >= 1) {
        // Actualizar solo banco y fecha ingreso, preservar usados y ajuste
        const usados = parseInt(valsVac[idxExistente][4]) || 0;
        const ajuste = parseInt(valsVac[idxExistente][5]) || 0;
        hojaVac.getRange(idxExistente+1, 1, 1, 7).setValues([[
          anio, nombre, fiStr, diasBanco, usados, ajuste, diasBanco + ajuste - usados
        ]]);
      } else {
        hojaVac.appendRow([anio, nombre, fiStr, diasBanco, 0, 0, diasBanco]);
      }
      procesados++;
    });

    return ContentService.createTextOutput(JSON.stringify({ ok: true, total: procesados, anio }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function ajustarDiasVacaciones(e) {
  try {
    const empleado = String(e.parameter.empleado || '').trim();
    const anio     = parseInt(e.parameter.anio || new Date().getFullYear());
    const ajusteDelta = parseInt(e.parameter.ajuste || '0');
    const nota     = String(e.parameter.nota || '').trim();
    if (!empleado) throw new Error('Falta empleado');

    const ss      = SpreadsheetApp.getActiveSpreadsheet();
    let hojaVac   = ss.getSheetByName('VACACIONES');
    if (!hojaVac) throw new Error('Hoja VACACIONES no encontrada');

    const vals = hojaVac.getDataRange().getValues();
    const idx  = vals.findIndex((r,i) => i>0 &&
      parseInt(r[0]) === anio && String(r[1]).trim().toLowerCase() === empleado.toLowerCase()
    );
    if (idx < 1) throw new Error(`No se encontró banco para ${empleado} en ${anio}`);

    const banco  = parseInt(vals[idx][3]) || 0;
    const usados = parseInt(vals[idx][4]) || 0;
    const ajusteActual = parseInt(vals[idx][5]) || 0;
    const nuevoAjuste  = ajusteActual + ajusteDelta;
    const disponible   = banco + nuevoAjuste - usados;

    hojaVac.getRange(idx+1, 6).setValue(nuevoAjuste);
    hojaVac.getRange(idx+1, 7).setValue(disponible);

    // Registrar el ajuste en una nota auxiliar (col 8 si existe)
    if (nota) {
      const totalCols = hojaVac.getLastColumn();
      if (totalCols < 8) hojaVac.getRange(1,8).setValue('NOTAS_AJUSTE');
      const notaExistente = String(hojaVac.getRange(idx+1, 8).getValue() || '');
      const timestamp     = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy');
      hojaVac.getRange(idx+1, 8).setValue(
        (notaExistente ? notaExistente + ' | ' : '') + `${timestamp}: ${ajusteDelta>0?'+':''}${ajusteDelta} (${nota})`
      );
    }

    return ContentService.createTextOutput(JSON.stringify({ ok: true, nuevo_ajuste: nuevoAjuste, disponible }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Descuenta `dias` del banco de vacaciones de `empleado` para el año que
// corresponda a `fechaDesde` (Date o string yyyy-MM-dd). Usado tanto al
// aprobar una solicitud del empleado como al cargar vacaciones directo
// desde el admin.
function descontarDiasVacaciones(ss, empleado, fechaDesde, dias) {
  let anio = new Date().getFullYear();
  if (fechaDesde instanceof Date) {
    anio = fechaDesde.getFullYear();
  } else if (typeof fechaDesde === 'string' && fechaDesde.length >= 4) {
    anio = parseInt(fechaDesde.substring(0,4));
  }

  const hojaVac = ss.getSheetByName('VACACIONES');
  if (!hojaVac) return;
  const vVac = hojaVac.getDataRange().getValues();
  const iVac = vVac.findIndex((r,i) => i>0 &&
    parseInt(r[0]) === anio && String(r[1]).trim().toLowerCase() === empleado.toLowerCase()
  );
  if (iVac < 1) return;
  const banco      = parseInt(vVac[iVac][3]) || 0;
  const usados     = (parseInt(vVac[iVac][4]) || 0) + dias;
  const ajuste     = parseInt(vVac[iVac][5]) || 0;
  const disponible = banco + ajuste - usados;
  hojaVac.getRange(iVac+1, 5).setValue(usados);
  hojaVac.getRange(iVac+1, 7).setValue(disponible);
}

// ── SOLICITUDES DE VACACIONES ──────────────────────────
// Hoja SOLICITUDES_VAC: ID | EMPLEADO | FECHA_DESDE | FECHA_HASTA | DIAS | ESTADO | FECHA_SOLICITUD | NOTA_ADMIN

function solicitarVacaciones(e) {
  try {
    const datos = JSON.parse(decodeURIComponent(e.parameter.datos || '{}'));
    const empleado    = String(datos.empleado     || '').trim();
    const fechaDesde  = String(datos.fecha_desde  || '').trim();
    const fechaHasta  = String(datos.fecha_hasta  || '').trim();
    const dias        = parseInt(datos.dias) || 1;
    if (!empleado || !fechaDesde || !fechaHasta) throw new Error('Faltan datos');

    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    let hoja   = ss.getSheetByName('SOLICITUDES_VAC');
    if (!hoja) {
      hoja = ss.insertSheet('SOLICITUDES_VAC');
      hoja.getRange(1,1,1,8).setValues([[
        'ID','EMPLEADO','FECHA_DESDE','FECHA_HASTA','DIAS','ESTADO','FECHA_SOLICITUD','NOTA_ADMIN'
      ]]);
    }

    const id        = 'vac_' + Date.now();
    const ahora     = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    hoja.appendRow([id, empleado, fechaDesde, fechaHasta, dias, 'pendiente', ahora, '']);

    // Enviar email al admin
    try {
      const config = {};
      const hojaConfig = ss.getSheetByName('CONFIG');
      if (hojaConfig) {
        hojaConfig.getDataRange().getValues().slice(1).forEach(r => {
          if (r[0]) config[String(r[0]).trim()] = String(r[1] || '').trim();
        });
      }
      const emailAdmin = config['email_admin'];
      if (emailAdmin) {
        const nomMostrar = empleado.replace(/^\d+\s+/, '');
        const fechaDesdeFmt = formatearFechaEmail(fechaDesde);
        const fechaHastaFmt = formatearFechaEmail(fechaHasta);
        const fechaSolicitud = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
        MailApp.sendEmail({
          to:       emailAdmin,
          subject:  `📅 Nueva solicitud de vacaciones — ${nomMostrar}`,
          htmlBody: buildEmailAdminSolicitud({ nomMostrar, fechaDesdeFmt, fechaHastaFmt, dias, fechaSolicitud }),
        });
      }
    } catch(mailErr) {
      // No bloquear si falla el email
      Logger.log('Error enviando email: ' + mailErr.message);
    }

    return ContentService.createTextOutput(JSON.stringify({ ok: true, id }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function getSolicitudesVacaciones(e) {
  try {
    const empleadoFiltro = String(e.parameter.empleado || '').trim().toLowerCase();
    const estadoFiltro   = String(e.parameter.estado   || '').trim().toLowerCase();
    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    let hoja   = ss.getSheetByName('SOLICITUDES_VAC');
    if (!hoja) {
      hoja = ss.insertSheet('SOLICITUDES_VAC');
      hoja.getRange(1,1,1,8).setValues([[
        'ID','EMPLEADO','FECHA_DESDE','FECHA_HASTA','DIAS','ESTADO','FECHA_SOLICITUD','NOTA_ADMIN'
      ]]);
      return ContentService.createTextOutput(JSON.stringify({ ok: true, solicitudes: [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const vals = hoja.getDataRange().getValues();
    let filas  = vals.slice(1).filter(r => r[0]);

    if (empleadoFiltro) {
      filas = filas.filter(r => String(r[1]).trim().toLowerCase() === empleadoFiltro);
    }
    if (estadoFiltro) {
      filas = filas.filter(r => String(r[5]).trim().toLowerCase() === estadoFiltro);
    }

    const solicitudes = filas.map(r => ({
      id:               String(r[0]).trim(),
      empleado:         String(r[1]).trim(),
      fecha_desde:      r[2] instanceof Date
        ? Utilities.formatDate(r[2], Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : String(r[2] || '').trim(),
      fecha_hasta:      r[3] instanceof Date
        ? Utilities.formatDate(r[3], Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : String(r[3] || '').trim(),
      dias:             parseInt(r[4]) || 0,
      estado:           String(r[5] || 'pendiente').trim(),
      fecha_solicitud:  r[6] instanceof Date
        ? Utilities.formatDate(r[6], Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : String(r[6] || '').substring(0,10),
      nota_admin:       String(r[7] || '').trim(),
    })).sort((a,b) => b.fecha_solicitud.localeCompare(a.fecha_solicitud));

    return ContentService.createTextOutput(JSON.stringify({ ok: true, solicitudes }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function responderSolicitud(e) {
  try {
    const id        = String(e.parameter.id         || '').trim();
    const estado    = String(e.parameter.estado      || '').trim();
    const notaAdmin = String(e.parameter.nota_admin  || '').trim();
    if (!id || !estado) throw new Error('Faltan datos');
    if (!['aprobada','rechazada'].includes(estado)) throw new Error('Estado inválido');

    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = ss.getSheetByName('SOLICITUDES_VAC');
    if (!hoja) throw new Error('Hoja no encontrada');

    const vals = hoja.getDataRange().getValues();
    const idx  = vals.findIndex(r => String(r[0]).trim() === id);
    if (idx < 1) throw new Error('Solicitud no encontrada');

    // Actualizar estado y nota
    hoja.getRange(idx+1, 6).setValue(estado);
    hoja.getRange(idx+1, 8).setValue(notaAdmin);

    // Si aprobada: descontar días en VACACIONES
    if (estado === 'aprobada') {
      const empleado   = String(vals[idx][1]).trim();
      const dias       = parseInt(vals[idx][4]) || 0;
      const fechaDesde = vals[idx][2];
      descontarDiasVacaciones(ss, empleado, fechaDesde, dias);
    }

    // Enviar email al empleado si tiene EMAIL en EMPLEADOS
    try {
      const empleado      = String(vals[idx][1]).trim();
      const fechaDesde    = vals[idx][2];
      const fechaHasta    = vals[idx][3];
      const diasSol       = parseInt(vals[idx][4]) || 0;
      const nomMostrar    = empleado.replace(/^\d+\s+/, '');
      const fechaDesdeFmt = formatearFechaEmail(
        fechaDesde instanceof Date
          ? Utilities.formatDate(fechaDesde, Session.getScriptTimeZone(), 'yyyy-MM-dd')
          : String(fechaDesde)
      );
      const fechaHastaFmt = formatearFechaEmail(
        fechaHasta instanceof Date
          ? Utilities.formatDate(fechaHasta, Session.getScriptTimeZone(), 'yyyy-MM-dd')
          : String(fechaHasta)
      );

      // Buscar email en hoja EMPLEADOS (columna cabecera "EMAIL")
      const hojaEmp = ss.getSheetByName('EMPLEADOS');
      if (hojaEmp) {
        const empVals  = hojaEmp.getDataRange().getValues();
        const headers  = empVals[0].map(h => String(h).trim().toUpperCase());
        const colEmail = headers.indexOf('EMAIL');
        const colNom   = headers.indexOf('EMPLEADO');
        if (colEmail >= 0 && colNom >= 0) {
          const fila = empVals.slice(1).find(r =>
            String(r[colNom] || '').trim().toLowerCase() === empleado.toLowerCase()
          );
          const emailEmp = fila ? String(fila[colEmail] || '').trim() : '';
          if (emailEmp) {
            MailApp.sendEmail({
              to:       emailEmp,
              subject:  estado === 'aprobada'
                ? `✅ Tus vacaciones fueron aprobadas`
                : `❌ Solicitud de vacaciones rechazada`,
              htmlBody: buildEmailEmpleadoRespuesta({ nomMostrar, estado, fechaDesdeFmt, fechaHastaFmt, diasSol, notaAdmin }),
            });
          }
        }
      }
    } catch(mailEmpErr) {
      Logger.log('Error enviando email al empleado: ' + mailEmpErr.message);
    }

    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Alta directa de vacaciones desde el admin: a diferencia de solicitarVacaciones
// (que crea una fila 'pendiente' que después hay que aprobar), esta queda
// 'aprobada' desde el primer momento y descuenta el banco al toque.
function agregarVacacionAdmin(e) {
  try {
    const datos = JSON.parse(decodeURIComponent(e.parameter.datos || '{}'));
    const empleado    = String(datos.empleado    || '').trim();
    const fechaDesde  = String(datos.fecha_desde || '').trim();
    const fechaHasta  = String(datos.fecha_hasta || '').trim();
    const dias        = parseInt(datos.dias) || 1;
    if (!empleado || !fechaDesde || !fechaHasta) throw new Error('Faltan datos');

    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    let hoja   = ss.getSheetByName('SOLICITUDES_VAC');
    if (!hoja) {
      hoja = ss.insertSheet('SOLICITUDES_VAC');
      hoja.getRange(1,1,1,8).setValues([[
        'ID','EMPLEADO','FECHA_DESDE','FECHA_HASTA','DIAS','ESTADO','FECHA_SOLICITUD','NOTA_ADMIN'
      ]]);
    }

    const id    = 'vac_' + Date.now();
    const ahora = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    hoja.appendRow([id, empleado, fechaDesde, fechaHasta, dias, 'aprobada', ahora, 'Cargado por admin']);

    descontarDiasVacaciones(ss, empleado, fechaDesde, dias);

    return ContentService.createTextOutput(JSON.stringify({ ok: true, id }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── Vacaciones aprobadas — lectura segura para el calendario nuevo de
//    AVISOS (avisos.js). Entra EXCLUSIVAMENTE por despacharAccionSegura,
//    igual patrón que las acciones de AVISOS — nunca por doGet. Es de
//    SOLO LECTURA: no crea, edita, aprueba ni rechaza ninguna solicitud.
//    No toca getSolicitudesVacaciones (doGet legacy, usado por el
//    calendario administrativo viejo de Vacaciones) — queda intacta, esta
//    es una función nueva y aparte que lee la misma hoja SOLICITUDES_VAC
//    con un shape de salida distinto, mínimo, pensado solo para pintar
//    celdas de calendario (id/empleado/fechaDesde/fechaHasta/dias/
//    sucursalId/estado), no para el flujo administrativo completo.
//
//    Sucursal: se resuelve en GAS contra la fuente real (hoja EMPLEADOS),
//    nunca confiando en nada enviado por el cliente. Se arma un mapa
//    empleado→sucursal_id con UNA sola lectura de EMPLEADOS por ejecución
//    (_mapaSucursalesPorEmpleado) en vez de llamar _buscarEmpleadoPorNombre
//    una vez por solicitud (que releería toda la hoja cada vez) — mismo
//    criterio de normalización de nombre y misma columna SUCURSAL_ID que
//    ya usa _buscarEmpleadoPorNombre/_filaEmpleadoAObjeto, sin modificar
//    ninguno de los dos.
//
//    Regla explícita (decisión de producto, no técnica): un empleado que
//    no puede resolverse contra EMPLEADOS devuelve sucursalId:'' — nunca
//    se asume una sucursal, nunca se usa un fallback. Es responsabilidad
//    del consumidor (avisos.js, etapa futura) decidir qué hacer con
//    sucursalId:'' (omitir del calendario, no mostrarlo en ninguna tab
//    incluida "Todas"). Acá solo se reporta el hecho, nunca se inventa
//    un valor. Un registro no resoluble NUNCA hace fallar la respuesta
//    completa — se devuelve igual, con sucursalId:''.
function _mapaSucursalesPorEmpleado() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName('EMPLEADOS');
  const mapa = {};
  if (!hoja) return mapa;
  const headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim().toUpperCase(); });
  const colSucursal = headers.indexOf('SUCURSAL_ID');
  if (colSucursal < 0) return mapa;
  const vals = hoja.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    const nombreNorm = _normalizarNombreEmpleado(vals[i][0]);
    if (!nombreNorm) continue;
    mapa[nombreNorm] = String(vals[i][colSucursal] || '');
  }
  return mapa;
}

function accionGetSolicitudesVacAprobadas(datos) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = ss.getSheetByName('SOLICITUDES_VAC');
    if (!hoja) return _resp({ ok: true, solicitudes: [], no_resolubles: [] });

    const vals = hoja.getDataRange().getValues();
    // Mismo criterio de columnas que getSolicitudesVacaciones (legacy, sin
    // modificar): 0=ID 1=EMPLEADO 2=FECHA_DESDE 3=FECHA_HASTA 4=DIAS
    // 5=ESTADO 6=FECHA_SOLICITUD 7=NOTA_ADMIN.
    const filas = vals.slice(1).filter(function (r) { return r[0]; })
      .filter(function (r) { return String(r[5] || '').trim() === 'aprobada'; });

    const mapaSucursales = _mapaSucursalesPorEmpleado();
    const noResolubles = [];

    const solicitudes = filas.map(function (r) {
      const empleado = String(r[1]).trim();
      const sucursalId = mapaSucursales[_normalizarNombreEmpleado(empleado)] || '';
      if (!sucursalId) noResolubles.push(empleado);
      return {
        id:         String(r[0]).trim(),
        empleado:   empleado,
        fechaDesde: r[2] instanceof Date
          ? Utilities.formatDate(r[2], Session.getScriptTimeZone(), 'yyyy-MM-dd')
          : String(r[2] || '').trim(),
        fechaHasta: r[3] instanceof Date
          ? Utilities.formatDate(r[3], Session.getScriptTimeZone(), 'yyyy-MM-dd')
          : String(r[3] || '').trim(),
        dias:       parseInt(r[4]) || 0,
        sucursalId: sucursalId,
        estado:     'aprobada',
      };
    });

    // Evidencia diagnóstica — mismo patrón ya usado en todo el archivo
    // (Logger.log, visible en el panel de Ejecuciones de Apps Script), sin
    // agregar ningún sistema de logging nuevo. Se agrega además como campo
    // de la respuesta (no por vacación individual — el shape de cada
    // vacación se mantiene mínimo) para que QA pueda verificarlo sin tener
    // que abrir los logs de ejecución de GAS.
    if (noResolubles.length) {
      Logger.log('get_solicitudes_vac_aprobadas: empleados no resolubles contra EMPLEADOS: ' + noResolubles.join(', '));
    }

    return _resp({ ok: true, solicitudes: solicitudes, no_resolubles: noResolubles });
  } catch (err) {
    return _resp({ ok: false, error: err.message });
  }
}

// ── TRIGGER AUTOMÁTICO 01/01 ───────────────────────────
// Correr UNA VEZ manualmente desde Apps Script para registrar el trigger
function crearTriggerAnioNuevo() {
  // Eliminar triggers previos del mismo tipo para evitar duplicados
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'triggerInicializarVacNuevoAnio') {
      ScriptApp.deleteTrigger(t);
    }
  });
  // Corre el día 1 de cada mes — el handler filtra para ejecutar solo en enero
  ScriptApp.newTrigger('triggerInicializarVacNuevoAnio')
    .timeBased()
    .onMonthDay(1)
    .atHour(6)
    .create();
  Logger.log('Trigger creado: corre el día 1 de cada mes, inicializa vacaciones solo en enero');
}

function triggerInicializarVacNuevoAnio() {
  // Solo ejecutar en enero
  if (new Date().getMonth() !== 0) return;
  inicializarVacacionesAnio({ parameter: { anio: new Date().getFullYear() } });
}

// ── HELPERS DE EMAIL ──────────────────────────────────

/**
 * Convierte "yyyy-MM-dd" → "dd/MM/yyyy"
 */
function formatearFechaEmail(isoStr) {
  if (!isoStr) return isoStr;
  const s = String(isoStr).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

/**
 * Email HTML al administrador: nueva solicitud de vacaciones
 */
function buildEmailAdminSolicitud({ nomMostrar, fechaDesdeFmt, fechaHastaFmt, dias, fechaSolicitud }) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">

        <!-- Header -->
        <tr><td style="background:#1e293b;border-radius:12px 12px 0 0;padding:28px 36px">
          <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:2px;color:#94a3b8;text-transform:uppercase">Croma · Gestión de personal</p>
          <h1 style="margin:8px 0 0;font-size:22px;font-weight:700;color:#ffffff">📅 Nueva solicitud de vacaciones</h1>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#ffffff;padding:32px 36px">
          <p style="margin:0 0 20px;font-size:15px;color:#334155">
            <strong>${nomMostrar}</strong> solicitó un período de vacaciones y está esperando tu respuesta.
          </p>

          <!-- Detalle -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:28px">
            <tr>
              <td style="padding:16px 20px;border-bottom:1px solid #e2e8f0">
                <p style="margin:0;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px">Empleado</p>
                <p style="margin:4px 0 0;font-size:15px;font-weight:600;color:#1e293b">${nomMostrar}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding:16px 20px;border-bottom:1px solid #e2e8f0;border-right:1px solid #e2e8f0;width:50%">
                      <p style="margin:0;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px">Desde</p>
                      <p style="margin:4px 0 0;font-size:15px;font-weight:600;color:#1e293b">${fechaDesdeFmt}</p>
                    </td>
                    <td style="padding:16px 20px;border-bottom:1px solid #e2e8f0;width:50%">
                      <p style="margin:0;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px">Hasta</p>
                      <p style="margin:4px 0 0;font-size:15px;font-weight:600;color:#1e293b">${fechaHastaFmt}</p>
                    </td>
                  </tr>
                  <tr>
                    <td colspan="2" style="padding:16px 20px">
                      <p style="margin:0;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px">Total de días</p>
                      <p style="margin:4px 0 0;font-size:15px;font-weight:600;color:#1e293b">${dias} día${dias !== 1 ? 's' : ''} corrido${dias !== 1 ? 's' : ''}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          <p style="margin:0 0 28px;font-size:14px;color:#64748b">
            Ingresá al panel de administración para revisar y responder la solicitud.
          </p>

          <!-- CTA -->
          <table cellpadding="0" cellspacing="0">
            <tr><td style="background:#2563eb;border-radius:8px">
              <a href="https://depocroma-max.github.io/croma-horarios/" target="_blank"
                 style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none">
                Ir al panel →
              </a>
            </td></tr>
          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f8fafc;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:16px 36px">
          <p style="margin:0;font-size:12px;color:#94a3b8">Solicitud recibida el ${fechaSolicitud} · Croma Horarios</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Email HTML al empleado: respuesta a su solicitud (aprobada o rechazada)
 */
function buildEmailEmpleadoRespuesta({ nomMostrar, estado, fechaDesdeFmt, fechaHastaFmt, diasSol, notaAdmin }) {
  const aprobada   = estado === 'aprobada';
  const colorAccent = aprobada ? '#16a34a' : '#dc2626';
  const bgAccent    = aprobada ? '#f0fdf4' : '#fef2f2';
  const borderAcc   = aprobada ? '#bbf7d0' : '#fecaca';
  const icono       = aprobada ? '✅' : '❌';
  const titulo      = aprobada ? 'Vacaciones aprobadas' : 'Solicitud rechazada';
  const mensajePpal = aprobada
    ? `Tu solicitud de vacaciones fue <strong>aprobada</strong>. ¡Que las disfrutes!`
    : `Tu solicitud de vacaciones fue <strong>rechazada</strong> por el administrador.`;

  const notaHtml = notaAdmin
    ? `<tr><td style="padding:20px 36px 0">
        <table width="100%" cellpadding="0" cellspacing="0"
               style="background:${bgAccent};border:1px solid ${borderAcc};border-radius:10px;padding:16px 20px">
          <tr><td>
            <p style="margin:0;font-size:11px;font-weight:700;color:${colorAccent};text-transform:uppercase;letter-spacing:1px">Nota del administrador</p>
            <p style="margin:6px 0 0;font-size:14px;color:#334155">${notaAdmin}</p>
          </td></tr>
        </table>
      </td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">

        <!-- Header -->
        <tr><td style="background:#1e293b;border-radius:12px 12px 0 0;padding:28px 36px">
          <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:2px;color:#94a3b8;text-transform:uppercase">Croma · Gestión de personal</p>
          <h1 style="margin:8px 0 0;font-size:22px;font-weight:700;color:#ffffff">${icono} ${titulo}</h1>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#ffffff;padding:32px 36px">
          <p style="margin:0 0 20px;font-size:15px;color:#334155">
            Hola <strong>${nomMostrar}</strong>, ${mensajePpal}
          </p>

          <!-- Detalle período -->
          <table width="100%" cellpadding="0" cellspacing="0"
                 style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:8px">
            <tr>
              <td style="padding:16px 20px;border-right:1px solid #e2e8f0;width:50%">
                <p style="margin:0;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px">Desde</p>
                <p style="margin:4px 0 0;font-size:15px;font-weight:600;color:#1e293b">${fechaDesdeFmt}</p>
              </td>
              <td style="padding:16px 20px;width:50%">
                <p style="margin:0;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px">Hasta</p>
                <p style="margin:4px 0 0;font-size:15px;font-weight:600;color:#1e293b">${fechaHastaFmt}</p>
              </td>
            </tr>
            <tr><td colspan="2" style="padding:14px 20px;border-top:1px solid #e2e8f0">
              <p style="margin:0;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px">Total de días</p>
              <p style="margin:4px 0 0;font-size:15px;font-weight:600;color:#1e293b">${diasSol} día${diasSol !== 1 ? 's' : ''} corrido${diasSol !== 1 ? 's' : ''}</p>
            </td></tr>
          </table>
        </td></tr>

        ${notaHtml}

        <!-- Footer -->
        <tr><td style="background:#f8fafc;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:16px 36px;margin-top:0">
          <p style="margin:0;font-size:12px;color:#94a3b8">Croma Horarios · Sistema de gestión de personal</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── ANUNCIOS ──────────────────────────────────────────
// Hoja ANUNCIOS: ID | TITULO | MENSAJE | DESTINATARIOS | FECHA | AUTOR

function getAnuncios(e) {
  try {
    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    let hoja   = ss.getSheetByName('ANUNCIOS');
    if (!hoja) {
      hoja = ss.insertSheet('ANUNCIOS');
      hoja.getRange(1,1,1,6).setValues([['ID','TITULO','MENSAJE','DESTINATARIOS','FECHA','AUTOR']]);
      return ContentService.createTextOutput(JSON.stringify({ ok: true, anuncios: [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const vals = hoja.getDataRange().getValues();
    if (vals.length < 2) {
      return ContentService.createTextOutput(JSON.stringify({ ok: true, anuncios: [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // Filtro opcional por destinatario
    const filtroEmp = String(e.parameter.empleado || '').trim().toLowerCase();
    const filtroSuc = String(e.parameter.sucursal || '').trim().toUpperCase(); // ej: "DEPO", "01"

    const anuncios = vals.slice(1).filter(r => r[0]).map(r => ({
      id:             String(r[0]).trim(),
      titulo:         String(r[1] || '').trim(),
      mensaje:        String(r[2] || '').trim(),
      destinatarios:  String(r[3] || 'todos').trim(),
      fecha:          r[4] instanceof Date
        ? Utilities.formatDate(r[4], Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm')
        : String(r[4] || '').trim(),
      autor:          String(r[5] || '').trim(),
      vigencia:       r[6] instanceof Date
        ? Utilities.formatDate(r[6], Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : String(r[6] || '').trim().substring(0, 10),
    })).filter(a => {
      if (!filtroEmp && !filtroSuc) return true;
      if (a.destinatarios === 'todos') return true;
      // Filtro exacto por sucursal si se pasó sucursal
      if (filtroSuc && a.destinatarios.toUpperCase() === 'SUC_' + filtroSuc) return true;
      // suc_X: devolver todos para que el front filtre (retrocompatibilidad)
      if (a.destinatarios.startsWith('suc_')) return true;
      try {
        const lista = JSON.parse(a.destinatarios);
        if (lista[0] && lista[0].startsWith('suc_')) {
          if (filtroSuc) return lista.some(s => s.toUpperCase() === 'SUC_' + filtroSuc);
          return true; // sin filtro sucursal, pasar al front
        }
        return filtroEmp ? lista.some(n => n.toLowerCase() === filtroEmp) : true;
      } catch(e) {
        return filtroEmp ? a.destinatarios.toLowerCase() === filtroEmp : true;
      }
    }).sort((a, b) => b.fecha.localeCompare(a.fecha));

    return ContentService.createTextOutput(JSON.stringify({ ok: true, anuncios }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function guardarAnuncio(e) {
  try {
    const anuncio = JSON.parse(decodeURIComponent(e.parameter.datos || '{}'));
    if (!anuncio.titulo || !anuncio.mensaje) throw new Error('Faltan datos obligatorios');
    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    let hoja   = ss.getSheetByName('ANUNCIOS');
    if (!hoja) {
      hoja = ss.insertSheet('ANUNCIOS');
      hoja.getRange(1,1,1,6).setValues([['ID','TITULO','MENSAJE','DESTINATARIOS','FECHA','AUTOR']]);
    }
    const id       = 'ANC-' + Date.now();
    const fecha    = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    const vigencia = anuncio.vigencia ? String(anuncio.vigencia).trim().substring(0, 10) : '';
    const destStr  = Array.isArray(anuncio.destinatarios) && anuncio.destinatarios.length > 0
      ? JSON.stringify(anuncio.destinatarios)
      : 'todos';
    hoja.appendRow([id, anuncio.titulo, anuncio.mensaje, destStr, fecha, anuncio.autor || 'Admin', vigencia]);
    return ContentService.createTextOutput(JSON.stringify({ ok: true, id }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function eliminarAnuncio(e) {
  try {
    const id   = String(e.parameter.id || '').trim();
    if (!id) throw new Error('Falta ID');
    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = ss.getSheetByName('ANUNCIOS');
    if (!hoja) throw new Error('Hoja ANUNCIOS no existe');
    const vals = hoja.getDataRange().getValues();
    const idx  = vals.findIndex(r => String(r[0]).trim() === id);
    if (idx < 1) throw new Error('Anuncio no encontrado');
    hoja.deleteRow(idx + 1);
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── EVENTOS DEL CALENDARIO ────────────────────────────
// Hoja EVENTOS: ID | TITULO | FECHA | FECHA_FIN | DESCRIPCION | DESTINATARIOS | AUTOR | TIPO

function getEventos(e) {
  try {
    const filtroEmp = String(e.parameter.empleado || '').trim().toLowerCase();
    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    let hoja   = ss.getSheetByName('EVENTOS');
    if (!hoja) {
      hoja = ss.insertSheet('EVENTOS');
      hoja.getRange(1,1,1,8).setValues([['ID','TITULO','FECHA','FECHA_FIN','DESCRIPCION','DESTINATARIOS','AUTOR','TIPO']]);
      return ContentService.createTextOutput(JSON.stringify({ ok: true, eventos: [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Detectar si la hoja tiene la columna FECHA_FIN (estructura nueva) o no (estructura vieja)
    const headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0]
      .map(h => String(h).trim().toUpperCase());
    const tieneFechaFin = headers.indexOf('FECHA_FIN') >= 0;

    const vals = hoja.getDataRange().getValues();
    const eventos = vals.slice(1).filter(r => String(r[0]).trim()).map(r => {
      if (tieneFechaFin) {
        // Nueva estructura: ID | TITULO | FECHA | FECHA_FIN | DESCRIPCION | DESTINATARIOS | AUTOR
        const fechaVal    = r[2] instanceof Date
          ? Utilities.formatDate(r[2], Session.getScriptTimeZone(), 'yyyy-MM-dd')
          : String(r[2] || '').trim();
        const fechaFinVal = r[3] instanceof Date
          ? Utilities.formatDate(r[3], Session.getScriptTimeZone(), 'yyyy-MM-dd')
          : String(r[3] || '').trim();
        return {
          id:            String(r[0]).trim(),
          titulo:        String(r[1]).trim(),
          fecha:         fechaVal,
          fecha_fin:     fechaFinVal || fechaVal,
          descripcion:   String(r[4]).trim(),
          destinatarios: String(r[5]).trim(),
          autor:         String(r[6]).trim(),
          tipo:          String(r[7] || '').trim(),
        };
      } else {
        // Estructura vieja: ID | TITULO | FECHA | DESCRIPCION | DESTINATARIOS | AUTOR
        const fechaVal = r[2] instanceof Date
          ? Utilities.formatDate(r[2], Session.getScriptTimeZone(), 'yyyy-MM-dd')
          : String(r[2] || '').trim();
        return {
          id:            String(r[0]).trim(),
          titulo:        String(r[1]).trim(),
          fecha:         fechaVal,
          fecha_fin:     fechaVal,
          descripcion:   String(r[3]).trim(),
          destinatarios: String(r[4]).trim(),
          autor:         String(r[5]).trim(),
          tipo:          '',
        };
      }
    }).filter(ev => {
      if (!filtroEmp) return true;
      if (ev.destinatarios === 'todos') return true;
      if (ev.destinatarios === 'personal') return false;
      if (ev.destinatarios.startsWith('suc_')) return true; // el front filtra por sucursal
      try {
        const lista = JSON.parse(ev.destinatarios);
        if (lista[0] && lista[0].startsWith('suc_')) return true; // array de sucursales, el front filtra
        return lista.some(n => n.toLowerCase() === filtroEmp);
      } catch(err) {
        return ev.destinatarios.toLowerCase() === filtroEmp;
      }
    }).sort((a, b) => a.fecha.localeCompare(b.fecha));

    return ContentService.createTextOutput(JSON.stringify({ ok: true, eventos }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function guardarEvento(e) {
  try {
    const datos = JSON.parse(decodeURIComponent(e.parameter.datos || '{}'));
    if (!datos.titulo || !datos.fecha) throw new Error('Faltan datos obligatorios');
    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    let hoja   = ss.getSheetByName('EVENTOS');
    if (!hoja) {
      hoja = ss.insertSheet('EVENTOS');
      hoja.getRange(1,1,1,7).setValues([['ID','TITULO','FECHA','FECHA_FIN','DESCRIPCION','DESTINATARIOS','AUTOR']]);
    }
    const id      = 'EVT-' + Date.now();
    const destStr = datos.destinatarios || datos.destinatario || 'todos';
    const fechaFin = datos.fecha_fin || datos.fecha;
    const tipoEvt  = datos.tipo || '';
    hoja.appendRow([id, datos.titulo, datos.fecha, fechaFin, datos.descripcion || '', destStr, datos.autor || 'Admin', tipoEvt]);
    try { enviarEmailsEvento(ss, datos.titulo, datos.fecha, fechaFin, datos.descripcion || '', destStr); } catch(mailErr) { Logger.log('Email error: ' + mailErr.message); }
    // Enviar a lista de correos de administración si vienen en el request
    try {
      const emailsAdmin = datos.emails || [];
      if (emailsAdmin.length) {
        const fechaStr    = fmtFecha(datos.fecha);
        const fechaFinStr = fechaFin && fechaFin !== datos.fecha ? fmtFecha(fechaFin) : null;
        const rangoFechas = fechaFinStr ? fechaStr + ' al ' + fechaFinStr : fechaStr;
        emailsAdmin.forEach(function(addr) {
          if (!addr) return;
          MailApp.sendEmail({
            to:       addr,
            subject:  '📌 Nuevo evento: ' + datos.titulo,
            htmlBody: buildEmailEvento({ titulo: datos.titulo, rangoFechas: rangoFechas, descripcion: datos.descripcion || '', destinatarioLabel: 'Administración' }),
          });
        });
      }
    } catch(mailAdminErr) { Logger.log('Email admin error: ' + mailAdminErr.message); }
    return ContentService.createTextOutput(JSON.stringify({ ok: true, id }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function eliminarEvento(e) {
  try {
    const id   = String(e.parameter.id || '').trim();
    if (!id) throw new Error('Falta ID');
    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = ss.getSheetByName('EVENTOS');
    if (!hoja) throw new Error('Hoja EVENTOS no existe');
    const vals = hoja.getDataRange().getValues();
    const idx  = vals.findIndex(r => String(r[0]).trim() === id);
    if (idx < 1) throw new Error('Evento no encontrado');
    hoja.deleteRow(idx + 1);
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ══════════════════════════════════════════════════════
//  FICHADAS — Carga de turno del día
// ══════════════════════════════════════════════════════

const FICHADAS_HEADERS = [
  'LOCAL','AÑO','MES','DIA','Marca temporal','EMPLEADO/A',
  'HORA ENTRADA','HORA SALIDA',
  'Nota adicional: Solo dejar asentado cuando se carga tarde el ingreso (Ejemplo: corte de luz, no enciende la pc, etc)',
  'TOTAL en hs','FECHA','TIPO_REGISTRO','HS_A_RECUPERAR','DESTINO_RECUPERACION','FECHA_A_RECUPERAR','MODO_CARGA','LAT','LON','DISTANCIA_M',
  'ID_FICHADA','ESTADO'
];

const MESES_ES_FICHADAS = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
                            'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
const DIAS_ES_FICHADAS  = ['DOMINGO','LUNES','MARTES','MIÉRCOLES','JUEVES','VIERNES','SÁBADO'];

function _horaAMin(str) {
  const p = String(str).split(':').map(Number);
  return p[0] * 60 + (p[1] || 0);
}

function _calcularTotalHs(entrada, salida) {
  let totalHs = (_horaAMin(salida) - _horaAMin(entrada)) / 60;
  if (totalHs < 0) totalHs += 24;
  return Math.round(totalHs * 100) / 100;
}

// AÑO/MES/DIA a partir de una fecha YYYY-MM-DD, con la misma lógica que ya
// usa guardarFichada — reusada también por ajustarJornada.
function _derivarCamposFecha(fechaISO) {
  const partes   = fechaISO.split('-').map(Number);
  const fechaObj = new Date(partes[0], partes[1] - 1, partes[2]);
  return {
    anio:     String(partes[0]),
    mesTexto: MESES_ES_FICHADAS[partes[1] - 1],
    diaTexto: DIAS_ES_FICHADAS[fechaObj.getDay()],
  };
}

// ── ID_FICHADA / ESTADO: columnas, contador atómico y backfill ──
// ID_FICHADA: identificador permanente y corto (FID000001, FID001250, ...),
// sin fecha/hora (esa info ya vive en otras columnas). ESTADO: ACTIVA|ANULADA,
// sostiene la anulación lógica (nunca se borran filas de FICHADAS).
// Ambas se usan para Ajuste de jornada y futuras auditorías — nunca para el
// sistema viejo (DATOS GENERALES/QUERY), que no las conoce ni las necesita.

// Asegura que una columna exista al final real de la hoja, sin mover ni
// renombrar ninguna columna existente. Idempotente: si ya existe, devuelve
// su posición sin tocar nada.
function _asegurarColumna(hoja, nombre) {
  const lastCol = hoja.getLastColumn();
  const headers = hoja.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  let col = headers.indexOf(nombre) + 1; // 1-based; 0 si no existe
  if (col === 0) {
    col = lastCol + 1;
    hoja.getRange(1, col).setValue(nombre);
  }
  return col;
}

function _asegurarColumnaIdFichada(hoja) { return _asegurarColumna(hoja, 'ID_FICHADA'); }
function _asegurarColumnaEstado(hoja)    { return _asegurarColumna(hoja, 'ESTADO'); }

function _formatearIdFichada(n) {
  return 'FID' + String(n).padStart(6, '0');
}

// Genera el próximo ID_FICHADA de forma atómica. LockService garantiza que
// dos fichadas concurrentes nunca lean el mismo valor de NEXT_FICHADA_ID.
// Si falla el guardado después de reservar el número, ese número queda sin
// usar (hueco en la secuencia) pero jamás se duplica.
function generarNuevoIdFichada() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props  = PropertiesService.getScriptProperties();
    const actual = parseInt(props.getProperty('NEXT_FICHADA_ID'), 10) || 1;
    props.setProperty('NEXT_FICHADA_ID', String(actual + 1));
    return _formatearIdFichada(actual);
  } finally {
    lock.releaseLock();
  }
}

// Backfill — correr UNA VEZ manualmente desde el editor de Apps Script.
// No expuesto por doGet/doPost. Idempotente: se puede volver a correr sin
// generar IDs nuevos ni duplicar la columna.
// Flujo: agrega la columna si falta → completa solo las filas sin ID →
// inicializa NEXT_FICHADA_ID → correr validarIdFichada() a continuación.
function backfillIdFichada() {
  const ss   = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName('FICHADAS');
  if (!hoja) { Logger.log('FICHADAS no existe, nada que hacer.'); return; }

  const lastRow = hoja.getLastRow();
  if (lastRow < 2) { Logger.log('FICHADAS sin filas de datos.'); return; }

  const col   = _asegurarColumnaIdFichada(hoja);
  const rango = hoja.getRange(2, col, lastRow - 1, 1);
  const actuales = rango.getValues();

  // Máximo ID ya existente (preserva IDs previos si el script ya corrió antes)
  let maxActual = 0;
  actuales.forEach(fila => {
    const m = String(fila[0] || '').trim().match(/^FID(\d+)$/);
    if (m) maxActual = Math.max(maxActual, parseInt(m[1], 10));
  });

  let siguiente = maxActual + 1;
  let generados = 0;
  const nuevos = actuales.map(fila => {
    const v = String(fila[0] || '').trim();
    if (v) return [v]; // ya tiene ID → se conserva tal cual
    generados++;
    return [_formatearIdFichada(siguiente++)];
  });

  rango.setValues(nuevos);

  const ultimoUsado = siguiente - 1;
  PropertiesService.getScriptProperties().setProperty('NEXT_FICHADA_ID', String(ultimoUsado + 1));

  Logger.log('Backfill completo. IDs generados: ' + generados + ' / ' + (lastRow - 1) + ' filas.');
  Logger.log('NEXT_FICHADA_ID inicializado en ' + (ultimoUsado + 1));
}

// Validación de solo lectura — no corrige nada, solo reporta.
// Correr después de backfillIdFichada(), y periódicamente como chequeo de salud.
function validarIdFichada() {
  const ss   = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName('FICHADAS');
  if (!hoja) { Logger.log('FICHADAS no existe.'); return; }

  const lastCol = hoja.getLastColumn();
  const headers = hoja.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const col = headers.indexOf('ID_FICHADA');
  if (col < 0) { Logger.log('ID_FICHADA no existe todavía. Correr backfillIdFichada() primero.'); return; }

  const lastRow = hoja.getLastRow();
  if (lastRow < 2) { Logger.log('FICHADAS sin filas de datos.'); return; }

  const valores = hoja.getRange(2, col + 1, lastRow - 1, 1).getValues().map(r => String(r[0]).trim());
  const vacios  = valores.filter(v => !v).length;

  const conteo = {};
  valores.forEach(v => { if (v) conteo[v] = (conteo[v] || 0) + 1; });
  const duplicados = Object.entries(conteo).filter(([, n]) => n > 1);

  Logger.log('Filas totales: '   + valores.length);
  Logger.log('IDs generados: '   + (valores.length - vacios));
  Logger.log('IDs vacíos: '      + vacios);
  Logger.log('IDs duplicados: '  + (duplicados.length ? JSON.stringify(duplicados) : 'ninguno'));
}

// Dos rangos horarios se pisan si arrancan antes de que el otro termine.
// Maneja turnos que cruzan medianoche igual que _calcularTotalHs (salida <=
// entrada ⇒ es al día siguiente).
function _horariosSeSuperponen(aEntrada, aSalida, bEntrada, bSalida) {
  const aIni = _horaAMin(aEntrada); let aFin = _horaAMin(aSalida); if (aFin <= aIni) aFin += 1440;
  const bIni = _horaAMin(bEntrada); let bFin = _horaAMin(bSalida); if (bFin <= bIni) bFin += 1440;
  return aIni < bFin && bIni < aFin;
}

// Busca, entre las fichadas ACTIVAs ya cargadas para ese empleado y esa
// fecha, alguna cuyo horario se superponga con el que se quiere guardar.
// Devuelve la fila encontrada (con entrada/salida) o null.
// La columna FECHA a veces queda como texto "YYYY-MM-DD" y a veces como
// Date de Sheets (según cómo se escribió esa fila) — mismo problema que
// resuelve fmtFechaCelda en cargar_fichadas_empleado. Hay que normalizar
// antes de comparar o un Date nunca va a matchear un string ISO.
function _fmtFechaComparable(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v || '').trim().substring(0, 10);
}

function _buscarFichadaSuperpuesta(hoja, empleado, fechaISO, entrada, salida) {
  const lastRow = hoja.getLastRow();
  if (lastRow < 2) return null;

  const lastCol  = hoja.getLastColumn();
  const headers  = hoja.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const cEmp     = headers.indexOf('EMPLEADO/A');
  const cFecha   = headers.indexOf('FECHA');
  const cEntrada = headers.indexOf('HORA ENTRADA');
  const cSalida  = headers.indexOf('HORA SALIDA');
  const cEstado  = headers.indexOf('ESTADO');
  if (cEmp < 0 || cFecha < 0 || cEntrada < 0 || cSalida < 0) return null;

  const empleadoNorm = _normalizarNombreEmpleado(empleado);
  const filas = hoja.getRange(2, 1, lastRow - 1, lastCol).getValues();
  for (let i = 0; i < filas.length; i++) {
    const f = filas[i];
    if (cEstado >= 0 && String(f[cEstado] || 'ACTIVA').trim() === 'ANULADA') continue;
    if (_normalizarNombreEmpleado(f[cEmp]) !== empleadoNorm) continue;
    if (_fmtFechaComparable(f[cFecha]) !== fechaISO) continue;

    const eExist = formatearHora(f[cEntrada]);
    const sExist = formatearHora(f[cSalida]);
    if (!eExist || !sExist) continue;

    if (_horariosSeSuperponen(entrada, salida, eExist, sExist)) {
      return { entrada: eExist, salida: sExist };
    }
  }
  return null;
}

function guardarFichada(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const datos = JSON.parse(e.postData.contents || '{}');

    if (!datos.local || !datos.empleado || !datos.fecha || !datos.hora_entrada || !datos.hora_salida) {
      throw new Error('Faltan datos obligatorios');
    }

    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    let hoja  = ss.getSheetByName('FICHADAS');
    if (!hoja) {
      hoja = ss.insertSheet('FICHADAS');
      hoja.getRange(1, 1, 1, FICHADAS_HEADERS.length).setValues([FICHADAS_HEADERS]);
      hoja.setFrozenRows(1);
    }
    _asegurarColumnaIdFichada(hoja); // por si esta fichada llega antes de correr el backfill
    _asegurarColumnaEstado(hoja);

    // Bloqueo definitivo de duplicados/superposiciones: se hace acá, del lado
    // del servidor, porque el aviso del frontend es solo una ayuda visual y
    // puede no llegar a tiempo (red lenta, doble tap, pestañas distintas).
    const dup = _buscarFichadaSuperpuesta(hoja, datos.empleado, datos.fecha, datos.hora_entrada, datos.hora_salida);
    if (dup) {
      throw new Error(
        `FICHADA_DUPLICADA: ya tenés un turno cargado ese día de ${dup.entrada} a ${dup.salida} que se superpone con ${datos.hora_entrada}–${datos.hora_salida}.`
      );
    }

    const { anio, mesTexto, diaTexto } = _derivarCamposFecha(datos.fecha);
    const marca    = new Date();
    const totalHs  = _calcularTotalHs(datos.hora_entrada, datos.hora_salida);

    hoja.appendRow([
      datos.local,
      anio,
      mesTexto,
      diaTexto,
      marca,
      datos.empleado,
      datos.hora_entrada,
      datos.hora_salida,
      datos.nota || '',
      totalHs,
      datos.fecha,
      datos.tipo_registro          || 'NORMAL',
      datos.hs_a_recuperar         || 0,
      datos.destino_recuperacion   || '',
      datos.fecha_a_recuperar      || '',
      datos.modo_carga             || 'INDIVIDUAL',
      datos.lat         !== undefined ? datos.lat         : '',
      datos.lon         !== undefined ? datos.lon         : '',
      datos.distancia_m !== undefined ? datos.distancia_m : '',
      generarNuevoIdFichada(),
      'ACTIVA',
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// ══════════════════════════════════════════════════════
//  AJUSTE DE JORNADA — accion=ajustar_jornada (POST)
//  Fuente de verdad: FICHADAS. Nunca toca DATOS GENERALES ni su QUERY.
//  Identificador principal: ID_FICHADA. Snapshot (turnoN_original) como
//  mitigación de conflicto de edición. Nunca DELETE físico: turnos que se
//  quitan quedan con ESTADO='ANULADA', preservando sus valores originales.
//  Auditoría: hoja AjustesJornada, una fila por turno tocado.
// ══════════════════════════════════════════════════════

const MOTIVOS_AJUSTE_VALIDOS = [
  'olvido_marcar_entrada','olvido_marcar_salida','error_de_carga',
  'cambio_autorizado','correccion_administrativa','otro',
];

const AJUSTES_JORNADA_HEADERS = [
  'ID_AJUSTE','ID_OPERACION','ID_FICHADA','FECHA_HORA_AJUSTE','ADMIN_USUARIO',
  'EMPLEADO','LOCAL','FECHA_JORNADA','TURNO','TIPO_OPERACION',
  'ESTADO_ANTERIOR','ESTADO_NUEVO','ENTRADA_ANTERIOR','SALIDA_ANTERIOR',
  'ENTRADA_NUEVA','SALIDA_NUEVA','RECUPERA_HORAS_ANTERIOR','RECUPERA_HORAS_NUEVO',
  'OBSERVACION_ANTERIOR','OBSERVACION_NUEVA','MOTIVO','MOTIVO_DETALLE','TIMESTAMP_CLIENTE',
];

function _getAjustesJornadaHoja(ss) {
  let hoja = ss.getSheetByName('AjustesJornada');
  if (!hoja) {
    hoja = ss.insertSheet('AjustesJornada');
    hoja.getRange(1, 1, 1, AJUSTES_JORNADA_HEADERS.length).setValues([AJUSTES_JORNADA_HEADERS]);
    hoja.setFrozenRows(1);
  }
  return hoja;
}

// Normaliza espacios (incluidos dobles espacios de carga manual) para
// comparar nombres de empleado de forma robusta entre EMPLEADOS y FICHADAS,
// sin modificar el dato guardado en ningún lado.
function _normalizarNombreEmpleado(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function _empleadoExiste(nombreEmpleado) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const nombreNorm = _normalizarNombreEmpleado(nombreEmpleado);

  const hEmp = ss.getSheetByName('EMPLEADOS');
  if (hEmp) {
    const vals = hEmp.getDataRange().getValues();
    for (let i = 1; i < vals.length; i++) {
      if (_normalizarNombreEmpleado(vals[i][0]) === nombreNorm) return true;
    }
  }

  // Fallback: si no está en EMPLEADOS, alcanza con que ya tenga fichadas
  const hFich = ss.getSheetByName('FICHADAS');
  if (hFich) {
    const vals = hFich.getDataRange().getValues();
    const hdrs = vals[0] ? vals[0].map(h => String(h).trim()) : [];
    const iEmp = hdrs.indexOf('EMPLEADO/A');
    if (iEmp >= 0) {
      for (let i = 1; i < vals.length; i++) {
        if (_normalizarNombreEmpleado(vals[i][iEmp]) === nombreNorm) return true;
      }
    }
  }
  return false;
}

function _mensajeErrorAjuste(codigo) {
  const mensajes = {
    JORNADA_NO_ENCONTRADA: 'No se encontró la jornada para ese turno. Puede que ya haya sido modificada.',
    YA_ANULADA:            'Ese turno ya fue anulado previamente.',
    CONFLICTO_EDICION:     'Esta jornada fue modificada por otra persona. Volvé a abrirla para ver los datos actuales.',
  };
  return mensajes[codigo] || 'No se pudo guardar el ajuste.';
}

function ajustarJornada(e) {
  const err = (codigo, detalle, mensaje) => ContentService.createTextOutput(JSON.stringify({
    ok: false,
    mensaje: mensaje || _mensajeErrorAjuste(codigo),
    jornada_actualizada: null,
    ajustes_registrados: [],
    error: { codigo, detalle: detalle || '' },
  })).setMimeType(ContentService.MimeType.JSON);

  try {
    const datos = JSON.parse(e.postData.contents || '{}');

    // ── Validaciones de payload (no dependen de la hoja) ──
    // Nota: no se valida admin_usuario contra la hoja USUARIOS de GAS — esa
    // hoja solo tiene cuentas de empleado (login por PIN). Los admins entran
    // por el Hub vía JWT contra el backend Node (SQLite), que GAS no puede
    // consultar. El gate real de "es admin" ya ocurre client-side (rol + PIN
    // de administración); acá solo se exige que venga identificado, igual
    // que el resto de los endpoints de escritura de este sistema.
    if (!datos.admin_usuario) return err('ADMIN_FALTANTE', '', 'Falta el administrador que realiza el ajuste.');

    if (!datos.motivo || MOTIVOS_AJUSTE_VALIDOS.indexOf(datos.motivo) < 0) return err('MOTIVO_FALTANTE', '', 'Elegí un motivo para el ajuste.');
    if (datos.motivo === 'otro' && !String(datos.motivo_detalle || '').trim()) return err('MOTIVO_DETALLE_FALTANTE', '', 'Detallá el motivo del ajuste.');

    const fechaValida = f => /^\d{4}-\d{2}-\d{2}$/.test(String(f || ''));
    if (!fechaValida(datos.fecha_jornada) || !fechaValida(datos.fecha_jornada_original)) {
      return err('FECHA_INVALIDA', '', 'La fecha de la jornada no es válida.');
    }

    const horaValida = h => h === null || h === undefined || /^([01]\d|2[0-3]):[0-5]\d$/.test(h);
    if (!horaValida(datos.entrada1) || !horaValida(datos.salida1) || !horaValida(datos.entrada2) || !horaValida(datos.salida2)) {
      return err('HORA_INVALIDA', '', 'Alguno de los horarios no tiene un formato válido.');
    }
    const rangoValido = (ent, sal) => !ent || !sal || ent < sal;
    if (!rangoValido(datos.entrada1, datos.salida1)) return err('HORA_INVALIDA', 'turno1', 'La salida del Turno 1 debe ser posterior a la entrada.');
    if (!rangoValido(datos.entrada2, datos.salida2)) return err('HORA_INVALIDA', 'turno2', 'La salida del Turno 2 debe ser posterior a la entrada.');

    if (!datos.entrada1 && !datos.entrada2) return err('AJUSTE_VACIO', '', 'La jornada no puede quedar sin ningún turno.');
    if (datos.entrada2 && !datos.entrada1) return err('TURNO_INVALIDO', '', 'No puede haber Turno 2 sin Turno 1.');

    if (!_empleadoExiste(datos.empleado)) return err('EMPLEADO_NO_ENCONTRADO', datos.empleado, 'No se encontró el empleado indicado.');

    // ── Hoja FICHADAS ──
    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = ss.getSheetByName('FICHADAS');
    if (!hoja) return err('JORNADA_NO_ENCONTRADA', 'FICHADAS', 'No existe la hoja de fichadas.');
    _asegurarColumnaIdFichada(hoja);
    _asegurarColumnaEstado(hoja);

    const lastCol = hoja.getLastColumn();
    const headers = hoja.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
    const col = name => headers.indexOf(name); // 0-based

    const cLocal  = col('LOCAL');
    const cAnio   = col('AÑO');
    const cMes    = col('MES');
    const cDia    = col('DIA');
    const cMarca  = col('Marca temporal');
    const cEmp    = col('EMPLEADO/A');
    const cEntrada= col('HORA ENTRADA');
    const cSalida = col('HORA SALIDA');
    const cNota   = headers.findIndex(h => h.startsWith('Nota adicional'));
    const cTotal  = col('TOTAL en hs');
    const cFecha  = col('FECHA');
    const cTipo   = col('TIPO_REGISTRO');
    const cHsRec  = col('HS_A_RECUPERAR');
    const cIdFich = col('ID_FICHADA');
    const cEstado = col('ESTADO');

    // Validación defensiva: si algún header no matchea exacto (mayúsculas,
    // espacios, tilde), getRange recibiría columna 0 y Sheets tira un error
    // críptico ("columna demasiado pequeña"). Acá se detecta antes y se dice
    // exactamente qué columna falta.
    const columnasEsperadas = {
      LOCAL: cLocal, 'AÑO': cAnio, MES: cMes, DIA: cDia, 'Marca temporal': cMarca,
      'EMPLEADO/A': cEmp, 'HORA ENTRADA': cEntrada, 'HORA SALIDA': cSalida,
      'TOTAL en hs': cTotal, FECHA: cFecha, TIPO_REGISTRO: cTipo,
      ID_FICHADA: cIdFich, ESTADO: cEstado,
      // HS_A_RECUPERAR queda fuera de esta validación a propósito: en la hoja
      // real esa columna no está rotulada así (ver headers reales de FICHADAS).
      // Se escribe solo si existe (cHsRec >= 0); si no, se sigue igual —
      // TIPO_REGISTRO='RECUPERO' ya refleja el switch "Recupera horas".
    };
    const faltantes = Object.entries(columnasEsperadas).filter(([, idx]) => idx < 0).map(([nombre]) => nombre);
    if (faltantes.length) {
      return err('SHEETS_ERROR', 'Columnas no encontradas en FICHADAS: ' + faltantes.join(', '),
        'Faltan columnas en FICHADAS: ' + faltantes.join(', ') + '. Revisá que el nombre del header coincida exacto.');
    }

    const allValues = hoja.getDataRange().getValues(); // incluye header en [0]

    function localizarFila(idFichada) {
      for (let i = 1; i < allValues.length; i++) {
        if (String(allValues[i][cIdFich] || '').trim() === idFichada) return i + 1; // fila real (1-based)
      }
      return null;
    }

    const jornadaTurnos  = { turno1: null, turno2: null };
    const resultadoTurnos = [];
    const auditoriaFilas  = [];
    let opError = null;

    function procesarTurno(n, idFichada, entradaNueva, salidaNueva, turnoOriginal) {
      if (opError) return;
      const hayIdOriginal = !!idFichada;
      const hayValorNuevo = !!entradaNueva;
      if (!hayIdOriginal && !hayValorNuevo) return; // turno no se toca

      if (!hayIdOriginal && hayValorNuevo) {
        // ── CREATE ──
        const nuevoId = generarNuevoIdFichada();
        const { anio, mesTexto, diaTexto } = _derivarCamposFecha(datos.fecha_jornada);
        const totalHs = _calcularTotalHs(entradaNueva, salidaNueva);
        const filaNueva = new Array(headers.length).fill('');
        filaNueva[cLocal]   = datos.local;
        filaNueva[cAnio]    = anio;
        filaNueva[cMes]     = mesTexto;
        filaNueva[cDia]     = diaTexto;
        filaNueva[cMarca]   = new Date();
        filaNueva[cEmp]     = datos.empleado;
        filaNueva[cEntrada] = entradaNueva;
        filaNueva[cSalida]  = salidaNueva;
        if (cNota >= 0) filaNueva[cNota] = datos.observacion || '';
        filaNueva[cTotal]   = totalHs;
        filaNueva[cFecha]   = datos.fecha_jornada;
        filaNueva[cTipo]    = datos.recupera_horas ? 'RECUPERO' : 'NORMAL';
        if (cHsRec >= 0) filaNueva[cHsRec] = datos.recupera_horas ? totalHs : 0;
        filaNueva[cIdFich]  = nuevoId;
        filaNueva[cEstado]  = 'ACTIVA';
        hoja.appendRow(filaNueva);

        jornadaTurnos['turno' + n] = { id_fichada: nuevoId, entrada: entradaNueva, salida: salidaNueva, estado: 'ACTIVA' };
        resultadoTurnos.push({ turno: n, tipo_operacion: 'CREATE', valor_anterior: null, valor_nuevo: `${entradaNueva}–${salidaNueva}` });
        auditoriaFilas.push({
          id_fichada: nuevoId, turno: n, tipo_operacion: 'CREATE',
          estado_anterior: '', estado_nuevo: 'ACTIVA',
          entrada_anterior: '', salida_anterior: '', entrada_nueva: entradaNueva, salida_nueva: salidaNueva,
          recupera_anterior: false, recupera_nueva: !!datos.recupera_horas,
          observacion_anterior: '', observacion_nueva: datos.observacion || '',
        });
        return;
      }

      // ── UPDATE o ANULAR: localizar la fila por ID_FICHADA ──
      const fila = localizarFila(idFichada);
      if (!fila) { opError = { codigo: 'JORNADA_NO_ENCONTRADA', detalle: 'turno=' + n + ' id_fichada=' + idFichada }; return; }

      const valoresFila   = allValues[fila - 1];
      const entradaActual = formatearHora(valoresFila[cEntrada]);
      const salidaActual  = formatearHora(valoresFila[cSalida]);
      const estadoActual  = String(valoresFila[cEstado] || 'ACTIVA').trim() || 'ACTIVA';
      const recuperaActual= String(valoresFila[cTipo] || '').trim() === 'RECUPERO';
      const notaActual    = cNota >= 0 ? String(valoresFila[cNota] || '') : '';

      if (estadoActual === 'ANULADA') { opError = { codigo: 'YA_ANULADA', detalle: 'turno=' + n + ' id_fichada=' + idFichada }; return; }

      const snap = turnoOriginal || {};
      if (snap.entrada !== undefined &&
          (entradaActual !== (snap.entrada || '') || salidaActual !== (snap.salida || '') || estadoActual !== (snap.estado || 'ACTIVA'))) {
        opError = { codigo: 'CONFLICTO_EDICION', detalle: `turno=${n} esperado=${snap.entrada}-${snap.salida} encontrado=${entradaActual}-${salidaActual}` };
        return;
      }

      if (!hayValorNuevo) {
        // ── ANULAR: preserva entrada/salida, solo cambia ESTADO ──
        hoja.getRange(fila, cEstado + 1).setValue('ANULADA');
        jornadaTurnos['turno' + n] = { id_fichada: idFichada, entrada: entradaActual, salida: salidaActual, estado: 'ANULADA' };
        resultadoTurnos.push({ turno: n, tipo_operacion: 'ANULAR', valor_anterior: `${entradaActual}–${salidaActual}`, valor_nuevo: `${entradaActual}–${salidaActual} (anulado)` });
        auditoriaFilas.push({
          id_fichada: idFichada, turno: n, tipo_operacion: 'ANULAR',
          estado_anterior: estadoActual, estado_nuevo: 'ANULADA',
          entrada_anterior: entradaActual, salida_anterior: salidaActual, entrada_nueva: entradaActual, salida_nueva: salidaActual,
          recupera_anterior: recuperaActual, recupera_nueva: recuperaActual,
          observacion_anterior: notaActual, observacion_nueva: notaActual,
        });
        return;
      }

      // ── UPDATE ──
      const totalHs = _calcularTotalHs(entradaNueva, salidaNueva);
      hoja.getRange(fila, cEntrada + 1).setValue(entradaNueva);
      hoja.getRange(fila, cSalida + 1).setValue(salidaNueva);
      hoja.getRange(fila, cTotal + 1).setValue(totalHs);
      hoja.getRange(fila, cTipo + 1).setValue(datos.recupera_horas ? 'RECUPERO' : 'NORMAL');
      if (cHsRec >= 0) hoja.getRange(fila, cHsRec + 1).setValue(datos.recupera_horas ? totalHs : 0);
      if (cNota >= 0) hoja.getRange(fila, cNota + 1).setValue(datos.observacion || '');
      if (datos.fecha_jornada !== datos.fecha_jornada_original) {
        const { anio, mesTexto, diaTexto } = _derivarCamposFecha(datos.fecha_jornada);
        hoja.getRange(fila, cFecha + 1).setValue(datos.fecha_jornada);
        hoja.getRange(fila, cAnio + 1).setValue(anio);
        hoja.getRange(fila, cMes + 1).setValue(mesTexto);
        hoja.getRange(fila, cDia + 1).setValue(diaTexto);
      }

      jornadaTurnos['turno' + n] = { id_fichada: idFichada, entrada: entradaNueva, salida: salidaNueva, estado: 'ACTIVA' };
      resultadoTurnos.push({ turno: n, tipo_operacion: 'UPDATE', valor_anterior: `${entradaActual}–${salidaActual}`, valor_nuevo: `${entradaNueva}–${salidaNueva}` });
      auditoriaFilas.push({
        id_fichada: idFichada, turno: n, tipo_operacion: 'UPDATE',
        estado_anterior: estadoActual, estado_nuevo: 'ACTIVA',
        entrada_anterior: entradaActual, salida_anterior: salidaActual, entrada_nueva: entradaNueva, salida_nueva: salidaNueva,
        recupera_anterior: recuperaActual, recupera_nueva: !!datos.recupera_horas,
        observacion_anterior: notaActual, observacion_nueva: datos.observacion || '',
      });
    }

    procesarTurno(1, datos.id_fichada_turno1, datos.entrada1, datos.salida1, datos.turno1_original);
    procesarTurno(2, datos.id_fichada_turno2, datos.entrada2, datos.salida2, datos.turno2_original);

    if (opError) return err(opError.codigo, opError.detalle);

    // ── Auditoría: una fila por turno tocado ──
    const idOperacion    = 'OP-' + Date.now();
    const timestampAjuste= new Date();
    const hojaAuditoria  = _getAjustesJornadaHoja(ss);
    auditoriaFilas.forEach(f => {
      hojaAuditoria.appendRow([
        'ADJ-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
        idOperacion, f.id_fichada, timestampAjuste, datos.admin_usuario,
        datos.empleado, datos.local, datos.fecha_jornada, f.turno, f.tipo_operacion,
        f.estado_anterior, f.estado_nuevo,
        f.entrada_anterior, f.salida_anterior, f.entrada_nueva, f.salida_nueva,
        f.recupera_anterior, f.recupera_nueva,
        f.observacion_anterior, f.observacion_nueva,
        datos.motivo, datos.motivo === 'otro' ? (datos.motivo_detalle || '') : '',
        datos.timestamp_cliente || '',
      ]);
    });

    return ContentService.createTextOutput(JSON.stringify({
      ok: true,
      mensaje: 'Jornada actualizada correctamente en FICHADAS',
      jornada_actualizada: {
        empleado: datos.empleado, local: datos.local, fecha_jornada: datos.fecha_jornada,
        turno1: jornadaTurnos.turno1, turno2: jornadaTurnos.turno2,
      },
      ajustes_registrados: resultadoTurnos,
      error: null,
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (errGeneral) {
    return err('SHEETS_ERROR', errGeneral.message, 'No se pudo guardar el ajuste, intentá nuevamente.');
  }
}

// ══════════════════════════════════════════════════════
//  BANCO DE HORAS
//  Hoja BANCO_HORAS: ID | EMPLEADO | FECHA_MOVIMIENTO | TIPO | HS | CONCEPTO | FECHA_REFERENCIA
//  TIPO: ACREDITO | USO
//  FECHA_REFERENCIA: fecha del turno que generó el crédito, o fecha que se cubre con el uso
// ══════════════════════════════════════════════════════

function getBancoHorasHoja(ss) {
  let hoja = ss.getSheetByName('BANCO_HORAS');
  if (!hoja) {
    hoja = ss.insertSheet('BANCO_HORAS');
    hoja.getRange(1, 1, 1, 7).setValues([[
      'ID','EMPLEADO','FECHA_MOVIMIENTO','TIPO','HS','CONCEPTO','FECHA_REFERENCIA'
    ]]);
    hoja.setFrozenRows(1);
  }
  return hoja;
}

function getBancoHoras(e) {
  try {
    const empleado = String(e.parameter.empleado || '').trim();
    if (!empleado) throw new Error('Falta empleado');

    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = getBancoHorasHoja(ss);
    const vals = hoja.getDataRange().getValues();

    if (vals.length < 2) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, saldo: 0, movimientos: [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const hdrs  = vals[0].map(h => String(h).trim());
    const ci    = name => hdrs.indexOf(name);
    const iEmp  = ci('EMPLEADO');
    const iFech = ci('FECHA_MOVIMIENTO');
    const iTipo = ci('TIPO');
    const iHs   = ci('HS');
    const iConc = ci('CONCEPTO');
    const iFRef = ci('FECHA_REFERENCIA');

    const movimientos = vals.slice(1)
      .filter(r => String(r[iEmp] || '').trim().toLowerCase() === empleado.toLowerCase())
      .map(r => ({
        id:               String(r[ci('ID')] || ''),
        fecha_movimiento: String(r[iFech] || '').substring(0, 10),
        tipo:             String(r[iTipo] || ''),
        hs:               parseFloat(r[iHs]) || 0,
        concepto:         String(r[iConc] || ''),
        fecha_referencia: String(r[iFRef] || '').substring(0, 10),
      }))
      .sort((a, b) => b.fecha_movimiento.localeCompare(a.fecha_movimiento));

    const saldo = Math.round(
      movimientos.reduce((acc, m) => acc + (m.tipo === 'ACREDITO' ? m.hs : -m.hs), 0) * 100
    ) / 100;

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, saldo, movimientos }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function acreditarBanco(e) {
  try {
    const datos = JSON.parse(e.postData.contents || '{}');
    if (!datos.empleado || !datos.hs || !datos.fecha_referencia) {
      throw new Error('Faltan datos obligatorios');
    }

    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = getBancoHorasHoja(ss);
    const id   = 'BH-' + Date.now();
    const hoy  = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

    hoja.appendRow([
      id,
      datos.empleado,
      hoy,
      'ACREDITO',
      parseFloat(datos.hs),
      datos.concepto || ('Recuperación del ' + datos.fecha_referencia),
      datos.fecha_referencia,
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, id }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function usarBanco(e) {
  try {
    const datos = JSON.parse(e.postData.contents || '{}');
    if (!datos.empleado || !datos.hs || !datos.fecha_referencia) {
      throw new Error('Faltan datos obligatorios');
    }

    // Verificar saldo suficiente
    const ss      = SpreadsheetApp.getActiveSpreadsheet();
    const hoja    = getBancoHorasHoja(ss);
    const vals    = hoja.getDataRange().getValues();
    const hdrs    = vals[0].map(h => String(h).trim());
    const iEmp    = hdrs.indexOf('EMPLEADO');
    const iTipo   = hdrs.indexOf('TIPO');
    const iHs     = hdrs.indexOf('HS');

    const saldo = vals.slice(1)
      .filter(r => String(r[iEmp] || '').trim().toLowerCase() === datos.empleado.toLowerCase())
      .reduce((acc, r) => {
        const hs = parseFloat(r[iHs]) || 0;
        return acc + (String(r[iTipo]) === 'ACREDITO' ? hs : -hs);
      }, 0);

    if (parseFloat(datos.hs) > Math.round(saldo * 100) / 100) {
      throw new Error('Saldo insuficiente en el banco de horas');
    }

    const id  = 'BH-' + Date.now();
    const hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

    hoja.appendRow([
      id,
      datos.empleado,
      hoy,
      'USO',
      parseFloat(datos.hs),
      datos.concepto || ('Usado para cubrir ' + datos.fecha_referencia),
      datos.fecha_referencia,
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, id, saldo_nuevo: Math.round((saldo - parseFloat(datos.hs)) * 100) / 100 }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function getBancoHorasTodos() {
  try {
    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = getBancoHorasHoja(ss);
    const vals = hoja.getDataRange().getValues();

    if (vals.length < 2) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, empleados: [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const hdrs  = vals[0].map(h => String(h).trim());
    const iEmp  = hdrs.indexOf('EMPLEADO');
    const iTipo = hdrs.indexOf('TIPO');
    const iHs   = hdrs.indexOf('HS');

    const saldos = {};
    vals.slice(1).forEach(r => {
      const emp  = String(r[iEmp] || '').trim();
      if (!emp) return;
      const hs   = parseFloat(r[iHs]) || 0;
      const tipo = String(r[iTipo] || '');
      if (!saldos[emp]) saldos[emp] = 0;
      saldos[emp] += tipo === 'ACREDITO' ? hs : -hs;
    });

    const empleados = Object.entries(saldos).map(([nombre, saldo]) => ({
      nombre,
      saldo: Math.round(saldo * 100) / 100,
    })).sort((a, b) => a.nombre.localeCompare(b.nombre));

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, empleados }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── FICHADAS HOY ───────────────────────────────────────
function getFichadasHoyLocal() {
  try {
    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = ss.getSheetByName('FICHADAS');
    if (!hoja) return ContentService
      .createTextOutput(JSON.stringify({ ok: true, fichadas: [] }))
      .setMimeType(ContentService.MimeType.JSON);

    const tz  = Session.getScriptTimeZone();
    const hoy = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

    const vals    = hoja.getDataRange().getValues();
    if (vals.length < 2) return ContentService
      .createTextOutput(JSON.stringify({ ok: true, fichadas: [] }))
      .setMimeType(ContentService.MimeType.JSON);

    const headers  = vals[0].map(function(h) { return String(h).trim().toUpperCase(); });
    const iEmp     = headers.indexOf('EMPLEADO/A');
    const iFecha   = headers.indexOf('FECHA');
    const iEntrada = headers.indexOf('HORA ENTRADA');
    const iSalida  = headers.indexOf('HORA SALIDA');
    const iEstado  = headers.indexOf('ESTADO');

    const fichadas = [];
    for (var i = 1; i < vals.length; i++) {
      var row   = vals[i];
      if (iEstado >= 0 && String(row[iEstado] || '').trim() === 'ANULADA') continue;
      var fecha = row[iFecha];
      if (fecha instanceof Date) {
        fecha = Utilities.formatDate(fecha, tz, 'yyyy-MM-dd');
      } else {
        fecha = String(fecha || '').substring(0, 10);
      }
      if (fecha !== hoy) continue;
      fichadas.push({
        empleado:     String(row[iEmp]     || '').trim(),
        hora_entrada: String(row[iEntrada] || '').trim(),
        hora_salida:  String(row[iSalida]  || '').trim(),
      });
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, fichadas: fichadas }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── SUCURSALES_GEO ─────────────────────────────────────
// Vive en la hoja SUCURSALES_GEO del Sheet CROMA ADMIN

const CROMA_ADMIN_ID = '1x_YNjuoUy6EYuQJuXzkw9OdfyLMLhfeh_CXKDoB26jc';

function getSucursalesGeo() {
  try {
    const ssAdmin = SpreadsheetApp.openById(CROMA_ADMIN_ID);
    let hoja = ssAdmin.getSheetByName('SUCURSALES_GEO');
    if (!hoja) {
      hoja = ssAdmin.insertSheet('SUCURSALES_GEO');
      hoja.getRange(1, 1, 1, 4).setValues([['LOCAL','LAT','LON','RADIO_M']]);
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, sucursales: [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const vals = hoja.getDataRange().getValues();
    if (vals.length < 2) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, sucursales: [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const hdrs   = vals[0].map(h => String(h).trim().toUpperCase());
    const iLocal = hdrs.indexOf('LOCAL');
    const iLat   = hdrs.indexOf('LAT');
    const iLon   = hdrs.indexOf('LON');
    const iRadio = hdrs.indexOf('RADIO_M');

    const sucursales = vals.slice(1)
      .filter(r => r[iLocal])
      .map(r => ({
        local:   String(r[iLocal]).trim(),
        lat:     parseFloat(r[iLat])   || 0,
        lon:     parseFloat(r[iLon])   || 0,
        radio_m: parseFloat(r[iRadio]) || 150,
      }));

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, sucursales }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── FICHADAS: historial del empleado ──────────────────

function getFichadasEmpleado(e) {
  try {
    const empleado = String(e.parameter.empleado || '').trim();
    if (!empleado) throw new Error('Falta empleado');
    const incluirAnuladas = e.parameter.incluir_anuladas === '1';

    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = ss.getSheetByName('FICHADAS');
    if (!hoja) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, fichadas: [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const vals = hoja.getDataRange().getValues();
    if (vals.length < 2) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, fichadas: [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const hdrs    = vals[0].map(h => String(h).trim());
    const ci      = name => hdrs.indexOf(name);
    const iEmp    = ci('EMPLEADO/A');
    const iFecha  = ci('FECHA');
    const iEntr   = ci('HORA ENTRADA');
    const iSal    = ci('HORA SALIDA');
    const iTotal  = ci('TOTAL en hs');
    const iTipo   = ci('TIPO_REGISTRO');
    const iLocal  = ci('LOCAL');
    const iFRecup = ci('FECHA_A_RECUPERAR');
    const iNota   = hdrs.findIndex(h => h.startsWith('Nota adicional'));
    const iMarca  = ci('Marca temporal');
    const iIdFich = ci('ID_FICHADA');
    const iEstado = ci('ESTADO');

    const tz = Session.getScriptTimeZone();
    const fmtFechaCelda = v => v instanceof Date
      ? Utilities.formatDate(v, tz, 'yyyy-MM-dd')
      : String(v || '').substring(0, 10);

    const empleadoNorm = _normalizarNombreEmpleado(empleado);
    const fichadas = vals.slice(1)
      .filter(r => _normalizarNombreEmpleado(r[iEmp]) === empleadoNorm)
      .map(r => ({
        fecha:             fmtFechaCelda(r[iFecha]),
        entrada:           formatearHora(r[iEntr]),
        salida:            formatearHora(r[iSal]),
        total:             parseFloat(r[iTotal]) || 0,
        tipo:              String(r[iTipo]   || 'NORMAL'),
        local:             String(r[iLocal]  || ''),
        fecha_a_recuperar: String(r[iFRecup] || ''),
        nota:              iNota >= 0 ? String(r[iNota] || '') : '',
        marca:             r[iMarca] instanceof Date ? r[iMarca].toISOString() : String(r[iMarca] || ''),
        id_fichada:        iIdFich >= 0 ? String(r[iIdFich] || '') : '',
        estado:            iEstado >= 0 ? (String(r[iEstado] || '').trim() || 'ACTIVA') : 'ACTIVA',
      }))
      .filter(f => incluirAnuladas || f.estado !== 'ANULADA')
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
      .slice(0, 60);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, fichadas }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ══════════════════════════════════════════════════════
//  EXPORTACIÓN DE FICHADAS — accion=exportar_fichadas (Node → GAS, POST,
//  vía despacharAccionSegura). Administración › Fichadas (Fase 1).
//  Sin caps de fila (a diferencia de getFichadasEmpleado), sin escribir en
//  ninguna hoja. Empresa se resuelve por join en memoria contra EMPLEADOS
//  (nombre normalizado) porque FICHADAS no tiene columna EMPRESA propia.
// ══════════════════════════════════════════════════════

// Mapeo LOCAL → sucursal oficial. IMPORTANTE (verificado contra producción
// con accionDiagnosticoFichadas el 2026-08-03): FICHADAS.LOCAL guarda el
// NOMBRE OFICIAL completo ("01 PASEO", "05 WAVE"...), tal como lo manda
// guardarFichada(datos.local) desde el frontend — NO el código corto "hoja"
// que usa la hoja SUCURSALES_GEO/el resto de la UI. Por eso la clave de
// búsqueda acá es `nombre`, no `hoja`. Se conserva `hoja` en la tabla por si
// aparece algún registro histórico con el código corto, pero la clave
// primaria de match es el nombre oficial. Espejo de SUCURSALES en app.js —
// mantener sincronizados si se agrega o renombra una sucursal.
const SUCURSALES_EXPORT = [
  { id: '01',      hoja: 'PASEO',   nombre: '01 PASEO'           },
  { id: '05',      hoja: 'WAVE',    nombre: '05 WAVE'            },
  { id: '09',      hoja: 'CIPO',    nombre: '09 CIPO SAN MARTIN' },
  { id: '10',      hoja: 'PERITO',  nombre: '10 PERITO MORENO'   },
  { id: '12',      hoja: 'CENTE',   nombre: '12 CENTENARIO'      },
  { id: '14',      hoja: 'ROCA180', nombre: '14 ROCA'            },
  { id: 'DEPO',    hoja: 'DEPO',    nombre: 'DEPO'               },
  { id: 'OFICINA', hoja: 'OFICINA', nombre: 'OFICINA'            },
];
const _SUC_EXPORT_POR_LOCAL = {}; // clave real de match: LOCAL tal como se guarda en FICHADAS
const _SUC_EXPORT_POR_ID    = {};
SUCURSALES_EXPORT.forEach(function(s) {
  _SUC_EXPORT_POR_LOCAL[s.nombre] = s; // clave primaria (nombre oficial, lo que guarda FICHADAS hoy)
  if (!_SUC_EXPORT_POR_LOCAL[s.hoja]) _SUC_EXPORT_POR_LOCAL[s.hoja] = s; // fallback por si hay históricos con código corto
  _SUC_EXPORT_POR_ID[s.id] = s;
});

function accionExportarFichadas(datos) {
  datos = datos || {};
  const anio          = String(datos.anio || '').trim();
  const mesNum         = datos.mes !== undefined && datos.mes !== null && String(datos.mes).trim() !== ''
    ? Number(datos.mes) : null;
  const empresa        = String(datos.empresa || '').trim();
  const sucursal       = String(datos.sucursal || '').trim(); // id oficial: '01'..'14','DEPO','OFICINA'
  const colaborador    = String(datos.empleado || '').trim();

  if (empresa && empresa !== 'MOSHE SRL' && empresa !== 'CROMAWAVE SRL') {
    return _resp({ ok: false, error: 'Empresa inválida' });
  }
  if (sucursal && !_SUC_EXPORT_POR_ID[sucursal]) {
    return _resp({ ok: false, error: 'Sucursal inválida' });
  }
  if (mesNum !== null && (isNaN(mesNum) || mesNum < 1 || mesNum > 12)) {
    return _resp({ ok: false, error: 'Mes inválido' });
  }
  if (anio && (isNaN(Number(anio)) || String(Number(anio)).length !== 4)) {
    return _resp({ ok: false, error: 'Año inválido' });
  }
  const mesTextoFiltro = mesNum !== null ? MESES_ES_FICHADAS[mesNum - 1] : '';

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Mapa NOMBRE normalizado → empresa, leído una sola vez desde EMPLEADOS.
  const mapaEmpresa = {};
  const hEmp = ss.getSheetByName('EMPLEADOS');
  if (hEmp) {
    const valsEmp = hEmp.getDataRange().getValues();
    if (valsEmp.length > 1) {
      const hdrsEmp   = valsEmp[0].map(function(h) { return String(h).trim().toUpperCase(); });
      const iNom      = hdrsEmp.indexOf('NOMBRE');
      const iEmpresa  = hdrsEmp.indexOf('EMPRESA');
      for (let i = 1; i < valsEmp.length; i++) {
        const nombreNorm = _normalizarNombreEmpleado(valsEmp[i][iNom]);
        if (!nombreNorm) continue;
        mapaEmpresa[nombreNorm] = iEmpresa >= 0 ? String(valsEmp[i][iEmpresa] || '') : '';
      }
    }
  }

  const hFich = ss.getSheetByName('FICHADAS');
  const vacio = { ok: true, fichadas: [], total: 0, colaboradores: 0, sin_empresa: 0, sin_match_empleado: 0, locales_no_mapeados: [] };
  if (!hFich) return _resp(vacio);
  const vals = hFich.getDataRange().getValues();
  if (vals.length < 2) return _resp(vacio);

  const hdrs    = vals[0].map(function(h) { return String(h).trim(); });
  const ci      = function(name) { return hdrs.indexOf(name); };
  const iLocal  = ci('LOCAL');
  const iAnio   = ci('AÑO');
  const iMes    = ci('MES');
  const iDia    = ci('DIA');
  const iEmp    = ci('EMPLEADO/A');
  const iEntr   = ci('HORA ENTRADA');
  const iSal    = ci('HORA SALIDA');
  const iTotal  = ci('TOTAL en hs');
  const iFecha  = ci('FECHA');
  const iTipo   = ci('TIPO_REGISTRO');
  const iModo   = ci('MODO_CARGA');
  const iNota   = hdrs.findIndex(function(h) { return h.indexOf('Nota adicional') === 0; });
  const iIdFich = ci('ID_FICHADA');
  const iEstado = ci('ESTADO');

  const tz = Session.getScriptTimeZone();
  const fmtFechaCelda = function(v) {
    return v instanceof Date
      ? Utilities.formatDate(v, tz, 'yyyy-MM-dd')
      : String(v || '').substring(0, 10);
  };

  const colaboradorNorm   = colaborador ? _normalizarNombreEmpleado(colaborador) : '';
  const localesNoMapeados = {};
  let sinEmpresa       = 0;
  let sinMatchEmpleado = 0;
  const colaboradoresSet = {};
  const salida = [];

  for (let i = 1; i < vals.length; i++) {
    const row    = vals[i];
    const estado = iEstado >= 0 ? (String(row[iEstado] || '').trim() || 'ACTIVA') : 'ACTIVA';
    if (estado === 'ANULADA') continue; // excluidas por defecto — sin override en esta fase

    const anioFila = String(row[iAnio] || '').trim();
    const mesFila  = String(row[iMes]  || '').trim();
    if (anio && anioFila !== anio) continue;
    if (mesTextoFiltro && mesFila !== mesTextoFiltro) continue;

    const empleadoRaw  = row[iEmp];
    const empleadoNorm = _normalizarNombreEmpleado(empleadoRaw);
    if (colaboradorNorm && empleadoNorm !== colaboradorNorm) continue;

    const localRaw = String(row[iLocal] || '').trim();
    const sucInfo   = _SUC_EXPORT_POR_LOCAL[localRaw];
    if (sucursal && (!sucInfo || sucInfo.id !== sucursal)) continue;
    if (localRaw && !sucInfo) localesNoMapeados[localRaw] = (localesNoMapeados[localRaw] || 0) + 1;

    const tieneMatch  = Object.prototype.hasOwnProperty.call(mapaEmpresa, empleadoNorm);
    const empresaFila = tieneMatch ? mapaEmpresa[empleadoNorm] : '';
    if (empresa && empresaFila !== empresa) continue;
    if (!empresaFila) sinEmpresa++;
    if (!tieneMatch) sinMatchEmpleado++;

    colaboradoresSet[empleadoNorm] = true;

    salida.push({
      empresa:    empresaFila,
      sucursal:   sucInfo ? sucInfo.nombre : localRaw,
      empleado:   String(empleadoRaw || ''),
      anio:       anioFila,
      mes:        mesFila,
      dia:        String(row[iDia] || ''), // día de la semana (así se guarda en FICHADAS, no día del mes)
      fecha:      fmtFechaCelda(row[iFecha]),
      entrada:    formatearHora(row[iEntr]),
      salida_hs:  formatearHora(row[iSal]),
      total:      parseFloat(row[iTotal]) || 0,
      tipo:       String(row[iTipo] || 'NORMAL'),
      modo_carga: String(row[iModo] || ''),
      nota:       iNota >= 0 ? String(row[iNota] || '') : '',
      estado:     estado,
      id_fichada: iIdFich >= 0 ? String(row[iIdFich] || '') : '',
    });
  }

  // Auditoría mínima — solo cuando Node confirma que esto es una descarga
  // real (no cada consulta de vista previa mientras el admin toca filtros).
  // Actor viene de datos.actor, que Node completa desde el JWT verificado
  // server-side (req.user.usuario) — nunca de un campo mandado por el
  // navegador. No se guarda contenido del CSV ni fichadas individuales,
  // solo el resumen del filtro usado y la cantidad de registros.
  if (datos.confirmar_auditoria === true) {
    registrarAuditoria(
      datos.actor,
      'EXPORTACION_FICHADAS',
      'FICHADAS',
      (anio || 'todos') + '-' + (mesTextoFiltro || 'todos'),
      null,
      {
        fecha: Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'),
        anio: anio || 'todos',
        mes: mesTextoFiltro || 'todos',
        empresa: empresa || 'todas',
        sucursal: sucursal ? (_SUC_EXPORT_POR_ID[sucursal].nombre) : 'todas',
        colaborador: colaborador || 'NOMINA_COMPLETA',
        cantidad: salida.length,
      }
    );
  }

  return _resp({
    ok: true,
    fichadas: salida,
    total: salida.length,
    colaboradores: Object.keys(colaboradoresSet).length,
    sin_empresa: sinEmpresa,
    sin_match_empleado: sinMatchEmpleado,
    locales_no_mapeados: Object.keys(localesNoMapeados),
  });
}

// HERRAMIENTA INTERNA — NO desplegada como acción del dispatcher (retirada
// de despacharAccionSegura tras usarla para medir FICHADAS antes de la
// Fase 1, 2026-08-03). Se conserva en el archivo como referencia/documentación
// y para volver a usarla manualmente si hace falta re-medir: ejecutarla desde
// el editor de Apps Script ("Ejecutar" → accionDiagnosticoFichadas → ver
// Registro de ejecución), nunca vía HTTP. Si se necesita de nuevo como
// endpoint, hay que agregarla explícitamente al dispatcher otra vez.
// Solo lectura, no escribe. Agrega por año/mes para no exponer datos
// individuales de más al pedir la medición.
function accionDiagnosticoFichadas() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const t0    = new Date().getTime();
  const hFich = ss.getSheetByName('FICHADAS');
  if (!hFich) return _resp({ ok: true, total_filas: 0 });
  const vals = hFich.getDataRange().getValues();
  const tLectura = new Date().getTime() - t0;
  if (vals.length < 2) return _resp({ ok: true, total_filas: 0, ms_lectura: tLectura });

  const hdrs    = vals[0].map(function(h) { return String(h).trim(); });
  const ci      = function(name) { return hdrs.indexOf(name); };
  const iLocal  = ci('LOCAL');
  const iAnio   = ci('AÑO');
  const iMes    = ci('MES');
  const iEmp    = ci('EMPLEADO/A');
  const iEstado = ci('ESTADO');

  const mapaEmpresa = {};
  const hEmp = ss.getSheetByName('EMPLEADOS');
  if (hEmp) {
    const valsEmp = hEmp.getDataRange().getValues();
    if (valsEmp.length > 1) {
      const hdrsEmp = valsEmp[0].map(function(h) { return String(h).trim().toUpperCase(); });
      const iNom    = hdrsEmp.indexOf('NOMBRE');
      for (let i = 1; i < valsEmp.length; i++) {
        const n = _normalizarNombreEmpleado(valsEmp[i][iNom]);
        if (n) mapaEmpresa[n] = true;
      }
    }
  }

  const t1 = new Date().getTime();
  const porAnioMes = {};
  const localesVistos = {};
  let anuladas = 0;
  let sinMatch = 0;
  const empleadosSinMatch = {};

  for (let i = 1; i < vals.length; i++) {
    const row = vals[i];
    const estado = iEstado >= 0 ? (String(row[iEstado] || '').trim() || 'ACTIVA') : 'ACTIVA';
    if (estado === 'ANULADA') anuladas++;

    const clave = String(row[iAnio] || '') + '-' + String(row[iMes] || '');
    porAnioMes[clave] = (porAnioMes[clave] || 0) + 1;

    const localRaw = String(row[iLocal] || '').trim();
    if (localRaw) localesVistos[localRaw] = (localesVistos[localRaw] || 0) + 1;

    const empleadoNorm = _normalizarNombreEmpleado(row[iEmp]);
    if (empleadoNorm && !mapaEmpresa[empleadoNorm]) {
      sinMatch++;
      empleadosSinMatch[row[iEmp]] = (empleadosSinMatch[row[iEmp]] || 0) + 1;
    }
  }
  const tFiltrado = new Date().getTime() - t1;

  const maxMes = Object.keys(porAnioMes).reduce(function(max, k) {
    return porAnioMes[k] > (porAnioMes[max] || 0) ? k : max;
  }, '');

  return _resp({
    ok: true,
    total_filas: vals.length - 1,
    ms_lectura: tLectura,
    ms_filtrado_y_join: tFiltrado,
    anuladas: anuladas,
    por_anio_mes: porAnioMes,
    mes_con_mas_filas: { clave: maxMes, filas: porAnioMes[maxMes] || 0 },
    locales_vistos: localesVistos,
    locales_no_oficiales: Object.keys(localesVistos).filter(function(l) { return !_SUC_EXPORT_POR_LOCAL[l]; }),
    fichadas_sin_match_empleado: sinMatch,
    empleados_sin_match_muestra: Object.keys(empleadosSinMatch).slice(0, 20),
  });
}

// ══════════════════════════════════════════════════════
//  RECIBOS — Fase 3, Commit 1: prueba aislada de DriveApp.
//  HERRAMIENTA INTERNA — NO desplegada como acción del dispatcher (retirada
//  de despacharAccionSegura el 2026-08-03, tras medir 100KB/500KB/1MB/2MB,
//  los 4 sin error). Se conserva en el archivo como referencia y para
//  volver a usarla manualmente si hace falta remedir con tamaños mayores:
//  ejecutarla desde el editor de Apps Script ("Ejecutar" con datos de
//  prueba armados a mano), nunca vía HTTP. Si se necesita de nuevo como
//  endpoint, hay que agregarla explícitamente al dispatcher otra vez.
//  La carpeta raíz que crea SÍ queda (es parte de la estructura real que
//  va a usar el módulo); _DIAGNOSTICO_TEMPORAL queda vacía.
// ══════════════════════════════════════════════════════
function accionDiagnosticoDrive(datos) {
  datos = datos || {};
  const resultado = { ok: true };

  // Datos de cuenta: SOLO al log de ejecución de GAS (Ver > Registro de
  // ejecución en el editor), NUNCA en la respuesta HTTP — el diagnóstico
  // no debe devolver datos de cuenta al llamador bajo ninguna circunstancia.
  try { Logger.log('usuario_activo: ' + (Session.getActiveUser().getEmail() || '(vacío)')); } catch (e) { Logger.log('usuario_activo: ERROR ' + e.message); }
  try { Logger.log('usuario_efectivo: ' + (Session.getEffectiveUser().getEmail() || '(vacío)')); } catch (e) { Logger.log('usuario_efectivo: ERROR ' + e.message); }

  // Carpeta raíz — SÍ es parte de la estructura real y permanente del
  // módulo (no se borra al terminar el diagnóstico).
  const NOMBRE_RAIZ = 'CROMA_HORARIOS_RECIBOS';
  let carpetaRaiz;
  try {
    const existentes = DriveApp.getFoldersByName(NOMBRE_RAIZ);
    const yaExistia = existentes.hasNext();
    carpetaRaiz = yaExistia ? existentes.next() : DriveApp.createFolder(NOMBRE_RAIZ);
    resultado.carpeta_raiz_creada_o_encontrada = true;
    resultado.carpeta_raiz_ya_existia = yaExistia;
    try {
      const acceso = carpetaRaiz.getSharingAccess();
      // Solo un booleano — nunca el enum crudo ni ningún identificador.
      resultado.carpeta_raiz_es_privada = (acceso === DriveApp.Access.PRIVATE);
    } catch (e2) {
      resultado.carpeta_raiz_es_privada = null;
    }
  } catch (e) {
    resultado.ok = false;
    resultado.error_carpeta_raiz = e.message;
    return _resp(resultado);
  }

  // El diagnóstico opera ÚNICAMENTE dentro de _DIAGNOSTICO_TEMPORAL — la
  // estructura real de empresa/período (MOSHE_SRL/2026-08, etc.) es parte
  // de la implementación definitiva, después de aprobar este diagnóstico,
  // no de esta prueba.
  let carpetaPrueba;
  try {
    const NOMBRE_PRUEBA = '_DIAGNOSTICO_TEMPORAL';
    const itP = carpetaRaiz.getFoldersByName(NOMBRE_PRUEBA);
    carpetaPrueba = itP.hasNext() ? itP.next() : carpetaRaiz.createFolder(NOMBRE_PRUEBA);
  } catch (e) {
    resultado.ok = false;
    resultado.error_carpeta_prueba = e.message;
    return _resp(resultado);
  }

  // Prueba de tamaño real — contenido SINTÉTICO (nunca un recibo real),
  // solo si Node manda un base64 de prueba. try/finally: el archivo se
  // borra de la carpeta de prueba pase lo que pase, incluso si falla la
  // lectura de verificación a mitad de camino.
  if (datos.base64_prueba) {
    let archivo = null;
    try {
      const t0 = new Date().getTime();
      const bytes = Utilities.base64Decode(datos.base64_prueba);
      const blob  = Utilities.newBlob(bytes, 'application/pdf', 'prueba_diagnostico.pdf');
      const tDecode = new Date().getTime() - t0;

      const t1 = new Date().getTime();
      archivo = carpetaPrueba.createFile(blob);
      const tSubida = new Date().getTime() - t1;

      const t2 = new Date().getTime();
      const tamanoLeido = archivo.getBlob().getBytes().length;
      const tLectura = new Date().getTime() - t2;

      resultado.prueba_archivo = {
        tamano_enviado_bytes: bytes.length,
        tamano_leido_bytes: tamanoLeido,
        coincide: bytes.length === tamanoLeido,
        ms_decode_base64: tDecode,
        ms_subida: tSubida,
        ms_lectura: tLectura,
      };
    } catch (e) {
      resultado.prueba_archivo = { error: e.message };
    } finally {
      // Se ejecuta siempre, incluso si el try de arriba explotó a mitad
      // de camino (por eso "archivo" se inicializa afuera del try).
      if (archivo) {
        try { archivo.setTrashed(true); resultado.archivo_prueba_limpiado = true; }
        catch (eLimpieza) { resultado.archivo_prueba_limpiado = false; resultado.error_limpieza = eLimpieza.message; }
      }
    }
  }

  return _resp(resultado);
}

// ══════════════════════════════════════════════════════
//  RECIBOS — Fase 3, Commit 2: modelo de datos (hoja RECIBOS) y helpers
//  internos. SIN acciones nuevas en despacharAccionSegura todavía (eso es
//  el Commit 3) — nada de este bloque es alcanzable por HTTP en este
//  commit. No escribe archivos reales ni crea carpetas de producto: los
//  helpers de Drive existen pero nadie los llama todavía.
// ══════════════════════════════════════════════════════

const RECIBOS_HEADERS = [
  'ID', 'EMPLEADO', 'NOMBRE_LEGAL', 'EMPRESA', 'PERIODO', 'TIPO',
  'NOMBRE_ARCHIVO', 'MIME_TYPE', 'TAMANO_BYTES', 'DRIVE_FILE_ID',
  'ESTADO', 'VERSION', 'SUBIDO_POR', 'FECHA_SUBIDA', 'REEMPLAZA_A',
  'FECHA_DESCARGA_EMPLEADO',
];

const RECIBOS_ESTADOS_VALIDOS  = ['ACTIVO', 'REEMPLAZADO'];
const RECIBOS_EMPRESAS_VALIDAS = ['MOSHE SRL', 'CROMAWAVE SRL'];
const RECIBOS_MIME_VALIDO      = 'application/pdf';

// ── Hoja: creación/actualización idempotente ───────────────────────────
function _asegurarHojaRecibos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName('RECIBOS');
  if (!hoja) {
    hoja = ss.insertSheet('RECIBOS');
    hoja.getRange(1, 1, 1, RECIBOS_HEADERS.length).setValues([RECIBOS_HEADERS]);
    hoja.setFrozenRows(1);
  } else {
    // Ya existía (ej. re-ejecución de esta función) — asegura cada columna
    // sin reordenar ni tocar las que ya estén. Mismo patrón que _upsertEmpleado.
    RECIBOS_HEADERS.forEach(function(h) { _asegurarColumna(hoja, h); });
  }
  // El forzado de formato de texto en toda la columna PERIODO (que vivía
  // acá) se sacó por rendimiento: _asegurarHojaRecibos() se llama en TODA
  // acción de Recibos (listar, descargar, subir, reemplazar — incluso más
  // de una vez por request), y un setNumberFormat sobre hoja.getMaxRows()
  // filas es una operación cara que se pagaba en cada una de esas
  // llamadas, incluidas las de solo lectura. Es redundante: la protección
  // real contra el problema de PERIODO-como-Date ya está cubierta en los
  // dos lugares que importan — _crearMetadataRecibo() formatea la celda
  // puntual ANTES de escribir cada fila nueva, y _normalizarPeriodoCelda()
  // normaliza cualquier valor en la LECTURA, sin importar el formato de la
  // celda. Ver esos dos para el detalle del bug original (2026-08).
  return hoja;
}

// ── ID único — mismo patrón atómico ya probado en generarNuevoIdFichada() ──
function _formatearIdRecibo(n) { return 'REC' + String(n).padStart(6, '0'); }

function generarNuevoIdRecibo() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props  = PropertiesService.getScriptProperties();
    const actual = parseInt(props.getProperty('NEXT_RECIBO_ID'), 10) || 1;
    props.setProperty('NEXT_RECIBO_ID', String(actual + 1));
    return _formatearIdRecibo(actual);
  } finally {
    lock.releaseLock();
  }
}

// ── Validaciones puras ──────────────────────────────────────────────────
function _validarPeriodoRecibo(periodo) {
  const p = String(periodo || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) return false;
  const anio = parseInt(p.slice(0, 4), 10);
  return anio >= 2020 && anio <= 2100;
}

function _validarEmpresaRecibo(empresa) {
  return RECIBOS_EMPRESAS_VALIDAS.indexOf(empresa) >= 0;
}

function _validarEstadoRecibo(estado) {
  return RECIBOS_ESTADOS_VALIDOS.indexOf(estado) >= 0;
}

// Saca separadores de ruta, caracteres de control y colapsa "..", recorta
// longitud — nunca confía en el nombre que venga del cliente para usarlo
// como nombre de archivo real en Drive.
function _sanearNombreArchivoRecibo(nombre) {
  let n = String(nombre || '').trim();
  n = n.replace(/[\/\\]/g, '_');
  n = n.replace(/[\x00-\x1f\x7f]/g, '');
  n = n.replace(/\.\.+/g, '.');
  if (n.length > 150) n = n.slice(0, 150);
  return n || 'recibo.pdf';
}

function _slugEmpresaRecibo(empresa) {
  return String(empresa || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// ── Resolución de empleado — nunca confía en NOMBRE_LEGAL/EMPRESA que
// mande el cliente, siempre los deriva de EMPLEADOS en este momento. ────
function _resolverEmpleadoRecibo(nombreOperativo) {
  const ss   = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName('EMPLEADOS');
  if (!hoja) return null;
  const vals = hoja.getDataRange().getValues();
  if (vals.length < 2) return null;
  const headers    = vals[0].map(function(h) { return String(h).trim().toUpperCase(); });
  const nombreNorm = _normalizarNombreEmpleado(nombreOperativo);
  for (let i = 1; i < vals.length; i++) {
    if (_normalizarNombreEmpleado(vals[i][0]) === nombreNorm) {
      return _filaEmpleadoAObjeto(headers, vals[i]);
    }
  }
  return null;
}

// Snapshot listo para grabar en RECIBOS. Falla explícito (mensajes usados
// como código de error por el llamador) si falta cualquiera de las tres
// cosas que el registro necesita para poder existir.
function _obtenerSnapshotReciboEmpleado(nombreOperativo) {
  const empleado = _resolverEmpleadoRecibo(nombreOperativo);
  if (!empleado) throw new Error('EMPLEADO_NO_ENCONTRADO');

  const nombreLegal = String(empleado.nombre_legal || '').trim();
  if (!nombreLegal) throw new Error('NOMBRE_LEGAL_VACIO');

  const empresa = String(empleado.empresa || '').trim();
  if (!empresa) throw new Error('EMPRESA_VACIA');
  if (!_validarEmpresaRecibo(empresa)) throw new Error('EMPRESA_INVALIDA');

  return { nombre: empleado.nombre, nombre_legal: nombreLegal, empresa: empresa };
}

// ── Carpetas de Drive — privadas por defecto, nunca "cualquiera con el
// enlace". No se llaman desde ningún lado todavía en este commit. ───────
// La carpeta raíz vive en una cuenta de Drive distinta a la que ejecuta
// este script (separación de espacio de almacenamiento — ver decisión de
// diseño). No se busca/crea por nombre en el Drive del script: es un ID
// fijo, configurado en Script Properties (mismo lugar que BACKEND_SECRET),
// de una carpeta ya creada y compartida como Editor con esta cuenta.
// Falla explícito si no está configurada — nunca crea una carpeta de
// respaldo en el lugar equivocado.
function _obtenerOCrearCarpetaRaizRecibos() {
  const id = PropertiesService.getScriptProperties().getProperty('RECIBOS_CARPETA_RAIZ_ID');
  if (!id) throw new Error('RECIBOS_CARPETA_RAIZ_ID no configurado en Script Properties');
  return DriveApp.getFolderById(id);
}

function _obtenerOCrearCarpetaRecibo(empresa, periodo) {
  if (!_validarEmpresaRecibo(empresa)) throw new Error('EMPRESA_INVALIDA');
  if (!_validarPeriodoRecibo(periodo)) throw new Error('PERIODO_INVALIDO');
  const raiz = _obtenerOCrearCarpetaRaizRecibos();
  const slugEmpresa = _slugEmpresaRecibo(empresa);
  const itEmpresa = raiz.getFoldersByName(slugEmpresa);
  const carpetaEmpresa = itEmpresa.hasNext() ? itEmpresa.next() : raiz.createFolder(slugEmpresa);
  const itPeriodo = carpetaEmpresa.getFoldersByName(periodo);
  return itPeriodo.hasNext() ? itPeriodo.next() : carpetaEmpresa.createFolder(periodo);
  // Nunca se toca el sharing acá — Drive crea las carpetas privadas por
  // defecto y este helper no llama a setSharing en ningún caso.
}

// ── Metadata: crear, mapear, buscar ─────────────────────────────────────
// datos: { empleado, nombre_legal, empresa, periodo, tipo, nombre_archivo,
//          mime_type, tamano_bytes, drive_file_id, version, subido_por,
//          reemplaza_a }
function _crearMetadataRecibo(datos) {
  datos = datos || {};
  if (!datos.empleado || !datos.nombre_legal) throw new Error('DATOS_INCOMPLETOS');
  if (!_validarPeriodoRecibo(datos.periodo)) throw new Error('PERIODO_INVALIDO');
  if (!_validarEmpresaRecibo(datos.empresa)) throw new Error('EMPRESA_INVALIDA');
  if (datos.mime_type !== RECIBOS_MIME_VALIDO) throw new Error('MIME_TYPE_INVALIDO');
  if (!Number.isInteger(datos.version) || datos.version < 1) throw new Error('VERSION_INVALIDA');
  if (!Number.isFinite(datos.tamano_bytes) || datos.tamano_bytes < 0) throw new Error('TAMANO_INVALIDO');

  const hoja = _asegurarHojaRecibos();
  // Permite pasar un ID ya generado (subir_recibo/reemplazar_recibo lo
  // necesitan ANTES de crear el archivo en Drive, para nombrarlo con ese
  // ID). Si no viene, se comporta igual que antes.
  const id = datos.id || generarNuevoIdRecibo();
  const nombreArchivo = _sanearNombreArchivoRecibo(datos.nombre_archivo);

  const filaIndex = hoja.getLastRow() + 1;
  // PERIODO ("2099-01") se ve como fecha para Sheets y lo autoconvierte a
  // Date si la celda queda en formato Automático — rompe toda comparación
  // de string más adelante (duplicados, versión, listado). Forzar texto
  // plano ANTES de escribir el valor, no después.
  const colPeriodo = RECIBOS_HEADERS.indexOf('PERIODO') + 1;
  hoja.getRange(filaIndex, colPeriodo).setNumberFormat('@');

  hoja.getRange(filaIndex, 1, 1, RECIBOS_HEADERS.length).setValues([[
    id,
    datos.empleado,
    datos.nombre_legal,
    datos.empresa,
    datos.periodo,
    datos.tipo || 'RECIBO_SUELDO',
    nombreArchivo,
    datos.mime_type,
    datos.tamano_bytes,
    datos.drive_file_id || '',
    'ACTIVO',
    datos.version,
    datos.subido_por || 'desconocido',
    new Date(),
    datos.reemplaza_a || '',
    '', // FECHA_DESCARGA_EMPLEADO — vacía al crear
  ]]);

  return id;
}

// DRIVE_FILE_ID deliberadamente NO se incluye acá — es el objeto que
// eventualmente puede viajar hacia afuera de GAS (listados, etc.).
// Defensa en la lectura: si alguna celda de PERIODO quedó como Date (fila
// vieja escrita antes de este fix, o edición manual futura), la devuelve
// como "YYYY-MM" igual — nunca deja pasar un objeto Date hacia afuera de
// este archivo ni hacia una comparación de string.
function _normalizarPeriodoCelda(valor) {
  if (valor instanceof Date) {
    const tz = Session.getScriptTimeZone();
    return Utilities.formatDate(valor, tz, 'yyyy-MM');
  }
  return String(valor || '').trim();
}

function _filaReciboAObjeto(headers, fila) {
  const col = function(name) { return headers.indexOf(name); };
  const val = function(name) { const c = col(name); return c >= 0 ? fila[c] : ''; };
  return {
    id:                       val('ID'),
    empleado:                 val('EMPLEADO'),
    nombre_legal:             val('NOMBRE_LEGAL'),
    empresa:                  val('EMPRESA'),
    periodo:                  _normalizarPeriodoCelda(val('PERIODO')),
    tipo:                     val('TIPO'),
    nombre_archivo:           val('NOMBRE_ARCHIVO'),
    mime_type:                val('MIME_TYPE'),
    tamano_bytes:             val('TAMANO_BYTES'),
    estado:                   val('ESTADO'),
    version:                  val('VERSION'),
    subido_por:               val('SUBIDO_POR'),
    fecha_subida:             val('FECHA_SUBIDA'),
    reemplaza_a:              val('REEMPLAZA_A'),
    fecha_descarga_empleado:  val('FECHA_DESCARGA_EMPLEADO'),
  };
}

// Único punto interno que expone DRIVE_FILE_ID — reservado para la futura
// acción de descarga (Commit 3). Nunca usar en listados ni en cualquier
// respuesta que pueda llegar tal cual al frontend.
function _driveFileIdDeRecibo(headers, fila) {
  const c = headers.indexOf('DRIVE_FILE_ID');
  return c >= 0 ? fila[c] : '';
}

// incluirDriveFileId: SOLO para accionListarRecibosEmpleado(), que es
// backend-to-backend (secreto + POST, nunca doGet) — croma-backend cachea
// este listado y lo reusa para resolver drive_file_id al descargar sin
// pegarle a GAS de nuevo en cada clic. _filaReciboAObjeto() sigue sin
// incluirlo (esa sí la reusan lugares que no deberían ver DRIVE_FILE_ID).
function _listarRecibosPorEmpleado(nombreOperativo, incluirDriveFileId) {
  const hoja = _asegurarHojaRecibos();
  const vals = hoja.getDataRange().getValues();
  if (vals.length < 2) return [];
  const headers    = vals[0].map(function(h) { return String(h).trim().toUpperCase(); });
  const nombreNorm = _normalizarNombreEmpleado(nombreOperativo);
  const iEmp = headers.indexOf('EMPLEADO');
  const resultado = [];
  for (let i = 1; i < vals.length; i++) {
    if (_normalizarNombreEmpleado(vals[i][iEmp]) === nombreNorm) {
      const obj = _filaReciboAObjeto(headers, vals[i]);
      if (incluirDriveFileId) obj.drive_file_id = _driveFileIdDeRecibo(headers, vals[i]);
      resultado.push(obj);
    }
  }
  return resultado;
}

function _buscarReciboPorId(id) {
  const idBuscado = String(id || '').trim();
  if (!idBuscado) return null;
  const hoja = _asegurarHojaRecibos();
  const vals = hoja.getDataRange().getValues();
  if (vals.length < 2) return null;
  const headers = vals[0].map(function(h) { return String(h).trim().toUpperCase(); });
  const iId = headers.indexOf('ID');
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][iId]).trim() === idBuscado) {
      // valoresFila (la fila cruda) se conserva para el único uso interno
      // legítimo de leer DRIVE_FILE_ID — ver _driveFileIdDeRecibo().
      return { objeto: _filaReciboAObjeto(headers, vals[i]), fila: i + 1, headers: headers, valoresFila: vals[i] };
    }
  }
  return null;
}

// Última versión ACTIVA para un empleado+período. Invariante esperada: a
// lo sumo una fila ACTIVA por combinación — si aparece más de una, es una
// inconsistencia de datos y se falla en vez de adivinar cuál devolver.
function _obtenerUltimaVersionActiva(nombreOperativo, periodo) {
  const recibos = _listarRecibosPorEmpleado(nombreOperativo)
    .filter(function(r) { return r.periodo === periodo && r.estado === 'ACTIVO'; });
  if (recibos.length === 0) return null;
  if (recibos.length > 1) throw new Error('INCONSISTENCIA_MULTIPLES_ACTIVOS');
  return recibos[0];
}

function _calcularSiguienteVersion(nombreOperativo, periodo) {
  const recibos = _listarRecibosPorEmpleado(nombreOperativo)
    .filter(function(r) { return r.periodo === periodo; });
  if (recibos.length === 0) return 1;
  const maxVersion = recibos.reduce(function(max, r) {
    const v = parseInt(r.version, 10) || 0;
    return v > max ? v : max;
  }, 0);
  return maxVersion + 1;
}

// ── Transiciones de estado ───────────────────────────────────────────────
function _marcarReciboReemplazado(id) {
  const encontrado = _buscarReciboPorId(id);
  if (!encontrado) throw new Error('RECIBO_NO_ENCONTRADO');
  const hoja = _asegurarHojaRecibos();
  const cEstado = encontrado.headers.indexOf('ESTADO');
  hoja.getRange(encontrado.fila, cEstado + 1).setValue('REEMPLAZADO');
}

function _actualizarFechaDescargaEmpleado(id) {
  const encontrado = _buscarReciboPorId(id);
  if (!encontrado) throw new Error('RECIBO_NO_ENCONTRADO');
  const hoja = _asegurarHojaRecibos();
  const cFecha = encontrado.headers.indexOf('FECHA_DESCARGA_EMPLEADO');
  hoja.getRange(encontrado.fila, cFecha + 1).setValue(new Date());
}

// ══════════════════════════════════════════════════════
//  RECIBOS — Fase 3, Commit 3: acciones seguras (subir, listar, obtener
//  archivo, reemplazar). Únicamente dentro de despacharAccionSegura(),
//  protegidas por BACKEND_SECRET — nunca en doGet/doPost públicos.
// ══════════════════════════════════════════════════════

// Límite PROVISIONAL basado en lo medido en el Commit 1 (100KB–2MB, sin
// errores). No se probaron 5MB/10MB todavía — subir este número requiere
// medir esos tamaños primero, no es una decisión de producto todavía.
const RECIBOS_TAMANO_MAXIMO_BYTES = 2 * 1024 * 1024;

// Primeros 5 bytes de un PDF válido: "%PDF-". Comparación byte a byte,
// no regex sobre string (evita problemas de encoding con bytes > 127).
function _tieneFirmaPdf(bytes) {
  const firma = [0x25, 0x50, 0x44, 0x46, 0x2D]; // % P D F -
  if (bytes.length < firma.length) return false;
  for (let i = 0; i < firma.length; i++) {
    if (bytes[i] !== firma[i]) return false;
  }
  return true;
}

// Objeto mínimo seguro para el cliente — nunca DRIVE_FILE_ID, nunca rutas
// de Drive. Es el único "shape" de recibo que sale de este archivo hacia
// Node en listados y confirmaciones de subida/reemplazo.
function _respuestaPublicaRecibo(recibo) {
  return {
    id:             recibo.id,
    periodo:        recibo.periodo,
    empresa:        recibo.empresa,
    nombre_legal:   recibo.nombre_legal,
    tipo:           recibo.tipo,
    estado:         recibo.estado,
    version:        recibo.version,
    fecha_subida:   recibo.fecha_subida,
    nombre_archivo: recibo.nombre_archivo,
  };
}

// Validaciones comunes a subir_recibo y reemplazar_recibo — formato,
// firma y consistencia de tamaño. No toca Drive ni Sheets, solo valida
// los bytes ya decodificados. Devuelve {ok:true} o {ok:false, error}.
function _validarArchivoRecibo(bytes, tamanoDeclarado) {
  if (!bytes || bytes.length === 0) return { ok: false, error: 'ARCHIVO_VACIO' };
  if (typeof tamanoDeclarado !== 'number' || !Number.isFinite(tamanoDeclarado)) {
    return { ok: false, error: 'TAMANO_DECLARADO_INVALIDO' };
  }
  if (tamanoDeclarado !== bytes.length) return { ok: false, error: 'TAMANO_NO_COINCIDE' };
  if (bytes.length > RECIBOS_TAMANO_MAXIMO_BYTES) return { ok: false, error: 'ARCHIVO_DEMASIADO_GRANDE' };
  if (!_tieneFirmaPdf(bytes)) return { ok: false, error: 'FIRMA_PDF_INVALIDA' };
  return { ok: true };
}

// ── 1. subir_recibo ─────────────────────────────────────────────────────
function accionSubirRecibo(datos) {
  datos = datos || {};
  const actor          = String(datos.actor || 'desconocido');
  const empleadoInput   = String(datos.empleado || '').trim();
  const periodo         = String(datos.periodo || '').trim();
  const mimeType        = String(datos.mime_type || '').trim();

  if (!empleadoInput) return _resp({ ok: false, error: 'EMPLEADO_REQUERIDO' });
  if (!_validarPeriodoRecibo(periodo)) return _resp({ ok: false, error: 'PERIODO_INVALIDO' });
  if (mimeType !== RECIBOS_MIME_VALIDO) return _resp({ ok: false, error: 'MIME_TYPE_INVALIDO' });
  if (!datos.archivo_base64) return _resp({ ok: false, error: 'ARCHIVO_VACIO' });

  // Nunca confiar en NOMBRE_LEGAL/EMPRESA que mande el cliente — siempre
  // se derivan de EMPLEADOS en este momento.
  let snapshot;
  try {
    snapshot = _obtenerSnapshotReciboEmpleado(empleadoInput);
  } catch (e) {
    return _resp({ ok: false, error: e.message });
  }

  let bytes;
  try {
    bytes = Utilities.base64Decode(datos.archivo_base64);
  } catch (e) {
    return _resp({ ok: false, error: 'BASE64_INVALIDO' });
  }
  const validacion = _validarArchivoRecibo(bytes, datos.tamano_bytes);
  if (!validacion.ok) return _resp({ ok: false, error: validacion.error });

  // Chequeo de duplicado #1, con lock breve — filtra el caso común sin
  // gastar tiempo subiendo a Drive un archivo que de entrada ya sobra.
  const lock1 = LockService.getScriptLock();
  if (!lock1.tryLock(10000)) return _resp({ ok: false, error: 'SISTEMA_OCUPADO' });
  try {
    let existente;
    try {
      existente = _obtenerUltimaVersionActiva(snapshot.nombre, periodo);
    } catch (eDup) {
      return _resp({ ok: false, error: eDup.message });
    }
    if (existente) {
      return _resp({ ok: false, error: 'YA_EXISTE_ACTIVO', recibo_id_existente: existente.id });
    }
  } finally {
    lock1.releaseLock();
  }

  // Subida a Drive FUERA del lock — la parte lenta no bloquea otras
  // operaciones del script mientras dura.
  const id = generarNuevoIdRecibo(); // atómico por su cuenta (su propio lock interno)
  const nombreFisico = id + '_' + periodo + '.pdf';
  let carpeta, archivoDrive;
  try {
    carpeta = _obtenerOCrearCarpetaRecibo(snapshot.empresa, periodo);
    const blob = Utilities.newBlob(bytes, RECIBOS_MIME_VALIDO, nombreFisico);
    archivoDrive = carpeta.createFile(blob);
  } catch (eDrive) {
    return _resp({ ok: false, error: 'ERROR_DRIVE' });
  }

  // Lock #2, breve: re-verificar duplicado (cierra la ventana de carrera
  // que se abrió al soltar el lock mientras se subía a Drive) y escribir
  // la metadata. Si algo falla acá, el archivo recién subido va a papelera.
  const lock2 = LockService.getScriptLock();
  if (!lock2.tryLock(10000)) {
    try { archivoDrive.setTrashed(true); } catch (eC) {}
    return _resp({ ok: false, error: 'SISTEMA_OCUPADO' });
  }
  try {
    let existenteOtraVez;
    try {
      existenteOtraVez = _obtenerUltimaVersionActiva(snapshot.nombre, periodo);
    } catch (eDup2) {
      try { archivoDrive.setTrashed(true); } catch (eC) {}
      return _resp({ ok: false, error: eDup2.message });
    }
    if (existenteOtraVez) {
      try { archivoDrive.setTrashed(true); } catch (eC) {}
      return _resp({ ok: false, error: 'YA_EXISTE_ACTIVO', recibo_id_existente: existenteOtraVez.id });
    }

    let reciboId;
    try {
      reciboId = _crearMetadataRecibo({
        id: id,
        empleado: snapshot.nombre,
        nombre_legal: snapshot.nombre_legal,
        empresa: snapshot.empresa,
        periodo: periodo,
        tipo: 'RECIBO_SUELDO', // fijo en esta version, nunca desde el cliente
        nombre_archivo: _sanearNombreArchivoRecibo(datos.nombre_archivo),
        mime_type: RECIBOS_MIME_VALIDO,
        tamano_bytes: bytes.length,
        drive_file_id: archivoDrive.getId(),
        version: 1,
        subido_por: actor,
        reemplaza_a: '',
      });
    } catch (eMeta) {
      try { archivoDrive.setTrashed(true); } catch (eC) {}
      return _resp({ ok: false, error: 'ERROR_METADATA' });
    }

    registrarAuditoria(actor, 'RECIBO_SUBIDO', 'RECIBO', reciboId, null, {
      empleado: snapshot.nombre, periodo: periodo, empresa: snapshot.empresa, version: 1,
    });

    const encontrado = _buscarReciboPorId(reciboId);
    return _resp({ ok: true, recibo: _respuestaPublicaRecibo(encontrado.objeto) });
  } finally {
    lock2.releaseLock();
  }
}

// ── 2. listar_recibos_empleado ──────────────────────────────────────────
function accionListarRecibosEmpleado(datos) {
  datos = datos || {};
  const empleadoInput    = String(datos.empleado || '').trim();
  const incluirHistorial = datos.incluir_historial === true;

  if (!empleadoInput) return _resp({ ok: false, error: 'EMPLEADO_REQUERIDO' });

  const empleado = _resolverEmpleadoRecibo(empleadoInput);
  if (!empleado) return _resp({ ok: false, error: 'EMPLEADO_NO_ENCONTRADO' });

  // incluirDriveFileId=true: croma-backend cachea este listado y lo reusa
  // para resolver drive_file_id al descargar, sin pegarle a GAS de nuevo
  // en cada clic (ver nota en _listarRecibosPorEmpleado). Sigue siendo
  // backend-to-backend únicamente — nunca llega crudo al navegador, Node
  // lo descarta antes de responder al Portal (_reciboEmpleado/_reciboAdmin).
  let recibos = _listarRecibosPorEmpleado(empleado.nombre, true);

  // Por defecto (Portal Empleado): solo ACTIVO. Como a lo sumo hay una
  // fila ACTIVA por período (invariante del modelo), esto ya es "la
  // última versión activa de cada período" sin lógica extra.
  recibos = incluirHistorial
    ? recibos.filter(function(r) { return r.estado === 'ACTIVO' || r.estado === 'REEMPLAZADO'; })
    : recibos.filter(function(r) { return r.estado === 'ACTIVO'; });

  recibos.sort(function(a, b) {
    if (a.periodo !== b.periodo) return b.periodo.localeCompare(a.periodo);
    return (parseInt(b.version, 10) || 0) - (parseInt(a.version, 10) || 0);
  });

  // Sin auditoría — es una simple visualización de listado, mismo criterio
  // que getCertificados()/getVacaciones(), que tampoco auditan lectura.
  return _resp({ ok: true, recibos: recibos.map(function(r) {
    const pub = _respuestaPublicaRecibo(r);
    pub.drive_file_id = r.drive_file_id;
    pub.mime_type      = r.mime_type;
    pub.tamano_bytes   = r.tamano_bytes;
    return pub;
  }) });
}

// ── 3. obtener_recibo_archivo ───────────────────────────────────────────
function accionObtenerReciboArchivo(datos) {
  datos = datos || {};
  const reciboId  = String(datos.recibo_id || '').trim();
  const actor     = String(datos.actor || 'desconocido');
  // 'empleado' = descarga propia del Portal Empleado; cualquier otro valor
  // (incluido ausente) se trata como 'admin'. GAS nunca decide esto solo
  // con un nombre suelto del navegador — Node manda el empleado YA
  // resuelto por resolverEmpleadoAutenticado() cuando el contexto es empleado.
  const contexto  = datos.contexto === 'empleado' ? 'empleado' : 'admin';
  const empleadoResuelto = String(datos.empleado_resuelto || '').trim();
  const esEmpleado = contexto === 'empleado';

  // En contexto empleado, "no existe", "es de otro" y "no está disponible"
  // (metadata inválida, archivo faltante en Drive, MIME corrupto) tienen
  // que verse EXACTAMENTE igual desde afuera — mismo código, misma forma,
  // sin ningún dato técnico. Nunca confirma si un ID existe. admin/jefe sí
  // recibe el motivo específico, porque tiene permiso de consulta global.
  function _reciboNoDisponibleParaEmpleado() {
    return _resp({ ok: false, error: 'RECIBO_NO_DISPONIBLE' });
  }

  if (!reciboId) {
    return esEmpleado ? _reciboNoDisponibleParaEmpleado() : _resp({ ok: false, error: 'RECIBO_ID_REQUERIDO' });
  }
  if (esEmpleado && !empleadoResuelto) {
    return _reciboNoDisponibleParaEmpleado();
  }

  const encontrado = _buscarReciboPorId(reciboId);
  if (!encontrado) {
    return esEmpleado ? _reciboNoDisponibleParaEmpleado() : _resp({ ok: false, error: 'RECIBO_NO_ENCONTRADO' });
  }
  const recibo = encontrado.objeto;

  if (!recibo.empleado || !recibo.periodo || !recibo.mime_type) {
    return esEmpleado ? _reciboNoDisponibleParaEmpleado() : _resp({ ok: false, error: 'METADATA_INVALIDA' });
  }

  if (esEmpleado && _normalizarNombreEmpleado(empleadoResuelto) !== _normalizarNombreEmpleado(recibo.empleado)) {
    return _reciboNoDisponibleParaEmpleado();
  }

  const driveFileId = _driveFileIdDeRecibo(encontrado.headers, encontrado.valoresFila);
  if (!driveFileId) {
    return esEmpleado ? _reciboNoDisponibleParaEmpleado() : _resp({ ok: false, error: 'METADATA_INVALIDA' });
  }

  let archivoDrive;
  try {
    archivoDrive = DriveApp.getFileById(driveFileId);
  } catch (e) {
    // metadata existe, archivo falta en Drive
    return esEmpleado ? _reciboNoDisponibleParaEmpleado() : _resp({ ok: false, error: 'ARCHIVO_NO_ENCONTRADO' });
  }

  let blob;
  try {
    blob = archivoDrive.getBlob();
  } catch (e) {
    return esEmpleado ? _reciboNoDisponibleParaEmpleado() : _resp({ ok: false, error: 'ARCHIVO_NO_ENCONTRADO' });
  }

  const mimeReal = blob.getContentType();
  if (mimeReal !== RECIBOS_MIME_VALIDO) {
    return esEmpleado ? _reciboNoDisponibleParaEmpleado() : _resp({ ok: false, error: 'MIME_TYPE_INVALIDO' });
  }

  const bytes  = blob.getBytes();
  const base64 = Utilities.base64Encode(bytes);

  // Criterio elegido para FECHA_DESCARGA_EMPLEADO: se actualiza apenas se
  // recuperó el archivo con éxito desde Drive (acá mismo), no cuando el
  // navegador confirma haber terminado de recibirlo — GAS no tiene forma
  // de saber eso. Solo aplica a descargas del propio empleado, nunca
  // cuando un admin descarga en gestión de otra persona.
  if (esEmpleado) {
    try { _actualizarFechaDescargaEmpleado(reciboId); } catch (eFecha) { /* no bloquea la respuesta */ }
  }

  const accionAuditoria = esEmpleado ? 'RECIBO_DESCARGADO_EMPLEADO' : 'RECIBO_DESCARGADO_ADMIN';
  registrarAuditoria(actor, accionAuditoria, 'RECIBO', reciboId, null, {
    empleado: recibo.empleado, periodo: recibo.periodo, empresa: recibo.empresa,
  });

  return _resp({
    ok: true,
    archivo_base64: base64,
    mime_type: mimeReal,
    nombre_archivo: recibo.nombre_archivo,
    tamano_bytes: bytes.length,
    recibo: _respuestaPublicaRecibo(recibo),
  });
}

// ── 3b. obtener_recibo_drive_id ─────────────────────────────────────────
// Variante liviana de obtener_recibo_archivo() (Drive directo desde
// croma-backend, para sacar la descarga de la cola de ejecuciones de GAS):
// mismos chequeos de identidad/permiso, MISMA auditoría, pero nunca toca
// el contenido del archivo — nada de getBlob()/getBytes()/base64Encode(),
// que es la parte lenta. Devuelve solo el DRIVE_FILE_ID; croma-backend baja
// el archivo directo de la API de Drive con una cuenta de servicio.
// Nunca se expone fuera del backend interno (mismo secreto y mismo "falla
// igual para ID inexistente/ajeno/no disponible" que la acción original).
function accionObtenerReciboDriveId(datos) {
  datos = datos || {};
  const reciboId  = String(datos.recibo_id || '').trim();
  const actor     = String(datos.actor || 'desconocido');
  const contexto  = datos.contexto === 'empleado' ? 'empleado' : 'admin';
  const empleadoResuelto = String(datos.empleado_resuelto || '').trim();
  const esEmpleado = contexto === 'empleado';

  function _reciboNoDisponibleParaEmpleado() {
    return _resp({ ok: false, error: 'RECIBO_NO_DISPONIBLE' });
  }

  if (!reciboId) {
    return esEmpleado ? _reciboNoDisponibleParaEmpleado() : _resp({ ok: false, error: 'RECIBO_ID_REQUERIDO' });
  }
  if (esEmpleado && !empleadoResuelto) {
    return _reciboNoDisponibleParaEmpleado();
  }

  const encontrado = _buscarReciboPorId(reciboId);
  if (!encontrado) {
    return esEmpleado ? _reciboNoDisponibleParaEmpleado() : _resp({ ok: false, error: 'RECIBO_NO_ENCONTRADO' });
  }
  const recibo = encontrado.objeto;

  if (!recibo.empleado || !recibo.periodo || !recibo.mime_type) {
    return esEmpleado ? _reciboNoDisponibleParaEmpleado() : _resp({ ok: false, error: 'METADATA_INVALIDA' });
  }

  if (esEmpleado && _normalizarNombreEmpleado(empleadoResuelto) !== _normalizarNombreEmpleado(recibo.empleado)) {
    return _reciboNoDisponibleParaEmpleado();
  }

  const driveFileId = _driveFileIdDeRecibo(encontrado.headers, encontrado.valoresFila);
  if (!driveFileId) {
    return esEmpleado ? _reciboNoDisponibleParaEmpleado() : _resp({ ok: false, error: 'METADATA_INVALIDA' });
  }

  // Chequeo liviano de que el archivo sigue existiendo en Drive —
  // getFileById()/getMimeType() son metadata, no transfieren contenido.
  try {
    const archivoDrive = DriveApp.getFileById(driveFileId);
    if (archivoDrive.getMimeType() !== RECIBOS_MIME_VALIDO) {
      return esEmpleado ? _reciboNoDisponibleParaEmpleado() : _resp({ ok: false, error: 'MIME_TYPE_INVALIDO' });
    }
  } catch (e) {
    return esEmpleado ? _reciboNoDisponibleParaEmpleado() : _resp({ ok: false, error: 'ARCHIVO_NO_ENCONTRADO' });
  }

  // Mismo criterio que la acción original: se registra la descarga acá,
  // en el momento en que se confirmó acceso + existencia del archivo —
  // croma-backend baja el contenido inmediatamente después de esto.
  if (esEmpleado) {
    try { _actualizarFechaDescargaEmpleado(reciboId); } catch (eFecha) { /* no bloquea la respuesta */ }
  }

  const accionAuditoria = esEmpleado ? 'RECIBO_DESCARGADO_EMPLEADO' : 'RECIBO_DESCARGADO_ADMIN';
  registrarAuditoria(actor, accionAuditoria, 'RECIBO', reciboId, null, {
    empleado: recibo.empleado, periodo: recibo.periodo, empresa: recibo.empresa,
  });

  return _resp({
    ok: true,
    drive_file_id: driveFileId,
    mime_type: recibo.mime_type,
    nombre_archivo: recibo.nombre_archivo,
    tamano_bytes: recibo.tamano_bytes,
    recibo: _respuestaPublicaRecibo(recibo),
  });
}

// ── 4. reemplazar_recibo ────────────────────────────────────────────────
function accionReemplazarRecibo(datos) {
  datos = datos || {};
  const actor         = String(datos.actor || 'desconocido');
  const idAnterior     = String(datos.recibo_id_anterior || '').trim();
  const empleadoInput  = String(datos.empleado || '').trim();
  const periodo        = String(datos.periodo || '').trim();
  const mimeType       = String(datos.mime_type || '').trim();

  if (!idAnterior) return _resp({ ok: false, error: 'RECIBO_ID_ANTERIOR_REQUERIDO' });
  if (!empleadoInput) return _resp({ ok: false, error: 'EMPLEADO_REQUERIDO' });
  if (!_validarPeriodoRecibo(periodo)) return _resp({ ok: false, error: 'PERIODO_INVALIDO' });
  if (mimeType !== RECIBOS_MIME_VALIDO) return _resp({ ok: false, error: 'MIME_TYPE_INVALIDO' });
  if (!datos.archivo_base64) return _resp({ ok: false, error: 'ARCHIVO_VACIO' });

  let snapshot;
  try {
    snapshot = _obtenerSnapshotReciboEmpleado(empleadoInput);
  } catch (e) {
    return _resp({ ok: false, error: e.message });
  }

  let bytes;
  try {
    bytes = Utilities.base64Decode(datos.archivo_base64);
  } catch (e) {
    return _resp({ ok: false, error: 'BASE64_INVALIDO' });
  }
  const validacion = _validarArchivoRecibo(bytes, datos.tamano_bytes);
  if (!validacion.ok) return _resp({ ok: false, error: validacion.error });

  // Validar el recibo anterior ANTES de tocar Drive — falla rápido si no
  // corresponde, sin gastar una subida.
  const anteriorEncontrado = _buscarReciboPorId(idAnterior);
  if (!anteriorEncontrado) return _resp({ ok: false, error: 'RECIBO_ANTERIOR_NO_ENCONTRADO' });
  const anterior = anteriorEncontrado.objeto;
  if (anterior.estado !== 'ACTIVO') return _resp({ ok: false, error: 'RECIBO_ANTERIOR_NO_ACTIVO' });
  if (_normalizarNombreEmpleado(anterior.empleado) !== _normalizarNombreEmpleado(snapshot.nombre) || anterior.periodo !== periodo) {
    return _resp({ ok: false, error: 'RECIBO_ANTERIOR_NO_CORRESPONDE' });
  }

  // Subida a Drive FUERA del lock principal — mismo criterio que subir_recibo.
  const idNuevo = generarNuevoIdRecibo();
  const nombreFisico = idNuevo + '_' + periodo + '.pdf';
  let carpeta, archivoDrive;
  try {
    carpeta = _obtenerOCrearCarpetaRecibo(snapshot.empresa, periodo);
    const blob = Utilities.newBlob(bytes, RECIBOS_MIME_VALIDO, nombreFisico);
    archivoDrive = carpeta.createFile(blob);
  } catch (eDrive) {
    return _resp({ ok: false, error: 'ERROR_DRIVE' });
  }

  // LOCK: re-verificar que el anterior sigue ACTIVO, calcular versión,
  // crear la fila nueva y recién ahí marcar la anterior como REEMPLAZADO.
  // Todo esto, atómico — evita que dos reemplazos concurrentes generen
  // dos versiones "siguientes" iguales o dejen dos filas ACTIVAS.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    try { archivoDrive.setTrashed(true); } catch (eC) {}
    return _resp({ ok: false, error: 'SISTEMA_OCUPADO' });
  }
  try {
    const reVerificado = _buscarReciboPorId(idAnterior);
    if (!reVerificado || reVerificado.objeto.estado !== 'ACTIVO') {
      try { archivoDrive.setTrashed(true); } catch (eC) {}
      return _resp({ ok: false, error: 'RECIBO_ANTERIOR_NO_ACTIVO' });
    }

    const version = _calcularSiguienteVersion(snapshot.nombre, periodo);

    let reciboIdNuevo;
    try {
      reciboIdNuevo = _crearMetadataRecibo({
        id: idNuevo,
        empleado: snapshot.nombre,
        nombre_legal: snapshot.nombre_legal,
        empresa: snapshot.empresa,
        periodo: periodo,
        tipo: 'RECIBO_SUELDO',
        nombre_archivo: _sanearNombreArchivoRecibo(datos.nombre_archivo),
        mime_type: RECIBOS_MIME_VALIDO,
        tamano_bytes: bytes.length,
        drive_file_id: archivoDrive.getId(),
        version: version,
        subido_por: actor,
        reemplaza_a: idAnterior,
      });
    } catch (eMeta) {
      try { archivoDrive.setTrashed(true); } catch (eC) {}
      return _resp({ ok: false, error: 'ERROR_METADATA' });
    }

    // La fila nueva YA existe en este punto. Si marcar la anterior como
    // REEMPLAZADO falla, no se revierte la fila nueva (perderla sería peor
    // que dejar temporalmente dos ACTIVOS) — se deja un error explícito y
    // recuperable, nunca se oculta la inconsistencia.
    try {
      _marcarReciboReemplazado(idAnterior);
    } catch (eMarcar) {
      return _resp({
        ok: false,
        error: 'INCONSISTENCIA_RECUPERABLE',
        detalle: 'Se creó el recibo nuevo (' + reciboIdNuevo + ') pero no se pudo marcar el anterior (' + idAnterior + ') como REEMPLAZADO. Requiere revisión manual.',
        recibo_id_nuevo: reciboIdNuevo,
      });
    }

    registrarAuditoria(
      actor, 'RECIBO_REEMPLAZADO', 'RECIBO', reciboIdNuevo,
      { id: idAnterior, version: anterior.version },
      { id: reciboIdNuevo, version: version, periodo: periodo, empresa: snapshot.empresa }
    );

    const nuevoEncontrado = _buscarReciboPorId(reciboIdNuevo);
    return _resp({ ok: true, recibo: _respuestaPublicaRecibo(nuevoEncontrado.objeto) });
  } finally {
    lock.releaseLock();
  }
}

// =====================================================
//  AVISOS — Fase 3A (backend y modelo de datos)
// =====================================================
// Reemplaza a futuro a EVENTOS + ANUNCIOS bajo una sola entidad. A
// diferencia de esas dos (patrón legado: doGet, sin secreto, actor fijo
// 'Admin'), AVISOS nace enteramente sobre el patrón seguro: las 6 acciones
// (lectura Y escritura) viajan únicamente vía despacharAccionSegura — nunca
// se agrega una acción nueva de AVISOS a doGet. Es una decisión de
// arquitectura, no solo de seguridad puntual: todo lo nuevo de acá en
// adelante entra por Frontend → Node → GAS, dejando lugar en Node para
// filtrado por rol/sucursal, paginación, cache y observabilidad futuros sin
// tener que volver a tocar este archivo.
//
// EVENTOS y ANUNCIOS no se tocan — siguen funcionando exactamente igual,
// en paralelo, hasta que una fase de migración posterior los reemplace.
//
// Hoja AVISOS: ID | TITULO | MENSAJE | TIPO | FECHA_DESDE | FECHA_HASTA |
//              DESTINATARIOS | CANALES | PRIORIDAD | ARCHIVADO | AUTOR |
//              FECHA_CREACION | MODIFICADO_POR | FECHA_MODIFICACION | VERSION
//
// ESTADO (activo/programado/vencido) NO se persiste — se deriva de las
// fechas en el momento de leer, igual criterio que ya usa el frontend mock
// de Fase 1/2 (evita que el dato guardado se desincronice del real).
//
// VERSION: entero, arranca en 1, se incrementa en cada escritura sobre una
// fila existente (editar/archivar/restaurar). Todavía NO se usa para
// optimistic locking ni ninguna validación — es preparación para el futuro
// (auditoría rápida, comparación de registros), tal como se aprobó.

const AVISOS_TIPOS_VALIDOS = ['informacion', 'evento', 'local_cerrado'];
const AVISOS_DEST_MODOS_VALIDOS = ['todos', 'sucursal', 'empleado', 'administracion'];
const AVISOS_CANALES_VALIDOS = ['calendario', 'banner', 'email', 'whatsapp'];
const AVISOS_SUCURSALES_VALIDAS = ['01', '05', '09', '10', '12', '14', 'DEPO', 'OFICINA'];

function _asegurarHojaAvisos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName('AVISOS');
  if (!hoja) {
    hoja = ss.insertSheet('AVISOS');
    hoja.getRange(1, 1, 1, 15).setValues([[
      'ID', 'TITULO', 'MENSAJE', 'TIPO', 'FECHA_DESDE', 'FECHA_HASTA',
      'DESTINATARIOS', 'CANALES', 'PRIORIDAD', 'ARCHIVADO', 'AUTOR',
      'FECHA_CREACION', 'MODIFICADO_POR', 'FECHA_MODIFICACION', 'VERSION',
    ]]);
  }
  return hoja;
}

function _avisosNuevoId() {
  return 'AVI-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
}

// ── Helpers puros de resolución (sin efectos secundarios, testeables
//    de forma aislada — ver accionDebugResolverDestinatarios) ─────────
// `rol`: agregado en la Etapa 2 de la transición AVISOS. 'administracion'
// pasa a depender del rol de quien consulta (antes era "visible siempre",
// pensado únicamente para el panel admin) — necesario para que
// accionGetAvisosVisiblesUsuario() nunca muestre avisos de Administración
// a un empleado. Único caller existente antes de este cambio:
// accionDebugResolverDestinatarios (herramienta de debug, sin uso en
// ningún flujo real de producción) — se actualizó en el mismo commit.
function _resolverVisibleEnSucursal(destinatarios, sucId, rol) {
  const modo = destinatarios && destinatarios.modo;
  if (modo === 'administracion') return rol === 'admin' || rol === 'jefe';
  if (!sucId || sucId === 'todas') return true;
  if (modo === 'todos') return true;
  if (modo === 'sucursal') return Array.isArray(destinatarios.ids) && destinatarios.ids.indexOf(sucId) !== -1;
  if (modo === 'empleado') return destinatarios.sucursal_id === sucId;
  return false;
}

function _resolverCanalesActivos(canales) {
  if (!canales || typeof canales !== 'object') return [];
  return AVISOS_CANALES_VALIDOS.filter(function (c) { return canales[c] === true; });
}

// ── Validación (server-side — nunca confiar solo en Node ni en el
//    navegador). `existente` opcional: si viene, valida el resultado
//    MERGEADO (existente + datos), no solo el diff, para que editar_aviso
//    nunca pueda dejar una fila en un estado inconsistente. ─────────────
function _validarDatosAviso(datos, existente) {
  const base = existente ? Object.assign({}, existente, datos) : datos;
  const errores = {};

  if (!base.titulo || !String(base.titulo).trim()) errores.titulo = 'El título es obligatorio.';
  if (!base.mensaje || !String(base.mensaje).trim()) errores.mensaje = 'El mensaje es obligatorio.';
  if (AVISOS_TIPOS_VALIDOS.indexOf(base.tipo) === -1) errores.tipo = 'Tipo inválido.';

  const destinatarios = base.destinatarios || {};
  if (AVISOS_DEST_MODOS_VALIDOS.indexOf(destinatarios.modo) === -1) {
    errores.destinatarios = 'Modo de destinatarios inválido.';
  } else if (destinatarios.modo === 'sucursal') {
    const ids = destinatarios.ids;
    if (!Array.isArray(ids) || !ids.length) {
      errores.destinatarios = 'Elegí al menos una sucursal.';
    } else if (ids.some(function (id) { return AVISOS_SUCURSALES_VALIDAS.indexOf(id) === -1; })) {
      errores.destinatarios = 'Hay una sucursal inválida en la selección.';
    } else if (base.tipo === 'local_cerrado' && destinatarios.ids.length === 0) {
      errores.destinatarios = 'Local cerrado requiere al menos una sucursal.';
    }
  } else if (destinatarios.modo === 'empleado') {
    if (!Array.isArray(destinatarios.nombres) || !destinatarios.nombres.length) {
      errores.destinatarios = 'Elegí al menos un empleado.';
    }
  }
  if (base.tipo === 'local_cerrado' && destinatarios.modo !== 'sucursal') {
    errores.destinatarios = 'Local cerrado debe tener destinatario Sucursal(es).';
  }

  const canales = base.canales || {};
  const requiereFecha = base.tipo !== 'informacion' || canales.calendario === true || !!base.fecha_desde;
  if (requiereFecha) {
    if (!base.fecha_desde) errores.fecha = 'La fecha es obligatoria para este tipo de aviso.';
    else if (base.fecha_hasta && base.fecha_hasta < base.fecha_desde) {
      errores.fecha = 'La fecha "hasta" no puede ser anterior a "desde".';
    }
  }

  if (base.prioridad && ['normal', 'urgente'].indexOf(base.prioridad) === -1) {
    errores.prioridad = 'Prioridad inválida.';
  }

  return { valido: Object.keys(errores).length === 0, errores: errores };
}

// ── Conversión fila ↔ objeto ───────────────────────────────────────────
function _avisoAObjeto(headers, fila) {
  const col = function (name) { return headers.indexOf(name); };
  const fechaStr = function (v) {
    if (!v) return '';
    if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    return String(v).trim();
  };
  const fechaHoraStr = function (v) {
    if (!v) return '';
    if (v instanceof Date) return v.toISOString();
    return String(v).trim();
  };
  let destinatarios = { modo: 'todos' };
  let canales = { calendario: false, banner: false, email: false, whatsapp: false };
  try { destinatarios = JSON.parse(fila[col('DESTINATARIOS')] || '{}'); } catch (e) {}
  try { canales = JSON.parse(fila[col('CANALES')] || '{}'); } catch (e) {}

  return {
    id: String(fila[col('ID')] || ''),
    titulo: String(fila[col('TITULO')] || ''),
    mensaje: String(fila[col('MENSAJE')] || ''),
    tipo: String(fila[col('TIPO')] || ''),
    fecha_desde: fechaStr(fila[col('FECHA_DESDE')]),
    fecha_hasta: fechaStr(fila[col('FECHA_HASTA')]),
    destinatarios: destinatarios,
    canales: canales,
    prioridad: String(fila[col('PRIORIDAD')] || 'normal'),
    archivado: fila[col('ARCHIVADO')] === true || fila[col('ARCHIVADO')] === 'TRUE',
    autor: String(fila[col('AUTOR')] || ''),
    fecha_creacion: fechaHoraStr(fila[col('FECHA_CREACION')]),
    modificado_por: String(fila[col('MODIFICADO_POR')] || ''),
    fecha_modificacion: fechaHoraStr(fila[col('FECHA_MODIFICACION')]),
    version: parseInt(fila[col('VERSION')], 10) || 1,
  };
}

function _filaDeAviso(headers, aviso) {
  const col = function (name) { return headers.indexOf(name); };
  const fila = new Array(headers.length).fill('');
  fila[col('ID')] = aviso.id;
  fila[col('TITULO')] = aviso.titulo;
  fila[col('MENSAJE')] = aviso.mensaje;
  fila[col('TIPO')] = aviso.tipo;
  fila[col('FECHA_DESDE')] = aviso.fecha_desde || '';
  fila[col('FECHA_HASTA')] = aviso.fecha_hasta || aviso.fecha_desde || '';
  fila[col('DESTINATARIOS')] = JSON.stringify(aviso.destinatarios || { modo: 'todos' });
  fila[col('CANALES')] = JSON.stringify(aviso.canales || {});
  fila[col('PRIORIDAD')] = aviso.prioridad || 'normal';
  fila[col('ARCHIVADO')] = aviso.archivado === true;
  fila[col('AUTOR')] = aviso.autor || '';
  fila[col('FECHA_CREACION')] = aviso.fecha_creacion || '';
  fila[col('MODIFICADO_POR')] = aviso.modificado_por || '';
  fila[col('FECHA_MODIFICACION')] = aviso.fecha_modificacion || '';
  fila[col('VERSION')] = aviso.version || 1;
  return fila;
}

function _buscarFilaAviso(hoja, id) {
  const vals = hoja.getDataRange().getValues();
  const headers = vals[0];
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][headers.indexOf('ID')]) === String(id)) {
      return { headers: headers, fila: vals[i], indice: i };
    }
  }
  return null;
}

// ── Acciones expuestas (todas vía despacharAccionSegura) ──────────────

function accionGetAvisos() {
  const hoja = _asegurarHojaAvisos();
  const vals = hoja.getDataRange().getValues();
  if (vals.length < 2) return _resp({ ok: true, avisos: [] });
  const headers = vals[0];
  const avisos = vals.slice(1)
    .filter(function (r) { return r[headers.indexOf('ID')]; })
    .map(function (r) { return _avisoAObjeto(headers, r); });
  return _resp({ ok: true, avisos: avisos });
}

function accionGetAviso(datos) {
  const hoja = _asegurarHojaAvisos();
  const encontrado = _buscarFilaAviso(hoja, datos.id);
  if (!encontrado) return _resp({ ok: false, error: 'Aviso no encontrado' });
  return _resp({ ok: true, aviso: _avisoAObjeto(encontrado.headers, encontrado.fila) });
}

function accionGuardarAviso(datos) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return _resp({ ok: false, error: 'Sistema ocupado, reintentá en unos segundos' });
  try {
    const actor = String(datos.actor || 'desconocido');
    const val = _validarDatosAviso(datos);
    if (!val.valido) return _resp({ ok: false, error: 'Datos inválidos', errores: val.errores });

    const hoja = _asegurarHojaAvisos();
    const headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
    const ahora = new Date();
    const aviso = {
      id: _avisosNuevoId(),
      titulo: String(datos.titulo).trim().substring(0, 80),
      mensaje: String(datos.mensaje).trim(),
      tipo: datos.tipo,
      fecha_desde: datos.fecha_desde || '',
      fecha_hasta: datos.fecha_hasta || datos.fecha_desde || '',
      destinatarios: datos.destinatarios,
      canales: datos.canales || {},
      prioridad: datos.prioridad || 'normal',
      archivado: false,
      autor: actor,
      fecha_creacion: ahora,
      modificado_por: actor,
      fecha_modificacion: ahora,
      version: 1,
    };
    hoja.appendRow(_filaDeAviso(headers, aviso));

    registrarAuditoria(actor, 'AVISO_CREADO', 'AVISO', aviso.id, null, aviso);
    enviarEmailsAviso(hoja.getParent(), aviso);
    return _resp({ ok: true, aviso: aviso });
  } finally {
    lock.releaseLock();
  }
}

// ── Enviar emails de aviso a sucursales (canal 'email') ───────────────
// Hermana de enviarEmailsEvento() (línea ~100) — mismo mapeo email_suc_<ID>
// en CONFIG, mismo template buildEmailEvento(). Solo aplica a
// destinatarios.modo === 'sucursal' (único modo con email de sucursal
// configurado — local_cerrado ya obliga este modo por _validarDatosAviso).
// Se llama solo al crear (accionGuardarAviso), no al editar — mismo
// alcance que tenía el sistema viejo de Eventos.
function enviarEmailsAviso(ss, aviso) {
  if (_resolverCanalesActivos(aviso.canales).indexOf('email') === -1) return;
  const destinatarios = aviso.destinatarios || {};
  if (destinatarios.modo !== 'sucursal' || !Array.isArray(destinatarios.ids)) return;

  const NOMBRES_SUCURSAL = {
    '01': '01 PASEO', '05': '05 WAVE', '09': '09 CIPO SAN MARTIN',
    '10': '10 PERITO MORENO', '12': '12 CENTENARIO', '14': '14 ROCA',
    'DEPO': 'DEPO', 'OFICINA': 'OFICINA',
  };
  const config = getConfigObj(ss);
  const fechaStr = fmtFecha(aviso.fecha_desde);
  const fechaFinStr = aviso.fecha_hasta && aviso.fecha_hasta !== aviso.fecha_desde ? fmtFecha(aviso.fecha_hasta) : null;
  const rangoFechas = fechaFinStr ? fechaStr + ' al ' + fechaFinStr : fechaStr;

  destinatarios.ids.forEach(function (sucId) {
    const email = config['email_suc_' + sucId] || '';
    if (!email) return;
    MailApp.sendEmail({
      to: email,
      subject: '📌 ' + aviso.titulo,
      htmlBody: buildEmailEvento({
        titulo: aviso.titulo,
        rangoFechas: rangoFechas,
        descripcion: aviso.mensaje,
        destinatarioLabel: NOMBRES_SUCURSAL[sucId] || sucId,
      }),
    });
  });
}

function accionEditarAviso(datos) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return _resp({ ok: false, error: 'Sistema ocupado, reintentá en unos segundos' });
  try {
    const actor = String(datos.actor || 'desconocido');
    if (!datos.id) return _resp({ ok: false, error: 'Falta el id del aviso' });

    const hoja = _asegurarHojaAvisos();
    const encontrado = _buscarFilaAviso(hoja, datos.id);
    if (!encontrado) return _resp({ ok: false, error: 'Aviso no encontrado' });

    const antes = _avisoAObjeto(encontrado.headers, encontrado.fila);
    // Importante: solo se incluyen acá las claves que realmente vinieron en
    // `datos` — un objeto con claves explícitas en `undefined` (ej.
    // { titulo: datos.titulo } cuando datos.titulo no vino) pisaría los
    // valores reales de `antes` al mergear en _validarDatosAviso, porque
    // Object.assign SÍ copia propiedades con valor undefined. Bug real
    // encontrado en el smoke test de Fase 3A (editar_aviso parcial fallaba
    // la validación como si el aviso no tuviera título/tipo/destinatarios).
    const cambios = {};
    ['titulo', 'mensaje', 'tipo', 'fecha_desde', 'fecha_hasta', 'destinatarios', 'canales', 'prioridad']
      .forEach(function (campo) { if (datos[campo] !== undefined) cambios[campo] = datos[campo]; });
    const val = _validarDatosAviso(cambios, antes);
    if (!val.valido) return _resp({ ok: false, error: 'Datos inválidos', errores: val.errores });

    const ahora = new Date();
    const despues = Object.assign({}, antes, {
      titulo: String(cambios.titulo !== undefined ? cambios.titulo : antes.titulo).trim().substring(0, 80),
      mensaje: String(cambios.mensaje !== undefined ? cambios.mensaje : antes.mensaje).trim(),
      tipo: cambios.tipo !== undefined ? cambios.tipo : antes.tipo,
      fecha_desde: cambios.fecha_desde !== undefined ? cambios.fecha_desde : antes.fecha_desde,
      fecha_hasta: cambios.fecha_hasta !== undefined ? cambios.fecha_hasta : antes.fecha_hasta,
      destinatarios: cambios.destinatarios !== undefined ? cambios.destinatarios : antes.destinatarios,
      canales: cambios.canales !== undefined ? cambios.canales : antes.canales,
      prioridad: cambios.prioridad !== undefined ? cambios.prioridad : antes.prioridad,
      modificado_por: actor,
      fecha_modificacion: ahora,
      version: (antes.version || 1) + 1,
    });

    hoja.getRange(encontrado.indice + 1, 1, 1, encontrado.headers.length)
      .setValues([_filaDeAviso(encontrado.headers, despues)]);

    registrarAuditoria(actor, 'AVISO_EDITADO', 'AVISO', datos.id, antes, despues);
    return _resp({ ok: true, aviso: despues });
  } finally {
    lock.releaseLock();
  }
}

function _accionCambiarArchivadoAviso(datos, nuevoValor, nombreAuditoria) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return _resp({ ok: false, error: 'Sistema ocupado, reintentá en unos segundos' });
  try {
    const actor = String(datos.actor || 'desconocido');
    if (!datos.id) return _resp({ ok: false, error: 'Falta el id del aviso' });

    const hoja = _asegurarHojaAvisos();
    const encontrado = _buscarFilaAviso(hoja, datos.id);
    if (!encontrado) return _resp({ ok: false, error: 'Aviso no encontrado' });

    const antes = _avisoAObjeto(encontrado.headers, encontrado.fila);
    const ahora = new Date();
    const despues = Object.assign({}, antes, {
      archivado: nuevoValor,
      modificado_por: actor,
      fecha_modificacion: ahora,
      version: (antes.version || 1) + 1,
    });

    hoja.getRange(encontrado.indice + 1, 1, 1, encontrado.headers.length)
      .setValues([_filaDeAviso(encontrado.headers, despues)]);

    registrarAuditoria(actor, nombreAuditoria, 'AVISO', datos.id, antes, despues);
    return _resp({ ok: true, aviso: despues });
  } finally {
    lock.releaseLock();
  }
}

function accionArchivarAviso(datos) { return _accionCambiarArchivadoAviso(datos, true, 'AVISO_ARCHIVADO'); }
function accionRestaurarAviso(datos) { return _accionCambiarArchivadoAviso(datos, false, 'AVISO_RESTAURADO'); }

// ── QA: helper de resolución probable de forma aislada, sin frontend ni
//    Node — llamar por POST directo con el sobre {accion, clave_backend,
//    datos:{destinatarios, canales, sucursal_id}}. Regla del proyecto: todo
//    helper complejo debe poder validarse independientemente del frontend. ──
function accionDebugResolverDestinatarios(datos) {
  const visible = _resolverVisibleEnSucursal(datos.destinatarios || {}, datos.sucursal_id || 'todas', datos.rol || '');
  const canalesActivos = _resolverCanalesActivos(datos.canales || {});
  return _resp({ ok: true, visible_en_sucursal: visible, canales_activos: canalesActivos });
}

// ── Resolución segura de identidad para "mis avisos" (Etapa 2 de la
//    transición) — nunca confía en nombre/sucursal enviados por el
//    navegador; usuario/rol llegan del JWT ya verificado en Node, y acá se
//    resuelve el empleado real y su sucursal contra USUARIOS/EMPLEADOS
//    (mismo mapeo 1-a-1 de ADR-035), sin duplicar esa lógica en Node. ────
function _buscarEmpleadoPorNombre(nombreEmpleado) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName('EMPLEADOS');
  if (!hoja) return null;
  const headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim().toUpperCase(); });
  const vals = hoja.getDataRange().getValues();
  const nombreNorm = _normalizarNombreEmpleado(nombreEmpleado);
  for (let i = 1; i < vals.length; i++) {
    if (_normalizarNombreEmpleado(vals[i][0]) === nombreNorm) return _filaEmpleadoAObjeto(headers, vals[i]);
  }
  return null;
}

// ── Visibilidad para "mis avisos" — semántica propia de este endpoint,
//    deliberadamente NO reutiliza _resolverVisibleEnSucursal (esa está
//    pensada para el panel admin navegando "todas" las sucursales, con un
//    atajo "sin sucursal = ver todo" que acá sería una fuga de datos). No
//    amplía visibilidad solo porque rol=admin/jefe: este endpoint es "mis
//    avisos", no un listado administrativo — para eso sigue existiendo
//    GET /api/avisos con requiereRol('admin','jefe').
//    - todos           → visible para cualquiera.
//    - administracion   → visible solo si rol es admin/jefe.
//    - sucursal         → visible solo si la sucursal de la identidad
//                          resuelta (nunca "todas" como atajo) está en la
//                          lista del aviso. Sin sucursal en el contexto
//                          autenticado → no visible, no "ver todo".
//    - empleado         → visible solo para rol='empleado', y solo con
//                          coincidencia exacta de nombre. Nunca se asume
//                          que un aviso dirigido a un empleado específico
//                          le corresponde a un admin/jefe.
function _resolverVisibleParaMisAvisos(destinatarios, identidad) {
  const modo = destinatarios && destinatarios.modo;
  if (modo === 'todos') return true;
  if (modo === 'administracion') return identidad.rol === 'admin' || identidad.rol === 'jefe';
  if (modo === 'sucursal') {
    if (!identidad.sucursalId) return false;
    return Array.isArray(destinatarios.ids) && destinatarios.ids.indexOf(identidad.sucursalId) !== -1;
  }
  if (modo === 'empleado') {
    if (identidad.rol !== 'empleado') return false;
    const nombres = (destinatarios.nombres || []).map(_normalizarNombreEmpleado);
    return !!identidad.empleadoNombreNorm && nombres.indexOf(identidad.empleadoNombreNorm) !== -1;
  }
  return false;
}

// Resolución de identidad autenticada — ÚNICA fuente de esta lógica,
// extraída de accionGetAvisosVisiblesUsuario (Etapa "Leídos" de la
// transición AVISOS) para que accionMarcarAvisoLeido() la reutilice sin
// duplicar reglas. datos de entrada: usuario/rol/sucursal, los tres como
// claims confiables desde Node (ya verificó la firma del JWT antes de
// llamar acá, y esta llamada además viaja protegida por el secreto
// Node→GAS) — nunca se leen desde query/body del navegador.
//
// PRINCIPIO: cada identidad se valida en su fuente de verdad. Empleado se
// resuelve contra USUARIOS/EMPLEADOS de GAS — esa hoja es la única fuente
// real para ese rol, así que se re-resuelve acá igual (defensa en
// profundidad: no alcanza con que Node diga "es empleado", GAS confirma
// contra su propia hoja). Admin y jefe se autentican contra el SQLite de
// croma-backend, que GAS no tiene ni puede tener — para esos roles NO se
// busca nada en USUARIOS (esa cuenta estructuralmente no está ahí); se
// usan los claims que Node ya verificó. Ninguna capa revalida una
// identidad usando una fuente que no la contiene.
//
// Devuelve { error } o { identidad }. `identidad.rol` e `identidad.usuario`
// (agregados en esta etapa) son, juntos, la identidad canónica persistida
// en AVISOS_LEIDOS — nunca `empleadoNombreNorm`, que solo sirve para
// resolver destinatarios modo 'empleado', no como clave de lectura.
function _resolverIdentidadAutenticada(usuario, rol, sucursalNode) {
  if (!usuario) return { error: 'Falta usuario.' };
  if (['empleado', 'admin', 'jefe'].indexOf(rol) === -1) {
    return { error: 'Rol no reconocido.' };
  }

  if (rol === 'empleado') {
    const hojaUsuarios = _asegurarHojaUsuarios();
    const leidoUsuarios = _leerUsuariosCrudo(hojaUsuarios);
    const idxUsuario = _buscarFilaUsuarioPorUsername(leidoUsuarios.headers, leidoUsuarios.vals, usuario.toLowerCase(), -1);
    if (idxUsuario < 0) return { error: 'Usuario sin acceso configurado.' };

    const usuarioObj = _usuarioAObjeto(leidoUsuarios.headers, leidoUsuarios.vals[idxUsuario]);
    if (usuarioObj.estado !== 'activo') return { error: 'Acceso inactivo.' };

    let sucursalId = '';
    if (usuarioObj.empleadoNombre) {
      const perfil = _buscarEmpleadoPorNombre(usuarioObj.empleadoNombre);
      sucursalId = perfil ? String(perfil.sucursal_id || '') : '';
    }
    return {
      identidad: {
        rol: 'empleado',
        usuario: usuario,
        sucursalId: sucursalId,
        empleadoNombreNorm: usuarioObj.empleadoNombre ? _normalizarNombreEmpleado(usuarioObj.empleadoNombre) : '',
      },
    };
  }
  // admin/jefe: esa cuenta no vive en USUARIOS de GAS — no se busca acá.
  return {
    identidad: {
      rol: rol,
      usuario: usuario,
      sucursalId: String(sucursalNode || '').trim(),
      empleadoNombreNorm: '',
    },
  };
}

// ── AVISOS_LEIDOS — Etapa "Leídos" de la transición AVISOS ─────────────
// Hoja AVISOS_LEIDOS: AVISO_ID | IDENTIDAD_TIPO | IDENTIDAD_ID | FECHA_LECTURA
//
// Identidad canónica: IDENTIDAD_TIPO = rol ('empleado'|'admin'|'jefe'),
// IDENTIDAD_ID = usuario (username — la clave de la cuenta de acceso real,
// NUNCA EMPLEADO_NOMBRE, que es texto libre en EMPLEADOS sin garantía de
// inmutabilidad, ver ADR-035). Clave única conceptual: (AVISO_ID,
// IDENTIDAD_TIPO, IDENTIDAD_ID) — nunca se duplica una fila para la misma
// combinación; marcar leído dos veces actualiza FECHA_LECTURA, no inserta.
function _asegurarHojaAvisosLeidos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName('AVISOS_LEIDOS');
  if (!hoja) {
    hoja = ss.insertSheet('AVISOS_LEIDOS');
    hoja.getRange(1, 1, 1, 4).setValues([['AVISO_ID', 'IDENTIDAD_TIPO', 'IDENTIDAD_ID', 'FECHA_LECTURA']]);
  }
  return hoja;
}

function _buscarFilaAvisoLeido(headers, vals, avisoId, identidadTipo, identidadId) {
  const cAviso = headers.indexOf('AVISO_ID');
  const cTipo = headers.indexOf('IDENTIDAD_TIPO');
  const cId = headers.indexOf('IDENTIDAD_ID');
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][cAviso]) === avisoId &&
        String(vals[i][cTipo]) === identidadTipo &&
        String(vals[i][cId]).toLowerCase() === identidadId.toLowerCase()) {
      return i;
    }
  }
  return -1;
}

function _estaAvisoLeido(avisoId, identidadTipo, identidadId) {
  const hoja = _asegurarHojaAvisosLeidos();
  const vals = hoja.getDataRange().getValues();
  if (vals.length < 2) return false;
  return _buscarFilaAvisoLeido(vals[0], vals, avisoId, identidadTipo, identidadId) !== -1;
}

// Upsert idempotente con lock — dos marcados simultáneos del mismo
// (aviso, identidad) nunca duplican fila, solo actualizan FECHA_LECTURA.
function _marcarAvisoLeidoEnHoja(avisoId, identidadTipo, identidadId) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('Sistema ocupado, reintentá en unos segundos');
  try {
    const hoja = _asegurarHojaAvisosLeidos();
    const vals = hoja.getDataRange().getValues();
    const headers = vals[0];
    const idx = vals.length > 1 ? _buscarFilaAvisoLeido(headers, vals, avisoId, identidadTipo, identidadId) : -1;
    const ahora = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    if (idx === -1) {
      hoja.appendRow([avisoId, identidadTipo, identidadId, ahora]);
    } else {
      hoja.getRange(idx + 1, headers.indexOf('FECHA_LECTURA') + 1).setValue(ahora);
    }
  } finally {
    lock.releaseLock();
  }
}

// accion: get_avisos_visibles_usuario — datos: { usuario, rol, sucursal }.
function accionGetAvisosVisiblesUsuario(datos) {
  const usuario = String(datos.usuario || '').trim();
  const rol = String(datos.rol || '').trim();
  const resuelta = _resolverIdentidadAutenticada(usuario, rol, datos.sucursal);
  if (resuelta.error) return _resp({ ok: false, error: resuelta.error });
  const identidad = resuelta.identidad;

  const hoja = _asegurarHojaAvisos();
  const vals = hoja.getDataRange().getValues();
  if (vals.length < 2) return _resp({ ok: true, avisos: [] });
  const headers = vals[0];

  const avisos = vals.slice(1)
    .filter(function (r) { return r[headers.indexOf('ID')]; })
    .map(function (r) { return _avisoAObjeto(headers, r); })
    .filter(function (aviso) {
      if (aviso.archivado) return false;
      return _resolverVisibleParaMisAvisos(aviso.destinatarios, identidad);
    })
    .map(function (aviso) {
      // Estado de lectura real, resuelto server-side contra AVISOS_LEIDOS
      // — Etapa "Leídos". Nunca depende de localStorage ni de nada que
      // el cliente pueda haber enviado.
      aviso.leido = _estaAvisoLeido(aviso.id, identidad.rol, identidad.usuario);
      return aviso;
    });

  return _resp({ ok: true, avisos: avisos });
}

// accion: marcar_aviso_leido — datos: { usuario, rol, sucursal, aviso_id }.
// Reutiliza _resolverIdentidadAutenticada() y _resolverVisibleParaMisAvisos()
// — misma regla de visibilidad que get_avisos_visibles_usuario, nunca
// duplicada. Un usuario nunca puede marcar leído un aviso que no puede ver,
// ni uno archivado, ni uno inexistente (no crea fila basura en ninguno de
// esos casos).
function accionMarcarAvisoLeido(datos) {
  const usuario = String(datos.usuario || '').trim();
  const rol = String(datos.rol || '').trim();
  const avisoId = String(datos.aviso_id || '').trim();
  if (!avisoId) return _resp({ ok: false, error: 'Falta aviso_id.' });

  const resuelta = _resolverIdentidadAutenticada(usuario, rol, datos.sucursal);
  if (resuelta.error) return _resp({ ok: false, error: resuelta.error });
  const identidad = resuelta.identidad;

  const hoja = _asegurarHojaAvisos();
  const encontrado = _buscarFilaAviso(hoja, avisoId);
  if (!encontrado) return _resp({ ok: false, error: 'Aviso no encontrado' });
  const aviso = _avisoAObjeto(encontrado.headers, encontrado.fila);

  if (aviso.archivado || !_resolverVisibleParaMisAvisos(aviso.destinatarios, identidad)) {
    return _resp({ ok: false, error: 'No autorizado para marcar este aviso.' });
  }

  try {
    _marcarAvisoLeidoEnHoja(avisoId, identidad.rol, identidad.usuario);
  } catch (e) {
    return _resp({ ok: false, error: e.message });
  }
  return _resp({ ok: true });
}
