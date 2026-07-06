/* =====================================================
   CROMA · HORARIOS — app.js
   Estructura del Sheet esperada (por sucursal):
   LOCAL | AÑO | MES | DIA | MARCA_TEMPORAL | EMPLEADO |
   H_ENTRADA | H_SALIDA | NOTA | TOTAL_HS
   ===================================================== */

// ── CONFIGURACIÓN ──────────────────────────────────────
const SUCURSALES = [
  { id: '01',      hoja: 'PASEO',   nombre: '01 PASEO',           color: '#2563EB', colorLight: '#EFF6FF', icon: 'store'        },
  { id: '05',      hoja: 'WAVE',    nombre: '05 WAVE',            color: '#10B981', colorLight: '#ECFDF5', icon: 'waves'        },
  { id: '09',      hoja: 'CIPO',    nombre: '09 CIPO SAN MARTIN', color: '#F97316', colorLight: '#FFF7ED', icon: 'shoppingBag'  },
  { id: '10',      hoja: 'PERITO',  nombre: '10 PERITO MORENO',   color: '#DB2777', colorLight: '#FDF2F8', icon: 'warehouse'    },
  { id: '12',      hoja: 'CENTE',   nombre: '12 CENTENARIO',      color: '#7C3AED', colorLight: '#F5F3FF', icon: 'shoppingCart' },
  { id: '14',      hoja: 'ROCA180', nombre: '14 ROCA',            color: '#92400E', colorLight: '#FEF3C7', icon: 'mountain'     },
  { id: 'DEPO',    hoja: 'DEPO',    nombre: 'DEPO',               color: '#4B5563', colorLight: '#F3F4F6', icon: 'package'      },
  { id: 'OFICINA', hoja: 'OFICINA', nombre: 'OFICINA',            color: '#0891B2', colorLight: '#ECFEFF', icon: 'briefcase'    },
];

// Mapa indexado por id — lookup O(1) (derivado de SUCURSALES, sin duplicar datos)
const SUCURSALES_UI = Object.fromEntries(SUCURSALES.map(s => [s.id, s]));

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
let _verInactivos = false;     // panel Empleados: mostrar u ocultar la sección de ex-empleados

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

// Helper: horas de feriado (todo lo trabajado en un feriado es hora feriado, aparte del extra)
function calcularHsFeriado(hsTotal, fechaDate) {
  return (fechaDate && esFeriado(fechaDate)) ? (Math.round((hsTotal || 0) * 100) / 100) : 0;
}

// Helper: calcular horas extra según categoría personalizada
function calcularHsExtra(nombreEmp, hsTotal, fechaDate) {
  // Feriado: las horas van al bucket "Hs feriado", NO cuentan como extra
  if (fechaDate && esFeriado(fechaDate)) return 0;

  const perfil = EMPLEADOS_PERFILES[nombreEmp];
  if (!perfil) return Math.round(Math.max(0, hsTotal - 8) * 100) / 100; // fallback genérico

  const cat = CATEGORIAS_CONFIG.find(c => c.id === perfil.categoria_id);
  if (!cat || !cat.percibe_extra) return 0;

  // Regla custom por empleado (ej: "lv4" = 4h Lun-Vie, excedente extra)
  if (perfil.regla_custom) {
    const dow = fechaDate ? fechaDate.getDay() : -1;
    const esFinDeSemana = dow === 0 || dow === 6;
    const limite = perfil.regla_custom === 'lv4'
      ? (esFinDeSemana ? 0 : 4)
      : perfil.hs_base || 8;
    return Math.round(Math.max(0, hsTotal - limite) * 100) / 100;
  }

  // Reglas predefinidas por categoría
  const dow = fechaDate ? fechaDate.getDay() : -1;
  if (cat.regla === 'lv8_s4') {
    const esSab = dow === 6;
    const limite = esSab ? 4 : 8;
    return Math.round(Math.max(0, hsTotal - limite) * 100) / 100;
  }
  if (cat.regla === 'fijo4') {
    return Math.round(Math.max(0, hsTotal - 4) * 100) / 100;
  }
  if (cat.regla === 'sin_extra') return 0;

  // Regla personalizada por hs_base
  return Math.round(Math.max(0, hsTotal - (perfil.hs_base || 8)) * 100) / 100;
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

// Fetch resistente a los hipos de Apps Script: valida la respuesta y reintenta
// un par de veces. Google a veces devuelve una página HTML (404/echo) en vez de
// JSON — típico "Unexpected token '<'" — y un reintento suele resolverlo.
async function fetchJSONretry(url, intentos) {
  intentos = intentos || 3;
  let ultimoError;
  for (let i = 0; i < intentos; i++) {
    try {
      const resp = await fetch(url);
      const txt  = (await resp.text()).trim();
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      if (txt[0] !== '{' && txt[0] !== '[') throw new Error('El servidor no respondió datos válidos');
      return JSON.parse(txt);
    } catch (e) {
      ultimoError = e;
      if (i < intentos - 1) await new Promise(function(r) { setTimeout(r, 800 * (i + 1)); });
    }
  }
  throw ultimoError;
}

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

// ════════════════════════════════════════════════════════
//  EN VIVO — quién está en cada sucursal AHORA MISMO
//  (calculado con los registros de hoy: H_ENTRADA / H_SALIDA)
// ════════════════════════════════════════════════════════
const DIAS_FULL_ES = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
let enVivoInterval = null;

function iniciarEnVivoAuto() {
  if (enVivoInterval) return;
  enVivoInterval = setInterval(() => {
    if (state.tabActual !== 'envivo') return;
    renderEnVivo();
  }, 60000); // re-render cada minuto para que la presencia y el reloj avancen
}
function detenerEnVivoAuto() {
  if (enVivoInterval) { clearInterval(enVivoInterval); enVivoInterval = null; }
}

function hhmmAMin(s) {
  const x = String(s || '').trim().split(':');
  const h = parseInt(x[0], 10);
  if (isNaN(h)) return NaN;
  const m = parseInt(x[1] || '0', 10);
  return h * 60 + (isNaN(m) ? 0 : m);
}

// Devuelve el estado de un empleado según sus bloques [{ent,sal}] del día
function estadoEnVivo(bloquesRaw, nowMin) {
  const bloques = bloquesRaw
    .map(b => {
      const ini = hhmmAMin(b.ent);
      let fin = hhmmAMin(b.sal);
      if (isNaN(ini) || isNaN(fin)) return null;
      if (fin <= ini) fin += 1440; // cruza medianoche
      return { ini, fin, iniStr: b.ent, finStr: b.sal };
    })
    .filter(Boolean)
    .sort((a, b) => a.ini - b.ini);
  if (!bloques.length) return { estado: 'sinhora' };

  const primero = bloques[0];
  const ultimo  = bloques[bloques.length - 1];
  for (const bl of bloques) {
    if (nowMin >= bl.ini && nowMin < bl.fin) {
      return { estado: 'presente', salida: ultimo.finStr, salidaMin: ultimo.fin };
    }
  }
  if (nowMin < primero.ini) return { estado: 'proximo', entra: primero.iniStr, entraMin: primero.ini };
  if (nowMin >= ultimo.fin)  return { estado: 'fin', salida: ultimo.finStr };
  for (let i = 0; i < bloques.length - 1; i++) {
    if (nowMin >= bloques[i].fin && nowMin < bloques[i + 1].ini) {
      return { estado: 'pausa', vuelve: bloques[i + 1].iniStr, vuelveMin: bloques[i + 1].ini, salida: ultimo.finStr };
    }
  }
  return { estado: 'fin', salida: ultimo.finStr };
}

function inicialesEnVivo(nombre) {
  const limpio = String(nombre || '').replace(/^\d+\s+/, '');
  return limpio.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() || '').join('');
}
function nombreCortoEnVivo(nombre) {
  return String(nombre || '').replace(/^\d+\s+/, '');
}

function avatarEnVivoHTML(nombre, suc, estadoDot) {
  const perfil = EMPLEADOS_PERFILES[nombre] || {};
  const inic = inicialesEnVivo(nombre);
  const dot = estadoDot ? `<span class="estado-dot ${estadoDot}"></span>` : '';
  if (perfil.foto_url) {
    return `<div class="envivo-emp-avatar"><img src="${perfil.foto_url}" alt="" onerror="this.style.display='none';this.parentElement.insertAdjacentText('afterbegin','${inic}')">${dot}</div>`;
  }
  return `<div class="envivo-emp-avatar" style="background:${suc.colorLight};color:${suc.color}">${inic}${dot}</div>`;
}

