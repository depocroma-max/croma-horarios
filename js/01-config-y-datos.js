/* =====================================================
   CROMA · HORARIOS — app.js
   Estructura del Sheet esperada (por sucursal):
   LOCAL | AÑO | MES | DIA | MARCA_TEMPORAL | EMPLEADO |
   H_ENTRADA | H_SALIDA | NOTA | TOTAL_HS
   ===================================================== */

// Escapa texto libre (notas, títulos, descripciones) antes de interpolarlo en
// HTML generado con innerHTML/templates. Valores null/undefined => ''.
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── CONFIGURACIÓN ──────────────────────────────────────
// SUCURSALES_TODAS: catálogo completo (lookups y reportes históricos, incluye ocultas).
// SUCURSALES: solo las activas (vistas operativas, formularios, En Vivo).
// Ambas se sobreescriben en el lugar con GET /api/sucursales (ver
// aplicarSucursalesServidor); estos valores son el fallback si el backend falla.
const SUCURSALES_TODAS = [
  { id: '01',      hoja: 'PASEO',   nombre: '01 PASEO',           color: '#2563EB', colorLight: '#EFF6FF', icon: 'store'        },
  { id: '05',      hoja: 'WAVE',    nombre: '05 WAVE',            color: '#10B981', colorLight: '#ECFDF5', icon: 'waves'        },
  { id: '09',      hoja: 'CIPO',    nombre: '09 CIPO SAN MARTIN', color: '#F97316', colorLight: '#FFF7ED', icon: 'shoppingBag', activa: false },
  { id: '10',      hoja: 'PERITO',  nombre: '10 PERITO MORENO',   color: '#DB2777', colorLight: '#FDF2F8', icon: 'warehouse'    },
  { id: '12',      hoja: 'CENTE',   nombre: '12 CENTENARIO',      color: '#7C3AED', colorLight: '#F5F3FF', icon: 'shoppingCart' },
  { id: '14',      hoja: 'ROCA180', nombre: '14 ROCA',            color: '#92400E', colorLight: '#FEF3C7', icon: 'mountain'     },
  { id: 'DEPO',    hoja: 'DEPO',    nombre: 'DEPO',               color: '#4B5563', colorLight: '#F3F4F6', icon: 'package'      },
  { id: 'OFICINA', hoja: 'OFICINA', nombre: 'OFICINA',            color: '#0891B2', colorLight: '#ECFEFF', icon: 'briefcase'    },
];

const SUCURSALES = SUCURSALES_TODAS.filter(s => s.activa !== false);

// Mapa indexado por id — lookup O(1) (derivado de SUCURSALES_TODAS, sin duplicar datos)
const SUCURSALES_UI = Object.fromEntries(SUCURSALES_TODAS.map(s => [s.id, s]));

// Reemplaza el contenido de las 3 estructuras en el lugar (son const y hay
// referencias sueltas por todo el archivo). Un campo faltante en la respuesta
// se completa con el fallback local de esa sucursal.
function aplicarSucursalesServidor(lista) {
  if (!Array.isArray(lista) || !lista.length) return;
  const fallback = Object.fromEntries(SUCURSALES_TODAS.map(s => [s.id, s]));
  const nuevas = lista.map(s => Object.assign({}, fallback[s.id] || {}, s));
  SUCURSALES_TODAS.splice(0, SUCURSALES_TODAS.length, ...nuevas);
  SUCURSALES.splice(0, SUCURSALES.length, ...nuevas.filter(s => s.activa !== false));
  Object.keys(SUCURSALES_UI).forEach(k => delete SUCURSALES_UI[k]);
  nuevas.forEach(s => { SUCURSALES_UI[s.id] = s; });
}

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
let VACACIONES_APROBADAS_CACHE = [];   // solicitudes de vacaciones ya aprobadas (empleado o admin), para el historial
let _certFlujoDesdeAdmin = false; // true si abrirFormCertificado se abrió desde Administración > Certificados
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

// GAS puede quedar colgado (sin responder ni rechazar) en vez de fallar
// rápido — un fetch sin timeout deja la pantalla en blanco indefinidamente
// en vez de caer a la vista de error. 15s alcanza de sobra para una
// respuesta normal de Apps Script.
const GAS_FETCH_TIMEOUT_MS = 15000;
function _fetchConTimeout(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || GAS_FETCH_TIMEOUT_MS);
  // cache:'no-store': el navegador puede cachear la 302 de GAS
  // (script.google.com → script.googleusercontent.com/macros/echo?...). Si quedó
  // cacheada de un momento en que GAS estaba caído, reproduciría el 404 aunque
  // ya haya vuelto; no-store fuerza a pedirla de nuevo.
  return fetch(url, { signal: ctrl.signal, cache: 'no-store' }).finally(() => clearTimeout(t));
}

// Fetch resistente a los hipos de Apps Script: valida la respuesta y reintenta
// un par de veces. Google a veces devuelve una página HTML (404/echo) en vez de
// JSON — típico "Unexpected token '<'" — y un reintento suele resolverlo.
async function fetchJSONretry(url, intentos) {
  intentos = intentos || 3;
  let ultimoError;
  for (let i = 0; i < intentos; i++) {
    try {
      const resp = await _fetchConTimeout(url);
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

// Formato YYYY-WNN — PORT LITERAL de getSemanaId() en croma-panel-main/index.html
// (no es ISO-8601 estándar a propósito, ver croma-backend/src/services/envivo.js
// getSemanaIdServer() — debe coincidir con los IDs de semana ya guardados en HORARIOS).
function getSemanaId(offset) {
  const lunes = getLunes(offset);
  const anio = lunes.getFullYear();
  const inicio = new Date(anio, 0, 1);
  const semana = Math.ceil(((lunes - inicio) / 86400000 + inicio.getDay() + 1) / 7);
  return anio + '-W' + String(semana).padStart(2, '0');
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

