// ── RENDER REPORTES ────────────────────────────────────
function renderReportes(datos) {
  const container = document.getElementById('viewReportes');

  // Armar opciones de período
  const periodos = [...new Set(datos.map(r => `${r.AÑO}||${r.MES}`))].sort((a, b) => {
    const [aY, aM] = a.split('||');
    const [bY, bM] = b.split('||');
    return (parseInt(bY)*12 + MESES_ES.indexOf(bM)) - (parseInt(aY)*12 + MESES_ES.indexOf(aM));
  });

  // Leer filtros del panel de reportes
  const selPeriodo = document.getElementById('repFiltPeriodo')?.value || 'all';
  const selLocal   = document.getElementById('repFiltLocal')?.value   || 'all';

  // Filtrar datos
  let datosFilt = datos;
  if (selPeriodo !== 'all') {
    const [anio, mes] = selPeriodo.split('||');
    datosFilt = datosFilt.filter(r => String(r.AÑO) === anio && r.MES === mes);
  }
  if (selLocal !== 'all') datosFilt = datosFilt.filter(r => r.LOCAL === selLocal);

  const periodoLabel = selPeriodo !== 'all'
    ? selPeriodo.split('||').reverse().join(' ')
    : 'Todos los períodos';

  // ── HORAS POR EMPLEADO (todos, no solo top10) ──
  const horasPorEmp = {};
  datosFilt.forEach(r => {
    if (!horasPorEmp[r.EMPLEADO]) horasPorEmp[r.EMPLEADO] = { horas: 0, local: r.LOCAL };
    horasPorEmp[r.EMPLEADO].horas += parseFloat(r.TOTAL_HS) || 0;
  });
  const listaEmps = Object.entries(horasPorEmp)
    .sort((a, b) => b[1].horas - a[1].horas);
  const maxH = listaEmps[0]?.[1].horas || 1;
  const promH = listaEmps.length ? listaEmps.reduce((a,[,v]) => a + v.horas, 0) / listaEmps.length : 0;

  // ── HORAS Y COBERTURA POR SUCURSAL ──
  const porSuc = {};
  datosFilt.forEach(r => {
    if (!porSuc[r.LOCAL]) porSuc[r.LOCAL] = { emps: new Set(), horas: 0 };
    porSuc[r.LOCAL].emps.add(r.EMPLEADO);
    porSuc[r.LOCAL].horas += parseFloat(r.TOTAL_HS) || 0;
  });
  const maxSucH = Math.max(...SUCURSALES_TODAS.map(s => porSuc[s.id]?.horas || 0)) || 1;

  // Opciones de filtros
  const periodoOpts = [`<option value="all">Todos los períodos</option>`,
    ...periodos.map(p => {
      const [y, m] = p.split('||');
      return `<option value="${p}" ${p === selPeriodo ? 'selected' : ''}>${m} ${y}</option>`;
    })].join('');

  const localOpts = [`<option value="all">Todas las sucursales</option>`,
    ...SUCURSALES_TODAS.map(s =>
      `<option value="${s.id}" ${s.id === selLocal ? 'selected' : ''}>${s.nombre}</option>`
    )].join('');

  const htmlEmps = listaEmps.map(([nombre, d], i) => {
    const s = SUCURSALES_TODAS.find(x => x.id === d.local) || { color: '#888' };
    const numMatch = nombre.match(/^(\d+)\s+(.+)$/);
    const label = numMatch ? `<span style="color:var(--text-muted);font-size:11px">#${numMatch[1]}</span> ${numMatch[2]}` : nombre;
    return `<div class="reporte-row" style="gap:10px">
      <span class="rep-rank">${i+1}</span>
      <span class="reporte-nombre" style="flex:1;min-width:0">${label}</span>
      <div class="reporte-bar-wrap"><div class="reporte-bar" style="width:${(d.horas/maxH*100).toFixed(0)}%;background:${s.color}"></div></div>
      <span class="reporte-val" style="font-size:16px">${d.horas.toFixed(0)}h</span>
    </div>`;
  }).join('') || '<p style="font-size:13px;color:#999;padding:1rem 0">Sin datos</p>';

  const htmlSuc = SUCURSALES
    .filter(s => selLocal === 'all' || s.id === selLocal)
    .map(s => {
      const d = porSuc[s.id] || { emps: new Set(), horas: 0 };
      const pct = (d.horas / maxSucH * 100).toFixed(0);
      return `<div class="reporte-row" style="flex-direction:column;align-items:stretch;gap:6px;padding:10px 0">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="width:10px;height:10px;border-radius:50%;background:${s.color};flex-shrink:0;display:inline-block"></span>
          <span class="reporte-nombre" style="flex:1">${s.nombre}</span>
          <span style="font-size:12px;color:var(--text-secondary)">${d.emps.size} emp.</span>
          <span class="reporte-val" style="font-size:16px">${d.horas.toFixed(0)}h</span>
        </div>
        <div class="reporte-bar-wrap" style="margin:0;height:5px">
          <div class="reporte-bar" style="width:${pct}%;background:${s.color}"></div>
        </div>
      </div>`;
    }).join('');

  // ── COMPARAR MESES ──
  const selComp = document.getElementById('repFiltComp')?.value || 'none';
  let htmlComparacion = '';

  if (selComp !== 'none') {
    const [cAnio, cMes] = selComp.split('||');
    let datosComp = datos.filter(r => String(r.AÑO) === cAnio && r.MES === cMes);
    if (selLocal !== 'all') datosComp = datosComp.filter(r => r.LOCAL === selLocal);

    const compLabel = `${cMes} ${cAnio}`;

    // Horas por empleado en mes de comparación
    const horasComp = {};
    datosComp.forEach(r => {
      if (!horasComp[r.EMPLEADO]) horasComp[r.EMPLEADO] = 0;
      horasComp[r.EMPLEADO] += parseFloat(r.TOTAL_HS) || 0;
    });

    // Combinar ambos meses
    const todosEmpsComp = new Set([...Object.keys(horasPorEmp), ...Object.keys(horasComp)]);
    const maxHComp = Math.max(
      ...Object.values(horasPorEmp).map(v => v.horas),
      ...Object.values(horasComp)
    ) || 1;

    const filaComp = [...todosEmpsComp].map(nombre => {
      const h1 = horasPorEmp[nombre]?.horas || 0;
      const h2 = horasComp[nombre] || 0;
      const diff = h1 - h2;
      const s = SUCURSALES_TODAS.find(x => x.id === (horasPorEmp[nombre]?.local || '')) || { color: '#888' };
      const numMatch = nombre.match(/^(\d+)\s+(.+)$/);
      const label = numMatch ? `<span style="color:var(--text-muted);font-size:11px">#${numMatch[1]}</span> ${numMatch[2]}` : nombre;
      const diffHtml = diff > 0
        ? `<span class="comp-diff comp-diff-up">+${diff.toFixed(0)}h</span>`
        : diff < 0
          ? `<span class="comp-diff comp-diff-down">${diff.toFixed(0)}h</span>`
          : `<span class="comp-diff comp-diff-eq">—</span>`;
      return { nombre, label, h1, h2, diff, s, diffHtml };
    }).sort((a, b) => b.h1 - a.h1);

    htmlComparacion = `
    <div class="reporte-card full comp-card">
      <h3>Comparación por empleado <span class="rep-periodo-tag">${periodoLabel} vs ${compLabel}</span></h3>
      <div class="comp-tabla-wrap">
        <table class="comp-tabla">
          <thead>
            <tr>
              <th>Empleado</th>
              <th>${periodoLabel}</th>
              <th>${compLabel}</th>
              <th>Diferencia</th>
            </tr>
          </thead>
          <tbody>
            ${filaComp.map(f => `<tr>
              <td class="reporte-nombre">${f.label}</td>
              <td>
                <div class="comp-bar-row">
                  <div class="comp-bar" style="width:${(f.h1/maxHComp*100).toFixed(0)}%;background:${f.s.color}"></div>
                  <span>${f.h1.toFixed(0)}h</span>
                </div>
              </td>
              <td>
                <div class="comp-bar-row">
                  <div class="comp-bar comp-bar-2" style="width:${(f.h2/maxHComp*100).toFixed(0)}%"></div>
                  <span>${f.h2.toFixed(0)}h</span>
                </div>
              </td>
              <td>${f.diffHtml}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  // Opciones para comparar (excluye el período seleccionado)
  const compOpts = [`<option value="none">Sin comparación</option>`,
    ...periodos.filter(p => p !== selPeriodo).map(p => {
      const [y, m] = p.split('||');
      return `<option value="${p}" ${p === selComp ? 'selected' : ''}>${m} ${y}</option>`;
    })].join('');

  container.innerHTML = `
    <div class="rep-filtros-panel">
      <div class="rep-filtro-grupo">
        <label class="emp-filtro-label" for="repFiltPeriodo">Período</label>
        <select class="emp-filtro-select" id="repFiltPeriodo" onchange="renderReportes(state.datos)">
          ${periodoOpts}
        </select>
      </div>
      <div class="rep-filtro-grupo">
        <label class="emp-filtro-label" for="repFiltComp">Comparar con</label>
        <select class="emp-filtro-select" id="repFiltComp" onchange="renderReportes(state.datos)">
          ${compOpts}
        </select>
      </div>
      <div class="rep-filtro-grupo">
        <label class="emp-filtro-label" for="repFiltLocal">Sucursal</label>
        <select class="emp-filtro-select" id="repFiltLocal" onchange="renderReportes(state.datos)">
          ${localOpts}
        </select>
      </div>
      <div class="rep-stat-resumen">
        <span class="rep-stat-item"><strong>${listaEmps.length}</strong> empleados</span>
        <span class="rep-stat-sep">·</span>
        <span class="rep-stat-item"><strong>${datosFilt.reduce((a,r)=>a+(parseFloat(r.TOTAL_HS)||0),0).toFixed(0)}</strong> hs totales</span>
        <span class="rep-stat-sep">·</span>
        <span class="rep-stat-item">Promedio <strong>${promH.toFixed(1)}</strong> hs/emp</span>
      </div>
    </div>

    <div class="reportes-grid">
      <div class="reporte-card">
        <h3>Horas por empleado <span class="rep-periodo-tag">${periodoLabel}</span></h3>
        <div class="reporte-scroll">${htmlEmps}</div>
      </div>
      <div class="reporte-card">
        <h3>Cobertura por sucursal <span class="rep-periodo-tag">${periodoLabel}</span></h3>
        ${htmlSuc}
      </div>
      ${htmlComparacion}
    </div>`;
}

// ── VISTA MES ──────────────────────────────────────────
function getMesActual(offset = 0) {
  const hoy = new Date();
  return new Date(hoy.getFullYear(), hoy.getMonth() + offset, 1);
}

function getMesLabel(offset = 0) {
  const d = getMesActual(offset);
  return `${MESES_ES[d.getMonth()]} ${d.getFullYear()}`;
}

function getDatosMes(datos, offset = 0) {
  const d   = getMesActual(offset);
  const mes = MESES_ES[d.getMonth()];
  const anio = String(d.getFullYear());
  return datos.filter(r => r.MES === mes && String(r.AÑO) === anio);
}

function renderCalendario(datos) {
  const offset  = state.mesOffset;
  const base    = getMesActual(offset);
  const mes     = base.getMonth();
  const anio    = base.getFullYear();
  const { sucursal } = getFilters();

  const diasEnMes  = new Date(anio, mes + 1, 0).getDate();
  const primerDow  = new Date(anio, mes, 1).getDay(); // 0=Dom
  const startCol   = primerDow === 0 ? 6 : primerDow - 1; // ajustar a Lun=0

  const datosMes = getDatosMes(datos, offset)
    .filter(r => sucursal === 'all' || r.LOCAL === sucursal);

  // Agrupar registros por día
  const porDia = {};
  datosMes.forEach(r => {
    const d = String(r.DIA);
    if (!porDia[d]) porDia[d] = [];
    porDia[d].push(r);
  });

  const hoy = new Date();
  const esEsteMes = hoy.getMonth() === mes && hoy.getFullYear() === anio;

  let html = `<div class="calendario-wrap">
    <div class="cal-header-dias">
      ${['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(d => `<div class="cal-dia-label">${d}</div>`).join('')}
    </div>
    <div class="cal-grid">`;

  // Celdas vacías al inicio
  for (let i = 0; i < startCol; i++) {
    html += `<div class="cal-celda cal-vacia"></div>`;
  }

  for (let d = 1; d <= diasEnMes; d++) {
    const registros = porDia[String(d)] || [];
    const emps      = new Set(registros.map(r => r.EMPLEADO)).size;
    const esHoy     = esEsteMes && hoy.getDate() === d;
    const dow       = new Date(anio, mes, d).getDay();
    const esFinde   = dow === 0 || dow === 6;
    const fechaObj  = new Date(anio, mes, d);
    const esFer     = esFeriado(fechaObj);

    // Aplicar filtros de día
    if (diaFiltrado(fechaObj)) {
      html += `<div class="cal-celda cal-vacia"></div>`;
      continue;
    }

    // Contar tipos de turno
    const tm   = registros.filter(r => clasificarTurno(r.H_ENTRADA, r.H_SALIDA) === 'TM').length;
    const tt   = registros.filter(r => clasificarTurno(r.H_ENTRADA, r.H_SALIDA) === 'TT').length;
    const comp = registros.filter(r => clasificarTurno(r.H_ENTRADA, r.H_SALIDA) === 'COMP').length;

    const diaKey = `${anio}-${mes}-${d}`;
    html += `<div class="cal-celda ${esHoy ? 'cal-hoy' : ''} ${esFinde ? 'cal-finde' : ''} ${esFer ? 'cal-feriado' : ''} ${registros.length ? 'cal-celda-click' : ''}"
      ${registros.length ? `onclick="abrirDetalleDia(${d}, ${mes}, ${anio})"` : ''}>
      <div class="cal-num">${d}${esFer ? '<span class="cal-feriado-tag">F</span>' : ''}</div>
      ${registros.length ? `
        <div class="cal-emps">${emps} emp.</div>
        <div class="cal-pills-mini">
          ${tm   ? `<span class="pill-mini pill-mini-tm">M:${tm}</span>` : ''}
          ${tt   ? `<span class="pill-mini pill-mini-tt">T:${tt}</span>` : ''}
          ${comp ? `<span class="pill-mini pill-mini-comp">C:${comp}</span>` : ''}
        </div>
      ` : `<div class="cal-sin-datos"></div>`}
    </div>`;
  }

  html += `</div></div>`;
  document.getElementById('calendarioContainer').innerHTML = html;
}

function renderResumenMes(datos) {
  const offset   = state.mesOffset;
  const { sucursal, empleado } = getFilters();
  const datosMes = getDatosMes(datos, offset)
    .filter(r => sucursal === 'all' || r.LOCAL === sucursal)
    .filter(r => empleado === 'all' || r.EMPLEADO === empleado);

  // Agrupar por empleado
  const empMap = {};
  datosMes.forEach(r => {
    const key = `${r.EMPLEADO}||${r.LOCAL}`;
    if (!empMap[key]) empMap[key] = { nombre: r.EMPLEADO, local: r.LOCAL, horas: 0, dias: new Set(), hsExtra: 0, sabados: new Set(), feriados: new Set(), hsPorDia: {} };
    const hs = parseFloat(r.TOTAL_HS) || 0;
    empMap[key].horas += hs;
    const diaKey = r.AÑO + '-' + r.MES + '-' + r.DIA;
    empMap[key].dias.add(diaKey);
    empMap[key].hsPorDia[diaKey] = (empMap[key].hsPorDia[diaKey] || 0) + hs;
    const dow = new Date(r.AÑO, MESES_ES.indexOf(r.MES), parseInt(r.DIA)).getDay();
    if (dow === 6) empMap[key].sabados.add(diaKey);
    const fechaObj = new Date(r.AÑO, MESES_ES.indexOf(r.MES), parseInt(r.DIA));
    if (esFeriado(fechaObj)) empMap[key].feriados.add(diaKey);
  });

  // Calcular hsExtra y hsFeriado por día usando categoría del empleado
  Object.values(empMap).forEach(e => {
    e.hsExtra = 0; e.hsFeriado = 0;
    Object.entries(e.hsPorDia).forEach(([diaKey, hsDia]) => {
      const [anio, mes, dia] = diaKey.split('-');
      const fecha = new Date(parseInt(anio), MESES_ES.indexOf(mes), parseInt(dia));
      e.hsExtra   += calcularHsExtra(e.nombre, hsDia, fecha);
      e.hsFeriado += calcularHsFeriado(hsDia, fecha);
    });
  });

  const lista = Object.values(empMap).sort((a, b) => b.horas - a.horas);

  if (!lista.length) {
    document.getElementById('resumenMesContainer').innerHTML =
      '<p style="padding:2rem;color:#999;font-size:14px">No hay datos para este mes.</p>';
    return;
  }

  const suc = (id) => SUCURSALES_TODAS.find(s => s.id === id) || { color: '#888', colorLight: '#eee', nombre: id };

  let html = `<div class="resumen-mes-wrap">
    <h3 class="resumen-mes-titulo">Resumen del mes — ${getMesLabel(offset)}</h3>
    <div class="resumen-mes-tabla-wrap">
    <table class="resumen-mes-tabla">
      <thead>
        <tr>
          <th>Empleado</th>
          <th>Sucursal</th>
          <th>Días</th>
          <th>Horas</th>
          <th>Hs extra</th>
          <th>Hs feriado</th>
          <th>Sábados</th>
          <th>Feriados</th>
        </tr>
      </thead>
      <tbody>`;

  lista.forEach(e => {
    const s = suc(e.local);
    const numMatch2 = e.nombre.match(/^(\d+)\s+(.+)$/);
    const nomLabel = numMatch2 ? `<span style="color:var(--text-muted);font-size:11px;margin-right:4px">#${numMatch2[1]}</span>${numMatch2[2]}` : e.nombre;
    html += `<tr onclick="abrirDetalleEmpleadoPeriodo('${e.nombre.replace(/'/g,"\\'")}', 'mes')" style="cursor:pointer">
      <td class="td-emp td-emp-link">${nomLabel}</td>
      <td><span class="suc-badge-mini" style="background:${s.colorLight};color:${s.color}">${s.nombre}</span></td>
      <td>${e.dias.size}</td>
      <td><strong>${e.horas.toFixed(1)}</strong></td>
      <td>${e.hsExtra > 0 ? `<span class="hs-extra">${e.hsExtra.toFixed(1)}</span>` : '—'}</td>
      <td>${e.hsFeriado > 0 ? `<span class="hs-feriado">${e.hsFeriado.toFixed(1)}</span>` : '—'}</td>
      <td>${e.sabados.size || '—'}</td>
      <td>${e.feriados.size ? `<span class="tag-feriado">${e.feriados.size}</span>` : '—'}</td>
    </tr>`;
  });

  const totalHoras = lista.reduce((a, e) => a + e.horas, 0);
  html += `</tbody>
      <tfoot>
        <tr>
          <td colspan="3"><strong>TOTAL</strong></td>
          <td><strong>${totalHoras.toFixed(1)}</strong></td>
          <td colspan="4"></td>
        </tr>
      </tfoot>
    </table></div></div>`;

  document.getElementById('resumenMesContainer').innerHTML = html;
}


function renderAll() {
  // Si hay sesión de empleado activa, no renderizar la vista admin
  if (sesionActual && sesionActual.rol === 'empleado') return;

  const datos = state.datos.length ? state.datos : [];
  const wrEl = document.getElementById('weekRange');
  const mrEl = document.getElementById('mesRange');
  if (wrEl) wrEl.textContent = getWeekRange(state.semanaOffset);
  if (mrEl) mrEl.textContent = getMesLabel(state.mesOffset);
  renderStats(datos);
  renderGrilla(datos);
  renderCalendario(datos);
  renderResumenMes(datos);
  renderEmpleados(datos);
  // renderAll() se llama en cada refresh de datos (carga inicial, botón
  // "Actualizar datos", auto-refresh de 5 min, navegación de semana) sin
  // importar qué pestaña esté activa — antes esto pisaba "En vivo" con el
  // legacy (DATOS GENERALES, nunca se actualiza) cada vez que corría,
  // aunque ENVIVO_NODE=true. Mismo bug ya encontrado y corregido en
  // croma-panel-main (commit 5d0a7b3) — acá nunca se había tocado.
  if (ENVIVO_NODE) { if (envivoDataNode !== null) renderEnVivoNode(); } else { renderEnVivo(); }
  poblarFiltroEmpleados(datos);
}

function poblarFiltroEmpleados(datos) {
  const sel = document.getElementById('filterEmp');
  const actual = sel.value;
  const emps = [...new Set(datos.map(r => r.EMPLEADO))].sort();
  sel.innerHTML = '<option value="all">Todos los empleados</option>' +
    emps.map(e => `<option value="${e}" ${e === actual ? 'selected' : ''}>${e}</option>`).join('');
}

