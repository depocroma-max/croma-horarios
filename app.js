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
  verSolo: 'todos',   // 'todos' | 'feriados' | 'sabados' | 'domingos'
};

// URL fija del Apps Script (no requiere configuración manual)
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxfWe4uREUDqnOiMVMGQH3pGKZk1OdfNT8k0TyeYjZGyiFuNE4j5AM3pRkQWcG8Hcy6/exec';

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
  const selPeriodo = document.getElementById('empFiltPeriodo')?.value || 'all';
  const selLocal   = document.getElementById('empFiltLocal')?.value   || 'all';
  const selEmp     = document.getElementById('empFiltEmp')?.value     || 'all';
  const selEmpresa = document.getElementById('empFiltEmpresa')?.value || 'all';

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

  // Aplicar filtro de día (ver solo sábados / feriados / domingos)
  if (filtrosDia.verSolo !== 'todos') {
    datosFilt = datosFilt.filter(r => {
      const fecha = new Date(r.AÑO, MESES_ES.indexOf(r.MES), parseInt(r.DIA));
      if (filtrosDia.verSolo === 'sabados')  return fecha.getDay() === 6;
      if (filtrosDia.verSolo === 'domingos') return fecha.getDay() === 0;
      if (filtrosDia.verSolo === 'feriados') return esFeriado(fecha);
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
      <div class="emp-card-footer">Ver jornada completa →</div>
    </div>`;
  }).join('');

  const chkFer = filtrosDia.verSolo === 'feriados';
  const chkSab = filtrosDia.verSolo === 'sabados';
  const chkDom = filtrosDia.verSolo === 'domingos';

  const empresaOpts = [`<option value="all">Todas las empresas</option>`,
    ...EMPRESAS.map(emp => `<option value="${emp}" ${emp === selEmpresa ? 'selected' : ''}>${emp}</option>`)
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
        </div>
      </div>
      <div class="emp-filtro-grupo">
        <label class="emp-filtro-label">Período</label>
        <select class="emp-filtro-select" id="empFiltPeriodo" onchange="renderEmpleados(state.datos)">
          ${periodoOpts}
        </select>
      </div>
      <div class="emp-filtro-grupo">
        <label class="emp-filtro-label">Empresa</label>
        <select class="emp-filtro-select" id="empFiltEmpresa" onchange="renderEmpleados(state.datos)">
          ${empresaOpts}
        </select>
      </div>
      <div class="emp-filtro-grupo">
        <label class="emp-filtro-label">Local</label>
        <select class="emp-filtro-select" id="empFiltLocal" onchange="empCambioLocal()">
          ${localOpts}
        </select>
      </div>
      <div class="emp-filtro-grupo">
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
function abrirDetalleEmpleado(nombreEmp, sucId) {
  abrirDetalleEmpleadoConDatos(nombreEmp, sucId, state.datos.filter(r => r.EMPLEADO === nombreEmp));
}

function abrirDetalleEmpleadoDesdePanel(nombreEmp, sucId) {
  // Leer el período seleccionado en el panel de empleados (formato: "2026||ABRIL")
  const selPeriodo = document.getElementById('empFiltPeriodo')?.value || 'all';
  const registros  = state.datos.filter(r => r.EMPLEADO === nombreEmp);
  let periodoForzado = null;
  if (selPeriodo !== 'all') {
    const [anio, mes] = selPeriodo.split('||');
    periodoForzado = mes + ' ' + anio; // convierte a "ABRIL 2026"
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

      return { fechaStr, diaSem, horaReg, turno1, turno2, hsTotal, hsExtra, esSab, esDom, esFer, nota, localStr };
    }).filter(Boolean);

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
    document.getElementById('detalleSub').textContent       = suc.nombre + ' · ' + periodoLabel;

    document.getElementById('detalleTbody').innerHTML = filas.map(f => `
      <tr class="${f.esSab ? 'fila-sabado' : ''} ${f.esDom ? 'fila-domingo' : ''} ${f.esFer ? 'fila-feriado' : ''}">
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
      </tr>`).join('');

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
            <button class="detalle-close" onclick="cerrarDetalle()">✕</button>
          </div>
        </div>
        <div class="detalle-stats-row">
          <div class="detalle-stat"><span class="detalle-stat-val" id="detalleStatDias">${duIni}</span><span class="detalle-stat-lbl">Días</span></div>
          <div class="detalle-stat"><span class="detalle-stat-val" id="detalleStatHs">${thIni.toFixed(1)}</span><span class="detalle-stat-lbl">Hs totales</span></div>
          <div class="detalle-stat"><span class="detalle-stat-val" id="detalleStatExtra">${theIni.toFixed(1)}</span><span class="detalle-stat-lbl">Hs extra</span></div>
          <div class="detalle-stat"><span class="detalle-stat-val" id="detalleStatSabs">${tsIni}</span><span class="detalle-stat-lbl">Sábados</span></div>
        </div>
      </div>
      <div class="detalle-tabs">
        <button class="detalle-tab active" onclick="switchDetalleTab('jornada', this)">Jornada</button>
        <button class="detalle-tab" onclick="switchDetalleTab('evolucion', this)">Evolución mensual</button>
      </div>
      <div class="detalle-tabla-wrap" id="detalleTabJornada">
        <table class="detalle-tabla">
          <thead>
            <tr>
              <th>Fecha</th><th>Día</th><th>Hora reg.</th>
              <th>Turno 1</th><th>Turno 2</th>
              <th>Hs total</th><th>Hs extra</th>
              <th>Sáb.</th><th>Local</th><th>Nota</th>
            </tr>
          </thead>
          <tbody id="detalleTbody">
            ${filasIni.map(f => `<tr class="${f.esSab ? 'fila-sabado' : ''} ${f.esDom ? 'fila-domingo' : ''} ${f.esFer ? 'fila-feriado' : ''}">
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
            </tr>`).join('')}
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
    </div>
  </div>`;

  const existing = document.getElementById('detalleOverlay');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.id = 'detalleOverlay';
  div.innerHTML = html;
  document.body.appendChild(div);
  document.body.style.overflow = 'hidden';

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
  document.getElementById('detalleTabJornada').style.display  = tab === 'jornada'   ? 'block' : 'none';
  document.getElementById('detalleTabEvolucion').style.display = tab === 'evolucion' ? 'block' : 'none';
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
  const datos = state.datos.length ? state.datos : [];
  document.getElementById('weekRange').textContent = getWeekRange(state.semanaOffset);
  document.getElementById('mesRange').textContent  = getMesLabel(state.mesOffset);
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
  try {
    const resp = await fetch(`${APPS_SCRIPT_URL}?accion=perfiles`);
    if (!resp.ok) return;
    const json = await resp.json();

    // Cargar categorías
    if (json.categorias && json.categorias.length) {
      CATEGORIAS_CONFIG = json.categorias;
    }

    // Cargar perfiles
    if (json.empleados && json.empleados.length) {
      EMPLEADOS_PERFILES = {};
      json.empleados.forEach(e => {
        EMPLEADOS_PERFILES[e.nombre] = e;
      });
    }
  } catch(err) {
    console.warn('No se pudieron cargar perfiles:', err);
  }
}

async function guardarPerfil(perfil) {
  try {
    const resp = await fetch(`${APPS_SCRIPT_URL}?accion=guardar_perfil`, {
      method: 'POST',
      body: JSON.stringify(perfil),
    });
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
  try {
    const resp = await fetch(`${APPS_SCRIPT_URL}?accion=guardar_categoria`, {
      method: 'POST',
      body: JSON.stringify(cat),
    });
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

  // Cargar perfiles de empleados en paralelo
  cargarPerfiles();

  // Si hay una URL única (clave 'unica'), la usamos para todas las hojas
  const urlUnica = urls['unica'] || null;

  const promises = SUCURSALES.map(suc => {
    const url = urlUnica || urls[suc.id];
    return url ? fetchSucursal(url, suc) : Promise.resolve([]);
  });

  const resultados = await Promise.all(promises);
  state.datos = resultados.flat();
  state.cargando = false;

  const total = state.datos.length;
  showToast(`${total} registros cargados`);
  setConnected(true);
  showApp();
  renderAll();
  iniciarAutoRefresh();
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
  } else {
    // empleados u otras vistas sin barra
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

function toggleFiltroDia(tipo, activo) {
  filtrosDia.verSolo = activo ? tipo : 'todos';

  // Sincronizar todos los checkboxes (barra + panel empleados)
  const mapa = { feriados: ['chkFeriados','chkFerBarra'], sabados: ['chkSabados','chkSabBarra'], domingos: ['chkDomingos','chkDomBarra'] };
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
  return false;
}

// ── PANEL ADMIN ────────────────────────────────────────
const ADMIN_PIN = '2811'; // PIN de acceso — cambiarlo en producción
let adminAutenticado = false;

function abrirAdmin() {
  if (!adminAutenticado) {
    mostrarLoginAdmin();
  } else {
    renderAdmin();
  }
}

function mostrarLoginAdmin() {
  const html = `
  <div class="admin-overlay" id="adminOverlay" onclick="cerrarAdmin(event)">
    <div class="admin-panel" onclick="event.stopPropagation()" style="max-width:380px">
      <div class="admin-header">
        <div class="admin-titulo">🔐 Acceso Admin</div>
        <button class="detalle-close" onclick="cerrarAdmin()">✕</button>
      </div>
      <div style="padding:2rem">
        <p style="font-size:13px;color:#64748b;margin-bottom:1.5rem">Ingresá el PIN de administrador para continuar.</p>
        <div style="margin-bottom:1rem">
          <label class="emp-filtro-label" style="display:block;margin-bottom:6px">PIN</label>
          <input type="password" id="adminPinInput" class="admin-input" placeholder="••••"
            maxlength="8" autocomplete="off"
            onkeydown="if(event.key==='Enter')verificarPin()" />
        </div>
        <p id="adminPinError" style="color:#dc2626;font-size:12px;margin-bottom:1rem;display:none">PIN incorrecto</p>
        <button class="btn-connect" onclick="verificarPin()" style="margin-bottom:0">Ingresar</button>
      </div>
    </div>
  </div>`;
  montarOverlayAdmin(html);
  setTimeout(() => document.getElementById('adminPinInput')?.focus(), 100);
}

function verificarPin() {
  const val = document.getElementById('adminPinInput')?.value;
  if (val === ADMIN_PIN) {
    adminAutenticado = true;
    renderAdmin();
  } else {
    document.getElementById('adminPinError').style.display = 'block';
    document.getElementById('adminPinInput').value = '';
    document.getElementById('adminPinInput').focus();
  }
}

function renderAdmin() {
  // Obtener todos los empleados únicos de los datos
  const empNombres = [...new Set(state.datos.map(r => r.EMPLEADO))].sort((a, b) => {
    const na = parseInt(a) || 999, nb = parseInt(b) || 999;
    return na !== nb ? na - nb : a.localeCompare(b);
  });

  const catOpts = CATEGORIAS_CONFIG.map(c =>
    `<option value="${c.id}">${c.nombre}</option>`
  ).join('');

  const empresaOpts = EMPRESAS.map(e =>
    `<option value="${e}">${e}</option>`
  ).join('');

  // Tabla de empleados
  const filasEmps = empNombres.map(nombre => {
    const perfil = EMPLEADOS_PERFILES[nombre] || {};
    const suc = SUCURSALES.find(s => s.id === (state.datos.find(r => r.EMPLEADO === nombre)?.LOCAL)) || { nombre: '—' };
    const numMatch = nombre.match(/^(\d+)\s+(.+)$/);
    const nomMostrar = numMatch ? numMatch[2] : nombre;
    const avatarUrl  = perfil.foto_url || '';
    const iniciales  = nomMostrar.split(' ').slice(0,2).map(p=>p[0]?.toUpperCase()).join('');
    return `<tr class="admin-emp-row" onclick="abrirEditarEmpleado('${nombre.replace(/'/g,"\\'")}')">
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <div class="admin-avatar-mini" style="background:${avatarUrl?'transparent':'#f1f5f9'}">
            ${avatarUrl ? `<img src="${avatarUrl}" onerror="this.parentElement.innerHTML='${iniciales}'" style="width:32px;height:32px;border-radius:50%;object-fit:cover">` : `<span style="font-size:11px;font-weight:600;color:#64748b">${iniciales}</span>`}
          </div>
          <span>${nomMostrar}</span>
        </div>
      </td>
      <td><span class="suc-badge-mini" style="background:#f1f5f9;color:#475569">${suc.nombre}</span></td>
      <td>${perfil.empresa ? `<span class="emp-empresa-badge ${perfil.empresa==='MOSHE SRL'?'badge-moshe':'badge-cromawave'}">${perfil.empresa}</span>` : '<span style="color:#94a3b8;font-size:12px">—</span>'}</td>
      <td>${perfil.categoria_id ? `<span class="emp-cat-badge">${CATEGORIAS_CONFIG.find(c=>c.id===perfil.categoria_id)?.nombre||'—'}</span>` : '<span style="color:#94a3b8;font-size:12px">—</span>'}</td>
      <td><span style="font-size:11px;color:#94a3b8">${perfil.foto_url ? '📷 OK' : '—'}</span></td>
      <td><button class="btn-admin-edit" onclick="event.stopPropagation();abrirEditarEmpleado('${nombre.replace(/'/g,"\\'")}')">Editar</button></td>
    </tr>`;
  }).join('');

  // Tabla de categorías
  const filasCats = CATEGORIAS_CONFIG.map(cat => `
    <tr>
      <td><strong>${cat.nombre}</strong></td>
      <td style="font-size:12px;color:#64748b">${cat.descripcion || '—'}</td>
      <td>${cat.percibe_extra ? '<span class="pill pill-comp" style="font-size:10px">Sí</span>' : '<span class="pill pill-franco" style="font-size:10px">No</span>'}</td>
      <td><button class="btn-admin-edit" onclick="abrirEditarCategoria('${cat.id}')">Editar</button></td>
    </tr>`).join('');

  const html = `
  <div class="admin-overlay" id="adminOverlay" onclick="cerrarAdmin(event)">
    <div class="admin-panel" onclick="event.stopPropagation()">
      <div class="admin-header">
        <div class="admin-titulo">Panel Admin · Croma Horarios</div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn-admin-edit" onclick="adminAutenticado=false;cerrarAdmin()">Cerrar sesión</button>
          <button class="detalle-close" onclick="cerrarAdmin()">✕</button>
        </div>
      </div>

      <!-- TABS -->
      <div class="admin-tabs" id="adminTabs">
        <button class="admin-tab active" onclick="switchAdminTab('empleados',this)">Empleados (${empNombres.length})</button>
        <button class="admin-tab" onclick="switchAdminTab('categorias',this)">Categorías</button>
      </div>

      <!-- TAB EMPLEADOS -->
      <div id="adminTabEmpleados" class="admin-tab-content">
        <div class="admin-toolbar">
          <input type="text" class="admin-search" id="adminBuscarEmp" placeholder="Buscar empleado..." oninput="filtrarTablaAdmin(this.value)" />
          <span style="font-size:12px;color:#94a3b8">${empNombres.length} empleados en el sistema</span>
        </div>
        <div class="admin-table-wrap">
          <table class="admin-tabla" id="adminTablaEmps">
            <thead>
              <tr><th>Empleado</th><th>Sucursal</th><th>Empresa</th><th>Categoría</th><th>Foto</th><th></th></tr>
            </thead>
            <tbody>${filasEmps || '<tr><td colspan="6" style="text-align:center;padding:2rem;color:#94a3b8">Sin datos cargados</td></tr>'}</tbody>
          </table>
        </div>
      </div>

      <!-- TAB CATEGORÍAS -->
      <div id="adminTabCategorias" class="admin-tab-content" style="display:none">
        <div class="admin-toolbar">
          <button class="btn-connect" style="width:auto;padding:8px 16px;font-size:13px" onclick="abrirNuevaCategoria()">+ Nueva categoría</button>
        </div>
        <div class="admin-table-wrap">
          <table class="admin-tabla">
            <thead><tr><th>Nombre</th><th>Descripción</th><th>Percibe extra</th><th></th></tr></thead>
            <tbody>${filasCats}</tbody>
          </table>
        </div>
      </div>
    </div>
  </div>`;

  montarOverlayAdmin(html);
}

function switchAdminTab(tab, btn) {
  document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('adminTabEmpleados').style.display = tab === 'empleados' ? 'block' : 'none';
  document.getElementById('adminTabCategorias').style.display = tab === 'categorias' ? 'block' : 'none';
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

        <div style="display:flex;gap:10px;margin-top:1.5rem">
          <button class="btn-connect" style="margin:0;flex:1" onclick="guardarPerfilDesdeForm()">Guardar cambios</button>
          <button class="btn-demo" style="flex:0 0 auto;padding:11px 16px" onclick="cerrarAdmin();renderAdmin()">Cancelar</button>
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
  const nombre      = document.getElementById('editNombre')?.value;
  const fotoUrl     = document.getElementById('editFotoUrl')?.value.trim();
  const empresa     = document.getElementById('editEmpresa')?.value;
  const categoriaId = document.getElementById('editCategoria')?.value;
  const reglaCustom = document.getElementById('editReglaCustom')?.value;
  const hsBase      = parseFloat(document.getElementById('editHsBase')?.value) || 8;

  // Convertir URL de Drive si corresponde
  let fotoFinal = fotoUrl;
  const driveMatch = fotoUrl.match(/\/d\/([^/]+)/);
  if (driveMatch) {
    fotoFinal = `https://drive.google.com/thumbnail?id=${driveMatch[1]}&sz=w200`;
  }

  const perfil = {
    nombre,
    empresa,
    categoria_id: categoriaId,
    regla_custom: reglaCustom || '',
    hs_base: hsBase,
    foto_url: fotoFinal,
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
        <div style="display:flex;gap:10px;margin-top:1.5rem">
          <button class="btn-connect" style="margin:0;flex:1" onclick="guardarCategoriaDesdeForm()">Guardar</button>
          <button class="btn-demo" style="flex:0 0 auto;padding:11px 16px" onclick="cerrarAdmin();renderAdmin()">Cancelar</button>
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
  // Mostrar app directamente (sin pantalla de setup)
  showApp();
  // Recuperar última vista visitada (o mes por defecto)
  const vistaGuardada = localStorage.getItem('croma_vista') || 'mes';
  setView(vistaGuardada);
  // Cargar datos en segundo plano
  cargarDatos({ unica: APPS_SCRIPT_URL });

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
