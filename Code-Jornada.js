// =====================================================
//  CROMA · JORNADA LABORAL
//  Sidebar (resumen, detalle, PDF) + API web (horarios)
// =====================================================

// ── MENÚ ──────────────────────────────────────────────
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('📋 Jornada Laboral')
      .addItem('Abrir panel de filtros', 'mostrarPanel')
      .addItem('Actualizar resumen completo', 'actualizarResumen')
      .addToUi();
  } catch(e) {
    // No disponible en este contexto (ej: llamada desde doGet)
  }
}

function mostrarPanel() {
  const html = HtmlService.createHtmlOutputFromFile('Panel')
    .setTitle('Filtros de Jornada')
    .setWidth(300);
  SpreadsheetApp.getUi().showSidebar(html);
}

// ── SIDEBAR: OPCIONES ─────────────────────────────────
function obtenerOpciones() {
  const hojaDatos = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('DATOS GENERALES');
  const datos = hojaDatos.getDataRange().getValues();

  const ordenMeses = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
                      'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
  const periodosSet  = new Set();
  const localesSet   = new Set();
  const empleadosSet = new Set();

  for (let i = 1; i < datos.length; i++) {
    const local    = String(datos[i][0]).trim().toUpperCase();
    const anio     = String(datos[i][1]).trim();
    const mes      = String(datos[i][2]).trim().toUpperCase();
    const empleado = String(datos[i][5]).trim().toUpperCase();
    if (!local || !anio || !mes || !empleado) continue;
    periodosSet.add(mes + ' ' + anio);
    localesSet.add(local);
    empleadosSet.add(empleado);
  }

  const periodos = Array.from(periodosSet).sort((a, b) => {
    const [mA, aA] = a.split(' ');
    const [mB, aB] = b.split(' ');
    if (aA !== aB) return parseInt(aA) - parseInt(aB);
    return ordenMeses.indexOf(mA) - ordenMeses.indexOf(mB);
  });

  return {
    periodos:  periodos,
    locales:   Array.from(localesSet).sort(),
    empleados: Array.from(empleadosSet).sort()
  };
}

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