function renderEnVivo() {
  const container = document.getElementById('enVivoContainer');
  if (!container) return;

  const ahora  = new Date();
  const nowMin = ahora.getHours() * 60 + ahora.getMinutes();
  const mesHoy = MESES_ES[ahora.getMonth()];

  // Registros de hoy
  const registrosHoy = state.datos.filter(r =>
    String(r.AÑO) === String(ahora.getFullYear()) &&
    r.MES === mesHoy &&
    String(r.DIA) === String(ahora.getDate())
  );

  let totalPresentes = 0;
  let cards = '';

  SUCURSALES.forEach(suc => {
    const regsSuc = registrosHoy.filter(r => r.LOCAL === suc.id);

    // Agrupar por empleado (puede tener varios registros = turno cortado)
    const porEmp = {};
    regsSuc.forEach(r => {
      if (!porEmp[r.EMPLEADO]) porEmp[r.EMPLEADO] = [];
      if (r.H_ENTRADA && r.H_SALIDA) porEmp[r.EMPLEADO].push({ ent: r.H_ENTRADA, sal: r.H_SALIDA });
    });

    const presentes = [], proximos = [], pausados = [], terminados = [];
    Object.keys(porEmp).forEach(emp => {
      const est = estadoEnVivo(porEmp[emp], nowMin);
      if (est.estado === 'presente') presentes.push({ emp, est });
      else if (est.estado === 'proximo') proximos.push({ emp, est });
      else if (est.estado === 'pausa') pausados.push({ emp, est });
      else if (est.estado === 'fin') terminados.push({ emp, est });
    });
    presentes.sort((a, b) => a.est.salidaMin - b.est.salidaMin);
    proximos.sort((a, b) => a.est.entraMin - b.est.entraMin);
    totalPresentes += presentes.length;

    const hayDatos = Object.keys(porEmp).length > 0;

    cards += `<div class="envivo-card ${presentes.length ? 'activa' : 'vacia'}" style="--card-suc:${suc.color}">`;
    cards += `<div class="envivo-card-head">
        <span class="envivo-card-pin" style="color:${suc.color}">${icon('mapPin','icon-16')}</span>
        <span class="envivo-card-suc">${suc.nombre}</span>
        <span class="envivo-card-count ${presentes.length ? '' : 'cero'}"><b>${presentes.length}</b><span>en turno</span></span>
      </div>`;

    if (presentes.length) {
      cards += '<div class="envivo-presentes">';
      presentes.forEach(o => {
        cards += `<div class="envivo-emp">
          ${avatarEnVivoHTML(o.emp, suc, 'presente')}
          <div class="envivo-emp-info">
            <span class="envivo-emp-nombre">${nombreCortoEnVivo(o.emp)}</span>
            <span class="envivo-emp-meta">Sale ${o.est.salida}</span>
          </div>
        </div>`;
      });
      cards += '</div>';
    } else if (hayDatos) {
      cards += '<div class="envivo-vacia-msg">Nadie en turno ahora</div>';
    } else {
      cards += '<div class="envivo-vacia-msg">Sin registros hoy</div>';
    }

    if (pausados.length || proximos.length || terminados.length) {
      cards += '<div class="envivo-card-foot">';
      pausados.forEach(o => {
        cards += `<div class="envivo-foot-line">${icon('pause','icon-14')} <b>${nombreCortoEnVivo(o.emp)}</b> en pausa · vuelve ${o.est.vuelve}</div>`;
      });
      proximos.forEach(o => {
        cards += `<div class="envivo-foot-line">🕒 <b>${nombreCortoEnVivo(o.emp)}</b> entra ${o.est.entra}</div>`;
      });
      terminados.sort((a, b) => (a.emp).localeCompare(b.emp)).forEach(o => {
        cards += `<div class="envivo-foot-line fin">✓ <b>${nombreCortoEnVivo(o.emp)}</b> terminó ${o.est.salida}</div>`;
      });
      cards += '</div>';
    }

    cards += '</div>';
  });

  container.innerHTML = cards;

  // Barra superior
  const bar = document.getElementById('enVivoBar');
  if (bar) {
    const hh = String(ahora.getHours()).padStart(2, '0');
    const mm = String(ahora.getMinutes()).padStart(2, '0');
    bar.innerHTML =
      `<span class="envivo-bar-dia">${DIAS_FULL_ES[ahora.getDay()]} ${ahora.getDate()} ${MESES_ES[ahora.getMonth()].toLowerCase()}</span>` +
      `<span class="envivo-bar-hora">actualizado <b>${hh}:${mm}</b></span>` +
      `<span class="envivo-bar-total"><span class="envivo-live-dot"></span>EN VIVO · <b>${totalPresentes}</b>&nbsp;trabajando</span>`;
  }
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
      empMap[key] = { nombre: r.EMPLEADO, suc: perfil.sucursal_id || r.LOCAL, horas: 0, dias: new Set(), hsExtra: 0, hsFeriado: 0, sabados: new Set(),
                      empresa: perfil.empresa || '—', categoria: cat?.nombre || '—', foto_url: perfil.foto_url || '',
                      activo: perfil.activo !== false, diasProcesados: new Set() };
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
    empMap[key].hsExtra   += calcularHsExtra(d.emp, d.hs, fecha);
    empMap[key].hsFeriado += calcularHsFeriado(d.hs, fecha);
  });

  let lista = Object.values(empMap).sort((a, b) => {
    const na = parseInt(a.nombre) || 999, nb = parseInt(b.nombre) || 999;
    return na !== nb ? na - nb : a.nombre.localeCompare(b.nombre);
  });

  // "Ver solo Certificados": dejar solo empleados con certificados en el período
  if (filtrosDia.verSolo === 'certificados') {
    const certEnPeriodo = (c) => {
      if (!c.fecha) return false;
      if (selPeriodo === 'all') return true;
      const [anioSel, mesSel] = selPeriodo.split('||');
      const [cy, cm] = String(c.fecha).split('-').map(Number);
      return String(cy) === anioSel && MESES_ES[cm - 1] === mesSel;
    };
    lista = lista.filter(e => getCertificadosDe(e.nombre).some(certEnPeriodo));
  }

  // Separar activos de ex-empleados (perfil.activo === false)
  const listaActivos   = lista.filter(e => e.activo !== false);
  const listaInactivos = lista.filter(e => e.activo === false);
  const puedeGestionar = sesionActual?.rol === 'admin';

  const buildEmpCard = (e, inactivo) => {
    const s = suc(e.suc);
    const numMatch = e.nombre.match(/^(\d+)\s+(.+)$/);
    const numVend  = numMatch ? numMatch[1] : '';
    const nomMostrar = numMatch ? numMatch[2] : e.nombre;
    const nombrePartes = nomMostrar.split(' ');
    const iniciales = nombrePartes.slice(0,2).map(p => p[0]?.toUpperCase()).join('');

    // Avatar: foto o iniciales
    const avatarInner = e.foto_url
      ? `<img src="${e.foto_url}" alt="${nomMostrar}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" onerror="this.parentElement.innerHTML='${iniciales}'">`
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

    const nombreEsc = e.nombre.replace(/'/g,"\\'");
    const inactivoBadge = inactivo ? `<span class="emp-inactivo-badge">Ya no trabaja</span>` : '';

    return `<div class="emp-card ${inactivo ? 'emp-card-inactivo' : ''}" onclick="abrirDetalleEmpleadoDesdePanel('${nombreEsc}', '${e.suc}')" style="cursor:pointer">
      <span class="emp-card-stripe" style="background:${s.color}"></span>
      <div class="emp-card-body">
        <div class="emp-card-head">
          <div class="emp-avatar ${e.foto_url ? 'emp-avatar-foto' : ''}" style="${e.foto_url ? '' : `background:${s.colorLight};color:${s.color}`}">
            ${avatarInner}
          </div>
          <div style="flex:1;min-width:0">
            <div class="emp-nombre">${nomMostrar}</div>
            <div class="emp-suc" style="color:${s.color}">${s.nombre}${numVend ? ` · #${numVend}` : ''}</div>
            <div class="emp-badges-row">${inactivoBadge}${empresaBadge}${catBadge}</div>
          </div>
        </div>
        <div class="emp-stats">
          <div class="emp-stat-item">
            <div class="emp-stat-val">${e.dias.size}</div>
            <div class="emp-stat-label">Días</div>
          </div>
          <div class="emp-stat-item">
            <div class="emp-stat-val">${e.horas.toFixed(0)}</div>
            <div class="emp-stat-label">Hs</div>
          </div>
          <div class="emp-stat-item">
            <div class="emp-stat-val" style="${e.hsExtra > 0 ? 'color:#e8251a' : ''}">${e.hsExtra.toFixed(0)}</div>
            <div class="emp-stat-label">Extra</div>
          </div>
          <div class="emp-stat-item">
            <div class="emp-stat-val" style="${e.hsFeriado > 0 ? 'color:#0891b2' : ''}">${e.hsFeriado.toFixed(0)}</div>
            <div class="emp-stat-label">Feriado</div>
          </div>
          <div class="emp-stat-item">
            <div class="emp-stat-val">${e.sabados.size}</div>
            <div class="emp-stat-label">Sáb</div>
          </div>
        </div>
      </div>
      <div class="emp-card-footer">
        ${waBtn}
        <span class="emp-card-footer-link">Ver jornada →</span>
      </div>
    </div>`;
  };

  const grilla = listaActivos.map(e => buildEmpCard(e, false)).join('');
  const grillaInactivos = listaInactivos.map(e => buildEmpCard(e, true)).join('');

  const chkFer = filtrosDia.verSolo === 'feriados';
  const chkSab = filtrosDia.verSolo === 'sabados';
  const chkDom = filtrosDia.verSolo === 'domingos';
  const chkLab = filtrosDia.verSolo === 'laborales';
  const chkCert = filtrosDia.verSolo === 'certificados';

  const empresaOpts = [`<option value="all">Todas las empresas</option>`,
    ...EMPRESAS.map(emp => `<option value="${emp}" ${emp === selEmpresa ? 'selected' : ''}>${emp}</option>`)
  ].join('');

  const categoriaOpts = [`<option value="all">Todas las categorías</option>`,
    ...CATEGORIAS_CONFIG.map(c => `<option value="${c.id}" ${c.id === selCategoria ? 'selected' : ''}>${c.nombre}</option>`)
  ].join('');

  container.innerHTML = `
    <button class="emp-filtros-toggle-btn" onclick="toggleEmpFiltrosMobile(this)">
      <span>Filtros</span><span>▸</span>
    </button>
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
          <label class="filtro-dia-check">
            <input type="checkbox" id="chkCertificados" ${chkCert?'checked':''} onchange="toggleFiltroDia('certificados',this.checked)" />
            <span>Certificados</span>
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
    <div class="emp-section-header">
      <span class="emp-section-title">EMPLEADOS</span>
      <span class="emp-section-count">${listaActivos.length} ${listaActivos.length === 1 ? 'empleado' : 'empleados'}</span>
    </div>
    <div class="emp-grid" id="empGrid">
      ${grilla || '<p style="padding:2rem;color:#999;font-size:14px">No hay empleados para los filtros seleccionados.</p>'}
    </div>
    ${listaInactivos.length ? `
      <div class="emp-inactivos-section">
        <button class="emp-inactivos-toggle ${_verInactivos ? 'abierto' : ''}" onclick="toggleVerInactivos()">
          <span class="emp-inactivos-caret">▸</span>
          <span>Ex-empleados / Ya no trabajan</span>
          <span class="emp-inactivos-count">${listaInactivos.length}</span>
        </button>
        <div class="emp-grid emp-grid-inactivos" style="${_verInactivos ? '' : 'display:none'}">
          ${grillaInactivos}
        </div>
      </div>` : ''}`;
}

// Mostrar/ocultar la sección de ex-empleados sin re-renderizar todo el panel
function toggleVerInactivos() {
  _verInactivos = !_verInactivos;
  const grid   = document.querySelector('.emp-grid-inactivos');
  const toggle = document.querySelector('.emp-inactivos-toggle');
  if (grid)   grid.style.display = _verInactivos ? '' : 'none';
  if (toggle) toggle.classList.toggle('abierto', _verInactivos);
}

// Marcar un empleado como que ya no trabaja (pasa a la sección de ex-empleados)
function marcarEmpleadoInactivo(nombre) {
  const nomMostrar = nombre.replace(/^\d+\s+/, '');
  mostrarConfirm({
    titulo: '¿Marcar como que ya no trabaja?',
    mensaje: `<strong>${nomMostrar}</strong> se moverá a la sección de ex-empleados, al final del panel. Sus datos y su historial se conservan y podés reactivarlo cuando quieras.`,
    textoOk: 'Marcar como ya no trabaja',
    peligro: true,
    onOk: async () => {
      await _setEmpleadoActivo(nombre, false);
      showToast(`✓ ${nomMostrar} movido a ex-empleados`);
    }
  });
}

// Reactivar un ex-empleado (vuelve a la lista principal)
async function reactivarEmpleado(nombre) {
  const nomMostrar = nombre.replace(/^\d+\s+/, '');
  await _setEmpleadoActivo(nombre, true);
  _verInactivos = true; // mantener visible la sección tras reactivar
  showToast(`✓ ${nomMostrar} reactivado`);
}

// Persistir el estado activo/inactivo del perfil (backend + sessionStorage) y re-render
async function _setEmpleadoActivo(nombre, activo) {
  const perfil = { ...(EMPLEADOS_PERFILES[nombre] || { nombre }), nombre, activo, _editadoLocal: true };
  EMPLEADOS_PERFILES[nombre] = perfil;
  try {
    const saved = JSON.parse(sessionStorage.getItem('croma_perfiles_locales') || '{}');
    saved[nombre] = perfil;
    sessionStorage.setItem('croma_perfiles_locales', JSON.stringify(saved));
  } catch (e) {}
  await guardarPerfil(perfil);
  if (typeof cerrarDetalle === 'function') cerrarDetalle(); // cerrar overlay de detalle si está abierto
  renderEmpleados(state.datos);
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

      let horaReg = '', horaReg2 = '';
      if (r0.MARCA_TEMPORAL) {
        try {
          const mt = new Date(r0.MARCA_TEMPORAL);
          horaReg = mt.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' });
        } catch(e) {}
      }
      if (regs[1]?.MARCA_TEMPORAL) {
        try { horaReg2 = new Date(regs[1].MARCA_TEMPORAL).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' }); } catch(e) {}
      }

      const turno1  = r0.H_ENTRADA && r0.H_SALIDA ? `${r0.H_ENTRADA} - ${r0.H_SALIDA}` : '—';
      const turno2  = regs[1] && regs[1].H_ENTRADA ? `${regs[1].H_ENTRADA} - ${regs[1].H_SALIDA}` : '';
      const hsTotal = regs.reduce((a, r) => a + (parseFloat(r.TOTAL_HS) || 0), 0);
      const hsExtra = calcularHsExtra(nombreEmp, hsTotal, fecha);
      const hsFeriado = calcularHsFeriado(hsTotal, fecha);
      const nota    = regs.map(r => r.NOTA).filter(Boolean).join(' / ');
      const localStr = regs.map(r => {
        const s = SUCURSALES.find(x => x.id === r.LOCAL);
        return s ? s.nombre : r.LOCAL;
      }).filter((v,i,a) => a.indexOf(v)===i).join(', ');

      return { fechaStr, diaSem, horaReg, horaReg2, turno1, turno2, hsTotal, hsExtra, hsFeriado, esSab, esDom, esFer, nota, localStr,
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
        hsFeriado: 0,
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
    const totalHoras     = filas.reduce((a, f) => a + f.hsTotal, 0);
    const diasUnicos     = filas.length;
    const totalHsExtra   = filas.reduce((a, f) => a + f.hsExtra, 0);
    const totalHsFeriado = filas.reduce((a, f) => a + (f.hsFeriado || 0), 0);
    const totalSabs      = filas.filter(f => f.esSab).length;

    return { filas, totalHoras, totalHsExtra, totalHsFeriado, totalSabs, diasUnicos };
  }

  // Función para re-renderizar tabla y stats al cambiar mes
  function renderDetalle(periodo) {
    const { filas, totalHoras, totalHsExtra, totalHsFeriado, totalSabs, diasUnicos } = calcularContenido(periodo);
    const periodoLabel = periodo === 'TODOS' ? 'Todos los registros' : periodo;

    document.getElementById('detalleStatDias').textContent  = diasUnicos;
    document.getElementById('detalleStatHs').textContent    = totalHoras.toFixed(1);
    document.getElementById('detalleStatExtra').textContent = totalHsExtra.toFixed(1);
    const ferEl = document.getElementById('detalleStatFeriado');
    if (ferEl) ferEl.textContent = totalHsFeriado.toFixed(1);
    document.getElementById('detalleStatSabs').textContent  = totalSabs;
    const certEl = document.getElementById('detalleStatCerts');
    if (certEl) certEl.textContent = filas.filter(f => f.esCert).length;
    document.getElementById('detalleSub').textContent       = suc.nombre + ' · ' + periodoLabel;

    document.getElementById('detalleTbody').innerHTML = filas.map(f => {
      if (f.esCert) return `
      <tr class="fila-certificado" data-fecha="${f.fechaISO}" data-hs="${f.hsTotal}" data-extra="0" data-feriado="0" data-sab="${f.esSab?1:0}" data-cert="1">
        <td>${f.fechaStr}</td>
        <td>${f.diaSem}</td>
        <td class="hora-reg">—</td>
        <td colspan="2"><span class="tag-cert">CERT</span> ${f.nota}</td>
        <td><strong>${f.hsTotal.toFixed(1)}</strong></td>
        <td>—</td>
        <td>—</td>
        <td></td>
        <td>—</td>
        <td><button onclick="eliminarCertificado('${f.certId}','${nombreEmp.replace(/'/g,"\\'")}','${f.fechaISO.substring(0,7)}')" style="background:none;border:none;cursor:pointer;color:#dc2626" title="Borrar certificado">${icon('x','icon-12')}</button></td>
      </tr>`;
      return `
      <tr class="${f.esSab ? 'fila-sabado' : ''} ${f.esDom ? 'fila-domingo' : ''} ${f.esFer ? 'fila-feriado' : ''}" data-fecha="${f.fechaISO}" data-hs="${f.hsTotal}" data-extra="${f.hsExtra}" data-feriado="${f.hsFeriado||0}" data-sab="${f.esSab?1:0}" data-cert="0">
        <td>${f.fechaStr}${f.esFer ? ' <span class="tag-feriado">F</span>' : ''}</td>
        <td>${f.diaSem}</td>
        <td class="hora-reg">${f.horaReg||'—'}${f.horaReg2 ? `<br><span class="hora-reg-2">${f.horaReg2}</span>` : ''}</td>
        <td class="turno-cell">${f.turno1}</td>
        <td class="turno-cell">${f.turno2 || '—'}</td>
        <td><strong>${f.hsTotal.toFixed(1)}</strong></td>
        <td>${f.hsExtra > 0 ? `<span class="hs-extra">${f.hsExtra.toFixed(1)}</span>` : '—'}</td>
        <td>${f.hsFeriado > 0 ? `<span class="hs-feriado">${f.hsFeriado.toFixed(1)}</span>` : '—'}</td>
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
        <td>${totalHsFeriado > 0 ? `<span class="hs-feriado">${totalHsFeriado.toFixed(1)}</span>` : '—'}</td>
        <td>${totalSabs}</td>
        <td colspan="2"></td>
      </tr>`;
  }

  // Período inicial: el más reciente
  const periodoInicial = (periodoForzado && periodos.includes(periodoForzado))
    ? periodoForzado
    : (periodos[periodos.length - 1] || 'TODOS');
  const { filas: filasIni, totalHoras: thIni, totalHsExtra: theIni, totalHsFeriado: thFerIni, totalSabs: tsIni, diasUnicos: duIni } = calcularContenido(periodoInicial);

  const opcionesMes = [`<option value="TODOS">Todos los registros</option>`]
    .concat(periodos.map(p => `<option value="${p}" ${p === periodoInicial ? 'selected' : ''}>${p}</option>`))
    .join('');

  // Empresa y tipo de jornada del empleado (desde el perfil)
  const perfilEmp  = EMPLEADOS_PERFILES[nombreEmp] || {};
  const catEmp     = CATEGORIAS_CONFIG.find(c => c.id === perfilEmp.categoria_id);
  const empresaEmp = (perfilEmp.empresa || '').trim();
  const jornadaEmp = (catEmp?.nombre || '').trim();

  // Footer: última actualización de los datos
  const _ua = state.ultimaActualizacion instanceof Date ? state.ultimaActualizacion : new Date();
  const ultActStr = `${_ua.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${_ua.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: true })}`;

  const html = `
  <div class="detalle-overlay" onclick="cerrarDetalle(event)">
    <div class="detalle-panel" onclick="event.stopPropagation()">
      <div class="detalle-header">
        <span class="detalle-header-stripe" style="background:${suc.color}"></span>
        <div class="detalle-header-inner">
          <div class="detalle-header-top">
            <div style="display:flex;align-items:center;gap:14px">
              <button class="detalle-close-btn" onclick="cerrarDetalle()" title="Cerrar" aria-label="Cerrar">
                ${icon('x','icon-18')}
              </button>
              ${(() => {
                const perfil = EMPLEADOS_PERFILES[nombreEmp];
                const fotoUrl = perfil?.foto_url;
                return fotoUrl
                  ? `<div class="detalle-foto emp-avatar-foto" style="width:84px;height:84px;border-radius:18px;overflow:hidden;flex-shrink:0"><img src="${fotoUrl}" alt="${nomMostrar}" style="width:100%;height:100%;object-fit:cover" /></div>`
                  : `<div class="detalle-foto" style="width:84px;height:84px;border-radius:18px;background:${suc.colorLight};color:${suc.color};display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue';font-size:34px;flex-shrink:0">${nomMostrar.charAt(0)}</div>`;
              })()}
              <div>
                <div class="detalle-titulo">
                  ${numVend ? `<span class="detalle-num" style="background:${suc.colorLight};color:${suc.color}">#${numVend}</span>` : ''}
                  ${nomMostrar}
                </div>
                <div class="detalle-sub" id="detalleSub">${suc.nombre} · ${periodoInicial}</div>
                ${(empresaEmp || jornadaEmp) ? `<div class="detalle-chips">
                  ${empresaEmp ? `<span class="detalle-chip detalle-chip-empresa">🏢 ${empresaEmp}</span>` : ''}
                  ${jornadaEmp ? `<span class="detalle-chip detalle-chip-jornada"${catEmp?.descripcion ? ` title="${catEmp.descripcion}"` : ''}>🕒 ${jornadaEmp}</span>` : ''}
                </div>` : ''}
              </div>
            </div>
            <div class="detalle-acciones">
              <select id="detalleSelectMes" class="filter-select" style="height:32px;font-size:12px;padding:0 8px;border-radius:8px">
                ${opcionesMes}
              </select>
              <button class="btn-detalle-accion" onclick="imprimirDetalleEmpleado()" title="Imprimir / PDF">
                ${icon('printer','icon-13')}
                PDF
              </button>
              <button class="btn-detalle-accion btn-excel" onclick="descargarExcelEmpleado('${nombreEmp.replace(/'/g,"\\''")}', '${nomMostrar}', '${suc.nombre}')" title="Descargar Excel">
                ${icon('fileText','icon-13')}
                Excel
              </button>
              <button class="btn-detalle-accion" style="color:#2563eb;border-color:#93c5fd;background:#eff6ff" onclick="abrirFormCertificado(this.dataset.emp)" data-emp="${nombreEmp}">
                ${icon('circlePlus','icon-13')}
                Certificado
              </button>
              ${sesionActual?.rol === 'admin' ? (
                (EMPLEADOS_PERFILES[nombreEmp]?.activo !== false)
                  ? `<button class="btn-detalle-accion btn-detalle-baja" onclick="marcarEmpleadoInactivo('${nombreEmp.replace(/'/g,"\\'")}')">
                       ${icon('userX','icon-13')}
                       Marcar como ya no trabaja
                     </button>`
                  : `<button class="btn-detalle-accion btn-detalle-alta" onclick="reactivarEmpleado('${nombreEmp.replace(/'/g,"\\'")}')">
                       ${icon('userPlus','icon-13')}
                       Reactivar empleado
                     </button>`
              ) : ''}
            </div>
          </div>
        </div>
        <div class="detalle-stats-row">
          <div class="detalle-stat stat-dias">
            <div class="detalle-stat-icon">${icon('calendar','icon-20')}</div>
            <div class="detalle-stat-body"><span class="detalle-stat-val" id="detalleStatDias">${duIni}</span><span class="detalle-stat-lbl">Días</span></div>
          </div>
          <div class="detalle-stat stat-hs">
            <div class="detalle-stat-icon">${icon('clock','icon-20')}</div>
            <div class="detalle-stat-body"><span class="detalle-stat-val" id="detalleStatHs">${thIni.toFixed(1)}</span><span class="detalle-stat-lbl">Hs totales</span></div>
          </div>
          <div class="detalle-stat stat-extra">
            <div class="detalle-stat-icon">${icon('circlePlus','icon-20')}</div>
            <div class="detalle-stat-body"><span class="detalle-stat-val" id="detalleStatExtra">${theIni.toFixed(1)}</span><span class="detalle-stat-lbl">Hs extra</span></div>
          </div>
          <div class="detalle-stat stat-feriado">
            <div class="detalle-stat-icon">${icon('calendarCheck','icon-20')}</div>
            <div class="detalle-stat-body"><span class="detalle-stat-val" id="detalleStatFeriado">${thFerIni.toFixed(1)}</span><span class="detalle-stat-lbl">Hs feriado</span></div>
          </div>
          <div class="detalle-stat stat-sabs">
            <div class="detalle-stat-icon">${icon('calendar','icon-20')}</div>
            <div class="detalle-stat-body"><span class="detalle-stat-val" id="detalleStatSabs">${tsIni}</span><span class="detalle-stat-lbl">Sábados</span></div>
          </div>
          <div class="detalle-stat stat-certs">
            <div class="detalle-stat-icon">${icon('shieldCheck','icon-20')}</div>
            <div class="detalle-stat-body"><span class="detalle-stat-val" id="detalleStatCerts">${filasIni.filter(f=>f.esCert).length}</span><span class="detalle-stat-lbl">Certs</span></div>
          </div>
        </div>
      </div>
      <div class="detalle-tabs">
        <button class="detalle-tab active" onclick="switchDetalleTab('jornada', this)">Historial</button>
        <button class="detalle-tab" onclick="switchDetalleTab('evolucion', this)">Evolución mensual</button>
        <button class="detalle-tab" onclick="switchDetalleTab('vacaciones', this)" id="tabVacBtn_${nombreEmp.replace(/[^a-zA-Z0-9]/g,'_')}">🏖 Vacaciones</button>
        <button class="detalle-tab" onclick="switchDetalleTab('bancoHoras', this)">⏱ Banco de horas</button>
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
              <th>Hs total</th><th>Hs extra</th><th>Hs feriado</th>
              <th>Sáb.</th><th>Local</th><th>Nota</th>
            </tr>
          </thead>
          <tbody id="detalleTbody">
            ${filasIni.map(f => {
              if (f.esCert) return `<tr class="fila-certificado" data-fecha="${f.fechaISO}" data-hs="${f.hsTotal}" data-extra="0" data-feriado="0" data-sab="${f.esSab?1:0}" data-cert="1">
                <td>${f.fechaStr}</td><td>${f.diaSem}</td><td class="hora-reg">—</td>
                <td colspan="2"><span class="tag-cert">CERT</span> ${f.nota}</td>
                <td><strong>${f.hsTotal.toFixed(1)}</strong></td><td>—</td><td>—</td><td></td><td>—</td>
                <td><button onclick="eliminarCertificado('${f.certId}','${nombreEmp.replace(/'/g,"\\'")}','${f.fechaISO.substring(0,7)}')" style="background:none;border:none;cursor:pointer;color:#dc2626" title="Borrar">${icon('x','icon-12')}</button></td>
              </tr>`;
              return `<tr class="${f.esSab ? 'fila-sabado' : ''} ${f.esDom ? 'fila-domingo' : ''} ${f.esFer ? 'fila-feriado' : ''}" data-fecha="${f.fechaISO}" data-hs="${f.hsTotal}" data-extra="${f.hsExtra}" data-feriado="${f.hsFeriado||0}" data-sab="${f.esSab?1:0}" data-cert="0">
              <td>${f.fechaStr}${f.esFer ? ' <span class="tag-feriado">F</span>' : ''}</td>
              <td>${f.diaSem}</td>
              <td class="hora-reg">${f.horaReg}</td>
              <td class="turno-cell">${f.turno1}</td>
              <td class="turno-cell">${f.turno2 || '—'}</td>
              <td><strong>${f.hsTotal.toFixed(1)}</strong></td>
              <td>${f.hsExtra > 0 ? `<span class="hs-extra">${f.hsExtra.toFixed(1)}</span>` : '—'}</td>
              <td>${f.hsFeriado > 0 ? `<span class="hs-feriado">${f.hsFeriado.toFixed(1)}</span>` : '—'}</td>
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
              <td>${thFerIni > 0 ? `<span class="hs-feriado">${thFerIni.toFixed(1)}</span>` : '—'}</td>
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
      <div class="detalle-tabla-wrap" id="detalleTabBancoHoras" style="display:none;padding:1.5rem">
        <div id="bancoHorasAdminContent_inner">
          <p style="color:#94a3b8;font-size:13px">Cargando banco de horas...</p>
        </div>
      </div>
      <div class="detalle-footer">
        <span class="detalle-footer-nota">
          ${icon('info','icon-14')}
          Los horarios corresponden a registros del sistema
        </span>
        <span class="detalle-footer-update">
          Última actualización: ${ultActStr}
          <button class="detalle-footer-refresh" onclick="document.getElementById('btnRefresh')?.click()" title="Actualizar datos" aria-label="Actualizar datos">
            ${icon('refresh','icon-14')}
          </button>
        </span>
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
          <button class="detalle-close" onclick="cerrarDetalle()">${icon('x','icon-16')}</button>
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
  const sucId = (EMPLEADOS_PERFILES[nombreEmp]?.sucursal_id) || datosFiltrados[0]?.LOCAL || '';
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
        .detalle-close, .detalle-close-btn { display: none; }
        .detalle-footer { display: none; }
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
    const hsExtra   = calcularHsExtra(nombreEmp, hsTotal, fecha);
    const hsFeriado = calcularHsFeriado(hsTotal, fecha);
    const nota    = regs.map(r => r.NOTA).filter(Boolean).join(' / ');
    const local   = regs.map(r => {
      const s = SUCURSALES.find(x => x.id === r.LOCAL);
      return s ? s.nombre : r.LOCAL;
    }).filter((v,i,a) => a.indexOf(v)===i).join(', ');

    return { fechaStr, diaSem, horaReg, turno1, turno2, hsTotal, hsExtra, hsFeriado, esSab, local, nota };
  });

  const totalHoras   = filas.reduce((a,f) => a + f.hsTotal, 0);
  const totalExtra   = filas.reduce((a,f) => a + f.hsExtra, 0);
  const totalFeriado = filas.reduce((a,f) => a + (f.hsFeriado||0), 0);
  const totalSabs    = filas.filter(f => f.esSab).length;

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
  ws_data.push(['FECHA','DÍA','HORA REG.','TURNO 1','TURNO 2','HS TOTAL','HS EXTRA','HS FERIADO','SÁBADO','LOCAL','NOTA']);
  // Filas de datos
  filas.forEach(f => {
    ws_data.push([
      f.fechaStr, f.diaSem, f.horaReg,
      f.turno1, f.turno2,
      f.hsTotal, f.hsExtra > 0 ? f.hsExtra : 0, f.hsFeriado > 0 ? f.hsFeriado : 0,
      f.esSab ? 'Sí' : '',
      f.local, f.nota
    ]);
  });
  // Fila vacía
  ws_data.push([]);
  // Fila totales
  ws_data.push(['TOTALES', '', filas.length + ' días', '', '', totalHoras, totalExtra, totalFeriado, totalSabs, '', '']);

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
    { wch: 10 }, // HS FERIADO
    { wch: 7  }, // SÁBADO
    { wch: 16 }, // LOCAL
    { wch: 35 }, // NOTA
  ];

  // ── Estilos (negrita en encabezados y totales) ──
  const headerRow = 3; // índice 0-based fila 4
  const totalRow  = ws_data.length - 1;
  const cols = ['A','B','C','D','E','F','G','H','I','J','K'];

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
  const bhEl = document.getElementById('detalleTabBancoHoras');
  if (bhEl) bhEl.style.display = tab === 'bancoHoras' ? 'block' : 'none';
  if (tab === 'vacaciones' || tab === 'bancoHoras') {
    const tituloEl = document.querySelector('.detalle-titulo');
    if (tituloEl) {
      const nomDiv = tituloEl.textContent.trim().replace(/^#\d+\s*/,'').trim();
      const empNombre = state.datos.find(r => {
        const n = r.EMPLEADO.replace(/^\d+\s+/,'').trim();
        return n.toLowerCase() === nomDiv.toLowerCase();
      })?.EMPLEADO || nomDiv;
      if (tab === 'vacaciones') cargarVacacionesAdmin(empNombre);
      if (tab === 'bancoHoras') cargarBancoHorasDetalleAdmin(empNombre);
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
    if (!porMes[key]) porMes[key] = { horas: 0, dias: new Set(), hsExtra: 0, hsFeriado: 0, sabados: new Set() };
    const hs = parseFloat(r.TOTAL_HS) || 0;
    const fecha = new Date(r.AÑO, MESES_ES.indexOf(r.MES), parseInt(r.DIA));
    porMes[key].horas += hs;
    porMes[key].dias.add(r.DIA);
    if (esFeriado(fecha)) {
      porMes[key].hsFeriado += hs;                 // feriado: aparte, no cuenta como extra
    } else if (hs > 8) {
      porMes[key].hsExtra += hs - 8;
    }
    const dow = fecha.getDay();
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
      <td>${v.hsFeriado > 0 ? `<span class="hs-feriado">${v.hsFeriado.toFixed(0)}h</span>` : '—'}</td>
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
      <thead><tr><th>Mes</th><th>Días</th><th>Horas</th><th>Hs extra</th><th>Hs feriado</th><th>Sábados</th></tr></thead>
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

  // Calcular hsExtra y hsFeriado por día usando categoría del empleado
  Object.values(empMap).forEach(e => {
    e.hsExtra = 0; e.hsFeriado = 0;
    Object.entries(e.hsPorDia).forEach(([diaKey, hsDia]) => {
      const [anio, mes, dia] = diaKey.split('-');
      const fecha = new Date(parseInt(anio), MESES_ES.indexOf(mes), parseInt(dia));
      e.hsExtra   += calcularHsExtra(e.nombre, hsDia, fecha);
      e.hsFeriado += calcularHsFeriado(hsDia, fecha);
    });
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
          <th>Hs feriado</th>
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
      <td>${e.hsFeriado > 0 ? `<span class="hs-feriado">${e.hsFeriado.toFixed(1)}</span>` : '—'}</td>
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
          <td colspan="4"></td>
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
  renderEnVivo();
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
    const json = await fetchJSONretry(`${url}?accion=perfiles`);
    if (!json.ok) return;

    if (json.categorias?.length) CATEGORIAS_CONFIG = json.categorias;
    if (json.empleados?.length) {
      // Guardar perfiles que fueron editados localmente en esta sesión
      const perfilesLocales = { ...EMPLEADOS_PERFILES };
      EMPLEADOS_PERFILES = {};
      json.empleados.forEach(e => {
        // Normalizar sucursal_id: convertir número a string con cero si aplica
        if (e.sucursal_id !== undefined && e.sucursal_id !== '') {
          const sid = String(e.sucursal_id).trim();
          // Si es numérico de 1-2 dígitos, agregar cero adelante
          e.sucursal_id = /^\d{1,2}$/.test(sid) ? sid.padStart(2, '0') : sid;
        }
        EMPLEADOS_PERFILES[e.nombre] = e;
      });
      // Re-aplicar ediciones locales guardadas en sessionStorage (sobreviven cargarDatos)
      try {
        const saved = JSON.parse(sessionStorage.getItem('croma_perfiles_locales') || '{}');
        Object.keys(saved).forEach(nombre => {
          if (EMPLEADOS_PERFILES[nombre]) {
            // Aplicar solo los campos editados, preservando el resto del Sheet
            Object.assign(EMPLEADOS_PERFILES[nombre], saved[nombre]);
          }
        });
      } catch(e) {}
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
      EMPLEADOS_PERFILES[perfil.nombre] = { ...perfil, _editadoLocal: true };
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
    const json = await fetchJSONretry(`${urlUnica}?accion=horarios`);
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
      // El fichaje nuevo guarda el nombre completo con prefijo ("09 CIPO SAN
      // MARTIN"); ese prefijo de 2 dígitos ES el id de sucursal. Lo usamos
      // directo para que esos registros (p.ej. vendedores externos) se agrupen
      // bien. Si no hay prefijo, caemos al mapa de nombres.
      const prefijo  = (localRaw.match(/^(\d{2})\b/) || [])[1];
      const localId  = NOMBRE_A_ID[localRaw] || prefijo || localRaw;
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
    state.ultimaActualizacion = new Date();

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
  if (view !== 'envivo') detenerEnVivoAuto();
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
  document.getElementById(`view${capitalize(view)}`)?.classList.add('active');
  document.querySelector(`[data-view="${view}"]`)?.classList.add('active');

  localStorage.setItem('croma_vista', view);

  // Sincronizar drawer: marcar activo
  document.querySelectorAll('.drawer-nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  const weekNav    = document.querySelector('.week-nav:not(.mes-nav)');
  const mesNav     = document.getElementById('mesNav');
  const statsRow   = document.querySelector('.stats-row');
  const filters    = document.querySelector('.filters');
  const controlsBar = document.querySelector('.controls-bar');

  // Vistas que NO usan la barra de controles
  const sinControls = ['empleados', 'administracion', 'calendario', 'envivo'];
  if (controlsBar) controlsBar.style.display = sinControls.includes(view) ? 'none' : '';

  if (view === 'semana') {
    weekNav.style.display  = 'flex';
    mesNav.style.display   = 'none';
    statsRow.style.display = 'none';
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
    mostrarFiltrosDiaEnBarra(false);
  } else if (view === 'administracion') {
    weekNav.style.display  = 'none';
    mesNav.style.display   = 'none';
    statsRow.style.display = 'none';
    filters.style.display  = 'none';
    mostrarFiltrosDiaEnBarra(false);
    renderAdminInline();
  } else if (view === 'calendario') {
    weekNav.style.display  = 'none';
    mesNav.style.display   = 'none';
    statsRow.style.display = 'none';
    filters.style.display  = 'none';
    mostrarFiltrosDiaEnBarra(false);
    renderCalendarioView();
  } else if (view === 'envivo') {
    weekNav.style.display  = 'none';
    mesNav.style.display   = 'none';
    statsRow.style.display = 'none';
    filters.style.display  = 'none';
    mostrarFiltrosDiaEnBarra(false);
    renderEnVivo();
    iniciarEnVivoAuto();
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
  let dias = 0, hs = 0, extra = 0, feriado = 0, sabs = 0, certs = 0;
  visibles.forEach(tr => {
    dias++;
    hs      += parseFloat(tr.dataset.hs)      || 0;
    extra   += parseFloat(tr.dataset.extra)   || 0;
    feriado += parseFloat(tr.dataset.feriado) || 0;
    sabs    += parseInt(tr.dataset.sab)       || 0;
    certs   += parseInt(tr.dataset.cert)      || 0;
  });

  const elDias  = document.getElementById('detalleStatDias');
  const elHs    = document.getElementById('detalleStatHs');
  const elExtra = document.getElementById('detalleStatExtra');
  const elFer   = document.getElementById('detalleStatFeriado');
  const elSabs  = document.getElementById('detalleStatSabs');
  const elCerts = document.getElementById('detalleStatCerts');
  if (elDias)  elDias.textContent  = dias;
  if (elHs)    elHs.textContent    = hs.toFixed(1);
  if (elExtra) elExtra.textContent = extra.toFixed(1);
  if (elFer)   elFer.textContent   = feriado.toFixed(1);
  if (elSabs)  elSabs.textContent  = sabs;
  if (elCerts) elCerts.textContent = certs;

  const tfoot = document.getElementById('detalleTfoot');
  if (tfoot) {
    tfoot.innerHTML = `<tr>
      <td colspan="2"><strong>TOTALES</strong></td>
      <td>${dias}</td><td colspan="2"></td>
      <td><strong>${hs.toFixed(1)}</strong></td>
      <td>${extra > 0 ? `<span class="hs-extra">${extra.toFixed(1)}</span>` : '—'}</td>
      <td>${feriado > 0 ? `<span class="hs-feriado">${feriado.toFixed(1)}</span>` : '—'}</td>
      <td>${sabs}</td><td colspan="2"></td>
    </tr>`;
  }
}

function toggleFiltroDia(tipo, activo) {
  filtrosDia.verSolo = activo ? tipo : 'todos';

  const mapa = {
    feriados:     ['chkFeriados','chkFerBarra'],
    sabados:      ['chkSabados','chkSabBarra'],
    domingos:     ['chkDomingos','chkDomBarra'],
    laborales:    ['chkLaborales','chkLabBarra'],
    certificados: ['chkCertificados'],
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
    // Cache local → login instantáneo en segunda visita
    const cached = localStorage.getItem('croma_usuarios_cache');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed?.length) {
          _usuariosCache = parsed;
          // Refrescar en background sin bloquear
          fetch(`${APPS_SCRIPT_URL}?accion=cargar_usuarios`)
            .then(r => r.ok ? r.json() : null)
            .then(json => {
              if (json?.ok && json.usuarios?.length) {
                _usuariosCache = json.usuarios;
                localStorage.setItem('croma_usuarios_cache', JSON.stringify(json.usuarios));
              }
            }).catch(() => {});
          return _usuariosCache;
        }
      } catch(e) {}
    }
    // Sin cache — fetch bloqueante (primera vez)
    const json = await fetchJSONretry(`${APPS_SCRIPT_URL}?accion=cargar_usuarios`);
    if (!json.ok) return [];
    _usuariosCache = json.usuarios || [];
    localStorage.setItem('croma_usuarios_cache', JSON.stringify(_usuariosCache));
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
    const json = await fetchJSONretry(`${APPS_SCRIPT_URL}?accion=cargar_certificados`);
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
        <button class="detalle-close" onclick="cerrarAdmin()">${icon('x','icon-16')}</button>
      </div>
      <div class="admin-form">
        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Rango de fechas</label>
          <div style="display:flex;gap:8px">
            <div style="flex:1;display:flex;flex-direction:column;gap:4px">
              <span style="font-size:11px;color:#94a3b8">Desde</span>
              <input type="date" class="admin-input" id="certDesde" onchange="renderCertRango()" />
            </div>
            <div style="flex:1;display:flex;flex-direction:column;gap:4px">
              <span style="font-size:11px;color:#94a3b8">Hasta</span>
              <input type="date" class="admin-input" id="certHasta" onchange="renderCertRango()" />
            </div>
          </div>
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
        <div class="admin-form-grupo" id="certDiasGrupo" style="display:none">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:2px">
            <label class="emp-filtro-label" style="margin:0">Cobertura por día</label>
            <div style="display:flex;gap:6px">
              <button type="button" class="cert-bulk" onclick="setCertTodos('completa')">Todos completa</button>
              <button type="button" class="cert-bulk" onclick="setCertTodos('media')">Todos media</button>
            </div>
          </div>
          <div id="certDiasContainer"></div>
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

  // Estado de cobertura por día y horas de jornada completa según categoría
  CERT_HS_FULL = hsPorDefecto;
  CERT_DIAS_STATE = {};

  // Rango por defecto: hoy → hoy
  const hoy = new Date();
  const hoyISO = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-${String(hoy.getDate()).padStart(2,'0')}`;
  document.getElementById('certDesde').value = hoyISO;
  document.getElementById('certHasta').value = hoyISO;
  renderCertRango();
}

// Estado del formulario de certificados por rango
let CERT_DIAS_STATE = {};   // { 'YYYY-MM-DD': 'completa' | 'media' | 'quitar' }
let CERT_HS_FULL = 8;       // horas de jornada completa del empleado

function renderCertRango() {
  const desde = document.getElementById('certDesde')?.value;
  const hasta = document.getElementById('certHasta')?.value;
  const grupo = document.getElementById('certDiasGrupo');
  const cont  = document.getElementById('certDiasContainer');
  if (!grupo || !cont) return;
  if (!desde || !hasta) { grupo.style.display = 'none'; return; }

  const [y1,m1,d1] = desde.split('-').map(Number);
  const [y2,m2,d2] = hasta.split('-').map(Number);
  const ini = new Date(y1, m1-1, d1);
  const fin = new Date(y2, m2-1, d2);
  grupo.style.display = 'block';
  if (fin < ini) {
    cont.innerHTML = '<p style="color:#dc2626;font-size:12px;margin:0">La fecha "Hasta" es anterior a "Desde".</p>';
    return;
  }

  // Construir lista de días del rango (límite de seguridad: 120 días)
  const dias = [];
  const cur = new Date(ini);
  let guard = 0;
  while (cur <= fin && guard < 120) {
    const iso = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
    dias.push(iso);
    if (!(iso in CERT_DIAS_STATE)) {
      // Default según día: domingo → quitar, sábado → media, resto → completa
      const dow = cur.getDay();
      CERT_DIAS_STATE[iso] = dow === 0 ? 'quitar' : (dow === 6 ? 'media' : 'completa');
    }
    cur.setDate(cur.getDate() + 1);
    guard++;
  }
  // Limpiar días que ya no están en el rango
  Object.keys(CERT_DIAS_STATE).forEach(k => { if (!dias.includes(k)) delete CERT_DIAS_STATE[k]; });

  const DIAS_SEMANA = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const hsMedia = CERT_HS_FULL / 2;
  const seg = (iso, val, label) => {
    const activo = CERT_DIAS_STATE[iso] === val ? 'active' : '';
    return `<button type="button" class="cert-seg ${activo}" data-iso="${iso}" data-val="${val}" onclick="setCertDia('${iso}','${val}')">${label}</button>`;
  };
  const filas = dias.map(iso => {
    const [yy,mm,dd] = iso.split('-').map(Number);
    const dObj = new Date(yy, mm-1, dd);
    const finde = dObj.getDay() === 0 || dObj.getDay() === 6;
    const fer   = esFeriado(dObj);
    return `<div class="cert-dia-row ${finde ? 'cert-dia-finde' : ''} ${fer ? 'cert-dia-feriado' : ''}">
      <span class="cert-dia-lbl">${DIAS_SEMANA[dObj.getDay()]} ${String(dd).padStart(2,'0')}/${String(mm).padStart(2,'0')}${fer ? ' <span class="cert-dia-fer-tag">Feriado</span>' : ''}</span>
      <div class="cert-seg-group">
        ${seg(iso,'completa','Completa')}
        ${seg(iso,'media','Media')}
        ${seg(iso,'quitar','Quitar')}
      </div>
    </div>`;
  }).join('');

  cont.innerHTML =
    `<div class="cert-dias-nota">Completa = ${CERT_HS_FULL}h · Media = ${hsMedia}h · "Quitar" = no genera certificado ese día</div>
     <div class="cert-dias-cont">${filas}</div>`;
}

function setCertDia(iso, val) {
  CERT_DIAS_STATE[iso] = val;
  document.querySelectorAll(`.cert-seg[data-iso="${iso}"]`).forEach(b => {
    b.classList.toggle('active', b.dataset.val === val);
  });
}

function setCertTodos(val) {
  Object.keys(CERT_DIAS_STATE).forEach(k => CERT_DIAS_STATE[k] = val);
  renderCertRango();
}

function onCertTipoChange() {
  const tipo = document.getElementById('certTipo')?.value;
  const grupo = document.getElementById('certNotaGrupo');
  if (grupo) grupo.style.display = tipo === 'Personalizado' ? 'block' : 'none';
}

async function confirmarCertificado(nombreEmp) {
  const tipo  = document.getElementById('certTipo')?.value;
  const notaP = document.getElementById('certNotaPersonalizada')?.value.trim();
  const errEl = document.getElementById('certError');
  errEl.style.display = 'none';

  // Días seleccionados (excluyendo los marcados como "quitar")
  const dias = Object.keys(CERT_DIAS_STATE)
    .filter(iso => CERT_DIAS_STATE[iso] !== 'quitar')
    .sort();

  if (!dias.length) {
    errEl.textContent = 'Elegí al menos un día del rango.'; errEl.style.display='block'; return;
  }
  if (tipo === 'Personalizado' && !notaP) {
    errEl.textContent = 'Escribí una descripción'; errEl.style.display='block'; return;
  }

  const nota = tipo === 'Personalizado' ? notaP : tipo;
  // Guardar nombre sin número (ej: "38 BRUNO ALONSO" → "BRUNO ALONSO")
  const empLimpio = nombreEmp.trim().replace(/^\d+\s+/, '');

  const btn = document.querySelector('#adminOverlay .btn-connect');
  let okCount = 0, fail = 0;
  for (let i = 0; i < dias.length; i++) {
    const fecha = dias[i];
    const hs = CERT_DIAS_STATE[fecha] === 'media' ? CERT_HS_FULL / 2 : CERT_HS_FULL;
    if (btn) { btn.disabled = true; btn.textContent = `Guardando ${i+1}/${dias.length}...`; }
    const r = await guardarCertificado({ empleado: empLimpio, fecha, tipo, hs, nota });
    if (r.ok) okCount++; else fail++;
  }

  if (okCount > 0) {
    cerrarAdmin();
    showToast(fail
      ? `Guardados ${okCount} · fallaron ${fail}`
      : `✓ ${okCount} certificado${okCount > 1 ? 's' : ''} guardado${okCount > 1 ? 's' : ''}`);
    // Reabrir la ficha del empleado para ver los certificados
    const suc = state.datos.find(r => r.EMPLEADO === nombreEmp);
    if (suc) abrirDetalleEmpleado(nombreEmp, suc.LOCAL);
  } else {
    if (btn) { btn.disabled = false; btn.textContent = 'Guardar certificado'; }
    errEl.textContent = 'Error al guardar. Revisá la conexión.'; errEl.style.display='block';
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
  // Redirigir al login central de Croma App
  location.href = 'https://croma-app.com.ar/';
}

function _mostrarLoginAppLegado() {
  document.getElementById('setupScreen').style.display = 'none';
  document.getElementById('mainApp').style.display     = 'none';

  let loginEl = document.getElementById('loginScreen');
  if (!loginEl) {
    loginEl = document.createElement('div');
    loginEl.id = 'loginScreen';
    document.body.appendChild(loginEl);
  }

  // Leer usuario recordado (solo el nombre, nunca el PIN)
  const usuarioRecordado = localStorage.getItem('croma_remember_user') || '';

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
            value="${usuarioRecordado}"
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
              <span id="iconEye">${icon('eye','icon-16')}</span>
            </button>
          </div>
        </div>

        <label class="login-remember-wrap">
          <input type="checkbox" id="loginRecordar" ${usuarioRecordado ? 'checked' : ''} />
          <span>Recordar este dispositivo</span>
        </label>

        <p id="loginError" style="color:#dc2626;font-size:12px;margin:0;display:none;text-align:center">
          Usuario o PIN incorrecto
        </p>

        <button class="login-btn" onclick="intentarLogin()">
          INGRESAR
        </button>
      </div>

      <div class="login-footer">Sistema interno · Croma</div>
    </div>
  `;

  // Si hay usuario recordado, ir directo al PIN; si no, al usuario
  setTimeout(() => {
    if (usuarioRecordado) {
      document.getElementById('loginPin')?.focus();
    } else {
      document.getElementById('loginUsuario')?.focus();
    }
  }, 100);
}

function togglePinVisibility() {
  const input    = document.getElementById('loginPin');
  const iconWrap = document.getElementById('iconEye');
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    iconWrap.innerHTML = icon('eyeOff','icon-16');
  } else {
    input.type = 'password';
    iconWrap.innerHTML = icon('eye','icon-16');
  }
}

async function intentarLogin() {
  const usuario = document.getElementById('loginUsuario')?.value || '';
  const pin     = document.getElementById('loginPin')?.value     || '';
  const errEl   = document.getElementById('loginError');
  const btnEl   = document.querySelector('#loginScreen .login-btn');

  // Deshabilitar botón mientras verifica
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'VERIFICANDO...'; }
  errEl.style.display = 'none';

  const resultado = await verificarCredencialesAsync(usuario, pin);

  if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'INGRESAR'; }

  if (resultado.ok) {
    sesionActual = resultado.usuario;
    errEl.style.display = 'none';

    // Manejar "Recordar este dispositivo"
    const recordar = document.getElementById('loginRecordar')?.checked;
    if (recordar) {
      // Guardar usuario y sesión serializada (sin PIN) en localStorage
      localStorage.setItem('croma_remember_user', usuario.trim());
      localStorage.setItem('croma_session', JSON.stringify({
        usuario: resultado.usuario,
        ts: Date.now()
      }));
    } else {
      // Si desmarcó, borrar cualquier sesión guardada anterior
      localStorage.removeItem('croma_remember_user');
      localStorage.removeItem('croma_session');
    }

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
  if (sesionActual?.empleadoNombre) {
    localStorage.removeItem(`croma_horarios_${sesionActual.empleadoNombre.replace(/\s+/g,'_')}`);
  }
  const vieneDeCromaApp = sesionActual?.fromCromaApp;
  sesionActual = null;
  adminAutenticado = false;
  sessionStorage.removeItem('croma_admin_auth');
  localStorage.removeItem('croma_session');

  if (vieneDeCromaApp) {
    sessionStorage.clear();
    ['croma_auth','croma_rol','croma_suc','croma_remember'].forEach(k => localStorage.removeItem(k));
    location.href = 'https://croma-app.com.ar/?logout=1';
  } else {
    mostrarLoginApp();
  }
}

// ── INICIAR APP SEGÚN ROL ──────────────────────────────
function iniciarAppConSesion() {
  if (sesionActual.rol === 'admin') {
    adminAutenticado = true;
    sessionStorage.setItem('croma_admin_auth', '1');
    document.getElementById('navBtnAdmin').style.display       = '';
    document.getElementById('navBtnCalendario').style.display  = '';
    document.getElementById('drawerNavAdmin').style.display    = '';
    document.getElementById('drawerNavCalendario').style.display = '';
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
    const btnSel = document.getElementById('btnSelector');
    if (btnSel) btnSel.style.display = 'none';
    document.getElementById('btnRefresh')?.style && (document.getElementById('btnRefresh').style.display = 'none');
    document.getElementById('btnPrint')?.style && (document.getElementById('btnPrint').style.display = 'none');
    document.querySelector('.top-nav') && (document.querySelector('.top-nav').style.display = 'none');
    document.querySelector('.top-search') && (document.querySelector('.top-search').style.display = 'none');
    document.querySelector('.controls-bar') && (document.querySelector('.controls-bar').style.display = 'none');
    document.querySelector('.hamburger-btn') && (document.querySelector('.hamburger-btn').style.display = 'none');
    document.getElementById('bellWrap') && (document.getElementById('bellWrap').style.display = 'none');
    document.getElementById('bellWrapEmp') && (document.getElementById('bellWrapEmp').style.display = 'flex');
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
    <span class="sesion-nombre">${esAdmin ? `${icon('user','icon-14')} Admin` : sesionActual.nombre}</span>
    ${!esAdmin ? `<button class="sesion-perfil" onclick="abrirMiPerfil()" title="Mi perfil">
      ${icon('user','icon-12')}
      Mi perfil
    </button>` : ''}
    <button class="sesion-logout" onclick="cerrarSesion()" title="Cerrar sesión">
      ${icon('logOut','icon-13')}
    </button>
  `;
}

// ── VISTA EMPLEADO LOGUEADO ────────────────────────────
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 horas — cache válido aunque cierren el navegador

async function cargarDatosEmpleado() {
  const url = APPS_SCRIPT_URL;
  const nombreEmp = sesionActual?.empleadoNombre || sesionActual?.nombre || '';
  const cacheKey  = `croma_horarios_${nombreEmp.replace(/\s+/g,'_')}`;

  // ── Leer cache, pero solo si tiene menos de 4 horas ──
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      const { datos, perfiles, categorias, ts } = JSON.parse(cached);
      const edad = Date.now() - (ts || 0);
      if (datos?.length && edad < CACHE_TTL_MS) {
        // Cache fresco → mostrar al instante
        state.datos = datos;
        if (perfiles) Object.assign(EMPLEADOS_PERFILES, perfiles);
        if (categorias?.length) CATEGORIAS_CONFIG = categorias;
        setConnected(true);
        mostrarVistaEmpleado();
        // Refrescar silenciosamente en background
        _refrescarDatosEmpleadoBg(url, cacheKey);
        return;
      } else {
        // Cache vencido → borrarlo y cargar normal
        localStorage.removeItem(cacheKey);
      }
    } catch(e) { localStorage.removeItem(cacheKey); }
  }

  // ── Sin cache válido: carga bloqueante ──
  showToast('Cargando tu jornada...');
  await _refrescarDatosEmpleadoBg(url, cacheKey, true);
}

async function _refrescarDatosEmpleadoBg(url, cacheKey, bloqueante = false) {
  try {
    // Filtrar por empleado del lado del servidor: baja el payload de "toda
    // la hoja" a solo las filas de este empleado (mucho más rápido).
    const nombreEmp = sesionActual?.empleadoNombre || sesionActual?.nombre || '';
    const urlHorarios = `${url}?accion=horarios` +
      (nombreEmp ? '&empleado=' + encodeURIComponent(nombreEmp) : '');

    const [, , horariosResp] = await Promise.allSettled([
      cargarPerfiles(),
      cargarCertificados(),
      fetch(urlHorarios).then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }),
    ]);

    if (horariosResp.status === 'rejected') {
      if (bloqueante) {
        setConnected(false);
        showToast('Error al cargar: ' + horariosResp.reason?.message);
        mostrarVistaEmpleadoError();
      } else {
        showToast('Sin conexión — mostrando datos guardados');
      }
      return;
    }

    const json = horariosResp.value;
    if (json.ok === false) throw new Error(json.error || 'Error');

    const NOMBRE_A_ID = {
      'PASEO': '01', 'WAVE': '05', 'CIPO': '09', 'CIPO SAN MARTIN': '09',
      'PERITO': '10', 'PERITO MORENO': '10', 'CENTE': '12', 'CENTENARIO': '12',
      'ROCA180': '14', 'ROCA': '14', 'DEPO': 'DEPO', 'OFICINA': 'OFICINA',
    };
    state.datos = (json.data || []).map(r => {
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

    // Guardar con timestamp para TTL
    try {
      localStorage.setItem(cacheKey, JSON.stringify({
        datos: state.datos,
        perfiles: EMPLEADOS_PERFILES,
        categorias: CATEGORIAS_CONFIG,
        ts: Date.now(),
      }));
    } catch(e) {}

    setConnected(true);
    mostrarVistaEmpleado();
    if (!bloqueante) showToast('✓ Datos actualizados');

  } catch(err) {
    if (bloqueante) {
      setConnected(false);
      showToast('Error al cargar: ' + err.message);
      mostrarVistaEmpleadoError();
    } else {
      showToast('Sin conexión — mostrando datos guardados');
    }
  }
}

// Lleva al empleado logueado a fichar.html (check-in con GPS) sin re-loguear:
// escribe la sesión en el formato que espera fichar.html y navega.
function irAFicharEmpleado() {
  try {
    const ses = {
      nombre:         sesionActual.nombre,
      rol:            sesionActual.rol || 'empleado',
      empleadoNombre: sesionActual.empleadoNombre || sesionActual.nombre,
    };
    localStorage.setItem('croma_session', JSON.stringify(ses));
  } catch(e) {}
  window.location.href = 'fichar.html';
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
  _empSemanaOffset  = 0;
  _empPortalActual  = nombreEmp;
  _empMisRegistros  = misRegistros;
  renderVistaEmpleado(nombreEmp, sucId, misRegistros);
  // Verificar anuncios y eventos nuevos (sin bloquear)
  setTimeout(() => verificarAnunciosEmpleado(nombreEmp), 1200);
  setTimeout(() => cargarEventosEmpleado(nombreEmp), 1400);
}

function mostrarVistaEmpleadoSinDatos(nombreEmp) {
  const mainApp = document.getElementById('mainApp');
  mainApp.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:1rem">
      <div>${icon('fileText','icon-48')}</div>
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
      <div>${icon('alertTriangle','icon-48')}</div>
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
      const turno1 = r0.H_ENTRADA && r0.H_SALIDA ? `${normalizarLibreTxt(r0.H_ENTRADA)} – ${normalizarLibreTxt(r0.H_SALIDA)}` : '—';
      const turno2 = rrs[1]?.H_ENTRADA ? `${normalizarLibreTxt(rrs[1].H_ENTRADA)} – ${normalizarLibreTxt(rrs[1].H_SALIDA)}` : '';
      const hsTotal = rrs.reduce((a,r)=>a+(parseFloat(r.TOTAL_HS)||0),0);
      const hsExtra = calcularHsExtra(nombreEmp, hsTotal, fecha);
      const hsFeriado = calcularHsFeriado(hsTotal, fecha);
      const nota    = rrs.map(r=>r.NOTA).filter(Boolean).join(' / ');
      let horaReg = '', horaReg2 = '';
      try { if (r0.MARCA_TEMPORAL) horaReg = new Date(r0.MARCA_TEMPORAL).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}); } catch(e){}
      try { if (rrs[1]?.MARCA_TEMPORAL) horaReg2 = new Date(rrs[1].MARCA_TEMPORAL).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}); } catch(e){}
      return { fechaStr, diaSem, turno1, turno2, hsTotal, hsExtra, hsFeriado, esSab, esDom, esFer, nota, horaReg, horaReg2 };
    }).sort((a,b) => {
      // ordenar más viejo primero
      const da = a.fechaStr.split('/').reverse().join('-');
      const db = b.fechaStr.split('/').reverse().join('-');
      return da.localeCompare(db);
    });

    // Vista empleado: no se muestran certificados en este portal.
    const totalHoras     = filas.reduce((a,f)=>a+f.hsTotal,0);
    const totalHsExtra   = filas.reduce((a,f)=>a+f.hsExtra,0);
    const totalHsFeriado = filas.reduce((a,f)=>a+(f.hsFeriado||0),0);
    const totalSabs      = filas.filter(f=>f.esSab).length;
    return { filas, totalHoras, totalHsExtra, totalHsFeriado, totalSabs, diasUnicos: filas.length };
  }

  let { filas, totalHoras, totalHsExtra, totalHsFeriado, totalSabs, diasUnicos } = calcTotales(periodoActual);

  const opcionesMes = ['<option value="TODOS">Todos los registros</option>']
    .concat(periodos.map(p => `<option value="${p}" ${p===periodoActual?'selected':''}>${p}</option>`))
    .join('');

  const avatarInner = perfil.foto_url
    ? `<img src="${perfil.foto_url}" alt="${nomMostrar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentElement.innerHTML='${iniciales}'">`
    : (numVend ? `<span style="font-size:18px;font-weight:700;color:${suc.color}">#${numVend}</span>` : `<span style="font-size:18px;font-weight:700;color:${suc.color}">${iniciales}</span>`);

  const primerNombre = (nomMostrar || '').split(' ')[0] || nomMostrar;

  function normalizarLibreTxt(txt) {
    const v = String(txt || '').trim();
    return v.toUpperCase() === 'FRANCO' ? 'Libre' : v;
  }

  function fechaKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }

  function getEmpSemanaLabel(offset) {
    const lunes = getLunes(offset);
    const dom   = new Date(lunes); dom.setDate(lunes.getDate() + 6);
    const fmtOpts = { day: '2-digit', month: 'short' };
    const desde = lunes.toLocaleDateString('es-AR', fmtOpts);
    const hasta = dom.toLocaleDateString('es-AR', fmtOpts);
    if (offset === 0) return 'Esta semana · ' + desde + ' – ' + hasta;
    if (offset === 1) return 'Próxima semana · ' + desde + ' – ' + hasta;
    if (offset === -1) return 'Semana pasada · ' + desde + ' – ' + hasta;
    return (offset > 0 ? '+' : '') + offset + ' semanas · ' + desde + ' – ' + hasta;
  }

  function buildSemanaEmpleado() {
    const lunes = getLunes(_empSemanaOffset);
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    const diasLargos = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
    const cards = [];
    for (let i=0; i<7; i++) {
      const f = new Date(lunes); f.setDate(lunes.getDate()+i);
      const regs = misRegistros.filter(r =>
        String(r.AÑO) === String(f.getFullYear()) &&
        r.MES === MESES_ES[f.getMonth()] &&
        String(r.DIA) === String(f.getDate())
      ).sort((a,b)=>(a.H_ENTRADA||'').localeCompare(b.H_ENTRADA||''));
      const total = regs.reduce((a,r)=>a+(parseFloat(r.TOTAL_HS)||0),0);
      const esHoy = f.toDateString() === new Date().toDateString();
      const libre = !regs.length;

      // Tipo de turno para colorear
      let tipoTurno = '';
      if (!libre) {
        if (regs.length >= 2) tipoTurno = 'cortado';
        else if (total <= 4) tipoTurno = 'media';
        else if (total >= 7) tipoTurno = 'corrido';
      }

      const turnos = libre
        ? '<div class="portal-week-free">Libre</div>'
        : regs.map(r => {
            const ent = normalizarLibreTxt(r.H_ENTRADA);
            const sal = normalizarLibreTxt(r.H_SALIDA);
            if (!ent || !sal) return '<span class="portal-week-shift">Horario a confirmar</span>';
            return `<span class="portal-week-shift">${ent} → ${sal}</span>`;
          }).join('');
      cards.push(`
        <div class="portal-week-card ${libre?'is-free':''} ${esHoy?'is-today':''} ${tipoTurno?'turno-'+tipoTurno:''}">
          <div class="portal-week-day">
            <span>${diasLargos[i]}</span>
            <span class="portal-week-day-num">${f.getDate()}</span>
          </div>
          <div class="portal-week-body">
            ${turnos}
            ${!libre ? `<small>${total.toFixed(1)} hs</small>` : ''}
          </div>
        </div>`);
    }
    return cards.join('');
  }

  function getProximoTurno() {
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    // Agrupar registros por día
    const porDia = {};
    misRegistros.forEach(r => {
      const f = new Date(r.AÑO, MESES_ES.indexOf(r.MES), parseInt(r.DIA));
      f.setHours(0,0,0,0);
      if (f < hoy) return;
      const key = f.getTime();
      if (!porDia[key]) porDia[key] = { f, regs: [] };
      porDia[key].regs.push(r);
    });
    const dias = Object.values(porDia)
      .filter(d => d.regs.some(r => r.H_ENTRADA && r.H_SALIDA))
      .sort((a,b) => a.f - b.f);
    if (!dias.length) return '<span class="portal-next-empty">Sin próximos turnos cargados</span>';
    const { f, regs } = dias[0];
    regs.sort((a,b) => (a.H_ENTRADA||'').localeCompare(b.H_ENTRADA||''));
    const fecha = f.toLocaleDateString('es-AR', { weekday:'long', day:'2-digit', month:'2-digit' });
    const hsTotal = regs.reduce((a,r) => a + (parseFloat(r.TOTAL_HS)||0), 0);
    const turnosHtml = regs.filter(r => r.H_ENTRADA && r.H_SALIDA).map(r =>
      `<strong>${normalizarLibreTxt(r.H_ENTRADA)} → ${normalizarLibreTxt(r.H_SALIDA)}</strong>`
    ).join('<span style="color:#94a3b8;margin:0 4px">·</span>');
    return `<span class="portal-next-date">${fecha}</span>${turnosHtml}<small>${hsTotal.toFixed(1)} hs</small>`;
  }

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
        <td>—</td>
        <td></td>
        <td></td>
      </tr>`;
      return `
      <tr class="${f.esSab?'fila-sabado':''} ${f.esDom?'fila-domingo':''} ${f.esFer?'fila-feriado':''}">
        <td>${f.fechaStr}${f.esFer?' <span class="tag-feriado">F</span>':''}</td>
        <td>${f.diaSem}</td>
        <td class="hora-reg">${f.horaReg||'—'}${f.horaReg2 ? `<br><span class="hora-reg-2">${f.horaReg2}</span>` : ''}</td>
        <td class="turno-cell">${f.turno1}</td>
        <td class="turno-cell">${f.turno2||'—'}</td>
        <td><strong>${f.hsTotal.toFixed(1)}</strong></td>
        <td>${f.hsExtra>0?`<span class="hs-extra">${f.hsExtra.toFixed(1)}</span>`:'—'}</td>
        <td>${f.hsFeriado>0?`<span class="hs-feriado">${f.hsFeriado.toFixed(1)}</span>`:'—'}</td>
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
      const feriadoHtml = f.hsFeriado > 0 ? `<span class="ev-card-feriado-hs">+${f.hsFeriado.toFixed(1)} feriado</span>` : '';
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
              ${extraHtml}${feriadoHtml}${sabHtml}
            </div>
          </div>
          <div class="ev-card-turnos">
            <span class="ev-card-turno">${f.turno1}</span>
            ${turno2html}
            ${f.horaReg ? `<span class="ev-card-hora-reg">Reg. ${f.horaReg}${f.horaReg2 ? ` / ${f.horaReg2}` : ''}</span>` : ''}
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

  const _vc = document.getElementById('vistaEmpleadoContainer');
  _vc.innerHTML = `
    <div class="emp-vista-personal emp-portal-mobilefirst">

      <!-- PORTAL EMPLEADO -->
      <section class="portal-hero" style="--portal-color:${suc.color};--portal-soft:${suc.colorLight}">
        <div class="portal-profile-card">
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
          <div class="portal-profile-info">
            <span class="portal-kicker">Portal empleado</span>
            <h1 class="portal-greeting">Hola ${primerNombre}</h1>
            <p>${suc.nombre}</p>
            <div class="emp-badges-row">${empresaBadge}${catBadge}</div>
          </div>
        </div>

        <div class="portal-next-card">
          <span class="portal-kicker">Turno de hoy</span>
          ${getProximoTurno()}
        </div>
      </section>

      <button onclick="irAFicharEmpleado()" style="display:flex;align-items:center;justify-content:center;gap:10px;width:100%;margin:0 0 1rem;padding:16px;border:none;border-radius:16px;background:linear-gradient(135deg,#059669,#10b981);color:#fff;font-family:'DM Sans',sans-serif;font-size:15px;font-weight:600;cursor:pointer;box-shadow:0 6px 18px rgba(5,150,105,.28);letter-spacing:.2px;">
        ${icon('clock','icon-18')}
        Registrar mi jornada
      </button>

      <section class="portal-summary-grid">
        <div class="portal-summary-card">
          <span>Días</span>
          <strong id="evDias">${diasUnicos}</strong>
        </div>
        <div class="portal-summary-card">
          <span>Hs totales</span>
          <strong id="evHoras">${totalHoras.toFixed(1)}</strong>
        </div>
        <div class="portal-summary-card">
          <span>Hs extra</span>
          <strong id="evExtra">${totalHsExtra.toFixed(1)}</strong>
        </div>
        <div class="portal-summary-card">
          <span>Hs feriado</span>
          <strong id="evFeriado">${totalHsFeriado.toFixed(1)}</strong>
        </div>
        <div class="portal-summary-card">
          <span>Sábados</span>
          <strong id="evSabs">${totalSabs}</strong>
        </div>
      </section>

      <!-- SECCIÓN ANUNCIOS (historial) -->
      <div id="anunciosSectionWrap" style="display:none">
        <section class="portal-section portal-anuncios-section">
          <div class="portal-section-head">
            <div>
              <span class="portal-kicker">Novedades <span class="anuncio-seccion-badge" id="anunciosBadgeCount" style="display:none"></span></span>
              <h2>Anuncios</h2>
            </div>
          </div>
          <div id="anunciosSectionList"></div>
        </section>
      </div>

      <section class="portal-section portal-week-section">
        <div class="portal-section-head">
          <div>
            <span class="portal-kicker" id="empSemanaLabel">${getEmpSemanaLabel(_empSemanaOffset)}</span>
            <h2>Mi semana</h2>
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            <button class="emp-semana-nav-btn" onclick="empNavSemana(-1)" title="Semana anterior">&#8592;</button>
            <button class="emp-semana-nav-btn emp-semana-nav-hoy" onclick="empNavSemana(0,'reset')" title="Ir a esta semana">Hoy</button>
            <button class="emp-semana-nav-btn" onclick="empNavSemana(1)" title="Semana siguiente">&#8594;</button>
          </div>
        </div>
        <div class="portal-week-grid" id="empSemanaGrid">
          ${buildSemanaEmpleado()}
        </div>
      </section>

      <!-- TABS EMPLEADO -->
      <div class="detalle-tabs" style="margin:0 0 0 0;border-bottom:1px solid var(--gray-100)">
        <button class="detalle-tab active" onclick="switchEvTab('jornada',this)">Historial</button>
        <button class="detalle-tab" onclick="switchEvTab('vacaciones',this)">🏖 Vacaciones</button>
        <button class="detalle-tab" onclick="switchEvTab('bancoHoras',this)">⏱ Banco de horas</button>
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
          <button class="btn-detalle-accion" onclick="imprimirVistaEmpleado()" title="Imprimir">
            ${icon('printer','icon-14')}
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
              <th>Hs total</th><th>Hs extra</th><th>Hs feriado</th><th>Sáb.</th><th>Nota</th>
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
              <td>${totalHsFeriado>0?`<span class="hs-feriado">${totalHsFeriado.toFixed(1)}</span>`:'—'}</td>
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
          ${totalHsFeriado>0?`<span class="ev-card-feriado-hs">+${totalHsFeriado.toFixed(1)} feriado</span>`:''}
          <span>${totalSabs} sábados</span>
        </div>
      </div>
      </div><!-- fin evTabJornada -->

      <!-- CONTENIDO VACACIONES EMPLEADO -->
      <div id="evTabVacaciones" style="display:none;padding:1.5rem">
        <p style="color:#94a3b8;font-size:13px">Cargando vacaciones...</p>
      </div>

      <!-- CONTENIDO BANCO DE HORAS EMPLEADO -->
      <div id="evTabBancoHoras" style="display:none;padding:1.5rem">
        <p style="color:#94a3b8;font-size:13px">Cargando banco de horas...</p>
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
    const evFerEl = document.getElementById('evFeriado');
    if (evFerEl) evFerEl.textContent = t.totalHsFeriado.toFixed(1);
    document.getElementById('evSabs').textContent  = t.totalSabs;
    document.getElementById('evTbody').innerHTML   = buildFilas(t.filas);
    // Actualizar cards mobile
    const cardsWrap = document.getElementById('evCardsWrap');
    if (cardsWrap) cardsWrap.innerHTML = buildCards(t.filas) + `
      <div class="ev-card-totales">
        <span>${t.diasUnicos} días</span>
        <span>${t.totalHoras.toFixed(1)} hs totales</span>
        ${t.totalHsExtra>0?`<span class="ev-card-extra">+${t.totalHsExtra.toFixed(1)} extra</span>`:''}
        ${t.totalHsFeriado>0?`<span class="ev-card-feriado-hs">+${t.totalHsFeriado.toFixed(1)} feriado</span>`:''}
        <span>${t.totalSabs} sábados</span>
      </div>`;
    document.getElementById('evTfoot').innerHTML   = `
      <tr>
        <td colspan="2"><strong>TOTALES</strong></td>
        <td><strong>${t.diasUnicos}</strong></td>
        <td colspan="2"></td>
        <td><strong>${t.totalHoras.toFixed(1)}</strong></td>
        <td>${t.totalHsExtra>0?`<span class="hs-extra">${t.totalHsExtra.toFixed(1)}</span>`:'—'}</td>
        <td>${t.totalHsFeriado>0?`<span class="hs-feriado">${t.totalHsFeriado.toFixed(1)}</span>`:'—'}</td>
        <td><strong>${t.totalSabs}</strong></td>
        <td></td>
      </tr>`;
  });

  // Cargar vacaciones y banco de horas del empleado en background
  cargarVacacionesEmpleado(nombreEmp);
  cargarBancoHorasEmpleado(nombreEmp);
}

function imprimirVistaEmpleado() {
  const selectMes = document.getElementById('evSelectMes');
  const periodo = selectMes ? selectMes.value : 'TODOS';
  const periodoLabel = selectMes
    ? (selectMes.options[selectMes.selectedIndex]?.text || periodo)
    : 'Todos los registros';

  const tablaWrap = document.getElementById('evTablaWrap');
  const tablaHTML = tablaWrap ? tablaWrap.innerHTML : '';

  const nombreEl   = document.querySelector('.portal-profile-info h1');
  const sucursal   = document.querySelector('.portal-profile-info p');
  const nombreTxt  = nombreEl ? nombreEl.textContent.replace('👋','').replace('Hola','').trim() : '';
  const sucursalTxt = sucursal ? sucursal.textContent.trim() : '';

  const dias    = document.getElementById('evDias')?.textContent    || '—';
  const horas   = document.getElementById('evHoras')?.textContent   || '—';
  const extra   = document.getElementById('evExtra')?.textContent   || '—';
  const feriado = document.getElementById('evFeriado')?.textContent || '—';
  const sabs    = document.getElementById('evSabs')?.textContent    || '—';

  const win = window.open('', '_blank', 'width=900,height=700');
  win.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Historial ${periodoLabel} · ${nombreTxt}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'DM Sans', sans-serif; font-size: 13px; color: #111; padding: 28px 32px; background: #fff; }
    .print-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; border-bottom: 2px solid #111; padding-bottom: 14px; }
    .print-brand { font-family: 'Bebas Neue', sans-serif; font-size: 26px; letter-spacing: 3px; color: #111; }
    .print-meta { text-align: right; }
    .print-meta h2 { font-size: 16px; font-weight: 600; margin-bottom: 2px; }
    .print-meta p  { font-size: 12px; color: #555; }
    .print-stats { display: flex; gap: 24px; margin-bottom: 20px; padding: 12px 16px; background: #f7f7f5; border-radius: 8px; border: 1px solid #e5e5e0; }
    .print-stat { display: flex; flex-direction: column; gap: 2px; }
    .print-stat span { font-size: 11px; color: #777; text-transform: uppercase; letter-spacing: 0.5px; }
    .print-stat strong { font-family: 'Bebas Neue', sans-serif; font-size: 22px; letter-spacing: 1px; color: #111; }
    .detalle-tabla { width: 100%; border-collapse: collapse; font-size: 12px; }
    .detalle-tabla thead tr { background: #f7f7f5; }
    .detalle-tabla th { padding: 8px 10px; font-size: 10px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; color: #888; border-bottom: 1px solid #ddd; text-align: center; }
    .detalle-tabla td { padding: 7px 10px; border-bottom: 1px solid #eee; text-align: center; vertical-align: middle; }
    .detalle-tabla tfoot tr { background: #f7f7f5; }
    .detalle-tabla tfoot td { padding: 8px 10px; font-weight: 600; border-top: 2px solid #ddd; }
    .detalle-tabla tr:hover td { background: transparent; }
    .fila-sabado td { background: #fafaf0; }
    .fila-domingo td { color: #aaa; }
    .fila-feriado td { background: #fff8f0; }
    .hs-extra { background: #fef3c7; color: #92400e; padding: 2px 6px; border-radius: 10px; font-weight: 600; font-size: 11px; }
    .hs-feriado { background: #cffafe; color: #0e7490; padding: 2px 6px; border-radius: 10px; font-weight: 600; font-size: 11px; }
    .check-sab { color: #059669; font-weight: 700; }
    .tag-feriado { background: #fed7aa; color: #c2410c; padding: 1px 5px; border-radius: 4px; font-size: 10px; font-weight: 600; }
    .turno-cell { font-variant-numeric: tabular-nums; }
    .print-footer { margin-top: 20px; font-size: 11px; color: #aaa; text-align: right; }
    @media print { body { padding: 12px 16px; } .print-header { margin-bottom: 14px; } }
  </style>
</head>
<body>
  <div class="print-header">
    <div>
      <div class="print-brand">CROMA</div>
      <div style="font-size:11px;color:#888;letter-spacing:2px;margin-top:2px">HORARIOS</div>
    </div>
    <div class="print-meta">
      <h2>${nombreTxt}</h2>
      <p>${sucursalTxt}</p>
      <p style="margin-top:4px;font-weight:600">${periodoLabel}</p>
    </div>
  </div>
  <div class="print-stats">
    <div class="print-stat"><span>Días</span><strong>${dias}</strong></div>
    <div class="print-stat"><span>Hs totales</span><strong>${horas}</strong></div>
    <div class="print-stat"><span>Hs extra</span><strong>${extra}</strong></div>
    <div class="print-stat"><span>Hs feriado</span><strong>${feriado}</strong></div>
    <div class="print-stat"><span>Sábados</span><strong>${sabs}</strong></div>
  </div>
  ${tablaHTML}
  <div class="print-footer">Impreso el ${new Date().toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</div>
  <script>window.onload = function(){ window.focus(); window.print(); }<\/script>
</body>
</html>`);
  win.document.close();
}

