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

// Claves de localStorage para URLs de Apps Script
const LS_URLS_KEY = 'croma_horarios_urls';

// ── ESTADO GLOBAL ──────────────────────────────────────
let state = {
  semanaOffset: 0,
  mesOffset: 0,       // 0 = mes actual, -1 = mes anterior, etc.
  datos: [],
  tabActual: 'semana',
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
    COMP:   ['pill pill-comp',   'Completo'],
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
    const esHoy = f.toDateString() === hoy.toDateString();
    return `<th class="${esHoy ? 'hoy' : ''}">${d}<br><small>${formatFecha(f)}</small></th>`;
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
        const esHoy = f.toDateString() === hoy.toDateString();
        const reg = filasSuc.find(r =>
          r.EMPLEADO === emp &&
          String(r.DIA) === String(f.getDate()) &&
          r.MES === MESES_ES[f.getMonth()] &&
          String(r.AÑO) === String(f.getFullYear())
        );
        let tipoTurno = null;
        if (reg) {
          tipoTurno = clasificarTurno(reg.H_ENTRADA, reg.H_SALIDA);
          totalEmp += parseFloat(reg.TOTAL_HS) || 0;
        }
        if (turno !== 'all' && tipoTurno !== turno) tipoTurno = null;
        return `<td class="${esHoy ? 'hoy' : ''}">${pillHTML(tipoTurno)}</td>`;
      }).join('');

      html += `<tr>
        <td class="td-emp">${emp}</td>
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
  const { sucursal } = getFilters();
  const semana = getDatosSemana(datos, state.semanaOffset);

  const empMap = {};
  semana.forEach(r => {
    if (sucursal !== 'all' && r.LOCAL !== sucursal) return;
    if (!empMap[r.EMPLEADO]) {
      empMap[r.EMPLEADO] = { horas: 0, dias: new Set(), suc: r.LOCAL };
    }
    empMap[r.EMPLEADO].horas += parseFloat(r.TOTAL_HS) || 0;
    empMap[r.EMPLEADO].dias.add(`${r.DIA}-${r.MES}`);
  });

  const lista = Object.entries(empMap)
    .map(([nombre, d]) => ({ nombre, horas: d.horas, dias: d.dias.size, suc: d.suc }))
    .sort((a, b) => b.horas - a.horas);

  const suc = (id) => SUCURSALES.find(s => s.id === id) || { color: '#888', colorLight: '#eee', nombre: id };

  const html = `<div class="emp-grid">${lista.map(e => {
    const s = suc(e.suc);
    const iniciales = e.nombre.split(' ').slice(0,2).map(p => p[0]?.toUpperCase()).join('');
    return `<div class="emp-card">
      <div class="emp-card-head">
        <div class="emp-avatar" style="background:${s.colorLight};color:${s.color}">${iniciales}</div>
        <div>
          <div class="emp-nombre">${e.nombre}</div>
          <div class="emp-suc">${s.nombre}</div>
        </div>
      </div>
      <div class="emp-stats">
        <div class="emp-stat-item">
          <div class="emp-stat-val">${e.horas.toFixed(0)}</div>
          <div class="emp-stat-label">Horas</div>
        </div>
        <div class="emp-stat-item">
          <div class="emp-stat-val">${e.dias}</div>
          <div class="emp-stat-label">Días</div>
        </div>
        <div class="emp-stat-item">
          <div class="emp-stat-val">${e.dias > 0 ? (e.horas / e.dias).toFixed(1) : '0'}</div>
          <div class="emp-stat-label">Hs/día</div>
        </div>
      </div>
    </div>`;
  }).join('')}</div>`;

  document.getElementById('empContainer').innerHTML = html ||
    '<p style="padding:2rem;color:#999;font-size:14px">No hay datos.</p>';
}

// ── RENDER REPORTES ────────────────────────────────────
function renderReportes(datos) {
  const semana = getDatosSemana(datos, state.semanaOffset);
  const { sucursal } = getFilters();

  // Horas por empleado
  const horasPorEmp = {};
  semana.forEach(r => {
    if (sucursal !== 'all' && r.LOCAL !== sucursal) return;
    if (!horasPorEmp[r.EMPLEADO]) horasPorEmp[r.EMPLEADO] = 0;
    horasPorEmp[r.EMPLEADO] += parseFloat(r.TOTAL_HS) || 0;
  });
  const topEmps = Object.entries(horasPorEmp).sort((a,b) => b[1]-a[1]).slice(0, 10);
  const maxH = topEmps[0]?.[1] || 1;

  document.getElementById('reporteHoras').innerHTML = topEmps.map(([nombre, horas]) =>
    `<div class="reporte-row">
      <span class="reporte-nombre">${nombre}</span>
      <div class="reporte-bar-wrap"><div class="reporte-bar" style="width:${(horas/maxH*100).toFixed(0)}%"></div></div>
      <span class="reporte-val">${horas.toFixed(0)}h</span>
    </div>`
  ).join('') || '<p style="font-size:13px;color:#999;padding:1rem 0">Sin datos</p>';

  // Cobertura por sucursal
  const cobPorSuc = {};
  semana.forEach(r => {
    if (!cobPorSuc[r.LOCAL]) cobPorSuc[r.LOCAL] = new Set();
    cobPorSuc[r.LOCAL].add(r.EMPLEADO);
  });
  document.getElementById('reporteCobertura').innerHTML = SUCURSALES
    .filter(s => sucursal === 'all' || s.id === sucursal)
    .map(s => {
      const count = cobPorSuc[s.id]?.size || 0;
      return `<div class="reporte-row">
        <span class="reporte-nombre" style="display:flex;align-items:center;gap:6px">
          <span style="width:8px;height:8px;border-radius:50%;background:${s.color};display:inline-block"></span>
          ${s.nombre}
        </span>
        <span class="reporte-val">${count} emp.</span>
      </div>`;
    }).join('');

  // Empleados sin turno esta semana (solo los conocidos de semanas anteriores)
  const todosEmps = new Set(datos.map(r => `${r.EMPLEADO}|${r.LOCAL}`));
  const conTurno  = new Set(semana.map(r => `${r.EMPLEADO}|${r.LOCAL}`));
  const sinTurno  = [...todosEmps].filter(e => !conTurno.has(e));

  document.getElementById('reporteFaltantes').innerHTML = sinTurno.length
    ? sinTurno.map(e => {
        const [nombre, sucId] = e.split('|');
        const s = SUCURSALES.find(x => x.id === sucId);
        return `<span class="badge-faltante">
          <span style="width:6px;height:6px;border-radius:50%;background:${s?.color||'#999'};display:inline-block"></span>
          ${nombre} (${s?.nombre || sucId})
        </span>`;
      }).join('')
    : '<p style="font-size:13px;color:#22c55e;padding:0.5rem 0">✓ Todos los empleados tienen turno esta semana</p>';
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

    // Contar tipos de turno
    const tm   = registros.filter(r => clasificarTurno(r.H_ENTRADA, r.H_SALIDA) === 'TM').length;
    const tt   = registros.filter(r => clasificarTurno(r.H_ENTRADA, r.H_SALIDA) === 'TT').length;
    const comp = registros.filter(r => clasificarTurno(r.H_ENTRADA, r.H_SALIDA) === 'COMP').length;

    html += `<div class="cal-celda ${esHoy ? 'cal-hoy' : ''} ${esFinde ? 'cal-finde' : ''}">
      <div class="cal-num">${d}</div>
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
    if (!empMap[key]) empMap[key] = { nombre: r.EMPLEADO, local: r.LOCAL, horas: 0, dias: new Set(), tm: 0, tt: 0, comp: 0 };
    empMap[key].horas += parseFloat(r.TOTAL_HS) || 0;
    empMap[key].dias.add(r.DIA);
    const tipo = clasificarTurno(r.H_ENTRADA, r.H_SALIDA);
    if (tipo === 'TM') empMap[key].tm++;
    else if (tipo === 'TT') empMap[key].tt++;
    else if (tipo === 'COMP') empMap[key].comp++;
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
          <th>Mañana</th>
          <th>Tarde</th>
          <th>Completo</th>
        </tr>
      </thead>
      <tbody>`;

  lista.forEach(e => {
    const s = suc(e.local);
    html += `<tr>
      <td class="td-emp">${e.nombre}</td>
      <td><span class="suc-badge-mini" style="background:${s.colorLight};color:${s.color}">${s.nombre}</span></td>
      <td>${e.dias.size}</td>
      <td><strong>${e.horas.toFixed(1)}</strong></td>
      <td>${e.tm || '—'}</td>
      <td>${e.tt || '—'}</td>
      <td>${e.comp || '—'}</td>
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
  renderReportes(datos);
  poblarFiltroEmpleados(datos);
}

