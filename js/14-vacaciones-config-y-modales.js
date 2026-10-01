// ── HELPERS ───────────────────────────────────────────
// Barrida final GAS→Node (2026-09-18): query string para apiVacaciones()
// (backend, JWT automático) — reemplaza las lecturas de GAS de
// get_vacaciones/get_solicitudes_vac (las escrituras vía POST ya migraron por
// separado).
function _qsVacaciones(params) {
  const partes = [];
  if (params) Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') partes.push(`${k}=${encodeURIComponent(v)}`);
  });
  return partes.length ? `?${partes.join('&')}` : '';
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
// Barrida final GAS→Node (2026-09-18): antes pegaba directo a
// accion=get_config (GAS, doGet, sin auth). Ahora usa apiConfig() —
// mismo helper que ya usa el guardado de este mismo módulo, manda el JWT
// automáticamente. Shape de respuesta sin cambios ({ok,config}).
async function cargarConfigAdmin() {
  try {
    const json = await apiConfig('', { method: 'GET' });
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
      await apiConfig('', { method: 'POST', body: JSON.stringify({ clave, valor }) });
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
    const json = await apiConfig('', { method: 'POST', body: JSON.stringify({ clave: 'email_admin', valor: email }) });
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
    el.innerHTML = '<p style="font-size:12px;color:var(--text-muted);padding:4px 0">Sin correos agregados.</p>';
    return;
  }
  el.innerHTML = lista.map(function(c, i) {
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9">' +
      '<div style="flex:1">' +
        '<div style="font-size:13px;font-weight:500;color:#1e293b">' + c.nombre + '</div>' +
        '<div style="font-size:12px;color:var(--text-secondary)">' + c.email + '</div>' +
      '</div>' +
      '<button onclick="eliminarEmailContacto(' + i + ')" style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:4px;line-height:1" title="Eliminar">' + icon('x','icon-14') + '</button>' +
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
    const json = await apiConfig('', { method: 'POST', body: JSON.stringify({ clave: 'emails_contactos', valor }) });
    if (!json.ok) throw new Error(json.error);
    _configCache.emails_contactos = valor;
    renderEmailsLista();
    if (statusEl) { statusEl.textContent = '✓ Guardado'; statusEl.style.color='#065f46'; statusEl.style.display='block'; setTimeout(function(){ statusEl.style.display='none'; }, 2000); }
  } catch(e) {
    if (statusEl) { statusEl.textContent = 'Error: ' + e.message; statusEl.style.color='#dc2626'; statusEl.style.display='block'; }
  }
}

// ── VACACIONES: BANCO DE DÍAS ──────────────────────────
// Barrida final GAS→Node (2026-09-18): antes pegaba directo a
// accion=get_vacaciones/get_solicitudes_vac (GAS, sin auth). Ahora usa
// apiVacaciones() (JWT automático). Shape de respuesta sin cambios.
async function cargarVacacionesAdmin(nombreEmp) {
  const container = document.getElementById('vacAdminContent_inner');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--text-muted);font-size:13px">Cargando...</p>';
  const anioActual = new Date().getFullYear();
  try {
    const [jVac, jSol] = await Promise.all([
      apiVacaciones('/banco' + _qsVacaciones({ empleado: nombreEmp, anio: anioActual }), { method: 'GET' }),
      apiVacaciones('/solicitudes' + _qsVacaciones({ empleado: nombreEmp }), { method: 'GET' }),
    ]);
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
        <td style="font-size:11px;color:var(--text-secondary)">${esc(s.nota_admin) || '—'}</td>
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
    : `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:1.5rem;font-size:13px">Sin solicitudes</td></tr>`;

  return `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:1.5rem">
      <div class="detalle-stat"><span class="detalle-stat-val">${banco}</span><span class="detalle-stat-lbl">Días banco</span></div>
      <div class="detalle-stat"><span class="detalle-stat-val">${usado}</span><span class="detalle-stat-lbl">Usados</span></div>
      <div class="detalle-stat"><span class="detalle-stat-val" style="color:${ajuste>=0?'#059669':'#dc2626'}">${ajuste>=0?'+':''}${ajuste}</span><span class="detalle-stat-lbl">Ajuste</span></div>
      <div class="detalle-stat"><span class="detalle-stat-val" style="color:#2563eb">${disponible}</span><span class="detalle-stat-lbl">Disponibles</span></div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:1.5rem;flex-wrap:wrap">
      <button class="btn-detalle-accion" style="color:#059669;border-color:#6ee7b7;background:#f0fdf4" onclick="abrirModalSolicitudVac('${empEnc}',true)">
        + Agregar vacaciones
      </button>
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
// Barrida final GAS→Node (2026-09-18): antes pegaba directo a GAS con
// timeout defensivo propio (_fetchConTimeout, pensado para la lentitud de
// GAS). Ahora usa apiVacaciones() contra el backend, que no tiene ese
// problema — se deja de envolver con timeout manual, mismo criterio ya
// aplicado en el resto de las migraciones de esta barrida.
async function cargarVacacionesEmpleado(nombreEmp) {
  const container = document.getElementById('evTabVacaciones');
  if (!container) return;
  const anio = new Date().getFullYear();
  try {
    const [jVac, jSol] = await Promise.all([
      apiVacaciones('/banco' + _qsVacaciones({ empleado: nombreEmp, anio }), { method: 'GET' }),
      apiVacaciones('/solicitudes' + _qsVacaciones({ empleado: nombreEmp }), { method: 'GET' }),
    ]);
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
            <div style="font-size:12px;color:var(--text-secondary);margin-top:2px">${s.dias} días corridos</div>
            ${s.nota_admin ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">Nota: ${esc(s.nota_admin)}</div>` : ''}
          </div>
          ${estadoBadge(s.estado)}
        </div>
      </div>`).join('')
    : `<p style="color:var(--text-muted);font-size:13px">No tenés solicitudes.</p>`;

  return `
    <div class="emp-portal-vac-stats">
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

// ── SOLICITUDES GLOBALES (tab Solicitudes dentro de Avisos) ───────────
async function cargarSolicitudesAdmin() {
  const container = document.getElementById('avzSolicitudesContainer');
  if (!container) return;
  if (_vacSolicitudesCache === null) {
    container.innerHTML = '<div style="padding:1.5rem"><p style="color:var(--text-muted);font-size:13px">Cargando...</p></div>';
  }
  try {
    const todas = await fetchSolicitudesCache(false);
    const sols = todas.filter(function(s) { return s.estado === 'pendiente'; });

    const tabBtn = document.getElementById('avzTabSolicitudes');
    if (tabBtn) tabBtn.textContent = 'Solicitudes' + (sols.length ? ' (' + sols.length + ')' : '');

    if (!sols.length) {
      container.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:14px">No hay solicitudes pendientes</div>';
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
        <td style="font-size:11px;color:var(--text-secondary)">${s.fecha_solicitud ? formatFechaISO(s.fecha_solicitud.substring(0,10)) : '—'}</td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn-admin-edit" style="background:#d1fae5;color:#065f46;border-color:#6ee7b7"
              onclick="responderSolicitudAdmin('${s.id}','aprobada','')">✓ Aprobar</button>
            <button class="btn-admin-edit" style="background:#fee2e2;color:#991b1b;border-color:#fca5a5"
              onclick="abrirModalRespuesta('${s.id}','rechazada','${encodeURIComponent(s.empleado)}')">✗ Rechazar</button>
            <button class="btn-admin-edit" style="font-size:11px"
              onclick="setView('calendario');_calVacMes=${mesIdx};_calVacAnio=${anioSol};setTimeout(cargarCalendarioVacaciones,50)">${icon('calendar','icon-14')} Ver</button>
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
        <button class="detalle-close" onclick="cerrarAdmin()" aria-label="Cerrar">${icon('x','icon-16')}</button>
      </div>
      <div class="admin-form">
        <div class="admin-form-grupo">
          <label class="emp-filtro-label" for="ajusteDias">Ajuste de días (positivo suma, negativo resta)</label>
          <input type="number" class="admin-input" id="ajusteDias" value="0" step="1" placeholder="Ej: 3 o -2" />
        </div>
        <div class="admin-form-grupo">
          <label class="emp-filtro-label" for="ajusteNota">Motivo / Nota</label>
          <input type="text" class="admin-input" id="ajusteNota" placeholder="Ej: Acuerdo especial" />
        </div>
        <p id="ajusteError" style="color:#dc2626;font-size:12px;display:none;margin-bottom:0.5rem"></p>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:1.5rem">
          <button class="btn-connect" style="margin:0" id="btnGuardarAjusteVac" onclick="confirmarAjusteAdmin('${empEnc}',${anio})">Guardar ajuste</button>
          <button class="btn-demo" onclick="cerrarAdmin()">Cancelar</button>
        </div>
      </div>
    </div>
  </div>`;
  montarOverlayAdmin(html);
}

async function confirmarAjusteAdmin(empEnc, anio) {
  const btn = document.getElementById('btnGuardarAjusteVac');
  if (btn && btn.disabled) return; // evita doble envío por doble click
  const nombreEmp = decodeURIComponent(empEnc);
  const ajuste = parseInt(document.getElementById('ajusteDias')?.value) || 0;
  const nota   = document.getElementById('ajusteNota')?.value.trim();
  const errEl  = document.getElementById('ajusteError');
  if (ajuste === 0) { errEl.textContent='El ajuste no puede ser 0'; errEl.style.display='block'; return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
  try {
    const json = await apiVacaciones('/ajustar', {
      method: 'POST',
      body: JSON.stringify({ empleado: nombreEmp, anio, ajuste, nota }),
    });
    if (!json.ok) throw new Error(json.error || 'Error');
    cerrarAdmin();
    showToast('✓ Ajuste guardado');
    cargarVacacionesAdmin(nombreEmp);
  } catch(e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Guardar ajuste'; }
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  }
}

async function inicializarVacAdmin(anio) {
  if (!confirm(`¿Inicializar banco de vacaciones ${anio} para todos los empleados?`)) return;
  showToast('Procesando...');
  try {
    const json = await apiVacaciones('/inicializar', { method: 'POST', body: JSON.stringify({ anio }) });
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
        <button class="detalle-close" onclick="cerrarAdmin()" aria-label="Cerrar">${icon('x','icon-16')}</button>
      </div>
      <div class="admin-form">
        <div class="admin-form-grupo">
          <label class="emp-filtro-label" for="respuestaNota">Nota para el empleado (opcional)</label>
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
    const json = await apiVacaciones('/responder', {
      method: 'POST',
      body: JSON.stringify({ id, estado, nota_admin: nota || '' }),
    });
    if (!json.ok) throw new Error(json.error || 'Error');
    cerrarAdmin();
    showToast(estado === 'aprobada' ? '✓ Solicitud aprobada' : '✗ Solicitud rechazada');
    // Recargar según contexto
    _vacSolicitudesCache = null; // invalidar cache
    const vacView = document.getElementById('viewCalendario');
    if (vacView && vacView.classList.contains('active')) renderCalendarioView();
    // Tab "Solicitudes" dentro de Avisos, si está visible
    if (document.getElementById('avzSolicitudesContainer')) cargarSolicitudesAdmin();
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
function abrirModalSolicitudVac(empEnc, esAdmin) {
  const nombreEmp = decodeURIComponent(empEnc);
  const hoy = new Date();
  const hoyISO = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-${String(hoy.getDate()).padStart(2,'0')}`;
  const html = `
  <div class="admin-overlay" id="adminOverlay" onclick="cerrarAdmin(event)">
    <div class="admin-panel admin-panel-sm" onclick="event.stopPropagation()">
      <div class="admin-header">
        <div class="admin-titulo">${esAdmin ? 'Agregar vacaciones' : 'Solicitar vacaciones'}</div>
        <button class="detalle-close" onclick="cerrarAdmin()" aria-label="Cerrar">${icon('x','icon-16')}</button>
      </div>
      <div class="admin-form">
        <div class="admin-form-grupo">
          <label class="emp-filtro-label" for="vacDesde">Fecha desde</label>
          <input type="date" class="admin-input" id="vacDesde" value="${hoyISO}"
            onchange="calcularDiasVacForm()" ${esAdmin ? '' : `min="${hoyISO}"`} />
        </div>
        <div class="admin-form-grupo">
          <label class="emp-filtro-label" for="vacHasta">Fecha hasta</label>
          <input type="date" class="admin-input" id="vacHasta" value="${hoyISO}"
            onchange="calcularDiasVacForm()" ${esAdmin ? '' : `min="${hoyISO}"`} />
        </div>
        <div class="admin-form-grupo">
          <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#eff6ff;border-radius:8px;border:1px solid #bfdbfe">
            <span style="font-size:13px;color:#374151">Días corridos:</span>
            <span id="diasVacCalc" style="font-size:18px;font-weight:700;color:#2563eb">1</span>
          </div>
          <span style="font-size:11px;color:var(--text-muted);margin-top:4px;display:block">
            Se cuentan días corridos (incluyendo fines de semana y feriados, según ley argentina)
          </span>
        </div>
        <p id="vacSolError" style="color:#dc2626;font-size:12px;display:none;margin-bottom:0.5rem"></p>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:1.5rem">
          <button class="btn-connect" style="margin:0" id="btnEnviarSolicitudVac" onclick="confirmarSolicitudVac('${empEnc}',${esAdmin ? 'true' : 'false'})">${esAdmin ? 'Guardar (queda aprobada)' : 'Enviar solicitud'}</button>
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

async function confirmarSolicitudVac(empEnc, esAdmin) {
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
  if (btn) { btn.disabled = true; btn.textContent = esAdmin ? 'Guardando...' : 'Enviando...'; }
  try {
    // esAdmin: admin/jefe cargando a nombre de otro empleado (empleado va
    // en el body). Autoservicio (esAdmin=false): NO se manda "empleado" —
    // el backend lo deriva del JWT de la propia sesión, nunca del cliente
    // (ver informe Fase 6B, corrección de impersonación en solicitar_vac).
    const json = esAdmin
      ? await apiVacaciones('/agregar-admin', {
          method: 'POST',
          body: JSON.stringify({ empleado: nombreEmp, fecha_desde: desde, fecha_hasta: hasta, dias }),
        })
      : await apiVacaciones('/solicitar', {
          method: 'POST',
          body: JSON.stringify({ fecha_desde: desde, fecha_hasta: hasta, dias }),
        });
    if (!json.ok) throw new Error(json.error || 'Error');
    _vacSolicitudesCache = null; // invalidar cache
    VACACIONES_APROBADAS_CACHE = []; // forzar recarga para que aparezca en el historial
    await cargarVacacionesAprobadas();
    cerrarAdmin();
    if (esAdmin) {
      showToast('✓ Vacaciones agregadas');
      cargarVacacionesAdmin(nombreEmp);
    } else {
      showToast('✓ Solicitud enviada — quedá pendiente de aprobación');
      cargarVacacionesEmpleado(nombreEmp);
    }
  } catch(e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
    if (btn) { btn.disabled = false; btn.textContent = esAdmin ? 'Guardar (queda aprobada)' : 'Enviar solicitud'; }
  }
}