// ── SIDEBAR: DETALLE EMPLEADO ─────────────────────────
function generarDetalleEmpleado(filtros) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hojaDatos = ss.getSheetByName('DATOS GENERALES');
  const datos = hojaDatos.getDataRange().getValues();

  const ordenMeses = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
                      'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];

  if (!filtros.empleado || filtros.empleado === 'TODOS') {
    return '⚠️ Seleccioná un empleado específico para ver el detalle.';
  }

  const porDia = {};

  for (let i = 1; i < datos.length; i++) {
    const fila          = datos[i];
    const local         = String(fila[0]).trim().toUpperCase();
    const anio          = String(fila[1]).trim();
    const mes           = String(fila[2]).trim().toUpperCase();
    const diaSemana     = String(fila[3]).trim().toUpperCase();
    const marcaTemporal = fila[4];
    const empleado      = String(fila[5]).trim().toUpperCase();
    const horaEntrada   = fila[6];
    const horaSalida    = fila[7];
    const nota          = String(fila[8] || '').trim();
    const hs            = parseFloat(String(fila[9]).replace(',', '.')) || 0;

    if (!local || !anio || !mes || !empleado || isNaN(hs)) continue;
    if (empleado !== filtros.empleado) continue;

    const periodoFila = mes + ' ' + anio;
    if (filtros.periodo && filtros.periodo !== 'TODOS' && periodoFila !== filtros.periodo) continue;
    if (filtros.local   && filtros.local   !== 'TODOS' && local       !== filtros.local)   continue;

    const mt = new Date(marcaTemporal);
    const diaUnico = mt.getFullYear() + '-' + (mt.getMonth()+1).toString().padStart(2,'0') + '-' + mt.getDate().toString().padStart(2,'0');
    const horaRegistro = formatearHora(marcaTemporal);
    const hEntrada = formatearHora(horaEntrada);
    const hSalida  = formatearHora(horaSalida);

    if (!porDia[diaUnico]) {
      porDia[diaUnico] = {
        anio, mes, diaSemana, local,
        horaRegistro,
        hs: 0,
        nota: '',
        turnos: []
      };
    }

    porDia[diaUnico].hs += hs;
    if (nota) porDia[diaUnico].nota = nota;

    porDia[diaUnico].turnos.push({ horaRegistro, hEntrada, hSalida, hs });
    porDia[diaUnico].turnos.sort((a, b) => a.hEntrada.localeCompare(b.hEntrada));
    porDia[diaUnico].horaRegistro = porDia[diaUnico].turnos[0].horaRegistro;
  }

  if (Object.keys(porDia).length === 0) {
    return '⚠️ No se encontraron registros con los filtros seleccionados.';
  }

  const diasOrdenados = Object.keys(porDia).sort();

  let hojaDetalle = ss.getSheetByName('DETALLE EMPLEADO');
  if (!hojaDetalle) hojaDetalle = ss.insertSheet('DETALLE EMPLEADO');
  hojaDetalle.clearContents();
  hojaDetalle.clearFormats();

  hojaDetalle.getRange(1, 1, 1, 10).merge();
  hojaDetalle.getRange(1, 1).setValue('👤  DETALLE DE JORNADA — ' + filtros.empleado);
  hojaDetalle.getRange(1, 1)
    .setBackground('#1A3A5C').setFontColor('#FFFFFF')
    .setFontWeight('bold').setFontSize(13)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  hojaDetalle.setRowHeight(1, 35);

  const subtitulo = (filtros.periodo !== 'TODOS' ? filtros.periodo : 'Todos los períodos') +
                    '  |  ' +
                    (filtros.local !== 'TODOS' ? filtros.local : 'Todos los locales');
  hojaDetalle.getRange(2, 1, 1, 10).merge();
  hojaDetalle.getRange(2, 1).setValue(subtitulo);
  hojaDetalle.getRange(2, 1)
    .setBackground('#2E6DA4').setFontColor('#FFFFFF')
    .setFontSize(10).setHorizontalAlignment('center').setVerticalAlignment('middle');
  hojaDetalle.setRowHeight(2, 20);

  const encabezados = ['FECHA','DÍA','HORA REG.','TURNO 1','TURNO 2','HS TOTAL','HS EXTRA','SÁBADO','LOCAL','NOTA'];
  hojaDetalle.getRange(3, 1, 1, 10).setValues([encabezados]);
  hojaDetalle.getRange(3, 1, 1, 10)
    .setBackground('#2E6DA4').setFontColor('#FFFFFF')
    .setFontWeight('bold').setFontSize(10)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  hojaDetalle.setRowHeight(3, 24);

  let filaActual  = 4;
  let totalDias   = 0;
  let totalHs     = 0;
  let totalExtra  = 0;
  let totalSabados = 0;
  let mesPrevio   = '';

  const coloresLocal = {
    'PASEO':   { fondo: '#E3F2FD', texto: '#1565C0' },
    'WAVE':    { fondo: '#E8F5E9', texto: '#2E7D32' },
    'CIPO':    { fondo: '#FFF3E0', texto: '#E65100' },
    'PERITO':  { fondo: '#F3E5F5', texto: '#6A1B9A' },
    'CENTE':   { fondo: '#FCE4EC', texto: '#880E4F' },
    'ROCA180': { fondo: '#E0F7FA', texto: '#006064' },
    'DEPO':    { fondo: '#FFF8E1', texto: '#F57F17' },
    'OFICINA': { fondo: '#EFEBE9', texto: '#4E342E' },
  };

  for (const dia of diasOrdenados) {
    const d        = porDia[dia];
    const periodoD = d.mes + ' ' + d.anio;

    if (periodoD !== mesPrevio) {
      hojaDetalle.getRange(filaActual, 1, 1, 10).merge();
      hojaDetalle.getRange(filaActual, 1).setValue(periodoD);
      hojaDetalle.getRange(filaActual, 1)
        .setBackground('#1A3A5C').setFontColor('#FFFFFF')
        .setFontWeight('bold').setFontSize(11)
        .setHorizontalAlignment('left').setVerticalAlignment('middle');
      hojaDetalle.setRowHeight(filaActual, 26);
      filaActual++;
      mesPrevio = periodoD;
    }

    const hsExtra  = d.hs > 8 ? Math.round((d.hs - 8) * 10) / 10 : 0;
    const esSabado = d.diaSemana === 'SÁBADO' ? '✔' : '';
    const stripe   = (filaActual % 2 === 0) ? '#F5F9FF' : '#FFFFFF';
    const colorL   = coloresLocal[d.local] || { fondo: '#F5F5F5', texto: '#333333' };

    const partesFecha = dia.split('-');
    const fechaFormato = partesFecha[2] + '/' + partesFecha[1] + '/' + partesFecha[0];

    const t1 = d.turnos[0] ? d.turnos[0].hEntrada + ' - ' + d.turnos[0].hSalida : '';
    const t2 = d.turnos[1] ? d.turnos[1].hEntrada + ' - ' + d.turnos[1].hSalida : '';

    const rango = hojaDetalle.getRange(filaActual, 1, 1, 10);
    rango.setValues([[
      fechaFormato, d.diaSemana, d.horaRegistro, t1, t2,
      Math.round(d.hs * 10) / 10,
      hsExtra > 0 ? hsExtra : 0,
      esSabado, d.local, d.nota
    ]]);
    rango.setBackground(stripe).setFontSize(10).setVerticalAlignment('middle');
    hojaDetalle.getRange(filaActual, 1).setFontWeight('bold');
    hojaDetalle.setRowHeight(filaActual, 22);

    hojaDetalle.getRange(filaActual, 9)
      .setBackground(colorL.fondo).setFontColor(colorL.texto).setFontWeight('bold');

    if (hsExtra > 0) {
      hojaDetalle.getRange(filaActual, 7)
        .setBackground('#FFCDD2').setFontColor('#C62828').setFontWeight('bold');
    }
    if (esSabado) {
      hojaDetalle.getRange(filaActual, 8)
        .setBackground('#FFF3E0').setFontColor('#E65100').setFontWeight('bold');
    }

    totalDias++;
    totalHs     += d.hs;
    totalExtra  += hsExtra;
    if (esSabado) totalSabados++;
    filaActual++;
  }

  hojaDetalle.setRowHeight(filaActual, 8);
  filaActual++;

  hojaDetalle.getRange(filaActual, 1, 1, 10).setValues([[
    'TOTALES', totalDias, '', '', '',
    Math.round(totalHs * 10) / 10,
    Math.round(totalExtra * 10) / 10,
    totalSabados, '', ''
  ]]);
  hojaDetalle.getRange(filaActual, 1, 1, 10)
    .setBackground('#D6E8FF').setFontColor('#1A3A5C')
    .setFontWeight('bold').setFontSize(10)
    .setVerticalAlignment('middle');
  hojaDetalle.setRowHeight(filaActual, 26);

  hojaDetalle.getRange(4, 6, filaActual - 3, 1).setNumberFormat('0.0');
  hojaDetalle.getRange(4, 7, filaActual - 3, 1).setNumberFormat('0.0');

  hojaDetalle.setColumnWidth(1, 100);
  hojaDetalle.setColumnWidth(2, 110);
  hojaDetalle.setColumnWidth(3, 100);
  hojaDetalle.setColumnWidth(4, 130);
  hojaDetalle.setColumnWidth(5, 130);
  hojaDetalle.setColumnWidth(6, 90);
  hojaDetalle.setColumnWidth(7, 90);
  hojaDetalle.setColumnWidth(8, 80);
  hojaDetalle.setColumnWidth(9, 100);
  hojaDetalle.setColumnWidth(10, 220);

  hojaDetalle.getRange(3, 1, filaActual - 2, 10).setBorder(
    true, true, true, true, true, true,
    '#BDBDBD', SpreadsheetApp.BorderStyle.SOLID
  );

  hojaDetalle.setFrozenRows(3);
  ss.setActiveSheet(hojaDetalle);
  return '✅ Detalle generado correctamente.';
}

