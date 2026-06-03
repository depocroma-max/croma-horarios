/* =====================================================
   CROMA · HORARIOS — app.js
   Estructura del Sheet esperada (por sucursal):
   LOCAL | AÑO | MES | DIA | MARCA_TEMPORAL | EMPLEADO |
   H_ENTRADA | H_SALIDA | NOTA | TOTAL_HS
   ===================================================== */

// ── CONFIGURACIÓN ──────────────────────────────────────
const SUCURSALES = [
  { id: '01',     hoja: 'PASEO',   nombre: '01 PASEO',           color: '#185FA5', colorLight: '#DBEAFE' },
  { id: '05',     hoja: 'WAVE',    nombre: '05 WAVE',            color: '#0F6E56', colorLight: '#D1FAE5' },
  { id: '09',     hoja: 'CIPO',    nombre: '09 CIPO SAN MARTIN', color: '#B45309', colorLight: '#FEF3C7' },
  { id: '10',     hoja: 'PERITO',  nombre: '10 PERITO MORENO',   color: '#9B2563', colorLight: '#FCE7F3' },
  { id: '12',     hoja: 'CENTE',   nombre: '12 CENTENARIO',      color: '#534AB7', colorLight: '#EDE9FE' },
  { id: '14',     hoja: 'ROCA180', nombre: '14 ROCA',            color: '#3B6D11', colorLight: '#D1FAE5' },
  { id: 'DEPO',   hoja: 'DEPO',    nombre: 'DEPO',               color: '#475569', colorLight: '#F1F5F9' },
  { id: 'OFICINA',hoja: 'OFICINA', nombre: 'OFICINA',            color: '#7C3AED', colorLight: '#EDE9FE' },
];

const DIAS      = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
const MESES_ES  = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
                   'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];

// ── EMPRESAS ───────────────────────────────────────────
const EMPRESAS = ['MOSHE SRL', 'CROMAWAVE SRL'];

// ── CATEGORÍAS DE EMPLEADOS ────────────────────────────
// Se cargan desde el Sheet (hoja CATEGORIAS) y se cachean aquí
// Formato: { id, nombre, hsDiarias, diasBase (array de 0-6, 0=Dom), percibe_extra }
let CATEGORIAS_CONFIG = [
  {
    id: 'JC',
    nombre: 'Jornada Completa',
    descripcion: '8h Lun-Vie, 4h Sáb',
    // Regla: Lun-Vie máx 8h, Sáb máx 4h; excedente = extra
    regla: 'lv8_s4',
    percibe_extra: true,
  },
  {
    id: 'MJ',
    nombre: 'Media Jornada',
    descripcion: '4h Lun-Sáb',
    regla: 'fijo4',        // 4h cualquier día; excedente = extra
    percibe_extra: true,
  },
  {
    id: 'FR',
    nombre: 'Franquero',
    descripcion: 'Sin horas extra',
    regla: 'sin_extra',
    percibe_extra: false,
  },
];

// ── PERFILES DE EMPLEADOS ──────────────────────────────
// Se cargan desde el Sheet (hoja EMPLEADOS) y se cachean aquí
// Formato: { nombre, empresa, categoria_id, hs_base, dias_base, foto_url, activo, regla_custom }
let EMPLEADOS_PERFILES = {};   // clave: nombre exacto del empleado
let CERTIFICADOS_CACHE = [];   // lista de certificados cargados del Sheet

const TIPOS_CERTIFICADO = [
  'Médico', 'Estudio', 'Maternidad / Paternidad', 'Duelo',
  'Casamiento', 'Mudanza', 'Trámite', 'Accidente laboral', 'Personalizado'
];

// Helper: obtener categoría de un empleado
function getCategoriaEmpleado(nombreEmp) {
  const perfil = EMPLEADOS_PERFILES[nombreEmp];
  if (!perfil) return null;
  return CATEGORIAS_CONFIG.find(c => c.id === perfil.categoria_id) || null;
}

// Helper: calcular horas extra según categoría personalizada
function calcularHsExtra(nombreEmp, hsTotal, fechaDate) {
  // Feriado: todo lo trabajado es hora extra, sin excepción (incluso franqueros)
  if (fechaDate && esFeriado(fechaDate)) return hsTotal;

  const perfil = EMPLEADOS_PERFILES[nombreEmp];
  if (!perfil) return Math.max(0, hsTotal - 8); // fallback genérico

  const cat = CATEGORIAS_CONFIG.find(c => c.id === perfil.categoria_id);
  if (!cat || !cat.percibe_extra) return 0;

  // Regla custom por empleado (ej: "lv4" = 4h Lun-Vie, excedente extra)
  if (perfil.regla_custom) {
    const dow = fechaDate ? fechaDate.getDay() : -1;
    const esFinDeSemana = dow === 0 || dow === 6;
    const limite = perfil.regla_custom === 'lv4'
      ? (esFinDeSemana ? 0 : 4)
      : perfil.hs_base || 8;
    return Math.max(0, hsTotal - limite);
  }

  // Reglas predefinidas por categoría
  const dow = fechaDate ? fechaDate.getDay() : -1;
  if (cat.regla === 'lv8_s4') {
    const esSab = dow === 6;
    const limite = esSab ? 4 : 8;
    return Math.max(0, hsTotal - limite);
  }
  if (cat.regla === 'fijo4') {
    return Math.max(0, hsTotal - 4);
  }
  if (cat.regla === 'sin_extra') return 0;

  // Regla personalizada por hs_base
  return Math.max(0, hsTotal - (perfil.hs_base || 8));
}

// ── FERIADOS ARGENTINA 2025-2026 ───────────────────────
const FERIADOS = new Set([
  // 2025
  '2025-01-01','2025-03-03','2025-03-04','2025-03-24','2025-04-02',
  '2025-04-17','2025-04-18','2025-05-01','2025-05-25','2025-06-16',
  '2025-06-20','2025-07-09','2025-08-17','2025-10-12','2025-11-20',
  '2025-12-08','2025-12-25',
  // 2026
  '2026-01-01','2026-02-16','2026-02-17','2026-03-24','2026-04-02',
  '2026-04-03','2026-04-04','2026-05-01','2026-05-25','2026-06-15',
  '2026-06-20','2026-07-09','2026-08-17','2026-10-12','2026-11-20',
  '2026-12-08','2026-12-25',
]);

function esFeriado(date) {
  const key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  return FERIADOS.has(key);
}

// ── FILTROS DE DÍA (Feriados / Sábados / Domingos) ────
// Filtros de día para el detalle de empleado
// 'ver': sin filtro | 'feriados' | 'sabados' | 'domingos'
let filtrosDia = {
  verSolo: 'todos',   // 'todos' | 'feriados' | 'sabados' | 'domingos' | 'laborales'
};

// URL fija del Apps Script (no requiere configuración manual)
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzEwxqe32k8lzi0_8sj1zAjj7Fd9mT5viE79jRxQsFWWl_MSnEGYspH8tDBOPWicTEF/exec';

// Claves de localStorage para URLs de Apps Script
const LS_URLS_KEY = 'croma_horarios_urls';

// ── ESTADO GLOBAL ──────────────────────────────────────
let state = {
  semanaOffset: 0,
  mesOffset: 0,       // 0 = mes actual, -1 = mes anterior, etc.
  datos: [],
  tabActual: 'mes',
  cargando: false,
};

// ── DATOS DE DEMO ──────────────────────────────────────
const DEMO_DATA = generarDemoData();

function generarDemoData() {
  const empleados = {
    '01': ['Valentina R.','Sofía M.','Luján P.','Marta G.','Romina C.'],
    '05': ['Eros V.','Agus N.','Jesica L.','Carla B.'],
    '09': ['Fernanda K.','Brenda S.','Celeste O.'],
    '10': ['Daniela F.','Claudia R.','Paula N.'],
    '12': ['Natalia V.','Silvana D.','Lorena C.'],
    '14': ['Anabel R.','Miriam L.','Daniela P.'],
  };
  const turnos = [
    { ent: '09:00', sal: '14:00', tipo: 'TM' },
    { ent: '14:00', sal: '21:00', tipo: 'TT' },
    { ent: '09:00', sal: '18:00', tipo: 'COMP' },
    null, null,
  ];
  const meses = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
                 'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
  const rows = [];
  const hoy = new Date();
  // generar 5 semanas alrededor de hoy
  for (let w = -2; w <= 2; w++) {
    const lunes = getLunes(w);
    for (let d = 0; d < 7; d++) {
      const fecha = new Date(lunes);
      fecha.setDate(lunes.getDate() + d);
      const anio = fecha.getFullYear();
      const mes  = meses[fecha.getMonth()];
      const dia  = fecha.getDate();
      Object.entries(empleados).forEach(([sucId, emps]) => {
        emps.forEach(emp => {
          const t = turnos[Math.floor(Math.random() * turnos.length)];
          if (!t) return;
          const total = calcularHoras(t.ent, t.sal);
          rows.push({
            LOCAL: sucId, AÑO: anio, MES: mes, DIA: dia,
            MARCA_TEMPORAL: fecha.toISOString(),
            EMPLEADO: emp,
            H_ENTRADA: t.ent, H_SALIDA: t.sal,
            NOTA: '', TOTAL_HS: total,
          });
        });
      });
    }
  }
  return rows;
}

// ── UTILIDADES DE FECHA ────────────────────────────────
function getLunes(offset = 0) {
  const hoy  = new Date();
  const dow  = hoy.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  const lunes = new Date(hoy);
  lunes.setDate(hoy.getDate() + diff + offset * 7);
  lunes.setHours(0, 0, 0, 0);
  return lunes;
}

function formatFecha(d) {
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
}

function getWeekRange(offset) {
  const lunes   = getLunes(offset);
  const domingo = new Date(lunes);
  domingo.setDate(lunes.getDate() + 6);
  return `${formatFecha(lunes)} — ${formatFecha(domingo)}`;
}

function calcularHoras(entrada, salida) {
  if (!entrada || !salida) return 0;
  const [eh, em] = entrada.split(':').map(Number);
  const [sh, sm] = salida.split(':').map(Number);
  const mins = (sh * 60 + sm) - (eh * 60 + em);
  return Math.max(0, +(mins / 60).toFixed(1));
}

function clasificarTurno(entrada, salida) {
  if (!entrada || !salida) return null;
  const [eh] = entrada.split(':').map(Number);
  const [sh] = salida.split(':').map(Number);
  const horas = calcularHoras(entrada, salida);
  if (horas >= 7) return 'COMP';
  if (eh < 12)    return 'TM';
  return 'TT';
}

// ── FILTROS ACTIVOS ────────────────────────────────────
function getFilters() {
  return {
    sucursal: document.getElementById('filterSucursal')?.value || 'all',
    empleado: document.getElementById('filterEmp')?.value || 'all',
    turno:    document.getElementById('filterTurno')?.value || 'all',
  };
}

function getDatosSemana(datos, offset) {
  const lunes = getLunes(offset);
  return datos.filter(r => {
    const fecha = new Date(lunes);
    for (let d = 0; d < 7; d++) {
      const f = new Date(lunes); f.setDate(lunes.getDate() + d);
      if (String(r.AÑO) === String(f.getFullYear()) &&
          r.MES === MESES_ES[f.getMonth()] &&
          String(r.DIA) === String(f.getDate())) return true;
    }
    return false;
  });
}

// ── PILLS DE TURNO ─────────────────────────────────────
function pillHTML(tipo) {
  if (!tipo) return '<span class="empty-dash">·</span>';
  const map = {
    TM:     ['pill pill-tm',     'Mañana'],
    TT:     ['pill pill-tt',     'Tarde'],
    COMP:   ['pill pill-comp',   'Corrido'],
    FRANCO: ['pill pill-franco', 'Franco'],
    FALTA:  ['pill pill-falta',  'Falta'],
  };
  const [cls, label] = map[tipo] || ['pill', tipo];
  return `<span class="${cls}">${label}</span>`;
}

// ── RENDER STATS ───────────────────────────────────────
function renderStats(datos) {
  const semana   = getDatosSemana(datos, state.semanaOffset);
  const emps     = new Set(semana.map(r => r.EMPLEADO));
  const horas    = semana.reduce((a, r) => a + (parseFloat(r.TOTAL_HS) || 0), 0);
  const hoy      = new Date();
  const mesHoy   = MESES_ES[hoy.getMonth()];
  const diaHoy   = hoy.getDate();
  const anioHoy  = hoy.getFullYear();
  const trabajanHoy = new Set(
    datos.filter(r =>
      String(r.AÑO) === String(anioHoy) && r.MES === mesHoy && String(r.DIA) === String(diaHoy)
    ).map(r => r.EMPLEADO)
  );

  document.getElementById('stEmp').textContent    = emps.size;
  document.getElementById('stTurnos').textContent = semana.length;
  document.getElementById('stHoras').textContent  = Math.round(horas);
  document.getElementById('stHoy').textContent    = trabajanHoy.size;
  document.getElementById('stHoyLabel').textContent =
    `Trabajan hoy (${hoy.toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit' })})`;
}

// ── RENDER GRILLA ──────────────────────────────────────
function renderGrilla(datos) {
  const lunes   = getLunes(state.semanaOffset);
  const { sucursal, empleado, turno } = getFilters();
  const semana  = getDatosSemana(datos, state.semanaOffset);
  const hoy     = new Date();

  // armar encabezados de días
  const thDias = DIAS.map((d, i) => {
    const f = new Date(lunes); f.setDate(lunes.getDate() + i);
    if (diaFiltrado(f)) return '';
    const esHoy = f.toDateString() === hoy.toDateString();
    const esFer = esFeriado(f);
    return `<th class="${esHoy ? 'hoy' : ''} ${esFer ? 'th-feriado' : ''}">${d}${esFer?' 🗓':''}${f.getDay()===6?' (Sáb)':f.getDay()===0?' (Dom)':''}<br><small>${formatFecha(f)}</small></th>`;
  }).join('');

  let html = '';

  SUCURSALES.forEach(suc => {
    if (sucursal !== 'all' && sucursal !== suc.id) return;

    const filasSuc = semana.filter(r => r.LOCAL === suc.id);
    const empsSet  = [...new Set(filasSuc.map(r => r.EMPLEADO))].sort();
    const empsFilt = empleado === 'all' ? empsSet : empsSet.filter(e => e === empleado);
    if (!empsFilt.length) return;

    html += `
    <div class="sucursal-block">
      <div class="sucursal-header">
        <div class="suc-stripe" style="background:${suc.color}"></div>
        <span class="suc-nombre">${suc.nombre}</span>
        <span class="suc-badge" style="background:${suc.colorLight};color:${suc.color}">
          ${empsFilt.length} empleado${empsFilt.length !== 1 ? 's' : ''}
        </span>
        <span class="suc-meta">${filasSuc.length} registros esta semana</span>
      </div>
      <div class="grilla-wrap">
        <table class="grilla">
          <thead>
            <tr>
              <th class="th-emp">Empleado</th>
              ${thDias}
              <th>Horas</th>
            </tr>
          </thead>
          <tbody>`;

    empsFilt.forEach(emp => {
      let totalEmp = 0;
      const celdas = DIAS.map((_, i) => {
        const f = new Date(lunes); f.setDate(lunes.getDate() + i);
        if (diaFiltrado(f)) return '';
        const esHoy = f.toDateString() === hoy.toDateString();

        // Buscar TODOS los registros del empleado en ese día (para turno cortado)
        const regsDelDia = filasSuc.filter(r =>
          r.EMPLEADO === emp &&
          String(r.DIA) === String(f.getDate()) &&
          r.MES === MESES_ES[f.getMonth()] &&
          String(r.AÑO) === String(f.getFullYear())
        ).sort((a, b) => (a.H_ENTRADA || '').localeCompare(b.H_ENTRADA || ''));

        if (!regsDelDia.length) {
          return `<td class="${esHoy ? 'hoy' : ''}"><span class="empty-dash">·</span></td>`;
        }

        // Acumular horas
        regsDelDia.forEach(r => { totalEmp += parseFloat(r.TOTAL_HS) || 0; });

        // Generar pills para cada turno del día
        let pillsHtml = '';
        regsDelDia.forEach(r => {
          const tipo = clasificarTurno(r.H_ENTRADA, r.H_SALIDA);
          if (turno !== 'all' && tipo !== turno) return;
          // Siempre mostrar hora debajo de la pill
          const tieneHora = r.H_ENTRADA && r.H_SALIDA;
          pillsHtml += `<div class="turno-doble">
            ${pillHTML(tipo)}
            ${tieneHora ? `<span class="turno-hora">${r.H_ENTRADA}–${r.H_SALIDA}</span>` : ''}
          </div>`;
        });

        if (!pillsHtml) pillsHtml = '<span class="empty-dash">·</span>';

        return `<td class="${esHoy ? 'hoy' : ''}" style="vertical-align:top;padding:6px 8px">${pillsHtml}</td>`;
      }).join('');

      html += `<tr>
        <td class="td-emp td-emp-link" onclick="abrirDetalleEmpleadoPeriodo('${emp.replace(/'/g,"\\'")}', 'semana')" style="cursor:pointer">${emp}</td>
        ${celdas}
        <td><strong>${totalEmp.toFixed(1)}</strong>h</td>
      </tr>`;
    });

    html += `</tbody></table></div></div>`;
  });

  document.getElementById('grillaContainer').innerHTML = html ||
    '<p style="padding:2rem;color:#999;font-size:14px">No hay datos para los filtros seleccionados.</p>';
}

