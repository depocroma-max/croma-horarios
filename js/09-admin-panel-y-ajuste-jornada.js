// La tab "Usuarios" vieja (crear/editar/eliminar usuario suelto, con
// selector manual de empleado vinculado) se eliminó — reemplazada por la
// ficha unificada de empleado, pestaña Acceso (ver ADMINISTRACIÓN
// UNIFICADA más abajo). Confirmado sin referencias antes de borrarla
// (Commit 4): ni la navegación (renderAdminInline/switchAdminTab) ni
// ningún otro archivo del proyecto la usaban.
// ── PANEL ADMIN ────────────────────────────────────────
// adminAutenticado: true si el JWT tiene rol admin o jefe
function _isAdminJwt() {
  try {
    const t = sessionStorage.getItem('croma_token') || localStorage.getItem('croma_token');
    if (!t) return false;
    const p = JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
    return p.exp * 1000 > Date.now() && (p.rol === 'admin' || p.rol === 'jefe' || p.rol === 'horarios');
  } catch(e) { return false; }
}
let adminAutenticado = _isAdminJwt();

function abrirAdmin() { setView('administracion'); }

// Estado combinado de fila para el filtro "Estado" (empleado + acceso) —
// un solo valor por fila para que el <select> tenga una sola dimensión.
function _estadoFiltroFila(emp) {
  if (emp.estado === 'inactivo') return 'inactivo';
  if (!emp._usuario) return 'sin_acceso';
  if (emp._usuario.estado === 'inactivo') return 'desactivado';
  if (emp._usuario.fin_acceso) {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const fin = new Date(emp._usuario.fin_acceso + 'T00:00:00');
    if (!isNaN(fin.getTime()) && fin < hoy) return 'vencido';
  }
  return 'con_acceso';
}

