// ── CARGA DE PERFILES DE EMPLEADOS ────────────────────
// prefetched: si ya se tiene el JSON (ej. desde la acción consolidada
// datos_portal_empleado del Portal), se usa directo sin pegarle a GAS de
// nuevo — mismo parseo/side-effects de siempre, sin duplicar la lógica.
async function cargarPerfiles(prefetched) {
  try {
    // Fase 2A Sheets API: antes pegaba directo a GAS (?accion=perfiles).
    // Cubre tanto Panel/Admin (cargarDatos) como Administración (línea de
    // Promise.all más abajo) — ambos pasan por esta misma función.
    const json = prefetched || await apiPerfilesSheets('', { method: 'GET' });
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

// Barrida final GAS→Node (2026-09-30): antes pegaba directo a GAS
// (?accion=guardar_categoria, GET, sin JWT, sin BACKEND_SECRET). Ahora pasa
// por croma-backend (JWT admin/jefe/horarios) vía apiCategorias(). Rollback:
// restaurar este call-site desde el historial de git.
async function guardarCategoria(cat) {
  try {
    const json = await apiCategorias('', { method: 'POST', body: JSON.stringify(cat) });
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

  // Cargar perfiles y certificados en paralelo. La lista de usuarios
  // (GET /api/empleados/usuarios) requiere rol admin/jefe — se carga bajo
  // demanda al entrar a Administración (ver setView/'administracion'), no
  // acá, para no pedirla de arriba para todos los empleados.
  cargarPerfiles();
  cargarCertificados();
  cargarVacacionesAprobadas();
  cargarNombresLegales(); // visible para cualquier rol logueado (ver diseño)

  try {
    // Fase 1 Sheets API: antes pegaba directo a GAS (?accion=horarios).
    // Ahora pasa por croma-backend -> Sheets API v4, mismo contrato JSON
    // (paridad validada campo a campo, ver docs/PLAN-SHEETS-API-DIRECTA.md).
    // Rollback: volver esta línea a
    // `await fetchJSONretry(\`${urlUnica}?accion=horarios\`)`.
    const json = await apiHorariosSheets('', { method: 'GET' });
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
      <input type="url" class="url-input" id="url_unica" aria-label="URL única (todas las sucursales)"
        placeholder="https://script.google.com/macros/s/.../exec"
        value="${saved['unica'] || ''}" />
    </div>
    <p style="font-size:12px;color:var(--text-muted);margin:0.5rem 0 1rem 0">
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
    cargarUsuariosAdmin().then(() => renderAdminInline());
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
    if (ENVIVO_NODE) cargarEnVivoNode(); else renderEnVivo();
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


// cargarUsuarios/getUsuarios/saveUsuarios (llamada directa a GAS
// accion=cargar_usuarios/guardar_usuarios, cache de PIN en texto plano en
// localStorage) se eliminaron en el Commit 4. Reemplazadas por
// cargarUsuariosAdmin/getUsuariosAdmin (más abajo, "ADMINISTRACIÓN
// UNIFICADA: EMPLEADOS + ACCESO"), que usan /api/empleados/usuarios
// (Node, sin PIN) y nunca cachean nada sensible en el navegador.
// Confirmado sin referencias activas antes de borrar (los 4 call sites que
// todavía las usaban — WhatsApp en la card de empleado, destinatarios de
// eventos/anuncios — se migraron a EMPLEADOS_PERFILES / _asegurarUsuariosAdmin()).

// Usuario de sesión activa: { nombre, rol, empleadoNombre }
// rol: 'admin' | 'empleado'
let sesionActual = null;

// Limpieza única: si un navegador todavía tiene el cache viejo con PIN en
// texto plano (de antes de este commit), se borra apenas carga la app.
(function _limpiarCacheUsuariosLegado() {
  try { localStorage.removeItem('croma_usuarios_cache'); } catch(e) {}
})();