// ── RENDER EMPLEADOS ───────────────────────────────────
function renderEmpleados(datos) {
  const container = document.getElementById('empContainer');

  // Armar opciones de período (meses con datos)
  const periodos = [...new Set(datos.map(r => `${r.AÑO}||${r.MES}`))].sort((a, b) => {
    const [aY, aM] = a.split('||');
    const [bY, bM] = b.split('||');
    const ai = parseInt(aY) * 12 + MESES_ES.indexOf(aM);
    const bi = parseInt(bY) * 12 + MESES_ES.indexOf(bM);
    return bi - ai; // más reciente primero
  });

  // Leer filtros del panel de empleados
  const selPeriodo  = document.getElementById('empFiltPeriodo')?.value  || 'all';
  const selLocal    = document.getElementById('empFiltLocal')?.value    || 'all';
  const selEmp      = document.getElementById('empFiltEmp')?.value      || 'all';
  const selEmpresa  = document.getElementById('empFiltEmpresa')?.value  || 'all';
  const selCategoria= document.getElementById('empFiltCategoria')?.value|| 'all';

  // Datos filtrados
  let datosFilt = datos;
  if (selPeriodo !== 'all') {
    const [anio, mes] = selPeriodo.split('||');
    datosFilt = datosFilt.filter(r => String(r.AÑO) === anio && r.MES === mes);
  }
  if (selLocal !== 'all') datosFilt = datosFilt.filter(r => r.LOCAL === selLocal);
  if (selEmpresa !== 'all') {
    datosFilt = datosFilt.filter(r => {
      const perfil = EMPLEADOS_PERFILES[r.EMPLEADO];
      return perfil && perfil.empresa === selEmpresa;
    });
  }
  if (selCategoria !== 'all') {
    datosFilt = datosFilt.filter(r => {
      const perfil = EMPLEADOS_PERFILES[r.EMPLEADO];
      return perfil && perfil.categoria_id === selCategoria;
    });
  }

  // Aplicar filtro de día (ver solo sábados / feriados / domingos)
  if (filtrosDia.verSolo !== 'todos') {
    datosFilt = datosFilt.filter(r => {
      const fecha = new Date(r.AÑO, MESES_ES.indexOf(r.MES), parseInt(r.DIA));
      if (filtrosDia.verSolo === 'sabados')   return fecha.getDay() === 6;
      if (filtrosDia.verSolo === 'domingos')  return fecha.getDay() === 0;
      if (filtrosDia.verSolo === 'feriados')  return esFeriado(fecha);
      if (filtrosDia.verSolo === 'laborales') return fecha.getDay() !== 0 && fecha.getDay() !== 6 && !esFeriado(fecha);
      return true;
    });
  }

  // Empleados disponibles según filtros de período y local
  const empsDisp = [...new Set(datosFilt.map(r => r.EMPLEADO))].sort((a, b) => {
    const na = parseInt(a) || 999, nb = parseInt(b) || 999;
    return na !== nb ? na - nb : a.localeCompare(b);
  });

  // Si hay un empleado seleccionado específico → abrir detalle
  if (selEmp !== 'all') {
    const sucId = datosFilt.find(r => r.EMPLEADO === selEmp)?.LOCAL || '';
    abrirDetalleEmpleado(selEmp, sucId);
  }

  // Render panel de filtros
  const periodoOpts = [`<option value="all">Todos los períodos</option>`,
    ...periodos.map(p => {
      const [y, m] = p.split('||');
      return `<option value="${p}" ${p === selPeriodo ? 'selected' : ''}>${m} ${y}</option>`;
    })].join('');

  const localOpts = [`<option value="all">Todos los locales</option>`,
    ...SUCURSALES.map(s =>
      `<option value="${s.id}" ${s.id === selLocal ? 'selected' : ''}>${s.nombre}</option>`
    )].join('');

  const empOpts = [`<option value="all">Todos los empleados</option>`,
    ...empsDisp.map(e => {
      const numMatch = e.match(/^(\d+)\s+(.+)$/);
      const label = numMatch ? `#${numMatch[1]} ${numMatch[2]}` : e;
      return `<option value="${e}" ${e === selEmp ? 'selected' : ''}>${label}</option>`;
    })].join('');

  // Grilla de tarjetas (cuando no hay empleado específico)
  const suc = (id) => SUCURSALES.find(s => s.id === id) || { color: '#888', colorLight: '#eee', nombre: id };

  const empMap = {};
  // Agrupar primero por empleado+día para calcular total diario
  const porEmpDia = {};
  datosFilt.forEach(r => {
    if (selEmp !== 'all' && r.EMPLEADO !== selEmp) return;
    const dayKey = `${r.EMPLEADO}||${r.AÑO}-${r.MES}-${r.DIA}`;
    if (!porEmpDia[dayKey]) porEmpDia[dayKey] = { emp: r.EMPLEADO, suc: r.LOCAL, anio: r.AÑO, mes: r.MES, dia: r.DIA, hs: 0 };
    porEmpDia[dayKey].hs += parseFloat(r.TOTAL_HS) || 0;
  });

  datosFilt.forEach(r => {
    if (selEmp !== 'all' && r.EMPLEADO !== selEmp) return;
    const key = r.EMPLEADO;
    if (!empMap[key]) {
      const perfil = EMPLEADOS_PERFILES[r.EMPLEADO] || {};
      const cat = CATEGORIAS_CONFIG.find(c => c.id === perfil.categoria_id);
      empMap[key] = { nombre: r.EMPLEADO, suc: r.LOCAL, horas: 0, dias: new Set(), hsExtra: 0, sabados: new Set(),
                      empresa: perfil.empresa || '—', categoria: cat?.nombre || '—', foto_url: perfil.foto_url || '',
                      diasProcesados: new Set() };
    }
    empMap[key].horas += parseFloat(r.TOTAL_HS) || 0;
    empMap[key].dias.add(`${r.DIA}-${r.MES}-${r.AÑO}`);
    const dow = new Date(r.AÑO, MESES_ES.indexOf(r.MES), parseInt(r.DIA)).getDay();
    if (dow === 6) empMap[key].sabados.add(`${r.DIA}-${r.MES}-${r.AÑO}`);
  });

  // Calcular hsExtra por día (suma total del día vs límite de categoría)
  Object.values(porEmpDia).forEach(d => {
    const key = d.emp;
    if (!empMap[key]) return;
    if (empMap[key].diasProcesados.has(`${d.anio}-${d.mes}-${d.dia}`)) return;
    empMap[key].diasProcesados.add(`${d.anio}-${d.mes}-${d.dia}`);
    const fecha = new Date(d.anio, MESES_ES.indexOf(d.mes), parseInt(d.dia));
    empMap[key].hsExtra += calcularHsExtra(d.emp, d.hs, fecha);
  });

  const lista = Object.values(empMap).sort((a, b) => {
    const na = parseInt(a.nombre) || 999, nb = parseInt(b.nombre) || 999;
    return na !== nb ? na - nb : a.nombre.localeCompare(b.nombre);
  });

  const grilla = lista.map(e => {
    const s = suc(e.suc);
    const numMatch = e.nombre.match(/^(\d+)\s+(.+)$/);
    const numVend  = numMatch ? numMatch[1] : '';
    const nomMostrar = numMatch ? numMatch[2] : e.nombre;
    const nombrePartes = nomMostrar.split(' ');
    const iniciales = nombrePartes.slice(0,2).map(p => p[0]?.toUpperCase()).join('');

    // Avatar: foto o iniciales
    const avatarInner = e.foto_url
      ? `<img src="${e.foto_url}" alt="${nomMostrar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentElement.innerHTML='${iniciales}'">`
      : (numVend ? `<span class="emp-num-vend">${numVend}</span>` : iniciales);

    // Badge empresa
    const empresaBadge = e.empresa && e.empresa !== '—'
      ? `<span class="emp-empresa-badge ${e.empresa === 'MOSHE SRL' ? 'badge-moshe' : 'badge-cromawave'}">${e.empresa}</span>`
      : '';
    // Badge categoría
    const catBadge = e.categoria && e.categoria !== '—'
      ? `<span class="emp-cat-badge">${e.categoria}</span>`
      : '';

    // WhatsApp: buscar celular del usuario vinculado a este empleado
    const usuarioVinculado = getUsuarios().find(u => u.empleadoNombre === e.nombre);
    const celular = usuarioVinculado?.celular;
    const waBtn = celular
      ? `<a href="https://wa.me/549${celular}" target="_blank" onclick="event.stopPropagation()"
           class="wa-btn" title="WhatsApp de ${nomMostrar}">
           <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
             <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
             <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.118 1.528 5.855L.057 23.07a.75.75 0 0 0 .918.908l5.339-1.453A11.944 11.944 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.896 0-3.67-.52-5.188-1.428l-.372-.22-3.867 1.052 1.081-3.775-.242-.389A9.96 9.96 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
           </svg>
           WhatsApp
         </a>`
      : '';

    return `<div class="emp-card" onclick="abrirDetalleEmpleadoDesdePanel('${e.nombre.replace(/'/g,"\\'")}', '${e.suc}')" style="cursor:pointer">
      <div class="emp-card-head">
        <div class="emp-avatar ${e.foto_url ? 'emp-avatar-foto' : ''}" style="${e.foto_url ? '' : `background:${s.colorLight};color:${s.color}`}">
          ${avatarInner}
        </div>
        <div style="flex:1;min-width:0">
          <div class="emp-nombre">${nomMostrar}</div>
          <div class="emp-suc">${s.nombre}${numVend ? ` · <span style="color:${s.color};font-weight:500">Vend. #${numVend}</span>` : ''}</div>
          <div class="emp-badges-row">${empresaBadge}${catBadge}</div>
        </div>
      </div>
      <div class="emp-stats">
        <div class="emp-stat-item">
          <div class="emp-stat-val">${e.dias.size}</div>
          <div class="emp-stat-label">Días</div>
        </div>
        <div class="emp-stat-item">
          <div class="emp-stat-val">${e.horas.toFixed(0)}</div>
          <div class="emp-stat-label">Hs total</div>
        </div>
        <div class="emp-stat-item">
          <div class="emp-stat-val">${e.hsExtra.toFixed(0)}</div>
          <div class="emp-stat-label">Hs extra</div>
        </div>
        <div class="emp-stat-item">
          <div class="emp-stat-val">${e.sabados.size}</div>
          <div class="emp-stat-label">Sábados</div>
        </div>
      </div>
      <div class="emp-card-footer">
        ${waBtn}
        <span>Ver jornada completa →</span>
      </div>
    </div>`;
  }).join('');

  const chkFer = filtrosDia.verSolo === 'feriados';
  const chkSab = filtrosDia.verSolo === 'sabados';
  const chkDom = filtrosDia.verSolo === 'domingos';
  const chkLab = filtrosDia.verSolo === 'laborales';

  const empresaOpts = [`<option value="all">Todas las empresas</option>`,
    ...EMPRESAS.map(emp => `<option value="${emp}" ${emp === selEmpresa ? 'selected' : ''}>${emp}</option>`)
  ].join('');

  const categoriaOpts = [`<option value="all">Todas las categorías</option>`,
    ...CATEGORIAS_CONFIG.map(c => `<option value="${c.id}" ${c.id === selCategoria ? 'selected' : ''}>${c.nombre}</option>`)
  ].join('');

  container.innerHTML = `
    <div class="emp-filtros-panel">
      <div class="emp-filtro-grupo" style="flex:0 0 auto;justify-content:flex-end;border-right:1px solid var(--gray-100);padding-right:1.5rem;min-width:unset">
        <label class="emp-filtro-label">Ver solo</label>
        <div class="filtros-dia-inline">
          <label class="filtro-dia-check">
            <input type="checkbox" id="chkFeriados" ${chkFer?'checked':''} onchange="toggleFiltroDia('feriados',this.checked)" />
            <span>Feriados</span>
          </label>
          <label class="filtro-dia-check">
            <input type="checkbox" id="chkSabados" ${chkSab?'checked':''} onchange="toggleFiltroDia('sabados',this.checked)" />
            <span>Sábados</span>
          </label>
          <label class="filtro-dia-check">
            <input type="checkbox" id="chkDomingos" ${chkDom?'checked':''} onchange="toggleFiltroDia('domingos',this.checked)" />
            <span>Domingos</span>
          </label>
          <label class="filtro-dia-check">
            <input type="checkbox" id="chkLaborales" ${chkLab?'checked':''} onchange="toggleFiltroDia('laborales',this.checked)" />
            <span>Solo laborales</span>
          </label>
        </div>
      </div>
      <div class="emp-filtro-grupo" style="min-width:130px;flex:1">
        <label class="emp-filtro-label">Período</label>
        <select class="emp-filtro-select" id="empFiltPeriodo" onchange="renderEmpleados(state.datos)">
          ${periodoOpts}
        </select>
      </div>
      <div class="emp-filtro-grupo" style="min-width:130px;flex:1">
        <label class="emp-filtro-label">Empresa</label>
        <select class="emp-filtro-select" id="empFiltEmpresa" onchange="renderEmpleados(state.datos)">
          ${empresaOpts}
        </select>
      </div>
      <div class="emp-filtro-grupo" style="min-width:130px;flex:1">
        <label class="emp-filtro-label">Categoría</label>
        <select class="emp-filtro-select" id="empFiltCategoria" onchange="renderEmpleados(state.datos)">
          ${categoriaOpts}
        </select>
      </div>
      <div class="emp-filtro-grupo" style="min-width:120px;flex:1">
        <label class="emp-filtro-label">Local</label>
        <select class="emp-filtro-select" id="empFiltLocal" onchange="empCambioLocal()">
          ${localOpts}
        </select>
      </div>
      <div class="emp-filtro-grupo" style="min-width:140px;flex:2">
        <label class="emp-filtro-label">Empleado/a</label>
        <select class="emp-filtro-select" id="empFiltEmp" onchange="renderEmpleados(state.datos)">
          ${empOpts}
        </select>
      </div>
    </div>
    <div class="emp-grid" id="empGrid">
      ${grilla || '<p style="padding:2rem;color:#999;font-size:14px">No hay empleados para los filtros seleccionados.</p>'}
    </div>`;
}

function empCambioLocal() {
  // Al cambiar local, resetear empleado y re-renderizar
  renderEmpleados(state.datos);
}

// ── DETALLE EMPLEADO ───────────────────────────────────
async function abrirDetalleEmpleado(nombreEmp, sucId) {
  if (CERTIFICADOS_CACHE.length === 0) await cargarCertificados();
  abrirDetalleEmpleadoConDatos(nombreEmp, sucId, state.datos.filter(r => r.EMPLEADO === nombreEmp));
}

async function abrirDetalleEmpleadoDesdePanel(nombreEmp, sucId) {
  if (CERTIFICADOS_CACHE.length === 0) await cargarCertificados();
  const selPeriodo = document.getElementById('empFiltPeriodo')?.value || 'all';
  const registros  = state.datos.filter(r => r.EMPLEADO === nombreEmp);
  let periodoForzado = null;
  if (selPeriodo !== 'all') {
    const [anio, mes] = selPeriodo.split('||');
    periodoForzado = mes + ' ' + anio;
  }
  abrirDetalleEmpleadoConDatos(nombreEmp, sucId, registros, periodoForzado);
}

function abrirDetalleEmpleadoConDatos(nombreEmp, sucId, registrosFiltrados, periodoForzado) {
  const datos = state.datos;
  const suc = SUCURSALES.find(s => s.id === sucId) || { color: '#888', colorLight: '#eee', nombre: sucId };

  // Registros ya filtrados, ordenados por fecha (más reciente primero)
  const registrosTodos = registrosFiltrados.sort((a, b) => {
    const fa = new Date(a.AÑO, MESES_ES.indexOf(a.MES), parseInt(a.DIA));
    const fb = new Date(b.AÑO, MESES_ES.indexOf(b.MES), parseInt(b.DIA));
    return fb - fa;
  });

  if (!registrosTodos.length) { showToast('Sin registros para este empleado'); return; }

  // Separar número y nombre
  const numMatch   = nombreEmp.match(/^(\d+)\s+(.+)$/);
  const numVend    = numMatch ? numMatch[1] : '';
  const nomMostrar = numMatch ? numMatch[2] : nombreEmp;

  // Obtener períodos disponibles ordenados cronológicamente
  const ORDEN_MESES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
                       'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
  const periodosSet = new Set();
  registrosTodos.forEach(r => periodosSet.add(r.MES + ' ' + r.AÑO));
  const periodos = Array.from(periodosSet).sort((a, b) => {
    const [mA, aA] = a.split(' ');
    const [mB, aB] = b.split(' ');
    if (aA !== aB) return parseInt(aA) - parseInt(aB);
    return ORDEN_MESES.indexOf(mA) - ORDEN_MESES.indexOf(mB);
  });

  const DIAS_SEMANA = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

  // Función para calcular filas y totales según período seleccionado
  function calcularContenido(periodo) {
    const registros = periodo === 'TODOS'
      ? registrosTodos
      : registrosTodos.filter(r => (r.MES + ' ' + r.AÑO) === periodo);

    const porFecha = {};
    registros.forEach(r => {
      const key = `${r.AÑO}-${r.MES}-${r.DIA}`;
      if (!porFecha[key]) porFecha[key] = [];
      porFecha[key].push(r);
    });

    const filas = Object.entries(porFecha).map(([key, regs]) => {
      regs.sort((a, b) => (a.H_ENTRADA || '').localeCompare(b.H_ENTRADA || ''));
      const r0 = regs[0];
      const fecha = new Date(r0.AÑO, MESES_ES.indexOf(r0.MES), parseInt(r0.DIA));
      const fechaStr = fecha.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
      const diaSem  = DIAS_SEMANA[fecha.getDay()];
      const esSab   = fecha.getDay() === 6;
      const esDom   = fecha.getDay() === 0;
      const esFer   = esFeriado(fecha);

      // Aplicar filtro de día
      if (diaFiltrado(fecha)) return null;

      let horaReg = '';
      if (r0.MARCA_TEMPORAL) {
        try {
          const mt = new Date(r0.MARCA_TEMPORAL);
          horaReg = mt.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' });
        } catch(e) {}
      }

      const turno1  = r0.H_ENTRADA && r0.H_SALIDA ? `${r0.H_ENTRADA} - ${r0.H_SALIDA}` : '—';
      const turno2  = regs[1] && regs[1].H_ENTRADA ? `${regs[1].H_ENTRADA} - ${regs[1].H_SALIDA}` : '';
      const hsTotal = regs.reduce((a, r) => a + (parseFloat(r.TOTAL_HS) || 0), 0);
      const hsExtra = calcularHsExtra(nombreEmp, hsTotal, fecha);
      const nota    = regs.map(r => r.NOTA).filter(Boolean).join(' / ');
      const localStr = regs.map(r => {
        const s = SUCURSALES.find(x => x.id === r.LOCAL);
        return s ? s.nombre : r.LOCAL;
      }).filter((v,i,a) => a.indexOf(v)===i).join(', ');

      return { fechaStr, diaSem, horaReg, turno1, turno2, hsTotal, hsExtra, esSab, esDom, esFer, nota, localStr,
               fechaISO: `${fecha.getFullYear()}-${String(fecha.getMonth()+1).padStart(2,'0')}-${String(fecha.getDate()).padStart(2,'0')}` };
    }).filter(Boolean);

    // Agregar filas de certificados
    const certs = getCertificadosDe(nombreEmp);
    certs.forEach(c => {
      // Filtrar por período
      if (periodo !== 'TODOS') {
        const [cy, cm, cd] = c.fecha.split('-').map(Number);
        const fechaCert = new Date(cy, cm-1, cd);
        const mesAnio = `${MESES_ES[fechaCert.getMonth()]} ${fechaCert.getFullYear()}`;
        if (mesAnio !== periodo) return;
      }
      const [cy, cm, cd] = c.fecha.split('-').map(Number);
      const fechaCert = new Date(cy, cm-1, cd);
      if (diaFiltrado(fechaCert)) return;
      filas.push({
        fechaStr: fechaCert.toLocaleDateString('es-AR', {day:'2-digit',month:'2-digit',year:'numeric'}),
        diaSem:   DIAS_SEMANA[fechaCert.getDay()],
        horaReg:  '—',
        turno1:   `CERTIFICADO`,
        turno2:   '',
        hsTotal:  c.hs,
        hsExtra:  0,
        esSab:    fechaCert.getDay() === 6,
        esDom:    fechaCert.getDay() === 0,
        esFer:    esFeriado(fechaCert),
        nota:     c.nota || c.tipo,
        localStr: '—',
        esCert:   true,
        certId:   c.id,
        certTipo: c.tipo,
        fechaISO: c.fecha,
      });
    });

    // Ordenar todas las filas por fecha asc (más viejo primero)
    filas.sort((a, b) => {
      const [ya,ma,da] = a.fechaISO.split('-').map(Number);
      const [yb,mb,db] = b.fechaISO.split('-').map(Number);
      return new Date(ya,ma-1,da) - new Date(yb,mb-1,db);
    });

    // Totales calculados desde las filas ya filtradas
    const totalHoras   = filas.reduce((a, f) => a + f.hsTotal, 0);
    const diasUnicos   = filas.length;
    const totalHsExtra = filas.reduce((a, f) => a + f.hsExtra, 0);
    const totalSabs    = filas.filter(f => f.esSab).length;

    return { filas, totalHoras, totalHsExtra, totalSabs, diasUnicos };
  }

  // Función para re-renderizar tabla y stats al cambiar mes
  function renderDetalle(periodo) {
    const { filas, totalHoras, totalHsExtra, totalSabs, diasUnicos } = calcularContenido(periodo);
    const periodoLabel = periodo === 'TODOS' ? 'Todos los registros' : periodo;

    document.getElementById('detalleStatDias').textContent  = diasUnicos;
    document.getElementById('detalleStatHs').textContent    = totalHoras.toFixed(1);
    document.getElementById('detalleStatExtra').textContent = totalHsExtra.toFixed(1);
    document.getElementById('detalleStatSabs').textContent  = totalSabs;
    const certEl = document.getElementById('detalleStatCerts');
    if (certEl) certEl.textContent = filas.filter(f => f.esCert).length;
    document.getElementById('detalleSub').textContent       = suc.nombre + ' · ' + periodoLabel;

    document.getElementById('detalleTbody').innerHTML = filas.map(f => {
      if (f.esCert) return `
      <tr class="fila-certificado" data-fecha="${f.fechaISO}" data-hs="${f.hsTotal}" data-extra="0" data-sab="${f.esSab?1:0}" data-cert="1">
        <td>${f.fechaStr}</td>
        <td>${f.diaSem}</td>
        <td class="hora-reg">—</td>
        <td colspan="2"><span class="tag-cert">CERT</span> ${f.nota}</td>
        <td><strong>${f.hsTotal.toFixed(1)}</strong></td>
        <td>—</td>
        <td></td>
        <td>—</td>
        <td><button onclick="eliminarCertificado('${f.certId}','${nombreEmp.replace(/'/g,"\\'")}','${f.fechaISO.substring(0,7)}')" style="background:none;border:none;cursor:pointer;color:#dc2626;font-size:12px" title="Borrar certificado">✕</button></td>
      </tr>`;
      return `
      <tr class="${f.esSab ? 'fila-sabado' : ''} ${f.esDom ? 'fila-domingo' : ''} ${f.esFer ? 'fila-feriado' : ''}" data-fecha="${f.fechaISO}" data-hs="${f.hsTotal}" data-extra="${f.hsExtra}" data-sab="${f.esSab?1:0}" data-cert="0">
        <td>${f.fechaStr}${f.esFer ? ' <span class="tag-feriado">F</span>' : ''}</td>
        <td>${f.diaSem}</td>
        <td class="hora-reg">${f.horaReg}</td>
        <td class="turno-cell">${f.turno1}</td>
        <td class="turno-cell">${f.turno2 || '—'}</td>
        <td><strong>${f.hsTotal.toFixed(1)}</strong></td>
        <td>${f.hsExtra > 0 ? `<span class="hs-extra">${f.hsExtra.toFixed(1)}</span>` : '—'}</td>
        <td>${f.esSab ? '<span class="check-sab">✓</span>' : ''}</td>
        <td><span class="local-tag" style="color:${suc.color}">${f.localStr}</span></td>
        <td class="nota-cell">${f.nota || ''}</td>
      </tr>`;
    }).join('');
    actualizarTablaDetalle();

    document.getElementById('detalleTfoot').innerHTML = `
      <tr>
        <td colspan="2"><strong>TOTALES</strong></td>
        <td>${diasUnicos}</td>
        <td colspan="2"></td>
        <td><strong>${totalHoras.toFixed(1)}</strong></td>
        <td>${totalHsExtra > 0 ? `<span class="hs-extra">${totalHsExtra.toFixed(1)}</span>` : '—'}</td>
        <td>${totalSabs}</td>
        <td colspan="2"></td>
      </tr>`;
  }

  // Período inicial: el más reciente
  const periodoInicial = (periodoForzado && periodos.includes(periodoForzado))
    ? periodoForzado
    : (periodos[periodos.length - 1] || 'TODOS');
  const { filas: filasIni, totalHoras: thIni, totalHsExtra: theIni, totalSabs: tsIni, diasUnicos: duIni } = calcularContenido(periodoInicial);

  const opcionesMes = [`<option value="TODOS">Todos los registros</option>`]
    .concat(periodos.map(p => `<option value="${p}" ${p === periodoInicial ? 'selected' : ''}>${p}</option>`))
    .join('');

  const html = `
  <div class="detalle-overlay" onclick="cerrarDetalle(event)">
    <div class="detalle-panel" onclick="event.stopPropagation()">
      <div class="detalle-header" style="border-left: 4px solid ${suc.color}">
        <div class="detalle-header-top">
          <div>
            <div class="detalle-titulo">
              ${numVend ? `<span class="detalle-num" style="background:${suc.colorLight};color:${suc.color}">#${numVend}</span>` : ''}
              ${nomMostrar}
            </div>
            <div class="detalle-sub" id="detalleSub">${suc.nombre} · ${periodoInicial}</div>
          </div>
          <div class="detalle-acciones">
            <select id="detalleSelectMes" style="padding:5px 8px;border-radius:6px;border:1px solid #ddd;font-size:12px;font-family:inherit;background:#f8f9fa;color:#333;cursor:pointer;margin-right:6px;">
              ${opcionesMes}
            </select>
            <button class="btn-detalle-accion" onclick="imprimirDetalleEmpleado()" title="Imprimir / PDF">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
              PDF
            </button>
            <button class="btn-detalle-accion btn-excel" onclick="descargarExcelEmpleado('${nombreEmp.replace(/'/g,"\\''")}', '${nomMostrar}', '${suc.nombre}')" title="Descargar Excel">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
              Excel
            </button>
            <button class="btn-detalle-accion" style="color:#2563eb;border-color:#93c5fd" onclick="abrirFormCertificado(this.dataset.emp)" data-emp="${nombreEmp}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
              + Certificado
            </button>
            <button class="detalle-close" onclick="cerrarDetalle()">✕</button>
          </div>
        </div>
        <div class="detalle-stats-row">
          <div class="detalle-stat"><span class="detalle-stat-val" id="detalleStatDias">${duIni}</span><span class="detalle-stat-lbl">Días</span></div>
          <div class="detalle-stat"><span class="detalle-stat-val" id="detalleStatHs">${thIni.toFixed(1)}</span><span class="detalle-stat-lbl">Hs totales</span></div>
          <div class="detalle-stat"><span class="detalle-stat-val" id="detalleStatExtra">${theIni.toFixed(1)}</span><span class="detalle-stat-lbl">Hs extra</span></div>
          <div class="detalle-stat"><span class="detalle-stat-val" id="detalleStatSabs">${tsIni}</span><span class="detalle-stat-lbl">Sábados</span></div>
          <div class="detalle-stat"><span class="detalle-stat-val" style="color:#2563eb" id="detalleStatCerts">${filasIni.filter(f=>f.esCert).length}</span><span class="detalle-stat-lbl">Certificados</span></div>
        </div>
      </div>
      <div class="detalle-tabs">
        <button class="detalle-tab active" onclick="switchDetalleTab('jornada', this)">Jornada</button>
        <button class="detalle-tab" onclick="switchDetalleTab('evolucion', this)">Evolución mensual</button>
        <button class="detalle-tab" onclick="switchDetalleTab('vacaciones', this)" id="tabVacBtn_${nombreEmp.replace(/[^a-zA-Z0-9]/g,'_')}">🏖 Vacaciones</button>
      </div>
      <div class="detalle-tabla-wrap" id="detalleTabJornada">
        <div class="detalle-filtros-bar">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <span class="filtro-dia-label">Ver solo:</span>
            <label class="filtro-dia-check"><input type="checkbox" id="dchkFer" onchange="toggleDetalleFiltro('feriados',this.checked)"/><span>Feriados</span></label>
            <label class="filtro-dia-check"><input type="checkbox" id="dchkSab" onchange="toggleDetalleFiltro('sabados',this.checked)"/><span>Sábados</span></label>
            <label class="filtro-dia-check"><input type="checkbox" id="dchkDom" onchange="toggleDetalleFiltro('domingos',this.checked)"/><span>Domingos</span></label>
            <label class="filtro-dia-check"><input type="checkbox" id="dchkLab" onchange="toggleDetalleFiltro('laborales',this.checked)"/><span>Solo laborales</span></label>
            <label class="filtro-dia-check"><input type="checkbox" id="dchkCert" onchange="toggleDetalleFiltro('certificados',this.checked)"/><span>Certificados</span></label>
          </div>
        </div>
        <table class="detalle-tabla">
          <thead>
            <tr>
              <th style="cursor:pointer;user-select:none" onclick="toggleOrdenDetalle()" title="Ordenar por fecha">
                Fecha <span id="detalleOrdenIcon">↑</span>
              </th><th>Día</th><th>Hora reg.</th>
              <th>Turno 1</th><th>Turno 2</th>
              <th>Hs total</th><th>Hs extra</th>
              <th>Sáb.</th><th>Local</th><th>Nota</th>
            </tr>
          </thead>
          <tbody id="detalleTbody">
            ${filasIni.map(f => {
              if (f.esCert) return `<tr class="fila-certificado" data-fecha="${f.fechaISO}" data-hs="${f.hsTotal}" data-extra="0" data-sab="${f.esSab?1:0}" data-cert="1">
                <td>${f.fechaStr}</td><td>${f.diaSem}</td><td class="hora-reg">—</td>
                <td colspan="2"><span class="tag-cert">CERT</span> ${f.nota}</td>
                <td><strong>${f.hsTotal.toFixed(1)}</strong></td><td>—</td><td></td><td>—</td>
                <td><button onclick="eliminarCertificado('${f.certId}','${nombreEmp.replace(/'/g,"\\'")}','${f.fechaISO.substring(0,7)}')" style="background:none;border:none;cursor:pointer;color:#dc2626;font-size:12px" title="Borrar">✕</button></td>
              </tr>`;
              return `<tr class="${f.esSab ? 'fila-sabado' : ''} ${f.esDom ? 'fila-domingo' : ''} ${f.esFer ? 'fila-feriado' : ''}" data-fecha="${f.fechaISO}" data-hs="${f.hsTotal}" data-extra="${f.hsExtra}" data-sab="${f.esSab?1:0}" data-cert="0">
              <td>${f.fechaStr}${f.esFer ? ' <span class="tag-feriado">F</span>' : ''}</td>
              <td>${f.diaSem}</td>
              <td class="hora-reg">${f.horaReg}</td>
              <td class="turno-cell">${f.turno1}</td>
              <td class="turno-cell">${f.turno2 || '—'}</td>
              <td><strong>${f.hsTotal.toFixed(1)}</strong></td>
              <td>${f.hsExtra > 0 ? `<span class="hs-extra">${f.hsExtra.toFixed(1)}</span>` : '—'}</td>
              <td>${f.esSab ? '<span class="check-sab">✓</span>' : ''}</td>
              <td><span class="local-tag" style="color:${suc.color}">${f.localStr}</span></td>
              <td class="nota-cell">${f.nota || ''}</td>
            </tr>`;}).join('')}
          </tbody>
          <tfoot id="detalleTfoot">
            <tr>
              <td colspan="2"><strong>TOTALES</strong></td>
              <td>${duIni}</td>
              <td colspan="2"></td>
              <td><strong>${thIni.toFixed(1)}</strong></td>
              <td>${theIni > 0 ? `<span class="hs-extra">${theIni.toFixed(1)}</span>` : '—'}</td>
              <td>${tsIni}</td>
              <td colspan="2"></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div class="detalle-tabla-wrap" id="detalleTabEvolucion" style="display:none;padding:1.5rem">
        ${generarEvolucionHTML(state.datos, nombreEmp, suc)}
      </div>
      <div class="detalle-tabla-wrap" id="detalleTabVacaciones" style="display:none;padding:1.5rem">
        <div id="vacAdminContent_inner">
          <p style="color:#94a3b8;font-size:13px">Cargando vacaciones...</p>
        </div>
      </div>
    </div>
  </div>`;

  const existing = document.getElementById('detalleOverlay');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.id = 'detalleOverlay';
  div.innerHTML = html;
  document.body.appendChild(div);
  document.body.style.overflow = 'hidden';

  actualizarTablaDetalle();
  // Evento del selector de mes — actualiza tabla y stats en tiempo real
  document.getElementById('detalleSelectMes').addEventListener('change', function() {
    renderDetalle(this.value);
  });
}

function abrirDetalleDia(dia, mesIdx, anio) {
  const mes = MESES_ES[mesIdx];
  const registros = state.datos.filter(r =>
    String(r.DIA) === String(dia) &&
    r.MES === mes &&
    String(r.AÑO) === String(anio)
  );
  if (!registros.length) return;

  const fecha = new Date(anio, mesIdx, dia);
  const DIAS_SEMANA = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const fechaStr = fecha.toLocaleDateString('es-AR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });

  // Agrupar por sucursal
  const porSuc = {};
  registros.forEach(r => {
    if (!porSuc[r.LOCAL]) porSuc[r.LOCAL] = [];
    porSuc[r.LOCAL].push(r);
  });

  let bodyHtml = '';
  Object.entries(porSuc).forEach(([sucId, regs]) => {
    const s = SUCURSALES.find(x => x.id === sucId) || { color:'#888', colorLight:'#eee', nombre: sucId };
    regs.sort((a,b) => (a.EMPLEADO||'').localeCompare(b.EMPLEADO||''));
    bodyHtml += regs.map(r => {
      const numMatch = r.EMPLEADO.match(/^(\d+)\s+(.+)$/);
      const nomLabel = numMatch ? `<span style="color:#94a3b8;font-size:11px">#${numMatch[1]}</span> ${numMatch[2]}` : r.EMPLEADO;
      const tipo = clasificarTurno(r.H_ENTRADA, r.H_SALIDA);
      const pill = pillHTML(tipo);
      return `<tr>
        <td>${nomLabel}</td>
        <td><span class="suc-badge-mini" style="background:${s.colorLight};color:${s.color}">${s.nombre}</span></td>
        <td class="turno-cell">${r.H_ENTRADA || '—'} - ${r.H_SALIDA || '—'}</td>
        <td>${pill}</td>
        <td><strong>${parseFloat(r.TOTAL_HS||0).toFixed(1)}</strong></td>
        <td class="nota-cell">${r.NOTA || ''}</td>
      </tr>`;
    }).join('');
  });

  const totalEmps = new Set(registros.map(r => r.EMPLEADO)).size;
  const totalHoras = registros.reduce((a,r) => a + (parseFloat(r.TOTAL_HS)||0), 0);

  const html = `
  <div class="detalle-overlay" onclick="cerrarDetalle(event)">
    <div class="detalle-panel" onclick="event.stopPropagation()" style="max-width:700px">
      <div class="detalle-header" style="border-left:4px solid var(--accent)">
        <div class="detalle-header-top">
          <div>
            <div class="detalle-titulo">${fechaStr.charAt(0).toUpperCase() + fechaStr.slice(1)}</div>
            <div class="detalle-sub">${totalEmps} empleados · ${totalHoras.toFixed(1)} hs totales</div>
          </div>
          <button class="detalle-close" onclick="cerrarDetalle()">✕</button>
        </div>
      </div>
      <div class="detalle-tabla-wrap">
        <table class="detalle-tabla">
          <thead>
            <tr>
              <th>Empleado</th>
              <th>Local</th>
              <th>Turno</th>
              <th>Tipo</th>
              <th>Horas</th>
              <th>Nota</th>
            </tr>
          </thead>
          <tbody>${bodyHtml}</tbody>
        </table>
      </div>
    </div>
  </div>`;

  const existing = document.getElementById('detalleOverlay');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.id = 'detalleOverlay';
  div.innerHTML = html;
  document.body.appendChild(div);
  document.body.style.overflow = 'hidden';
}

function abrirDetalleEmpleadoPeriodo(nombreEmp, modo) {
  // modo: 'semana' o 'mes'
  let datosFiltrados = state.datos.filter(r => r.EMPLEADO === nombreEmp);

  if (modo === 'semana') {
    datosFiltrados = getDatosSemana(datosFiltrados, state.semanaOffset);
  } else if (modo === 'mes') {
    datosFiltrados = getDatosMes(datosFiltrados, state.mesOffset);
  }

  if (!datosFiltrados.length) { showToast('Sin registros en este período'); return; }
  const sucId = datosFiltrados[0]?.LOCAL || '';
  // Llamar abrirDetalleEmpleado pero con datos ya filtrados por período
  abrirDetalleEmpleadoConDatos(nombreEmp, sucId, datosFiltrados);
}

