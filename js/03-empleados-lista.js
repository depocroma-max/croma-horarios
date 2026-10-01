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
  if (selLocal !== 'all') datosFilt = datosFilt.filter(r => (EMPLEADOS_PERFILES[r.EMPLEADO]?.sucursal_id || r.LOCAL) === selLocal);
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
    ...SUCURSALES_TODAS.map(s =>
      `<option value="${s.id}" ${s.id === selLocal ? 'selected' : ''}>${s.nombre}</option>`
    )].join('');

  const empOpts = [`<option value="all">Todos los empleados</option>`,
    ...empsDisp.map(e => {
      const numMatch = e.match(/^(\d+)\s+(.+)$/);
      const label = numMatch ? `#${numMatch[1]} ${numMatch[2]}` : e;
      const apodo = EMPLEADOS_PERFILES[e]?.apodo;
      return `<option value="${e}" ${e === selEmp ? 'selected' : ''}>${label}${apodo ? ' — ' + apodo : ''}</option>`;
    })].join('');

  // Grilla de tarjetas (cuando no hay empleado específico)
  const suc = (id) => SUCURSALES_TODAS.find(s => s.id === id) || { color: '#888', colorLight: '#eee', nombre: id };

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
                      empresa: perfil.empresa || '—', categoria: cat?.nombre || '—', foto_url: perfil.foto_url || '', apodo: perfil.apodo || '',
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
  const puedeGestionar = sesionActual?.rol === 'admin' || sesionActual?.rol === 'horarios';

  const buildEmpCard = (e, inactivo) => {
    const s = suc(e.suc);
    const numMatch = e.nombre.match(/^(\d+)\s+(.+)$/);
    const numVend  = numMatch ? numMatch[1] : '';
    const nomMostrar = numMatch ? numMatch[2] : e.nombre;
    // Nombre legal si ya está cargado; si no, el operativo de siempre —
    // la tarjeta nunca se queda sin nombre.
    const nombreLegal = getNombresLegales()[_normalizarNombreEmpleadoJS(e.nombre)] || '';
    const nombreParaMostrar = nombreLegal || nomMostrar;
    const nombrePartes = nombreParaMostrar.split(' ');
    const iniciales = nombrePartes.slice(0,2).map(p => p[0]?.toUpperCase()).join('');

    // Avatar: foto o iniciales
    const avatarInner = e.foto_url
      ? `<img src="${e.foto_url}" alt="${nombreParaMostrar}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" onerror="this.parentElement.innerHTML='${iniciales}'">`
      : (numVend ? `<span class="emp-num-vend">${numVend}</span>` : iniciales);

    // Badge empresa
    const empresaBadge = e.empresa && e.empresa !== '—'
      ? `<span class="emp-empresa-badge ${e.empresa === 'MOSHE SRL' ? 'badge-moshe' : 'badge-cromawave'}">${e.empresa}</span>`
      : '';
    // Badge categoría
    const catBadge = e.categoria && e.categoria !== '—'
      ? `<span class="emp-cat-badge">${e.categoria}</span>`
      : '';

    // WhatsApp: celular del empleado (EMPLEADOS.CELULAR — fuente prioritaria
    // desde el Commit 3, ver ADMINISTRACIÓN UNIFICADA). Antes salía de la
    // lista de usuarios (requería estar logueado como admin); ahora sale de
    // EMPLEADOS_PERFILES, que ya está cargado para cualquier sesión.
    const celular = EMPLEADOS_PERFILES[e.nombre]?.celular;
    const waBtn = celular
      ? `<a href="https://wa.me/549${celular}" target="_blank" onclick="event.stopPropagation()"
           class="wa-btn" title="WhatsApp de ${nombreParaMostrar}">
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
            <div class="emp-nombre">${nombreParaMostrar}${e.apodo ? ` <span class="badge badge-neutral" style="font-size:10px;padding:1px 7px;vertical-align:middle">${e.apodo}</span>` : ''}</div>
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
        <label class="emp-filtro-label" for="empFiltPeriodo">Período</label>
        <select class="emp-filtro-select" id="empFiltPeriodo" onchange="renderEmpleados(state.datos)">
          ${periodoOpts}
        </select>
      </div>
      <div class="emp-filtro-grupo" style="min-width:130px;flex:1">
        <label class="emp-filtro-label" for="empFiltEmpresa">Empresa</label>
        <select class="emp-filtro-select" id="empFiltEmpresa" onchange="renderEmpleados(state.datos)">
          ${empresaOpts}
        </select>
      </div>
      <div class="emp-filtro-grupo" style="min-width:130px;flex:1">
        <label class="emp-filtro-label" for="empFiltCategoria">Categoría</label>
        <select class="emp-filtro-select" id="empFiltCategoria" onchange="renderEmpleados(state.datos)">
          ${categoriaOpts}
        </select>
      </div>
      <div class="emp-filtro-grupo" style="min-width:120px;flex:1">
        <label class="emp-filtro-label" for="empFiltLocal">Local</label>
        <select class="emp-filtro-select" id="empFiltLocal" onchange="empCambioLocal()">
          ${localOpts}
        </select>
      </div>
      <div class="emp-filtro-grupo" style="min-width:140px;flex:2">
        <label class="emp-filtro-label" for="empFiltEmp">Empleado/a</label>
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

// Persistir el estado activo/inactivo del perfil (backend + sessionStorage) y re-render.
// Fase 6A: ya no pasa por guardar_perfil (GAS público, sin auth, retirado) —
// usa PUT /api/empleados/:nombre (editar_empleado, JWT admin/jefe), que solo
// pisa el campo ESTADO (y su espejo ACTIVO) y preserva el resto del perfil.
// No confundir con PATCH /acceso/estado (accionDesactivarAcceso más abajo):
// eso es si el empleado puede loguearse, esto es si sigue trabajando.
async function _setEmpleadoActivo(nombre, activo) {
  const perfil = { ...(EMPLEADOS_PERFILES[nombre] || { nombre }), nombre, activo, _editadoLocal: true };
  EMPLEADOS_PERFILES[nombre] = perfil;
  try {
    const saved = JSON.parse(sessionStorage.getItem('croma_perfiles_locales') || '{}');
    saved[nombre] = perfil;
    sessionStorage.setItem('croma_perfiles_locales', JSON.stringify(saved));
  } catch (e) {}
  const res = await apiEmpleados(`/${encodeURIComponent(nombre)}`, {
    method: 'PUT',
    body: JSON.stringify({ empleado: { estado: activo ? 'activo' : 'inactivo' } }),
  });
  if (!res.ok) showToast('No se pudo guardar: ' + (res.error || 'Error de conexión'));
  if (typeof cerrarDetalle === 'function') cerrarDetalle(); // cerrar overlay de detalle si está abierto
  renderEmpleados(state.datos);
}

function empCambioLocal() {
  // Al cambiar local, resetear empleado y re-renderizar
  renderEmpleados(state.datos);
}