// ── MI PERFIL (vista empleado) ─────────────────────────
async function abrirMiPerfil() {
  let lista = getUsuarios();
  if (!lista.length) lista = await cargarUsuarios();
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
        <button class="detalle-close" onclick="cerrarMiPerfil()">${icon('x','icon-16')}</button>
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

  let lista = getUsuarios();
  if (!lista.length) lista = await cargarUsuarios();
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
        <button class="detalle-close" onclick="cerrarAdmin();renderAdmin()">${icon('x','icon-16')}</button>
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
// adminAutenticado: true si el JWT tiene rol admin o jefe
function _isAdminJwt() {
  try {
    const t = sessionStorage.getItem('croma_token') || localStorage.getItem('croma_token');
    if (!t) return false;
    const p = JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
    return p.exp * 1000 > Date.now() && (p.rol === 'admin' || p.rol === 'jefe');
  } catch(e) { return false; }
}
let adminAutenticado = _isAdminJwt();

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
    const suc       = SUCURSALES.find(s => s.id === (perfil.sucursal_id || state.datos.find(r => r.EMPLEADO === nombre)?.LOCAL)) || { nombre: '—' };
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
      "<div>" +
        "<div class='admin-titulo'>Administración</div>" +
        "<span style='font-size:12px;color:#94a3b8;font-family:var(--font-body)'>" + empNombres.length + " empleados · " + SUCURSALES.length + " sucursales</span>" +
      "</div>" +
      "<button class='btn-admin-edit' style='font-size:12px' onclick='cerrarSesionAdmin()'>Cerrar sesión</button>" +
    "</div>" +
    "<div class='admin-tabs' id='adminTabs'>" +
      "<button class='admin-tab active' onclick=\"switchAdminTab('empleados',this)\">Empleados <span style='font-size:11px;background:#e2e8f0;color:#475569;border-radius:10px;padding:1px 7px;margin-left:4px'>" + empNombres.length + "</span></button>" +
      "<button class='admin-tab' onclick=\"switchAdminTab('categorias',this)\">Categorías</button>" +
      "<button class='admin-tab' onclick=\"switchAdminTab('usuarios',this)\">Usuarios</button>" +
      "<button class='admin-tab' onclick=\"switchAdminTab('configuracion',this)\">Configuración</button>" +
    "</div>" +
    "<div id='adminTabEmpleados' class='admin-tab-content'>" +
      "<div class='admin-toolbar'>" +
        "<input type='text' class='admin-search' id='adminBuscarEmp' placeholder='Buscar empleado...' oninput='filtrarTablaAdmin(this.value)' />" +
        "<span style='font-size:12px;color:#94a3b8'>" + empNombres.length + " empleados en el sistema</span>" +
      "</div>" +
      "<div class='admin-table-wrap'>" +
        "<table class='admin-tabla' id='adminTablaEmps'>" +
          "<thead><tr><th>Empleado</th><th>Sucursal</th><th>Empresa</th><th>Categoría</th><th>Foto</th><th></th></tr></thead>" +
          "<tbody>" + (filasEmps || "<tr><td colspan='6' style='text-align:center;padding:2.5rem;color:#94a3b8;font-size:13px'>Sin datos cargados</td></tr>") + "</tbody>" +
        "</table>" +
      "</div>" +
    "</div>" +
    "<div id='adminTabCategorias' class='admin-tab-content' style='display:none'>" +
      "<div class='admin-toolbar'>" +
        "<button class='btn-connect' style='width:auto;padding:8px 18px;font-size:13px;margin:0' onclick='abrirNuevaCategoria()'>+ Nueva categoría</button>" +
      "</div>" +
      "<div class='admin-table-wrap'>" +
        "<table class='admin-tabla'><thead><tr><th>Nombre</th><th>Descripción</th><th>Percibe extra</th><th></th></tr></thead>" +
        "<tbody>" + filasCats + "</tbody></table>" +
      "</div>" +
    "</div>" +
    renderAdminUsuarios() +
    "<div id='adminTabConfiguracion' class='admin-tab-content' style='display:none'>" +
      "<div style='padding:1.25rem 0;max-width:480px'>" +
        "<div class='admin-table-wrap' style='padding:1.5rem'>" +
          "<h3 style='font-size:14px;font-weight:600;margin:0 0 1.25rem;color:#1e293b'>Configuración general</h3>" +
          "<div class='admin-form-grupo'>" +
            "<label class='emp-filtro-label'>Email del administrador (para notificaciones de vacaciones)</label>" +
            "<input type='email' class='admin-input' id='cfgEmailAdmin' placeholder='admin@croma.com' />" +
          "</div>" +
          "<div style='margin-top:1.25rem'>" +
            "<button class='btn-connect' style='margin:0;width:auto;padding:10px 24px' onclick='guardarConfigAdmin()'>Guardar</button>" +
          "</div>" +
          "<p id='cfgStatus' style='font-size:12px;margin-top:8px;display:none'></p>" +
        "</div>" +
        "<div class='admin-table-wrap' style='padding:1.5rem;margin-top:1rem'>" +
          "<h3 style='font-size:14px;font-weight:600;margin:0 0 4px;color:#1e293b'>Emails por sucursal</h3>" +
          "<p style='font-size:12px;color:#94a3b8;margin:0 0 1.25rem'>Se usan para notificar eventos del calendario a cada sucursal.</p>" +
          SUCURSALES.map(function(s) {
            return "<div class='admin-form-grupo' style='margin-bottom:10px'>" +
              "<label class='emp-filtro-label'><span style='display:inline-block;width:8px;height:8px;border-radius:50%;background:" + s.color + ";margin-right:6px'></span>" + s.nombre + "</label>" +
              "<input type='email' class='admin-input cfg-suc-email' data-suc-id='" + s.id + "' placeholder='email@sucursal.com' style='margin:0' />" +
            "</div>";
          }).join('') +
          "<div style='margin-top:1.25rem'>" +
            "<button class='btn-connect' style='margin:0;width:auto;padding:10px 24px' onclick='guardarEmailsSucursales()'>Guardar emails</button>" +
          "</div>" +
          "<p id='cfgSucStatus' style='font-size:12px;margin-top:8px;display:none'></p>" +
        "</div>" +
        "<div class='admin-table-wrap' style='padding:1.5rem;margin-top:1rem'>" +
          "<h3 style='font-size:14px;font-weight:600;margin:0 0 4px;color:#1e293b'>Lista de correos para eventos</h3>" +
          "<p style='font-size:12px;color:#94a3b8;margin:0 0 1.25rem'>Estos correos estarán disponibles para elegir al crear un evento del calendario.</p>" +
          "<div id='cfgEmailsLista'><p style='font-size:12px;color:#94a3b8'>Cargando...</p></div>" +
          "<div style='display:flex;gap:8px;margin-top:12px'>" +
            "<input type='text' class='admin-input' id='cfgNuevoNombre' placeholder='Nombre' style='margin:0;flex:1' />" +
            "<input type='email' class='admin-input' id='cfgNuevoEmail' placeholder='correo@ejemplo.com' style='margin:0;flex:2' />" +
            "<button class='btn-connect' style='margin:0;width:auto;padding:10px 18px;white-space:nowrap' onclick='agregarEmailContacto()'>+ Agregar</button>" +
          "</div>" +
          "<p id='cfgEmailsStatus' style='font-size:12px;margin-top:8px;display:none'></p>" +
        "</div>" +
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
        <button class="detalle-close" onclick="cerrarAdmin();renderAdmin()">${icon('x','icon-16')}</button>
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
    activo: EMPLEADOS_PERFILES[nombre]?.activo !== false, // preservar estado; no reactivar al editar
    _editadoLocal: true,  // marca para sobrevivir recargas del Sheet
  };

  EMPLEADOS_PERFILES[nombre] = perfil;
  // Persistir en sessionStorage para sobrevivir renderAll() y cargarDatos()
  try {
    const saved = JSON.parse(sessionStorage.getItem('croma_perfiles_locales') || '{}');
    saved[nombre] = perfil;
    sessionStorage.setItem('croma_perfiles_locales', JSON.stringify(saved));
  } catch(e) {}

  await guardarPerfil(perfil);
  cerrarAdmin();

  // Actualizar solo el tbody de la tabla de empleados sin re-renderizar todo el panel
  const tablaBody = document.querySelector('#adminTablaEmps tbody');
  if (tablaBody) {
    const empNombres = [...new Set(state.datos.map(r => r.EMPLEADO))].sort((a, b) => {
      const na = parseInt(a) || 999, nb = parseInt(b) || 999;
      return na !== nb ? na - nb : a.localeCompare(b);
    });
    // Re-usar renderAdminInline solo para obtener el HTML de filas
    // Actualizar la fila específica del empleado editado
    const rows = tablaBody.querySelectorAll('tr');
    rows.forEach(row => {
      const btn = row.querySelector('.btn-admin-edit');
      if (btn && btn.getAttribute('onclick')?.includes(nombre.replace(/'/g,"\\'"))) {
        const suc = SUCURSALES.find(s => s.id === (sucursalId || state.datos.find(r => r.EMPLEADO === nombre)?.LOCAL)) || { nombre: '—', colorLight: '#f1f5f9', color: '#475569' };
        row.querySelector('td:nth-child(2) span').textContent = suc.nombre;
        const empCell = row.querySelector('td:nth-child(3)');
        if (empCell) empCell.innerHTML = empresa
          ? `<span class='emp-empresa-badge ${empresa==='MOSHE SRL'?'badge-moshe':'badge-cromawave'}'>${empresa}</span>`
          : `<span style='color:#94a3b8;font-size:12px'>—</span>`;
        const catCell = row.querySelector('td:nth-child(4)');
        const catNom  = CATEGORIAS_CONFIG.find(c => c.id === categoriaId)?.nombre || '—';
        if (catCell) catCell.innerHTML = categoriaId
          ? `<span class='emp-cat-badge'>${catNom}</span>`
          : `<span style='color:#94a3b8;font-size:12px'>—</span>`;
      }
    });
    // Si no encontró la fila (empleado nuevo), re-renderizar completo
    if (!tablaBody.innerHTML || !document.querySelector('#adminTablaEmps')) renderAdmin();
  } else {
    renderAdmin();
  }
  showToast('✓ Perfil guardado');
}

function abrirNuevaCategoria() { abrirEditarCategoria(null); }

function abrirEditarCategoria(catId) {
  const cat = catId ? CATEGORIAS_CONFIG.find(c => c.id === catId) : null;

  const html = `
  <div class="admin-overlay" id="adminOverlay" onclick="cerrarAdmin(event)">
    <div class="admin-panel admin-panel-sm" onclick="event.stopPropagation()">
      <div class="admin-header">
        <div class="admin-titulo">${cat ? 'Editar categoría' : 'Nueva categoría'}</div>
        <button class="detalle-close" onclick="cerrarAdmin();renderAdmin()">${icon('x','icon-16')}</button>
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

// ── DIÁLOGO DE CONFIRMACIÓN (estilo Croma, reemplaza confirm() nativo) ──
let _confirmCallback = null;

function mostrarConfirm({ titulo, mensaje, textoOk = 'Confirmar', textoCancel = 'Cancelar', peligro = false, onOk }) {
  _confirmCallback = onOk;
  const existing = document.getElementById('confirmOverlay');
  if (existing) existing.remove();

  const iconoPeligro = icon('alertTriangle','icon-26');
  const iconoInfo   = icon('info','icon-26');

  const div = document.createElement('div');
  div.id = 'confirmOverlay';
  div.className = 'admin-overlay confirm-overlay';
  div.onclick = (e) => { if (e.target === div) cerrarConfirm(); };
  div.innerHTML = `
    <div class="admin-panel admin-panel-sm confirm-panel" onclick="event.stopPropagation()">
      <div class="confirm-body">
        <div class="confirm-icono ${peligro ? 'confirm-icono-peligro' : 'confirm-icono-info'}">
          ${peligro ? iconoPeligro : iconoInfo}
        </div>
        <div class="confirm-titulo">${titulo}</div>
        <div class="confirm-mensaje">${mensaje}</div>
      </div>
      <div class="confirm-acciones">
        <button class="btn-demo" onclick="cerrarConfirm()">${textoCancel}</button>
        <button class="btn-connect ${peligro ? 'btn-connect-peligro' : ''}" onclick="_confirmAceptar()">${textoOk}</button>
      </div>
    </div>`;
  document.body.appendChild(div);
  document.body.style.overflow = 'hidden';
}

function cerrarConfirm() {
  const el = document.getElementById('confirmOverlay');
  if (el) el.remove();
  _confirmCallback = null;
  // No restaurar el scroll si todavía hay otro overlay abierto detrás
  if (!document.getElementById('detalleOverlay') && !document.getElementById('adminOverlay')) {
    document.body.style.overflow = '';
  }
}

function _confirmAceptar() {
  const cb = _confirmCallback;
  cerrarConfirm();
  if (typeof cb === 'function') cb();
}

// ── INIT ───────────────────────────────────────────────
function init() {
  // Lee token desde el hash (#token=...) para que no quede en logs del servidor
  const _hashParams   = new URLSearchParams(location.hash.slice(1));
  const _searchParams = new URLSearchParams(location.search);
  const _urlToken     = _hashParams.get('token')    || _searchParams.get('token');
  const _urlHsession  = _hashParams.get('hsession') || _searchParams.get('hsession');
  if (_urlToken)    sessionStorage.setItem('croma_token', _urlToken);
  if (_urlHsession) sessionStorage.setItem('croma_horarios_session', _urlHsession);
  if (_urlToken || _urlHsession) history.replaceState(null, '', location.pathname);

  // ── JWT CROMA APP ─────────────────────────────────────
  function _getJwtUser() {
    const t = sessionStorage.getItem('croma_token') || localStorage.getItem('croma_token');
    if (!t) return null;
    try {
      const payload = JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
      if (payload.exp * 1000 < Date.now()) return null;
      return payload;
    } catch(e) { return null; }
  }

  const jwtUser = _getJwtUser();

  if (jwtUser) {
    // Empleado que viene de Croma App → usar sesión de horarios guardada
    const empSesionStr = sessionStorage.getItem('croma_horarios_session') || localStorage.getItem('croma_horarios_session');
    if (jwtUser.rol === 'empleado' && empSesionStr) {
      try {
        const { usuario } = JSON.parse(empSesionStr);
        if (usuario && (usuario.nombre || usuario.empleadoNombre)) {
          sesionActual = { ...usuario, nombre: usuario.nombre, fromCromaApp: true };
          iniciarAppConSesion();
          return; // la vista de empleado no tiene weekRange ni los controles de admin
        } else { throw new Error('sesión inválida'); }
      } catch(e) {
        sessionStorage.removeItem('croma_token'); localStorage.removeItem('croma_token');
        location.href = 'https://croma-app.com.ar/';
        return;
      }
    } else {
      // Admin / encargado / jefe → acceso completo
      sesionActual = {
        nombre:       jwtUser.usuario ? jwtUser.usuario.charAt(0).toUpperCase() + jwtUser.usuario.slice(1) : 'Admin',
        rol:          jwtUser.rol || 'admin',
        sucursal:     jwtUser.sucursal || '',
        fromCromaApp: true
      };
      iniciarAppConSesion();
    }
  } else {
    // Sin token → redirigir a Croma App (todos pasan por ahí)
    location.href = 'https://croma-app.com.ar/';
    return;
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

// ── CAMBIO DE FOTO DE EMPLEADO (proxy backend) ────────
const BACKEND_URL = 'https://api.croma-app.com.ar';

function _getToken() {
  return sessionStorage.getItem('croma_token') || localStorage.getItem('croma_token');
}

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
    // 1 — Subir a ImgBB via proxy del backend (la API key nunca llega al cliente)
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const imgbbResp = await fetch(`${BACKEND_URL}/api/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${_getToken()}`
      },
      body: JSON.stringify({ image: base64 })
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
      document.querySelectorAll('.cfg-suc-email').forEach(function(input) {
        const id = input.dataset.sucId;
        input.value = _configCache['email_suc_' + id] || '';
      });
      renderEmailsLista();
    }
  } catch(e) { console.warn('Error cargando config:', e); }
}

async function guardarEmailsSucursales() {
  const statusEl = document.getElementById('cfgSucStatus');
  const inputs = [...document.querySelectorAll('.cfg-suc-email')];
  try {
    for (const input of inputs) {
      const clave = 'email_suc_' + input.dataset.sucId;
      const valor = input.value.trim();
      await fetch(vacApiUrl('guardar_config', { clave, valor }));
      _configCache[clave] = valor;
    }
    if (statusEl) { statusEl.textContent = '✓ Emails guardados'; statusEl.style.color = '#065f46'; statusEl.style.display = 'block'; }
    setTimeout(function() { if (statusEl) statusEl.style.display = 'none'; }, 2500);
  } catch(e) {
    if (statusEl) { statusEl.textContent = 'Error: ' + e.message; statusEl.style.color = '#dc2626'; statusEl.style.display = 'block'; }
  }
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

// ── LISTA DE EMAILS CONTACTOS ─────────────────────────
function getEmailsContactos() {
  try { return JSON.parse(_configCache.emails_contactos || '[]'); } catch(e) { return []; }
}

function renderEmailsLista() {
  const lista = getEmailsContactos();
  const el = document.getElementById('cfgEmailsLista');
  if (!el) return;
  if (!lista.length) {
    el.innerHTML = '<p style="font-size:12px;color:#94a3b8;padding:4px 0">Sin correos agregados.</p>';
    return;
  }
  el.innerHTML = lista.map(function(c, i) {
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9">' +
      '<div style="flex:1">' +
        '<div style="font-size:13px;font-weight:500;color:#1e293b">' + c.nombre + '</div>' +
        '<div style="font-size:12px;color:#64748b">' + c.email + '</div>' +
      '</div>' +
      '<button onclick="eliminarEmailContacto(' + i + ')" style="background:none;border:none;cursor:pointer;color:#94a3b8;padding:4px;line-height:1" title="Eliminar">' + icon('x','icon-14') + '</button>' +
    '</div>';
  }).join('');
}

async function agregarEmailContacto() {
  const nombre = document.getElementById('cfgNuevoNombre')?.value.trim();
  const email  = document.getElementById('cfgNuevoEmail')?.value.trim();
  const statusEl = document.getElementById('cfgEmailsStatus');
  if (!nombre || !email) { showToast('Completá nombre y correo'); return; }
  const lista = getEmailsContactos();
  lista.push({ nombre, email });
  await guardarEmailsContactos(lista, statusEl);
  document.getElementById('cfgNuevoNombre').value = '';
  document.getElementById('cfgNuevoEmail').value = '';
}

async function eliminarEmailContacto(idx) {
  const lista = getEmailsContactos();
  lista.splice(idx, 1);
  await guardarEmailsContactos(lista, document.getElementById('cfgEmailsStatus'));
}

async function guardarEmailsContactos(lista, statusEl) {
  try {
    const valor = JSON.stringify(lista);
    const resp = await fetch(vacApiUrl('guardar_config', { clave: 'emails_contactos', valor }));
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error);
    _configCache.emails_contactos = valor;
    renderEmailsLista();
    if (statusEl) { statusEl.textContent = '✓ Guardado'; statusEl.style.color='#065f46'; statusEl.style.display='block'; setTimeout(function(){ statusEl.style.display='none'; }, 2000); }
  } catch(e) {
    if (statusEl) { statusEl.textContent = 'Error: ' + e.message; statusEl.style.color='#dc2626'; statusEl.style.display='block'; }
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
              onclick="_calVacMes=${mesIdx};_calVacAnio=${anioSol};switchVacTab('calendario',document.querySelector('#vacTabs .admin-tab'));setTimeout(cargarCalendarioVacaciones,50)">${icon('calendar','icon-14')} Ver</button>
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
        <button class="detalle-close" onclick="cerrarAdmin()">${icon('x','icon-16')}</button>
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
        <button class="detalle-close" onclick="cerrarAdmin()">${icon('x','icon-16')}</button>
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
    const vacView = document.getElementById('viewCalendario');
    if (vacView && vacView.classList.contains('active')) renderCalendarioView();
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
        <button class="detalle-close" onclick="cerrarAdmin()">${icon('x','icon-16')}</button>
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
          <button class="btn-connect" style="margin:0" id="btnEnviarSolicitudVac" onclick="confirmarSolicitudVac('${empEnc}')">Enviar solicitud</button>
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
  const btn = document.getElementById('btnEnviarSolicitudVac');
  if (btn && btn.disabled) return; // evita doble envío por doble click
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
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
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
    if (btn) { btn.disabled = false; btn.textContent = 'Enviar solicitud'; }
  }
}

// ── SWITCH TAB VISTA EMPLEADO ─────────────────────────
function switchEvTab(tab, btn) {
  document.querySelectorAll('.emp-vista-personal .detalle-tabs .detalle-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const jornada    = document.getElementById('evTabJornada');
  const vacaciones = document.getElementById('evTabVacaciones');
  const bancoHoras = document.getElementById('evTabBancoHoras');
  if (jornada)    jornada.style.display    = tab === 'jornada'    ? 'block' : 'none';
  if (vacaciones) vacaciones.style.display = tab === 'vacaciones' ? 'block' : 'none';
  if (bancoHoras) bancoHoras.style.display = tab === 'bancoHoras' ? 'block' : 'none';
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
            '<button class="bell-dd-cal-btn" onclick="_calVacMes=' + mesIdx + ';_calVacAnio=' + anioSol + ';setView(\'calendario\');document.getElementById(\'bellDropdown\')?.remove()">' + icon('calendar','icon-14') + ' Ver en calendario</button>' +
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
        '<div class="bell-dd-more" onclick="setView(\'calendario\');document.getElementById(\'bellDropdown\')?.remove()">' +
          (sols.length > 5 ? 'Ver todas (' + sols.length + ') →' : 'Ir a Calendario →') +
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
    const [todas, eventos] = await Promise.all([
      fetchSolicitudesCache(false),
      cargarEventos(false)
    ]);
    renderCalendarioVacaciones(container, todas.filter(function(s) {
      return s.estado === 'aprobada' || s.estado === 'pendiente';
    }), eventos);
  } catch(e) {
    container.innerHTML = '<div style="padding:1.5rem"><p style="color:#dc2626;font-size:13px">Error: ' + e.message + '</p></div>';
  }
}

function renderCalendarioVacaciones(container, solicitudes, eventos) {
  eventos = eventos || [];
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
    const perfSol = EMPLEADOS_PERFILES[s.empleado] || {}; const sucEmp = perfSol.sucursal_id || (state.datos.find(function(r) { return r.EMPLEADO === s.empleado; }) || {}).LOCAL;
    return sucEmp === _calVacFiltroLocal;
  });

  function hayConflicto(empsEnFecha) {
    if (empsEnFecha.length < 2) return false;
    const grupos = {};
    empsEnFecha.forEach(function(s) {
      const perfEmp = EMPLEADOS_PERFILES[s.empleado] || {}; const local = perfEmp.sucursal_id || (state.datos.find(function(r) { return r.EMPLEADO === s.empleado; }) || {}).LOCAL || 'x';
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
      const perfEmp2 = EMPLEADOS_PERFILES[s.empleado] || {}; const local = perfEmp2.sucursal_id || (state.datos.find(function(r) { return r.EMPLEADO === s.empleado; }) || {}).LOCAL || '';
      const suc   = SUCURSALES.find(function(x) { return x.id === local; }) || { color: '#94a3b8', colorLight: '#f1f5f9' };
      const esPend = s.estado === 'pendiente';
      return '<div class="cal-vac-emp" style="background:' + suc.colorLight + ';border-left:3px solid ' + suc.color + ';' + (esPend ? 'opacity:0.6;' : '') + '">' +
        '<span style="font-size:10px;font-weight:500;color:' + suc.color + '">' + nom + (esPend ? ' ·' : '') + '</span></div>';
    }).join('');
    const eventosDelDia = eventos.filter(function(ev) {
      const fin = ev.fecha_fin || ev.fecha;
      return isoFecha >= ev.fecha && isoFecha <= fin;
    });
    const eventosRows = eventosDelDia.map(function(ev) {
      const vencido = (ev.fecha_fin || ev.fecha) < hoyISO;
      return '<div class="cal-vac-evento' + (vencido ? ' cal-vac-evento-vencido' : '') + '" title="' + (ev.descripcion || '') + '" onclick="event.stopPropagation(); eliminarEvento(\'' + ev.id + '\')" style="cursor:pointer">' +
        '<span style="font-size:9px">' + (vencido ? '📋' : '📌') + '</span>' +
        '<span style="font-size:9px;font-weight:600;color:' + (vencido ? '#94a3b8' : '#7c3aed') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + ev.titulo + (vencido ? ' (Vencido)' : '') + '</span>' +
      '</div>';
    }).join('');
    celdasHTML += '<div class="cal-vac-cell' +
      (esHoy     ? ' cal-vac-hoy'      : '') +
      (esFinde   ? ' cal-vac-finde'    : '') +
      (esFer     ? ' cal-vac-feriado'  : '') +
      (conflicto ? ' cal-vac-conflicto': '') + '"' +
      ' onclick="abrirNuevoEvento(\'' + isoFecha + '\')" style="cursor:pointer">' +
      '<div class="cal-vac-num">' + d + (esFer ? ' <span class="cal-fer-dot" title="Feriado">🗓</span>' : '') + (conflicto ? ' <span style="color:#f59e0b">!!</span>' : '') + '</div>' +
      empRows + eventosRows + '</div>';
  }

  // Tabla solicitudes del mes
  const solsMes = solsFiltradas.filter(function(s) {
    if (!s.fecha_desde) return false;
    const p = s.fecha_desde.split('-').map(Number);
    return p[0] === _calVacAnio && p[1]-1 === _calVacMes;
  });

  const tablaSols = solsMes.length ? solsMes.map(function(s) {
    const nom   = s.empleado.replace(/^\d+\s+/, '');
    const perfSol2 = EMPLEADOS_PERFILES[s.empleado] || {}; const local = perfSol2.sucursal_id || (state.datos.find(function(r) { return r.EMPLEADO === s.empleado; }) || {}).LOCAL || '-';
    const suc   = SUCURSALES.find(function(x) { return x.id === local; }) || { nombre: local, color: '#94a3b8', colorLight: '#f1f5f9' };
    const conflictoSol = solsFiltradas.some(function(o) {
      return o.id !== s.id &&
        (EMPLEADOS_PERFILES[o.empleado]?.sucursal_id || (state.datos.find(function(r) { return r.EMPLEADO === o.empleado; }) || {}).LOCAL) === local &&
        o.fecha_desde <= s.fecha_hasta && o.fecha_hasta >= s.fecha_desde;
    });
    const partesSol = s.fecha_desde ? s.fecha_desde.split('-') : [];
    const mesSol  = partesSol.length >= 2 ? parseInt(partesSol[1]) - 1 : 0;
    const anioSol = partesSol.length >= 1 ? parseInt(partesSol[0]) : new Date().getFullYear();
    const calBtn  = '<button class="btn-admin-edit" style="font-size:11px" ' +
      'onclick="_calVacMes=' + mesSol + ';_calVacAnio=' + anioSol + ';cargarCalendarioVacaciones()">' + icon('calendar','icon-14') + ' Ver</button>';
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
      '<td>' + (conflictoSol ? '<span style="color:#f59e0b;font-weight:600">' + icon('alertTriangle','icon-14') + ' Conflicto</span>' : '—') + '</td>' +
      '<td>' + acciones + '</td></tr>';
  }).join('') : '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:1.5rem;font-size:13px">Sin solicitudes en este mes</td></tr>';

  const headersSem = diasSem.map(function(d) { return '<div class="cal-vac-header">' + d + '</div>'; }).join('');

  container.innerHTML =
    '<div style="padding:1.5rem">' +
    '<div class="cal-vac-wrap">' +
    // Toolbar
    '<div class="cal-vac-toolbar">' +
      '<div class="cal-vac-nav">' +
        '<button class="week-btn" onclick="cambiarMesCalVac(-1)">&#8592;</button>' +
        '<select class="filter-select" style="font-size:14px;font-weight:600;background:transparent;border:none;box-shadow:none" onchange="_calVacMes=parseInt(this.value);cargarCalendarioVacaciones()">' + mesOpts + '</select>' +
        '<select class="filter-select" style="font-size:14px;font-weight:600;width:78px;background:transparent;border:none;box-shadow:none" onchange="_calVacAnio=parseInt(this.value);cargarCalendarioVacaciones()">' + anioOpts + '</select>' +
        '<button class="week-btn" onclick="cambiarMesCalVac(1)">&#8594;</button>' +
      '</div>' +
      '<select class="filter-select" style="font-size:13px" onchange="_calVacFiltroLocal=this.value;cargarCalendarioVacaciones()">' + sucOpts + '</select>' +
      '<button class="btn-connect" style="width:auto;padding:6px 16px;font-size:12px;margin:0" onclick="abrirNuevoEvento()">＋ Nuevo evento</button>' +
      '<div class="cal-vac-legend">' +
        '<span class="cal-vac-legend-item"><span class="cal-vac-legend-dot" style="background:#d1fae5;border-left:3px solid #059669"></span>Aprobada</span>' +
        '<span class="cal-vac-legend-item"><span class="cal-vac-legend-dot" style="background:#fef9c3;border-left:3px solid #f59e0b"></span>Pendiente</span>' +
        '<span class="cal-vac-legend-item"><span class="cal-vac-legend-dot" style="background:#fef3c7"></span>Feriado</span>' +
        '<span class="cal-vac-legend-item" style="color:#7c3aed;font-weight:600">📌 Evento</span>' +
        '<span class="cal-vac-legend-item" style="color:#f59e0b;font-weight:600">⚠ Conflicto</span>' +
      '</div>' +
    '</div>' +
    // Grilla
    '<div class="cal-vac-grid">' + headersSem + celdasHTML + '</div>' +
    '</div>' +
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
//  EVENTOS DEL CALENDARIO — Sistema completo
// ══════════════════════════════════════════════════════

var _eventosCache = null;

function eventosApiUrl(accion, params) {
  let url = APPS_SCRIPT_URL + '?accion=' + accion;
  if (params) Object.entries(params).forEach(function([k,v]) {
    if (v !== undefined && v !== null) url += '&' + k + '=' + encodeURIComponent(v);
  });
  return url;
}

async function cargarEventos(force) {
  if (!force && _eventosCache !== null) return _eventosCache;
  try {
    const resp = await fetch(eventosApiUrl('get_eventos'));
    const json = await resp.json();
    _eventosCache = json.ok ? (json.eventos || []) : [];
  } catch(e) {
    if (_eventosCache === null) _eventosCache = [];
  }
  return _eventosCache;
}

// ── Modal nuevo evento ─────────────────────────────────
async function abrirNuevoEvento(fechaPreset) {
  if (!_configCache.emails_contactos) {
    try { await cargarConfigAdmin(); } catch(e) {}
  }
  const usuarios = getUsuarios().filter(function(u) { return u.rol === 'empleado' && u.empleadoNombre; });
  const hoy = new Date().toISOString().substring(0,10);
  const fechaVal = fechaPreset || hoy;

  const sucCheckboxes = SUCURSALES.map(function(s) {
    return '<label style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f1f5f9;cursor:pointer">' +
      '<input type="checkbox" class="evento-suc-cb" value="suc_' + s.id + '" style="width:16px;height:16px;accent-color:#7c3aed" />' +
      '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + s.color + ';flex-shrink:0"></span>' +
      '<span style="font-size:13px;color:#374151">' + s.nombre + '</span>' +
    '</label>';
  }).join('');

  const empOpts = usuarios.map(function(u) {
    const nom = u.empleadoNombre.replace(/^\d+\s+/,'');
    return '<label style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f1f5f9;cursor:pointer">' +
      '<input type="checkbox" class="evento-dest-cb" value="' + u.empleadoNombre + '" style="width:16px;height:16px;accent-color:#7c3aed" />' +
      '<span style="font-size:13px;color:#374151">' + nom + '</span>' +
    '</label>';
  }).join('');

  const html = `
  <div class="admin-overlay" id="adminOverlay" onclick="cerrarAdmin(event)">
    <div class="admin-panel admin-panel-sm" onclick="event.stopPropagation()">
      <div class="admin-header">
        <div class="admin-titulo">Nuevo evento</div>
        <button class="detalle-close" onclick="cerrarAdmin()">${icon('x','icon-16')}</button>
      </div>
      <div class="admin-form" style="gap:14px">

        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Título del evento *</label>
          <input type="text" class="admin-input" id="eventoTitulo" placeholder="Ej: Reunión de personal, Capacitación..." maxlength="80" />
        </div>

        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Fecha *</label>
          <div style="display:flex;gap:10px;align-items:center">
            <div style="flex:1">
              <div style="font-size:10px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Desde</div>
              <input type="date" class="admin-input" id="eventoFecha" value="${fechaVal}" onchange="eventoFechaDesdeChange()" style="margin:0" />
            </div>
            <div style="flex:1">
              <div style="font-size:10px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Hasta</div>
              <input type="date" class="admin-input" id="eventoFechaFin" value="${fechaVal}" style="margin:0" />
            </div>
          </div>
        </div>

        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Descripción (opcional)</label>
          <textarea class="admin-input" id="eventoDesc" rows="3" placeholder="Detalles del evento..." style="resize:vertical;font-family:inherit;font-size:13px"></textarea>
        </div>

        <div class="admin-form-grupo">
          <label class="emp-filtro-label">¿Quién puede verlo?</label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:8px">
            <input type="radio" name="eventoDestTipo" id="eventoDestTodos" value="todos" checked onchange="toggleEventoDest(this.value)" style="accent-color:#7c3aed" />
            <span style="font-size:13px;color:#374151">Todos los empleados</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:8px">
            <input type="radio" name="eventoDestTipo" id="eventoDestSucursal" value="sucursal" onchange="toggleEventoDest(this.value)" style="accent-color:#7c3aed" />
            <span style="font-size:13px;color:#374151">Sucursal específica</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:8px">
            <input type="radio" name="eventoDestTipo" id="eventoDestEspecifico" value="especifico" onchange="toggleEventoDest(this.value)" style="accent-color:#7c3aed" />
            <span style="font-size:13px;color:#374151">Empleados específicos</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="radio" name="eventoDestTipo" id="eventoDestPersonal" value="personal" onchange="toggleEventoDest(this.value)" style="accent-color:#7c3aed" />
            <span style="font-size:13px;color:#374151">Solo yo (nota personal en el calendario)</span>
          </label>

          <div id="eventoDestSucursalWrap" style="display:none;margin-top:10px;max-height:180px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:8px;padding:4px 12px">
            ${sucCheckboxes}
          </div>
          <div id="eventoDestEspWrap" style="display:none;margin-top:10px;max-height:200px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:8px;padding:4px 12px">
            ${empOpts || '<p style="font-size:12px;color:#94a3b8;padding:8px 0">No hay empleados con usuario configurado</p>'}
          </div>
        </div>

        <div class="admin-form-grupo" style="background:#fff0f0;border-radius:10px;padding:12px;border:1px solid #fecaca">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="eventoLocalCerrado" style="width:16px;height:16px;accent-color:#dc2626" onchange="toggleLocalCerrado(this.checked)" />
            <span style="font-size:13px;font-weight:600;color:#dc2626">🔴 Local cerrado</span>
          </label>
          <span style="font-size:11px;color:#94a3b8;margin-top:4px;display:block">Los empleados verán "LOCAL CERRADO" en su semana en vez de "Libre"</span>
        </div>

        <div class="admin-form-grupo" style="background:#f8fafc;border-radius:10px;padding:12px;border:1px solid #e2e8f0">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="eventoConAnuncio" style="width:16px;height:16px;accent-color:#7c3aed" onchange="toggleEventoAnuncio(this.checked)" />
            <span style="font-size:13px;font-weight:500;color:#374151">${icon('bell','icon-14')} Enviar también como anuncio</span>
          </label>
          <span style="font-size:11px;color:#94a3b8;margin-top:4px;display:block">El evento aparecerá en el calendario Y como notificación al empleado</span>
          <div id="eventoAnuncioWrap" style="display:none;margin-top:10px">
            <input type="text" class="admin-input" id="eventoAnuncioMsg" placeholder="Mensaje adicional del anuncio (opcional)" />
          </div>
        </div>

        ${(function() {
          const contactos = getEmailsContactos();
          if (!contactos.length) return '';
          const lista = contactos.map(function(c){ return c.nombre; }).join(', ');
          return '<div class="admin-form-grupo" style="background:#f0f9ff;border-radius:10px;padding:12px;border:1px solid #bae6fd">' +
            '<label style="display:flex;align-items:center;gap:8px;cursor:pointer">' +
              '<input type="checkbox" id="eventoEmailAdmins" style="width:16px;height:16px;accent-color:#0369a1" />' +
              '<div>' +
                '<div style="font-size:13px;font-weight:600;color:#0369a1">✉️ Notificar a Administración</div>' +
                '<div style="font-size:11px;color:#64748b;margin-top:2px">' + lista + '</div>' +
              '</div>' +
            '</label>' +
          '</div>';
        })()}

        <div style="display:flex;flex-direction:column;gap:8px;margin-top:0.5rem">
          <button class="btn-connect" style="margin:0" onclick="guardarEvento()">Guardar evento</button>
          <button class="btn-demo" onclick="cerrarAdmin()">Cancelar</button>
        </div>
      </div>
    </div>
  </div>`;

  montarOverlayAdmin(html);
}

function eventoFechaDesdeChange() {
  const desde = document.getElementById('eventoFecha')?.value;
  const hastaEl = document.getElementById('eventoFechaFin');
  if (hastaEl && desde) {
    if (hastaEl.value < desde) hastaEl.value = desde;
    hastaEl.min = desde;
  }
}

function toggleEventoDest(val) {
  document.getElementById('eventoDestSucursalWrap').style.display = val === 'sucursal'  ? 'block' : 'none';
  document.getElementById('eventoDestEspWrap').style.display      = val === 'especifico'? 'block' : 'none';
}

function toggleLocalCerrado(checked) {
  if (checked) {
    // Local cerrado implica sucursal específica
    const radSuc = document.querySelector('input[name="eventoDestTipo"][value="sucursal"]');
    if (radSuc) { radSuc.checked = true; toggleEventoDest('sucursal'); }
    // Prellenar título y descripción
    const tituloEl = document.getElementById('eventoTitulo');
    const descEl   = document.getElementById('eventoDesc');
    if (tituloEl) tituloEl.value = 'LOCAL CERRADO';
    if (descEl) {
      const desde = document.getElementById('eventoFecha')?.value || '';
      const hasta = document.getElementById('eventoFechaFin')?.value || '';
      const fmtDate = iso => {
        if (!iso) return '';
        const [y,m,d] = iso.split('-');
        return d + '/' + m + '/' + y;
      };
      const rango = hasta && hasta !== desde
        ? 'Del ' + fmtDate(desde) + ' al ' + fmtDate(hasta)
        : 'El día ' + fmtDate(desde);
      descEl.value = rango + ' el local permanecerá cerrado.';
    }
  } else {
    const tituloEl = document.getElementById('eventoTitulo');
    const descEl   = document.getElementById('eventoDesc');
    if (tituloEl?.value === 'LOCAL CERRADO') tituloEl.value = '';
    if (descEl?.value.includes('permanecerá cerrado')) descEl.value = '';
  }
}

function toggleEventoAnuncio(checked) {
  document.getElementById('eventoAnuncioWrap').style.display = checked ? 'block' : 'none';
}

async function guardarEvento() {
  const titulo   = document.getElementById('eventoTitulo')?.value.trim();
  const fecha    = document.getElementById('eventoFecha')?.value;
  const fechaFin = document.getElementById('eventoFechaFin')?.value || fecha;
  const desc     = document.getElementById('eventoDesc')?.value.trim();
  if (!titulo) { showToast('Ingresá un título para el evento'); return; }
  if (!fecha)  { showToast('Seleccioná una fecha'); return; }

  const destTipo = document.querySelector('input[name="eventoDestTipo"]:checked')?.value || 'todos';
  let destinatarios = 'todos';
  if (destTipo === 'sucursal') {
    const sucsMarcadas = [...document.querySelectorAll('.evento-suc-cb:checked')].map(function(c) { return c.value; });
    if (!sucsMarcadas.length) { showToast('Seleccioná al menos una sucursal'); return; }
    destinatarios = sucsMarcadas.length === 1 ? sucsMarcadas[0] : JSON.stringify(sucsMarcadas);
  } else if (destTipo === 'especifico') {
    const checks = [...document.querySelectorAll('.evento-dest-cb:checked')].map(function(c) { return c.value; });
    if (!checks.length) { showToast('Seleccioná al menos un empleado'); return; }
    destinatarios = JSON.stringify(checks);
  } else if (destTipo === 'personal') {
    destinatarios = 'personal';
  }

  const conAnuncio = destTipo !== 'personal' && document.getElementById('eventoConAnuncio')?.checked;
  const anuncioMsg = document.getElementById('eventoAnuncioMsg')?.value.trim();
  const notifAdmins = document.getElementById('eventoEmailAdmins')?.checked;
  const emailsDest = notifAdmins ? getEmailsContactos().map(function(c){ return c.email; }) : [];

  try {
    const tipo  = document.getElementById('eventoLocalCerrado')?.checked ? 'local_cerrado' : '';
    const datos = encodeURIComponent(JSON.stringify({ titulo, fecha, fecha_fin: fechaFin, descripcion: desc, destinatarios, tipo, emails: emailsDest }));
    const resp  = await fetch(eventosApiUrl('guardar_evento', { datos }));
    const json  = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Error');

    // Si también es anuncio, guardarlo en paralelo
    if (conAnuncio) {
      const msgAnuncio = anuncioMsg || titulo + (desc ? ': ' + desc : '');
      let destsAnuncio = [];
      if (destTipo === 'especifico') {
        destsAnuncio = JSON.parse(destinatarios);
      } else if (destTipo === 'sucursal') {
        const sucIds = destinatarios.startsWith('[') ? JSON.parse(destinatarios).map(s => s.replace('suc_','')) : [destinatarios.replace('suc_','')];
        destsAnuncio = getUsuarios().filter(function(u) {
          if (u.rol !== 'empleado' || !u.empleadoNombre) return false;
          const perfil = EMPLEADOS_PERFILES[u.empleadoNombre] || {};
          const sucId  = perfil.sucursal_id || (state.datos.find(function(r) { return r.EMPLEADO === u.empleadoNombre; }) || {}).LOCAL || '';
          return sucIds.indexOf(sucId) !== -1;
        }).map(function(u) { return u.empleadoNombre; });
      }
      if ((destTipo === 'especifico' || destTipo === 'sucursal') && !destsAnuncio.length) {
        showToast('Evento guardado, pero ningún empleado coincide para el anuncio');
      } else {
        const datosAnuncio = encodeURIComponent(JSON.stringify({
          titulo: '📌 ' + titulo,
          mensaje: msgAnuncio,
          destinatarios: destsAnuncio,
          vigencia: fechaFin  // El anuncio caduca al finalizar el evento
        }));
        await fetch(anunciosApiUrl('guardar_anuncio', { datos: datosAnuncio }));
        _anunciosCache = null;
      }
    }

    _eventosCache = null;
    cerrarAdmin();
    showToast('✓ Evento guardado');
    cargarCalendarioVacaciones();
  } catch(e) {
    showToast('Error: ' + e.message);
  }
}

async function eliminarEvento(id) {
  if (!confirm('¿Eliminar este evento?')) return;
  try {
    const resp = await fetch(eventosApiUrl('eliminar_evento', { id }));
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Error');
    showToast('✓ Evento eliminado');
    _eventosCache = null;
    cargarCalendarioVacaciones();
  } catch(e) {
    showToast('Error: ' + e.message);
  }
}

// ── Mostrar eventos en Mi semana del empleado ──────────
var _eventosEmpCache = [];

async function cargarEventosEmpleado(nombreEmp) {
  try {
    const resp = await fetch(eventosApiUrl('get_eventos', { empleado: nombreEmp }));
    const json = await resp.json();
    if (!json.ok) return;
    const perfil = EMPLEADOS_PERFILES[nombreEmp] || {};
    const sucId  = perfil.sucursal_id || (state.datos.find(function(r) { return r.EMPLEADO === nombreEmp; }) || {}).LOCAL || '';
    // Filtrar: todos, suc_XX coincidente, array de sucursales, o lista específica de empleados
    _eventosEmpCache = (json.eventos || []).filter(function(ev) {
      if (ev.destinatarios === 'personal') return false; // solo admin
      if (ev.destinatarios === 'todos') return true;
      if (ev.destinatarios === 'suc_' + sucId) return true;
      try {
        const lista = JSON.parse(ev.destinatarios);
        if (!Array.isArray(lista)) return false;
        // Array de sucursales: ["suc_paseo", "suc_wave"]
        if (lista.length && lista[0].startsWith('suc_')) {
          return lista.indexOf('suc_' + sucId) !== -1;
        }
        // Array de nombres de empleados
        return lista.some(function(n) { return n.toLowerCase() === nombreEmp.toLowerCase(); });
      } catch(err) { return false; }
    });
    renderEventosEnSemana(nombreEmp);
  } catch(e) {}
}

function descargarICS(ev) {
  const toICS = function(iso) { return (iso || '').replace(/-/g, ''); };
  const fechaInicio = toICS(ev.fecha);
  const fechaFin    = toICS(ev.fecha_fin || ev.fecha);
  // Para eventos de día completo, fecha_fin en .ics es exclusiva (día siguiente)
  const d = new Date(ev.fecha_fin || ev.fecha);
  d.setDate(d.getDate() + 1);
  const fechaFinExcl = d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
  const desc = (ev.descripcion || '').replace(/\n/g,'\\n');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Croma Horarios//ES',
    'BEGIN:VEVENT',
    'UID:' + ev.id + '@croma-horarios',
    'DTSTART;VALUE=DATE:' + fechaInicio,
    'DTEND;VALUE=DATE:' + fechaFinExcl,
    'SUMMARY:' + ev.titulo,
    (desc ? 'DESCRIPTION:' + desc : ''),
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(Boolean).join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = ev.titulo.replace(/[^a-zA-Z0-9\s]/g,'').trim() + '.ics';
  a.click();
  URL.revokeObjectURL(url);
}

function renderEventosEnSemana(nombreEmp) {
  // Limpiar chips de eventos inyectados en una pasada anterior antes de re-inyectar
  document.querySelectorAll('.portal-week-card').forEach(function(card) {
    card.classList.remove('is-cerrado');
    card.querySelectorAll('.evento-semana-chip').forEach(function(chip) { chip.remove(); });
  });
  if (!_eventosEmpCache.length) return;
  // Para cada card de la semana del empleado, inyectar eventos del día
  const lunes = getLunes(_empSemanaOffset);
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  for (let i = 0; i < 7; i++) {
    const f = new Date(lunes); f.setDate(lunes.getDate() + i);
    const isoFecha = f.getFullYear() + '-' + String(f.getMonth()+1).padStart(2,'0') + '-' + String(f.getDate()).padStart(2,'0');
    const eventosDelDia = _eventosEmpCache.filter(function(ev) {
      const fin = ev.fecha_fin || ev.fecha;
      return isoFecha >= ev.fecha && isoFecha <= fin;
    });
    if (!eventosDelDia.length) continue;
    // Buscar la card del día correspondiente y agregar evento
    const cards = document.querySelectorAll('.portal-week-card');
    if (cards[i]) {
      const body = cards[i].querySelector('.portal-week-body');
      if (body) {
        // Verificar si hay "local cerrado"
        const localCerrado = eventosDelDia.some(function(ev) { return ev.tipo === 'local_cerrado'; });
        if (localCerrado) {
          const card = cards[i];
          card.classList.add('is-cerrado');
          const freeEl = card.querySelector('.portal-week-free');
          if (freeEl) freeEl.innerHTML = '<span class="portal-week-cerrado">🔴 Local cerrado</span>';
        }
        const evHtml = eventosDelDia.map(function(ev) {
          if (ev.tipo === 'local_cerrado') return ''; // ya se muestra en el header
          const vencido = isoFecha < hoy.toISOString().substring(0,10);
          const icsBtn = '<button class="evento-ics-btn" onclick="descargarICS(' + JSON.stringify(ev).replace(/'/g,"&#39;") + ')" title="Agregar a mi calendario">' + icon('calendar','icon-14') + '</button>';
          return '<div class="evento-semana-chip' + (vencido ? ' evento-semana-chip-vencido' : '') + '">' +
            '<span class="evento-semana-icono">' + (vencido ? '📋' : '📌') + '</span>' +
            '<div style="flex:1">' +
              '<div class="evento-semana-titulo">' + ev.titulo + (vencido ? ' <span style="font-weight:400;color:#94a3b8;font-size:10px">(Vencido)</span>' : '') + '</div>' +
              (ev.descripcion ? '<div class="evento-semana-desc">' + ev.descripcion + '</div>' : '') +
            '</div>' +
            icsBtn +
          '</div>';
        }).join('');
        body.insertAdjacentHTML('beforeend', evHtml);
      }
    }
  }
}

// ── Navegación de semanas en el portal empleado ───────
function empNavSemana(delta, modo) {
  if (modo === 'reset') {
    _empSemanaOffset = 0;
  } else {
    _empSemanaOffset += delta;
  }
  // Actualizar label
  const label = document.getElementById('empSemanaLabel');
  if (label) {
    const lunes = getLunes(_empSemanaOffset);
    const dom   = new Date(lunes); dom.setDate(lunes.getDate() + 6);
    const fmtOpts = { day: '2-digit', month: 'short' };
    const desde = lunes.toLocaleDateString('es-AR', fmtOpts);
    const hasta = dom.toLocaleDateString('es-AR', fmtOpts);
    let txt = '';
    if (_empSemanaOffset === 0)       txt = 'Esta semana · ' + desde + ' – ' + hasta;
    else if (_empSemanaOffset === 1)  txt = 'Próxima semana · ' + desde + ' – ' + hasta;
    else if (_empSemanaOffset === -1) txt = 'Semana pasada · ' + desde + ' – ' + hasta;
    else txt = (_empSemanaOffset > 0 ? '+' : '') + _empSemanaOffset + ' semanas · ' + desde + ' – ' + hasta;
    label.textContent = txt;
  }
  // Re-renderizar el grid de la semana
  const grid = document.getElementById('empSemanaGrid');
  if (!grid || !_empMisRegistros.length) return;
  // Reconstruir cards manualmente (replica buildSemanaEmpleado sin depender del closure)
  const MESES_NOMBRES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
                         'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
  const diasLargos = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
  const lunes = getLunes(_empSemanaOffset);
  const cards = [];
  for (let i = 0; i < 7; i++) {
    const f = new Date(lunes); f.setDate(lunes.getDate() + i);
    const regs = _empMisRegistros.filter(r =>
      String(r.AÑO) === String(f.getFullYear()) &&
      r.MES === MESES_ES[f.getMonth()] &&
      String(r.DIA) === String(f.getDate())
    ).sort((a,b) => (a.H_ENTRADA||'').localeCompare(b.H_ENTRADA||''));
    const total  = regs.reduce((a,r) => a + (parseFloat(r.TOTAL_HS)||0), 0);
    const esHoy  = f.toDateString() === new Date().toDateString();
    const libre  = !regs.length;
    let tipoTurno = '';
    if (!libre) {
      if (regs.length >= 2) tipoTurno = 'cortado';
      else if (total <= 4) tipoTurno = 'media';
      else if (total >= 7) tipoTurno = 'corrido';
    }
    function normTxt(txt) { return String(txt||'').trim().toUpperCase()==='FRANCO'?'Libre':String(txt||'').trim(); }
    const turnos = libre
      ? '<div class="portal-week-free">Libre</div>'
      : regs.map(r => {
          const ent = normTxt(r.H_ENTRADA), sal = normTxt(r.H_SALIDA);
          if (!ent || !sal) return '<span class="portal-week-shift">Horario a confirmar</span>';
          return '<span class="portal-week-shift">' + ent + ' → ' + sal + '</span>';
        }).join('');
    cards.push(
      '<div class="portal-week-card ' + (libre?'is-free':'') + ' ' + (esHoy?'is-today':'') + ' ' + (tipoTurno?'turno-'+tipoTurno:'') + '">' +
        '<div class="portal-week-day">' +
          '<span>' + diasLargos[i] + '</span>' +
          '<span class="portal-week-day-num">' + f.getDate() + '</span>' +
        '</div>' +
        '<div class="portal-week-body">' +
          turnos +
          (!libre ? '<small>' + total.toFixed(1) + ' hs</small>' : '') +
        '</div>' +
      '</div>'
    );
  }
  grid.innerHTML = cards.join('');
  // Re-inyectar eventos del período correcto
  renderEventosEnSemana(_empPortalActual);
}

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

function renderCalendarioView() {
  const container = document.getElementById('calendarioAdminContainer');
  if (!container) return;

  container.innerHTML =
    '<div class="admin-inline-wrap">' +
    '<div id="vacPendBadge" style="display:none"></div>' +
    '<div class="admin-tabs" id="vacTabs">' +
      '<button class="admin-tab active" onclick="switchVacTab(\'calendario\',this)">Calendario</button>' +
      '<button class="admin-tab" onclick="switchVacTab(\'anuncios\',this)">Anuncios</button>' +
      '<button class="admin-tab" id="vacTabSolicitudesBtn" onclick="switchVacTab(\'solicitudes\',this)">Solicitudes pendientes</button>' +
      '<button class="admin-tab" onclick="switchVacTab(\'banco\',this)">Banco de días</button>' +
      '<button class="admin-tab" onclick="switchVacTab(\'bancoHoras\',this)">Banco de horas</button>' +
    '</div>' +
    '<div id="vacCalendarioContainer" class="admin-tab-content">' +
      '<div style="padding:1.5rem"><p style="color:#94a3b8;font-size:13px">Cargando...</p></div>' +
    '</div>' +
    '<div id="vacAnunciosContainer" class="admin-tab-content" style="display:none">' +
      '<div class="admin-toolbar">' +
        '<span style="font-size:12px;color:#94a3b8">Enviá mensajes a tus empleados — aparecen en su pantalla con sonido</span>' +
        '<button class="btn-connect" style="width:auto;padding:8px 16px;font-size:13px;margin:0" onclick="abrirNuevoAnuncio()">+ Nuevo anuncio</button>' +
      '</div>' +
      '<div id="adminAnunciosList"><div style="padding:2rem;text-align:center;color:#94a3b8;font-size:13px">Cargando...</div></div>' +
    '</div>' +
    '<div id="vacSolicitudesContainer" class="admin-tab-content" style="display:none">' +
      '<div style="padding:1.5rem"><p style="color:#94a3b8;font-size:13px">Cargando...</p></div>' +
    '</div>' +
    '<div id="vacBancoContainer" class="admin-tab-content" style="display:none">' +
      '<div style="padding:1.5rem"><p style="color:#94a3b8;font-size:13px">Cargando...</p></div>' +
    '</div>' +
    '<div id="vacBancoHorasContainer" class="admin-tab-content" style="display:none">' +
      '<div style="padding:1.5rem"><p style="color:#94a3b8;font-size:13px">Cargando...</p></div>' +
    '</div>' +
    '</div>';

  // Cargar calendario con cache
  cargarCalendarioVacaciones();
}

function switchVacTab(tab, btn) {
  document.querySelectorAll('#vacTabs .admin-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('vacCalendarioContainer').style.display   = tab === 'calendario'  ? 'block' : 'none';
  document.getElementById('vacAnunciosContainer').style.display     = tab === 'anuncios'    ? 'block' : 'none';
  document.getElementById('vacSolicitudesContainer').style.display  = tab === 'solicitudes' ? 'block' : 'none';
  document.getElementById('vacBancoContainer').style.display        = tab === 'banco'       ? 'block' : 'none';
  document.getElementById('vacBancoHorasContainer').style.display   = tab === 'bancoHoras' ? 'block' : 'none';
  if (tab === 'solicitudes') cargarSolicitudesAdmin();
  if (tab === 'banco')       cargarBancoDias();
  if (tab === 'anuncios')    cargarListaAnuncios();
  if (tab === 'bancoHoras')  cargarBancoHorasAdmin();
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
      const local     = perfil.sucursal_id || (state.datos.find(function(r) { return r.EMPLEADO === nombre; }) || {}).LOCAL || '';
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
      const local     = perfil.sucursal_id || (state.datos.find(function(r) { return r.EMPLEADO === nombre; }) || {}).LOCAL || '';
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

// ── BANCO DE HORAS ────────────────────────────────────

async function cargarBancoHorasAdmin() {
  const container = document.getElementById('vacBancoHorasContainer');
  if (!container) return;
  container.innerHTML = '<div style="padding:1.5rem"><p style="color:#94a3b8;font-size:13px">Cargando...</p></div>';
  try {
    const resp = await fetch(vacApiUrl('get_banco_horas_todos'));
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Error');
    const empleados = json.empleados || [];

    const empNombres = [...new Set(state.datos.map(function(r) { return r.EMPLEADO; }))].sort(function(a,b) {
      const na = parseInt(a)||999, nb = parseInt(b)||999;
      return na !== nb ? na - nb : a.localeCompare(b);
    });

    const filas = empNombres.map(function(nombre) {
      const nom = nombre.replace(/^\d+\s+/, '');
      const entrada = empleados.find(function(e) { return e.empleado === nombre; }) || {};
      const saldo = typeof entrada.saldo_hs === 'number' ? entrada.saldo_hs.toFixed(1) : '—';
      const saldoColor = entrada.saldo_hs > 0 ? '#059669' : entrada.saldo_hs < 0 ? '#dc2626' : '#374151';
      const perfil = EMPLEADOS_PERFILES[nombre] || {};
      const local  = perfil.sucursal_id || (state.datos.find(function(r) { return r.EMPLEADO === nombre; }) || {}).LOCAL || '';
      const suc    = SUCURSALES.find(function(s) { return s.id === local; }) || { nombre: '—', color: '#94a3b8', colorLight: '#f1f5f9' };
      return '<tr>' +
        '<td><strong>' + nom + '</strong></td>' +
        '<td><span class="suc-badge-mini" style="background:' + suc.colorLight + ';color:' + suc.color + '">' + suc.nombre + '</span></td>' +
        '<td style="text-align:center;font-weight:700;color:' + saldoColor + '">' + saldo + ' hs</td>' +
      '</tr>';
    }).join('');

    container.innerHTML =
      '<div style="padding:1.5rem">' +
      '<div class="admin-table-wrap">' +
        '<table class="admin-tabla">' +
          '<thead><tr><th>Empleado</th><th>Local</th><th style="text-align:center">Saldo banco</th></tr></thead>' +
          '<tbody>' + filas + '</tbody>' +
        '</table>' +
      '</div>' +
      '</div>';
  } catch(e) {
    container.innerHTML = '<div style="padding:1.5rem"><p style="color:#dc2626;font-size:13px">Error: ' + e.message + '</p></div>';
  }
}

async function cargarBancoHorasEmpleado(nombreEmp) {
  const container = document.getElementById('evTabBancoHoras');
  if (!container) return;
  try {
    const resp = await fetch(vacApiUrl('get_banco_horas', { empleado: nombreEmp }));
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Error');
    container.innerHTML = renderBancoHorasHTML(json);
  } catch(e) {
    container.innerHTML = '<p style="color:#dc2626;font-size:13px">Error: ' + e.message + '</p>';
  }
}

async function cargarBancoHorasDetalleAdmin(nombreEmp) {
  const container = document.getElementById('bancoHorasAdminContent_inner');
  if (!container) return;
  container.innerHTML = '<p style="color:#94a3b8;font-size:13px">Cargando...</p>';
  try {
    const resp = await fetch(vacApiUrl('get_banco_horas', { empleado: nombreEmp }));
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Error');
    container.innerHTML = renderBancoHorasHTML(json);
  } catch(e) {
    container.innerHTML = '<p style="color:#dc2626;font-size:13px">Error: ' + e.message + '</p>';
  }
}

function renderBancoHorasHTML(data) {
  const saldo = typeof data.saldo_hs === 'number' ? data.saldo_hs.toFixed(1) : '—';
  const saldoColor = data.saldo_hs > 0 ? '#059669' : data.saldo_hs < 0 ? '#dc2626' : '#374151';
  const movs = data.movimientos || [];

  const rows = movs.length
    ? movs.map(function(m) {
        const tipoColor = m.tipo === 'ACREDITO' ? '#059669' : '#dc2626';
        const tipoLabel = m.tipo === 'ACREDITO' ? '+' + parseFloat(m.hs).toFixed(1) : '-' + parseFloat(m.hs).toFixed(1);
        return '<tr>' +
          '<td>' + (m.fecha_movimiento || '—') + '</td>' +
          '<td style="color:' + tipoColor + ';font-weight:600">' + tipoLabel + ' hs</td>' +
          '<td style="font-size:12px;color:#64748b">' + (m.concepto || '—') + '</td>' +
          '<td style="font-size:12px;color:#94a3b8">' + (m.fecha_referencia || '—') + '</td>' +
        '</tr>';
      }).join('')
    : '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:1.5rem;font-size:13px">Sin movimientos</td></tr>';

  return '<div style="display:grid;grid-template-columns:1fr;gap:1rem;margin-bottom:1.5rem">' +
    '<div class="detalle-stat"><span class="detalle-stat-val" style="color:' + saldoColor + '">' + saldo + ' hs</span><span class="detalle-stat-lbl">Saldo banco</span></div>' +
  '</div>' +
  '<h4 style="font-size:13px;font-weight:600;color:#374151;margin-bottom:0.75rem">Movimientos</h4>' +
  '<div class="admin-table-wrap">' +
    '<table class="admin-tabla">' +
      '<thead><tr><th>Fecha</th><th>Monto</th><th>Concepto</th><th>Fecha ref.</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table>' +
  '</div>';
}

// ══════════════════════════════════════════════════════
//  ANUNCIOS — Sistema completo
// ══════════════════════════════════════════════════════

// Cache y estado
let _anunciosCache = null;
let _anunciosLeidosEmp = new Set(JSON.parse(localStorage.getItem('croma_anuncios_leidos') || '[]'));

// Un anuncio está vencido si tiene vigencia y esa fecha ya pasó.
// Fallback: si no tiene vigencia, caduca a los 30 días de creado.
function anuncioVencido(a) {
  const hoy = new Date().toISOString().substring(0, 10);
  if (a.vigencia) return a.vigencia < hoy;
  // Sin vigencia: usar fecha de creación + 30 días como caducidad implícita
  if (a.fecha) {
    const fechaCreacion = a.fecha.substring(0, 10);
    const d = new Date(fechaCreacion);
    d.setDate(d.getDate() + 30);
    return d.toISOString().substring(0, 10) < hoy;
  }
  return false;
}

// ── HELPERS ───────────────────────────────────────────
function anunciosApiUrl(accion, params) {
  let url = `${APPS_SCRIPT_URL}?accion=${accion}`;
  if (params) Object.entries(params).forEach(([k,v]) => { if (v !== undefined && v !== null) url += `&${k}=${encodeURIComponent(v)}`; });
  return url;
}

function _playNotifSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [[523, 0], [659, 0.18]].forEach(([freq, when]) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + when);
      gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + when + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + when + 0.5);
      osc.start(ctx.currentTime + when);
      osc.stop(ctx.currentTime + when + 0.55);
    });
    return true;
  } catch(e) { return false; }
}

var _pendingNotifSound = false;

function sonarNotificacion() {
  // Los navegadores bloquean AudioContext sin interacción previa.
  // Intentamos reproducir; si falla, esperamos el primer toque del usuario.
  if (!_playNotifSound()) {
    _pendingNotifSound = true;
    const handler = function() {
      if (_pendingNotifSound) { _playNotifSound(); _pendingNotifSound = false; }
      document.removeEventListener('touchstart', handler);
      document.removeEventListener('click', handler);
    };
    document.addEventListener('touchstart', handler, { once: true });
    document.addEventListener('click', handler, { once: true });
  }
}

// ── ADMIN: cargar y renderizar lista de anuncios ──────
async function cargarListaAnuncios() {
  const el = document.getElementById('adminAnunciosList');
  if (!el) return;
  try {
    const resp = await fetch(anunciosApiUrl('get_anuncios'));
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Error');
    _anunciosCache = json.anuncios || [];
    renderListaAnuncios(_anunciosCache);
  } catch(e) {
    el.innerHTML = `<div style="padding:1.5rem;color:#dc2626;font-size:13px">Error: ${e.message}</div>`;
  }
}

function renderListaAnuncios(anuncios) {
  const el = document.getElementById('adminAnunciosList');
  if (!el) return;
  if (!anuncios.length) {
    el.innerHTML = '<div style="padding:2rem;text-align:center;color:#94a3b8;font-size:13px">No hay anuncios enviados aún.<br>Creá el primero con el botón de arriba.</div>';
    return;
  }
  el.innerHTML = anuncios.map(a => {
    let destLabel = 'Todos los empleados';
    try {
      const lista = JSON.parse(a.destinatarios);
      if (Array.isArray(lista) && lista.length) {
        destLabel = lista.map(n => n.replace(/^\d+\s+/,'')).join(', ');
      }
    } catch(e) {}
    return `<div class="anuncio-admin-item">
      <div class="anuncio-admin-meta">
        <span class="anuncio-admin-fecha">${icon('calendar','icon-14')} ${a.fecha}</span>
        <span class="anuncio-admin-dest">👥 ${destLabel}</span>
        <button class="btn-admin-edit" style="background:#fee2e2;color:#991b1b;border-color:#fca5a5;font-size:11px;margin-left:auto"
          onclick="eliminarAnuncioAdmin('${a.id}')">🗑 Eliminar</button>
      </div>
      <div class="anuncio-admin-titulo">${a.titulo}</div>
      <div class="anuncio-admin-msg">${a.mensaje}</div>
    </div>`;
  }).join('');
}

// ── ADMIN: modal nuevo anuncio ─────────────────────────
function abrirNuevoAnuncio() {
  const usuarios = getUsuarios().filter(u => u.rol === 'empleado' && u.empleadoNombre);

  // Filas de empleados: checkbox destinatario + icono WA si tiene celular
  const empOpts = usuarios.map(u => {
    const nom     = u.empleadoNombre.replace(/^\d+\s+/,'');
    const celular = u.celular ? u.celular.replace(/\D/g,'') : '';
    const waBtn   = celular
      ? `<span class="anuncio-wa-toggle" title="Enviar por WhatsApp también"
           onclick="toggleWaCheck(this)" data-celular="${celular}" data-activo="0">
           <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.122 1.532 5.859L.057 23.535a.75.75 0 0 0 .916.916l5.676-1.475A11.943 11.943 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75a9.698 9.698 0 0 1-4.953-1.356l-.355-.211-3.67.953.976-3.567-.232-.368A9.699 9.699 0 0 1 2.25 12C2.25 6.615 6.615 2.25 12 2.25S21.75 6.615 21.75 12 17.385 21.75 12 21.75z"/></svg>
           WA
         </span>`
      : `<span style="font-size:10px;color:#cbd5e1" title="Sin número cargado">sin WA</span>`;
    return `<div class="anuncio-dest-row">
      <label class="anuncio-dest-check" style="flex:1;margin:0">
        <input type="checkbox" value="${u.empleadoNombre}" class="anuncio-dest-cb" />
        <span>${nom}</span>
      </label>
      ${waBtn}
    </div>`;
  }).join('');

  const html = `
  <div class="admin-overlay" id="adminOverlay" onclick="cerrarAdmin(event)">
    <div class="admin-panel admin-panel-sm" onclick="event.stopPropagation()">
      <div class="admin-header">
        <div class="admin-titulo">Nuevo anuncio</div>
        <button class="detalle-close" onclick="cerrarAdmin()">${icon('x','icon-16')}</button>
      </div>
      <div class="admin-form">
        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Título del anuncio</label>
          <input type="text" class="admin-input" id="anuncioTitulo" placeholder="Ej: Reunión de equipo" maxlength="80" />
        </div>
        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Mensaje</label>
          <textarea class="admin-input" id="anuncioMensaje" rows="4"
            style="height:auto;resize:vertical;padding-top:10px;padding-bottom:10px"
            placeholder="Escribí el mensaje completo aquí..."></textarea>
        </div>
        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Vigencia (opcional)</label>
          <div style="display:flex;align-items:center;gap:10px">
            <input type="date" class="admin-input" id="anuncioVigencia" style="margin:0;flex:1" />
            <span style="font-size:11px;color:#94a3b8;white-space:nowrap">Si no se pone, caduca a los 30 días</span>
          </div>
        </div>
        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Destinatarios</label>
          <label class="anuncio-dest-check" style="margin-bottom:6px;font-weight:600">
            <input type="checkbox" id="anuncioDestTodos" checked onchange="toggleTodosAnuncio(this)" />
            <span>📢 Todos los empleados</span>
          </label>
          <div id="anuncioDestLista" style="display:none;flex-direction:column;gap:4px;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;max-height:200px;overflow-y:auto">
            ${empOpts || '<span style="font-size:12px;color:#94a3b8">No hay empleados con usuario vinculado</span>'}
            <div style="margin-top:6px;padding-top:6px;border-top:1px solid #f1f5f9;font-size:11px;color:#94a3b8">
              Hacé clic en el botón <strong style="color:#25D366">WA</strong> para enviar también por WhatsApp a ese empleado
            </div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:1.5rem">
          <button class="btn-connect" style="margin:0" onclick="publicarAnuncio()">${icon('bell','icon-16')} Publicar anuncio</button>
          <button class="btn-demo" onclick="cerrarAdmin()">Cancelar</button>
        </div>
      </div>
    </div>
  </div>`;
  montarOverlayAdmin(html);
}

function toggleTodosAnuncio(chk) {
  const lista = document.getElementById('anuncioDestLista');
  if (!lista) return;
  lista.style.display = chk.checked ? 'none' : 'flex';
}

function toggleWaCheck(el) {
  const activo = el.dataset.activo === '1';
  el.dataset.activo = activo ? '0' : '1';
  el.classList.toggle('anuncio-wa-activo', !activo);
}

async function publicarAnuncio() {
  const titulo  = document.getElementById('anuncioTitulo')?.value.trim();
  const mensaje = document.getElementById('anuncioMensaje')?.value.trim();
  if (!titulo) { showToast('Ingresá un título para el anuncio'); return; }
  if (!mensaje) { showToast('Escribí el mensaje del anuncio'); return; }

  const todosMarcado = document.getElementById('anuncioDestTodos')?.checked;
  let destinatarios = [];
  // Recolectar números WA seleccionados (siempre, independiente de "todos")
  const waNumeros = [];
  if (!todosMarcado) {
    document.querySelectorAll('.anuncio-dest-cb:checked').forEach(cb => destinatarios.push(cb.value));
    if (!destinatarios.length) { showToast('Seleccioná al menos un destinatario'); return; }
    // WA solo de los seleccionados individualmente
    document.querySelectorAll('.anuncio-wa-toggle[data-activo="1"]').forEach(el => {
      waNumeros.push(el.dataset.celular);
    });
  } else {
    // "Todos" — WA de todos los que tengan botón activo (si hay alguno activo)
    document.querySelectorAll('.anuncio-wa-toggle[data-activo="1"]').forEach(el => {
      waNumeros.push(el.dataset.celular);
    });
  }

  const vigencia = document.getElementById('anuncioVigencia')?.value || '';

  try {
    const datos = encodeURIComponent(JSON.stringify({ titulo, mensaje, destinatarios, vigencia }));
    const resp  = await fetch(anunciosApiUrl('guardar_anuncio', { datos }));
    const json  = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Error');
    cerrarAdmin();
    showToast('✓ Anuncio publicado');
    _anunciosCache = null;
    cargarListaAnuncios();

    // Abrir links de WhatsApp si hay destinatarios WA seleccionados
    if (waNumeros.length) {
      const textoWA = encodeURIComponent(`📣 *${titulo}*\n\n${mensaje}\n\n_— Croma Horarios_`);
      // Abrir de a uno con pequeño delay para no bloquear el navegador
      waNumeros.forEach((num, i) => {
        setTimeout(() => {
          window.open(`https://wa.me/549${num}?text=${textoWA}`, '_blank');
        }, i * 600);
      });
      showToast(`📱 Abriendo WhatsApp para ${waNumeros.length} empleado${waNumeros.length > 1 ? 's' : ''}...`, 3500);
    }
  } catch(e) {
    showToast('Error: ' + e.message);
  }
}