function imprimirDetalleEmpleado() {
  // Crear ventana de impresión con solo el contenido del detalle
  const panel = document.querySelector('#detalleOverlay .detalle-panel');
  if (!panel) return;

  const win = window.open('', '_blank');
  win.document.write(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>Jornada CROMA</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', Arial, sans-serif; font-size: 12px; color: #000; padding: 20px; }
        .detalle-header { padding: 12px 0 16px; border-bottom: 2px solid #000; margin-bottom: 16px; }
        .detalle-titulo { font-size: 20px; font-weight: 700; letter-spacing: 1px; margin-bottom: 4px; }
        .detalle-sub { font-size: 12px; color: #666; margin-bottom: 12px; }
        .detalle-stats-row { display: flex; gap: 2rem; }
        .detalle-stat { display: flex; flex-direction: column; }
        .detalle-stat-val { font-size: 22px; font-weight: 700; }
        .detalle-stat-lbl { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        th { padding: 7px 8px; background: #f1f5f9; font-size: 10px; font-weight: 600;
             text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #ddd; text-align: left; }
        td { padding: 6px 8px; border-bottom: 1px solid #f0f0f0; }
        tr.fila-sabado td { background: #fffbeb; }
        tfoot td { background: #f8fafc; border-top: 2px solid #ddd; font-weight: 600; }
        .detalle-acciones { display: none; }
        .detalle-close { display: none; }
        @media print { body { padding: 10px; } }
      </style>
    </head>
    <body>
      ${panel.outerHTML}
    </body>
    </html>
  `);
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 400);
}

function descargarExcelEmpleado(nombreEmp, nomMostrar, sucNombre) {
  // Cargar SheetJS dinámicamente si no está cargado
  if (typeof XLSX === 'undefined') {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    script.onload = () => descargarExcelEmpleado(nombreEmp, nomMostrar, sucNombre);
    document.head.appendChild(script);
    showToast('Preparando Excel...');
    return;
  }

  const registros = state.datos
    .filter(r => r.EMPLEADO === nombreEmp)
    .sort((a, b) => {
      const fa = new Date(a.AÑO, MESES_ES.indexOf(a.MES), parseInt(a.DIA));
      const fb = new Date(b.AÑO, MESES_ES.indexOf(b.MES), parseInt(b.DIA));
      return fa - fb;
    });

  if (!registros.length) return;

  const porFecha = {};
  registros.forEach(r => {
    const key = `${r.AÑO}-${r.MES}-${r.DIA}`;
    if (!porFecha[key]) porFecha[key] = [];
    porFecha[key].push(r);
  });

  const DIAS_SEM = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

  const filas = Object.entries(porFecha).map(([key, regs]) => {
    regs.sort((a,b) => (a.H_ENTRADA||'').localeCompare(b.H_ENTRADA||''));
    const r0 = regs[0];
    const fecha = new Date(r0.AÑO, MESES_ES.indexOf(r0.MES), parseInt(r0.DIA));
    const fechaStr = fecha.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
    const diaSem  = DIAS_SEM[fecha.getDay()];
    const esSab   = fecha.getDay() === 6;

    let horaReg = '';
    if (r0.MARCA_TEMPORAL) {
      try { horaReg = new Date(r0.MARCA_TEMPORAL).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' }); } catch(e) {}
    }

    const turno1  = r0.H_ENTRADA && r0.H_SALIDA ? `${r0.H_ENTRADA} - ${r0.H_SALIDA}` : '';
    const turno2  = regs[1]?.H_ENTRADA ? `${regs[1].H_ENTRADA} - ${regs[1].H_SALIDA}` : '';
    const hsTotal = regs.reduce((a,r) => a + (parseFloat(r.TOTAL_HS)||0), 0);
    const hsExtra = Math.max(0, hsTotal - 8);
    const nota    = regs.map(r => r.NOTA).filter(Boolean).join(' / ');
    const local   = regs.map(r => {
      const s = SUCURSALES.find(x => x.id === r.LOCAL);
      return s ? s.nombre : r.LOCAL;
    }).filter((v,i,a) => a.indexOf(v)===i).join(', ');

    return { fechaStr, diaSem, horaReg, turno1, turno2, hsTotal, hsExtra, esSab, local, nota };
  });

  const totalHoras = filas.reduce((a,f) => a + f.hsTotal, 0);
  const totalExtra = filas.reduce((a,f) => a + f.hsExtra, 0);
  const totalSabs  = filas.filter(f => f.esSab).length;

  // ── Construir workbook ──
  const wb = XLSX.utils.book_new();
  const ws_data = [];

  // Fila 1: título
  ws_data.push([`DETALLE DE JORNADA — ${nomMostrar.toUpperCase()}`, '', '', '', '', '', '', '', '', '']);
  // Fila 2: sucursal y fecha generación
  ws_data.push([sucNombre, '', '', '', '', '', `Generado: ${new Date().toLocaleDateString('es-AR')}`, '', '', '']);
  // Fila 3: vacía
  ws_data.push([]);
  // Fila 4: encabezados
  ws_data.push(['FECHA','DÍA','HORA REG.','TURNO 1','TURNO 2','HS TOTAL','HS EXTRA','SÁBADO','LOCAL','NOTA']);
  // Filas de datos
  filas.forEach(f => {
    ws_data.push([
      f.fechaStr, f.diaSem, f.horaReg,
      f.turno1, f.turno2,
      f.hsTotal, f.hsExtra > 0 ? f.hsExtra : 0,
      f.esSab ? 'Sí' : '',
      f.local, f.nota
    ]);
  });
  // Fila vacía
  ws_data.push([]);
  // Fila totales
  ws_data.push(['TOTALES', '', filas.length + ' días', '', '', totalHoras, totalExtra, totalSabs, '', '']);

  const ws = XLSX.utils.aoa_to_sheet(ws_data);

  // ── Anchos de columna ──
  ws['!cols'] = [
    { wch: 12 }, // FECHA
    { wch: 6  }, // DÍA
    { wch: 10 }, // HORA REG
    { wch: 14 }, // TURNO 1
    { wch: 14 }, // TURNO 2
    { wch: 9  }, // HS TOTAL
    { wch: 9  }, // HS EXTRA
    { wch: 7  }, // SÁBADO
    { wch: 16 }, // LOCAL
    { wch: 35 }, // NOTA
  ];

  // ── Estilos (negrita en encabezados y totales) ──
  const headerRow = 3; // índice 0-based fila 4
  const totalRow  = ws_data.length - 1;
  const cols = ['A','B','C','D','E','F','G','H','I','J'];

  // Título — fila 1
  if (ws['A1']) {
    ws['A1'].s = { font: { bold: true, sz: 14 }, fill: { fgColor: { rgb: '0D0D0D' } }, font: { bold: true, sz: 14, color: { rgb: 'FFFFFF' } } };
  }
  // Encabezados — fila 4
  cols.forEach(c => {
    const cell = ws[`${c}4`];
    if (cell) cell.s = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '1E293B' } },
      alignment: { horizontal: 'center' }
    };
  });
  // Totales — última fila
  const totRef = `A${ws_data.length}`;
  if (ws[totRef]) ws[totRef].s = { font: { bold: true } };

  // Merge título
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }, // título
    { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } }, // sucursal
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Jornada');

  const fileName = `CROMA_${nomMostrar.replace(/\s+/g,'_')}.xlsx`;
  XLSX.writeFile(wb, fileName);
  showToast(`✓ Descargado: ${fileName}`);
}

function switchDetalleTab(tab, btn) {
  document.querySelectorAll('.detalle-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('detalleTabJornada').style.display  = tab === 'jornada'    ? 'block' : 'none';
  document.getElementById('detalleTabEvolucion').style.display = tab === 'evolucion'  ? 'block' : 'none';
  const vacEl = document.getElementById('detalleTabVacaciones');
  if (vacEl) vacEl.style.display = tab === 'vacaciones' ? 'block' : 'none';
  if (tab === 'vacaciones') {
    // Obtener nombre del empleado desde el título del detalle
    const tituloEl = document.querySelector('.detalle-titulo');
    if (tituloEl) {
      const numSpan = tituloEl.querySelector('.detalle-num');
      const numVend = numSpan ? numSpan.textContent.replace('#','').trim() : '';
      // Reconstruir nombre completo para buscar en datos
      const nomDiv = tituloEl.textContent.trim().replace(/^#\d+\s*/,'').trim();
      // Buscar en state.datos el nombre completo que contenga ese nomDiv
      const empNombre = state.datos.find(r => {
        const n = r.EMPLEADO.replace(/^\d+\s+/,'').trim();
        return n.toLowerCase() === nomDiv.toLowerCase();
      })?.EMPLEADO || nomDiv;
      cargarVacacionesAdmin(empNombre);
    }
  }
}

function generarEvolucionHTML(datos, nombreEmp, suc) {
  const registros = datos.filter(r => r.EMPLEADO === nombreEmp);
  if (!registros.length) return '<p style="color:#999;font-size:13px">Sin datos históricos.</p>';

  // Agrupar por mes
  const porMes = {};
  registros.forEach(r => {
    const key = `${r.AÑO}||${r.MES}`;
    if (!porMes[key]) porMes[key] = { horas: 0, dias: new Set(), hsExtra: 0, sabados: new Set() };
    const hs = parseFloat(r.TOTAL_HS) || 0;
    porMes[key].horas += hs;
    porMes[key].dias.add(r.DIA);
    if (hs > 8) porMes[key].hsExtra += hs - 8;
    const dow = new Date(r.AÑO, MESES_ES.indexOf(r.MES), parseInt(r.DIA)).getDay();
    if (dow === 6) porMes[key].sabados.add(r.DIA);
  });

  const meses = Object.entries(porMes).sort((a, b) => {
    const [aY, aM] = a[0].split('||');
    const [bY, bM] = b[0].split('||');
    return (parseInt(aY)*12 + MESES_ES.indexOf(aM)) - (parseInt(bY)*12 + MESES_ES.indexOf(bM));
  });

  const maxHoras = Math.max(...meses.map(([,v]) => v.horas)) || 1;

  // Tabla + mini barras
  const filas = meses.map(([key, v]) => {
    const [anio, mes] = key.split('||');
    const pct = (v.horas / maxHoras * 100).toFixed(0);
    return `<tr>
      <td style="white-space:nowrap;font-weight:500">${mes} ${anio}</td>
      <td>${v.dias.size}</td>
      <td>
        <div class="comp-bar-row">
          <div class="comp-bar" style="width:${pct}%;background:${suc.color}"></div>
          <span><strong>${v.horas.toFixed(0)}</strong>h</span>
        </div>
      </td>
      <td>${v.hsExtra > 0 ? `<span class="hs-extra">${v.hsExtra.toFixed(0)}h</span>` : '—'}</td>
      <td>${v.sabados.size || '—'}</td>
    </tr>`;
  }).join('');

  const totalH = meses.reduce((a,[,v]) => a + v.horas, 0);
  const promH  = meses.length ? totalH / meses.length : 0;

  return `
    <div style="margin-bottom:1rem;display:flex;gap:2rem">
      <div><span style="font-size:22px;font-weight:700;font-family:'Bebas Neue'">${meses.length}</span><br><span style="font-size:11px;color:#94a3b8;text-transform:uppercase">Meses</span></div>
      <div><span style="font-size:22px;font-weight:700;font-family:'Bebas Neue'">${totalH.toFixed(0)}</span><br><span style="font-size:11px;color:#94a3b8;text-transform:uppercase">Hs totales</span></div>
      <div><span style="font-size:22px;font-weight:700;font-family:'Bebas Neue'">${promH.toFixed(0)}</span><br><span style="font-size:11px;color:#94a3b8;text-transform:uppercase">Hs promedio/mes</span></div>
    </div>
    <table class="detalle-tabla">
      <thead><tr><th>Mes</th><th>Días</th><th>Horas</th><th>Hs extra</th><th>Sábados</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>`;
}

function cerrarDetalle(event) {
  if (event && event.target !== event.currentTarget) return;
  const el = document.getElementById('detalleOverlay');
  if (el) el.remove();
  document.body.style.overflow = '';
}

// ── RENDER REPORTES ────────────────────────────────────
function renderReportes(datos) {
  const container = document.getElementById('viewReportes');

  // Armar opciones de período
  const periodos = [...new Set(datos.map(r => `${r.AÑO}||${r.MES}`))].sort((a, b) => {
    const [aY, aM] = a.split('||');
    const [bY, bM] = b.split('||');
    return (parseInt(bY)*12 + MESES_ES.indexOf(bM)) - (parseInt(aY)*12 + MESES_ES.indexOf(aM));
  });

  // Leer filtros del panel de reportes
  const selPeriodo = document.getElementById('repFiltPeriodo')?.value || 'all';
  const selLocal   = document.getElementById('repFiltLocal')?.value   || 'all';

  // Filtrar datos
  let datosFilt = datos;
  if (selPeriodo !== 'all') {
    const [anio, mes] = selPeriodo.split('||');
    datosFilt = datosFilt.filter(r => String(r.AÑO) === anio && r.MES === mes);
  }
  if (selLocal !== 'all') datosFilt = datosFilt.filter(r => r.LOCAL === selLocal);

  const periodoLabel = selPeriodo !== 'all'
    ? selPeriodo.split('||').reverse().join(' ')
    : 'Todos los períodos';

  // ── HORAS POR EMPLEADO (todos, no solo top10) ──
  const horasPorEmp = {};
  datosFilt.forEach(r => {
    if (!horasPorEmp[r.EMPLEADO]) horasPorEmp[r.EMPLEADO] = { horas: 0, local: r.LOCAL };
    horasPorEmp[r.EMPLEADO].horas += parseFloat(r.TOTAL_HS) || 0;
  });
  const listaEmps = Object.entries(horasPorEmp)
    .sort((a, b) => b[1].horas - a[1].horas);
  const maxH = listaEmps[0]?.[1].horas || 1;
  const promH = listaEmps.length ? listaEmps.reduce((a,[,v]) => a + v.horas, 0) / listaEmps.length : 0;

  // ── HORAS Y COBERTURA POR SUCURSAL ──
  const porSuc = {};
  datosFilt.forEach(r => {
    if (!porSuc[r.LOCAL]) porSuc[r.LOCAL] = { emps: new Set(), horas: 0 };
    porSuc[r.LOCAL].emps.add(r.EMPLEADO);
    porSuc[r.LOCAL].horas += parseFloat(r.TOTAL_HS) || 0;
  });
  const maxSucH = Math.max(...SUCURSALES.map(s => porSuc[s.id]?.horas || 0)) || 1;

  // Opciones de filtros
  const periodoOpts = [`<option value="all">Todos los períodos</option>`,
    ...periodos.map(p => {
      const [y, m] = p.split('||');
      return `<option value="${p}" ${p === selPeriodo ? 'selected' : ''}>${m} ${y}</option>`;
    })].join('');

  const localOpts = [`<option value="all">Todas las sucursales</option>`,
    ...SUCURSALES.map(s =>
      `<option value="${s.id}" ${s.id === selLocal ? 'selected' : ''}>${s.nombre}</option>`
    )].join('');

  const htmlEmps = listaEmps.map(([nombre, d], i) => {
    const s = SUCURSALES.find(x => x.id === d.local) || { color: '#888' };
    const numMatch = nombre.match(/^(\d+)\s+(.+)$/);
    const label = numMatch ? `<span style="color:#94a3b8;font-size:11px">#${numMatch[1]}</span> ${numMatch[2]}` : nombre;
    return `<div class="reporte-row" style="gap:10px">
      <span class="rep-rank">${i+1}</span>
      <span class="reporte-nombre" style="flex:1;min-width:0">${label}</span>
      <div class="reporte-bar-wrap"><div class="reporte-bar" style="width:${(d.horas/maxH*100).toFixed(0)}%;background:${s.color}"></div></div>
      <span class="reporte-val" style="font-size:16px">${d.horas.toFixed(0)}h</span>
    </div>`;
  }).join('') || '<p style="font-size:13px;color:#999;padding:1rem 0">Sin datos</p>';

  const htmlSuc = SUCURSALES
    .filter(s => selLocal === 'all' || s.id === selLocal)
    .map(s => {
      const d = porSuc[s.id] || { emps: new Set(), horas: 0 };
      const pct = (d.horas / maxSucH * 100).toFixed(0);
      return `<div class="reporte-row" style="flex-direction:column;align-items:stretch;gap:6px;padding:10px 0">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="width:10px;height:10px;border-radius:50%;background:${s.color};flex-shrink:0;display:inline-block"></span>
          <span class="reporte-nombre" style="flex:1">${s.nombre}</span>
          <span style="font-size:12px;color:#64748b">${d.emps.size} emp.</span>
          <span class="reporte-val" style="font-size:16px">${d.horas.toFixed(0)}h</span>
        </div>
        <div class="reporte-bar-wrap" style="margin:0;height:5px">
          <div class="reporte-bar" style="width:${pct}%;background:${s.color}"></div>
        </div>
      </div>`;
    }).join('');

  // ── COMPARAR MESES ──
  const selComp = document.getElementById('repFiltComp')?.value || 'none';
  let htmlComparacion = '';

  if (selComp !== 'none') {
    const [cAnio, cMes] = selComp.split('||');
    let datosComp = datos.filter(r => String(r.AÑO) === cAnio && r.MES === cMes);
    if (selLocal !== 'all') datosComp = datosComp.filter(r => r.LOCAL === selLocal);

    const compLabel = `${cMes} ${cAnio}`;

    // Horas por empleado en mes de comparación
    const horasComp = {};
    datosComp.forEach(r => {
      if (!horasComp[r.EMPLEADO]) horasComp[r.EMPLEADO] = 0;
      horasComp[r.EMPLEADO] += parseFloat(r.TOTAL_HS) || 0;
    });

    // Combinar ambos meses
    const todosEmpsComp = new Set([...Object.keys(horasPorEmp), ...Object.keys(horasComp)]);
    const maxHComp = Math.max(
      ...Object.values(horasPorEmp).map(v => v.horas),
      ...Object.values(horasComp)
    ) || 1;

    const filaComp = [...todosEmpsComp].map(nombre => {
      const h1 = horasPorEmp[nombre]?.horas || 0;
      const h2 = horasComp[nombre] || 0;
      const diff = h1 - h2;
      const s = SUCURSALES.find(x => x.id === (horasPorEmp[nombre]?.local || '')) || { color: '#888' };
      const numMatch = nombre.match(/^(\d+)\s+(.+)$/);
      const label = numMatch ? `<span style="color:#94a3b8;font-size:11px">#${numMatch[1]}</span> ${numMatch[2]}` : nombre;
      const diffHtml = diff > 0
        ? `<span class="comp-diff comp-diff-up">+${diff.toFixed(0)}h</span>`
        : diff < 0
          ? `<span class="comp-diff comp-diff-down">${diff.toFixed(0)}h</span>`
          : `<span class="comp-diff comp-diff-eq">—</span>`;
      return { nombre, label, h1, h2, diff, s, diffHtml };
    }).sort((a, b) => b.h1 - a.h1);

    htmlComparacion = `
    <div class="reporte-card full comp-card">
      <h3>Comparación por empleado <span class="rep-periodo-tag">${periodoLabel} vs ${compLabel}</span></h3>
      <div class="comp-tabla-wrap">
        <table class="comp-tabla">
          <thead>
            <tr>
              <th>Empleado</th>
              <th>${periodoLabel}</th>
              <th>${compLabel}</th>
              <th>Diferencia</th>
            </tr>
          </thead>
          <tbody>
            ${filaComp.map(f => `<tr>
              <td class="reporte-nombre">${f.label}</td>
              <td>
                <div class="comp-bar-row">
                  <div class="comp-bar" style="width:${(f.h1/maxHComp*100).toFixed(0)}%;background:${f.s.color}"></div>
                  <span>${f.h1.toFixed(0)}h</span>
                </div>
              </td>
              <td>
                <div class="comp-bar-row">
                  <div class="comp-bar comp-bar-2" style="width:${(f.h2/maxHComp*100).toFixed(0)}%"></div>
                  <span>${f.h2.toFixed(0)}h</span>
                </div>
              </td>
              <td>${f.diffHtml}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  // Opciones para comparar (excluye el período seleccionado)
  const compOpts = [`<option value="none">Sin comparación</option>`,
    ...periodos.filter(p => p !== selPeriodo).map(p => {
      const [y, m] = p.split('||');
      return `<option value="${p}" ${p === selComp ? 'selected' : ''}>${m} ${y}</option>`;
    })].join('');

  container.innerHTML = `
    <div class="rep-filtros-panel">
      <div class="rep-filtro-grupo">
        <label class="emp-filtro-label">Período</label>
        <select class="emp-filtro-select" id="repFiltPeriodo" onchange="renderReportes(state.datos)">
          ${periodoOpts}
        </select>
      </div>
      <div class="rep-filtro-grupo">
        <label class="emp-filtro-label">Comparar con</label>
        <select class="emp-filtro-select" id="repFiltComp" onchange="renderReportes(state.datos)">
          ${compOpts}
        </select>
      </div>
      <div class="rep-filtro-grupo">
        <label class="emp-filtro-label">Sucursal</label>
        <select class="emp-filtro-select" id="repFiltLocal" onchange="renderReportes(state.datos)">
          ${localOpts}
        </select>
      </div>
      <div class="rep-stat-resumen">
        <span class="rep-stat-item"><strong>${listaEmps.length}</strong> empleados</span>
        <span class="rep-stat-sep">·</span>
        <span class="rep-stat-item"><strong>${datosFilt.reduce((a,r)=>a+(parseFloat(r.TOTAL_HS)||0),0).toFixed(0)}</strong> hs totales</span>
        <span class="rep-stat-sep">·</span>
        <span class="rep-stat-item">Promedio <strong>${promH.toFixed(1)}</strong> hs/emp</span>
      </div>
    </div>

    <div class="reportes-grid">
      <div class="reporte-card">
        <h3>Horas por empleado <span class="rep-periodo-tag">${periodoLabel}</span></h3>
        <div class="reporte-scroll">${htmlEmps}</div>
      </div>
      <div class="reporte-card">
        <h3>Cobertura por sucursal <span class="rep-periodo-tag">${periodoLabel}</span></h3>
        ${htmlSuc}
      </div>
      ${htmlComparacion}
    </div>`;
}

// ── VISTA MES ──────────────────────────────────────────
function getMesActual(offset = 0) {
  const hoy = new Date();
  return new Date(hoy.getFullYear(), hoy.getMonth() + offset, 1);
}

function getMesLabel(offset = 0) {
  const d = getMesActual(offset);
  return `${MESES_ES[d.getMonth()]} ${d.getFullYear()}`;
}

function getDatosMes(datos, offset = 0) {
  const d   = getMesActual(offset);
  const mes = MESES_ES[d.getMonth()];
  const anio = String(d.getFullYear());
  return datos.filter(r => r.MES === mes && String(r.AÑO) === anio);
}

function renderCalendario(datos) {
  const offset  = state.mesOffset;
  const base    = getMesActual(offset);
  const mes     = base.getMonth();
  const anio    = base.getFullYear();
  const { sucursal } = getFilters();

  const diasEnMes  = new Date(anio, mes + 1, 0).getDate();
  const primerDow  = new Date(anio, mes, 1).getDay(); // 0=Dom
  const startCol   = primerDow === 0 ? 6 : primerDow - 1; // ajustar a Lun=0

  const datosMes = getDatosMes(datos, offset)
    .filter(r => sucursal === 'all' || r.LOCAL === sucursal);

  // Agrupar registros por día
  const porDia = {};
  datosMes.forEach(r => {
    const d = String(r.DIA);
    if (!porDia[d]) porDia[d] = [];
    porDia[d].push(r);
  });

  const hoy = new Date();
  const esEsteMes = hoy.getMonth() === mes && hoy.getFullYear() === anio;

  let html = `<div class="calendario-wrap">
    <div class="cal-header-dias">
      ${['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(d => `<div class="cal-dia-label">${d}</div>`).join('')}
    </div>
    <div class="cal-grid">`;

  // Celdas vacías al inicio
  for (let i = 0; i < startCol; i++) {
    html += `<div class="cal-celda cal-vacia"></div>`;
  }

  for (let d = 1; d <= diasEnMes; d++) {
    const registros = porDia[String(d)] || [];
    const emps      = new Set(registros.map(r => r.EMPLEADO)).size;
    const esHoy     = esEsteMes && hoy.getDate() === d;
    const dow       = new Date(anio, mes, d).getDay();
    const esFinde   = dow === 0 || dow === 6;
    const fechaObj  = new Date(anio, mes, d);
    const esFer     = esFeriado(fechaObj);

    // Aplicar filtros de día
    if (diaFiltrado(fechaObj)) {
      html += `<div class="cal-celda cal-vacia"></div>`;
      continue;
    }

    // Contar tipos de turno
    const tm   = registros.filter(r => clasificarTurno(r.H_ENTRADA, r.H_SALIDA) === 'TM').length;
    const tt   = registros.filter(r => clasificarTurno(r.H_ENTRADA, r.H_SALIDA) === 'TT').length;
    const comp = registros.filter(r => clasificarTurno(r.H_ENTRADA, r.H_SALIDA) === 'COMP').length;

    const diaKey = `${anio}-${mes}-${d}`;
    html += `<div class="cal-celda ${esHoy ? 'cal-hoy' : ''} ${esFinde ? 'cal-finde' : ''} ${esFer ? 'cal-feriado' : ''} ${registros.length ? 'cal-celda-click' : ''}"
      ${registros.length ? `onclick="abrirDetalleDia(${d}, ${mes}, ${anio})"` : ''}>
      <div class="cal-num">${d}${esFer ? '<span class="cal-feriado-tag">F</span>' : ''}</div>
      ${registros.length ? `
        <div class="cal-emps">${emps} emp.</div>
        <div class="cal-pills-mini">
          ${tm   ? `<span class="pill-mini pill-mini-tm">M:${tm}</span>` : ''}
          ${tt   ? `<span class="pill-mini pill-mini-tt">T:${tt}</span>` : ''}
          ${comp ? `<span class="pill-mini pill-mini-comp">C:${comp}</span>` : ''}
        </div>
      ` : `<div class="cal-sin-datos"></div>`}
    </div>`;
  }

  html += `</div></div>`;
  document.getElementById('calendarioContainer').innerHTML = html;
}

function renderResumenMes(datos) {
  const offset   = state.mesOffset;
  const { sucursal, empleado } = getFilters();
  const datosMes = getDatosMes(datos, offset)
    .filter(r => sucursal === 'all' || r.LOCAL === sucursal)
    .filter(r => empleado === 'all' || r.EMPLEADO === empleado);

  // Agrupar por empleado
  const empMap = {};
  datosMes.forEach(r => {
    const key = `${r.EMPLEADO}||${r.LOCAL}`;
    if (!empMap[key]) empMap[key] = { nombre: r.EMPLEADO, local: r.LOCAL, horas: 0, dias: new Set(), hsExtra: 0, sabados: new Set(), feriados: new Set(), hsPorDia: {} };
    const hs = parseFloat(r.TOTAL_HS) || 0;
    empMap[key].horas += hs;
    const diaKey = r.AÑO + '-' + r.MES + '-' + r.DIA;
    empMap[key].dias.add(diaKey);
    empMap[key].hsPorDia[diaKey] = (empMap[key].hsPorDia[diaKey] || 0) + hs;
    const dow = new Date(r.AÑO, MESES_ES.indexOf(r.MES), parseInt(r.DIA)).getDay();
    if (dow === 6) empMap[key].sabados.add(diaKey);
    const fechaObj = new Date(r.AÑO, MESES_ES.indexOf(r.MES), parseInt(r.DIA));
    if (esFeriado(fechaObj)) empMap[key].feriados.add(diaKey);
  });

  // Calcular hsExtra por día usando categoría del empleado
  Object.values(empMap).forEach(e => {
    e.hsExtra = Object.entries(e.hsPorDia).reduce((acc, [diaKey, hsDia]) => {
      const [anio, mes, dia] = diaKey.split('-');
      const fecha = new Date(parseInt(anio), MESES_ES.indexOf(mes), parseInt(dia));
      return acc + calcularHsExtra(e.nombre, hsDia, fecha);
    }, 0);
  });

  const lista = Object.values(empMap).sort((a, b) => b.horas - a.horas);

  if (!lista.length) {
    document.getElementById('resumenMesContainer').innerHTML =
      '<p style="padding:2rem;color:#999;font-size:14px">No hay datos para este mes.</p>';
    return;
  }

  const suc = (id) => SUCURSALES.find(s => s.id === id) || { color: '#888', colorLight: '#eee', nombre: id };

  let html = `<div class="resumen-mes-wrap">
    <h3 class="resumen-mes-titulo">Resumen del mes — ${getMesLabel(offset)}</h3>
    <div class="resumen-mes-tabla-wrap">
    <table class="resumen-mes-tabla">
      <thead>
        <tr>
          <th>Empleado</th>
          <th>Sucursal</th>
          <th>Días</th>
          <th>Horas</th>
          <th>Hs extra</th>
          <th>Sábados</th>
          <th>Feriados</th>
        </tr>
      </thead>
      <tbody>`;

  lista.forEach(e => {
    const s = suc(e.local);
    const numMatch2 = e.nombre.match(/^(\d+)\s+(.+)$/);
    const nomLabel = numMatch2 ? `<span style="color:#94a3b8;font-size:11px;margin-right:4px">#${numMatch2[1]}</span>${numMatch2[2]}` : e.nombre;
    html += `<tr onclick="abrirDetalleEmpleadoPeriodo('${e.nombre.replace(/'/g,"\\'")}', 'mes')" style="cursor:pointer">
      <td class="td-emp td-emp-link">${nomLabel}</td>
      <td><span class="suc-badge-mini" style="background:${s.colorLight};color:${s.color}">${s.nombre}</span></td>
      <td>${e.dias.size}</td>
      <td><strong>${e.horas.toFixed(1)}</strong></td>
      <td>${e.hsExtra > 0 ? `<span class="hs-extra">${e.hsExtra.toFixed(1)}</span>` : '—'}</td>
      <td>${e.sabados.size || '—'}</td>
      <td>${e.feriados.size ? `<span class="tag-feriado">${e.feriados.size}</span>` : '—'}</td>
    </tr>`;
  });

  const totalHoras = lista.reduce((a, e) => a + e.horas, 0);
  html += `</tbody>
      <tfoot>
        <tr>
          <td colspan="3"><strong>TOTAL</strong></td>
          <td><strong>${totalHoras.toFixed(1)}</strong></td>
          <td colspan="3"></td>
        </tr>
      </tfoot>
    </table></div></div>`;

  document.getElementById('resumenMesContainer').innerHTML = html;
}


function renderAll() {
  // Si hay sesión de empleado activa, no renderizar la vista admin
  if (sesionActual && sesionActual.rol === 'empleado') return;

  const datos = state.datos.length ? state.datos : [];
  const wrEl = document.getElementById('weekRange');
  const mrEl = document.getElementById('mesRange');
  if (wrEl) wrEl.textContent = getWeekRange(state.semanaOffset);
  if (mrEl) mrEl.textContent = getMesLabel(state.mesOffset);
  renderStats(datos);
  renderGrilla(datos);
  renderCalendario(datos);
  renderResumenMes(datos);
  renderEmpleados(datos);
  poblarFiltroEmpleados(datos);
}

function poblarFiltroEmpleados(datos) {
  const sel = document.getElementById('filterEmp');
  const actual = sel.value;
  const emps = [...new Set(datos.map(r => r.EMPLEADO))].sort();
  sel.innerHTML = '<option value="all">Todos los empleados</option>' +
    emps.map(e => `<option value="${e}" ${e === actual ? 'selected' : ''}>${e}</option>`).join('');
}

// ── CARGA DE PERFILES DE EMPLEADOS ────────────────────
async function cargarPerfiles() {
  const urls = getSavedUrls();
  const url  = urls['unica'] || APPS_SCRIPT_URL;
  if (!url) return;

  try {
    const resp = await fetch(`${url}?accion=perfiles`);
    if (!resp.ok) return;
    const json = await resp.json();
    if (!json.ok) return;

    if (json.categorias?.length) CATEGORIAS_CONFIG = json.categorias;
    if (json.empleados?.length) {
      EMPLEADOS_PERFILES = {};
      json.empleados.forEach(e => { EMPLEADOS_PERFILES[e.nombre] = e; });
    }
  } catch(err) {
    console.warn('No se pudieron cargar perfiles:', err);
  }
}

async function guardarPerfil(perfil) {
  const url = getSavedUrls()['unica'] || APPS_SCRIPT_URL;
  try {
    const datos = encodeURIComponent(JSON.stringify(perfil));
    const resp = await fetch(`${url}?accion=guardar_perfil&datos=${datos}`);
    const json = await resp.json();
    if (json.ok) {
      EMPLEADOS_PERFILES[perfil.nombre] = perfil;
      showToast('✓ Perfil guardado');
      renderAll();
    } else {
      showToast('Error al guardar: ' + (json.error || 'desconocido'));
    }
  } catch(e) {
    showToast('Error de conexión al guardar');
  }
}

async function guardarCategoria(cat) {
  const url = getSavedUrls()['unica'] || APPS_SCRIPT_URL;
  try {
    const datos = encodeURIComponent(JSON.stringify(cat));
    const resp = await fetch(`${url}?accion=guardar_categoria&datos=${datos}`);
    const json = await resp.json();
    if (json.ok) {
      const idx = CATEGORIAS_CONFIG.findIndex(c => c.id === cat.id);
      if (idx >= 0) CATEGORIAS_CONFIG[idx] = cat;
      else CATEGORIAS_CONFIG.push(cat);
      showToast('✓ Categoría guardada');
      renderAdmin();
    } else {
      showToast('Error al guardar categoría');
    }
  } catch(e) {
    showToast('Error de conexión');
  }
}
// Una sola URL sirve para todas las hojas usando ?hoja=NOMBRE
async function fetchSucursal(url, suc) {
  try {
    const resp = await fetch(`${url}?hoja=${suc.hoja}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    return (json.data || []).map(r => ({ ...r, LOCAL: r.LOCAL || suc.id }));
  } catch (e) {
    console.warn(`Error cargando hoja ${suc.hoja}:`, e);
    return [];
  }
}

async function cargarDatos(urls) {
  state.cargando = true;
  showToast('Cargando datos...');

  // Cargar perfiles, usuarios y certificados en paralelo
  cargarPerfiles();
  cargarUsuarios();
  cargarCertificados();

  const urlUnica = urls['unica'] || null;
  if (!urlUnica) {
    showToast('Falta la URL del Apps Script');
    state.cargando = false;
    return;
  }

  try {
    const resp = await fetch(`${urlUnica}?accion=horarios`);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const json = await resp.json();
    // Compatible con formato nuevo (ok:true) y viejo (sin ok)
    if (json.ok === false) throw new Error(json.error || 'Error en servidor');

    const rawData = json.data || [];
    if (!rawData.length) throw new Error('Sin datos');

    // Mapa de nombre de hoja → ID de sucursal
    const NOMBRE_A_ID = {
      'PASEO': '01', 'WAVE': '05', 'CIPO': '09', 'CIPO SAN MARTIN': '09',
      'PERITO': '10', 'PERITO MORENO': '10', 'CENTE': '12', 'CENTENARIO': '12',
      'ROCA180': '14', 'ROCA': '14', 'DEPO': 'DEPO', 'OFICINA': 'OFICINA',
    };

    // Normalizar: el formato nuevo usa minúsculas, el viejo usa mayúsculas
    // El resto del app espera mayúsculas, así que normalizamos a mayúsculas
    state.datos = rawData.map(r => {
      const localRaw = String(r.LOCAL || r.local || r.HOJA || '').trim().toUpperCase();
      const localId  = NOMBRE_A_ID[localRaw] || localRaw;
      return {
        LOCAL:    localId,
        AÑO:      String(r.AÑO     || r.anio     || ''),
        MES:      String(r.MES     || r.mes       || '').trim().toUpperCase(),
        DIA:      String(r.DIA     || r.dia       || '0'),
        EMPLEADO: String(r.EMPLEADO|| r.empleado  || '').trim(),
        H_ENTRADA:String(r.H_ENTRADA|| r.entrada  || ''),
        H_SALIDA: String(r.H_SALIDA || r.salida   || ''),
        NOTA:     String(r.NOTA    || r.nota      || '').trim(),
        TOTAL_HS: parseFloat(r.TOTAL_HS || r.total) || 0,
        MARCA_TEMPORAL: r.MARCA_TEMPORAL || r.marca || '',
      };
    });
    state.cargando = false;

    showToast(`✓ ${state.datos.length} registros cargados`);
    setConnected(true);
    showApp();
    renderAll();
    iniciarAutoRefresh();

  } catch (err) {
    state.cargando = false;
    setConnected(false);
    showToast('Error al cargar: ' + err.message);
    console.error('cargarDatos error:', err);
  }
}

// ── SETUP SCREEN ───────────────────────────────────────
function buildUrlForm() {
  const saved = getSavedUrls();
  const container = document.getElementById('urlForm');
  container.innerHTML = `
    <div class="url-row">
      <div class="url-badge" style="background:#F1F5F9;color:#475569">
        <div class="dot" style="background:#475569"></div>
        URL única (todas las sucursales)
      </div>
      <input type="url" class="url-input" id="url_unica"
        placeholder="https://script.google.com/macros/s/.../exec"
        value="${saved['unica'] || ''}" />
    </div>
    <p style="font-size:12px;color:#94a3b8;margin:0.5rem 0 1rem 0">
      Un solo Apps Script conecta PASEO, WAVE, CIPO, PERITO, CENTE, ROCA180, DEPO y OFICINA.
    </p>
  `;
}

function getSavedUrls() {
  try { return JSON.parse(localStorage.getItem(LS_URLS_KEY)) || {}; } catch { return {}; }
}

function saveUrls(urls) {
  localStorage.setItem(LS_URLS_KEY, JSON.stringify(urls));
}

function getUrlsFromForm() {
  const val = document.getElementById('url_unica')?.value.trim();
  return val ? { unica: val } : {};
}

// ── UI HELPERS ─────────────────────────────────────────
function showApp() {
  document.getElementById('setupScreen').style.display = 'none';
  document.getElementById('mainApp').style.display    = 'block';
}

function showSetup() {
  document.getElementById('setupScreen').style.display = 'flex';
  document.getElementById('mainApp').style.display    = 'none';
}

function setConnected(ok) {
  const hora = new Date().toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' });
  const label = ok ? `Conectado · ${hora}` : 'Sin conexión';

  const el = document.getElementById('connStatus');
  el.classList.toggle('connected', ok);
  el.querySelector('.status-label').textContent = label;

  // También en drawer
  const drawerConn = document.getElementById('drawerConnStatus');
  if (drawerConn) {
    drawerConn.classList.toggle('connected', ok);
    drawerConn.querySelector('.status-label').textContent = label;
  }
}

function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

function setView(view) {
  state.tabActual = view;
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
  document.getElementById(`view${capitalize(view)}`)?.classList.add('active');
  document.querySelector(`[data-view="${view}"]`)?.classList.add('active');

  localStorage.setItem('croma_vista', view);

  // Sincronizar drawer: marcar activo
  document.querySelectorAll('.drawer-nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  const weekNav  = document.querySelector('.week-nav:not(.mes-nav)');
  const mesNav   = document.getElementById('mesNav');
  const statsRow = document.querySelector('.stats-row');
  const filters  = document.querySelector('.filters');

  if (view === 'semana') {
    weekNav.style.display  = 'flex';
    mesNav.style.display   = 'none';
    statsRow.style.display = 'none';   // ← ocultar stats en Semana
    filters.style.display  = 'flex';
    document.getElementById('filterTurno').style.display = 'block';
    mostrarFiltrosDiaEnBarra(true);
  } else if (view === 'mes') {
    weekNav.style.display  = 'none';
    mesNav.style.display   = 'flex';
    statsRow.style.display = 'none';
    filters.style.display  = 'flex';
    document.getElementById('filterTurno').style.display = 'none';
    mostrarFiltrosDiaEnBarra(true);
  } else if (view === 'empleados') {
    weekNav.style.display  = 'none';
    mesNav.style.display   = 'none';
    statsRow.style.display = 'none';
    filters.style.display  = 'none';
    mostrarFiltrosDiaEnBarra(false);  // empleados tiene sus propios checkboxes
  } else if (view === 'administracion') {
    weekNav.style.display  = 'none';
    mesNav.style.display   = 'none';
    statsRow.style.display = 'none';
    filters.style.display  = 'none';
    mostrarFiltrosDiaEnBarra(false);
    renderAdminInline();
  } else if (view === 'vacaciones') {
    weekNav.style.display  = 'none';
    mesNav.style.display   = 'none';
    statsRow.style.display = 'none';
    filters.style.display  = 'none';
    mostrarFiltrosDiaEnBarra(false);
    renderVacacionesView();
  } else {
    weekNav.style.display  = 'none';
    mesNav.style.display   = 'none';
    statsRow.style.display = 'none';
    filters.style.display  = 'none';
    mostrarFiltrosDiaEnBarra(false);
  }
}

function mostrarFiltrosDiaEnBarra(visible) {
  let barra = document.getElementById('filtrosDiaBarra');
  if (!visible) {
    if (barra) barra.style.display = 'none';
    return;
  }
  if (!barra) {
    // Crear el bloque y anexarlo a controls-bar
    barra = document.createElement('div');
    barra.id = 'filtrosDiaBarra';
    barra.className = 'filtros-dia';
    barra.innerHTML = `
      <span class="filtro-dia-label">Ver solo:</span>
      <label class="filtro-dia-check">
        <input type="checkbox" id="chkFerBarra" onchange="toggleFiltroDia('feriados',this.checked)" />
        <span>Feriados</span>
      </label>
      <label class="filtro-dia-check">
        <input type="checkbox" id="chkSabBarra" onchange="toggleFiltroDia('sabados',this.checked)" />
        <span>Sábados</span>
      </label>
      <label class="filtro-dia-check">
        <input type="checkbox" id="chkDomBarra" onchange="toggleFiltroDia('domingos',this.checked)" />
        <span>Domingos</span>
      </label>
      <label class="filtro-dia-check">
        <input type="checkbox" id="chkLabBarra" onchange="toggleFiltroDia('laborales',this.checked)" />
        <span>Solo laborales</span>
      </label>`;
    document.querySelector('.controls-bar').appendChild(barra);
  }
  barra.style.display = 'flex';
  // Sincronizar estado visual
  const chkFer = barra.querySelector('#chkFerBarra');
  const chkSab = barra.querySelector('#chkSabBarra');
  const chkDom = barra.querySelector('#chkDomBarra');
  if (chkFer) chkFer.checked = filtrosDia.verSolo === 'feriados';
  if (chkSab) chkSab.checked = filtrosDia.verSolo === 'sabados';
  if (chkDom) chkDom.checked = filtrosDia.verSolo === 'domingos';
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// Estado filtros y orden del detalle
let detalleFiltro = 'todos'; // 'todos' | 'feriados' | 'sabados' | 'domingos' | 'laborales'
let detalleOrdenAsc = true; // true = más viejo primero

function toggleDetalleFiltro(tipo, activo) {
  detalleFiltro = activo ? tipo : 'todos';
  ['dchkFer','dchkSab','dchkDom','dchkLab','dchkCert'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = false;
  });
  if (activo) {
    const mapa = { feriados:'dchkFer', sabados:'dchkSab', domingos:'dchkDom', laborales:'dchkLab', certificados:'dchkCert' };
    const el = document.getElementById(mapa[tipo]);
    if (el) el.checked = true;
  }
  actualizarTablaDetalle();
}

function toggleOrdenDetalle() {
  detalleOrdenAsc = !detalleOrdenAsc;
  const icon = document.getElementById('detalleOrdenIcon');
  if (icon) icon.textContent = detalleOrdenAsc ? '↑' : '↓';
  actualizarTablaDetalle();
}

function actualizarTablaDetalle() {
  const tbody = document.getElementById('detalleTbody');
  if (!tbody) return;
  const rows = Array.from(tbody.querySelectorAll('tr[data-fecha]'));

  // 1. Determinar visibilidad de cada fila
  rows.forEach(tr => {
    const [y, m, d] = tr.dataset.fecha.split('-').map(Number);
    const fecha = new Date(y, m - 1, d);
    const esCert = tr.classList.contains('fila-certificado');
    let visible = true;
    if (detalleFiltro === 'feriados')    visible = esFeriado(fecha);
    if (detalleFiltro === 'sabados')     visible = fecha.getDay() === 6;
    if (detalleFiltro === 'domingos')    visible = fecha.getDay() === 0;
    if (detalleFiltro === 'laborales')   visible = fecha.getDay() !== 0 && fecha.getDay() !== 6 && !esFeriado(fecha);
    if (detalleFiltro === 'certificados') visible = esCert;
    tr.style.display = visible ? '' : 'none';
  });

  // 2. Ordenar: remover todas las filas y reinsertarlas en el orden correcto
  const visibles = rows
    .filter(tr => tr.style.display !== 'none')
    .sort((a, b) => {
      const [ya,ma,da] = a.dataset.fecha.split('-').map(Number);
      const [yb,mb,db] = b.dataset.fecha.split('-').map(Number);
      const fa = new Date(ya, ma-1, da), fb = new Date(yb, mb-1, db);
      return detalleOrdenAsc ? fa - fb : fb - fa;
    });
  const ocultas = rows.filter(tr => tr.style.display === 'none');

  // Limpiar tbody y reinsertar: primero visibles ordenadas, luego ocultas al final
  visibles.forEach(tr => tbody.appendChild(tr));
  ocultas.forEach(tr => tbody.appendChild(tr));

  // 3. Recalcular stats desde data attributes
  let dias = 0, hs = 0, extra = 0, sabs = 0, certs = 0;
  visibles.forEach(tr => {
    dias++;
    hs    += parseFloat(tr.dataset.hs)    || 0;
    extra += parseFloat(tr.dataset.extra) || 0;
    sabs  += parseInt(tr.dataset.sab)     || 0;
    certs += parseInt(tr.dataset.cert)    || 0;
  });

  const elDias  = document.getElementById('detalleStatDias');
  const elHs    = document.getElementById('detalleStatHs');
  const elExtra = document.getElementById('detalleStatExtra');
  const elSabs  = document.getElementById('detalleStatSabs');
  const elCerts = document.getElementById('detalleStatCerts');
  if (elDias)  elDias.textContent  = dias;
  if (elHs)    elHs.textContent    = hs.toFixed(1);
  if (elExtra) elExtra.textContent = extra.toFixed(1);
  if (elSabs)  elSabs.textContent  = sabs;
  if (elCerts) elCerts.textContent = certs;

  const tfoot = document.getElementById('detalleTfoot');
  if (tfoot) {
    tfoot.innerHTML = `<tr>
      <td colspan="2"><strong>TOTALES</strong></td>
      <td>${dias}</td><td colspan="2"></td>
      <td><strong>${hs.toFixed(1)}</strong></td>
      <td>${extra > 0 ? `<span class="hs-extra">${extra.toFixed(1)}</span>` : '—'}</td>
      <td>${sabs}</td><td colspan="2"></td>
    </tr>`;
  }
}

function toggleFiltroDia(tipo, activo) {
  filtrosDia.verSolo = activo ? tipo : 'todos';

  const mapa = {
    feriados:  ['chkFeriados','chkFerBarra'],
    sabados:   ['chkSabados','chkSabBarra'],
    domingos:  ['chkDomingos','chkDomBarra'],
    laborales: ['chkLaborales','chkLabBarra'],
  };
  Object.entries(mapa).forEach(([t, ids]) => {
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = (filtrosDia.verSolo === t);
    });
  });

  renderAll();
}

// Devuelve true si el día NO debe mostrarse según el filtro activo
function diaFiltrado(date) {
  if (filtrosDia.verSolo === 'todos') return false;
  if (filtrosDia.verSolo === 'feriados')  return !esFeriado(date);
  if (filtrosDia.verSolo === 'sabados')   return date.getDay() !== 6;
  if (filtrosDia.verSolo === 'domingos')  return date.getDay() !== 0;
  if (filtrosDia.verSolo === 'laborales') return date.getDay() === 0 || date.getDay() === 6 || esFeriado(date);
  return false;
}


// ── SISTEMA DE USUARIOS ────────────────────────────────
// Los usuarios se guardan en el Sheet (hoja USUARIOS), NO en localStorage.
// Cache en memoria para la sesión actual.
let _usuariosCache = null;      // null = no cargado todavía
let _usuariosCargando = false;

// Usuario de sesión activa: { nombre, rol, empleadoNombre }
// rol: 'admin' | 'empleado'
let sesionActual = null;

// ── Cargar usuarios desde el Sheet ──
async function cargarUsuarios() {
  try {
    const resp = await fetch(`${APPS_SCRIPT_URL}?accion=cargar_usuarios`);
    if (!resp.ok) return [];
    const json = await resp.json();
    if (!json.ok) return [];
    _usuariosCache = json.usuarios || [];
    return _usuariosCache;
  } catch(e) {
    console.warn('No se pudieron cargar usuarios:', e);
    return [];
  }
}

// Devuelve cache (o array vacío si aún no cargó)
function getUsuarios() {
  return _usuariosCache || [];
}

// Guarda la lista completa en el Sheet
async function saveUsuarios(lista) {
  _usuariosCache = lista;
  // Pasar datos como parámetro en la URL (Apps Script no acepta POST cross-origin)
  try {
    const datos = encodeURIComponent(JSON.stringify(lista));
    await fetch(`${APPS_SCRIPT_URL}?accion=guardar_usuarios&datos=${datos}`);
  } catch(e) {
    console.warn('Error guardando usuarios:', e);
  }
}

// ── CERTIFICADOS ──────────────────────────────────────
async function cargarCertificados() {
  try {
    const resp = await fetch(`${APPS_SCRIPT_URL}?accion=cargar_certificados`);
    const json = await resp.json();
    if (json.ok) {
      CERTIFICADOS_CACHE = (json.certificados || []).map(c => {
        // La fecha puede venir como Date object o string — normalizar a "YYYY-MM-DD"
        let fecha = c.fecha;
        if (fecha instanceof Date || (typeof fecha === 'object' && fecha !== null)) {
          const d = new Date(fecha);
          fecha = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        } else if (typeof fecha === 'string' && fecha.includes('/')) {
          // formato DD/MM/YYYY
          const [dd,mm,yyyy] = fecha.split('/');
          fecha = `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
        } else {
          // ya es string YYYY-MM-DD, limpiar
          fecha = String(fecha).substring(0,10);
        }
        return { ...c, fecha };
      });
    }
    return CERTIFICADOS_CACHE;
  } catch(e) {
    console.warn('Error cargando certificados:', e);
    return [];
  }
}

function getCertificadosDe(nombreEmp) {
  // Normalizar: quitar número del principio y colapsar espacios múltiples
  const normalizar = n => n.trim().toLowerCase().replace(/^\d+\s+/, '').replace(/\s+/g, ' ');
  const empNorm = normalizar(nombreEmp);
  return CERTIFICADOS_CACHE.filter(c => normalizar(c.empleado) === empNorm);
}

async function guardarCertificado(cert) {
  try {
    const datos = encodeURIComponent(JSON.stringify(cert));
    const resp  = await fetch(`${APPS_SCRIPT_URL}?accion=guardar_certificado&datos=${datos}`);
    const json  = await resp.json();
    if (json.ok) {
      CERTIFICADOS_CACHE.push({ ...cert, id: json.id });
      return { ok: true, id: json.id };
    }
    return { ok: false };
  } catch(e) { return { ok: false }; }
}

async function borrarCertificado(id) {
  try {
    const resp = await fetch(`${APPS_SCRIPT_URL}?accion=borrar_certificado&id=${encodeURIComponent(id)}`);
    const json = await resp.json();
    if (json.ok) CERTIFICADOS_CACHE = CERTIFICADOS_CACHE.filter(c => c.id !== id);
    return json.ok;
  } catch(e) { return false; }
}

function abrirFormCertificado(nombreEmp) {
  const perfil = EMPLEADOS_PERFILES[nombreEmp] || {};
  const cat    = CATEGORIAS_CONFIG.find(c => c.id === perfil.categoria_id);
  // Determinar horas por defecto según categoría
  const hsPorDefecto = cat?.regla === 'fijo4' ? 4 : 8;

  const tiposOpts = TIPOS_CERTIFICADO.map(t =>
    `<option value="${t}">${t}</option>`
  ).join('');

  const nomMatch  = nombreEmp.match(/^(\d+)\s+(.+)$/);
  const nomMostrar = nomMatch ? nomMatch[2] : nombreEmp;

  const html = `
  <div class="admin-overlay" id="adminOverlay" onclick="cerrarAdmin(event)">
    <div class="admin-panel admin-panel-sm" onclick="event.stopPropagation()">
      <div class="admin-header">
        <div class="admin-titulo">Agregar certificado — ${nomMostrar}</div>
        <button class="detalle-close" onclick="cerrarAdmin()">✕</button>
      </div>
      <div class="admin-form">
        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Fecha</label>
          <input type="date" class="admin-input" id="certFecha" />
        </div>
        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Tipo de certificado</label>
          <select class="admin-input" id="certTipo" onchange="onCertTipoChange()">
            ${tiposOpts}
          </select>
        </div>
        <div class="admin-form-grupo" id="certNotaGrupo" style="display:none">
          <label class="emp-filtro-label">Descripción</label>
          <input type="text" class="admin-input" id="certNotaPersonalizada" placeholder="Ej: Trámite migratorio" />
        </div>
        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Horas que cubre</label>
          <div style="display:flex;gap:10px">
            <label style="display:flex;align-items:center;gap:6px;font-size:14px;cursor:pointer">
              <input type="radio" name="certHs" value="4" ${hsPorDefecto===4?'checked':''} /> 4 horas (Media jornada)
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-size:14px;cursor:pointer">
              <input type="radio" name="certHs" value="8" ${hsPorDefecto===8?'checked':''} /> 8 horas (Jornada completa)
            </label>
          </div>
        </div>
        <p id="certError" style="color:#dc2626;font-size:12px;display:none;margin-bottom:0.5rem"></p>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:1rem">
          <button class="btn-connect" style="margin:0" onclick="confirmarCertificado('${nombreEmp.replace(/'/g,"\\'")}')">
            Guardar certificado
          </button>
          <button class="btn-demo" onclick="cerrarAdmin()">Cancelar</button>
        </div>
      </div>
    </div>
  </div>`;
  montarOverlayAdmin(html);

  // Fecha por defecto: hoy
  const hoy = new Date();
  document.getElementById('certFecha').value =
    `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-${String(hoy.getDate()).padStart(2,'0')}`;
}

function onCertTipoChange() {
  const tipo = document.getElementById('certTipo')?.value;
  const grupo = document.getElementById('certNotaGrupo');
  if (grupo) grupo.style.display = tipo === 'Personalizado' ? 'block' : 'none';
}

async function confirmarCertificado(nombreEmp) {
  const fecha = document.getElementById('certFecha')?.value;
  const tipo  = document.getElementById('certTipo')?.value;
  const hsEl  = document.querySelector('input[name="certHs"]:checked');
  const notaP = document.getElementById('certNotaPersonalizada')?.value.trim();
  const errEl = document.getElementById('certError');

  if (!fecha) { errEl.textContent = 'Seleccioná una fecha'; errEl.style.display='block'; return; }
  if (!hsEl)  { errEl.textContent = 'Seleccioná las horas'; errEl.style.display='block'; return; }
  if (tipo === 'Personalizado' && !notaP) {
    errEl.textContent = 'Escribí una descripción'; errEl.style.display='block'; return;
  }

  const hs   = parseFloat(hsEl.value);
  const nota = tipo === 'Personalizado' ? notaP : tipo;

  const btn = document.querySelector('#adminOverlay .btn-connect');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

  // Guardar nombre sin número (ej: "38 BRUNO ALONSO" → "BRUNO ALONSO")
  const empLimpio = nombreEmp.trim().replace(/^\d+\s+/, '');
  const resultado = await guardarCertificado({ empleado: empLimpio, fecha, tipo, hs, nota });

  if (resultado.ok) {
    cerrarAdmin();
    showToast('✓ Certificado guardado');
    // Reabrir la ficha del empleado para ver el certificado
    const suc = state.datos.find(r => r.EMPLEADO === nombreEmp);
    if (suc) abrirDetalleEmpleado(nombreEmp, suc.LOCAL);
  } else {
    if (btn) { btn.disabled = false; btn.textContent = 'Guardar certificado'; }
    errEl.textContent = 'Error al guardar'; errEl.style.display='block';
  }
}

async function eliminarCertificado(id, nombreEmp, mesAnio) {
  if (!confirm('¿Borrar este certificado?')) return;
  const ok = await borrarCertificado(id);
  if (ok) {
    showToast('✓ Certificado eliminado');
    const suc = state.datos.find(r => r.EMPLEADO === nombreEmp);
    if (suc) abrirDetalleEmpleado(nombreEmp, suc.LOCAL);
  } else {
    showToast('Error al eliminar');
  }
}

// ── Login: carga usuarios del Sheet y verifica ──
async function verificarCredencialesAsync(usuario, pin) {
  // Admin especial (hardcodeado, no necesita Sheet)
  if (usuario.trim().toUpperCase() === 'ADMINHORAS' && pin === ADMIN_PIN) {
    return { ok: true, usuario: { nombre: 'Admin', rol: 'admin', empleadoNombre: null } };
  }
  // Cargar desde Sheet si no está en cache
  const lista = _usuariosCache !== null ? _usuariosCache : await cargarUsuarios();
  const u = lista.find(u =>
    u.nombre.trim().toLowerCase() === usuario.trim().toLowerCase() && u.pin === pin
  );
  if (u) return { ok: true, usuario: u };
  return { ok: false };
}

// ── PANTALLA DE LOGIN ──────────────────────────────────
function mostrarLoginApp() {
  document.getElementById('setupScreen').style.display = 'none';
  document.getElementById('mainApp').style.display     = 'none';

  let loginEl = document.getElementById('loginScreen');
  if (!loginEl) {
    loginEl = document.createElement('div');
    loginEl.id = 'loginScreen';
    document.body.appendChild(loginEl);
  }

  loginEl.style.display = 'flex';
  loginEl.innerHTML = `
    <div class="login-card">
      <div class="login-logo">
        <img src="tridente_solo.png" alt="Croma" class="login-tridente" onerror="this.style.display='none'" />
        <span class="login-brand">CROMA</span>
      </div>
      <div class="login-subtitle">HORARIOS</div>

      <div class="login-form">
        <div class="login-grupo">
          <label class="login-label" for="loginUsuario">Usuario</label>
          <input type="text" id="loginUsuario" class="login-input"
            placeholder="Tu nombre de usuario"
            autocomplete="off" autocapitalize="off" spellcheck="false"
            onkeydown="if(event.key==='Enter')document.getElementById('loginPin').focus()" />
        </div>
        <div class="login-grupo">
          <label class="login-label" for="loginPin">PIN</label>
          <div class="login-pin-wrap">
            <input type="password" id="loginPin" class="login-input"
              placeholder="••••" maxlength="8" autocomplete="off"
              onkeydown="if(event.key==='Enter')intentarLogin()" />
            <button class="login-pin-toggle" type="button" onclick="togglePinVisibility()" title="Mostrar PIN">
              <svg id="iconEye" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
          </div>
        </div>

        <p id="loginError" style="color:#dc2626;font-size:12px;margin-bottom:0.5rem;display:none;text-align:center">
          Usuario o PIN incorrecto
        </p>

        <button class="btn-connect" onclick="intentarLogin()" style="margin-top:0.5rem">
          Ingresar
        </button>
      </div>

      <div class="login-footer">Croma · Panel de Horarios</div>
    </div>
  `;

  setTimeout(() => document.getElementById('loginUsuario')?.focus(), 100);
}

function togglePinVisibility() {
  const input = document.getElementById('loginPin');
  const icon  = document.getElementById('iconEye');
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    icon.innerHTML = `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`;
  } else {
    input.type = 'password';
    icon.innerHTML = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
  }
}

async function intentarLogin() {
  const usuario = document.getElementById('loginUsuario')?.value || '';
  const pin     = document.getElementById('loginPin')?.value     || '';
  const errEl   = document.getElementById('loginError');
  const btnEl   = document.querySelector('#loginScreen .btn-connect');

  // Deshabilitar botón mientras verifica
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Verificando...'; }
  errEl.style.display = 'none';

  const resultado = await verificarCredencialesAsync(usuario, pin);

  if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Ingresar'; }

  if (resultado.ok) {
    sesionActual = resultado.usuario;
    errEl.style.display = 'none';
    document.getElementById('loginScreen').style.display = 'none';
    // Iniciar la app según el rol
    iniciarAppConSesion();
  } else {
    errEl.style.display = 'block';
    document.getElementById('loginPin').value = '';
    document.getElementById('loginPin').focus();
  }
}

function cerrarSesion() {
  sesionActual = null;
  adminAutenticado = false;
  sessionStorage.removeItem('croma_admin_auth');
  mostrarLoginApp();
}

// ── INICIAR APP SEGÚN ROL ──────────────────────────────
function iniciarAppConSesion() {
  if (sesionActual.rol === 'admin') {
    adminAutenticado = true;
    sessionStorage.setItem('croma_admin_auth', '1');
    document.getElementById('navBtnAdmin').style.display       = '';
    document.getElementById('navBtnVacaciones').style.display  = '';
    document.getElementById('drawerNavAdmin').style.display    = '';
    document.getElementById('drawerNavVacaciones').style.display = '';
    document.getElementById('bellWrap').style.display       = 'flex';
    document.getElementById('bellWrapEmp').style.display    = 'none';
    document.querySelectorAll('.nav-btn').forEach(b => b.style.display = '');
    document.querySelectorAll('.drawer-nav-btn').forEach(b => b.style.display = '');
    actualizarIndicadorSesion();
    showApp();
    const vistaGuardada = localStorage.getItem('croma_vista') || 'empleados';
    setView(vistaGuardada);
    cargarDatos({ unica: APPS_SCRIPT_URL });
    setTimeout(actualizarBadgeCampana, 1500);
  } else {
    document.getElementById('btnRefresh').style.display     = 'none';
    document.getElementById('btnPrint').style.display       = 'none';
    document.querySelector('.top-nav').style.display        = 'none';
    document.querySelector('.top-search').style.display     = 'none';
    document.querySelector('.controls-bar').style.display   = 'none';
    document.querySelector('.hamburger-btn') && (document.querySelector('.hamburger-btn').style.display = 'none');
    document.getElementById('bellWrap').style.display       = 'none';
    document.getElementById('bellWrapEmp').style.display    = 'flex';
    document.getElementById('mainApp').innerHTML = '<div id="vistaEmpleadoContainer" style="padding:1rem"></div>';
    actualizarIndicadorSesion();
    showApp();
    cargarDatosEmpleado();
  }
}

function actualizarIndicadorSesion() {
  // Agregar/actualizar chip de sesión en la topbar
  let chip = document.getElementById('sesionChip');
  if (!chip) {
    chip = document.createElement('div');
    chip.id = 'sesionChip';
    chip.className = 'sesion-chip';
    // Insertar antes de top-actions
    const topActions = document.querySelector('.top-actions');
    topActions.parentNode.insertBefore(chip, topActions);
  }
  const esAdmin = sesionActual.rol === 'admin';
  chip.innerHTML = `
    <span class="sesion-nombre">${esAdmin ? '👤 Admin' : sesionActual.nombre}</span>
    <button class="sesion-logout" onclick="cerrarSesion()" title="Cerrar sesión">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
        <polyline points="16 17 21 12 16 7"/>
        <line x1="21" y1="12" x2="9" y2="12"/>
      </svg>
    </button>
  `;
}

// ── VISTA EMPLEADO LOGUEADO ────────────────────────────
async function cargarDatosEmpleado() {
  showToast('Cargando tu jornada...');
  cargarPerfiles();
  await cargarCertificados();

  try {
    const resp = await fetch(`${APPS_SCRIPT_URL}?accion=horarios`);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const json = await resp.json();
    if (json.ok === false) throw new Error(json.error || 'Error');

    const rawData = json.data || [];
    state.datos = rawData.map(r => {
      const NOMBRE_A_ID = {
        'PASEO': '01', 'WAVE': '05', 'CIPO': '09', 'CIPO SAN MARTIN': '09',
        'PERITO': '10', 'PERITO MORENO': '10', 'CENTE': '12', 'CENTENARIO': '12',
        'ROCA180': '14', 'ROCA': '14', 'DEPO': 'DEPO', 'OFICINA': 'OFICINA',
      };
      const localRaw = String(r.LOCAL || r.local || r.HOJA || '').trim().toUpperCase();
      return {
        LOCAL:    NOMBRE_A_ID[localRaw] || localRaw,
        AÑO:      String(r.AÑO     || r.anio     || ''),
        MES:      String(r.MES     || r.mes       || '').trim().toUpperCase(),
        DIA:      String(r.DIA     || r.dia       || '0'),
        EMPLEADO: String(r.EMPLEADO|| r.empleado  || '').trim(),
        H_ENTRADA:String(r.H_ENTRADA|| r.entrada  || ''),
        H_SALIDA: String(r.H_SALIDA || r.salida   || ''),
        NOTA:     String(r.NOTA    || r.nota      || '').trim(),
        TOTAL_HS: parseFloat(r.TOTAL_HS || r.total) || 0,
        MARCA_TEMPORAL: r.MARCA_TEMPORAL || r.marca || '',
      };
    });

    setConnected(true);
    mostrarVistaEmpleado();

  } catch(err) {
    setConnected(false);
    showToast('Error al cargar: ' + err.message);
    mostrarVistaEmpleadoError();
  }
}

function mostrarVistaEmpleado() {
  const nombreEmp = sesionActual.empleadoNombre;
  if (!nombreEmp) {
    showToast('Error: usuario sin empleado vinculado');
    return;
  }

  const misRegistros = state.datos.filter(r =>
    r.EMPLEADO.trim().toLowerCase() === nombreEmp.trim().toLowerCase()
  );

  if (!misRegistros.length) {
    mostrarVistaEmpleadoSinDatos(nombreEmp);
    return;
  }

  const sucConteo = {};
  misRegistros.forEach(r => { sucConteo[r.LOCAL] = (sucConteo[r.LOCAL]||0) + 1; });
  const sucId = Object.entries(sucConteo).sort((a,b)=>b[1]-a[1])[0][0];

  // El contenedor ya fue creado en iniciarAppConSesion
  const container = document.getElementById('vistaEmpleadoContainer');
  if (container) container.innerHTML = '';
  else {
    document.getElementById('mainApp').innerHTML = '<div id="vistaEmpleadoContainer" style="padding:1rem"></div>';
  }
  renderVistaEmpleado(nombreEmp, sucId, misRegistros);
}

function mostrarVistaEmpleadoSinDatos(nombreEmp) {
  const mainApp = document.getElementById('mainApp');
  mainApp.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:1rem">
      <div style="font-size:48px">📋</div>
      <h2 style="font-family:'Bebas Neue';font-size:24px;letter-spacing:2px">Sin registros</h2>
      <p style="color:#64748b;font-size:14px">No se encontraron registros para <strong>${nombreEmp}</strong>.</p>
      <p style="color:#94a3b8;font-size:12px">Verificá que el nombre de usuario coincida exactamente con el registro en el sistema.</p>
    </div>
  `;
}

function mostrarVistaEmpleadoError() {
  const mainApp = document.getElementById('mainApp');
  mainApp.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:1rem">
      <div style="font-size:48px">⚠️</div>
      <h2 style="font-family:'Bebas Neue';font-size:24px;letter-spacing:2px">Error de conexión</h2>
      <p style="color:#64748b;font-size:14px">No se pudo conectar con el servidor.</p>
      <button class="btn-connect" style="width:auto;padding:10px 24px" onclick="cargarDatosEmpleado()">Reintentar</button>
    </div>
  `;
}

function renderVistaEmpleado(nombreEmp, sucId, misRegistros) {
  const suc = SUCURSALES.find(s => s.id === sucId) || { color: '#888', colorLight: '#eee', nombre: sucId };
  const perfil = EMPLEADOS_PERFILES[nombreEmp] || {};
  const cat = CATEGORIAS_CONFIG.find(c => c.id === perfil.categoria_id);

  const numMatch   = nombreEmp.match(/^(\d+)\s+(.+)$/);
  const numVend    = numMatch ? numMatch[1] : '';
  const nomMostrar = numMatch ? numMatch[2] : nombreEmp;
  const iniciales  = nomMostrar.split(' ').slice(0,2).map(p=>p[0]?.toUpperCase()).join('');

  // Períodos disponibles
  const ORDEN_MESES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
                       'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
  const periodosSet = new Set();
  misRegistros.forEach(r => periodosSet.add(r.MES + ' ' + r.AÑO));
  const periodos = Array.from(periodosSet).sort((a, b) => {
    const [mA, aA] = a.split(' '), [mB, aB] = b.split(' ');
    if (aA !== aB) return parseInt(aA) - parseInt(aB);
    return ORDEN_MESES.indexOf(mA) - ORDEN_MESES.indexOf(mB);
  });

  const periodoActual = periodos[periodos.length - 1] || 'TODOS';

  // Calcular totales para el período seleccionado
  function calcTotales(periodo) {
    const regs = periodo === 'TODOS'
      ? misRegistros
      : misRegistros.filter(r => r.MES + ' ' + r.AÑO === periodo);

    const porFecha = {};
    regs.forEach(r => {
      const key = `${r.AÑO}-${r.MES}-${r.DIA}`;
      if (!porFecha[key]) porFecha[key] = [];
      porFecha[key].push(r);
    });

    const DIAS_SEMANA = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
    const filas = Object.entries(porFecha).map(([key, rrs]) => {
      rrs.sort((a,b) => (a.H_ENTRADA||'').localeCompare(b.H_ENTRADA||''));
      const r0 = rrs[0];
      const fecha = new Date(r0.AÑO, MESES_ES.indexOf(r0.MES), parseInt(r0.DIA));
      const fechaStr = fecha.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'});
      const diaSem = DIAS_SEMANA[fecha.getDay()];
      const esSab  = fecha.getDay() === 6;
      const esDom  = fecha.getDay() === 0;
      const esFer  = esFeriado(fecha);
      const turno1 = r0.H_ENTRADA && r0.H_SALIDA ? `${r0.H_ENTRADA} – ${r0.H_SALIDA}` : '—';
      const turno2 = rrs[1]?.H_ENTRADA ? `${rrs[1].H_ENTRADA} – ${rrs[1].H_SALIDA}` : '';
      const hsTotal = rrs.reduce((a,r)=>a+(parseFloat(r.TOTAL_HS)||0),0);
      const hsExtra = calcularHsExtra(nombreEmp, hsTotal, fecha);
      const nota    = rrs.map(r=>r.NOTA).filter(Boolean).join(' / ');
      let horaReg = '';
      try { if (r0.MARCA_TEMPORAL) horaReg = new Date(r0.MARCA_TEMPORAL).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}); } catch(e){}
      return { fechaStr, diaSem, turno1, turno2, hsTotal, hsExtra, esSab, esDom, esFer, nota, horaReg };
    }).sort((a,b) => {
      // ordenar más viejo primero
      const da = a.fechaStr.split('/').reverse().join('-');
      const db = b.fechaStr.split('/').reverse().join('-');
      return da.localeCompare(db);
    });

    // Agregar certificados del empleado
    const certs = getCertificadosDe(nombreEmp);
    certs.forEach(c => {
      if (periodo !== 'TODOS') {
        const [cy,cm,cd] = c.fecha.split('-').map(Number);
        const fechaCert = new Date(cy, cm-1, cd);
        const mesAnio = MESES_ES[fechaCert.getMonth()] + ' ' + fechaCert.getFullYear();
        if (mesAnio !== periodo) return;
      }
      const [cy,cm,cd] = c.fecha.split('-').map(Number);
      const fechaCert = new Date(cy, cm-1, cd);
      filas.push({
        fechaStr: fechaCert.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'}),
        diaSem:   ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][fechaCert.getDay()],
        turno1:   'CERTIFICADO', turno2: '',
        hsTotal:  c.hs, hsExtra: 0,
        esSab:    fechaCert.getDay() === 6,
        esDom:    fechaCert.getDay() === 0,
        esFer:    esFeriado(fechaCert),
        nota:     c.nota || c.tipo,
        horaReg:  '—', esCert: true, fechaISO: c.fecha,
      });
    });
    filas.sort((a,b) => {
      const da = a.fechaISO || a.fechaStr.split('/').reverse().join('-');
      const db = b.fechaISO || b.fechaStr.split('/').reverse().join('-');
      return da.localeCompare(db);
    });
    const totalHoras   = filas.reduce((a,f)=>a+f.hsTotal,0);
    const totalHsExtra = filas.reduce((a,f)=>a+f.hsExtra,0);
    const totalSabs    = filas.filter(f=>f.esSab).length;
    return { filas, totalHoras, totalHsExtra, totalSabs, diasUnicos: filas.length };
  }

  let { filas, totalHoras, totalHsExtra, totalSabs, diasUnicos } = calcTotales(periodoActual);

  const opcionesMes = ['<option value="TODOS">Todos los registros</option>']
    .concat(periodos.map(p => `<option value="${p}" ${p===periodoActual?'selected':''}>${p}</option>`))
    .join('');

  const avatarInner = perfil.foto_url
    ? `<img src="${perfil.foto_url}" alt="${nomMostrar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentElement.innerHTML='${iniciales}'">`
    : (numVend ? `<span style="font-size:18px;font-weight:700;color:${suc.color}">#${numVend}</span>` : `<span style="font-size:18px;font-weight:700;color:${suc.color}">${iniciales}</span>`);

  function buildFilas(fs) {
    return fs.map(f => {
      if (f.esCert) return `
      <tr class="fila-certificado">
        <td>${f.fechaStr}</td>
        <td>${f.diaSem}</td>
        <td class="hora-reg">—</td>
        <td colspan="2"><span class="tag-cert">CERT</span> ${f.nota}</td>
        <td><strong>${f.hsTotal.toFixed(1)}</strong></td>
        <td>—</td>
        <td></td>
        <td></td>
      </tr>`;
      return `
      <tr class="${f.esSab?'fila-sabado':''} ${f.esDom?'fila-domingo':''} ${f.esFer?'fila-feriado':''}">
        <td>${f.fechaStr}${f.esFer?' <span class="tag-feriado">F</span>':''}</td>
        <td>${f.diaSem}</td>
        <td class="hora-reg">${f.horaReg}</td>
        <td class="turno-cell">${f.turno1}</td>
        <td class="turno-cell">${f.turno2||'—'}</td>
        <td><strong>${f.hsTotal.toFixed(1)}</strong></td>
        <td>${f.hsExtra>0?`<span class="hs-extra">${f.hsExtra.toFixed(1)}</span>`:'—'}</td>
        <td>${f.esSab?'<span class="check-sab">✓</span>':''}</td>
        <td class="nota-cell">${f.nota||''}</td>
      </tr>`;
    }).join('');
  }

  function buildCards(fs) {
    return fs.map(f => {
      if (f.esCert) return `
        <div class="ev-card" style="border-left:3px solid #2563eb;background:#eff6ff">
          <div class="ev-card-top">
            <div class="ev-card-fecha">
              <span class="ev-card-dia-sem">${f.diaSem}</span>
              <span class="ev-card-fecha-str">${f.fechaStr}</span>
            </div>
            <div class="ev-card-hs">
              <span class="ev-card-hs-val">${f.hsTotal.toFixed(1)}<small>hs</small></span>
            </div>
          </div>
          <div class="ev-card-turnos">
            <span class="tag-cert">CERT</span>
            <span class="ev-card-turno">${f.nota}</span>
          </div>
        </div>`;
      const clases = [f.esSab?'ev-card-sabado':'', f.esDom?'ev-card-domingo':'', f.esFer?'ev-card-feriado':''].filter(Boolean).join(' ');
      const turno2html = f.turno2 && f.turno2 !== '—' ? `<span class="ev-card-turno">${f.turno2}</span>` : '';
      const extraHtml  = f.hsExtra > 0 ? `<span class="ev-card-extra">+${f.hsExtra.toFixed(1)} extra</span>` : '';
      const sabHtml    = f.esSab ? `<span class="ev-card-sab">Sáb ✓</span>` : '';
      const notaHtml   = f.nota  ? `<div class="ev-card-nota">${f.nota}</div>` : '';
      return `
        <div class="ev-card ${clases}">
          <div class="ev-card-top">
            <div class="ev-card-fecha">
              <span class="ev-card-dia-sem">${f.diaSem}</span>
              <span class="ev-card-fecha-str">${f.fechaStr}${f.esFer?' <span class="tag-feriado">F</span>':''}</span>
            </div>
            <div class="ev-card-hs">
              <span class="ev-card-hs-val">${f.hsTotal.toFixed(1)}<small>hs</small></span>
              ${extraHtml}${sabHtml}
            </div>
          </div>
          <div class="ev-card-turnos">
            <span class="ev-card-turno">${f.turno1}</span>
            ${turno2html}
            ${f.horaReg ? `<span class="ev-card-hora-reg">Reg. ${f.horaReg}</span>` : ''}
          </div>
          ${notaHtml}
        </div>`;
    }).join('');
  }

  const empresaBadge = perfil.empresa
    ? `<span class="emp-empresa-badge ${perfil.empresa==='MOSHE SRL'?'badge-moshe':'badge-cromawave'}">${perfil.empresa}</span>`
    : '';
  const catBadge = cat
    ? `<span class="emp-cat-badge">${cat.nombre}</span>`
    : '';

  document.getElementById('vistaEmpleadoContainer').innerHTML = `
    <div class="emp-vista-personal">

      <!-- HEADER EMPLEADO -->
      <div class="emp-vista-header" style="border-left:4px solid ${suc.color}">
        <div class="emp-vista-avatar-wrap">
          <div class="emp-vista-avatar ${perfil.foto_url?'emp-avatar-foto':''}"
               id="empVistaAvatarDiv"
               style="${perfil.foto_url?'':'background:'+suc.colorLight}">
            ${avatarInner}
          </div>
          <button class="btn-cambiar-foto" onclick="triggerCambiarFoto('${nombreEmp.replace(/'/g,"\\'")}')" title="Cambiar foto">📷</button>
          <input type="file" id="inputFotoEmpleado" accept="image/*" style="display:none"
                 onchange="subirFotoEmpleado(this, '${nombreEmp.replace(/'/g,"\\'")}')">
        </div>
        <div class="emp-vista-info">
          <h1 class="emp-vista-nombre">${nomMostrar}</h1>
          <div class="emp-vista-suc">${suc.nombre}</div>
          <div class="emp-badges-row">${empresaBadge}${catBadge}</div>
        </div>
        <div class="emp-vista-stats">
          <div class="emp-vista-stat">
            <span class="emp-vista-stat-val" id="evDias">${diasUnicos}</span>
            <span class="emp-vista-stat-lbl">Días</span>
          </div>
          <div class="emp-vista-stat">
            <span class="emp-vista-stat-val" id="evHoras">${totalHoras.toFixed(1)}</span>
            <span class="emp-vista-stat-lbl">Hs totales</span>
          </div>
          <div class="emp-vista-stat">
            <span class="emp-vista-stat-val" id="evExtra">${totalHsExtra.toFixed(1)}</span>
            <span class="emp-vista-stat-lbl">Hs extra</span>
          </div>
          <div class="emp-vista-stat">
            <span class="emp-vista-stat-val" id="evSabs">${totalSabs}</span>
            <span class="emp-vista-stat-lbl">Sábados</span>
          </div>
        </div>
      </div>

      <!-- TABS EMPLEADO -->
      <div class="detalle-tabs" style="margin:0 0 0 0;border-bottom:1px solid var(--gray-100)">
        <button class="detalle-tab active" onclick="switchEvTab('jornada',this)">Jornada</button>
        <button class="detalle-tab" onclick="switchEvTab('vacaciones',this)">🏖 Vacaciones</button>
      </div>

      <!-- CONTENIDO JORNADA -->
      <div id="evTabJornada">
      <!-- SELECTOR DE PERÍODO -->
      <div class="emp-vista-toolbar">
        <div style="display:flex;align-items:center;gap:8px">
          <label style="font-size:13px;color:#64748b;font-weight:500">Período:</label>
          <select id="evSelectMes" class="filter-select" style="font-size:13px">
            ${opcionesMes}
          </select>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn-detalle-accion" onclick="abrirMiPerfil()" title="Mi perfil">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/></svg>
            Mi perfil
          </button>
          <button class="btn-detalle-accion" onclick="imprimirVistaEmpleado()" title="Imprimir">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            Imprimir
          </button>
        </div>
      </div>

      <!-- TABLA (desktop) / CARDS (mobile) -->
      <div class="detalle-tabla-wrap ev-tabla-desktop" id="evTablaWrap">
        <table class="detalle-tabla">
          <thead>
            <tr>
              <th>Fecha</th><th>Día</th><th>Hora reg.</th>
              <th>Turno 1</th><th>Turno 2</th>
              <th>Hs total</th><th>Hs extra</th><th>Sáb.</th><th>Nota</th>
            </tr>
          </thead>
          <tbody id="evTbody">${buildFilas(filas)}</tbody>
          <tfoot id="evTfoot">
            <tr>
              <td colspan="2"><strong>TOTALES</strong></td>
              <td><strong>${diasUnicos}</strong></td>
              <td colspan="2"></td>
              <td><strong>${totalHoras.toFixed(1)}</strong></td>
              <td>${totalHsExtra>0?`<span class="hs-extra">${totalHsExtra.toFixed(1)}</span>`:'—'}</td>
              <td><strong>${totalSabs}</strong></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div class="ev-cards-mobile" id="evCardsWrap">
        ${buildCards(filas)}
        <div class="ev-card-totales">
          <span>${diasUnicos} días</span>
          <span>${totalHoras.toFixed(1)} hs totales</span>
          ${totalHsExtra>0?`<span class="ev-card-extra">+${totalHsExtra.toFixed(1)} extra</span>`:''}
          <span>${totalSabs} sábados</span>
        </div>
      </div>
      </div><!-- fin evTabJornada -->

      <!-- CONTENIDO VACACIONES EMPLEADO -->
      <div id="evTabVacaciones" style="display:none;padding:1.5rem">
        <p style="color:#94a3b8;font-size:13px">Cargando vacaciones...</p>
      </div>

    </div>
  `;

  // Evento cambio de período
  document.getElementById('evSelectMes').addEventListener('change', function() {
    const p = this.value;
    const t = calcTotales(p);
    document.getElementById('evDias').textContent  = t.diasUnicos;
    document.getElementById('evHoras').textContent = t.totalHoras.toFixed(1);
    document.getElementById('evExtra').textContent = t.totalHsExtra.toFixed(1);
    document.getElementById('evSabs').textContent  = t.totalSabs;
    document.getElementById('evTbody').innerHTML   = buildFilas(t.filas);
    // Actualizar cards mobile
    const cardsWrap = document.getElementById('evCardsWrap');
    if (cardsWrap) cardsWrap.innerHTML = buildCards(t.filas) + `
      <div class="ev-card-totales">
        <span>${t.diasUnicos} días</span>
        <span>${t.totalHoras.toFixed(1)} hs totales</span>
        ${t.totalHsExtra>0?`<span class="ev-card-extra">+${t.totalHsExtra.toFixed(1)} extra</span>`:''}
        <span>${t.totalSabs} sábados</span>
      </div>`;
    document.getElementById('evTfoot').innerHTML   = `
      <tr>
        <td colspan="2"><strong>TOTALES</strong></td>
        <td><strong>${t.diasUnicos}</strong></td>
        <td colspan="2"></td>
        <td><strong>${t.totalHoras.toFixed(1)}</strong></td>
        <td>${t.totalHsExtra>0?`<span class="hs-extra">${t.totalHsExtra.toFixed(1)}</span>`:'—'}</td>
        <td><strong>${t.totalSabs}</strong></td>
        <td></td>
      </tr>`;
  });

  // Cargar vacaciones del empleado en background
  cargarVacacionesEmpleado(nombreEmp);
}

