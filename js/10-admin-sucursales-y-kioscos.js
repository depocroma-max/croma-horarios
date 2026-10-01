// ── SUCURSALES — Administración › Sucursales ─────────
// Ocultar / volver a mostrar sucursales. Backend: /api/sucursales (JWT
// admin/jefe). Ocultar no borra nada: el historial (horas, fichadas,
// reportes) sigue mostrándose; solo desaparece de En Vivo, formularios y
// del fichaje (kiosco y portal). 09 CIPO SAN MARTIN está cerrada
// definitivamente y no se puede reactivar.
function renderSucursalesAdminTab() {
  const cont = document.getElementById('adminTabSucursales');
  if (!cont) return;
  cont.innerHTML =
    "<div class='admin-head'>" +
      "<h1>Sucursales</h1>" +
      "<p>Ocultá una sucursal que ya no opera o volvé a mostrarla. Ocultar no borra nada: el historial se conserva. Una sucursal oculta deja de aparecer en En Vivo y formularios, y no se puede fichar en ella.</p>" +
    "</div>" +
    "<div class='dt-wrap'><div class='dt-scroll'>" +
      "<table class='dt-table'>" +
        "<thead><tr><th>Sucursal</th><th>Estado</th><th>Acciones</th></tr></thead>" +
        "<tbody id='sucursalesBody'><tr><td colspan='3' style='text-align:center;padding:2rem;color:var(--text-muted)'>Cargando…</td></tr></tbody>" +
      "</table>" +
    "</div></div>";
  cargarSucursalesAdmin();
}

async function cargarSucursalesAdmin() {
  const body = document.getElementById('sucursalesBody');
  if (!body) return;
  const json = await apiSucursales('', { method: 'GET' });
  if (!json || json.ok !== true) {
    body.innerHTML = "<tr><td colspan='3' style='text-align:center;padding:2rem;color:var(--red,#dc2626)'>" + _kioscoEsc((json && json.error) || 'No se pudieron cargar las sucursales.') + "</td></tr>";
    return;
  }
  aplicarSucursalesServidor(json.sucursales);
  body.innerHTML = json.sucursales.map(s => {
    const estado = s.activa
      ? "<span style='color:#059669;font-weight:600'>Visible</span>"
      : "<span style='color:var(--text-muted);font-weight:600'>Oculta" + (s.cerrada ? ' — cerrada' : '') + "</span>";
    let accion;
    if (s.cerrada) accion = "<span style='font-size:12px;color:var(--text-muted)'>Cerrada definitivamente</span>";
    else if (s.activa) accion = "<button class='btn-demo' style='padding:4px 10px;font-size:12px;color:#dc2626' onclick=\"sucursalToggle('" + s.id + "',false)\">Ocultar</button>";
    else accion = "<button class='btn-demo' style='padding:4px 10px;font-size:12px' onclick=\"sucursalToggle('" + s.id + "',true)\">Mostrar</button>";
    return "<tr" + (s.activa ? '' : " style='opacity:.65'") + ">" +
      "<td><span style='display:inline-block;width:10px;height:10px;border-radius:50%;background:" + _kioscoEsc(s.color) + ";margin-right:8px'></span><strong>" + _kioscoEsc(s.nombre) + "</strong></td>" +
      "<td>" + estado + "</td>" +
      "<td>" + accion + "</td>" +
    "</tr>";
  }).join('');
}

