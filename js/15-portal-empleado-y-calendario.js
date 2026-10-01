// ── NAVEGACIÓN INFERIOR DEL PORTAL EMPLEADO ───────────
// Reemplaza el switchEvTab anterior (tabs superiores). Historial/
// Vacaciones/Banco de horas/Recibos siguen siendo los mismos contenedores
// e IDs de siempre (evTabVacaciones/evTabBancoHoras/evTabRecibos,
// evSelectMes, evTbody, etc.) — solo cambió dónde viven en el layout,
// ninguna función de carga de datos se tocó.
function switchPortalVista(vista, btn) {
  document.querySelectorAll('.emp-vista-personal .portal-bottomnav .portal-bottomnav-item').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  ['Inicio', 'Semana', 'Historial', 'Mas'].forEach(v => {
    const el = document.getElementById('portalVista' + v);
    if (el) el.style.display = v.toLowerCase() === vista ? '' : 'none';
  });
  if (vista === 'mas') switchMasSeccion('lista');
  window.scrollTo(0, 0);
}

function switchMasSeccion(seccion) {
  const listado = document.getElementById('masListado');
  const vac     = document.getElementById('masSeccionVacaciones');
  const banco   = document.getElementById('masSeccionBancoHoras');
  const rec     = document.getElementById('masSeccionRecibos');
  [listado, vac, banco, rec].forEach(el => { if (el) el.style.display = 'none'; });
  if (seccion === 'lista' && listado) { listado.style.display = ''; return; }
  if (seccion === 'vacaciones' && vac) vac.style.display = '';
  if (seccion === 'bancoHoras' && banco) banco.style.display = '';
  if (seccion === 'recibos' && rec) {
    rec.style.display = '';
    _cargarRecibosPortal();
  }
}

// ══════════════════════════════════════════════════════
//  RECIBOS — PORTAL EMPLEADO (Fase 3, Commit 6)
//  Autoservicio: solo lo propio. La identidad SIEMPRE la resuelve el
//  backend vía resolverEmpleadoAutenticado() a partir del JWT — este
//  código nunca manda nombre/empresa/usuario, solo pide GET /mi-perfil
//  (sin parámetros) y, para descargar, el ID del recibo. Estado propio
//  (_recibosPortal), separado a propósito de _recibosFicha (admin): son
//  contextos y permisos distintos, no deben compartir caché.
// ══════════════════════════════════════════════════════
let _recibosPortal = null;   // { cargado: boolean, lista: [] } — se recrea en cada render del Portal
let _recibosPortalGen = 0;   // token de la consulta en vuelo — descarta respuestas obsoletas

function _cargarRecibosPortal(forzar) {
  if (!_recibosPortal) return;
  if (_recibosPortal.cargado && !forzar) return;
  _recibosPortal.cargado = true;
  _fetchRecibosPortal();
}

function _recargarRecibosPortal() {
  if (_recibosPortal) _cargarRecibosPortal(true);
}

// Mensajes fijos por código HTTP — nunca se muestra el mensaje crudo del
// backend ni un código interno. _msgApi() (compatibilidad ya documentada
// en app.js) no se usa acá porque necesitamos el status HTTP, que ese
// shim no expone.
function _mensajeErrorRecibosPortal(status) {
  const MAPA = {
    401: 'Tu sesión venció. Volvé a iniciar sesión.',
    403: 'No tenés permiso para acceder a esta sección.',
    404: 'El recibo no está disponible.',
    409: 'No se pudo validar tu identidad. Volvé a iniciar sesión.',
    503: 'El servicio está temporalmente no disponible. Probá nuevamente.',
  };
  return MAPA[status] || 'No pudimos cargar tus recibos.';
}

// fetch crudo (no _apiFetch) porque necesitamos el status HTTP para el
// mapeo de mensajes — mismo motivo por el que _fichadasDescargar()/
// _recibosDescargarAdmin() ya evitan _apiFetch.
async function _fetchRecibosPortalRaw() {
  const resp = await fetch(`${BACKEND_URL}/api/recibos/mi-perfil`, {
    headers: { 'Authorization': `Bearer ${_getToken()}` },
  });
  let data = null;
  try { data = await resp.json(); } catch (e) {}
  return { status: resp.status, ok: resp.ok, data };
}

async function _fetchRecibosPortal() {
  const cont = document.getElementById('portalRecibosContenido');
  if (!cont || !_recibosPortal) return;
  cont.innerHTML = "<div class='ajuste-empty-state'><div class='spinner' role='status' aria-label='Cargando'></div><p class='text-secondary'>Cargando tus recibos…</p></div>";

  const gen = ++_recibosPortalGen;
  const sesionAlPedir = sesionActual;
  let resultado;
  try {
    resultado = await _fetchRecibosPortalRaw();
  } catch (e) {
    resultado = { status: 0, ok: false, data: null };
  }

  // Descartar si mientras esperábamos: se cerró sesión o se inició otra
  // (sesionActual se reemplaza siempre por un objeto nuevo, nunca se
  // muta — comparar por referencia alcanza), o si una consulta más nueva
  // (recarga manual repetida) ya actualizó el token de generación.
  if (gen !== _recibosPortalGen) return;
  if (sesionActual !== sesionAlPedir || !_recibosPortal) return;
  if (!document.getElementById('portalRecibosContenido')) return;

  if (!resultado.ok || !resultado.data || resultado.data.ok !== true) {
    _mostrarErrorRecibosPortal(_mensajeErrorRecibosPortal(resultado.status));
    return;
  }
  _recibosPortal.lista = resultado.data.recibos || [];
  _renderListadoRecibosPortal();
}