function imprimirVistaEmpleado() {
  window.print();
}

// ── MI PERFIL (vista empleado) ─────────────────────────
function abrirMiPerfil() {
  const lista = getUsuarios();
  const u = lista.find(u => u.nombre.toLowerCase() === sesionActual.nombre.toLowerCase());
  if (!u) { showToast('No se encontró tu usuario'); return; }

  // Crear overlay
  let overlay = document.getElementById('miPerfilOverlay');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'miPerfilOverlay';
  overlay.className = 'admin-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) cerrarMiPerfil(); };
  overlay.innerHTML = `
    <div class="admin-panel admin-panel-sm" onclick="event.stopPropagation()">
      <div class="admin-header">
        <div class="admin-titulo">Mi perfil</div>
        <button class="detalle-close" onclick="cerrarMiPerfil()">✕</button>
      </div>
      <div class="admin-form">
        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Usuario</label>
          <div style="padding:10px 14px;background:#f8fafc;border-radius:8px;font-size:14px;color:#374151;border:1px solid #e2e8f0">
            ${u.nombre}
          </div>
        </div>

        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Celular (WhatsApp)</label>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:13px;color:#64748b;white-space:nowrap">+549</span>
            <input type="text" class="admin-input" id="miPerfilCelular"
              value="${u.celular||''}" placeholder="2994123456"
              inputmode="numeric" style="flex:1" />
          </div>
          <span style="font-size:11px;color:#94a3b8;margin-top:4px;display:block">
            Sin el 0 ni el 15 — solo los 10 dígitos
          </span>
        </div>

        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Cambiar PIN</label>
          <input type="password" class="admin-input" id="miPerfilPinActual"
            placeholder="PIN actual" maxlength="8" autocomplete="off" />
        </div>
        <div class="admin-form-grupo">
          <input type="password" class="admin-input" id="miPerfilPinNuevo"
            placeholder="PIN nuevo (mínimo 4 dígitos)" maxlength="8" autocomplete="off" />
        </div>
        <div class="admin-form-grupo">
          <input type="password" class="admin-input" id="miPerfilPinRepetir"
            placeholder="Repetir PIN nuevo" maxlength="8" autocomplete="off" />
          <span style="font-size:11px;color:#94a3b8;margin-top:4px;display:block">
            Dejá los campos de PIN vacíos si no querés cambiarlo
          </span>
        </div>

        <p id="miPerfilError" style="color:#dc2626;font-size:12px;display:none;margin-bottom:0.5rem"></p>

        <div style="display:flex;flex-direction:column;gap:8px;margin-top:1rem">
          <button class="btn-connect" style="margin:0;width:100%" onclick="guardarMiPerfil()">
            Guardar cambios
          </button>
          <button class="btn-demo" style="width:100%;padding:11px 16px" onclick="cerrarMiPerfil()">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

function cerrarMiPerfil() {
  document.getElementById('miPerfilOverlay')?.remove();
}

async function guardarMiPerfil() {
  const celular    = document.getElementById('miPerfilCelular')?.value.trim().replace(/\D/g,'');
  const pinActual  = document.getElementById('miPerfilPinActual')?.value;
  const pinNuevo   = document.getElementById('miPerfilPinNuevo')?.value;
  const pinRepetir = document.getElementById('miPerfilPinRepetir')?.value;
  const errEl      = document.getElementById('miPerfilError');

  const lista = getUsuarios();
  const idx   = lista.findIndex(u => u.nombre.toLowerCase() === sesionActual.nombre.toLowerCase());
  if (idx < 0) { showToast('Error: usuario no encontrado'); return; }

  const u = { ...lista[idx] };

  // Validar cambio de PIN si se intentó
  if (pinActual || pinNuevo || pinRepetir) {
    if (pinActual !== u.pin) {
      errEl.textContent = 'El PIN actual es incorrecto';
      errEl.style.display = 'block'; return;
    }
    if (!pinNuevo || pinNuevo.length < 4) {
      errEl.textContent = 'El PIN nuevo debe tener al menos 4 caracteres';
      errEl.style.display = 'block'; return;
    }
    if (pinNuevo !== pinRepetir) {
      errEl.textContent = 'Los PINs nuevos no coinciden';
      errEl.style.display = 'block'; return;
    }
    u.pin = pinNuevo;
  }

  u.celular = celular || null;
  lista[idx] = u;

  await saveUsuarios(lista);
  cerrarMiPerfil();
  showToast('✓ Perfil actualizado');
}

// ── GESTIÓN DE USUARIOS EN ADMIN ───────────────────────
function renderAdminUsuariosInner() {
  const lista = getUsuarios();

  const empNombres = [...new Set(state.datos.map(r => r.EMPLEADO))].sort((a,b)=>{
    const na = parseInt(a)||999, nb = parseInt(b)||999;
    return na!==nb ? na-nb : a.localeCompare(b);
  });

  const filas = lista.map((u, i) => {
    const numMatch = (u.empleadoNombre||'').match(/^(\d+)\s+(.+)$/);
    const empLabel = numMatch ? `#${numMatch[1]} ${numMatch[2]}` : (u.empleadoNombre || '—');
    return `<tr>
      <td><strong>${u.nombre}</strong></td>
      <td>${empLabel}</td>
      <td><span class="pill ${u.rol==='admin'?'pill-comp':'pill-tm'}" style="font-size:10px">${u.rol}</span></td>
      <td><code style="font-size:12px;background:#f1f5f9;padding:2px 8px;border-radius:4px">${'•'.repeat(u.pin.length)}</code></td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn-admin-edit" onclick="abrirEditarUsuario(${i})">Editar</button>
          <button class="btn-admin-edit" style="color:#dc2626;border-color:#fecaca" onclick="eliminarUsuario(${i})">Eliminar</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  return `
    <div class="admin-toolbar">
      <button class="btn-connect" style="width:auto;padding:8px 16px;font-size:13px" onclick="abrirNuevoUsuario()">+ Nuevo usuario</button>
      <span style="font-size:12px;color:#94a3b8">${lista.length} usuario${lista.length!==1?'s':''} + Admin</span>
    </div>
    <div class="admin-table-wrap">
      <table class="admin-tabla">
        <thead>
          <tr><th>Usuario</th><th>Empleado vinculado</th><th>Rol</th><th>PIN</th><th></th></tr>
        </thead>
        <tbody>
          <tr style="background:#fafafa">
            <td><strong>Admin</strong></td>
            <td><span style="color:#94a3b8;font-size:12px">—</span></td>
            <td><span class="pill pill-falta" style="font-size:10px">admin</span></td>
            <td><code style="font-size:12px;background:#f1f5f9;padding:2px 8px;border-radius:4px">${'•'.repeat(ADMIN_PIN.length)}</code></td>
            <td><span style="font-size:11px;color:#94a3b8">PIN fijo en código</span></td>
          </tr>
          ${filas || '<tr><td colspan="5" style="text-align:center;padding:2rem;color:#94a3b8">Sin usuarios creados aún</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

function renderAdminUsuarios() {
  return `<div id="adminTabUsuarios" class="admin-tab-content" style="display:none">${renderAdminUsuariosInner()}</div>`;
}

function abrirNuevoUsuario() { abrirEditarUsuario(null); }

function abrirEditarUsuario(idx) {
  const lista = getUsuarios();
  const u = idx !== null ? lista[idx] : null;

  const empNombres = [...new Set(state.datos.map(r => r.EMPLEADO))].sort((a,b)=>{
    const na = parseInt(a)||999, nb = parseInt(b)||999;
    return na!==nb ? na-nb : a.localeCompare(b);
  });

  const empOpts = ['<option value="">Sin empleado vinculado</option>']
    .concat(empNombres.map(e => {
      const nm = e.match(/^(\d+)\s+(.+)$/);
      const lbl = nm ? `#${nm[1]} ${nm[2]}` : e;
      return `<option value="${e}" ${u?.empleadoNombre===e?'selected':''}>${lbl}</option>`;
    })).join('');

  const html = `
  <div class="admin-overlay" id="adminOverlay" onclick="cerrarAdmin(event)">
    <div class="admin-panel admin-panel-sm" onclick="event.stopPropagation()">
      <div class="admin-header">
        <div class="admin-titulo">${u ? 'Editar usuario' : 'Nuevo usuario'}</div>
        <button class="detalle-close" onclick="cerrarAdmin();renderAdmin()">✕</button>
      </div>
      <div class="admin-form">
        <input type="hidden" id="editUsuarioIdx" value="${idx !== null ? idx : ''}" />

        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Nombre de usuario</label>
          <input type="text" class="admin-input" id="editUsuarioNombre"
            value="${u?.nombre||''}" placeholder="Ej: maria.garcia"
            autocomplete="off" autocapitalize="off" />
          <span style="font-size:11px;color:#94a3b8;margin-top:4px;display:block">
            El empleado va a ingresar con este nombre
          </span>
        </div>

        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Empleado vinculado</label>
          <select class="admin-input" id="editUsuarioEmp">${empOpts}</select>
          <span style="font-size:11px;color:#94a3b8;margin-top:4px;display:block">
            El empleado solo verá sus propios datos
          </span>
        </div>

        <div class="admin-form-grupo">
          <label class="emp-filtro-label">PIN de acceso</label>
          <input type="text" class="admin-input" id="editUsuarioPin"
            value="${u?.pin||''}" placeholder="Ej: 1234" maxlength="8"
            inputmode="numeric" autocomplete="off" />
        </div>

        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Celular (WhatsApp)</label>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:13px;color:#64748b;white-space:nowrap">+549</span>
            <input type="text" class="admin-input" id="editUsuarioCelular"
              value="${u?.celular||''}" placeholder="2994123456"
              inputmode="numeric" autocomplete="off" style="flex:1" />
          </div>
          <span style="font-size:11px;color:#94a3b8;margin-top:4px;display:block">
            Sin el 0 ni el 15 — solo los 10 dígitos
          </span>
        </div>

        <div style="display:flex;flex-direction:column;gap:8px;margin-top:1.5rem">
          <button class="btn-connect" style="margin:0" onclick="guardarUsuarioDesdeForm()">
            ${u ? 'Guardar cambios' : 'Crear usuario'}
          </button>
          <button class="btn-demo" onclick="cerrarAdmin();renderAdmin()">Cancelar</button>
        </div>
      </div>
    </div>
  </div>`;

  montarOverlayAdmin(html);
}

function guardarUsuarioDesdeForm() {
  const idxStr = document.getElementById('editUsuarioIdx')?.value;
  const idx    = idxStr !== '' ? parseInt(idxStr) : null;
  const nombre   = document.getElementById('editUsuarioNombre')?.value.trim();
  const emp      = document.getElementById('editUsuarioEmp')?.value;
  const pin      = document.getElementById('editUsuarioPin')?.value.trim();
  const celular  = document.getElementById('editUsuarioCelular')?.value.trim().replace(/\D/g,'');

  if (!nombre) { showToast('Ingresá un nombre de usuario'); return; }
  if (!pin || pin.length < 4) { showToast('El PIN debe tener al menos 4 caracteres'); return; }

  const lista = getUsuarios();

  const existe = lista.find((u, i) => u.nombre.toLowerCase() === nombre.toLowerCase() && i !== idx);
  if (existe) { showToast('Ya existe un usuario con ese nombre'); return; }

  const usuario = {
    nombre,
    pin,
    rol: 'empleado',
    empleadoNombre: emp || null,
    celular: celular || null,
  };

  if (idx !== null) {
    lista[idx] = usuario;
  } else {
    lista.push(usuario);
  }

  saveUsuarios(lista);
  showToast(idx !== null ? '✓ Usuario actualizado' : '✓ Usuario creado');
  cerrarAdmin();
  // Actualizar solo el tab de usuarios sin rerenderizar todo el panel
  const tabEl = document.getElementById('adminTabUsuarios');
  if (tabEl) tabEl.innerHTML = renderAdminUsuariosInner();
}

function eliminarUsuario(idx) {
  const lista = getUsuarios();
  const u = lista[idx];
  if (!u) return;
  if (!confirm(`¿Eliminar el usuario "${u.nombre}"?`)) return;
  lista.splice(idx, 1);
  saveUsuarios(lista);
  showToast('Usuario eliminado');
  const tabEl = document.getElementById('adminTabUsuarios');
  if (tabEl) tabEl.innerHTML = renderAdminUsuariosInner();
}
// ── PANEL ADMIN ────────────────────────────────────────
const ADMIN_PIN = '4268';
let adminAutenticado = sessionStorage.getItem('croma_admin_auth') === '1';

function abrirAdmin() { setView('administracion'); }

function renderAdminInline() {
  const container = document.getElementById('adminContainer');
  if (!container) return;

  const empNombres = [...new Set(state.datos.map(r => r.EMPLEADO))].sort((a, b) => {
    const na = parseInt(a) || 999, nb = parseInt(b) || 999;
    return na !== nb ? na - nb : a.localeCompare(b);
  });

  const filasEmps = empNombres.map(nombre => {
    const perfil    = EMPLEADOS_PERFILES[nombre] || {};
    const suc       = SUCURSALES.find(s => s.id === (state.datos.find(r => r.EMPLEADO === nombre)?.LOCAL || perfil.sucursal_id)) || { nombre: '—' };
    const numMatch  = nombre.match(/^(\d+)\s+(.+)$/);
    const nomMostrar= numMatch ? numMatch[2] : nombre;
    const avatarUrl = perfil.foto_url || '';
    const iniciales = nomMostrar.split(' ').slice(0,2).map(p=>p[0]?.toUpperCase()).join('');
    const nomEnc    = nombre.replace(/'/g, "\\'");
    let avatarInner;
    if (avatarUrl) {
      avatarInner = "<img src='" + avatarUrl + "' onerror=\"this.parentElement.innerHTML='" + iniciales + "'\" style='width:32px;height:32px;border-radius:50%;object-fit:cover'>";
    } else {
      avatarInner = "<span style='font-size:11px;font-weight:600;color:#64748b'>" + iniciales + "</span>";
    }
    const empresaHTML = perfil.empresa
      ? "<span class='emp-empresa-badge " + (perfil.empresa === 'MOSHE SRL' ? 'badge-moshe' : 'badge-cromawave') + "'>" + perfil.empresa + "</span>"
      : "<span style='color:#94a3b8;font-size:12px'>—</span>";
    const catNom  = CATEGORIAS_CONFIG.find(c => c.id === perfil.categoria_id)?.nombre || '—';
    const catHTML = perfil.categoria_id
      ? "<span class='emp-cat-badge'>" + catNom + "</span>"
      : "<span style='color:#94a3b8;font-size:12px'>—</span>";
    const fotoOk  = perfil.foto_url ? '📷 OK' : '—';
    return "<tr class='admin-emp-row' onclick=\"abrirEditarEmpleado('" + nomEnc + "')\">" +
      "<td><div style='display:flex;align-items:center;gap:10px'>" +
        "<div class='admin-avatar-mini' style='background:" + (avatarUrl ? 'transparent' : '#f1f5f9') + "'>" + avatarInner + "</div>" +
        "<span>" + nomMostrar + "</span>" +
      "</div></td>" +
      "<td><span class='suc-badge-mini' style='background:#f1f5f9;color:#475569'>" + suc.nombre + "</span></td>" +
      "<td>" + empresaHTML + "</td>" +
      "<td>" + catHTML + "</td>" +
      "<td><span style='font-size:11px;color:#94a3b8'>" + fotoOk + "</span></td>" +
      "<td><button class='btn-admin-edit' onclick=\"event.stopPropagation();abrirEditarEmpleado('" + nomEnc + "')\" >Editar</button></td>" +
      "</tr>";
  }).join('');

  const filasCats = CATEGORIAS_CONFIG.map(cat => {
    const percibeHTML = cat.percibe_extra
      ? "<span class='pill pill-comp' style='font-size:10px'>Sí</span>"
      : "<span class='pill pill-franco' style='font-size:10px'>No</span>";
    return "<tr>" +
      "<td><strong>" + cat.nombre + "</strong></td>" +
      "<td style='font-size:12px;color:#64748b'>" + (cat.descripcion || '—') + "</td>" +
      "<td>" + percibeHTML + "</td>" +
      "<td><button class='btn-admin-edit' onclick=\"abrirEditarCategoria('" + cat.id + "')\" >Editar</button></td>" +
      "</tr>";
  }).join('');

  container.innerHTML =
    "<div class='admin-inline-wrap'>" +
    "<div class='admin-inline-header'>" +
      "<div class='admin-titulo'>Administración</div>" +
      "<button class='btn-admin-edit' style='font-size:12px' onclick='cerrarSesionAdmin()'>Cerrar sesión admin</button>" +
    "</div>" +
    "<div class='admin-tabs' id='adminTabs'>" +
      "<button class='admin-tab active' onclick=\"switchAdminTab('empleados',this)\" >Empleados (" + empNombres.length + ")</button>" +
      "<button class='admin-tab' onclick=\"switchAdminTab('categorias',this)\" >Categorías</button>" +
      "<button class='admin-tab' onclick=\"switchAdminTab('usuarios',this)\" >Usuarios</button>" +
      "<button class='admin-tab' onclick=\"switchAdminTab('configuracion',this)\" >Configuración</button>" +
    "</div>" +
    "<div id='adminTabEmpleados' class='admin-tab-content'>" +
      "<div class='admin-toolbar'>" +
        "<input type='text' class='admin-search' id='adminBuscarEmp' placeholder='Buscar empleado...' oninput='filtrarTablaAdmin(this.value)' />" +
        "<span style='font-size:12px;color:#94a3b8'>" + empNombres.length + " empleados en el sistema</span>" +
      "</div>" +
      "<div class='admin-table-wrap'>" +
        "<table class='admin-tabla' id='adminTablaEmps'>" +
          "<thead><tr><th>Empleado</th><th>Sucursal</th><th>Empresa</th><th>Categoría</th><th>Foto</th><th></th></tr></thead>" +
          "<tbody>" + (filasEmps || "<tr><td colspan='6' style='text-align:center;padding:2rem;color:#94a3b8'>Sin datos cargados</td></tr>") + "</tbody>" +
        "</table>" +
      "</div>" +
    "</div>" +
    "<div id='adminTabCategorias' class='admin-tab-content' style='display:none'>" +
      "<div class='admin-toolbar'>" +
        "<button class='btn-connect' style='width:auto;padding:8px 16px;font-size:13px' onclick='abrirNuevaCategoria()'>+ Nueva categoría</button>" +
      "</div>" +
      "<div class='admin-table-wrap'>" +
        "<table class='admin-tabla'><thead><tr><th>Nombre</th><th>Descripción</th><th>Percibe extra</th><th></th></tr></thead>" +
        "<tbody>" + filasCats + "</tbody></table>" +
      "</div>" +
    "</div>" +
    renderAdminUsuarios() +
    "<div id='adminTabConfiguracion' class='admin-tab-content' style='display:none'>" +
      "<div style='padding:1.5rem;max-width:500px'>" +
        "<h3 style='font-size:14px;font-weight:600;margin-bottom:1.5rem;color:#1e293b'>Configuración general</h3>" +
        "<div class='admin-form-grupo'>" +
          "<label class='emp-filtro-label'>Email del administrador (para notificaciones)</label>" +
          "<input type='email' class='admin-input' id='cfgEmailAdmin' placeholder='admin@croma.com' />" +
          "<span style='font-size:11px;color:#94a3b8;margin-top:4px;display:block'>Se envía un email cuando llega una solicitud de vacaciones</span>" +
        "</div>" +
        "<div style='margin-top:1rem'>" +
          "<button class='btn-connect' style='margin:0;width:auto;padding:10px 24px' onclick='guardarConfigAdmin()'>Guardar</button>" +
        "</div>" +
        "<p id='cfgStatus' style='font-size:12px;margin-top:8px;display:none'></p>" +
      "</div>" +
    "</div>" +
    "</div>";
}

function renderAdmin() { renderAdminInline(); }

function cerrarSesionAdmin() {
  adminAutenticado = false;
  sessionStorage.removeItem('croma_admin_auth');
  setView('empleados');
}

function switchAdminTab(tab, btn) {
  document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('adminTabEmpleados').style.display    = tab === 'empleados'     ? 'block' : 'none';
  document.getElementById('adminTabCategorias').style.display   = tab === 'categorias'    ? 'block' : 'none';
  document.getElementById('adminTabUsuarios').style.display     = tab === 'usuarios'      ? 'block' : 'none';
  document.getElementById('adminTabConfiguracion').style.display= tab === 'configuracion' ? 'block' : 'none';
  if (tab === 'usuarios')      cargarUsuarios().then(() => { const t = document.getElementById('adminTabUsuarios'); if(t) t.innerHTML = renderAdminUsuariosInner(); });
  if (tab === 'configuracion') cargarConfigAdmin();
}

function filtrarTablaAdmin(q) {
  const rows = document.querySelectorAll('#adminTablaEmps tbody tr');
  const ql = q.toLowerCase();
  rows.forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(ql) ? '' : 'none';
  });
}

function abrirEditarEmpleado(nombre) {
  const perfil = EMPLEADOS_PERFILES[nombre] || { nombre };
  const numMatch = nombre.match(/^(\d+)\s+(.+)$/);
  const nomMostrar = numMatch ? numMatch[2] : nombre;

  const sucOpts = [
    `<option value="">Sin asignar</option>`,
    ...SUCURSALES.map(s =>
      `<option value="${s.id}" ${perfil.sucursal_id === s.id ? 'selected' : ''}>${s.nombre}</option>`
    )
  ].join('');

  const catOpts = [
    `<option value="">Sin categoría</option>`,
    ...CATEGORIAS_CONFIG.map(c =>
      `<option value="${c.id}" ${perfil.categoria_id === c.id ? 'selected' : ''}>${c.nombre}</option>`
    )
  ].join('');

  const empOpts = [
    `<option value="">Sin empresa</option>`,
    ...EMPRESAS.map(e =>
      `<option value="${e}" ${perfil.empresa === e ? 'selected' : ''}>${e}</option>`
    )
  ].join('');

  const reglaCustomOpts = `
    <option value="" ${!perfil.regla_custom?'selected':''}>Usar regla de la categoría</option>
    <option value="lv4" ${perfil.regla_custom==='lv4'?'selected':''}>4h Lun-Vie (excedente = extra)</option>
    <option value="lv8" ${perfil.regla_custom==='lv8'?'selected':''}>8h Lun-Vie (excedente = extra)</option>
    <option value="personalizado" ${perfil.regla_custom==='personalizado'?'selected':''}>Personalizado (usar Hs base)</option>
  `;

  const html = `
  <div class="admin-overlay" id="adminOverlay" onclick="cerrarAdmin(event)">
    <div class="admin-panel admin-panel-sm" onclick="event.stopPropagation()">
      <div class="admin-header">
        <div class="admin-titulo">Editar — ${nomMostrar}</div>
        <button class="detalle-close" onclick="cerrarAdmin();renderAdmin()">✕</button>
      </div>
      <div class="admin-form">
        <input type="hidden" id="editNombre" value="${nombre}" />

        <div class="admin-foto-preview" id="adminFotoPreview">
          ${perfil.foto_url
            ? `<img src="${perfil.foto_url}" onerror="this.parentElement.innerHTML='Sin foto'" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid #e2e8f0">`
            : `<div style="width:80px;height:80px;border-radius:50%;background:#f1f5f9;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:600;color:#94a3b8">${nomMostrar.split(' ').slice(0,2).map(p=>p[0]?.toUpperCase()).join('')}</div>`
          }
        </div>

        <div class="admin-form-grupo">
          <label class="emp-filtro-label">URL de foto (Google Drive)</label>
          <input type="url" class="admin-input" id="editFotoUrl" value="${perfil.foto_url || ''}"
            placeholder="https://drive.google.com/..." oninput="previewFoto(this.value)" />
          <span style="font-size:11px;color:#94a3b8;margin-top:4px;display:block">Compartir foto como "Cualquiera con el enlace puede ver" y pegar la URL aquí</span>
        </div>

        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Sucursal principal</label>
          <select class="admin-input" id="editSucursal">${sucOpts}</select>
          <span style="font-size:11px;color:#94a3b8;margin-top:4px;display:block">Se usa para el calendario de vacaciones y detección de conflictos</span>
        </div>

        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Fecha de ingreso</label>
          <input type="date" class="admin-input" id="editFechaIngreso" value="${perfil.fecha_ingreso || ''}" />
          <span style="font-size:11px;color:#94a3b8;margin-top:4px;display:block">Se usa para calcular días de vacaciones según antigüedad</span>
        </div>

        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Empresa</label>
          <select class="admin-input" id="editEmpresa">${empOpts}</select>
        </div>

        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Categoría</label>
          <select class="admin-input" id="editCategoria">${catOpts}</select>
        </div>

        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Regla personalizada de horas extra</label>
          <select class="admin-input" id="editReglaCustom" onchange="toggleHsBase(this.value)">${reglaCustomOpts}</select>
        </div>

        <div class="admin-form-grupo" id="editHsBaseGrupo" style="${perfil.regla_custom==='personalizado'?'':'display:none'}">
          <label class="emp-filtro-label">Horas base por día (límite para extra)</label>
          <input type="number" class="admin-input" id="editHsBase" value="${perfil.hs_base || 8}" min="1" max="12" step="0.5" />
        </div>

        <div style="display:flex;flex-direction:column;gap:8px;margin-top:1.5rem">
          <button class="btn-connect" style="margin:0" onclick="guardarPerfilDesdeForm()">Guardar cambios</button>
          <button class="btn-demo" onclick="cerrarAdmin();renderAdmin()">Cancelar</button>
        </div>
      </div>
    </div>
  </div>`;

  montarOverlayAdmin(html);
}

function previewFoto(url) {
  const preview = document.getElementById('adminFotoPreview');
  if (!preview) return;
  if (!url) { preview.innerHTML = '<div style="width:80px;height:80px;border-radius:50%;background:#f1f5f9;display:flex;align-items:center;justify-content:center;font-size:12px;color:#94a3b8">Sin foto</div>'; return; }
  // Convertir link de Drive a thumbnail si corresponde
  const driveMatch = url.match(/\/d\/([^/]+)/);
  const imgUrl = driveMatch ? `https://drive.google.com/thumbnail?id=${driveMatch[1]}&sz=w200` : url;
  preview.innerHTML = `<img src="${imgUrl}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid #e2e8f0" onerror="this.parentElement.innerHTML='URL inválida'">`;
}

