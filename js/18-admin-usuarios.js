// ── USUARIOS — Administración › Usuarios ─────────────
// Cambiar la contraseña de los usuarios de staff (admin, jefe, encargados,
// etc.). Backend: /api/usuarios-admin (JWT, SOLO rol admin). La contraseña
// nunca se muestra ni se devuelve; solo se puede reemplazar. Las sesiones ya
// abiertas del usuario siguen vigentes hasta que venzan (8 h).
const apiUsuariosAdmin = (path, opciones) => _apiFetch('/api/usuarios-admin', path, opciones);
let _usuariosAdminLista = [];

function renderUsuariosAdminTab() {
  const cont = document.getElementById('adminTabUsuarios');
  if (!cont) return;
  cont.innerHTML =
    "<div class='admin-head'>" +
      "<h1>Usuarios</h1>" +
      "<p>Cambiá la contraseña de los usuarios de la plataforma. La contraseña actual no se puede ver, solo reemplazar. Si el usuario tiene una sesión abierta, sigue activa hasta que venza (hasta 8 horas).</p>" +
    "</div>" +
    "<div class='dt-wrap'><div class='dt-scroll'>" +
      "<table class='dt-table'>" +
        "<thead><tr><th>Usuario</th><th>Rol</th><th>Sucursal</th><th>Estado</th><th>Acciones</th></tr></thead>" +
        "<tbody id='usuariosAdminBody'><tr><td colspan='5' style='text-align:center;padding:2rem;color:var(--text-muted)'>Cargando…</td></tr></tbody>" +
      "</table>" +
    "</div></div>";
  cargarUsuariosAdmin();
}

async function cargarUsuariosAdmin() {
  const body = document.getElementById('usuariosAdminBody');
  if (!body) return;
  const json = await apiUsuariosAdmin('', { method: 'GET' });
  if (!json || json.ok !== true) {
    body.innerHTML = "<tr><td colspan='5' style='text-align:center;padding:2rem;color:var(--red,#dc2626)'>" + _kioscoEsc((json && json.error) || 'No se pudieron cargar los usuarios.') + "</td></tr>";
    return;
  }
  _usuariosAdminLista = json.usuarios || [];
  body.innerHTML = _usuariosAdminLista.map(u => {
    const estado = u.activo
      ? "<span style='color:#059669;font-weight:600'>Activo</span>"
      : "<span style='color:var(--text-muted);font-weight:600'>Inactivo</span>";
    return "<tr" + (u.activo ? '' : " style='opacity:.65'") + ">" +
      "<td><strong>" + _kioscoEsc(u.usuario) + "</strong></td>" +
      "<td>" + _kioscoEsc(u.rol) + "</td>" +
      "<td>" + _kioscoEsc(u.sucursal || '—') + "</td>" +
      "<td>" + estado + "</td>" +
      "<td><button class='btn-demo' style='padding:4px 10px;font-size:12px' onclick=\"usuarioCambiarPassword(" + Number(u.id) + ")\">Cambiar contraseña</button></td>" +
    "</tr>";
  }).join('') || "<tr><td colspan='5' style='text-align:center;padding:2rem;color:var(--text-muted)'>No hay usuarios.</td></tr>";
}

function usuarioCambiarPassword(id) {
  const u = _usuariosAdminLista.find(x => Number(x.id) === Number(id));
  if (!u) return;
  window._usuarioPassNueva = '';
  mostrarConfirm({
    titulo: 'Cambiar contraseña',
    mensaje:
      "<div style='text-align:left'>" +
      "<p style='margin:0 0 10px'>Nueva contraseña para <strong>" + _kioscoEsc(u.usuario) + "</strong> (mínimo 8 caracteres):</p>" +
      "<input type='password' class='admin-input' id='usuarioPassInput' autocomplete='new-password' style='width:100%;margin:0' oninput='window._usuarioPassNueva=this.value' />" +
      "<label style='display:flex;gap:6px;align-items:center;font-size:12px;margin-top:8px;color:var(--text-muted)'>" +
        "<input type='checkbox' onchange=\"document.getElementById('usuarioPassInput').type=this.checked?'text':'password'\" /> Mostrar contraseña" +
      "</label></div>",
    textoOk: 'Guardar',
    onOk: async () => {
      // El overlay ya se cerró: el valor se guardó en oninput.
      const pass = window._usuarioPassNueva || '';
      window._usuarioPassNueva = '';
      if (pass.length < 8) { showToast('La contraseña debe tener al menos 8 caracteres'); return; }
      const json = await apiUsuariosAdmin('/' + encodeURIComponent(id) + '/password', { method: 'POST', body: JSON.stringify({ password: pass }) });
      showToast(json && json.ok ? 'Contraseña de ' + u.usuario + ' actualizada' : ((json && json.error) || 'No se pudo cambiar la contraseña'));
    },
  });
  setTimeout(() => { const i = document.getElementById('usuarioPassInput'); if (i) i.focus(); }, 50);
}