function _mostrarErrorRecibosPortal(mensaje) {
  const cont = document.getElementById('portalRecibosContenido');
  if (!cont) return;
  cont.innerHTML = `<div class="alert alert-danger" style="font-size:12.5px">${icon('alertTriangle','icon-16')} ${mensaje}</div>`;
}

// El backend ya filtra solo ACTIVO y nunca incluye historial de
// reemplazados para este endpoint (ver GET /recibos/mi-perfil en
// croma-backend) — acá solo se ordena por prolijidad/defensa adicional.
function _renderListadoRecibosPortal() {
  const cont = document.getElementById('portalRecibosContenido');
  if (!cont || !_recibosPortal) return;

  const lista = (_recibosPortal.lista || []).slice().sort((a, b) => {
    if (a.periodo !== b.periodo) return a.periodo < b.periodo ? 1 : -1;
    return (b.version || 0) - (a.version || 0);
  });

  if (lista.length === 0) {
    cont.innerHTML = `<div class="ajuste-empty-state">${icon('fileText','icon-48')}<p class="text-secondary" style="font-weight:600;color:#1e293b;margin:0">Todavía no tenés recibos disponibles</p><p class="text-secondary" style="margin:0">Cuando se publique un recibo de sueldo, vas a poder verlo y descargarlo desde acá.</p></div>`;
    return;
  }

  const filasDesktop = lista.map(r => {
    const idEnc = String(r.id).replace(/'/g, "\\'");
    const archivoEsc = String(r.nombre_archivo || '').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const versionTxt = r.version > 1 ? `<div style="font-size:11px;color:var(--text-muted)">v${r.version}</div>` : '';
    return `<tr>
      <td>${_formatearPeriodoRecibo(r.periodo)}${versionTxt}</td>
      <td>${r.empresa || '—'}</td>
      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${archivoEsc}">${archivoEsc}</td>
      <td>${_formatearFechaRecibo(r.fecha_subida)}</td>
      <td style="text-align:center"><button class="btn-detalle-accion" type="button" onclick="_recibosPortalDescargar('${idEnc}', this)">${icon('download','icon-14')} Descargar</button></td>
    </tr>`;
  }).join('');

  const cardsMobile = lista.map(r => {
    const idEnc = String(r.id).replace(/'/g, "\\'");
    const archivoEsc = String(r.nombre_archivo || '').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const versionTxt = r.version > 1 ? ` · v${r.version}` : '';
    return `<div class="ev-card">
      <div class="ev-card-top">
        <div class="ev-card-fecha">
          <span class="ev-card-dia-sem">${r.empresa || ''}</span>
          <span class="ev-card-fecha-str">${_formatearPeriodoRecibo(r.periodo)}${versionTxt}</span>
        </div>
      </div>
      <div style="font-size:12px;color:#666660;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${archivoEsc}">${archivoEsc}</div>
      <div style="font-size:11px;color:#a0a09a;margin-top:2px">Publicado ${_formatearFechaRecibo(r.fecha_subida)}</div>
      <button class="btn-detalle-accion" type="button" style="width:100%;justify-content:center;margin-top:8px" onclick="_recibosPortalDescargar('${idEnc}', this)">${icon('download','icon-14')} Descargar</button>
    </div>`;
  }).join('');

  cont.innerHTML = `
    <div class="detalle-tabla-wrap ev-tabla-desktop">
      <table class="detalle-tabla">
        <thead><tr><th>Período</th><th>Empresa</th><th>Archivo</th><th>Publicado</th><th style="text-align:center">Acción</th></tr></thead>
        <tbody>${filasDesktop}</tbody>
      </table>
    </div>
    <div class="ev-cards-mobile">${cardsMobile}</div>
  `;
}

// Bloquea solo el botón clickeado (evita doble descarga concurrente del
// mismo archivo); nunca guarda base64/blob en estado ni en storage; no
// loguea contenido ni URLs; nunca expone el ID en el mensaje de error.
async function _recibosPortalDescargar(id, btn) {
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  // Feedback visual mientras dura el pedido — sin esto el botón queda
  // disabled pero se ve igual, y con GAS/Drive lentos el empleado piensa
  // que no pasó nada y prueba de nuevo en otro botón o recarga la página,
  // generando pedidos de más en paralelo.
  const textoOriginal = btn.innerHTML;
  btn.innerHTML = `<span class="spinner" style="width:14px;height:14px;display:inline-block;vertical-align:-2px"></span> Descargando…`;
  try {
    const resp = await fetch(`${BACKEND_URL}/api/recibos/mi-perfil/${encodeURIComponent(id)}/descargar`, {
      headers: { 'Authorization': `Bearer ${_getToken()}` },
    });
    if (!resp.ok) {
      showToast(_mensajeErrorRecibosPortal(resp.status));
      return;
    }
    const contentType = resp.headers.get('Content-Type') || '';
    if (!contentType.includes('application/pdf')) {
      showToast('El recibo no está disponible.');
      return;
    }
    const blob = await resp.blob();
    const cd = resp.headers.get('Content-Disposition') || '';
    const esAdjunto = /attachment/i.test(cd);
    const nombreArchivo = (cd.match(/filename="(.+)"/) || [])[1] || 'recibo.pdf';
    const url = URL.createObjectURL(blob);
    if (esAdjunto) {
      const a = document.createElement('a');
      a.href = url;
      a.download = nombreArchivo;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else {
      window.open(url, '_blank');
    }
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast('No pudimos cargar tus recibos.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = textoOriginal;
  }
}

// ══════════════════════════════════════════════════════
//  CAMPANA DE NOTIFICACIONES
// ══════════════════════════════════════════════════════

// Barrida final GAS→Node (2026-09-18): antes pegaba directo a
// accion=get_solicitudes_vac. Ahora usa apiVacaciones() (JWT automático).
async function actualizarBadgeCampana() {
  try {
    const json = await apiVacaciones('/solicitudes' + _qsVacaciones({ estado: 'pendiente' }), { method: 'GET' });
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
  apiVacaciones('/solicitudes' + _qsVacaciones({ estado: 'pendiente' }), { method: 'GET' })
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
            '<div style="font-size:11px;color:var(--text-secondary)">' + formatFechaISO(s.fecha_desde) + ' - ' + formatFechaISO(s.fecha_hasta) + ' · ' + s.dias + ' días</div>' +
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
    const json = await apiVacaciones('/solicitudes' + _qsVacaciones({ empleado: nombreEmp }), { method: 'GET' });
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
  apiVacaciones('/solicitudes' + _qsVacaciones({ empleado: nombre }), { method: 'GET' })
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
          '<div style="font-size:11px;color:var(--text-secondary)">' + s.dias + ' dias</div>' +
          (s.nota_admin ? '<div style="font-size:11px;color:var(--text-muted)">' + esc(s.nota_admin) + '</div>' : '') + '</div>' +
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
    container.innerHTML = '<div style="padding:1.5rem"><p style="color:var(--text-muted);font-size:13px">Cargando...</p></div>';
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
    SUCURSALES_TODAS.map(function(s) {
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
      const suc   = SUCURSALES_TODAS.find(function(x) { return x.id === local; }) || { color: '#94a3b8', colorLight: '#f1f5f9' };
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
      return '<div class="cal-vac-evento' + (vencido ? ' cal-vac-evento-vencido' : '') + '" title="' + esc(ev.descripcion) + '" onclick="event.stopPropagation(); eliminarEvento(\'' + ev.id + '\')" style="cursor:pointer">' +
        '<span style="display:inline-flex;font-size:9px">' + icon(vencido ? 'fileText' : 'mapPin', 'icon-12') + '</span>' +
        '<span style="font-size:9px;font-weight:600;color:' + (vencido ? '#94a3b8' : '#7c3aed') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(ev.titulo) + (vencido ? ' (Vencido)' : '') + '</span>' +
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
    const suc   = SUCURSALES_TODAS.find(function(x) { return x.id === local; }) || { nombre: local, color: '#94a3b8', colorLight: '#f1f5f9' };
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
  }).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:1.5rem;font-size:13px">Sin solicitudes en este mes</td></tr>';

  const headersSem = diasSem.map(function(d) { return '<div class="cal-vac-header">' + d + '</div>'; }).join('');

  container.innerHTML =
    '<div style="padding:1.5rem">' +
    '<div class="cal-vac-wrap">' +
    // Toolbar
    '<div class="cal-vac-toolbar">' +
      '<div class="cal-vac-nav">' +
        '<button class="week-btn" onclick="cambiarMesCalVac(-1)">&#8592;</button>' +
        '<select class="filter-select" id="calVacMesSelect" aria-label="Mes" style="font-size:14px;font-weight:600;background:transparent;border:none;box-shadow:none" onchange="_calVacMes=parseInt(this.value);cargarCalendarioVacaciones()">' + mesOpts + '</select>' +
        '<select class="filter-select" id="calVacAnioSelect" aria-label="Año" style="font-size:14px;font-weight:600;width:78px;background:transparent;border:none;box-shadow:none" onchange="_calVacAnio=parseInt(this.value);cargarCalendarioVacaciones()">' + anioOpts + '</select>' +
        '<button class="week-btn" onclick="cambiarMesCalVac(1)">&#8594;</button>' +
      '</div>' +
      '<select class="filter-select" id="calVacFiltroLocalSelect" aria-label="Filtrar por local" style="font-size:13px" onchange="_calVacFiltroLocal=this.value;cargarCalendarioVacaciones()">' + sucOpts + '</select>' +
      // "Nuevo evento" (sistema viejo) jubilado a favor del panel Avisos —
      // ver avisosProvider Etapa 6/9. Botón oculto, no borrado: revertir
      // es solo restaurar esta línea.
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

// Barrida final GAS→Node (2026-09-18): antes pegaba directo a
// accion=get_eventos (GAS, doGet, sin auth). Ahora usa apiEventos() (JWT
// automático). Shape de respuesta sin cambios ({ok,eventos}).
async function cargarEventos(force) {
  if (!force && _eventosCache !== null) return _eventosCache;
  try {
    const json = await apiEventos('', { method: 'GET' });
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
  const usuarios = (await _asegurarUsuariosAdmin()).filter(function(u) { return u.rol === 'empleado' && u.empleadoNombre && u.estado !== 'inactivo'; });
  const hoy = new Date().toISOString().substring(0,10);
  const fechaVal = fechaPreset || hoy;

  const sucCheckboxes = SUCURSALES.map(function(s) {
    return '<label style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f1f5f9;cursor:pointer">' +
      '<input type="checkbox" class="evento-suc-cb" name="eventoSucursales" value="suc_' + s.id + '" style="width:16px;height:16px;accent-color:#7c3aed" />' +
      '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + s.color + ';flex-shrink:0"></span>' +
      '<span style="font-size:13px;color:#374151">' + s.nombre + '</span>' +
    '</label>';
  }).join('');

  const empOpts = usuarios.map(function(u) {
    const nom = u.empleadoNombre.replace(/^\d+\s+/,'');
    return '<label style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f1f5f9;cursor:pointer">' +
      '<input type="checkbox" class="evento-dest-cb" name="eventoDestinatarios" value="' + u.empleadoNombre + '" style="width:16px;height:16px;accent-color:#7c3aed" />' +
      '<span style="font-size:13px;color:#374151">' + nom + '</span>' +
    '</label>';
  }).join('');

  const html = `
  <div class="admin-overlay" id="adminOverlay" onclick="cerrarAdmin(event)">
    <div class="admin-panel admin-panel-sm" onclick="event.stopPropagation()">
      <div class="admin-header">
        <div class="admin-titulo">Nuevo evento</div>
        <button class="detalle-close" onclick="cerrarAdmin()" aria-label="Cerrar">${icon('x','icon-16')}</button>
      </div>
      <div class="admin-form" style="gap:14px">

        <div class="admin-form-grupo">
          <label class="emp-filtro-label" for="eventoTitulo">Título del evento *</label>
          <input type="text" class="admin-input" id="eventoTitulo" placeholder="Ej: Reunión de personal, Capacitación..." maxlength="80" />
        </div>

        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Fecha *</label>
          <div style="display:flex;gap:10px;align-items:center">
            <div style="flex:1">
              <div style="font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Desde</div>
              <input type="date" class="admin-input" id="eventoFecha" aria-label="Fecha desde" value="${fechaVal}" onchange="eventoFechaDesdeChange()" style="margin:0" />
            </div>
            <div style="flex:1">
              <div style="font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Hasta</div>
              <input type="date" class="admin-input" id="eventoFechaFin" aria-label="Fecha hasta" value="${fechaVal}" style="margin:0" />
            </div>
          </div>
        </div>

        <div class="admin-form-grupo">
          <label class="emp-filtro-label" for="eventoDesc">Descripción (opcional)</label>
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
            ${empOpts || '<p style="font-size:12px;color:var(--text-muted);padding:8px 0">No hay empleados con usuario configurado</p>'}
          </div>
        </div>

        <div class="admin-form-grupo" style="background:#fff0f0;border-radius:10px;padding:12px;border:1px solid #fecaca">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="eventoLocalCerrado" style="width:16px;height:16px;accent-color:#dc2626" onchange="toggleLocalCerrado(this.checked)" />
            <span style="font-size:13px;font-weight:600;color:#dc2626"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:currentColor;margin-right:6px"></span>Local cerrado</span>
          </label>
          <span style="font-size:11px;color:var(--text-muted);margin-top:4px;display:block">Los empleados verán "LOCAL CERRADO" en su semana en vez de "Libre"</span>
        </div>

        <div class="admin-form-grupo" style="background:#f8fafc;border-radius:10px;padding:12px;border:1px solid #e2e8f0">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="eventoConAnuncio" style="width:16px;height:16px;accent-color:#7c3aed" onchange="toggleEventoAnuncio(this.checked)" />
            <span style="font-size:13px;font-weight:500;color:#374151">${icon('bell','icon-14')} Enviar también como anuncio</span>
          </label>
          <span style="font-size:11px;color:var(--text-muted);margin-top:4px;display:block">El evento aparecerá en el calendario Y como notificación al empleado</span>
          <div id="eventoAnuncioWrap" style="display:none;margin-top:10px">
            <input type="text" class="admin-input" id="eventoAnuncioMsg" aria-label="Mensaje adicional del anuncio" placeholder="Mensaje adicional del anuncio (opcional)" />
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
                '<div style="font-size:13px;font-weight:600;color:#0369a1;display:flex;align-items:center;gap:6px">' + icon('mail','icon-14') + ' Notificar a Administración</div>' +
                '<div style="font-size:11px;color:var(--text-secondary);margin-top:2px">' + lista + '</div>' +
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
  // Fase 6C.2 (corregido post-QA): el endpoint Node no acepta una lista de
  // emails — solo la intención (booleano). El backend resuelve los
  // contactos server-side desde CONFIG.emails_contactos, nunca desde acá.
  const notificarContactos = !!document.getElementById('eventoEmailAdmins')?.checked;

  try {
    const tipo  = document.getElementById('eventoLocalCerrado')?.checked ? 'local_cerrado' : '';
    const json = await apiEventos('', {
      method: 'POST',
      body: JSON.stringify({ titulo, fecha, fecha_fin: fechaFin, descripcion: desc, destinatarios, tipo, notificar_contactos: notificarContactos }),
    });
    if (!json.ok) throw new Error(json.error || 'Error');

    // Si también es anuncio, guardarlo en paralelo
    if (conAnuncio) {
      const msgAnuncio = anuncioMsg || titulo + (desc ? ': ' + desc : '');
      let destsAnuncio = [];
      if (destTipo === 'especifico') {
        destsAnuncio = JSON.parse(destinatarios);
      } else if (destTipo === 'sucursal') {
        const sucIds = destinatarios.startsWith('[') ? JSON.parse(destinatarios).map(s => s.replace('suc_','')) : [destinatarios.replace('suc_','')];
        destsAnuncio = (await _asegurarUsuariosAdmin()).filter(function(u) {
          if (u.rol !== 'empleado' || !u.empleadoNombre || u.estado === 'inactivo') return false;
          const perfil = EMPLEADOS_PERFILES[u.empleadoNombre] || {};
          const sucId  = perfil.sucursal_id || (state.datos.find(function(r) { return r.EMPLEADO === u.empleadoNombre; }) || {}).LOCAL || '';
          return sucIds.indexOf(sucId) !== -1;
        }).map(function(u) { return u.empleadoNombre; });
      }
      if ((destTipo === 'especifico' || destTipo === 'sucursal') && !destsAnuncio.length) {
        showToast('Evento guardado, pero ningún empleado coincide para el anuncio');
      } else {
        await apiAnuncios('', {
          method: 'POST',
          body: JSON.stringify({
            titulo: '📌 ' + titulo,
            mensaje: msgAnuncio,
            destinatarios: destsAnuncio,
            vigencia: fechaFin, // El anuncio caduca al finalizar el evento
          }),
        });
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
    const json = await apiEventos(`/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!json.ok) throw new Error(json.error || 'Error');
    showToast('✓ Evento eliminado');
    _eventosCache = null;
    cargarCalendarioVacaciones();
  } catch(e) {
    showToast('Error: ' + e.message);
  }
}

// ── Mostrar eventos en Mi semana del empleado ──────────
// NOTA: esta función no tiene invocaciones activas hoy (ver comentario más
// abajo, "queda como variable legacy sin escritor activo") — se migra
// igual, por completitud, para que no quede ningún fetch directo a GAS en
// el archivo aunque el código esté muerto.
var _eventosEmpCache = [];

async function cargarEventosEmpleado(nombreEmp) {
  try {
    const json = await apiEventos('?empleado=' + encodeURIComponent(nombreEmp), { method: 'GET' });
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

// ── Mi Semana + Local Cerrado vía Provider (Etapa 3.4, transición AVISOS) ──
// Cache activa única para renderEventosEnSemana() a partir de esta etapa —
// _eventosEmpCache (arriba) queda como variable legacy sin escritor activo
// (cargarEventosEmpleado ya no se invoca), igual patrón que
// _anunciosTodosCache en la Etapa 3.2. No se mantienen dos caches vivas
// para la misma responsabilidad.
var _eventosEmpProviderCache = [];

// Deliberadamente SIN `rango`: se consulta una sola vez todo lo aplicable
// al empleado (igual que get_eventos&empleado=X hoy) y el filtrado por día/
// semana visible sigue siendo 100% responsabilidad de renderEventosEnSemana()
// y empNavSemana(), sin tocar su lógica — así se preserva el patrón de
// tráfico actual (1 consulta al montar, cero fetches al navegar semanas).
// Ante error del Provider: nunca fallback a get_eventos, nunca se pisa una
// cache válida anterior con un resultado vacío — si nunca hubo carga
// exitosa, _eventosEmpProviderCache simplemente queda en su default []
// (ya manejado sin romper nada por renderEventosEnSemana, que corta temprano
// si length===0). Error registrado por consola (diagnóstico), nunca alert().
async function cargarEventosViaProvider(nombreEmp, sucursalId) {
  try {
    const resp = await CromaAvisosProvider.consultar({ empleado: nombreEmp, sucursalId: sucursalId });
    if (!resp.ok) {
      console.warn('cargarEventosViaProvider: Provider no disponible, se conserva la última cache válida.', resp.error);
      return;
    }
    const paraSemana = resp.items.filter(function (item) {
      return item.superficies.calendario === true;
    });
    _eventosEmpProviderCache = paraSemana.map(function (item) {
      return {
        id: item.id,
        titulo: item.titulo,
        fecha: item.fechaDesde,
        fecha_fin: item.fechaHasta,
        descripcion: item.mensaje,
        tipo: item.tipo,
      };
    });
    renderEventosEnSemana(nombreEmp);
  } catch (e) {
    console.warn('cargarEventosViaProvider: error inesperado, se conserva la última cache válida.', e);
  }
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
  if (!_eventosEmpProviderCache.length) return;
  // Para cada card de la semana del empleado, inyectar eventos del día
  const lunes = getLunes(_empSemanaOffset);
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  for (let i = 0; i < 7; i++) {
    const f = new Date(lunes); f.setDate(lunes.getDate() + i);
    const isoFecha = f.getFullYear() + '-' + String(f.getMonth()+1).padStart(2,'0') + '-' + String(f.getDate()).padStart(2,'0');
    const eventosDelDia = _eventosEmpProviderCache.filter(function(ev) {
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
          if (freeEl) freeEl.innerHTML = '<span class="portal-week-cerrado"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:currentColor;margin-right:5px"></span>Local cerrado</span>';
        }
        const evHtml = eventosDelDia.map(function(ev) {
          if (ev.tipo === 'local_cerrado') return ''; // ya se muestra en el header
          const vencido = isoFecha < hoy.toISOString().substring(0,10);
          const icsBtn = '<button class="evento-ics-btn" onclick="descargarICS(' + JSON.stringify(ev).replace(/'/g,"&#39;") + ')" title="Agregar a mi calendario">' + icon('calendar','icon-14') + '</button>';
          return '<div class="evento-semana-chip' + (vencido ? ' evento-semana-chip-vencido' : '') + '">' +
            '<span class="evento-semana-icono">' + icon(vencido ? 'fileText' : 'mapPin', 'icon-14') + '</span>' +
            '<div style="flex:1">' +
              '<div class="evento-semana-titulo">' + esc(ev.titulo) + (vencido ? ' <span style="font-weight:400;color:var(--text-muted);font-size:10px">(Vencido)</span>' : '') + '</div>' +
              (ev.descripcion ? '<div class="evento-semana-desc">' + esc(ev.descripcion) + '</div>' : '') +
            '</div>' +
            icsBtn +
          '</div>';
        }).join('');
        body.insertAdjacentHTML('beforeend', evHtml);
      }
    }
  }
}

// ── "Mi semana" del Portal Empleado: turno planificado (Horario semanal) ──
// Días ya fichados siguen mostrando SIEMPRE lo realmente trabajado (nunca
// el plan, aunque difieran). Para días futuros sin fichar todavía, se
// muestra el turno que cargó el encargado en HORARIOS (incluye el local,
// por si el empleado cubre más de una sucursal esa semana) en vez de
// "Libre" — así el empleado sabe qué turno le toca antes de que llegue el
// día. Confirmado con el usuario: días pasados = lo fichado, futuros = el plan.
const DIAS_KEY_PORTAL = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];

function _normalizarLibreTxtPortal(txt) {
  const v = String(txt || '').trim();
  return v.toUpperCase() === 'FRANCO' ? 'Libre' : v;
}

function _duracionHsBloquePortal(entrada, salida) {
  const eMin = hhmmAMin(entrada), sMin = hhmmAMin(salida);
  if (isNaN(eMin) || isNaN(sMin)) return 0;
  let dur = sMin - eMin;
  if (dur <= 0) dur += 1440; // cruza medianoche
  return dur / 60;
}

// Busca, entre todas las sucursales, el bloque planificado de un empleado
// para un día de la semana. Un empleado puede tener plan en más de una
// sucursal la misma semana (multi-local, ya validado en Horario semanal:
// nunca se pisan en el mismo día — ver _buscarConflictoSuperposicion en
// croma-backend), así que basta con devolver el primero que aparezca.
function _buscarPlanEmpleadoDia(horariosPorSucursal, nombreEmpleado, diaKey) {
  if (!horariosPorSucursal) return null;
  const nombreNorm = String(nombreEmpleado || '').trim().toLowerCase();
  for (const sucursal of Object.keys(horariosPorSucursal)) {
    for (const fila of horariosPorSucursal[sucursal]) {
      if (String(fila.empleado || '').trim().toLowerCase() !== nombreNorm) continue;
      const valor = String(fila[diaKey] || '').trim();
      if (valor && valor.toUpperCase() !== 'LIBRE') return { sucursal, valor };
    }
  }
  return null;
}

// Distingue "esta semana no tiene NINGÚN horario cargado para este
// empleado" (semana vieja, previa a esta función) de "tiene horario pero
// este día puntual está libre" — la primera no permite juzgar match/no
// match (sin color), la segunda sí (fichó un día que estaba libre = amarillo).
function _empleadoApareceEnPlan(horariosPorSucursal, nombreEmpleado) {
  if (!horariosPorSucursal) return false;
  const nombreNorm = String(nombreEmpleado || '').trim().toLowerCase();
  return Object.keys(horariosPorSucursal).some(sucursal =>
    horariosPorSucursal[sucursal].some(fila => String(fila.empleado || '').trim().toLowerCase() === nombreNorm)
  );
}

// "09:00-13:00" o "09:00-13:00 | 17:00-21:00" (turno cortado) → bloques.
// Mismo formato que _parsearBloquesDia() del backend (croma-backend/src/
// services/horarios-semanales.js), reimplementado acá porque es el único
// consumidor client-side de este formato de texto.
function _parsearBloquesTextoPortal(valor) {
  return String(valor || '').split('|').map(p => {
    const partes = p.trim().split('-').map(s => s.trim());
    return { entrada: partes[0] || '', salida: partes[1] || '' };
  }).filter(b => b.entrada);
}

// Mismo concepto de "ventana de gracia" que TOLERANCIA_ATRASO_MIN en el
// motor de En vivo (croma-backend/src/services/envivo.js) — acá aplicado a
// entrada Y salida para decidir si una fichada real "coincide" con el plan.
const TOLERANCIA_MATCH_PORTAL_MIN = 5;

// true = fichó exactamente la cantidad de bloques planificados, cada uno
// con entrada y salida dentro de la tolerancia. Cualquier otra cosa
// (bloque de más/de menos, hora fuera de tolerancia, hora inválida)
// devuelve false — "incompleto", nunca se afirma un match parcial.
function _matchFichadaConPlan(regs, bloquesPlan) {
  if (regs.length !== bloquesPlan.length) return false;
  for (let i = 0; i < bloquesPlan.length; i++) {
    const plan = bloquesPlan[i];
    const real = regs[i];
    const eMinPlan = hhmmAMin(plan.entrada), sMinPlan = hhmmAMin(plan.salida);
    const eMinReal = hhmmAMin(_normalizarLibreTxtPortal(real.H_ENTRADA)), sMinReal = hhmmAMin(_normalizarLibreTxtPortal(real.H_SALIDA));
    if (isNaN(eMinPlan) || isNaN(sMinPlan) || isNaN(eMinReal) || isNaN(sMinReal)) return false;
    if (Math.abs(eMinReal - eMinPlan) > TOLERANCIA_MATCH_PORTAL_MIN) return false;
    if (Math.abs(sMinReal - sMinPlan) > TOLERANCIA_MATCH_PORTAL_MIN) return false;
  }
  return true;
}

// Trae (con caché por semana) el Horario semanal completo y re-renderiza
// el grid de "Mi semana" cuando llega. GET /api/horarios-semanales no
// restringe por rol (cualquier JWT válido, incluido empleado) — confirmado
// en croma-backend/src/routes/horarios-semanales.js.
async function cargarPlanHorarioEmpleado(offset) {
  const semanaId = getSemanaId(offset);
  if (_empPlanHorariosCache[semanaId] === undefined) {
    const data = await apiHorariosSemanales('?semana=' + encodeURIComponent(semanaId));
    _empPlanHorariosCache[semanaId] = (data && data.ok) ? data.horarios : null;
  }
  // Solo re-renderizar si el usuario sigue en la misma semana — evita que
  // una respuesta que tardó pise una navegación más reciente.
  if (getSemanaId(_empSemanaOffset) === semanaId) _renderSemanaEmpleadoGrid();
}

// Única fuente de verdad para las cards de "Mi semana" — antes había dos
// copias casi idénticas de esta lógica (acá y en empNavSemana), una sin
// tocar desde el render inicial y otra desde la navegación de semanas;
// unificadas acá de paso al agregar el plan de HORARIOS.
function _buildSemanaEmpleadoCards() {
  const lunes = getLunes(_empSemanaOffset);
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const diasLargos = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const planSemana = _empPlanHorariosCache[getSemanaId(_empSemanaOffset)];
  const tieneAlgunPlanEsaSemana = _empleadoApareceEnPlan(planSemana, _empPortalActual);
  const cards = [];

  for (let i = 0; i < 7; i++) {
    const f = new Date(lunes); f.setDate(lunes.getDate() + i);
    const fSinHora = new Date(f); fSinHora.setHours(0, 0, 0, 0);
    const regs = _empMisRegistros.filter(r =>
      String(r.AÑO) === String(f.getFullYear()) &&
      r.MES === MESES_ES[f.getMonth()] &&
      String(r.DIA) === String(f.getDate())
    ).sort((a, b) => (a.H_ENTRADA || '').localeCompare(b.H_ENTRADA || ''));
    const total = regs.reduce((a, r) => a + (parseFloat(r.TOTAL_HS) || 0), 0);
    const esHoy = f.toDateString() === new Date().toDateString();

    const planDia = _buscarPlanEmpleadoDia(planSemana, _empPortalActual, DIAS_KEY_PORTAL[i]);
    const bloquesPlanDia = planDia ? _parsearBloquesTextoPortal(planDia.valor) : [];
    // Solo se muestra como "planificado" (dashed, sin fichar todavía) para
    // hoy en adelante — un día pasado sin fichada simplemente quedó libre,
    // no tiene sentido mostrar retroactivamente lo que se había planeado.
    const plan = (!regs.length && fSinHora >= hoy) ? planDia : null;

    const libre = !regs.length && !plan;
    let tipoTurno = '';
    let turnos;

    if (regs.length) {
      turnos = regs.map(r => {
        const ent = _normalizarLibreTxtPortal(r.H_ENTRADA), sal = _normalizarLibreTxtPortal(r.H_SALIDA);
        if (!ent || !sal) return '<span class="portal-week-shift">Horario a confirmar</span>';
        return `<span class="portal-week-shift">${ent} → ${sal}</span>`;
      }).join('');
      // Verde = cubrió el día y coincide con lo planificado (entrada/salida
      // dentro de ±5 min, mismo criterio de tolerancia que "En vivo").
      // Amarillo = fichó pero no coincide (horas de más/menos, falta un
      // bloque del turno cortado, o fichó un día planificado como libre).
      // Sin color = esa semana no tiene NINGÚN horario cargado para este
      // empleado (semana vieja, previa a esta función) — no hay con qué
      // comparar, así que no se afirma nada.
      if (!tieneAlgunPlanEsaSemana) {
        tipoTurno = '';
      } else {
        tipoTurno = _matchFichadaConPlan(regs, bloquesPlanDia) ? 'match' : 'incompleto';
      }
    } else if (plan) {
      turnos = `<span class="portal-week-shift-local">${plan.sucursal}</span>` +
        bloquesPlanDia.map(b => `<span class="portal-week-shift">${b.entrada} → ${b.salida}</span>`).join('');
      if (bloquesPlanDia.length >= 2) tipoTurno = 'cortado';
      else {
        const dur = _duracionHsBloquePortal(bloquesPlanDia[0].entrada, bloquesPlanDia[0].salida);
        if (dur <= 4) tipoTurno = 'media';
        else if (dur >= 7) tipoTurno = 'corrido';
      }
    } else {
      turnos = '<div class="portal-week-free">Libre</div>';
    }

    cards.push(`
      <div class="portal-week-card ${libre ? 'is-free' : ''} ${esHoy ? 'is-today' : ''} ${tipoTurno ? 'turno-' + tipoTurno : ''} ${plan ? 'is-planificado' : ''}">
        <div class="portal-week-day">
          <span>${diasLargos[i]}</span>
          <span class="portal-week-day-num">${f.getDate()}</span>
        </div>
        <div class="portal-week-body">
          ${turnos}
          ${regs.length ? `<small>${total.toFixed(1)} hs</small>` : ''}
        </div>
      </div>`);
  }
  return cards.join('');
}

function _renderSemanaEmpleadoGrid() {
  const grid = document.getElementById('empSemanaGrid');
  if (!grid) return;
  grid.innerHTML = _buildSemanaEmpleadoCards();
  renderEventosEnSemana(_empPortalActual);
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
  // Re-renderizar el grid de la semana — ver _buildSemanaEmpleadoCards()
  // (antes esta función duplicaba esa lógica acá mismo).
  const grid = document.getElementById('empSemanaGrid');
  if (!grid || !_empMisRegistros.length) return;
  _renderSemanaEmpleadoGrid();
  cargarPlanHorarioEmpleado(_empSemanaOffset);
}

var _vacSolicitudesCache = null; // cache: null = no cargado, [] = cargado vacío

async function fetchSolicitudesCache(force) {
  if (!force && _vacSolicitudesCache !== null) return _vacSolicitudesCache;
  try {
    const json = await apiVacaciones('/solicitudes', { method: 'GET' });
    _vacSolicitudesCache = json.ok ? (json.solicitudes || []) : [];
  } catch(e) {
    if (_vacSolicitudesCache === null) _vacSolicitudesCache = [];
  }
  return _vacSolicitudesCache;
}

function renderCalendarioView() {
  const container = document.getElementById('calendarioAdminContainer');
  if (!container) return;

  // "Solicitudes pendientes" (→ tab Solicitudes en Avisos) y "Banco de
  // días"/"Banco de horas" (→ Administración) jubilados de acá — ver
  // avisosProvider Etapa 6/9. Quedan solo Calendario y Anuncios, sin
  // punto de entrada propio en el top bar (Calendario está oculto), pero
  // siguen funcionando para quien llegue por un link interno (campana).
  container.innerHTML =
    '<div class="admin-inline-wrap">' +
    '<div class="admin-tabs" id="vacTabs">' +
      '<button class="admin-tab active" onclick="switchVacTab(\'calendario\',this)">Calendario</button>' +
      '<button class="admin-tab" onclick="switchVacTab(\'anuncios\',this)">Anuncios</button>' +
    '</div>' +
    '<div id="vacCalendarioContainer" class="admin-tab-content">' +
      '<div style="padding:1.5rem"><p style="color:var(--text-muted);font-size:13px">Cargando...</p></div>' +
    '</div>' +
    '<div id="vacAnunciosContainer" class="admin-tab-content" style="display:none">' +
      '<div class="admin-toolbar">' +
        '<span style="font-size:12px;color:var(--text-muted)">Enviá mensajes a tus empleados — aparecen en su pantalla con sonido</span>' +
        // "Nuevo anuncio" (sistema viejo) jubilado a favor del panel Avisos —
        // ver avisosProvider Etapa 6/9. Botón oculto, no borrado.
      '</div>' +
      '<div id="adminAnunciosList"><div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:13px">Cargando...</div></div>' +
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
  if (tab === 'anuncios')    cargarListaAnuncios();
}