function toggleHsBase(val) {
  document.getElementById('editHsBaseGrupo').style.display = val === 'personalizado' ? 'block' : 'none';
}

async function guardarPerfilDesdeForm() {
  const nombre       = document.getElementById('editNombre')?.value;
  const fotoUrl      = document.getElementById('editFotoUrl')?.value.trim();
  const empresa      = document.getElementById('editEmpresa')?.value;
  const categoriaId  = document.getElementById('editCategoria')?.value;
  const reglaCustom  = document.getElementById('editReglaCustom')?.value;
  const hsBase       = parseFloat(document.getElementById('editHsBase')?.value) || 8;
  const sucursalId   = document.getElementById('editSucursal')?.value || '';
  const fechaIngreso = document.getElementById('editFechaIngreso')?.value || '';

  // Convertir URL de Drive si corresponde
  let fotoFinal = fotoUrl;
  const driveMatch = fotoUrl.match(/\/d\/([^/]+)/);
  if (driveMatch) {
    fotoFinal = `https://drive.google.com/thumbnail?id=${driveMatch[1]}&sz=w200`;
  }

  const perfil = {
    nombre,
    empresa,
    categoria_id:  categoriaId,
    regla_custom:  reglaCustom || '',
    hs_base:       hsBase,
    foto_url:      fotoFinal,
    sucursal_id:   sucursalId,
    fecha_ingreso: fechaIngreso,
    activo: true,
  };

  // Guardar localmente siempre (aunque falle el servidor)
  EMPLEADOS_PERFILES[nombre] = perfil;

  // Intentar guardar en Sheet
  await guardarPerfil(perfil);
  cerrarAdmin();
  renderAdmin();
}