async function eliminarAnuncioAdmin(id) {
  if (!confirm('¿Eliminar este anuncio?')) return;
  try {
    const resp = await fetch(anunciosApiUrl('eliminar_anuncio', { id }));
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Error');
    showToast('✓ Anuncio eliminado');
    _anunciosCache = null;
    cargarListaAnuncios();
  } catch(e) {
    showToast('Error: ' + e.message);
  }
}

// ── EMPLEADO: verificar y mostrar anuncios nuevos ─────
var _anunciosTodosCache = [];  // cache para refrescar la seccion al cerrar banner
var _empSemanaOffset   = 0;   // semanas adelante/atrás en el portal empleado
var _empPortalActual   = '';  // nombre del empleado activo en el portal
var _empMisRegistros   = [];  // registros del empleado activo (para re-render semana)
var _anunciosEmpActual  = '';

async function verificarAnunciosEmpleado(nombreEmp) {
  try {
    const perfil = EMPLEADOS_PERFILES[nombreEmp] || {};
    // Usar _empMisRegistros como fuente principal (ya está cargado), con fallbacks
    const sucId  = (perfil.sucursal_id ||
                    (_empMisRegistros[0] || {}).LOCAL ||
                    (state.datos.find(r => r.EMPLEADO === nombreEmp) || {}).LOCAL ||
                    '').toString().trim();
    const resp = await fetch(anunciosApiUrl('get_anuncios', { empleado: nombreEmp, sucursal: sucId }));
    const json = await resp.json();
    if (!json.ok) return;
    // Filtrar suc_X en el front (el backend los pasa todos para que filtremos aquí)
    const todos = (json.anuncios || []).filter(a => {
      if (a.destinatarios === 'todos') return true;
      if (a.destinatarios === 'suc_' + sucId) return true;
      // Comparación case-insensitive como fallback
      if (a.destinatarios.toLowerCase() === ('suc_' + sucId).toLowerCase()) return true;
      try {
        const lista = JSON.parse(a.destinatarios);
        if (lista[0] && lista[0].startsWith('suc_')) {
          return lista.some(s => s.toLowerCase() === ('suc_' + sucId).toLowerCase());
        }
        return lista.some(n => n.toLowerCase() === nombreEmp.toLowerCase());
      } catch(e) { return a.destinatarios.toLowerCase() === nombreEmp.toLowerCase(); }
    });
    _anunciosTodosCache = todos;
    _anunciosEmpActual  = nombreEmp;
    // Siempre poblar la seccion historial (con o sin no leidos)
    renderAnunciosSeccion(todos, nombreEmp);
    // Banner y badge solo para los no leidos Y no vencidos
    const nuevos = todos.filter(a => !_anunciosLeidosEmp.has(a.id) && !anuncioVencido(a));
    if (nuevos.length) mostrarBannerAnuncios(nuevos, nombreEmp);
    actualizarBadgeAnunciosEmp(todos);
  } catch(e) {}
}