// ── SIDEBAR: RESUMEN GENERAL ──────────────────────────
function generarConFiltros(filtros) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hojaDatos = ss.getSheetByName('DATOS GENERALES');
  const datos = hojaDatos.getDataRange().getValues();

  const ordenMeses = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
                      'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];

  const totales     = {};
  const periodosSet = new Set();

  for (let i = 1; i < datos.length; i++) {
    const fila          = datos[i];
    const local         = String(fila[0]).trim().toUpperCase();
    const anio          = String(fila[1]).trim();
    const mes           = String(fila[2]).trim().toUpperCase();
    const diaSemana     = String(fila[3]).trim().toUpperCase();
    const empleado      = String(fila[5]).trim().toUpperCase();
    const hs            = parseFloat(String(fila[9]).replace(',', '.')) || 0;
    const marcaTemporal = fila[4];

    if (!local || !anio || !mes || !empleado || isNaN(hs)) continue;

    const periodoFila = mes + ' ' + anio;
    if (filtros.periodo  && filtros.periodo  !== 'TODOS' && periodoFila !== filtros.periodo)  continue;
    if (filtros.local    && filtros.local    !== 'TODOS' && local       !== filtros.local)    continue;
    if (filtros.empleado && filtros.empleado !== 'TODOS' && empleado    !== filtros.empleado) continue;

    const mt = new Date(marcaTemporal);
    const diaUnico = mt.getFullYear() + '-' + mt.getMonth() + '-' + mt.getDate();

    const clave = anio + '|' + mes + '|' + local + '|' + empleado;
    if (!totales[clave]) {
      totales[clave] = { hs: 0, fechas: new Set(), sabados: new Set(), hsPorDia: {} };
    }
    totales[clave].hs += hs;
    totales[clave].fechas.add(diaUnico);
    totales[clave].hsPorDia[diaUnico] = (totales[clave].hsPorDia[diaUnico] || 0) + hs;

    if (diaSemana === 'SÁBADO') {
      totales[clave].sabados.add(diaUnico);
    }

    periodosSet.add(anio + '|' + mes);
  }

  const periodos = Array.from(periodosSet).sort((a, b) => {
    const [aA, mA] = a.split('|');
    const [aB, mB] = b.split('|');
    if (aA !== aB) return parseInt(aA) - parseInt(aB);
    return ordenMeses.indexOf(mA) - ordenMeses.indexOf(mB);
  });

  const coloresLocal = {
    'PASEO':   { fondo: '#E3F2FD', texto: '#1565C0' },
    'WAVE':    { fondo: '#E8F5E9', texto: '#2E7D32' },
    'CIPO':    { fondo: '#FFF3E0', texto: '#E65100' },
    'PERITO':  { fondo: '#F3E5F5', texto: '#6A1B9A' },
    'CENTE':   { fondo: '#FCE4EC', texto: '#880E4F' },
    'ROCA180': { fondo: '#E0F7FA', texto: '#006064' },
    'DEPO':    { fondo: '#FFF8E1', texto: '#F57F17' },
    'OFICINA': { fondo: '#EFEBE9', texto: '#4E342E' },
  };

  let hojaResumen = ss.getSheetByName('RESUMEN');
  if (!hojaResumen) hojaResumen = ss.insertSheet('RESUMEN');
  hojaResumen.clearContents();
  hojaResumen.clearFormats();

  hojaResumen.getRange(1, 1, 1, 8).merge();
  hojaResumen.getRange(1, 1).setValue('📋  RESUMEN DE JORNADA LABORAL — CROMA');
  hojaResumen.getRange(1, 1)
    .setBackground('#1A3A5C').setFontColor('#FFFFFF')
    .setFontWeight('bold').setFontSize(13)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  hojaResumen.setRowHeight(1, 35);

  const encabezados = ['EMPLEADO/A','DÍAS TRAB.','TOTAL HS','PROM. HS/DÍA','HS EXTRA','SÁBADOS','LOCAL','PERÍODO'];
  hojaResumen.getRange(2, 1, 1, 8).setValues([encabezados]);
  hojaResumen.getRange(2, 1, 1, 8)
    .setBackground('#2E6DA4').setFontColor('#FFFFFF')
    .setFontWeight('bold').setFontSize(10)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  hojaResumen.setRowHeight(2, 25);

  let filaActual = 3;

  for (const periodo of periodos) {
    const [anio, mes] = periodo.split('|');

    hojaResumen.getRange(filaActual, 1, 1, 8).merge();
    hojaResumen.getRange(filaActual, 1).setValue(`${mes} ${anio}`);
    hojaResumen.getRange(filaActual, 1)
      .setBackground('#1A3A5C').setFontColor('#FFFFFF')
      .setFontWeight('bold').setFontSize(11)
      .setHorizontalAlignment('left').setVerticalAlignment('middle');
    hojaResumen.setRowHeight(filaActual, 28);
    filaActual++;

    const clavesDelPeriodo = Object.keys(totales)
      .filter(k => k.startsWith(anio + '|' + mes + '|'))
      .sort();

    let totalHsPeriodo      = 0;
    let totalDiasPeriodo    = 0;
    let totalSabadosPeriodo = 0;
    let totalExtraPeriodo   = 0;

    for (const clave of clavesDelPeriodo) {
      const partes   = clave.split('|');
      const local    = partes[2];
      const empleado = partes[3];
      const total    = Math.round(totales[clave].hs * 10) / 10;
      const dias     = totales[clave].fechas.size;
      const sabados  = totales[clave].sabados.size;
      const prom     = Math.round((total / dias) * 10) / 10;

      let hsExtra = 0;
      for (const hsDia of Object.values(totales[clave].hsPorDia)) {
        if (hsDia > 8) hsExtra += Math.round((hsDia - 8) * 10) / 10;
      }
      hsExtra = Math.round(hsExtra * 10) / 10;

      const colorLocal = coloresLocal[local] || { fondo: '#F5F5F5', texto: '#333333' };
      const rango = hojaResumen.getRange(filaActual, 1, 1, 8);

      rango.setValues([[empleado, dias, total, prom, hsExtra, sabados, local, mes + ' ' + anio]]);
      rango.setBackground(colorLocal.fondo);
      rango.setFontColor('#333333');
      rango.setFontSize(10);
      rango.setVerticalAlignment('middle');
      hojaResumen.setRowHeight(filaActual, 22);

      hojaResumen.getRange(filaActual, 1).setFontWeight('bold').setFontColor(colorLocal.texto);

      if (hsExtra > 0) {
        hojaResumen.getRange(filaActual, 5)
          .setBackground('#FFCDD2').setFontColor('#C62828').setFontWeight('bold');
      }
      if (sabados > 0) {
        hojaResumen.getRange(filaActual, 6)
          .setBackground('#FFF3E0').setFontColor('#E65100').setFontWeight('bold');
      }

      totalHsPeriodo      += total;
      totalDiasPeriodo    += dias;
      totalSabadosPeriodo += sabados;
      totalExtraPeriodo   += hsExtra;
      filaActual++;
    }

    hojaResumen.getRange(filaActual, 1, 1, 8).setValues([[
      'TOTAL ' + mes + ' ' + anio,
      totalDiasPeriodo,
      Math.round(totalHsPeriodo * 10) / 10,
      '',
      Math.round(totalExtraPeriodo * 10) / 10,
      totalSabadosPeriodo,
      '', ''
    ]]);
    hojaResumen.getRange(filaActual, 1, 1, 8)
      .setBackground('#D6E8FF').setFontColor('#1A3A5C')
      .setFontWeight('bold').setFontSize(10)
      .setVerticalAlignment('middle');
    hojaResumen.setRowHeight(filaActual, 24);
    filaActual++;

    hojaResumen.setRowHeight(filaActual, 10);
    filaActual++;
  }

  const ultimaFila = filaActual - 1;
  if (ultimaFila >= 3) {
    hojaResumen.getRange(3, 2, ultimaFila - 2, 1).setNumberFormat('0');
    hojaResumen.getRange(3, 3, ultimaFila - 2, 1).setNumberFormat('0.0');
    hojaResumen.getRange(3, 4, ultimaFila - 2, 1).setNumberFormat('0.0');
    hojaResumen.getRange(3, 5, ultimaFila - 2, 1).setNumberFormat('0.0');
    hojaResumen.getRange(3, 6, ultimaFila - 2, 1).setNumberFormat('0');
  }

  hojaResumen.setColumnWidth(1, 200);
  hojaResumen.setColumnWidth(2, 100);
  hojaResumen.setColumnWidth(3, 100);
  hojaResumen.setColumnWidth(4, 110);
  hojaResumen.setColumnWidth(5, 100);
  hojaResumen.setColumnWidth(6, 90);
  hojaResumen.setColumnWidth(7, 100);
  hojaResumen.setColumnWidth(8, 120);

  hojaResumen.getRange(2, 1, filaActual - 2, 8).setBorder(
    true, true, true, true, true, true,
    '#BDBDBD', SpreadsheetApp.BorderStyle.SOLID
  );

  hojaResumen.setFrozenRows(2);
  ss.setActiveSheet(hojaResumen);
  return '✅ Resumen actualizado correctamente.';
}