function abrirNuevaCategoria() { abrirEditarCategoria(null); }

function abrirEditarCategoria(catId) {
  const cat = catId ? CATEGORIAS_CONFIG.find(c => c.id === catId) : null;

  const html = `
  <div class="admin-overlay" id="adminOverlay" onclick="cerrarAdmin(event)">
    <div class="admin-panel admin-panel-sm" onclick="event.stopPropagation()">
      <div class="admin-header">
        <div class="admin-titulo">${cat ? 'Editar categoría' : 'Nueva categoría'}</div>
        <button class="detalle-close" onclick="cerrarAdmin();renderAdmin()">✕</button>
      </div>
      <div class="admin-form">
        <div class="admin-form-grupo">
          <label class="emp-filtro-label">ID (código corto)</label>
          <input type="text" class="admin-input" id="catId" value="${cat?.id||''}" placeholder="Ej: JC, MJ, FR..." maxlength="10" ${cat?'readonly':''} />
        </div>
        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Nombre</label>
          <input type="text" class="admin-input" id="catNombre" value="${cat?.nombre||''}" placeholder="Ej: Jornada Completa" />
        </div>
        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Descripción</label>
          <input type="text" class="admin-input" id="catDesc" value="${cat?.descripcion||''}" placeholder="Ej: 8h Lun-Vie, 4h Sáb" />
        </div>
        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Regla de cálculo</label>
          <select class="admin-input" id="catRegla">
            <option value="lv8_s4" ${cat?.regla==='lv8_s4'?'selected':''}>8h Lun-Vie, 4h Sáb (Jornada completa)</option>
            <option value="fijo4" ${cat?.regla==='fijo4'?'selected':''}>4h cualquier día (Media jornada)</option>
            <option value="sin_extra" ${cat?.regla==='sin_extra'?'selected':''}>Sin horas extra (Franquero)</option>
            <option value="hs_base" ${cat?.regla==='hs_base'?'selected':''}>Según hs_base del empleado</option>
          </select>
        </div>
        <div class="admin-form-grupo">
          <label class="emp-filtro-label" style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="catPercibe" ${cat?.percibe_extra!==false?'checked':''} style="width:16px;height:16px" />
            Percibe horas extra
          </label>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:1.5rem">
          <button class="btn-connect" style="margin:0" onclick="guardarCategoriaDesdeForm()">Guardar</button>
          <button class="btn-demo" onclick="cerrarAdmin();renderAdmin()">Cancelar</button>
        </div>
      </div>
    </div>
  </div>`;

  montarOverlayAdmin(html);
}

async function guardarCategoriaDesdeForm() {
  const id       = document.getElementById('catId')?.value.trim().toUpperCase();
  const nombre   = document.getElementById('catNombre')?.value.trim();
  const desc     = document.getElementById('catDesc')?.value.trim();
  const regla    = document.getElementById('catRegla')?.value;
  const percibe  = document.getElementById('catPercibe')?.checked;

  if (!id || !nombre) { showToast('Completá ID y Nombre'); return; }

  const cat = { id, nombre, descripcion: desc, regla, percibe_extra: percibe };
  await guardarCategoria(cat);
}

function montarOverlayAdmin(html) {
  const existing = document.getElementById('adminOverlay');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.id = 'adminOverlay';
  div.innerHTML = html;
  document.body.appendChild(div);
  document.body.style.overflow = 'hidden';
}

function cerrarAdmin(event) {
  if (event && event.target !== event.currentTarget) return;
  const el = document.getElementById('adminOverlay');
  if (el) el.remove();
  document.body.style.overflow = '';
}

// ── INIT ───────────────────────────────────────────────
function init() {
  // Arrancar con pantalla de login
  mostrarLoginApp();

  // Semana
  document.getElementById('weekRange').textContent = getWeekRange(0);
  document.getElementById('mesRange').textContent  = getMesLabel(0);

  // Navegación de semanas
  document.getElementById('prevWeek').addEventListener('click', () => {
    state.semanaOffset--;
    renderAll();
  });
  document.getElementById('nextWeek').addEventListener('click', () => {
    state.semanaOffset++;
    renderAll();
  });

  // Navegación de mes
  document.getElementById('prevMes').addEventListener('click', () => {
    state.mesOffset--;
    renderAll();
  });
  document.getElementById('nextMes').addEventListener('click', () => {
    state.mesOffset++;
    renderAll();
  });

  // Tabs de navegación
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  // Filtros
  ['filterSucursal','filterEmp','filterTurno'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', renderAll);
  });

  // Botón conectar
  document.getElementById('btnConnect').addEventListener('click', () => {
    const urls = getUrlsFromForm();
    if (!Object.keys(urls).length) {
      showToast('Ingresá al menos una URL de Apps Script');
      return;
    }
    saveUrls(urls);
    cargarDatos(urls);
  });

  // Botón demo
  document.getElementById('btnDemo').addEventListener('click', () => {
    state.datos = DEMO_DATA;
    setConnected(true);
    showApp();
    showToast('Modo demo activado');
    renderAll();
  });

  // Refresh
  document.getElementById('btnRefresh').addEventListener('click', () => {
    cargarDatos({ unica: APPS_SCRIPT_URL });
  });

  // Print
  document.getElementById('btnPrint').addEventListener('click', () => window.print());

  // ── DRAWER MOBILE ──
  const drawer        = document.getElementById('drawerMenu');
  const drawerOverlay = document.getElementById('drawerOverlay');
  const btnHamburger  = document.getElementById('btnHamburger');
  const btnClose      = document.getElementById('btnDrawerClose');

  function abrirDrawer() {
    drawer.classList.add('open');
    drawerOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function cerrarDrawer() {
    drawer.classList.remove('open');
    drawerOverlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  btnHamburger?.addEventListener('click', abrirDrawer);
  btnClose?.addEventListener('click', cerrarDrawer);
  drawerOverlay?.addEventListener('click', cerrarDrawer);

  // Botones de navegación del drawer
  document.querySelectorAll('.drawer-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setView(btn.dataset.view);
      cerrarDrawer();
    });
  });

  // Refresh desde drawer
  document.getElementById('drawerRefresh')?.addEventListener('click', () => {
    cerrarDrawer();
    cargarDatos({ unica: APPS_SCRIPT_URL });
  });

  // ── BÚSQUEDA RÁPIDA DE EMPLEADO ──
  const inputBuscar = document.getElementById('buscarEmp');
  const btnClear    = document.getElementById('btnClearSearch');

  // Expandir buscador al tocar la lupa en mobile
  const topSearch = document.querySelector('.top-search');
  topSearch?.querySelector('svg')?.addEventListener('click', () => {
    if (window.innerWidth <= 700) {
      topSearch.classList.toggle('expanded');
      if (topSearch.classList.contains('expanded')) {
        setTimeout(() => inputBuscar.focus(), 300);
      } else {
        inputBuscar.value = '';
        cerrarBusqueda();
      }
    }
  });

  inputBuscar.addEventListener('input', () => {
    const q = inputBuscar.value.trim();
    btnClear.style.display = q ? 'flex' : 'none';
    buscarEmpleado(q);
  });

  inputBuscar.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      inputBuscar.value = '';
      btnClear.style.display = 'none';
      cerrarBusqueda();
      topSearch?.classList.remove('expanded');
    }
  });

  btnClear.addEventListener('click', () => {
    inputBuscar.value = '';
    btnClear.style.display = 'none';
    cerrarBusqueda();
    topSearch?.classList.remove('expanded');
  });

  // Poblar select de sucursales
  const selSuc = document.getElementById('filterSucursal');
  selSuc.innerHTML = '<option value="all">Todas las sucursales</option>' +
    SUCURSALES.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('');
}

document.addEventListener('DOMContentLoaded', init);