function poblarFiltroEmpleados(datos) {
  const sel = document.getElementById('filterEmp');
  const actual = sel.value;
  const emps = [...new Set(datos.map(r => r.EMPLEADO))].sort();
  sel.innerHTML = '<option value="all">Todos los empleados</option>' +
    emps.map(e => `<option value="${e}" ${e === actual ? 'selected' : ''}>${e}</option>`).join('');
}

// ── CONEXIÓN A APPS SCRIPT ─────────────────────────────
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
  const el = document.getElementById('connStatus');
  el.classList.toggle('connected', ok);
  el.querySelector('.status-label').textContent = ok ? 'Conectado' : 'Sin conexión';
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

  // Mostrar navegación correcta según vista
  const weekNav = document.querySelector('.week-nav:not(.mes-nav)');
  const mesNav  = document.getElementById('mesNav');
  if (view === 'mes') {
    weekNav.style.display = 'none';
    mesNav.style.display  = 'flex';
  } else {
    weekNav.style.display = 'flex';
    mesNav.style.display  = 'none';
  }
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ── INIT ───────────────────────────────────────────────
function init() {
  // Render setup form
  buildUrlForm();

  // Chequear si ya hay URLs guardadas → autoconectar
  const saved = getSavedUrls();
  if (Object.keys(saved).length > 0) {
    cargarDatos(saved);
  }

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
    const urls = getSavedUrls();
    if (Object.keys(urls).length) {
      cargarDatos(urls);
    } else {
      showToast('Configurá las URLs primero');
      showSetup();
    }
  });

  // Print
  document.getElementById('btnPrint').addEventListener('click', () => window.print());

  // Poblar select de sucursales
  const selSuc = document.getElementById('filterSucursal');
  selSuc.innerHTML = '<option value="all">Todas las sucursales</option>' +
    SUCURSALES.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('');
}

document.addEventListener('DOMContentLoaded', init);