function sucursalToggle(id, activa) {
  const s = SUCURSALES_TODAS.find(x => x.id === id);
  const nombre = _kioscoEsc(s ? s.nombre : id);
  const aplicar = async () => {
    const json = await apiSucursales('/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ activa }) });
    showToast(json && json.ok ? (activa ? 'Sucursal visible' : 'Sucursal oculta') : ((json && json.error) || 'No se pudo actualizar'));
    await cargarSucursalesAdmin();
    poblarFiltroSucursales();
    if (state.datos && state.datos.length) renderAll();
  };
  if (activa) { aplicar(); return; }
  mostrarConfirm({
    titulo: 'Ocultar sucursal',
    mensaje: "¿Ocultar <strong>" + nombre + "</strong>? Deja de aparecer en En Vivo y formularios y no se podrá fichar en ella (kiosco y portal). El historial se conserva y se puede volver a mostrar.",
    textoOk: 'Ocultar',
    peligro: true,
    onOk: aplicar,
  });
}

// ── KIOSCOS — Administración › Kioscos (Fase 8C) ──────
// Gestión de dispositivos Kiosco: ver estado, generar una activación (código
// de un solo uso + link, 24 h), revocar y reasignar sucursal. Backend:
// /api/kioscos (JWT admin/jefe). 09 CIPO SAN MARTIN está cerrada: se muestra
// como dato histórico y no admite activaciones ni reasignaciones.
const KIOSCO_URL_BASE = 'https://horarios.croma-app.com.ar/kiosco.html';
let _kioscosLista = [];

function _kioscoEsc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function _kioscoFecha(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function _kioscoSucNombre(codigo) {
  const s = SUCURSALES_TODAS.find(x => x.id === codigo);
  return s ? s.nombre : codigo;
}

function renderKioscosAdminTab() {
  const cont = document.getElementById('adminTabKioscos');
  if (!cont) return;
  cont.innerHTML =
    "<div class='admin-head'>" +
      "<h1>Kioscos</h1>" +
      "<p>Dispositivos de fichaje de cada local. Generá un código o link de activación, revocá un kiosco o cambiale la sucursal.</p>" +
    "</div>" +
    "<div class='dt-wrap'><div class='dt-scroll'>" +
      "<table class='dt-table' id='kioscosTabla'>" +
        "<thead><tr><th>Kiosco</th><th>Sucursal</th><th>Estado</th><th>Activado</th><th>Último acceso</th><th>Versión</th><th>Acciones</th></tr></thead>" +
        "<tbody id='kioscosBody'><tr><td colspan='7' style='text-align:center;padding:2rem;color:var(--text-muted)'>Cargando…</td></tr></tbody>" +
      "</table>" +
    "</div></div>";
  cargarKioscosAdmin();
}

async function cargarKioscosAdmin() {
  const body = document.getElementById('kioscosBody');
  if (!body) return;
  const json = await apiKioscos('', { method: 'GET' });
  if (!json || json.ok !== true) {
    body.innerHTML = "<tr><td colspan='7' style='text-align:center;padding:2rem;color:var(--red,#dc2626)'>" + _kioscoEsc((json && (json.error || json.mensaje)) || 'No se pudieron cargar los kioscos.') + "</td></tr>";
    return;
  }
  _kioscosLista = json.dispositivos || [];
  body.innerHTML = _kioscosLista.map(d => {
    const revocado = d.estado === 'revocado';
    const estado = revocado
      ? "<span style='color:#dc2626;font-weight:600'>Revocado</span>"
      : "<span style='color:#059669;font-weight:600'>Activo</span>";
    const pendiente = d.activacion_vigente_hasta ? "<div style='font-size:11px;color:var(--text-muted)'>Activación pendiente hasta " + _kioscoFecha(d.activacion_vigente_hasta) + "</div>" : '';
    const sucTxt = _kioscoEsc(_kioscoSucNombre(d.sucursal)) + (d.operativo ? '' : " <span style='font-size:11px;color:var(--text-muted)'>(cerrada — solo historial)</span>");
    const acciones = [];
    if (d.operativo) {
      acciones.push("<button class='btn-demo' style='padding:4px 10px;font-size:12px' onclick=\"kioscoGenerarActivacion('" + d.dispositivo_id + "')\">Generar activación</button>");
      acciones.push("<button class='btn-demo' style='padding:4px 10px;font-size:12px' onclick=\"kioscoCambiarSucursal('" + d.dispositivo_id + "')\">Cambiar sucursal</button>");
    }
    if (!revocado) acciones.push("<button class='btn-demo' style='padding:4px 10px;font-size:12px;color:#dc2626' onclick=\"kioscoRevocar('" + d.dispositivo_id + "')\">Revocar</button>");
    return "<tr" + (revocado ? " style='opacity:.65'" : '') + ">" +
      "<td><strong>" + _kioscoEsc(d.nombre) + "</strong><div style='font-size:11px;color:var(--text-muted)'>" + _kioscoEsc(d.dispositivo_id) + "</div></td>" +
      "<td>" + sucTxt + "</td>" +
      "<td>" + estado + pendiente + "</td>" +
      "<td>" + _kioscoFecha(d.activado_en) + (d.activado_por ? "<div style='font-size:11px;color:var(--text-muted)'>por " + _kioscoEsc(d.activado_por) + "</div>" : '') + "</td>" +
      "<td>" + _kioscoFecha(d.ultimo_uso_en) + "</td>" +
      "<td>" + _kioscoEsc(d.ultima_version || '—') + "</td>" +
      "<td><div style='display:flex;gap:6px;flex-wrap:wrap'>" + (acciones.join('') || '—') + "</div></td>" +
    "</tr>";
  }).join('') || "<tr><td colspan='7' style='text-align:center;padding:2rem;color:var(--text-muted)'>No hay kioscos registrados.</td></tr>";
}

async function _kioscoCopiar(texto) {
  try { await navigator.clipboard.writeText(texto); showToast('Copiado'); }
  catch (e) { window.prompt('Copiá el texto:', texto); }
}

async function kioscoGenerarActivacion(id) {
  const json = await apiKioscos('/' + encodeURIComponent(id) + '/activacion', { method: 'POST', body: '{}' });
  if (!json || json.ok !== true) { showToast((json && json.error) || 'No se pudo generar la activación'); return; }
  window._kioscoLinkActual = json.link;
  window._kioscoCodigoActual = json.codigo;
  mostrarConfirm({
    titulo: 'Activación generada',
    mensaje:
      "<div style='text-align:left'>" +
      "<p style='margin:0 0 8px'>Código (un solo uso, vence " + _kioscoFecha(json.expira_en) + "):</p>" +
      "<div style='font-size:30px;letter-spacing:5px;font-weight:700;text-align:center;margin:6px 0 14px'>" + _kioscoEsc(json.codigo) + "</div>" +
      "<p style='margin:0 0 6px'>Link para abrir en la PC del local:</p>" +
      "<div style='font-size:12px;word-break:break-all;background:#f4f4f2;padding:8px;border-radius:8px'>" + _kioscoEsc(json.link) + "</div>" +
      "<p style='margin:12px 0 0;font-size:12px;color:var(--text-muted)'>Al activarse, la credencial anterior de este kiosco deja de funcionar.</p>" +
      "<div style='display:flex;gap:8px;margin-top:12px'>" +
        "<button class='btn-demo' onclick='_kioscoCopiar(window._kioscoCodigoActual)'>Copiar código</button>" +
        "<button class='btn-demo' onclick='_kioscoCopiar(window._kioscoLinkActual)'>Copiar link</button>" +
      "</div></div>",
    textoOk: 'Listo',
    textoCancel: 'Cerrar',
    onOk: () => { window._kioscoLinkActual = null; window._kioscoCodigoActual = null; cargarKioscosAdmin(); },
  });
  cargarKioscosAdmin();
}

function kioscoRevocar(id) {
  const d = _kioscosLista.find(x => x.dispositivo_id === id);
  mostrarConfirm({
    titulo: 'Revocar kiosco',
    mensaje: "¿Revocar <strong>" + _kioscoEsc(d ? d.nombre : id) + "</strong>? Deja de poder fichar de inmediato. El registro se conserva y se puede volver a activar con un código nuevo.",
    textoOk: 'Revocar',
    peligro: true,
    onOk: async () => {
      const json = await apiKioscos('/' + encodeURIComponent(id) + '/revocar', { method: 'POST', body: '{}' });
      showToast(json && json.ok ? 'Kiosco revocado' : ((json && json.error) || 'No se pudo revocar'));
      cargarKioscosAdmin();
    },
  });
}

function kioscoCambiarSucursal(id) {
  const d = _kioscosLista.find(x => x.dispositivo_id === id);
  window._kioscoSucSel = d ? d.sucursal : null;
  const opciones = SUCURSALES.filter(s => s.id !== '09').map(s => "<option value='" + s.id + "'" + (d && d.sucursal === s.id ? ' selected' : '') + ">" + _kioscoEsc(s.nombre) + "</option>").join('');
  mostrarConfirm({
    titulo: 'Cambiar sucursal',
    mensaje: "<p style='margin:0 0 10px'>Nueva sucursal para <strong>" + _kioscoEsc(d ? d.nombre : id) + "</strong>:</p><select class='admin-input' id='kioscoNuevaSuc' style='width:100%' onchange='window._kioscoSucSel=this.value'>" + opciones + "</select>",
    textoOk: 'Guardar',
    onOk: async () => {
      const suc = window._kioscoSucSel; // el overlay ya se cerró: el valor se guardó en onchange
      const json = await apiKioscos('/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ sucursal: suc }) });
      showToast(json && json.ok ? 'Sucursal actualizada' : ((json && json.error) || 'No se pudo actualizar'));
      cargarKioscosAdmin();
    },
  });
}