// ── BÚSQUEDA RÁPIDA ───────────────────────────────────
function buscarEmpleado(query) {
  if (!query || query.length < 2) {
    cerrarBusqueda();
    return;
  }

  const q = query.toLowerCase();
  const datos = state.datos;

  // Buscar coincidencias únicas por empleado
  const matches = [...new Map(
    datos
      .filter(r => r.EMPLEADO.toLowerCase().includes(q))
      .map(r => [r.EMPLEADO, r])
  ).values()].slice(0, 8);

  if (!matches.length) {
    mostrarDropdownBusqueda([]);
    return;
  }

  mostrarDropdownBusqueda(matches);
}

function mostrarDropdownBusqueda(matches) {
  // Mover el dropdown al body para evitar recorte por overflow de la topbar
  let dropdown = document.getElementById('searchDropdown');
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.id = 'searchDropdown';
    dropdown.className = 'search-dropdown';
    document.body.appendChild(dropdown);
  }

  // Posicionar bajo el buscador
  const searchEl = document.querySelector('.top-search');
  const rect = searchEl.getBoundingClientRect();
  dropdown.style.position = 'fixed';
  dropdown.style.top  = (rect.bottom + 6) + 'px';
  dropdown.style.left = Math.max(8, rect.left) + 'px';
  dropdown.style.right = 'auto';
  dropdown.style.width = Math.max(280, rect.width) + 'px';
  dropdown.style.zIndex = '9999';

  if (!matches.length) {
    dropdown.innerHTML = '<div class="search-empty">Sin resultados</div>';
    dropdown.style.display = 'block';
    return;
  }

  dropdown.innerHTML = matches.map(r => {
    const s = SUCURSALES.find(x => x.id === r.LOCAL) || { color: '#888', colorLight: '#eee', nombre: r.LOCAL };
    const numMatch = r.EMPLEADO.match(/^(\d+)\s+(.+)$/);
    const numVend  = numMatch ? `<span class="search-num">#${numMatch[1]}</span>` : '';
    const nombre   = numMatch ? numMatch[2] : r.EMPLEADO;
    return `<div class="search-item"
      data-emp="${r.EMPLEADO.replace(/"/g,'&quot;')}"
      data-suc="${r.LOCAL}">
      <span class="search-dot" style="background:${s.color}"></span>
      <span class="search-nombre">${numVend} ${nombre}</span>
      <span class="search-suc">${s.nombre}</span>
    </div>`;
  }).join('');

  dropdown.querySelectorAll('.search-item').forEach(item => {
    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      seleccionarBusqueda(item.dataset.emp, item.dataset.suc);
    };
    item.addEventListener('click', handler);
    item.addEventListener('touchend', handler);
  });

  dropdown.style.display = 'block';
}

function seleccionarBusqueda(nombreEmp, sucId) {
  document.getElementById('buscarEmp').value = '';
  document.getElementById('btnClearSearch').style.display = 'none';
  cerrarBusqueda();
  abrirDetalleEmpleado(nombreEmp, sucId);
}

function cerrarBusqueda() {
  const dropdown = document.getElementById('searchDropdown');
  if (dropdown) dropdown.style.display = 'none';
}

// Cerrar dropdown al hacer clic afuera (no cerrar si se toca dentro del dropdown)
document.addEventListener('click', e => {
  if (!e.target.closest('.top-search') && !e.target.closest('#searchDropdown')) cerrarBusqueda();
});
document.addEventListener('touchstart', e => {
  if (!e.target.closest('.top-search') && !e.target.closest('#searchDropdown')) cerrarBusqueda();
}, { passive: true });

// ── AUTO-REFRESH ───────────────────────────────────────
const AUTO_REFRESH_MIN = 5;
let autoRefreshTimer = null;

function iniciarAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(() => {
    cargarDatos({ unica: APPS_SCRIPT_URL });
    showToast(`↻ Datos actualizados automáticamente`);
  }, AUTO_REFRESH_MIN * 60 * 1000);
}

// ── CAMBIO DE FOTO DE EMPLEADO (ImgBB) ────────────────
const IMGBB_API_KEY = 'ffe26c9576b3bfbe561fc8c078b69b27';

function triggerCambiarFoto(nombreEmp) {
  const input = document.getElementById('inputFotoEmpleado');
  if (input) input.click();
}

async function subirFotoEmpleado(input, nombreEmp) {
  const file = input.files[0];
  if (!file) return;

  if (file.size > 3 * 1024 * 1024) {
    showToast('La foto no puede superar 3MB', 'error');
    input.value = '';
    return;
  }

  showToast('Subiendo foto…');

  try {
    // 1 — Subir a ImgBB
    const formData = new FormData();
    formData.append('image', file);
    formData.append('key', IMGBB_API_KEY);

    const imgbbResp = await fetch('https://api.imgbb.com/1/upload', {
      method: 'POST',
      body: formData
    });
    const imgbbData = await imgbbResp.json();
    if (!imgbbData.success) throw new Error('Error subiendo a ImgBB');

    const fotoUrl = imgbbData.data.url;

    // 2 — Guardar URL en el Apps Script (GET simple, sin base64)
    const scriptUrl = `${APPS_SCRIPT_URL}?accion=guardar_foto_url` +
      `&empleado=${encodeURIComponent(nombreEmp)}` +
      `&foto_url=${encodeURIComponent(fotoUrl)}`;

    const resp = await fetch(scriptUrl);
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Error guardando URL');

    // 3 — Actualizar avatar en pantalla
    const avatarDiv = document.getElementById('empVistaAvatarDiv');
    if (avatarDiv) {
      avatarDiv.className = 'emp-vista-avatar emp-avatar-foto';
      avatarDiv.style.background = '';
      avatarDiv.innerHTML = `<img src="${fotoUrl}" alt="${nombreEmp}"
        style="width:100%;height:100%;object-fit:cover;border-radius:50%;"
        onerror="this.parentElement.innerHTML='?'">`;
    }

    // 4 — Actualizar cache local
    if (EMPLEADOS_PERFILES[nombreEmp]) {
      EMPLEADOS_PERFILES[nombreEmp].foto_url = fotoUrl;
    }

    showToast('✓ Foto actualizada');
  } catch(err) {
    showToast('Error al subir la foto: ' + err.message, 'error');
  } finally {
    input.value = '';
  }
}

// ══════════════════════════════════════════════════════
//  VACACIONES — Sistema completo
// ══════════════════════════════════════════════════════

// Cache en memoria
let _vacCache = {};          // { empleado: { banco, usado, ajuste, disponible } }
let _solicitudesCache = [];  // [ { id, empleado, desde, hasta, dias, estado, fechaSolicitud, notaAdmin } ]
let _configCache = {};       // { email_admin, ... }

// ── HELPERS ───────────────────────────────────────────
function vacApiUrl(accion, params) {
  let url = `${APPS_SCRIPT_URL}?accion=${accion}`;
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        url += `&${k}=${encodeURIComponent(v)}`;
      }
    });
  }
  return url;
}

function formatFechaISO(isoStr) {
  if (!isoStr) return '—';
  const [y, m, d] = isoStr.split('-').map(Number);
  return new Date(y, m-1, d).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
}

function estadoBadge(estado) {
  const map = {
    pendiente:  { bg:'#fef3c7', color:'#92400e', label:'Pendiente' },
    aprobada:   { bg:'#d1fae5', color:'#065f46', label:'Aprobada'  },
    rechazada:  { bg:'#fee2e2', color:'#991b1b', label:'Rechazada' },
  };
  const e = map[estado] || { bg:'#f1f5f9', color:'#475569', label: estado };
  return `<span style="background:${e.bg};color:${e.color};padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600">${e.label}</span>`;
}

// ── CONFIG ────────────────────────────────────────────
async function cargarConfigAdmin() {
  try {
    const resp = await fetch(vacApiUrl('get_config'));
    const json = await resp.json();
    if (json.ok) {
      _configCache = json.config || {};
      const el = document.getElementById('cfgEmailAdmin');
      if (el) el.value = _configCache.email_admin || '';
    }
  } catch(e) { console.warn('Error cargando config:', e); }
}

async function guardarConfigAdmin() {
  const email = document.getElementById('cfgEmailAdmin')?.value.trim();
  const statusEl = document.getElementById('cfgStatus');
  try {
    const resp = await fetch(vacApiUrl('guardar_config', { clave: 'email_admin', valor: email }));
    const json = await resp.json();
    if (json.ok) {
      _configCache.email_admin = email;
      if (statusEl) { statusEl.textContent = '✓ Guardado'; statusEl.style.color='#065f46'; statusEl.style.display='block'; }
      setTimeout(() => { if (statusEl) statusEl.style.display='none'; }, 2500);
    } else throw new Error(json.error);
  } catch(e) {
    if (statusEl) { statusEl.textContent = 'Error al guardar: ' + e.message; statusEl.style.color='#dc2626'; statusEl.style.display='block'; }
  }
}

// ── VACACIONES: BANCO DE DÍAS ──────────────────────────
async function cargarVacacionesAdmin(nombreEmp) {
  const container = document.getElementById('vacAdminContent_inner');
  if (!container) return;
  container.innerHTML = '<p style="color:#94a3b8;font-size:13px">Cargando...</p>';
  const anioActual = new Date().getFullYear();
  try {
    const [respVac, respSol] = await Promise.all([
      fetch(vacApiUrl('get_vacaciones', { empleado: nombreEmp, anio: anioActual })),
      fetch(vacApiUrl('get_solicitudes_vac', { empleado: nombreEmp })),
    ]);
    const [jVac, jSol] = await Promise.all([respVac.json(), respSol.json()]);
    const vac = jVac.ok ? (jVac.vacaciones?.[0] || null) : null;
    const sols = jSol.ok ? (jSol.solicitudes || []) : [];
    container.innerHTML = renderVacacionesAdminHTML(nombreEmp, vac, sols, anioActual);
  } catch(e) {
    container.innerHTML = `<p style="color:#dc2626;font-size:13px">Error: ${e.message}</p>`;
  }
}

