// ── DÍAS DE VACACIONES (ex "Banco de días", tab Administración) ──────
// Barrida final GAS→Node (2026-09-18): antes pegaba directo a
// accion=get_vacaciones. Ahora usa apiVacaciones() (JWT automático).
async function cargarBancoDias() {
  const container = document.getElementById('adminTabDiasVacaciones');
  if (!container) return;
  container.innerHTML = '<div style="padding:1.5rem"><p style="color:var(--text-muted);font-size:13px">Cargando...</p></div>';
  const anio = new Date().getFullYear();
  try {
    const json = await apiVacaciones('/banco' + _qsVacaciones({ anio }), { method: 'GET' });
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
      const suc       = SUCURSALES_TODAS.find(function(s) { return s.id === local; }) || { nombre: '—', color: '#94a3b8', colorLight: '#f1f5f9' };
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
          '<label style="font-size:13px;color:var(--text-secondary);font-weight:500" for="bancoDiasAnioSelect">Año:</label>' +
          '<select class="filter-select" id="bancoDiasAnioSelect" onchange="cargarBancoDiasAnio(parseInt(this.value))">' + anioOpts + '</select>' +
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
  const container = document.getElementById('adminTabDiasVacaciones');
  if (!container) return;
  container.innerHTML = '<div style="padding:1.5rem"><p style="color:var(--text-muted);font-size:13px">Cargando...</p></div>';
  try {
    const json = await apiVacaciones('/banco' + _qsVacaciones({ anio }), { method: 'GET' });
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
      const suc       = SUCURSALES_TODAS.find(function(s) { return s.id === local; }) || { nombre: '—', color: '#94a3b8', colorLight: '#f1f5f9' };
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
          '<label style="font-size:13px;color:var(--text-secondary);font-weight:500" for="bancoDiasAnioSelect">Año:</label>' +
          '<select class="filter-select" id="bancoDiasAnioSelect" onchange="cargarBancoDiasAnio(parseInt(this.value))">' + anioOpts + '</select>' +
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

// ── BANCO DE HORAS (tab Administración) ───────────────

async function cargarBancoHorasAdmin() {
  const container = document.getElementById('adminTabBancoHoras');
  if (!container) return;
  container.innerHTML = '<div style="padding:1.5rem"><p style="color:var(--text-muted);font-size:13px">Cargando...</p></div>';
  try {
    // Antes: accion=get_banco_horas_todos (GAS). Ahora croma-backend (JWT admin/jefe/horarios).
    const json = await apiBancoHoras('', { method: 'GET' });
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
      const suc    = SUCURSALES_TODAS.find(function(s) { return s.id === local; }) || { nombre: '—', color: '#94a3b8', colorLight: '#f1f5f9' };
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
    // Antes: accion=get_banco_horas (GAS). Ahora croma-backend: para rol empleado el
    // servidor usa SIEMPRE la identidad del JWT y ignora ?empleado=.
    const json = await apiBancoHoras('/empleado?empleado=' + encodeURIComponent(nombreEmp), { method: 'GET' });
    if (!json.ok) throw new Error(json.error || 'Error');
    container.innerHTML = renderBancoHorasHTML(json);
    // Sincroniza la tarjeta "Saldo banco" de Inicio, si está montada (Portal Empleado).
    const inicioBancoEl = document.getElementById('inicioBanco');
    if (inicioBancoEl && typeof json.saldo_hs === 'number') inicioBancoEl.textContent = json.saldo_hs.toFixed(1) + ' hs';
  } catch(e) {
    container.innerHTML = '<p style="color:#dc2626;font-size:13px">Error: ' + e.message + '</p>';
  }
}

async function cargarBancoHorasDetalleAdmin(nombreEmp) {
  const container = document.getElementById('bancoHorasAdminContent_inner');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--text-muted);font-size:13px">Cargando...</p>';
  try {
    const json = await apiBancoHoras('/empleado?empleado=' + encodeURIComponent(nombreEmp), { method: 'GET' });
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
          '<td style="font-size:12px;color:var(--text-secondary)">' + (m.concepto || '—') + '</td>' +
          '<td style="font-size:12px;color:var(--text-muted)">' + (m.fecha_referencia || '—') + '</td>' +
        '</tr>';
      }).join('')
    : '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:1.5rem;font-size:13px">Sin movimientos</td></tr>';

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

// Fecha en la que un anuncio deja de estar vigente (mismo criterio que
// anuncioVencido, extraído acá para poder medir CUÁNTOS días lleva
// vencido, no solo si lo está). null = sin fecha, nunca vence.
function _fechaVencimientoAnuncio(a) {
  if (a.vigencia) return a.vigencia;
  if (a.fecha) {
    const d = new Date(a.fecha.substring(0, 10));
    d.setDate(d.getDate() + 30);
    return d.toISOString().substring(0, 10);
  }
  return null;
}

// Pedido explícito: un anuncio vencido sigue mostrándose (tag "Vencido")
// un día más para que no desaparezca de golpe el mismo día que vence —
// recién a partir del segundo día vencido se saca de la lista.
function anuncioVencidoHaceMasDeUnDia(a) {
  const fechaVence = _fechaVencimientoAnuncio(a);
  if (!fechaVence) return false;
  // Fechas puras (UTC medianoche las dos), nunca la hora actual — si no,
  // la diferencia se infla según qué hora del día es "hoy" y esto se
  // dispara antes de tiempo (bug real, encontrado al probar este mismo
  // fix: a la tarde ya contaba como "2 días" un vencimiento de ayer).
  const hoy = new Date().toISOString().substring(0, 10);
  const dias = Math.round((Date.parse(hoy + 'T00:00:00Z') - Date.parse(fechaVence + 'T00:00:00Z')) / 86400000);
  return dias > 1;
}