function renderAnunciosSeccion(anuncios, nombreEmp) {
  const wrap = document.getElementById('anunciosSectionWrap');
  const list = document.getElementById('anunciosSectionList');
  const badge = document.getElementById('anunciosBadgeCount');
  if (!wrap || !list) return;

  const noLeidos = anuncios.filter(a => !_anunciosLeidosEmp.has(a.id));
  if (badge) {
    badge.textContent = noLeidos.length || '';
    badge.style.display = noLeidos.length ? 'inline-flex' : 'none';
  }

  list.innerHTML = anuncios.map(function(a, i) {
    const leido   = _anunciosLeidosEmp.has(a.id);
    const vencido = anuncioVencido(a);
    const claseItem = (leido || vencido) ? 'anuncio-hist-leido' : 'anuncio-hist-nuevo';
    const icono     = (leido || vencido) ? icon('fileText','icon-14') : icon('bell','icon-14');
    let badge = '';
    if (vencido)      badge = '<span class="anuncio-hist-badge" style="background:#e2e8f0;color:#94a3b8">Vencido</span>';
    else if (!leido)  badge = '<span class="anuncio-hist-badge">Nuevo</span>';
    const vigStr = a.vigencia ? ' · hasta ' + a.vigencia : '';
    return '<div class="anuncio-hist-item ' + claseItem + '" id="anuncioHist' + i + '">' +
      '<div class="anuncio-hist-top">' +
        '<span class="anuncio-hist-icono">' + icono + '</span>' +
        '<div class="anuncio-hist-titulo">' + a.titulo + '</div>' +
        badge +
        '<span class="anuncio-hist-fecha">' + a.fecha.substring(0, 10) + vigStr + '</span>' +
      '</div>' +
      '<div class="anuncio-hist-msg">' + a.mensaje + '</div>' +
    '</div>';
  }).join('');

  wrap.style.display = 'block';
}