function renderVacacionesAdminHTML(nombreEmp, vac, solicitudes, anio) {
  const banco     = vac?.dias_banco     ?? '—';
  const usado     = vac?.dias_usados    ?? '—';
  const ajuste    = vac?.dias_ajuste    ?? 0;
  const disponible= vac?.dias_disponibles ?? '—';
  const empEnc    = encodeURIComponent(nombreEmp).replace(/'/g,"\\'");

  const solicsRows = solicitudes.length
    ? solicitudes.map(s => `
      <tr>
        <td>${formatFechaISO(s.fecha_desde)} – ${formatFechaISO(s.fecha_hasta)}</td>
        <td style="text-align:center">${s.dias}</td>
        <td>${estadoBadge(s.estado)}</td>
        <td style="font-size:11px;color:#64748b">${s.nota_admin || '—'}</td>
        <td>
          ${s.estado === 'pendiente' ? `
            <div style="display:flex;gap:6px">
              <button class="btn-admin-edit" style="background:#d1fae5;color:#065f46;border-color:#6ee7b7"
                onclick="responderSolicitudAdmin('${s.id}','aprobada','')">✓ Aprobar</button>
              <button class="btn-admin-edit" style="background:#fee2e2;color:#991b1b;border-color:#fca5a5"
                onclick="abrirModalRespuesta('${s.id}','rechazada','${empEnc}')">✗ Rechazar</button>
            </div>` : '—'}
        </td>
      </tr>`).join('')
    : `<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:1.5rem;font-size:13px">Sin solicitudes</td></tr>`;

  return `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:1.5rem">
      <div class="detalle-stat"><span class="detalle-stat-val">${banco}</span><span class="detalle-stat-lbl">Días banco</span></div>
      <div class="detalle-stat"><span class="detalle-stat-val">${usado}</span><span class="detalle-stat-lbl">Usados</span></div>
      <div class="detalle-stat"><span class="detalle-stat-val" style="color:${ajuste>=0?'#059669':'#dc2626'}">${ajuste>=0?'+':''}${ajuste}</span><span class="detalle-stat-lbl">Ajuste</span></div>
      <div class="detalle-stat"><span class="detalle-stat-val" style="color:#2563eb">${disponible}</span><span class="detalle-stat-lbl">Disponibles</span></div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:1.5rem;flex-wrap:wrap">
      <button class="btn-detalle-accion" onclick="abrirModalAjusteAdmin('${empEnc}',${anio})">
        ± Ajustar días
      </button>
      <button class="btn-detalle-accion" onclick="inicializarVacAdmin(${anio})">
        ↺ Inicializar año ${anio}
      </button>
    </div>
    <h4 style="font-size:13px;font-weight:600;color:#374151;margin-bottom:0.75rem">Solicitudes</h4>
    <div class="admin-table-wrap">
      <table class="admin-tabla">
        <thead><tr><th>Período</th><th style="text-align:center">Días</th><th>Estado</th><th>Nota admin</th><th></th></tr></thead>
        <tbody>${solicsRows}</tbody>
      </table>
    </div>`;
}

// ── VACACIONES EMPLEADO (vista propia) ─────────────────
async function cargarVacacionesEmpleado(nombreEmp) {
  const container = document.getElementById('evTabVacaciones');
  if (!container) return;
  const anio = new Date().getFullYear();
  try {
    const [respVac, respSol] = await Promise.all([
      fetch(vacApiUrl('get_vacaciones', { empleado: nombreEmp, anio })),
      fetch(vacApiUrl('get_solicitudes_vac', { empleado: nombreEmp })),
    ]);
    const [jVac, jSol] = await Promise.all([respVac.json(), respSol.json()]);
    const vac  = jVac.ok  ? (jVac.vacaciones?.[0]   || null) : null;
    const sols = jSol.ok  ? (jSol.solicitudes || []) : [];
    container.innerHTML = renderVacacionesEmpleadoHTML(nombreEmp, vac, sols);
    actualizarBadgeCampanaEmp(nombreEmp);
  } catch(e) {
    container.innerHTML = `<p style="color:#dc2626;font-size:13px">Error al cargar vacaciones: ${e.message}</p>`;
  }
}

function renderVacacionesEmpleadoHTML(nombreEmp, vac, solicitudes) {
  const banco      = vac?.dias_banco       ?? '—';
  const usado      = vac?.dias_usados      ?? '—';
  const disponible = vac?.dias_disponibles ?? '—';
  const empEnc     = encodeURIComponent(nombreEmp).replace(/'/g,"\\'");

  const solicsRows = solicitudes.length
    ? solicitudes.map(s => `
      <div class="ev-card" style="margin-bottom:8px;padding:12px 16px;border-left:3px solid ${
        s.estado==='aprobada'?'#059669':s.estado==='rechazada'?'#dc2626':'#f59e0b'}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <div>
            <div style="font-size:13px;font-weight:500">${formatFechaISO(s.fecha_desde)} — ${formatFechaISO(s.fecha_hasta)}</div>
            <div style="font-size:12px;color:#64748b;margin-top:2px">${s.dias} días corridos</div>
            ${s.nota_admin ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px">Nota: ${s.nota_admin}</div>` : ''}
          </div>
          ${estadoBadge(s.estado)}
        </div>
      </div>`).join('')
    : `<p style="color:#94a3b8;font-size:13px">No tenés solicitudes.</p>`;

  return `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1.5rem">
      <div class="detalle-stat"><span class="detalle-stat-val">${banco}</span><span class="detalle-stat-lbl">Días banco</span></div>
      <div class="detalle-stat"><span class="detalle-stat-val">${usado}</span><span class="detalle-stat-lbl">Usados</span></div>
      <div class="detalle-stat"><span class="detalle-stat-val" style="color:#2563eb">${disponible}</span><span class="detalle-stat-lbl">Disponibles</span></div>
    </div>
    <button class="btn-connect" style="width:auto;padding:10px 24px;margin-bottom:1.5rem;font-size:13px"
      onclick="abrirModalSolicitudVac('${empEnc}')">
      + Solicitar vacaciones
    </button>
    <h4 style="font-size:13px;font-weight:600;color:#374151;margin-bottom:0.75rem">Mis solicitudes</h4>
    ${solicsRows}`;
}

// ── SOLICITUDES GLOBALES (tab admin) ──────────────────
async function cargarSolicitudesAdmin() {
  const container = document.getElementById('vacSolicitudesContainer');
  if (!container) return;
  if (_vacSolicitudesCache === null) {
    container.innerHTML = '<div style="padding:1.5rem"><p style="color:#94a3b8;font-size:13px">Cargando...</p></div>';
  }
  try {
    const todas = await fetchSolicitudesCache(false);
    const sols = todas.filter(function(s) { return s.estado === 'pendiente'; });

    // Badge de pendientes
    const badge = document.getElementById('vacPendBadge');
    const tabBtn = document.getElementById('vacTabSolicitudesBtn');
    if (badge) {
      if (sols.length > 0) { badge.textContent = sols.length + ' pendiente' + (sols.length > 1 ? 's' : ''); badge.style.display = ''; }
      else badge.style.display = 'none';
    }
    if (tabBtn) tabBtn.textContent = 'Solicitudes pendientes' + (sols.length ? ' (' + sols.length + ')' : '');

    if (!sols.length) {
      container.innerHTML = '<div style="padding:2rem;text-align:center;color:#94a3b8;font-size:14px">No hay solicitudes pendientes 🎉</div>';
      return;
    }

    const rows = sols.map(s => {
      const partes = s.fecha_desde ? s.fecha_desde.split('-') : [];
      const mesIdx  = partes.length >= 2 ? parseInt(partes[1]) - 1 : 0;
      const anioSol = partes.length >= 1 ? parseInt(partes[0]) : new Date().getFullYear();
      return `
      <tr>
        <td><strong>${s.empleado.replace(/^\d+\s+/,'')}</strong></td>
        <td>${formatFechaISO(s.fecha_desde)} – ${formatFechaISO(s.fecha_hasta)}</td>
        <td style="text-align:center">${s.dias}</td>
        <td style="font-size:11px;color:#64748b">${s.fecha_solicitud ? formatFechaISO(s.fecha_solicitud.substring(0,10)) : '—'}</td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn-admin-edit" style="background:#d1fae5;color:#065f46;border-color:#6ee7b7"
              onclick="responderSolicitudAdmin('${s.id}','aprobada','')">✓ Aprobar</button>
            <button class="btn-admin-edit" style="background:#fee2e2;color:#991b1b;border-color:#fca5a5"
              onclick="abrirModalRespuesta('${s.id}','rechazada','${encodeURIComponent(s.empleado)}')">✗ Rechazar</button>
            <button class="btn-admin-edit" style="font-size:11px"
              onclick="_calVacMes=${mesIdx};_calVacAnio=${anioSol};switchVacTab('calendario',document.querySelector('#vacTabs .admin-tab'));setTimeout(cargarCalendarioVacaciones,50)">📅 Ver</button>
          </div>
        </td>
      </tr>`;
    }).join('');

    container.innerHTML = `
      <div class="admin-table-wrap" style="padding:1.5rem 0 0">
        <table class="admin-tabla">
          <thead><tr><th>Empleado</th><th>Período</th><th style="text-align:center">Días</th><th>Solicitado</th><th>Acciones</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  } catch(e) {
    container.innerHTML = `<div style="padding:1.5rem"><p style="color:#dc2626;font-size:13px">Error: ${e.message}</p></div>`;
  }
}

// ── MODALES ───────────────────────────────────────────
function abrirModalAjusteAdmin(empEnc, anio) {
  const nombreEmp = decodeURIComponent(empEnc);
  const nomMostrar = nombreEmp.replace(/^\d+\s+/,'');
  const html = `
  <div class="admin-overlay" id="adminOverlay" onclick="cerrarAdmin(event)">
    <div class="admin-panel admin-panel-sm" onclick="event.stopPropagation()">
      <div class="admin-header">
        <div class="admin-titulo">Ajustar días — ${nomMostrar}</div>
        <button class="detalle-close" onclick="cerrarAdmin()">✕</button>
      </div>
      <div class="admin-form">
        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Ajuste de días (positivo suma, negativo resta)</label>
          <input type="number" class="admin-input" id="ajusteDias" value="0" step="1" placeholder="Ej: 3 o -2" />
        </div>
        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Motivo / Nota</label>
          <input type="text" class="admin-input" id="ajusteNota" placeholder="Ej: Acuerdo especial" />
        </div>
        <p id="ajusteError" style="color:#dc2626;font-size:12px;display:none;margin-bottom:0.5rem"></p>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:1.5rem">
          <button class="btn-connect" style="margin:0" onclick="confirmarAjusteAdmin('${empEnc}',${anio})">Guardar ajuste</button>
          <button class="btn-demo" onclick="cerrarAdmin()">Cancelar</button>
        </div>
      </div>
    </div>
  </div>`;
  montarOverlayAdmin(html);
}

async function confirmarAjusteAdmin(empEnc, anio) {
  const nombreEmp = decodeURIComponent(empEnc);
  const ajuste = parseInt(document.getElementById('ajusteDias')?.value) || 0;
  const nota   = document.getElementById('ajusteNota')?.value.trim();
  const errEl  = document.getElementById('ajusteError');
  if (ajuste === 0) { errEl.textContent='El ajuste no puede ser 0'; errEl.style.display='block'; return; }
  try {
    const resp = await fetch(vacApiUrl('ajustar_vac', {
      empleado: nombreEmp, anio, ajuste, nota
    }));
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Error');
    cerrarAdmin();
    showToast('✓ Ajuste guardado');
    cargarVacacionesAdmin(nombreEmp);
  } catch(e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  }
}

async function inicializarVacAdmin(anio) {
  if (!confirm(`¿Inicializar banco de vacaciones ${anio} para todos los empleados?`)) return;
  showToast('Procesando...');
  try {
    const resp = await fetch(vacApiUrl('inicializar_vac', { anio }));
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Error');
    showToast(`✓ Banco ${anio} inicializado para ${json.total || 'todos los'} empleados`);
  } catch(e) {
    showToast('Error: ' + e.message, 'error');
  }
}

function abrirModalRespuesta(solicitudId, estado, empEnc) {
  const html = `
  <div class="admin-overlay" id="adminOverlay" onclick="cerrarAdmin(event)">
    <div class="admin-panel admin-panel-sm" onclick="event.stopPropagation()">
      <div class="admin-header">
        <div class="admin-titulo">${estado === 'rechazada' ? 'Rechazar solicitud' : 'Responder solicitud'}</div>
        <button class="detalle-close" onclick="cerrarAdmin()">✕</button>
      </div>
      <div class="admin-form">
        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Nota para el empleado (opcional)</label>
          <input type="text" class="admin-input" id="respuestaNota" placeholder="Ej: Reagendar para enero" />
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:1.5rem">
          <button class="btn-connect" style="margin:0;${estado==='rechazada'?'background:#dc2626;':'background:#059669;'}"
            onclick="responderSolicitudAdmin('${solicitudId}','${estado}',document.getElementById('respuestaNota').value)">
            ${estado === 'rechazada' ? '✗ Confirmar rechazo' : '✓ Confirmar aprobación'}
          </button>
          <button class="btn-demo" onclick="cerrarAdmin()">Cancelar</button>
        </div>
      </div>
    </div>
  </div>`;
  montarOverlayAdmin(html);
}

async function responderSolicitudAdmin(id, estado, nota) {
  try {
    const resp = await fetch(vacApiUrl('responder_solicitud', { id, estado, nota_admin: nota || '' }));
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Error');
    cerrarAdmin();
    showToast(estado === 'aprobada' ? '✓ Solicitud aprobada' : '✗ Solicitud rechazada');
    // Recargar según contexto
    _vacSolicitudesCache = null; // invalidar cache
    const vacView = document.getElementById('viewVacaciones');
    if (vacView && vacView.classList.contains('active')) renderVacacionesView();
    // Si hay vacAdminContent_inner visible, recargar también
    const inner = document.getElementById('vacAdminContent_inner');
    if (inner) {
      const tituloEl = document.querySelector('.detalle-titulo');
      if (tituloEl) {
        const nomDiv = tituloEl.textContent.trim().replace(/^#\d+\s*/,'').trim();
        const empNombre = state.datos.find(r => r.EMPLEADO.replace(/^\d+\s+/,'').trim().toLowerCase() === nomDiv.toLowerCase())?.EMPLEADO || nomDiv;
        cargarVacacionesAdmin(empNombre);
      }
    }
  } catch(e) {
    showToast('Error: ' + e.message, 'error');
  }
}

// ── MODAL SOLICITAR VACACIONES (empleado) ─────────────
function abrirModalSolicitudVac(empEnc) {
  const nombreEmp = decodeURIComponent(empEnc);
  const hoy = new Date();
  const hoyISO = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-${String(hoy.getDate()).padStart(2,'0')}`;
  const html = `
  <div class="admin-overlay" id="adminOverlay" onclick="cerrarAdmin(event)">
    <div class="admin-panel admin-panel-sm" onclick="event.stopPropagation()">
      <div class="admin-header">
        <div class="admin-titulo">Solicitar vacaciones</div>
        <button class="detalle-close" onclick="cerrarAdmin()">✕</button>
      </div>
      <div class="admin-form">
        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Fecha desde</label>
          <input type="date" class="admin-input" id="vacDesde" value="${hoyISO}"
            onchange="calcularDiasVacForm()" min="${hoyISO}" />
        </div>
        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Fecha hasta</label>
          <input type="date" class="admin-input" id="vacHasta" value="${hoyISO}"
            onchange="calcularDiasVacForm()" min="${hoyISO}" />
        </div>
        <div class="admin-form-grupo">
          <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#eff6ff;border-radius:8px;border:1px solid #bfdbfe">
            <span style="font-size:13px;color:#374151">Días corridos:</span>
            <span id="diasVacCalc" style="font-size:18px;font-weight:700;color:#2563eb">1</span>
          </div>
          <span style="font-size:11px;color:#94a3b8;margin-top:4px;display:block">
            Se cuentan días corridos (incluyendo fines de semana y feriados, según ley argentina)
          </span>
        </div>
        <p id="vacSolError" style="color:#dc2626;font-size:12px;display:none;margin-bottom:0.5rem"></p>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:1.5rem">
          <button class="btn-connect" style="margin:0" onclick="confirmarSolicitudVac('${empEnc}')">Enviar solicitud</button>
          <button class="btn-demo" onclick="cerrarAdmin()">Cancelar</button>
        </div>
      </div>
    </div>
  </div>`;
  montarOverlayAdmin(html);
  calcularDiasVacForm();
}

function calcularDiasVacForm() {
  const desde = document.getElementById('vacDesde')?.value;
  const hasta = document.getElementById('vacHasta')?.value;
  const el    = document.getElementById('diasVacCalc');
  if (!desde || !hasta || !el) return;
  const [dy,dm,dd] = desde.split('-').map(Number);
  const [hy,hm,hd] = hasta.split('-').map(Number);
  const dDesde = new Date(dy,dm-1,dd);
  const dHasta = new Date(hy,hm-1,hd);
  const dias = Math.max(1, Math.round((dHasta - dDesde) / 86400000) + 1);
  el.textContent = dias;
  return dias;
}

async function confirmarSolicitudVac(empEnc) {
  const nombreEmp = decodeURIComponent(empEnc);
  const desde  = document.getElementById('vacDesde')?.value;
  const hasta  = document.getElementById('vacHasta')?.value;
  const errEl  = document.getElementById('vacSolError');
  if (!desde || !hasta) { errEl.textContent='Seleccioná las fechas'; errEl.style.display='block'; return; }
  const [dy,dm,dd] = desde.split('-').map(Number);
  const [hy,hm,hd] = hasta.split('-').map(Number);
  if (new Date(hy,hm-1,hd) < new Date(dy,dm-1,dd)) {
    errEl.textContent='La fecha hasta debe ser posterior a la fecha desde'; errEl.style.display='block'; return;
  }
  const dias = calcularDiasVacForm();
  const datos = encodeURIComponent(JSON.stringify({ empleado: nombreEmp, fecha_desde: desde, fecha_hasta: hasta, dias }));
  try {
    const resp = await fetch(`${APPS_SCRIPT_URL}?accion=solicitar_vac&datos=${datos}`);
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Error');
    _vacSolicitudesCache = null; // invalidar cache
    cerrarAdmin();
    showToast('✓ Solicitud enviada — quedá pendiente de aprobación');
    cargarVacacionesEmpleado(nombreEmp);
  } catch(e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  }
}

// ── SWITCH TAB VISTA EMPLEADO ─────────────────────────
function switchEvTab(tab, btn) {
  document.querySelectorAll('.emp-vista-personal .detalle-tabs .detalle-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const jornada    = document.getElementById('evTabJornada');
  const vacaciones = document.getElementById('evTabVacaciones');
  if (jornada)    jornada.style.display    = tab === 'jornada'    ? 'block' : 'none';
  if (vacaciones) vacaciones.style.display = tab === 'vacaciones' ? 'block' : 'none';
}


// ══════════════════════════════════════════════════════
//  CAMPANA DE NOTIFICACIONES
// ══════════════════════════════════════════════════════

async function actualizarBadgeCampana() {
  try {
    const resp = await fetch(vacApiUrl('get_solicitudes_vac', { estado: 'pendiente' }));
    const json = await resp.json();
    const n = json.ok ? (json.solicitudes || []).length : 0;
    const badge = document.getElementById('bellBadge');
    if (!badge) return;
    if (n > 0) {
      badge.textContent = n;
      badge.style.display = 'flex';
      document.getElementById('btnBell')?.classList.add('bell-active');
    } else {
      badge.style.display = 'none';
      document.getElementById('btnBell')?.classList.remove('bell-active');
    }
    const tabBtn = document.getElementById('adminTabSolicitudesBtn');
    if (tabBtn) tabBtn.textContent = 'Solicitudes' + (n ? ' (' + n + ')' : '');
  } catch(e) {}
}

function toggleBellDropdown() {
  const existing = document.getElementById('bellDropdown');
  if (existing) { existing.remove(); return; }
  const dd = document.createElement('div');
  dd.id = 'bellDropdown';
  dd.className = 'bell-dropdown';
  dd.innerHTML = '<div class="bell-dd-loading">Cargando...</div>';
  document.getElementById('bellWrap').appendChild(dd);
  fetch(vacApiUrl('get_solicitudes_vac', { estado: 'pendiente' }))
    .then(function(r) { return r.json(); })
    .then(function(json) {
      const sols = json.ok ? (json.solicitudes || []) : [];
      if (!sols.length) {
        dd.innerHTML = '<div class="bell-dd-empty">No hay solicitudes pendientes</div>';
        return;
      }
      const rows = sols.slice(0,5).map(function(s) {
        const nom = s.empleado.replace(/^\d+\s+/, '');
        // Calcular mes/año de la solicitud para saltar al calendario
        const partes = s.fecha_desde ? s.fecha_desde.split('-') : [];
        const mesIdx  = partes.length >= 2 ? parseInt(partes[1]) - 1 : _calVacMes;
        const anioSol = partes.length >= 1 ? parseInt(partes[0]) : _calVacAnio;
        return '<div class="bell-dd-item">' +
          '<div style="flex:1">' +
            '<strong>' + nom + '</strong>' +
            '<div style="font-size:11px;color:#64748b">' + formatFechaISO(s.fecha_desde) + ' - ' + formatFechaISO(s.fecha_hasta) + ' · ' + s.dias + ' días</div>' +
            '<button class="bell-dd-cal-btn" onclick="_calVacMes=' + mesIdx + ';_calVacAnio=' + anioSol + ';setView(\'vacaciones\');document.getElementById(\'bellDropdown\')?.remove()">📅 Ver en calendario</button>' +
          '</div>' +
          '<div style="display:flex;flex-direction:column;gap:3px">' +
            '<button class="btn-admin-edit" style="background:#d1fae5;color:#065f46;border-color:#6ee7b7;font-size:11px" ' +
              'onclick="responderSolicitudAdmin(\'' + s.id + '\',\'aprobada\',\'\');actualizarBadgeCampana();document.getElementById(\'bellDropdown\')?.remove()">✓ Aprobar</button>' +
            '<button class="btn-admin-edit" style="background:#fee2e2;color:#991b1b;border-color:#fca5a5;font-size:11px" ' +
              'onclick="abrirModalRespuesta(\'' + s.id + '\',\'rechazada\',\'' + encodeURIComponent(s.empleado) + '\');document.getElementById(\'bellDropdown\')?.remove()">✗ Rechazar</button>' +
          '</div>' +
        '</div>';
      }).join('');
      dd.innerHTML = '<div class="bell-dd-title">Solicitudes pendientes</div>' + rows +
        '<div class="bell-dd-more" onclick="setView(\'vacaciones\');document.getElementById(\'bellDropdown\')?.remove()">' +
          (sols.length > 5 ? 'Ver todas (' + sols.length + ') →' : 'Ir a Vacaciones →') +
        '</div>';
    }).catch(function() { dd.innerHTML = '<div class="bell-dd-empty">Error al cargar</div>'; });
  setTimeout(function() {
    document.addEventListener('click', function handler(e) {
      if (!e.target.closest('#bellDropdown') && !e.target.closest('#btnBell')) {
        const el = document.getElementById('bellDropdown');
        if (el) el.remove();
        document.removeEventListener('click', handler);
      }
    });
  }, 50);
}

var _bellEmpNombre = null;
var _bellEmpLeidos = new Set(JSON.parse(localStorage.getItem('croma_bell_leidos') || '[]'));

async function actualizarBadgeCampanaEmp(nombreEmp) {
  _bellEmpNombre = nombreEmp;
  try {
    const resp = await fetch(vacApiUrl('get_solicitudes_vac', { empleado: nombreEmp }));
    const json = await resp.json();
    const sols = json.ok ? (json.solicitudes || []) : [];
    const noLeidas = sols.filter(function(s) {
      return (s.estado === 'aprobada' || s.estado === 'rechazada') && !_bellEmpLeidos.has(s.id);
    });
    const badge = document.getElementById('bellBadgeEmp');
    if (!badge) return;
    badge.textContent = noLeidas.length;
    badge.style.display = noLeidas.length > 0 ? 'flex' : 'none';
  } catch(e) {}
}

function toggleBellDropdownEmp() {
  const existing = document.getElementById('bellDropdownEmp');
  if (existing) { existing.remove(); return; }
  const dd = document.createElement('div');
  dd.id = 'bellDropdownEmp';
  dd.className = 'bell-dropdown';
  dd.innerHTML = '<div class="bell-dd-loading">Cargando...</div>';
  document.getElementById('bellWrapEmp').appendChild(dd);
  const nombre = _bellEmpNombre || (sesionActual && sesionActual.empleadoNombre) || '';
  fetch(vacApiUrl('get_solicitudes_vac', { empleado: nombre }))
    .then(function(r) { return r.json(); })
    .then(function(json) {
      const sols = (json.ok ? json.solicitudes || [] : []).filter(function(s) {
        return s.estado === 'aprobada' || s.estado === 'rechazada';
      });
      sols.forEach(function(s) { _bellEmpLeidos.add(s.id); });
      localStorage.setItem('croma_bell_leidos', JSON.stringify(Array.from(_bellEmpLeidos)));
      const badge = document.getElementById('bellBadgeEmp');
      if (badge) badge.style.display = 'none';
      if (!sols.length) {
        dd.innerHTML = '<div class="bell-dd-empty">Sin novedades en tus solicitudes</div>';
        return;
      }
      const rows = sols.slice(0,5).map(function(s) {
        return '<div class="bell-dd-item">' +
          '<div><div style="font-size:12px">' + formatFechaISO(s.fecha_desde) + ' - ' + formatFechaISO(s.fecha_hasta) + '</div>' +
          '<div style="font-size:11px;color:#64748b">' + s.dias + ' dias</div>' +
          (s.nota_admin ? '<div style="font-size:11px;color:#94a3b8">' + s.nota_admin + '</div>' : '') + '</div>' +
          estadoBadge(s.estado) +
          '</div>';
      }).join('');
      dd.innerHTML = '<div class="bell-dd-title">Tus solicitudes</div>' + rows;
    }).catch(function() { dd.innerHTML = '<div class="bell-dd-empty">Error al cargar</div>'; });
  setTimeout(function() {
    document.addEventListener('click', function handler(e) {
      if (!e.target.closest('#bellDropdownEmp') && !e.target.closest('#btnBellEmp')) {
        const el = document.getElementById('bellDropdownEmp');
        if (el) el.remove();
        document.removeEventListener('click', handler);
      }
    });
  }, 50);
}

// ══════════════════════════════════════════════════════
//  CALENDARIO DE VACACIONES (admin)
// ══════════════════════════════════════════════════════

var _calVacMes  = new Date().getMonth();
var _calVacAnio = new Date().getFullYear();
var _calVacFiltroLocal = 'all';

async function cargarCalendarioVacaciones() {
  const container = document.getElementById('vacCalendarioContainer');
  if (!container) return;
  // Solo mostrar spinner si no hay cache aún
  if (_vacSolicitudesCache === null) {
    container.innerHTML = '<div style="padding:1.5rem"><p style="color:#94a3b8;font-size:13px">Cargando...</p></div>';
  }
  try {
    const todas = await fetchSolicitudesCache(false);
    renderCalendarioVacaciones(container, todas.filter(function(s) {
      return s.estado === 'aprobada' || s.estado === 'pendiente';
    }));
  } catch(e) {
    container.innerHTML = '<div style="padding:1.5rem"><p style="color:#dc2626;font-size:13px">Error: ' + e.message + '</p></div>';
  }
}

function renderCalendarioVacaciones(container, solicitudes) {
  // Selectores de mes y año
  const aniosDisponibles = [2024, 2025, 2026, 2027];
  const mesOpts = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
    .map(function(m, i) { return '<option value="' + i + '"' + (_calVacMes === i ? ' selected' : '') + '>' + m + '</option>'; }).join('');
  const anioOpts = aniosDisponibles
    .map(function(a) { return '<option value="' + a + '"' + (_calVacAnio === a ? ' selected' : '') + '>' + a + '</option>'; }).join('');

  const sucOpts = '<option value="all">Todos los locales</option>' +
    SUCURSALES.map(function(s) {
      return '<option value="' + s.id + '"' + (_calVacFiltroLocal === s.id ? ' selected' : '') + '>' + s.nombre + '</option>';
    }).join('');

  const primerDia = new Date(_calVacAnio, _calVacMes, 1);
  const ultimoDia = new Date(_calVacAnio, _calVacMes + 1, 0);

  const solsFiltradas = solicitudes.filter(function(s) {
    if (_calVacFiltroLocal === 'all') return true;
    const sucEmp = (state.datos.find(function(r) { return r.EMPLEADO === s.empleado; }) || {}).LOCAL;
    return sucEmp === _calVacFiltroLocal;
  });

  function hayConflicto(empsEnFecha) {
    if (empsEnFecha.length < 2) return false;
    const grupos = {};
    empsEnFecha.forEach(function(s) {
      const local = (state.datos.find(function(r) { return r.EMPLEADO === s.empleado; }) || {}).LOCAL || 'x';
      if (!grupos[local]) grupos[local] = [];
      grupos[local].push(s);
    });
    return Object.values(grupos).some(function(g) { return g.length >= 2; });
  }

  const diasSem = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const offsetInicio = primerDia.getDay();
  let celdasHTML = '';
  for (let i = 0; i < offsetInicio; i++) {
    celdasHTML += '<div class="cal-vac-cell cal-vac-empty"></div>';
  }
  const hoyISO = new Date().toISOString().substring(0,10);
  for (let d = 1; d <= ultimoDia.getDate(); d++) {
    const fecha = new Date(_calVacAnio, _calVacMes, d);
    const isoFecha = _calVacAnio + '-' + String(_calVacMes+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    const esHoy    = isoFecha === hoyISO;
    const esFinde  = fecha.getDay() === 0 || fecha.getDay() === 6;
    const esFer    = esFeriado(fecha);
    const emps = solsFiltradas.filter(function(s) {
      return s.fecha_desde && s.fecha_hasta && isoFecha >= s.fecha_desde && isoFecha <= s.fecha_hasta;
    });
    const conflicto = hayConflicto(emps);
    const empRows = emps.map(function(s) {
      const nom   = s.empleado.replace(/^\d+\s+/, '').split(' ')[0];
      const local = (state.datos.find(function(r) { return r.EMPLEADO === s.empleado; }) || {}).LOCAL || '';
      const suc   = SUCURSALES.find(function(x) { return x.id === local; }) || { color: '#94a3b8', colorLight: '#f1f5f9' };
      const esPend = s.estado === 'pendiente';
      return '<div class="cal-vac-emp" style="background:' + suc.colorLight + ';border-left:3px solid ' + suc.color + ';' + (esPend ? 'opacity:0.6;' : '') + '">' +
        '<span style="font-size:10px;font-weight:500;color:' + suc.color + '">' + nom + (esPend ? ' ·' : '') + '</span></div>';
    }).join('');
    celdasHTML += '<div class="cal-vac-cell' +
      (esHoy     ? ' cal-vac-hoy'      : '') +
      (esFinde   ? ' cal-vac-finde'    : '') +
      (esFer     ? ' cal-vac-feriado'  : '') +
      (conflicto ? ' cal-vac-conflicto': '') + '">' +
      '<div class="cal-vac-num">' + d + (esFer ? ' <span class="cal-fer-dot" title="Feriado">🗓</span>' : '') + (conflicto ? ' <span style="color:#f59e0b">!!</span>' : '') + '</div>' +
      empRows + '</div>';
  }

  // Tabla solicitudes del mes
  const solsMes = solsFiltradas.filter(function(s) {
    if (!s.fecha_desde) return false;
    const p = s.fecha_desde.split('-').map(Number);
    return p[0] === _calVacAnio && p[1]-1 === _calVacMes;
  });

  const tablaSols = solsMes.length ? solsMes.map(function(s) {
    const nom   = s.empleado.replace(/^\d+\s+/, '');
    const local = (state.datos.find(function(r) { return r.EMPLEADO === s.empleado; }) || {}).LOCAL || '-';
    const suc   = SUCURSALES.find(function(x) { return x.id === local; }) || { nombre: local, color: '#94a3b8', colorLight: '#f1f5f9' };
    const conflictoSol = solsFiltradas.some(function(o) {
      return o.id !== s.id &&
        (state.datos.find(function(r) { return r.EMPLEADO === o.empleado; }) || {}).LOCAL === local &&
        o.fecha_desde <= s.fecha_hasta && o.fecha_hasta >= s.fecha_desde;
    });
    const partesSol = s.fecha_desde ? s.fecha_desde.split('-') : [];
    const mesSol  = partesSol.length >= 2 ? parseInt(partesSol[1]) - 1 : 0;
    const anioSol = partesSol.length >= 1 ? parseInt(partesSol[0]) : new Date().getFullYear();
    const calBtn  = '<button class="btn-admin-edit" style="font-size:11px" ' +
      'onclick="_calVacMes=' + mesSol + ';_calVacAnio=' + anioSol + ';cargarCalendarioVacaciones()">📅 Ver</button>';
    const acciones = s.estado === 'pendiente'
      ? '<div style="display:flex;gap:4px;flex-wrap:wrap">' +
          '<button class="btn-admin-edit" style="background:#d1fae5;color:#065f46;border-color:#6ee7b7" ' +
            'onclick="responderSolicitudAdmin(\'' + s.id + '\',\'aprobada\',\'\')">✓ Aprobar</button>' +
          '<button class="btn-admin-edit" style="background:#fee2e2;color:#991b1b;border-color:#fca5a5" ' +
            'onclick="abrirModalRespuesta(\'' + s.id + '\',\'rechazada\',\'' + encodeURIComponent(s.empleado) + '\')">✗ Rechazar</button>' +
          calBtn +
          '</div>'
      : calBtn;
    return '<tr>' +
      '<td><strong>' + nom + '</strong></td>' +
      '<td><span class="suc-badge-mini" style="background:' + (suc.colorLight || '#f1f5f9') + ';color:' + suc.color + '">' + suc.nombre + '</span></td>' +
      '<td>' + formatFechaISO(s.fecha_desde) + ' — ' + formatFechaISO(s.fecha_hasta) + '</td>' +
      '<td style="text-align:center">' + s.dias + '</td>' +
      '<td>' + estadoBadge(s.estado) + '</td>' +
      '<td>' + (conflictoSol ? '<span style="color:#f59e0b;font-weight:600">⚠️ Conflicto</span>' : '—') + '</td>' +
      '<td>' + acciones + '</td></tr>';
  }).join('') : '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:1.5rem;font-size:13px">Sin solicitudes en este mes</td></tr>';

  const headersSem = diasSem.map(function(d) { return '<div class="cal-vac-header">' + d + '</div>'; }).join('');

  container.innerHTML =
    '<div style="padding:1.5rem">' +
    // Toolbar: selectors + filtro local + leyenda
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:1.5rem;flex-wrap:wrap">' +
      '<div style="display:flex;align-items:center;gap:6px">' +
        '<button class="week-btn" onclick="cambiarMesCalVac(-1)">&#8592;</button>' +
        '<select class="filter-select" style="font-size:14px;font-weight:600" onchange="_calVacMes=parseInt(this.value);cargarCalendarioVacaciones()">' + mesOpts + '</select>' +
        '<select class="filter-select" style="font-size:14px;font-weight:600;width:80px" onchange="_calVacAnio=parseInt(this.value);cargarCalendarioVacaciones()">' + anioOpts + '</select>' +
        '<button class="week-btn" onclick="cambiarMesCalVac(1)">&#8594;</button>' +
      '</div>' +
      '<select class="filter-select" style="font-size:13px" onchange="_calVacFiltroLocal=this.value;cargarCalendarioVacaciones()">' + sucOpts + '</select>' +
      '<div style="display:flex;align-items:center;gap:8px;font-size:11px;color:#64748b;margin-left:auto;flex-wrap:wrap">' +
        '<span style="display:inline-flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:#d1fae5;border-left:3px solid #059669;display:inline-block"></span>Aprobada</span>' +
        '<span style="display:inline-flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:#fef9c3;border-left:3px solid #f59e0b;display:inline-block"></span>Pendiente</span>' +
        '<span style="display:inline-flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:#fef3c7;display:inline-block"></span>Feriado</span>' +
        '<span style="display:inline-flex;align-items:center;gap:4px;color:#f59e0b;font-weight:600">!! Conflicto</span>' +
      '</div>' +
    '</div>' +
    // Grilla
    '<div class="cal-vac-grid">' + headersSem + celdasHTML + '</div>' +
    // Tabla del mes
    '<h4 style="font-size:13px;font-weight:600;color:#374151;margin:1.5rem 0 0.75rem">Solicitudes del mes</h4>' +
    '<div class="admin-table-wrap">' +
      '<table class="admin-tabla">' +
        '<thead><tr><th>Empleado</th><th>Local</th><th>Período</th><th style="text-align:center">Días</th><th>Estado</th><th>Conflicto</th><th></th></tr></thead>' +
        '<tbody>' + tablaSols + '</tbody>' +
      '</table>' +
    '</div>' +
    '</div>';
}

function cambiarMesCalVac(delta) {
  _calVacMes += delta;
  if (_calVacMes > 11) { _calVacMes = 0; _calVacAnio++; }
  if (_calVacMes < 0)  { _calVacMes = 11; _calVacAnio--; }
  cargarCalendarioVacaciones();
}


// ══════════════════════════════════════════════════════
//  VISTA VACACIONES (nav principal)
// ══════════════════════════════════════════════════════

var _vacSolicitudesCache = null; // cache: null = no cargado, [] = cargado vacío

async function fetchSolicitudesCache(force) {
  if (!force && _vacSolicitudesCache !== null) return _vacSolicitudesCache;
  try {
    const resp = await fetch(vacApiUrl('get_solicitudes_vac', {}));
    const json = await resp.json();
    _vacSolicitudesCache = json.ok ? (json.solicitudes || []) : [];
  } catch(e) {
    if (_vacSolicitudesCache === null) _vacSolicitudesCache = [];
  }
  return _vacSolicitudesCache;
}

function renderVacacionesView() {
  const container = document.getElementById('vacacionesContainer');
  if (!container) return;

  container.innerHTML =
    '<div class="admin-inline-wrap">' +
    '<div class="admin-inline-header">' +
      '<div class="admin-titulo">Vacaciones</div>' +
      '<div id="vacPendBadge" style="display:none;background:#fef3c7;color:#92400e;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600"></div>' +
    '</div>' +
    '<div class="admin-tabs" id="vacTabs">' +
      '<button class="admin-tab active" onclick="switchVacTab(\'calendario\',this)">Calendario</button>' +
      '<button class="admin-tab" id="vacTabSolicitudesBtn" onclick="switchVacTab(\'solicitudes\',this)">Solicitudes pendientes</button>' +
      '<button class="admin-tab" onclick="switchVacTab(\'banco\',this)">Banco de días</button>' +
    '</div>' +
    '<div id="vacCalendarioContainer" class="admin-tab-content">' +
      '<div style="padding:1.5rem"><p style="color:#94a3b8;font-size:13px">Cargando...</p></div>' +
    '</div>' +
    '<div id="vacSolicitudesContainer" class="admin-tab-content" style="display:none">' +
      '<div style="padding:1.5rem"><p style="color:#94a3b8;font-size:13px">Cargando...</p></div>' +
    '</div>' +
    '<div id="vacBancoContainer" class="admin-tab-content" style="display:none">' +
      '<div style="padding:1.5rem"><p style="color:#94a3b8;font-size:13px">Cargando...</p></div>' +
    '</div>' +
    '</div>';

  // Cargar calendario con cache
  cargarCalendarioVacaciones();
}

function switchVacTab(tab, btn) {
  document.querySelectorAll('#vacTabs .admin-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('vacCalendarioContainer').style.display  = tab === 'calendario'  ? 'block' : 'none';
  document.getElementById('vacSolicitudesContainer').style.display = tab === 'solicitudes' ? 'block' : 'none';
  document.getElementById('vacBancoContainer').style.display       = tab === 'banco'       ? 'block' : 'none';
  if (tab === 'solicitudes') cargarSolicitudesAdmin();
  if (tab === 'banco')       cargarBancoDias();
}

// ── BANCO DE DÍAS (tab vacaciones) ───────────────────
async function cargarBancoDias() {
  const container = document.getElementById('vacBancoContainer');
  if (!container) return;
  container.innerHTML = '<div style="padding:1.5rem"><p style="color:#94a3b8;font-size:13px">Cargando...</p></div>';
  const anio = new Date().getFullYear();
  try {
    const resp = await fetch(vacApiUrl('get_vacaciones', { anio: anio }));
    const json = await resp.json();
    const vacaciones = json.ok ? (json.vacaciones || []) : [];

    // Obtener lista de empleados activos
    const empNombres = [...new Set(state.datos.map(function(r) { return r.EMPLEADO; }))].sort(function(a,b) {
      const na = parseInt(a)||999, nb = parseInt(b)||999;
      return na !== nb ? na - nb : a.localeCompare(b);
    });

    const anioOpts = [anio-1, anio, anio+1].map(function(a) {
      return '<option value="' + a + '"' + (a === anio ? ' selected' : '') + '>' + a + '</option>';
    }).join('');

    const filas = empNombres.map(function(nombre) {
      const nom = nombre.replace(/^\d+\s+/, '');
      const vac = vacaciones.find(function(v) { return v.empleado && v.empleado.replace(/^\d+\s+/,'').toLowerCase() === nom.toLowerCase(); });
      const banco     = vac ? vac.dias_banco      : '—';
      const usados    = vac ? vac.dias_usados     : '—';
      const ajuste    = vac ? vac.dias_ajuste     : 0;
      const disponible= vac ? vac.dias_disponibles: '—';
      const perfil    = EMPLEADOS_PERFILES[nombre] || {};
      const local     = (state.datos.find(function(r) { return r.EMPLEADO === nombre; }) || {}).LOCAL || perfil.sucursal_id || '';
      const suc       = SUCURSALES.find(function(s) { return s.id === local; }) || { nombre: '—', color: '#94a3b8', colorLight: '#f1f5f9' };
      const nomEnc    = encodeURIComponent(nombre);
      const dispColor = typeof disponible === 'number' ? (disponible > 7 ? '#059669' : disponible > 0 ? '#f59e0b' : '#dc2626') : '#94a3b8';
      return '<tr>' +
        '<td><strong>' + nom + '</strong></td>' +
        '<td><span class="suc-badge-mini" style="background:' + suc.colorLight + ';color:' + suc.color + '">' + suc.nombre + '</span></td>' +
        '<td style="text-align:center">' + banco + '</td>' +
        '<td style="text-align:center">' + usados + '</td>' +
        '<td style="text-align:center;color:' + (ajuste >= 0 ? '#059669' : '#dc2626') + ';font-weight:600">' + (ajuste > 0 ? '+' : '') + ajuste + '</td>' +
        '<td style="text-align:center;font-weight:700;color:' + dispColor + '">' + disponible + '</td>' +
        '<td>' +
          '<button class="btn-admin-edit" onclick="abrirModalAjusteAdmin(\'' + nomEnc + '\',' + anio + ')">± Ajustar</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    container.innerHTML =
      '<div style="padding:1.5rem">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:1rem;flex-wrap:wrap">' +
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<label style="font-size:13px;color:#64748b;font-weight:500">Año:</label>' +
          '<select class="filter-select" onchange="cargarBancoDiasAnio(parseInt(this.value))">' + anioOpts + '</select>' +
        '</div>' +
        '<button class="btn-admin-edit" onclick="inicializarVacAdmin(' + anio + ')" style="margin-left:auto">↺ Inicializar ' + anio + '</button>' +
      '</div>' +
      '<div class="admin-table-wrap">' +
        '<table class="admin-tabla">' +
          '<thead><tr>' +
            '<th>Empleado</th><th>Local</th>' +
            '<th style="text-align:center">Banco</th>' +
            '<th style="text-align:center">Usados</th>' +
            '<th style="text-align:center">Ajuste</th>' +
            '<th style="text-align:center">Disponibles</th>' +
            '<th></th>' +
          '</tr></thead>' +
          '<tbody>' + filas + '</tbody>' +
        '</table>' +
      '</div>' +
      '</div>';
  } catch(e) {
    container.innerHTML = '<div style="padding:1.5rem"><p style="color:#dc2626;font-size:13px">Error: ' + e.message + '</p></div>';
  }
}

async function cargarBancoDiasAnio(anio) {
  const container = document.getElementById('vacBancoContainer');
  if (!container) return;
  container.innerHTML = '<div style="padding:1.5rem"><p style="color:#94a3b8;font-size:13px">Cargando...</p></div>';
  try {
    const resp = await fetch(vacApiUrl('get_vacaciones', { anio: anio }));
    const json = await resp.json();
    const vacaciones = json.ok ? (json.vacaciones || []) : [];
    const empNombres = [...new Set(state.datos.map(function(r) { return r.EMPLEADO; }))].sort(function(a,b) {
      const na = parseInt(a)||999, nb = parseInt(b)||999;
      return na !== nb ? na - nb : a.localeCompare(b);
    });
    const anioOpts = [anio-1, anio, anio+1].map(function(a) {
      return '<option value="' + a + '"' + (a === anio ? ' selected' : '') + '>' + a + '</option>';
    }).join('');
    const filas = empNombres.map(function(nombre) {
      const nom = nombre.replace(/^\d+\s+/, '');
      const vac = vacaciones.find(function(v) { return v.empleado && v.empleado.replace(/^\d+\s+/,'').toLowerCase() === nom.toLowerCase(); });
      const banco     = vac ? vac.dias_banco      : '—';
      const usados    = vac ? vac.dias_usados     : '—';
      const ajuste    = vac ? vac.dias_ajuste     : 0;
      const disponible= vac ? vac.dias_disponibles: '—';
      const perfil    = EMPLEADOS_PERFILES[nombre] || {};
      const local     = (state.datos.find(function(r) { return r.EMPLEADO === nombre; }) || {}).LOCAL || perfil.sucursal_id || '';
      const suc       = SUCURSALES.find(function(s) { return s.id === local; }) || { nombre: '—', color: '#94a3b8', colorLight: '#f1f5f9' };
      const nomEnc    = encodeURIComponent(nombre);
      const dispColor = typeof disponible === 'number' ? (disponible > 7 ? '#059669' : disponible > 0 ? '#f59e0b' : '#dc2626') : '#94a3b8';
      return '<tr>' +
        '<td><strong>' + nom + '</strong></td>' +
        '<td><span class="suc-badge-mini" style="background:' + suc.colorLight + ';color:' + suc.color + '">' + suc.nombre + '</span></td>' +
        '<td style="text-align:center">' + banco + '</td>' +
        '<td style="text-align:center">' + usados + '</td>' +
        '<td style="text-align:center;color:' + (ajuste >= 0 ? '#059669' : '#dc2626') + ';font-weight:600">' + (ajuste > 0 ? '+' : '') + ajuste + '</td>' +
        '<td style="text-align:center;font-weight:700;color:' + dispColor + '">' + disponible + '</td>' +
        '<td><button class="btn-admin-edit" onclick="abrirModalAjusteAdmin(\'' + nomEnc + '\',' + anio + ')">± Ajustar</button></td>' +
      '</tr>';
    }).join('');
    container.innerHTML =
      '<div style="padding:1.5rem">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:1rem;flex-wrap:wrap">' +
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<label style="font-size:13px;color:#64748b;font-weight:500">Año:</label>' +
          '<select class="filter-select" onchange="cargarBancoDiasAnio(parseInt(this.value))">' + anioOpts + '</select>' +
        '</div>' +
        '<button class="btn-admin-edit" onclick="inicializarVacAdmin(' + anio + ')" style="margin-left:auto">↺ Inicializar ' + anio + '</button>' +
      '</div>' +
      '<div class="admin-table-wrap">' +
        '<table class="admin-tabla">' +
          '<thead><tr><th>Empleado</th><th>Local</th><th style="text-align:center">Banco</th><th style="text-align:center">Usados</th><th style="text-align:center">Ajuste</th><th style="text-align:center">Disponibles</th><th></th></tr></thead>' +
          '<tbody>' + filas + '</tbody>' +
        '</table>' +
      '</div></div>';
  } catch(e) {
    container.innerHTML = '<div style="padding:1.5rem"><p style="color:#dc2626;font-size:13px">Error: ' + e.message + '</p></div>';
  }
}