function renderAdminInline() {
  const container = document.getElementById('adminContainer');
  if (!container) return;

  const empleadosAdmin = obtenerEmpleadosAdmin();
  const conAcceso = empleadosAdmin.filter(e => e._usuario && e._usuario.estado !== 'inactivo').length;
  const sinAcceso = empleadosAdmin.length - conAcceso;

  const filasEmps = empleadosAdmin.map(emp => {
    const nombre    = emp.nombre;
    const suc       = SUCURSALES_TODAS.find(s => s.id === (emp.sucursal_id || state.datos.find(r => r.EMPLEADO === nombre)?.LOCAL)) || { id: '', nombre: '—', color: 'var(--gray-400)' };
    const numMatch  = nombre.match(/^(\d+)\s+(.+)$/);
    const nomMostrar= numMatch ? numMatch[2] : nombre;
    const avatarUrl = emp.foto_url || '';
    const iniciales = nomMostrar.split(' ').slice(0,2).map(p=>p[0]?.toUpperCase()).join('');
    const nomEnc    = nombre.replace(/'/g, "\\'");
    const avatarInner = avatarUrl
      ? "<img class='dt-avatar' src='" + avatarUrl + "' onerror=\"this.outerHTML='<span class=&quot;dt-avatar-initials&quot;>" + iniciales + "</span>'\">"
      : "<span class='dt-avatar-initials'>" + iniciales + "</span>";

    const catNom = CATEGORIAS_CONFIG.find(c => c.id === emp.categoria_id)?.nombre || '';
    const metaPlain = [emp.empresa, catNom].filter(Boolean).join(" <span style='color:var(--border-neutral)'>·</span> ") || '<span style="color:var(--text-muted)">—</span>';

    const sysneo = _infoSysneoAdmin(emp);
    const acceso = _infoAccesoAdmin(emp);
    const usuarioHTML = emp._usuario
      ? "<span style='font-size:12.5px;font-weight:600;color:var(--croma-black)'>" + emp._usuario.nombre + "</span>"
      : "<span style='font-size:12px;color:var(--text-muted)'>—</span>";
    const subLinea = emp.estado === 'inactivo'
      ? "<span style='color:var(--danger)'>Empleado inactivo</span>"
      : (catNom || '&nbsp;');
    const nombreLegalHTML = emp.nombre_legal
      ? "<span style='font-size:11px;color:var(--text-muted)'>" + emp.nombre_legal + "</span>"
      : "<span class='badge badge-neutral' style='font-size:10px;padding:1px 6px'>Nombre legal pendiente</span>";

    const botones = [
      "<button class='dt-btn-icon' title='Editar' onclick=\"event.stopPropagation();abrirFormularioEmpleado('" + nomEnc + "')\">" + icon('edit','icon-16') + "</button>",
    ];
    if (!emp._usuario) {
      botones.push("<button class='dt-btn-icon' title='Crear acceso' onclick=\"event.stopPropagation();abrirFormularioEmpleado('" + nomEnc + "','acceso')\">" + icon('userPlus','icon-16') + "</button>");
    } else if (emp._usuario.estado === 'inactivo') {
      botones.push("<button class='dt-btn-icon' title='Reactivar acceso' onclick=\"event.stopPropagation();accionReactivarAcceso('" + nomEnc + "')\">" + icon('refresh','icon-16') + "</button>");
    } else {
      botones.push("<button class='dt-btn-icon' title='Cambiar PIN' onclick=\"event.stopPropagation();abrirCambiarPinAdmin('" + nomEnc + "')\">" + icon('key','icon-16') + "</button>");
    }
    botones.push("<button class='dt-btn-icon' title='Más acciones' onclick=\"event.stopPropagation();abrirMasAccionesEmpleado(event,'" + nomEnc + "')\">" + icon('moreVertical','icon-16') + "</button>");

    const dataAttrs = "data-sucursal='" + (suc.id || '') + "' data-empresa='" + (emp.empresa || '') + "' data-categoria='" + (emp.categoria_id || '') + "' data-estado='" + _estadoFiltroFila(emp) + "'";

    return "<tr class='dt-clickable" + (emp.estado === 'inactivo' ? ' dt-inactive' : '') + "' " + dataAttrs + " onclick=\"abrirFormularioEmpleado('" + nomEnc + "')\">" +
      "<td><div class='dt-identity'>" +
        "<div class='dt-avatar-wrap'>" + avatarInner + "<span class='dt-avatar-dot dot-" + acceso.tono + "'></span></div>" +
        "<div class='dt-identity-text'>" +
          "<div class='dt-identity-name'>" + nomMostrar + (emp.apodo ? " <span class='badge badge-neutral' style='font-size:10px;padding:1px 7px;vertical-align:middle'>" + emp.apodo + "</span>" : "") + " <span style='font-size:10.5px;font-weight:600;color:var(--text-muted)'>#" + (emp.numero_vendedor_sysneo || '—') + "</span></div>" +
          "<div class='dt-identity-sub'>" + subLinea + "</div>" +
          "<div class='dt-identity-legal' style='margin-top:2px'>" + nombreLegalHTML + "</div>" +
        "</div>" +
      "</div></td>" +
      "<td class='col-suc'><span style='display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary)'><span style='width:6px;height:6px;border-radius:50%;flex-shrink:0;background:" + suc.color + "'></span>" + suc.nombre + "</span></td>" +
      "<td><span style='font-size:12.5px;color:var(--text-secondary)'>" + metaPlain + "</span></td>" +
      "<td class='col-sysneo'>" + (sysneo.asignado
        ? "<span style='font-size:12.5px;color:var(--croma-black)'>#" + sysneo.label + "</span>"
        : "<span style='font-size:12.5px;color:var(--text-muted)'>Pendiente</span>") + "</td>" +
      "<td class='col-usuario'>" + usuarioHTML + "</td>" +
      "<td><span class='" + acceso.clase + "'><span class='badge-dot'></span>" + acceso.label + "</span></td>" +
      "<td class='al-c'><div class='dt-row-actions'>" + botones.join('') + "</div></td>" +
      "</tr>";
  }).join('');

  const filasCats = CATEGORIAS_CONFIG.map(cat => {
    const percibeHTML = cat.percibe_extra
      ? "<span class='pill pill-comp' style='font-size:10px'>Sí</span>"
      : "<span class='pill pill-franco' style='font-size:10px'>No</span>";
    return "<tr>" +
      "<td><strong>" + cat.nombre + "</strong></td>" +
      "<td style='font-size:12px;color:var(--text-secondary)'>" + esc(cat.descripcion || '—') + "</td>" +
      "<td>" + percibeHTML + "</td>" +
      "<td><button class='btn-admin-edit' onclick=\"abrirEditarCategoria('" + cat.id + "')\" >Editar</button></td>" +
      "</tr>";
  }).join('');

  const sucOptsFiltro = SUCURSALES.map(s => "<option value='" + s.id + "'>" + s.nombre + "</option>").join('');
  const empOptsFiltro = EMPRESAS.map(e => "<option value='" + e + "'>" + e + "</option>").join('');
  const catOptsFiltro = CATEGORIAS_CONFIG.map(c => "<option value='" + c.id + "'>" + c.nombre + "</option>").join('');

  const certsOrdenados  = CERTIFICADOS_CACHE.slice().sort((a, b) => b.fecha.localeCompare(a.fecha));
  const empleadosConCert = new Set(CERTIFICADOS_CACHE.map(c => c.empleado)).size;
  const _hoyCert = new Date();
  const certsEsteMes = CERTIFICADOS_CACHE.filter(c => {
    const [y, m] = c.fecha.split('-').map(Number);
    return y === _hoyCert.getFullYear() && m === _hoyCert.getMonth() + 1;
  }).length;
  const filasCerts = certsOrdenados.map(c => {
    return "<tr data-tipo='" + (c.tipo || '').replace(/'/g, '&#39;') + "'>" +
      "<td><span style='font-size:13px;font-weight:600;color:var(--croma-black)'>" + c.empleado + "</span></td>" +
      "<td><span style='font-size:12.5px;color:var(--text-secondary)'>" + _fechaDisplay(c.fecha) + "</span></td>" +
      "<td><span class='badge badge-info'>" + c.tipo + "</span></td>" +
      "<td class='al-c'><span style='font-size:12.5px;color:var(--text-secondary)'>" + c.hs + "h</span></td>" +
      "<td><span style='font-size:12.5px;color:var(--text-secondary)'>" + esc(c.nota || '—') + "</span></td>" +
      "<td class='al-c'><div class='dt-row-actions' style='justify-content:center'><button class='dt-btn-icon dt-btn-icon--danger' title='Borrar certificado' onclick=\"eliminarCertificadoAdmin('" + c.id + "')\">" + icon('trash', 'icon-16') + "</button></div></td>" +
      "</tr>";
  }).join('');
  const tiposOptsFiltro = TIPOS_CERTIFICADO.map(t => "<option value='" + t + "'>" + t + "</option>").join('');

  container.innerHTML =
    "<div class='admin-inline-wrap'>" +
    "<div class='admin-shell-v2'>" +
    "<nav class='rail-nav' id='adminRail'>" +
      "<div class='rail-label'>Administración</div>" +
      "<button class='rail-item active' onclick=\"switchAdminTab('empleados',this)\">" + icon('users','icon-16') + "<span>Empleados</span><span class='rail-count'>" + empleadosAdmin.length + "</span></button>" +
      "<button class='rail-item' onclick=\"switchAdminTab('categorias',this)\">" + icon('fileText','icon-16') + "<span>Categorías</span></button>" +
      "<button class='rail-item' onclick=\"switchAdminTab('certificados',this)\">" + icon('shieldCheck','icon-16') + "<span>Certificados</span><span class='rail-count'>" + CERTIFICADOS_CACHE.length + "</span></button>" +
      "<button class='rail-item' onclick=\"switchAdminTab('configuracion',this)\">" + icon('settings','icon-16') + "<span>Configuración</span></button>" +
      "<button class='rail-item' onclick=\"switchAdminTab('ajusteJornada',this)\">" + icon('clock','icon-16') + "<span>Ajuste de jornada</span></button>" +
      "<button class='rail-item' onclick=\"switchAdminTab('fichadas',this)\">" + icon('download','icon-16') + "<span>Fichadas</span></button>" +
      ((sesionActual?.rol === 'admin' || sesionActual?.rol === 'jefe') ? "<button class='rail-item' onclick=\"switchAdminTab('kioscos',this)\">" + icon('store','icon-16') + "<span>Kioscos</span></button>" : '') +
      ((sesionActual?.rol === 'admin' || sesionActual?.rol === 'jefe') ? "<button class='rail-item' onclick=\"switchAdminTab('sucursales',this)\">" + icon('warehouse','icon-16') + "<span>Sucursales</span></button>" : '') +
      "<button class='rail-item' onclick=\"switchAdminTab('recibos',this)\">" + icon('fileText','icon-16') + "<span>Recibos</span></button>" +
      "<button class='rail-item' onclick=\"switchAdminTab('diasVacaciones',this)\">" + icon('palmtree','icon-16') + "<span>Días de Vacaciones</span></button>" +
      "<button class='rail-item' onclick=\"switchAdminTab('bancoHoras',this)\">" + icon('timer','icon-16') + "<span>Banco de horas</span></button>" +
    "</nav>" +
    "<main class='admin-main-v2'>" +
    "<div id='adminTabEmpleados' class='admin-tab-content'>" +
      "<div class='admin-head-row'>" +
        "<div class='admin-head'>" +
          "<h1>Empleados</h1>" +
          "<p>Alta, ficha y acceso a Croma Horarios de cada persona. El acceso es opcional.</p>" +
          "<div class='stat-strip'>" +
            "<div class='stat-item'><span class='stat-num'>" + empleadosAdmin.length + "</span><span class='stat-label'>empleados</span></div>" +
            "<span class='stat-sep'></span>" +
            "<div class='stat-item'><span class='stat-num'>" + conAcceso + "</span><span class='stat-label'>con acceso</span></div>" +
            "<span class='stat-sep'></span>" +
            "<div class='stat-item'><span class='stat-num'>" + sinAcceso + "</span><span class='stat-label'>sin acceso</span></div>" +
            "<span class='stat-sep'></span>" +
            "<div class='stat-item'><span class='stat-num'>" + SUCURSALES.length + "</span><span class='stat-label'>sucursales</span></div>" +
          "</div>" +
        "</div>" +
        "<button class='btn-connect' style='width:auto;padding:0 16px;height:38px;margin:0;display:inline-flex;align-items:center;gap:7px' onclick=\"abrirFormularioEmpleado(null)\">" + icon('plus','icon-16') + " Nuevo empleado</button>" +
      "</div>" +
      "<div class='filters-bar'>" +
        "<div class='f-search-wrap'>" + icon('search','icon-16') + "<input type='text' class='f-search' id='adminBuscarEmp' aria-label='Buscar empleado' placeholder='Buscar empleado…' oninput='_filtrarTablaAdminCombinado()' /></div>" +
        "<select class='f-select' id='filtroAdminSucursal' aria-label='Filtrar por sucursal' onchange='_filtrarTablaAdminCombinado()'><option value=''>Todas las sucursales</option>" + sucOptsFiltro + "</select>" +
        "<select class='f-select' id='filtroAdminEmpresa' aria-label='Filtrar por empresa' onchange='_filtrarTablaAdminCombinado()'><option value=''>Todas las empresas</option>" + empOptsFiltro + "</select>" +
        "<select class='f-select' id='filtroAdminCategoria' aria-label='Filtrar por categoría' onchange='_filtrarTablaAdminCombinado()'><option value=''>Todas las categorías</option>" + catOptsFiltro + "</select>" +
        "<select class='f-select' id='filtroAdminEstado' aria-label='Filtrar por estado' onchange='_filtrarTablaAdminCombinado()'>" +
          "<option value=''>Cualquier estado</option>" +
          "<option value='con_acceso'>Con acceso</option>" +
          "<option value='sin_acceso'>Sin acceso</option>" +
          "<option value='desactivado'>Acceso desactivado</option>" +
          "<option value='vencido'>Acceso vencido</option>" +
          "<option value='inactivo'>Empleado inactivo</option>" +
        "</select>" +
        "<button class='f-clear' onclick='_limpiarFiltrosAdmin()'>Limpiar</button>" +
      "</div>" +
      "<div class='dt-wrap'>" +
        "<div class='dt-scroll'>" +
        "<table class='dt-table' id='adminTablaEmps'>" +
          "<thead><tr><th>Empleado</th><th class='col-suc'>Sucursal</th><th>Empresa / Categoría</th><th class='col-sysneo'>Sysneo</th><th class='col-usuario'>Usuario</th><th>Acceso</th><th class='al-c'></th></tr></thead>" +
          "<tbody>" + (filasEmps || "<tr><td colspan='7' style='text-align:center;padding:2.5rem;color:var(--text-muted);font-size:13px'>Sin datos cargados</td></tr>") + "</tbody>" +
        "</table>" +
        "</div>" +
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
    "<div id='adminTabCertificados' class='admin-tab-content' style='display:none'>" +
      "<div class='admin-head-row'>" +
        "<div class='admin-head'>" +
          "<h1>Certificados</h1>" +
          "<p>Certificados médicos y otras justificaciones cargadas por empleado.</p>" +
          "<div class='stat-strip'>" +
            "<div class='stat-item'><span class='stat-num'>" + CERTIFICADOS_CACHE.length + "</span><span class='stat-label'>certificados</span></div>" +
            "<span class='stat-sep'></span>" +
            "<div class='stat-item'><span class='stat-num'>" + empleadosConCert + "</span><span class='stat-label'>empleados</span></div>" +
            "<span class='stat-sep'></span>" +
            "<div class='stat-item'><span class='stat-num'>" + certsEsteMes + "</span><span class='stat-label'>este mes</span></div>" +
          "</div>" +
        "</div>" +
        "<button class='btn-connect' style='width:auto;padding:0 16px;height:38px;margin:0;display:inline-flex;align-items:center;gap:7px' onclick='abrirSelectorEmpleadoCertificado()'>" + icon('plus','icon-16') + " Nuevo certificado</button>" +
      "</div>" +
      "<div class='filters-bar'>" +
        "<div class='f-search-wrap'>" + icon('search','icon-16') + "<input type='text' class='f-search' id='adminBuscarCert' aria-label='Buscar empleado o nota' placeholder='Buscar empleado o nota…' oninput='_filtrarTablaCertAdmin()' /></div>" +
        "<select class='f-select' id='filtroCertTipo' aria-label='Filtrar por tipo' onchange='_filtrarTablaCertAdmin()'><option value=''>Todos los tipos</option>" + tiposOptsFiltro + "</select>" +
        "<button class='f-clear' onclick='_limpiarFiltrosCertAdmin()'>Limpiar</button>" +
      "</div>" +
      "<div class='dt-wrap'>" +
        "<div class='dt-scroll'>" +
        "<table class='dt-table' id='adminTablaCerts'>" +
          "<thead><tr><th>Empleado</th><th>Fecha</th><th>Tipo</th><th class='al-c'>Horas</th><th>Nota</th><th class='al-c'></th></tr></thead>" +
          "<tbody>" + (filasCerts || "<tr><td colspan='6' style=\"text-align:center;padding:2.5rem;color:var(--text-muted);font-size:13px\">Sin certificados cargados</td></tr>") + "</tbody>" +
        "</table>" +
        "</div>" +
      "</div>" +
    "</div>" +
    "<div id='adminTabConfiguracion' class='admin-tab-content' style='display:none'>" +
      "<div style='padding:1.25rem 0;max-width:480px'>" +
        "<div class='admin-table-wrap' style='padding:1.5rem'>" +
          "<h3 style='font-size:14px;font-weight:600;margin:0 0 1.25rem;color:#1e293b'>Configuración general</h3>" +
          "<div class='admin-form-grupo'>" +
            "<label class='emp-filtro-label' for='cfgEmailAdmin'>Email del administrador (para notificaciones de vacaciones)</label>" +
            "<input type='email' class='admin-input' id='cfgEmailAdmin' placeholder='admin@croma.com' />" +
          "</div>" +
          "<div style='margin-top:1.25rem'>" +
            "<button class='btn-connect' style='margin:0;width:auto;padding:10px 24px' onclick='guardarConfigAdmin()'>Guardar</button>" +
          "</div>" +
          "<p id='cfgStatus' style='font-size:12px;margin-top:8px;display:none'></p>" +
        "</div>" +
        "<div class='admin-table-wrap' style='padding:1.5rem;margin-top:1rem'>" +
          "<h3 style='font-size:14px;font-weight:600;margin:0 0 4px;color:#1e293b'>Emails por sucursal</h3>" +
          "<p style='font-size:12px;color:var(--text-muted);margin:0 0 1.25rem'>Se usan para notificar eventos del calendario a cada sucursal.</p>" +
          SUCURSALES.map(function(s) {
            return "<div class='admin-form-grupo' style='margin-bottom:10px'>" +
              "<label class='emp-filtro-label' for='cfgSucEmail_" + s.id + "'><span style='display:inline-block;width:8px;height:8px;border-radius:50%;background:" + s.color + ";margin-right:6px'></span>" + s.nombre + "</label>" +
              "<input type='email' class='admin-input cfg-suc-email' id='cfgSucEmail_" + s.id + "' data-suc-id='" + s.id + "' placeholder='email@sucursal.com' style='margin:0' />" +
            "</div>";
          }).join('') +
          "<div style='margin-top:1.25rem'>" +
            "<button class='btn-connect' style='margin:0;width:auto;padding:10px 24px' onclick='guardarEmailsSucursales()'>Guardar emails</button>" +
          "</div>" +
          "<p id='cfgSucStatus' style='font-size:12px;margin-top:8px;display:none'></p>" +
        "</div>" +
        "<div class='admin-table-wrap' style='padding:1.5rem;margin-top:1rem'>" +
          "<h3 style='font-size:14px;font-weight:600;margin:0 0 4px;color:#1e293b'>Lista de correos para eventos</h3>" +
          "<p style='font-size:12px;color:var(--text-muted);margin:0 0 1.25rem'>Estos correos estarán disponibles para elegir al crear un evento del calendario.</p>" +
          "<div id='cfgEmailsLista'><p style='font-size:12px;color:var(--text-muted)'>Cargando...</p></div>" +
          "<div style='display:flex;gap:8px;margin-top:12px'>" +
            "<input type='text' class='admin-input' id='cfgNuevoNombre' aria-label='Nombre del contacto' placeholder='Nombre' style='margin:0;flex:1' />" +
            "<input type='email' class='admin-input' id='cfgNuevoEmail' aria-label='Email del contacto' placeholder='correo@ejemplo.com' style='margin:0;flex:2' />" +
            "<button class='btn-connect' style='margin:0;width:auto;padding:10px 18px;white-space:nowrap' onclick='agregarEmailContacto()'>+ Agregar</button>" +
          "</div>" +
          "<p id='cfgEmailsStatus' style='font-size:12px;margin-top:8px;display:none'></p>" +
        "</div>" +
      "</div>" +
    "</div>" +
    "<div id='adminTabAjusteJornada' class='admin-tab-content' style='display:none'></div>" +
    "<div id='adminTabFichadas' class='admin-tab-content' style='display:none'></div>" +
    "<div id='adminTabKioscos' class='admin-tab-content' style='display:none'></div>" +
    "<div id='adminTabSucursales' class='admin-tab-content' style='display:none'></div>" +
    "<div id='adminTabRecibos' class='admin-tab-content' style='display:none'></div>" +
    "<div id='adminTabDiasVacaciones' class='admin-tab-content' style='display:none'></div>" +
    "<div id='adminTabBancoHoras' class='admin-tab-content' style='display:none'></div>" +
    "</main>" +
    "</div>" +
    "</div>";
}

function renderAdmin() { renderAdminInline(); }

function switchAdminTab(tab, btn) {
  document.querySelectorAll('#adminRail .rail-item').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('adminTabEmpleados').style.display    = tab === 'empleados'     ? 'block' : 'none';
  document.getElementById('adminTabCategorias').style.display   = tab === 'categorias'    ? 'block' : 'none';
  document.getElementById('adminTabCertificados').style.display = tab === 'certificados'  ? 'block' : 'none';
  document.getElementById('adminTabConfiguracion').style.display= tab === 'configuracion' ? 'block' : 'none';
  document.getElementById('adminTabAjusteJornada').style.display= tab === 'ajusteJornada'  ? 'block' : 'none';
  document.getElementById('adminTabFichadas').style.display     = tab === 'fichadas'       ? 'block' : 'none';
  const _tabKioscos = document.getElementById('adminTabKioscos');
  if (_tabKioscos) _tabKioscos.style.display = tab === 'kioscos' ? 'block' : 'none';
  const _tabSucursales = document.getElementById('adminTabSucursales');
  if (_tabSucursales) _tabSucursales.style.display = tab === 'sucursales' ? 'block' : 'none';
  document.getElementById('adminTabRecibos').style.display      = tab === 'recibos'        ? 'block' : 'none';
  document.getElementById('adminTabDiasVacaciones').style.display = tab === 'diasVacaciones' ? 'block' : 'none';
  document.getElementById('adminTabBancoHoras').style.display   = tab === 'bancoHoras'     ? 'block' : 'none';
  if (tab === 'configuracion') cargarConfigAdmin();
  if (tab === 'ajusteJornada') renderAjusteJornadaTab();
  if (tab === 'fichadas') renderFichadasTab();
  if (tab === 'kioscos') renderKioscosAdminTab();
  if (tab === 'sucursales') renderSucursalesAdminTab();
  if (tab === 'recibos') renderRecibosAdminTab();
  if (tab === 'diasVacaciones') cargarBancoDias();
  if (tab === 'bancoHoras') cargarBancoHorasAdmin();
}

// ── ADMINISTRACIÓN → RECIBOS ──────────────────────────
// Acceso rápido a Subir/Reemplazar/Descargar recibos sin entrar a la
// ficha completa de cada empleado. Reutiliza 100% la lógica ya construida
// en la ficha admin (_recibosFicha, _cargarRecibosEmpleado,
// _renderTabRecibosEmpleado, _abrirModalRecibo, _recibosDescargarAdmin) —
// solo cambia el punto de entrada. Mismos permisos: esta pestaña vive
// dentro de Administración, ya gateada a admin/jefe.
// Estado del filtro/orden por empresa — vive fuera de renderRecibosAdminTab
// para sobrevivir a sus propios re-renders (el select/botón que lo controla
// se reconstruye desde acá cada vez).
let _recibosAdminFiltro = { empresa: '', ordenEmpresa: '' }; // ordenEmpresa: '' | 'asc' | 'desc'

function _toggleOrdenEmpresaRecibos() {
  _recibosAdminFiltro.ordenEmpresa =
    _recibosAdminFiltro.ordenEmpresa === 'asc' ? 'desc' :
    _recibosAdminFiltro.ordenEmpresa === 'desc' ? '' : 'asc';
  renderRecibosAdminTab();
}

// 'Mes actual' y 'mes anterior' — mismo formato yyyy-MM que PERIODO en
// Sheets (ver _validarPeriodo en croma-backend/src/routes/recibos.js).
function _ultimosDosMesesRecibos() {
  const MESES_ABR = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const now = new Date();
  const build = d => ({
    periodo: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    label: `${MESES_ABR[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
  });
  return [build(now), build(new Date(now.getFullYear(), now.getMonth() - 1, 1))];
}

function renderRecibosAdminTab() {
  const container = document.getElementById('adminTabRecibos');
  if (!container) return;

  let empleadosAdmin = obtenerEmpleadosAdmin().filter(e => e.estado !== 'inactivo');

  const empresasDisponibles = Array.from(new Set(empleadosAdmin.map(e => e.empresa).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es'));

  if (_recibosAdminFiltro.empresa) empleadosAdmin = empleadosAdmin.filter(e => (e.empresa || '') === _recibosAdminFiltro.empresa);

  if (_recibosAdminFiltro.ordenEmpresa) {
    const dir = _recibosAdminFiltro.ordenEmpresa === 'asc' ? 1 : -1;
    empleadosAdmin = empleadosAdmin.slice().sort((a, b) => {
      const ea = (a.empresa || '').toLowerCase(), eb = (b.empresa || '').toLowerCase();
      if (ea !== eb) return ea < eb ? -1 * dir : 1 * dir;
      return a.nombre.localeCompare(b.nombre, 'es');
    });
  }

  const [mes1, mes2] = _ultimosDosMesesRecibos();

  const filas = empleadosAdmin.map(emp => {
    const nombre = emp.nombre;
    const nomMostrar = nombre.replace(/^\d+\s+/, '');
    const nomEnc = nombre.replace(/'/g, "\\'");
    const rowId = 'recAdminFila_' + nombre.replace(/[^a-zA-Z0-9]/g, '_');
    const nombreLegalHTML = emp.nombre_legal
      ? `<span style="font-size:11px;color:var(--text-muted)">${emp.nombre_legal}</span>`
      : `<span class="badge badge-neutral" style="font-size:10px;padding:1px 6px">Nombre legal pendiente</span>`;
    return `
    <tr class="dt-clickable" data-nombre="${nombre.replace(/"/g, '&quot;')}" onclick="_toggleRecibosAdminFila('${nomEnc}','${rowId}')">
      <td><div class="dt-identity"><div class="dt-identity-text">
        <div class="dt-identity-name">${nomMostrar}${emp.apodo ? ` <span class="badge badge-neutral" style="font-size:10px;padding:1px 7px;vertical-align:middle">${emp.apodo}</span>` : ''}</div>
        <div class="dt-identity-legal" style="margin-top:2px">${nombreLegalHTML}</div>
      </div></div></td>
      <td><span style="font-size:12.5px;color:var(--text-secondary)">${emp.empresa || '—'}</span></td>
      <td class="al-c" data-mes="0" style="font-size:14px">…</td>
      <td class="al-c" data-mes="1" style="font-size:14px">…</td>
      <td class="al-c">
        <div style="display:flex;gap:6px;justify-content:center">
          <button class="btn-admin-edit" type="button" title="Agregar recibo" onclick="event.stopPropagation();_accesoRapidoAgregarRecibo('${nomEnc}','${rowId}')">${icon('plus', 'icon-14')} Agregar</button>
          <button class="btn-admin-edit" type="button" onclick="event.stopPropagation();_toggleRecibosAdminFila('${nomEnc}','${rowId}')">${icon('fileText', 'icon-14')} Ver recibos</button>
        </div>
      </td>
    </tr>
    <tr id="${rowId}" style="display:none">
      <td colspan="5" style="padding:0;border-bottom:1px solid var(--border-neutral)">
        <div style="padding:16px 18px;background:var(--gray-50)" id="${rowId}_body"></div>
      </td>
    </tr>`;
  }).join('');

  const flechaStyle = _recibosAdminFiltro.ordenEmpresa === 'asc' ? 'display:inline-flex;transform:rotate(180deg)' : 'display:inline-flex';
  const ordenBtnActivo = _recibosAdminFiltro.ordenEmpresa ? 'style="border-color:var(--accent, #0d0d0d)"' : '';

  container.innerHTML = `
    <div class="admin-head-row">
      <div class="admin-head">
        <h1>Recibos</h1>
        <p>Subí, reemplazá o descargá recibos de sueldo de cualquier empleado sin entrar a su ficha completa.</p>
      </div>
    </div>
    <div class="filters-bar">
      <div class="f-search-wrap">${icon('search', 'icon-16')}<input type="text" class="f-search" id="adminBuscarRecibos" aria-label="Buscar empleado" placeholder="Buscar empleado…" oninput="_filtrarTablaRecibosAdmin()" /></div>
      <select class="admin-input" id="adminFiltroEmpresaRecibos" aria-label="Filtrar por empresa" style="max-width:220px" onchange="_recibosAdminFiltro.empresa=this.value;renderRecibosAdminTab();">
        <option value="">Todas las empresas</option>
        ${empresasDisponibles.map(e => `<option value="${e.replace(/"/g, '&quot;')}" ${_recibosAdminFiltro.empresa === e ? 'selected' : ''}>${e}</option>`).join('')}
      </select>
      <button type="button" class="btn-admin-edit" ${ordenBtnActivo} onclick="_toggleOrdenEmpresaRecibos()">
        Empresa <span style="${flechaStyle}">${icon('chevronDown', 'icon-14')}</span>
      </button>
    </div>
    <div class="dt-wrap"><div class="dt-scroll">
      <table class="dt-table" id="adminTablaRecibos">
        <thead><tr><th>Empleado</th><th>Empresa</th><th class="al-c">${mes1.label}</th><th class="al-c">${mes2.label}</th><th class="al-c"></th></tr></thead>
        <tbody>${filas || '<tr><td colspan="5" style="text-align:center;padding:2.5rem;color:var(--text-muted);font-size:13px">Sin empleados cargados</td></tr>'}</tbody>
      </table>
    </div></div>
  `;

  _cargarEstadoMensualRecibos();
}

// Un solo pedido al backend trae los períodos ACTIVOS de TODOS los
// empleados (ver GET /api/recibos/estado-mensual) — evita N llamadas, una
// por fila, solo para pintar el ✅/-- de los últimos 2 meses.
async function _cargarEstadoMensualRecibos() {
  const [mes1, mes2] = _ultimosDosMesesRecibos();
  const data = await apiRecibos('/estado-mensual', { method: 'GET' });
  if (!data || data.ok !== true) {
    document.querySelectorAll('#adminTablaRecibos tbody tr.dt-clickable td[data-mes]').forEach(td => { td.textContent = '?'; });
    return;
  }
  const porEmpleado = data.por_empleado || {};
  document.querySelectorAll('#adminTablaRecibos tbody tr.dt-clickable').forEach(row => {
    const nombre = row.getAttribute('data-nombre') || '';
    const key = nombre.trim().replace(/\s+/g, ' ').toLowerCase();
    const periodos = porEmpleado[key] || [];
    const c1 = row.querySelector('td[data-mes="0"]');
    const c2 = row.querySelector('td[data-mes="1"]');
    if (c1) c1.textContent = periodos.includes(mes1.periodo) ? '✅' : '--';
    if (c2) c2.textContent = periodos.includes(mes2.periodo) ? '✅' : '--';
  });
}

// Expande la fila (si no lo estaba ya) y abre directo el modal de "Subir
// recibo" — evita el paso intermedio de tocar "Ver recibos" primero cuando
// lo único que se quiere es cargar un recibo nuevo.
function _accesoRapidoAgregarRecibo(nombre, rowId) {
  const fila = document.getElementById(rowId);
  if (!fila) return;
  const yaAbierta = fila.style.display !== 'none' && _recibosFicha && _recibosFicha.nombre === nombre;
  if (!yaAbierta) _toggleRecibosAdminFila(nombre, rowId);
  if (!_recibosFicha || _recibosFicha.nombre !== nombre) return;
  if (!_recibosFicha.nombreLegal) {
    showToast('Falta el nombre legal — completalo en el Perfil antes de subir recibos');
    return;
  }
  _abrirModalRecibo('subir');
}

// Solo una fila expandida a la vez: _renderTabRecibosEmpleado() genera IDs
// fijos (formEmpRecibosListado, formEmpBtnSubirRecibo, etc.) que no pueden
// duplicarse en el DOM — abrir una nueva fila cierra cualquier otra.
function _toggleRecibosAdminFila(nombre, rowId) {
  const fila = document.getElementById(rowId);
  if (!fila) return;
  const yaAbierta = fila.style.display !== 'none';

  document.querySelectorAll('#adminTablaRecibos tbody tr[id^="recAdminFila_"]').forEach(tr => {
    if (tr !== fila) tr.style.display = 'none';
  });

  if (yaAbierta) { fila.style.display = 'none'; return; }

  const emp = obtenerEmpleadosAdmin().find(e => e.nombre === nombre);
  if (!emp) return;

  fila.style.display = '';
  _recibosFicha = { nombre: emp.nombre, nombreLegal: emp.nombre_legal || '', empresa: emp.empresa || '', historial: false, cargado: false, lista: [] };
  const body = document.getElementById(rowId + '_body');
  if (body) body.innerHTML = _renderTabRecibosEmpleado(emp);
  _cargarRecibosEmpleado();
}

function _filtrarTablaRecibosAdmin() {
  const q = (document.getElementById('adminBuscarRecibos')?.value || '').trim().toLowerCase();
  document.querySelectorAll('#adminTablaRecibos tbody tr.dt-clickable').forEach(row => {
    // textContent (no solo data-nombre) para que el apodo también sea buscable.
    const visible = !q || row.textContent.toLowerCase().includes(q);
    row.style.display = visible ? '' : 'none';
    // Ocultar/mostrar también la fila expandida asociada, si existe.
    const next = row.nextElementSibling;
    if (next && next.id && next.id.startsWith('recAdminFila_') && !visible) next.style.display = 'none';
  });
}

function _filtrarTablaCertAdmin() {
  const q     = (document.getElementById('adminBuscarCert')?.value || '').trim().toLowerCase();
  const fTipo = document.getElementById('filtroCertTipo')?.value || '';
  document.querySelectorAll('#adminTablaCerts tbody tr').forEach(row => {
    if (!row.dataset || row.dataset.tipo === undefined) return;
    const okQ    = !q || row.textContent.toLowerCase().includes(q);
    const okTipo = !fTipo || row.dataset.tipo === fTipo;
    row.style.display = (okQ && okTipo) ? '' : 'none';
  });
}
function _limpiarFiltrosCertAdmin() {
  const buscar = document.getElementById('adminBuscarCert'); if (buscar) buscar.value = '';
  const tipo = document.getElementById('filtroCertTipo'); if (tipo) tipo.value = '';
  _filtrarTablaCertAdmin();
}

function abrirSelectorEmpleadoCertificado() {
  const nomMostrarDe = n => { const m = n.match(/^(\d+)\s+(.+)$/); return m ? m[2] : n; };
  const opts = obtenerEmpleadosAdmin()
    .filter(e => e.estado !== 'inactivo')
    .slice()
    .sort((a, b) => nomMostrarDe(a.nombre).localeCompare(nomMostrarDe(b.nombre)))
    .map(e => "<option value=\"" + e.nombre.replace(/"/g, '&quot;') + "\">" + nomMostrarDe(e.nombre) + "</option>")
    .join('');
  const html = `
  <div class="admin-overlay" id="adminOverlay" onclick="cerrarAdmin(event)">
    <div class="admin-panel admin-panel-sm" onclick="event.stopPropagation()">
      <div class="admin-header">
        <div class="admin-titulo">Nuevo certificado</div>
        <button class="detalle-close" onclick="cerrarAdmin()" aria-label="Cerrar">${icon('x','icon-16')}</button>
      </div>
      <div class="admin-form">
        <div class="admin-form-grupo">
          <label class="emp-filtro-label" for="certSelectorEmpleado">Empleado</label>
          <select class="admin-input" id="certSelectorEmpleado">
            <option value="">Elegí un empleado…</option>
            ${opts}
          </select>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:1rem">
          <button class="btn-connect" style="margin:0" onclick="continuarNuevoCertificadoAdmin()">Continuar</button>
          <button class="btn-demo" onclick="cerrarAdmin()">Cancelar</button>
        </div>
      </div>
    </div>
  </div>`;
  montarOverlayAdmin(html);
}

function continuarNuevoCertificadoAdmin() {
  const nombre = document.getElementById('certSelectorEmpleado')?.value;
  if (!nombre) { showToast('Elegí un empleado'); return; }
  abrirFormCertificado(nombre, true);
}

async function eliminarCertificadoAdmin(id) {
  if (!confirm('¿Borrar este certificado?')) return;
  const ok = await borrarCertificado(id);
  if (ok) {
    showToast('✓ Certificado eliminado');
    renderAdminInline();
    const railBtn = document.querySelector("#adminRail .rail-item[onclick*=\"'certificados'\"]");
    if (railBtn) switchAdminTab('certificados', railBtn);
  } else {
    showToast('Error al eliminar');
  }
}

// Filtra la tabla de empleados ya cargada (búsqueda de texto + Sucursal +
// Empresa + Categoría + Estado combinados). Todo client-side, sobre las
// filas que ya arma renderAdminInline — no vuelve a pedir datos.
function _filtrarTablaAdminCombinado() {
  const q      = (document.getElementById('adminBuscarEmp')?.value || '').trim().toLowerCase();
  const fSuc   = document.getElementById('filtroAdminSucursal')?.value || '';
  const fEmp   = document.getElementById('filtroAdminEmpresa')?.value || '';
  const fCat   = document.getElementById('filtroAdminCategoria')?.value || '';
  const fEstado= document.getElementById('filtroAdminEstado')?.value || '';

  document.querySelectorAll('#adminTablaEmps tbody tr').forEach(row => {
    if (!row.dataset || row.dataset.sucursal === undefined) return; // fila de "sin datos"
    const okQ      = !q || row.textContent.toLowerCase().includes(q);
    const okSuc    = !fSuc    || row.dataset.sucursal === fSuc;
    const okEmp    = !fEmp    || row.dataset.empresa === fEmp;
    const okCat    = !fCat    || row.dataset.categoria === fCat;
    const okEstado = !fEstado || row.dataset.estado === fEstado;
    row.style.display = (okQ && okSuc && okEmp && okCat && okEstado) ? '' : 'none';
  });
}

function _limpiarFiltrosAdmin() {
  const buscar = document.getElementById('adminBuscarEmp'); if (buscar) buscar.value = '';
  ['filtroAdminSucursal','filtroAdminEmpresa','filtroAdminCategoria','filtroAdminEstado'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  _filtrarTablaAdminCombinado();
}

// ══════════════════════════════════════════════════════
//  AJUSTE DE JORNADA — Fase 3 (conectado a backend real)
//  Fuente de verdad: hoja FICHADAS vía accion=ajustar_jornada (Fase 2, GAS).
//  Lectura: GET /api/fichadas/empleado (Node, Fase 8A; antes GAS
//  accion=get_fichadas_empleado) — devuelve id_fichada/estado.
//  JORNADAS_AJUSTE_CACHE es solo el resultado de la última búsqueda real
//  (para que el modal no tenga que volver a pedirlo al backend) — no es mock.
// ══════════════════════════════════════════════════════

const MOTIVOS_AJUSTE = [
  { id: 'olvido_marcar_entrada',     label: 'Olvidó marcar entrada' },
  { id: 'olvido_marcar_salida',      label: 'Olvidó marcar salida' },
  { id: 'error_de_carga',            label: 'Error de carga' },
  { id: 'cambio_autorizado',         label: 'Cambio autorizado' },
  { id: 'correccion_administrativa', label: 'Corrección administrativa' },
  { id: 'otro',                      label: 'Otro' },
];

let JORNADAS_AJUSTE_CACHE = {}; // key `${empleado}|${fecha}` → última jornada real cargada
let AJUSTES_SESSION       = new Set(); // jornadas ajustadas con éxito en esta sesión (solo para el badge visual)

function _fechaDisplay(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// Agrupa el listado plano de get_fichadas_empleado (una fila por turno) en
// jornadas de 1-2 turnos, ordenando por hora de entrada dentro del día.
function _agruparFichadasEnJornadas(empleado, local, fichadas) {
  const porFecha = {};
  fichadas.forEach(f => {
    (porFecha[f.fecha] = porFecha[f.fecha] || []).push(f);
  });
  return Object.keys(porFecha).map(fecha => {
    const turnos = porFecha[fecha].slice().sort((a, b) => (a.entrada || '').localeCompare(b.entrada || ''));
    const toTurno = f => ({ id_fichada: f.id_fichada, entrada: f.entrada, salida: f.salida, estado: f.estado || 'ACTIVA' });
    return {
      empleado, local, fecha,
      turno1: turnos[0] ? toTurno(turnos[0]) : null,
      turno2: turnos[1] ? toTurno(turnos[1]) : null,
      recupera_horas: turnos.some(f => f.tipo === 'RECUPERO'),
      observacion: turnos.map(f => f.nota).find(n => n) || '',
    };
  });
}

function renderAjusteJornadaTab() {
  const cont = document.getElementById('adminTabAjusteJornada');
  if (!cont) return;

  const empNombres = [...new Set(state.datos.map(r => r.EMPLEADO))].sort((a, b) => {
    const na = parseInt(a) || 999, nb = parseInt(b) || 999;
    return na !== nb ? na - nb : a.localeCompare(b);
  });

  const hoy = new Date();
  const anioActual = hoy.getFullYear();
  const mesActual = hoy.getMonth() + 1;
  const MESES_LBL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  cont.innerHTML =
    "<div class='admin-toolbar' style='flex-wrap:wrap;gap:10px'>" +
      "<input type='text' class='admin-search' id='ajusteBuscarEmp' aria-label='Buscar empleado' list='ajusteEmpList' placeholder='Buscar empleado...' style='min-width:220px' />" +
      "<datalist id='ajusteEmpList'>" + empNombres.map(n => `<option value="${n}">`).join('') + "</datalist>" +
      "<select class='admin-input' id='ajusteMes' aria-label='Mes' style='margin:0;width:auto'>" +
        MESES_LBL.map((m, i) => `<option value="${i + 1}" ${i + 1 === mesActual ? 'selected' : ''}>${m}</option>`).join('') +
      "</select>" +
      "<select class='admin-input' id='ajusteAnio' aria-label='Año' style='margin:0;width:auto'>" +
        [anioActual, anioActual - 1].map(a => `<option value="${a}">${a}</option>`).join('') +
      "</select>" +
      "<button class='btn-connect' style='margin:0;width:auto;padding:8px 18px;font-size:13px' onclick='buscarJornadasAjuste()'>" + icon('search', 'icon-14') + " Buscar</button>" +
    "</div>" +
    "<div id='ajusteResultados' style='margin-top:1rem'>" +
      "<div class='ajuste-empty-state'>" + icon('fileText', 'icon-48') + "<p class='text-secondary'>Buscá un empleado y un período para ver sus jornadas.</p></div>" +
    "</div>";
}