function actualizarBadgeAnunciosEmp(anuncios) {
  const noLeidos = (anuncios || []).filter(a => !_anunciosLeidosEmp.has(a.id) && !anuncioVencido(a));
  const badge = document.getElementById('bellBadgeEmp');
  if (!badge) return;
  const vacBadgeCount = parseInt(badge.textContent) || 0;
  // Sumar anuncios no leídos al badge existente (vacaciones)
  const total = vacBadgeCount + noLeidos.length;
  badge.textContent = total;
  badge.style.display = total > 0 ? 'flex' : 'none';
}

function mostrarBannerAnuncios(anuncios, nombreEmp) {
  // Remover banner previo si existe
  document.getElementById('anunciosBannerWrap')?.remove();

  const wrap = document.createElement('div');
  wrap.id = 'anunciosBannerWrap';
  wrap.className = 'anuncios-banner-wrap';

  const items = anuncios.map((a, i) => `
    <div class="anuncio-banner-card" id="anuncioBanner${i}">
      <div class="anuncio-banner-top">
        <span class="anuncio-banner-icono">${icon('bell','icon-16')}</span>
        <div class="anuncio-banner-titulo">${a.titulo}</div>
        <button class="anuncio-banner-close" onclick="marcarAnuncioLeido('${a.id}',${i},'${encodeURIComponent(nombreEmp)}')">${icon('x','icon-16')}</button>
      </div>
      <div class="anuncio-banner-msg">${a.mensaje}</div>
      <div class="anuncio-banner-fecha">${a.fecha}</div>
    </div>
  `).join('');

  wrap.innerHTML = items;

  // Insertar como notificación flotante (no en el flujo del contenido)
  document.body.appendChild(wrap);

  // Sonar notificación
  sonarNotificacion();
}