function actualizarResumen() {
  generarConFiltros({ periodo: 'TODOS', local: 'TODOS', empleado: 'TODOS' });
}

// ── SIDEBAR: EXPORT PDF ───────────────────────────────
function exportarPDF(nombreArchivo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hojaResumen = ss.getSheetByName('RESUMEN');
  if (!hojaResumen) {
    return { error: 'Primero generá el resumen antes de exportar.' };
  }

  const ssId  = ss.getId();
  const gid   = hojaResumen.getSheetId();
  const token = ScriptApp.getOAuthToken();

  const url = `https://docs.google.com/spreadsheets/d/${ssId}/export` +
    `?format=pdf&size=A4&portrait=false&fitw=true` +
    `&sheetnames=false&printtitle=false&pagenumbers=false` +
    `&gridlines=false&fzr=false&gid=${gid}`;

  const blob = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + token }
  }).getBlob().setName(nombreArchivo + '.pdf');

  const archivo = DriveApp.createFile(blob);
  archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return { url: archivo.getDownloadUrl(), verUrl: archivo.getUrl() };
}

function exportarPDFDetalle(nombreArchivo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hojaDetalle = ss.getSheetByName('DETALLE EMPLEADO');
  if (!hojaDetalle) {
    return { error: 'Primero generá el detalle de un empleado antes de exportar.' };
  }

  const ssId  = ss.getId();
  const gid   = hojaDetalle.getSheetId();
  const token = ScriptApp.getOAuthToken();

  const url = `https://docs.google.com/spreadsheets/d/${ssId}/export` +
    `?format=pdf&size=A4&portrait=false&fitw=true` +
    `&sheetnames=false&printtitle=false&pagenumbers=false` +
    `&gridlines=false&fzr=false&gid=${gid}`;

  const blob = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + token }
  }).getBlob().setName(nombreArchivo + '.pdf');

  const archivo = DriveApp.createFile(blob);
  archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return { url: archivo.getDownloadUrl(), verUrl: archivo.getUrl() };
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

  if (accion === 'horarios')            return getHorarios();
  if (accion === 'perfiles')            return getPerfiles();
  if (accion === 'guardar_perfil')      return guardarPerfil(e);
  if (accion === 'guardar_categoria')   return guardarCategoria(e);
  if (accion === 'cargar_usuarios')     return getUsuarios();
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
  if (accion === 'get_banco_horas_todos') return getBancoHorasTodos();

  return ContentService
    .createTextOutput(JSON.stringify({ error: 'Acción no reconocida' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function getHorarios() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const hoja  = ss.getSheetByName('DATOS GENERALES');
  const datos = hoja.getDataRange().getValues();
  const filas = datos.slice(1);

  // Columnas (0-indexed):
  // A=0 LOCAL  B=1 AÑO  C=2 MES  D=3 DIA(texto)  E=4 MARCA_TEMPORAL
  // F=5 EMPLEADO  G=6 H_ENTRADA  H=7 H_SALIDA  I=8 NOTA  J=9 TOTAL

  const registros = filas
    .filter(f => f[0] && f[5])
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

    // Construir fila respetando el orden real de columnas
    const fila = new Array(headers.length).fill('');
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

function getUsuarios() {
  try {
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

function guardarUsuarios(e) {
  try {
    const raw  = e.parameter.datos || '[]';
    const lista = JSON.parse(decodeURIComponent(raw));
    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    let hoja   = ss.getSheetByName('USUARIOS');

    if (!hoja) {
      hoja = ss.insertSheet('USUARIOS');
    }

    hoja.clearContents();
    hoja.getRange(1, 1, 1, 5).setValues([['NOMBRE','PIN','ROL','EMPLEADO_NOMBRE','CELULAR']]);

    if (lista.length > 0) {
      const filas = lista.map(u => [
        u.nombre         || '',
        u.pin            || '',
        u.rol            || 'empleado',
        u.empleadoNombre || '',
        u.celular        || '',
      ]);
      hoja.getRange(2, 1, filas.length, 5).setValues(filas);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
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
  'TOTAL en hs','FECHA','TIPO_REGISTRO','HS_A_RECUPERAR','DESTINO_RECUPERACION','FECHA_A_RECUPERAR','MODO_CARGA','LAT','LON','DISTANCIA_M'
];

function guardarFichada(e) {
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

    const MESES_ES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
                      'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
    const DIAS_ES  = ['DOMINGO','LUNES','MARTES','MIÉRCOLES','JUEVES','VIERNES','SÁBADO'];

    const partes   = datos.fecha.split('-').map(Number);
    const fechaObj = new Date(partes[0], partes[1] - 1, partes[2]);
    const mesTexto = MESES_ES[partes[1] - 1];
    const diaTexto = DIAS_ES[fechaObj.getDay()];
    const marca    = new Date();

    function horaAMin(str) {
      const p = String(str).split(':').map(Number);
      return p[0] * 60 + (p[1] || 0);
    }
    let totalHs = (horaAMin(datos.hora_salida) - horaAMin(datos.hora_entrada)) / 60;
    if (totalHs < 0) totalHs += 24;
    totalHs = Math.round(totalHs * 100) / 100;

    hoja.appendRow([
      datos.local,
      String(partes[0]),
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
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
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

    const fichadas = vals.slice(1)
      .filter(r => String(r[iEmp] || '').trim().toLowerCase() === empleado.toLowerCase())
      .map(r => ({
        fecha:             String(r[iFecha]  || '').substring(0, 10),
        entrada:           formatearHora(r[iEntr]),
        salida:            formatearHora(r[iSal]),
        total:             parseFloat(r[iTotal]) || 0,
        tipo:              String(r[iTipo]   || 'NORMAL'),
        local:             String(r[iLocal]  || ''),
        fecha_a_recuperar: String(r[iFRecup] || ''),
        nota:              iNota >= 0 ? String(r[iNota] || '') : '',
        marca:             r[iMarca] instanceof Date ? r[iMarca].toISOString() : String(r[iMarca] || ''),
      }))
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