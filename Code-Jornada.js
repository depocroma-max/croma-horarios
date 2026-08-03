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
    if (accion === 'acreditarBanco') return acreditarBanco(e);
    if (accion === 'usarBanco')      return usarBanco(e);
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

function doGet(e) {
  const accion = e.parameter.accion || '';

  if (accion === 'horarios')            return getHorarios(e);
  if (accion === 'perfiles')            return getPerfiles();
  if (accion === 'guardar_perfil')      return guardarPerfil(e);
  if (accion === 'guardar_categoria')   return guardarCategoria(e);
  if (accion === 'cargar_usuarios')     return getUsuarios(e);
  if (accion === 'guardar_usuarios')    return guardarUsuarios(e);
  if (accion === 'cargar_certificados') return getCertificados();
  if (accion === 'guardar_certificado') return guardarCertificado(e);
  if (accion === 'borrar_certificado')  return borrarCertificado(e);
  if (accion === 'guardar_foto_url')    return guardarFotoUrl(e);
  if (accion === 'get_config')          return getConfig();
  if (accion === 'guardar_config')      return guardarConfig(e);
  if (accion === 'get_vacaciones')      return getVacaciones(e);
  if (accion === 'inicializar_vac')     return inicializarVacacionesAnio(e);
  if (accion === 'ajustar_vac')         return ajustarDiasVacaciones(e);
  if (accion === 'solicitar_vac')       return solicitarVacaciones(e);
  if (accion === 'get_solicitudes_vac') return getSolicitudesVacaciones(e);
  if (accion === 'responder_solicitud') return responderSolicitud(e);
  if (accion === 'get_anuncios')        return getAnuncios(e);
  if (accion === 'guardar_anuncio')     return guardarAnuncio(e);
  if (accion === 'eliminar_anuncio')    return eliminarAnuncio(e);
  if (accion === 'get_eventos')           return getEventos(e);
  if (accion === 'guardar_evento')        return guardarEvento(e);
  if (accion === 'eliminar_evento')       return eliminarEvento(e);
  if (accion === 'get_sucursales_geo')    return getSucursalesGeo();
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

  return _resp({ ok: false, error: 'Acción no reconocida' });
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
      let anio         = new Date().getFullYear();
      if (fechaDesde instanceof Date) {
        anio = fechaDesde.getFullYear();
      } else if (typeof fechaDesde === 'string' && fechaDesde.length >= 4) {
        anio = parseInt(fechaDesde.substring(0,4));
      }

      const hojaVac = ss.getSheetByName('VACACIONES');
      if (hojaVac) {
        const vVac = hojaVac.getDataRange().getValues();
        const iVac = vVac.findIndex((r,i) => i>0 &&
          parseInt(r[0]) === anio && String(r[1]).trim().toLowerCase() === empleado.toLowerCase()
        );
        if (iVac >= 1) {
          const banco     = parseInt(vVac[iVac][3]) || 0;
          const usados    = (parseInt(vVac[iVac][4]) || 0) + dias;
          const ajuste    = parseInt(vVac[iVac][5]) || 0;
          const disponible = banco + ajuste - usados;
          hojaVac.getRange(iVac+1, 5).setValue(usados);
          hojaVac.getRange(iVac+1, 7).setValue(disponible);
        }
      }
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