function marcarAnuncioLeido(id, idx, empEnc) {
  _anunciosLeidosEmp.add(id);
  localStorage.setItem('croma_anuncios_leidos', JSON.stringify([..._anunciosLeidosEmp]));
  // Animar y remover el banner
  const card = document.getElementById('anuncioBanner' + idx);
  if (card) {
    card.style.opacity = '0';
    card.style.transform = 'translateY(-8px)';
    setTimeout(function() {
      card.remove();
      const wrap = document.getElementById('anunciosBannerWrap');
      if (wrap && !wrap.querySelector('.anuncio-banner-card')) wrap.remove();
    }, 250);
  }
  // Refrescar la seccion historial para que el item pase a gris
  if (_anunciosTodosCache.length) {
    renderAnunciosSeccion(_anunciosTodosCache, _anunciosEmpActual);
  }
}

function toggleEmpFiltrosMobile(btn) {
  const panel = document.querySelector('.emp-filtros-panel');
  if (!panel) return;
  const open = panel.classList.toggle('mobile-open');
  btn.querySelector('span:last-child').textContent = open ? '▾' : '▸';
}

// Llamar al iniciar sesión de empleado (hook en mostrarVistaEmpleado)
const _origMostrarVistaEmpleado = typeof mostrarVistaEmpleado === 'function' ? mostrarVistaEmpleado : null;
// Interceptar cargarDatosEmpleado para verificar anuncios al cargar
const _origIniciarAppConSesion = window.iniciarAppConSesion;
