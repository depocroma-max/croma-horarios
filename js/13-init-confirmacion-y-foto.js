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

  // Poblar select de sucursales y traer el catálogo vigente del backend
  poblarFiltroSucursales();
  cargarSucursalesServidor();
}

function poblarFiltroSucursales() {
  const selSuc = document.getElementById('filterSucursal');
  if (!selSuc) return;
  const actual = selSuc.value;
  selSuc.innerHTML = '<option value="all">Todas las sucursales</option>' +
    SUCURSALES_TODAS.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('');
  if (actual) selSuc.value = actual;
}

// GET /api/sucursales (público). Si falla, queda el fallback hardcodeado.
async function cargarSucursalesServidor() {
  try {
    const resp = await fetch(BACKEND_URL + '/api/sucursales');
    const json = await resp.json().catch(() => null);
    if (!json || json.ok !== true) return;
    aplicarSucursalesServidor(json.sucursales);
    poblarFiltroSucursales();
    if (typeof state !== 'undefined' && state.datos && state.datos.length) renderAll();
  } catch (e) { /* sin backend: se usa el fallback */ }
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

  // Buscar coincidencias únicas por empleado (nombre o apodo)
  const matches = [...new Map(
    datos
      .filter(r => {
        const apodo = EMPLEADOS_PERFILES[r.EMPLEADO]?.apodo || '';
        return r.EMPLEADO.toLowerCase().includes(q) || apodo.toLowerCase().includes(q);
      })
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
    const s = SUCURSALES_TODAS.find(x => x.id === r.LOCAL) || { color: '#888', colorLight: '#eee', nombre: r.LOCAL };
    const numMatch = r.EMPLEADO.match(/^(\d+)\s+(.+)$/);
    const numVend  = numMatch ? `<span class="search-num">#${numMatch[1]}</span>` : '';
    const nombre   = numMatch ? numMatch[2] : r.EMPLEADO;
    const apodo    = EMPLEADOS_PERFILES[r.EMPLEADO]?.apodo || '';
    return `<div class="search-item"
      data-emp="${r.EMPLEADO.replace(/"/g,'&quot;')}"
      data-suc="${r.LOCAL}">
      <span class="search-dot" style="background:${s.color}"></span>
      <span class="search-nombre">${numVend} ${nombre}${apodo ? ` <span class="badge badge-neutral" style="font-size:10px;padding:1px 7px;vertical-align:middle">${apodo}</span>` : ''}</span>
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

    // 2 — Guardar la URL vía Node (JWT); el backend deriva el empleado de
    // la propia sesión, no manda nombre porque no hace falta (autoservicio).
    const json = await apiMiPerfil('/foto', {
      method: 'POST',
      body: JSON.stringify({ foto_url: fotoUrl }),
    });
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

