// ── DETALLE EMPLEADO ───────────────────────────────────
async function abrirDetalleEmpleado(nombreEmp, sucId) {
  if (CERTIFICADOS_CACHE.length === 0) await cargarCertificados();
  if (VACACIONES_APROBADAS_CACHE.length === 0) await cargarVacacionesAprobadas();
  abrirDetalleEmpleadoConDatos(nombreEmp, sucId, state.datos.filter(r => r.EMPLEADO === nombreEmp));
}

async function abrirDetalleEmpleadoDesdePanel(nombreEmp, sucId) {
  if (CERTIFICADOS_CACHE.length === 0) await cargarCertificados();
  if (VACACIONES_APROBADAS_CACHE.length === 0) await cargarVacacionesAprobadas();
  const selPeriodo = document.getElementById('empFiltPeriodo')?.value || 'all';
  const registros  = state.datos.filter(r => r.EMPLEADO === nombreEmp);
  let periodoForzado = null;
  if (selPeriodo !== 'all') {
    const [anio, mes] = selPeriodo.split('||');
    periodoForzado = mes + ' ' + anio;
  }
  abrirDetalleEmpleadoConDatos(nombreEmp, sucId, registros, periodoForzado);
}

function abrirDetalleEmpleadoConDatos(nombreEmp, sucId, registrosFiltrados, periodoForzado) {
  const datos = state.datos;
  const suc = SUCURSALES_TODAS.find(s => s.id === sucId) || { color: '#888', colorLight: '#eee', nombre: sucId };

  // Registros ya filtrados, ordenados por fecha (más reciente primero)
  const registrosTodos = registrosFiltrados.sort((a, b) => {
    const fa = new Date(a.AÑO, MESES_ES.indexOf(a.MES), parseInt(a.DIA));
    const fb = new Date(b.AÑO, MESES_ES.indexOf(b.MES), parseInt(b.DIA));
    return fb - fa;
  });

  if (!registrosTodos.length) { showToast('Sin registros para este empleado'); return; }

  // Separar número y nombre
  const numMatch   = nombreEmp.match(/^(\d+)\s+(.+)$/);
  const numVend    = numMatch ? numMatch[1] : '';
  const nomMostrar = numMatch ? numMatch[2] : nombreEmp;
  const nombreLegalDetalle = getNombresLegales()[_normalizarNombreEmpleadoJS(nombreEmp)] || '';

  // Obtener períodos disponibles ordenados cronológicamente
  const ORDEN_MESES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
                       'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
  const periodosSet = new Set();
  registrosTodos.forEach(r => periodosSet.add(r.MES + ' ' + r.AÑO));
  const periodos = Array.from(periodosSet).sort((a, b) => {
    const [mA, aA] = a.split(' ');
    const [mB, aB] = b.split(' ');
    if (aA !== aB) return parseInt(aA) - parseInt(aB);
    return ORDEN_MESES.indexOf(mA) - ORDEN_MESES.indexOf(mB);
  });

  const DIAS_SEMANA = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

  // Función para calcular filas y totales según período seleccionado
  function calcularContenido(periodo) {
    const registros = periodo === 'TODOS'
      ? registrosTodos
      : registrosTodos.filter(r => (r.MES + ' ' + r.AÑO) === periodo);

    const porFecha = {};
    registros.forEach(r => {
      const key = `${r.AÑO}-${r.MES}-${r.DIA}`;
      if (!porFecha[key]) porFecha[key] = [];
      porFecha[key].push(r);
    });

    const filas = Object.entries(porFecha).map(([key, regs]) => {
      regs.sort((a, b) => (a.H_ENTRADA || '').localeCompare(b.H_ENTRADA || ''));
      const r0 = regs[0];
      const fecha = new Date(r0.AÑO, MESES_ES.indexOf(r0.MES), parseInt(r0.DIA));
      const fechaStr = fecha.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
      const diaSem  = DIAS_SEMANA[fecha.getDay()];
      const esSab   = fecha.getDay() === 6;
      const esDom   = fecha.getDay() === 0;
      const esFer   = esFeriado(fecha);

      // Aplicar filtro de día
      if (diaFiltrado(fecha)) return null;

      let horaReg = '', horaReg2 = '';
      if (r0.MARCA_TEMPORAL) {
        try {
          const mt = new Date(r0.MARCA_TEMPORAL);
          horaReg = mt.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' });
        } catch(e) {}
      }
      if (regs[1]?.MARCA_TEMPORAL) {
        try { horaReg2 = new Date(regs[1].MARCA_TEMPORAL).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' }); } catch(e) {}
      }

      const turno1  = r0.H_ENTRADA && r0.H_SALIDA ? `${r0.H_ENTRADA} - ${r0.H_SALIDA}` : '—';
      const turno2  = regs[1] && regs[1].H_ENTRADA ? `${regs[1].H_ENTRADA} - ${regs[1].H_SALIDA}` : '';
      const hsTotal = regs.reduce((a, r) => a + (parseFloat(r.TOTAL_HS) || 0), 0);
      const hsExtra = calcularHsExtra(nombreEmp, hsTotal, fecha);
      const hsFeriado = calcularHsFeriado(hsTotal, fecha);
      const nota    = regs.map(r => r.NOTA).filter(Boolean).join(' / ');
      const localStr = regs.map(r => {
        const s = SUCURSALES_TODAS.find(x => x.id === r.LOCAL);
        return s ? s.nombre : r.LOCAL;
      }).filter((v,i,a) => a.indexOf(v)===i).join(', ');

      return { fechaStr, diaSem, horaReg, horaReg2, turno1, turno2, hsTotal, hsExtra, hsFeriado, esSab, esDom, esFer, nota, localStr,
               fechaISO: `${fecha.getFullYear()}-${String(fecha.getMonth()+1).padStart(2,'0')}-${String(fecha.getDate()).padStart(2,'0')}` };
    }).filter(Boolean);

    // Agregar filas de certificados
    const certs = getCertificadosDe(nombreEmp);
    certs.forEach(c => {
      // Filtrar por período
      if (periodo !== 'TODOS') {
        const [cy, cm, cd] = c.fecha.split('-').map(Number);
        const fechaCert = new Date(cy, cm-1, cd);
        const mesAnio = `${MESES_ES[fechaCert.getMonth()]} ${fechaCert.getFullYear()}`;
        if (mesAnio !== periodo) return;
      }
      const [cy, cm, cd] = c.fecha.split('-').map(Number);
      const fechaCert = new Date(cy, cm-1, cd);
      if (diaFiltrado(fechaCert)) return;
      filas.push({
        fechaStr: fechaCert.toLocaleDateString('es-AR', {day:'2-digit',month:'2-digit',year:'numeric'}),
        diaSem:   DIAS_SEMANA[fechaCert.getDay()],
        horaReg:  '—',
        turno1:   `CERTIFICADO`,
        turno2:   '',
        hsTotal:  c.hs,
        hsExtra:  0,
        hsFeriado: 0,
        esSab:    fechaCert.getDay() === 6,
        esDom:    fechaCert.getDay() === 0,
        esFer:    esFeriado(fechaCert),
        nota:     c.nota || c.tipo,
        localStr: '—',
        esCert:   true,
        certId:   c.id,
        certTipo: c.tipo,
        fechaISO: c.fecha,
      });
    });

    // Agregar filas de vacaciones aprobadas (por el empleado o cargadas por admin)
    const vacs = getVacacionesAprobadasDe(nombreEmp);
    vacs.forEach(v => {
      const [dy,dm,dd] = String(v.fecha_desde).split('-').map(Number);
      const [hy,hm,hd] = String(v.fecha_hasta).split('-').map(Number);
      const cur = new Date(dy, dm-1, dd);
      const fin = new Date(hy, hm-1, hd);
      let guard = 0;
      while (cur <= fin && guard < 120) {
        const fechaVac = new Date(cur);
        guard++;
        cur.setDate(cur.getDate() + 1);

        if (periodo !== 'TODOS') {
          const mesAnio = `${MESES_ES[fechaVac.getMonth()]} ${fechaVac.getFullYear()}`;
          if (mesAnio !== periodo) continue;
        }
        if (diaFiltrado(fechaVac)) continue;

        filas.push({
          fechaStr: fechaVac.toLocaleDateString('es-AR', {day:'2-digit',month:'2-digit',year:'numeric'}),
          diaSem:   DIAS_SEMANA[fechaVac.getDay()],
          horaReg:  '—',
          turno1:   `VACACIONES`,
          turno2:   '',
          hsTotal:  0,
          hsExtra:  0,
          hsFeriado: 0,
          esSab:    fechaVac.getDay() === 6,
          esDom:    fechaVac.getDay() === 0,
          esFer:    esFeriado(fechaVac),
          nota:     'Vacaciones',
          localStr: '—',
          esVac:    true,
          vacId:    v.id,
          fechaISO: `${fechaVac.getFullYear()}-${String(fechaVac.getMonth()+1).padStart(2,'0')}-${String(fechaVac.getDate()).padStart(2,'0')}`,
        });
      }
    });

    // Ordenar todas las filas por fecha asc (más viejo primero)
    filas.sort((a, b) => {
      const [ya,ma,da] = a.fechaISO.split('-').map(Number);
      const [yb,mb,db] = b.fechaISO.split('-').map(Number);
      return new Date(ya,ma-1,da) - new Date(yb,mb-1,db);
    });

    // Totales calculados desde las filas ya filtradas
    const totalHoras     = filas.reduce((a, f) => a + f.hsTotal, 0);
    const diasUnicos     = filas.length;
    const totalHsExtra   = filas.reduce((a, f) => a + f.hsExtra, 0);
    const totalHsFeriado = filas.reduce((a, f) => a + (f.hsFeriado || 0), 0);
    const totalSabs      = filas.filter(f => f.esSab).length;

    return { filas, totalHoras, totalHsExtra, totalHsFeriado, totalSabs, diasUnicos };
  }

  // Función para re-renderizar tabla y stats al cambiar mes
  function renderDetalle(periodo) {
    const { filas, totalHoras, totalHsExtra, totalHsFeriado, totalSabs, diasUnicos } = calcularContenido(periodo);
    const periodoLabel = periodo === 'TODOS' ? 'Todos los registros' : periodo;

    document.getElementById('detalleStatDias').textContent  = diasUnicos;
    document.getElementById('detalleStatHs').textContent    = totalHoras.toFixed(1);
    document.getElementById('detalleStatExtra').textContent = totalHsExtra.toFixed(1);
    const ferEl = document.getElementById('detalleStatFeriado');
    if (ferEl) ferEl.textContent = totalHsFeriado.toFixed(1);
    document.getElementById('detalleStatSabs').textContent  = totalSabs;
    const certEl = document.getElementById('detalleStatCerts');
    if (certEl) certEl.textContent = filas.filter(f => f.esCert).length;
    document.getElementById('detalleSub').textContent       = suc.nombre + ' · ' + periodoLabel;

    document.getElementById('detalleTbody').innerHTML = filas.map(f => {
      if (f.esCert) return `
      <tr class="fila-certificado" data-fecha="${f.fechaISO}" data-hs="${f.hsTotal}" data-extra="0" data-feriado="0" data-sab="${f.esSab?1:0}" data-cert="1">
        <td>${f.fechaStr}</td>
        <td>${f.diaSem}</td>
        <td class="hora-reg">—</td>
        <td colspan="2"><span class="tag-cert">CERT</span> ${esc(f.nota)}</td>
        <td></td>
        <td>—</td>
        <td>—</td>
        <td></td>
        <td>—</td>
        <td><button onclick="eliminarCertificado('${f.certId}','${nombreEmp.replace(/'/g,"\\'")}','${f.fechaISO.substring(0,7)}')" style="background:none;border:none;cursor:pointer;color:#dc2626" title="Borrar certificado" aria-label="Borrar certificado">${icon('x','icon-12')}</button></td>
      </tr>`;
      if (f.esVac) return `
      <tr class="fila-vacaciones" data-fecha="${f.fechaISO}" data-hs="0" data-extra="0" data-feriado="0" data-sab="${f.esSab?1:0}" data-vac="1">
        <td>${f.fechaStr}</td>
        <td>${f.diaSem}</td>
        <td class="hora-reg">—</td>
        <td colspan="2"><span class="tag-vac">VACACIONES</span></td>
        <td></td>
        <td>—</td>
        <td>—</td>
        <td></td>
        <td>—</td>
        <td></td>
      </tr>`;
      return `
      <tr class="${f.esSab ? 'fila-sabado' : ''} ${f.esDom ? 'fila-domingo' : ''} ${f.esFer ? 'fila-feriado' : ''}" data-fecha="${f.fechaISO}" data-hs="${f.hsTotal}" data-extra="${f.hsExtra}" data-feriado="${f.hsFeriado||0}" data-sab="${f.esSab?1:0}" data-cert="0">
        <td>${f.fechaStr}${f.esFer ? ' <span class="tag-feriado">F</span>' : ''}</td>
        <td>${f.diaSem}</td>
        <td class="hora-reg">${f.horaReg||'—'}${f.horaReg2 ? `<br><span class="hora-reg-2">${f.horaReg2}</span>` : ''}</td>
        <td class="turno-cell">${f.turno1}</td>
        <td class="turno-cell">${f.turno2 || '—'}</td>
        <td><strong>${f.hsTotal.toFixed(1)}</strong></td>
        <td>${f.hsExtra > 0 ? `<span class="hs-extra">${f.hsExtra.toFixed(1)}</span>` : '—'}</td>
        <td>${f.hsFeriado > 0 ? `<span class="hs-feriado">${f.hsFeriado.toFixed(1)}</span>` : '—'}</td>
        <td>${f.esSab ? '<span class="check-sab">✓</span>' : ''}</td>
        <td><span class="local-tag" style="color:${suc.color}">${f.localStr}</span></td>
        <td class="nota-cell">${esc(f.nota)}</td>
      </tr>`;
    }).join('');
    actualizarTablaDetalle();

    document.getElementById('detalleTfoot').innerHTML = `
      <tr>
        <td colspan="2"><strong>TOTALES</strong></td>
        <td>${diasUnicos}</td>
        <td colspan="2"></td>
        <td><strong>${totalHoras.toFixed(1)}</strong></td>
        <td>${totalHsExtra > 0 ? `<span class="hs-extra">${totalHsExtra.toFixed(1)}</span>` : '—'}</td>
        <td>${totalHsFeriado > 0 ? `<span class="hs-feriado">${totalHsFeriado.toFixed(1)}</span>` : '—'}</td>
        <td>${totalSabs}</td>
        <td colspan="2"></td>
      </tr>`;
  }

  // Período inicial: el más reciente
  const periodoInicial = (periodoForzado && periodos.includes(periodoForzado))
    ? periodoForzado
    : (periodos[periodos.length - 1] || 'TODOS');
  const { filas: filasIni, totalHoras: thIni, totalHsExtra: theIni, totalHsFeriado: thFerIni, totalSabs: tsIni, diasUnicos: duIni } = calcularContenido(periodoInicial);

  const opcionesMes = [`<option value="TODOS">Todos los registros</option>`]
    .concat(periodos.map(p => `<option value="${p}" ${p === periodoInicial ? 'selected' : ''}>${p}</option>`))
    .join('');

  // Empresa y tipo de jornada del empleado (desde el perfil)
  const perfilEmp  = EMPLEADOS_PERFILES[nombreEmp] || {};
  const catEmp     = CATEGORIAS_CONFIG.find(c => c.id === perfilEmp.categoria_id);
  const empresaEmp = (perfilEmp.empresa || '').trim();
  const jornadaEmp = (catEmp?.nombre || '').trim();

  // Footer: última actualización de los datos
  const _ua = state.ultimaActualizacion instanceof Date ? state.ultimaActualizacion : new Date();
  const ultActStr = `${_ua.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${_ua.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: true })}`;

  const html = `
  <div class="detalle-overlay" onclick="cerrarDetalle(event)">
    <div class="detalle-panel" onclick="event.stopPropagation()">
      <div class="detalle-header">
        <span class="detalle-header-stripe" style="background:${suc.color}"></span>
        <div class="detalle-header-inner">
          <div class="detalle-header-top">
            <div style="display:flex;align-items:center;gap:14px">
              <button class="detalle-close-btn" onclick="cerrarDetalle()" title="Cerrar" aria-label="Cerrar">
                ${icon('x','icon-18')}
              </button>
              ${(() => {
                const perfil = EMPLEADOS_PERFILES[nombreEmp];
                const fotoUrl = perfil?.foto_url;
                return fotoUrl
                  ? `<div class="detalle-foto emp-avatar-foto" style="width:84px;height:84px;border-radius:18px;overflow:hidden;flex-shrink:0"><img src="${fotoUrl}" alt="${nomMostrar}" style="width:100%;height:100%;object-fit:cover" /></div>`
                  : `<div class="detalle-foto" style="width:84px;height:84px;border-radius:18px;background:${suc.colorLight};color:${suc.color};display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue';font-size:34px;flex-shrink:0">${nomMostrar.charAt(0)}</div>`;
              })()}
              <div>
                <div class="detalle-titulo">
                  ${numVend ? `<span class="detalle-num" style="background:${suc.colorLight};color:${suc.color}">#${numVend}</span>` : ''}
                  ${nomMostrar}
                </div>
                ${nombreLegalDetalle ? `<div style="font-size:12px;color:var(--text-muted)">${nombreLegalDetalle}</div>` : ''}
                <div class="detalle-sub" id="detalleSub">${suc.nombre} · ${periodoInicial}</div>
                ${(empresaEmp || jornadaEmp) ? `<div class="detalle-chips">
                  ${empresaEmp ? `<span class="detalle-chip detalle-chip-empresa">${icon('building','icon-12')}${empresaEmp}</span>` : ''}
                  ${jornadaEmp ? `<span class="detalle-chip detalle-chip-jornada"${catEmp?.descripcion ? ` title="${esc(catEmp.descripcion)}"` : ''}>${icon('clock','icon-12')}${jornadaEmp}</span>` : ''}
                </div>` : ''}
              </div>
            </div>
            <div class="detalle-acciones">
              <select id="detalleSelectMes" aria-label="Período" class="filter-select" style="height:32px;font-size:12px;padding:0 8px;border-radius:8px">
                ${opcionesMes}
              </select>
              <button class="btn-detalle-accion" onclick="imprimirDetalleEmpleado()" title="Imprimir / PDF">
                ${icon('printer','icon-13')}
                PDF
              </button>
              <button class="btn-detalle-accion btn-excel" onclick="descargarExcelEmpleado('${nombreEmp.replace(/'/g,"\\''")}', '${nomMostrar}', '${suc.nombre}')" title="Descargar Excel">
                ${icon('fileText','icon-13')}
                Excel
              </button>
              <button class="btn-detalle-accion" style="color:#2563eb;border-color:#93c5fd;background:#eff6ff" onclick="abrirFormCertificado(this.dataset.emp)" data-emp="${nombreEmp}">
                ${icon('circlePlus','icon-13')}
                Certificado
              </button>
              ${(sesionActual?.rol === 'admin' || sesionActual?.rol === 'horarios') ? (
                (EMPLEADOS_PERFILES[nombreEmp]?.activo !== false)
                  ? `<button class="btn-detalle-accion btn-detalle-baja" onclick="marcarEmpleadoInactivo('${nombreEmp.replace(/'/g,"\\'")}')">
                       ${icon('userX','icon-13')}
                       Marcar como ya no trabaja
                     </button>`
                  : `<button class="btn-detalle-accion btn-detalle-alta" onclick="reactivarEmpleado('${nombreEmp.replace(/'/g,"\\'")}')">
                       ${icon('userPlus','icon-13')}
                       Reactivar empleado
                     </button>`
              ) : ''}
            </div>
          </div>
        </div>
        <div class="detalle-stats-row">
          <div class="detalle-stat stat-dias">
            <div class="detalle-stat-icon">${icon('calendar','icon-20')}</div>
            <div class="detalle-stat-body"><span class="detalle-stat-val" id="detalleStatDias">${duIni}</span><span class="detalle-stat-lbl">Días</span></div>
          </div>
          <div class="detalle-stat stat-hs">
            <div class="detalle-stat-icon">${icon('clock','icon-20')}</div>
            <div class="detalle-stat-body"><span class="detalle-stat-val" id="detalleStatHs">${thIni.toFixed(1)}</span><span class="detalle-stat-lbl">Hs totales</span></div>
          </div>
          <div class="detalle-stat stat-extra">
            <div class="detalle-stat-icon">${icon('circlePlus','icon-20')}</div>
            <div class="detalle-stat-body"><span class="detalle-stat-val" id="detalleStatExtra">${theIni.toFixed(1)}</span><span class="detalle-stat-lbl">Hs extra</span></div>
          </div>
          <div class="detalle-stat stat-feriado">
            <div class="detalle-stat-icon">${icon('calendarCheck','icon-20')}</div>
            <div class="detalle-stat-body"><span class="detalle-stat-val" id="detalleStatFeriado">${thFerIni.toFixed(1)}</span><span class="detalle-stat-lbl">Hs feriado</span></div>
          </div>
          <div class="detalle-stat stat-sabs">
            <div class="detalle-stat-icon">${icon('calendar','icon-20')}</div>
            <div class="detalle-stat-body"><span class="detalle-stat-val" id="detalleStatSabs">${tsIni}</span><span class="detalle-stat-lbl">Sábados</span></div>
          </div>
          <div class="detalle-stat stat-certs">
            <div class="detalle-stat-icon">${icon('shieldCheck','icon-20')}</div>
            <div class="detalle-stat-body"><span class="detalle-stat-val" id="detalleStatCerts">${filasIni.filter(f=>f.esCert).length}</span><span class="detalle-stat-lbl">Certs</span></div>
          </div>
        </div>
      </div>
      <div class="detalle-tabs">
        <button class="detalle-tab active" onclick="switchDetalleTab('jornada', this)">Historial</button>
        <button class="detalle-tab" onclick="switchDetalleTab('evolucion', this)">Evolución mensual</button>
        <button class="detalle-tab" onclick="switchDetalleTab('vacaciones', this)" id="tabVacBtn_${nombreEmp.replace(/[^a-zA-Z0-9]/g,'_')}">${icon('palmtree','icon-14')} Vacaciones</button>
        <button class="detalle-tab" onclick="switchDetalleTab('bancoHoras', this)">${icon('timer','icon-14')} Banco de horas</button>
      </div>
      <div class="detalle-tabla-wrap" id="detalleTabJornada">
        <div class="detalle-filtros-bar">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <span class="filtro-dia-label">Ver solo:</span>
            <label class="filtro-dia-check"><input type="checkbox" id="dchkFer" onchange="toggleDetalleFiltro('feriados',this.checked)"/><span>Feriados</span></label>
            <label class="filtro-dia-check"><input type="checkbox" id="dchkSab" onchange="toggleDetalleFiltro('sabados',this.checked)"/><span>Sábados</span></label>
            <label class="filtro-dia-check"><input type="checkbox" id="dchkDom" onchange="toggleDetalleFiltro('domingos',this.checked)"/><span>Domingos</span></label>
            <label class="filtro-dia-check"><input type="checkbox" id="dchkLab" onchange="toggleDetalleFiltro('laborales',this.checked)"/><span>Solo laborales</span></label>
            <label class="filtro-dia-check"><input type="checkbox" id="dchkCert" onchange="toggleDetalleFiltro('certificados',this.checked)"/><span>Certificados</span></label>
          </div>
        </div>
        <table class="detalle-tabla">
          <thead>
            <tr>
              <th style="cursor:pointer;user-select:none" onclick="toggleOrdenDetalle()" title="Ordenar por fecha">
                Fecha <span id="detalleOrdenIcon">↑</span>
              </th><th>Día</th><th>Hora reg.</th>
              <th>Turno 1</th><th>Turno 2</th>
              <th>Hs total</th><th>Hs extra</th><th>Hs feriado</th>
              <th>Sáb.</th><th>Local</th><th>Nota</th>
            </tr>
          </thead>
          <tbody id="detalleTbody">
            ${filasIni.map(f => {
              if (f.esCert) return `<tr class="fila-certificado" data-fecha="${f.fechaISO}" data-hs="${f.hsTotal}" data-extra="0" data-feriado="0" data-sab="${f.esSab?1:0}" data-cert="1">
                <td>${f.fechaStr}</td><td>${f.diaSem}</td><td class="hora-reg">—</td>
                <td colspan="2"><span class="tag-cert">CERT</span> ${esc(f.nota)}</td>
                <td></td><td>—</td><td>—</td><td></td><td>—</td>
                <td><button onclick="eliminarCertificado('${f.certId}','${nombreEmp.replace(/'/g,"\\'")}','${f.fechaISO.substring(0,7)}')" style="background:none;border:none;cursor:pointer;color:#dc2626" title="Borrar" aria-label="Borrar certificado">${icon('x','icon-12')}</button></td>
              </tr>`;
              if (f.esVac) return `<tr class="fila-vacaciones" data-fecha="${f.fechaISO}" data-hs="0" data-extra="0" data-feriado="0" data-sab="${f.esSab?1:0}" data-vac="1">
                <td>${f.fechaStr}</td><td>${f.diaSem}</td><td class="hora-reg">—</td>
                <td colspan="2"><span class="tag-vac">VACACIONES</span></td>
                <td></td><td>—</td><td>—</td><td></td><td>—</td>
                <td></td>
              </tr>`;
              return `<tr class="${f.esSab ? 'fila-sabado' : ''} ${f.esDom ? 'fila-domingo' : ''} ${f.esFer ? 'fila-feriado' : ''}" data-fecha="${f.fechaISO}" data-hs="${f.hsTotal}" data-extra="${f.hsExtra}" data-feriado="${f.hsFeriado||0}" data-sab="${f.esSab?1:0}" data-cert="0">
              <td>${f.fechaStr}${f.esFer ? ' <span class="tag-feriado">F</span>' : ''}</td>
              <td>${f.diaSem}</td>
              <td class="hora-reg">${f.horaReg}</td>
              <td class="turno-cell">${f.turno1}</td>
              <td class="turno-cell">${f.turno2 || '—'}</td>
              <td><strong>${f.hsTotal.toFixed(1)}</strong></td>
              <td>${f.hsExtra > 0 ? `<span class="hs-extra">${f.hsExtra.toFixed(1)}</span>` : '—'}</td>
              <td>${f.hsFeriado > 0 ? `<span class="hs-feriado">${f.hsFeriado.toFixed(1)}</span>` : '—'}</td>
              <td>${f.esSab ? '<span class="check-sab">✓</span>' : ''}</td>
              <td><span class="local-tag" style="color:${suc.color}">${f.localStr}</span></td>
              <td class="nota-cell">${esc(f.nota)}</td>
            </tr>`;}).join('')}
          </tbody>
          <tfoot id="detalleTfoot">
            <tr>
              <td colspan="2"><strong>TOTALES</strong></td>
              <td>${duIni}</td>
              <td colspan="2"></td>
              <td><strong>${thIni.toFixed(1)}</strong></td>
              <td>${theIni > 0 ? `<span class="hs-extra">${theIni.toFixed(1)}</span>` : '—'}</td>
              <td>${thFerIni > 0 ? `<span class="hs-feriado">${thFerIni.toFixed(1)}</span>` : '—'}</td>
              <td>${tsIni}</td>
              <td colspan="2"></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div class="detalle-tabla-wrap" id="detalleTabEvolucion" style="display:none;padding:1.5rem">
        ${generarEvolucionHTML(state.datos, nombreEmp, suc)}
      </div>
      <div class="detalle-tabla-wrap" id="detalleTabVacaciones" style="display:none;padding:1.5rem">
        <div id="vacAdminContent_inner">
          <p style="color:var(--text-muted);font-size:13px">Cargando vacaciones...</p>
        </div>
      </div>
      <div class="detalle-tabla-wrap" id="detalleTabBancoHoras" style="display:none;padding:1.5rem">
        <div id="bancoHorasAdminContent_inner">
          <p style="color:var(--text-muted);font-size:13px">Cargando banco de horas...</p>
        </div>
      </div>
      <div class="detalle-footer">
        <span class="detalle-footer-nota">
          ${icon('info','icon-14')}
          Los horarios corresponden a registros del sistema
        </span>
        <span class="detalle-footer-update">
          Última actualización: ${ultActStr}
          <button class="detalle-footer-refresh" onclick="document.getElementById('btnRefresh')?.click()" title="Actualizar datos" aria-label="Actualizar datos">
            ${icon('refresh','icon-14')}
          </button>
        </span>
      </div>
    </div>
  </div>`;

  const existing = document.getElementById('detalleOverlay');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.id = 'detalleOverlay';
  div.innerHTML = html;
  document.body.appendChild(div);
  document.body.style.overflow = 'hidden';

  actualizarTablaDetalle();
  // Evento del selector de mes — actualiza tabla y stats en tiempo real
  document.getElementById('detalleSelectMes').addEventListener('change', function() {
    renderDetalle(this.value);
  });
}

function abrirDetalleDia(dia, mesIdx, anio) {
  const mes = MESES_ES[mesIdx];
  const registros = state.datos.filter(r =>
    String(r.DIA) === String(dia) &&
    r.MES === mes &&
    String(r.AÑO) === String(anio)
  );
  if (!registros.length) return;

  const fecha = new Date(anio, mesIdx, dia);
  const DIAS_SEMANA = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const fechaStr = fecha.toLocaleDateString('es-AR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });

  // Agrupar por sucursal
  const porSuc = {};
  registros.forEach(r => {
    if (!porSuc[r.LOCAL]) porSuc[r.LOCAL] = [];
    porSuc[r.LOCAL].push(r);
  });

  let bodyHtml = '';
  Object.entries(porSuc).forEach(([sucId, regs]) => {
    const s = SUCURSALES_TODAS.find(x => x.id === sucId) || { color:'#888', colorLight:'#eee', nombre: sucId };
    regs.sort((a,b) => (a.EMPLEADO||'').localeCompare(b.EMPLEADO||''));
    bodyHtml += regs.map(r => {
      const numMatch = r.EMPLEADO.match(/^(\d+)\s+(.+)$/);
      const nomLabel = numMatch ? `<span style="color:var(--text-muted);font-size:11px">#${numMatch[1]}</span> ${numMatch[2]}` : r.EMPLEADO;
      const tipo = clasificarTurno(r.H_ENTRADA, r.H_SALIDA);
      const pill = pillHTML(tipo);
      return `<tr>
        <td>${nomLabel}</td>
        <td><span class="suc-badge-mini" style="background:${s.colorLight};color:${s.color}">${s.nombre}</span></td>
        <td class="turno-cell">${r.H_ENTRADA || '—'} - ${r.H_SALIDA || '—'}</td>
        <td>${pill}</td>
        <td><strong>${parseFloat(r.TOTAL_HS||0).toFixed(1)}</strong></td>
        <td class="nota-cell">${esc(r.NOTA)}</td>
      </tr>`;
    }).join('');
  });

  const totalEmps = new Set(registros.map(r => r.EMPLEADO)).size;
  const totalHoras = registros.reduce((a,r) => a + (parseFloat(r.TOTAL_HS)||0), 0);

  const html = `
  <div class="detalle-overlay" onclick="cerrarDetalle(event)">
    <div class="detalle-panel" onclick="event.stopPropagation()" style="max-width:700px">
      <div class="detalle-header" style="border-left:4px solid var(--accent)">
        <div class="detalle-header-top">
          <div>
            <div class="detalle-titulo">${fechaStr.charAt(0).toUpperCase() + fechaStr.slice(1)}</div>
            <div class="detalle-sub">${totalEmps} empleados · ${totalHoras.toFixed(1)} hs totales</div>
          </div>
          <button class="detalle-close" onclick="cerrarDetalle()" aria-label="Cerrar">${icon('x','icon-16')}</button>
        </div>
      </div>
      <div class="detalle-tabla-wrap">
        <table class="detalle-tabla">
          <thead>
            <tr>
              <th>Empleado</th>
              <th>Local</th>
              <th>Turno</th>
              <th>Tipo</th>
              <th>Horas</th>
              <th>Nota</th>
            </tr>
          </thead>
          <tbody>${bodyHtml}</tbody>
        </table>
      </div>
    </div>
  </div>`;

  const existing = document.getElementById('detalleOverlay');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.id = 'detalleOverlay';
  div.innerHTML = html;
  document.body.appendChild(div);
  document.body.style.overflow = 'hidden';
}

function abrirDetalleEmpleadoPeriodo(nombreEmp, modo) {
  // modo: 'semana' o 'mes'
  let datosFiltrados = state.datos.filter(r => r.EMPLEADO === nombreEmp);

  if (modo === 'semana') {
    datosFiltrados = getDatosSemana(datosFiltrados, state.semanaOffset);
  } else if (modo === 'mes') {
    datosFiltrados = getDatosMes(datosFiltrados, state.mesOffset);
  }

  if (!datosFiltrados.length) { showToast('Sin registros en este período'); return; }
  const sucId = (EMPLEADOS_PERFILES[nombreEmp]?.sucursal_id) || datosFiltrados[0]?.LOCAL || '';
  // Llamar abrirDetalleEmpleado pero con datos ya filtrados por período
  abrirDetalleEmpleadoConDatos(nombreEmp, sucId, datosFiltrados);
}

function imprimirDetalleEmpleado() {
  // Crear ventana de impresión con solo el contenido del detalle
  const panel = document.querySelector('#detalleOverlay .detalle-panel');
  if (!panel) return;

  const win = window.open('', '_blank');
  win.document.write(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>Jornada CROMA</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', Arial, sans-serif; font-size: 12px; color: #000; padding: 20px; }
        .detalle-header { padding: 12px 0 16px; border-bottom: 2px solid #000; margin-bottom: 16px; }
        .detalle-titulo { font-size: 20px; font-weight: 700; letter-spacing: 1px; margin-bottom: 4px; }
        .detalle-sub { font-size: 12px; color: #666; margin-bottom: 12px; }
        .detalle-stats-row { display: flex; gap: 2rem; }
        .detalle-stat { display: flex; flex-direction: column; }
        .detalle-stat-val { font-size: 22px; font-weight: 700; }
        .detalle-stat-lbl { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        th { padding: 7px 8px; background: #f1f5f9; font-size: 10px; font-weight: 600;
             text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #ddd; text-align: left; }
        td { padding: 6px 8px; border-bottom: 1px solid #f0f0f0; }
        tr.fila-sabado td { background: #fffbeb; }
        tfoot td { background: #f8fafc; border-top: 2px solid #ddd; font-weight: 600; }
        .detalle-acciones { display: none; }
        .detalle-close, .detalle-close-btn { display: none; }
        .detalle-footer { display: none; }
        @media print { body { padding: 10px; } }
      </style>
    </head>
    <body>
      ${panel.outerHTML}
    </body>
    </html>
  `);
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 400);
}

function descargarExcelEmpleado(nombreEmp, nomMostrar, sucNombre) {
  // Cargar SheetJS dinámicamente si no está cargado
  if (typeof XLSX === 'undefined') {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    script.onload = () => descargarExcelEmpleado(nombreEmp, nomMostrar, sucNombre);
    document.head.appendChild(script);
    showToast('Preparando Excel...');
    return;
  }

  const registros = state.datos
    .filter(r => r.EMPLEADO === nombreEmp)
    .sort((a, b) => {
      const fa = new Date(a.AÑO, MESES_ES.indexOf(a.MES), parseInt(a.DIA));
      const fb = new Date(b.AÑO, MESES_ES.indexOf(b.MES), parseInt(b.DIA));
      return fa - fb;
    });

  if (!registros.length) return;

  const porFecha = {};
  registros.forEach(r => {
    const key = `${r.AÑO}-${r.MES}-${r.DIA}`;
    if (!porFecha[key]) porFecha[key] = [];
    porFecha[key].push(r);
  });

  const DIAS_SEM = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

  const filas = Object.entries(porFecha).map(([key, regs]) => {
    regs.sort((a,b) => (a.H_ENTRADA||'').localeCompare(b.H_ENTRADA||''));
    const r0 = regs[0];
    const fecha = new Date(r0.AÑO, MESES_ES.indexOf(r0.MES), parseInt(r0.DIA));
    const fechaStr = fecha.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
    const diaSem  = DIAS_SEM[fecha.getDay()];
    const esSab   = fecha.getDay() === 6;

    let horaReg = '';
    if (r0.MARCA_TEMPORAL) {
      try { horaReg = new Date(r0.MARCA_TEMPORAL).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' }); } catch(e) {}
    }

    const turno1  = r0.H_ENTRADA && r0.H_SALIDA ? `${r0.H_ENTRADA} - ${r0.H_SALIDA}` : '';
    const turno2  = regs[1]?.H_ENTRADA ? `${regs[1].H_ENTRADA} - ${regs[1].H_SALIDA}` : '';
    const hsTotal = regs.reduce((a,r) => a + (parseFloat(r.TOTAL_HS)||0), 0);
    const hsExtra   = calcularHsExtra(nombreEmp, hsTotal, fecha);
    const hsFeriado = calcularHsFeriado(hsTotal, fecha);
    const nota    = regs.map(r => r.NOTA).filter(Boolean).join(' / ');
    const local   = regs.map(r => {
      const s = SUCURSALES_TODAS.find(x => x.id === r.LOCAL);
      return s ? s.nombre : r.LOCAL;
    }).filter((v,i,a) => a.indexOf(v)===i).join(', ');

    return { fechaStr, diaSem, horaReg, turno1, turno2, hsTotal, hsExtra, hsFeriado, esSab, local, nota };
  });

  const totalHoras   = filas.reduce((a,f) => a + f.hsTotal, 0);
  const totalExtra   = filas.reduce((a,f) => a + f.hsExtra, 0);
  const totalFeriado = filas.reduce((a,f) => a + (f.hsFeriado||0), 0);
  const totalSabs    = filas.filter(f => f.esSab).length;

  // ── Construir workbook ──
  const wb = XLSX.utils.book_new();
  const ws_data = [];

  // Fila 1: título
  ws_data.push([`DETALLE DE JORNADA — ${nomMostrar.toUpperCase()}`, '', '', '', '', '', '', '', '', '']);
  // Fila 2: sucursal y fecha generación
  ws_data.push([sucNombre, '', '', '', '', '', `Generado: ${new Date().toLocaleDateString('es-AR')}`, '', '', '']);
  // Fila 3: vacía
  ws_data.push([]);
  // Fila 4: encabezados
  ws_data.push(['FECHA','DÍA','HORA REG.','TURNO 1','TURNO 2','HS TOTAL','HS EXTRA','HS FERIADO','SÁBADO','LOCAL','NOTA']);
  // Filas de datos
  filas.forEach(f => {
    ws_data.push([
      f.fechaStr, f.diaSem, f.horaReg,
      f.turno1, f.turno2,
      f.hsTotal, f.hsExtra > 0 ? f.hsExtra : 0, f.hsFeriado > 0 ? f.hsFeriado : 0,
      f.esSab ? 'Sí' : '',
      f.local, f.nota
    ]);
  });
  // Fila vacía
  ws_data.push([]);
  // Fila totales
  ws_data.push(['TOTALES', '', filas.length + ' días', '', '', totalHoras, totalExtra, totalFeriado, totalSabs, '', '']);

  const ws = XLSX.utils.aoa_to_sheet(ws_data);

  // ── Anchos de columna ──
  ws['!cols'] = [
    { wch: 12 }, // FECHA
    { wch: 6  }, // DÍA
    { wch: 10 }, // HORA REG
    { wch: 14 }, // TURNO 1
    { wch: 14 }, // TURNO 2
    { wch: 9  }, // HS TOTAL
    { wch: 9  }, // HS EXTRA
    { wch: 10 }, // HS FERIADO
    { wch: 7  }, // SÁBADO
    { wch: 16 }, // LOCAL
    { wch: 35 }, // NOTA
  ];

  // ── Estilos (negrita en encabezados y totales) ──
  const headerRow = 3; // índice 0-based fila 4
  const totalRow  = ws_data.length - 1;
  const cols = ['A','B','C','D','E','F','G','H','I','J','K'];

  // Título — fila 1
  if (ws['A1']) {
    ws['A1'].s = { font: { bold: true, sz: 14 }, fill: { fgColor: { rgb: '0D0D0D' } }, font: { bold: true, sz: 14, color: { rgb: 'FFFFFF' } } };
  }
  // Encabezados — fila 4
  cols.forEach(c => {
    const cell = ws[`${c}4`];
    if (cell) cell.s = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '1E293B' } },
      alignment: { horizontal: 'center' }
    };
  });
  // Totales — última fila
  const totRef = `A${ws_data.length}`;
  if (ws[totRef]) ws[totRef].s = { font: { bold: true } };

  // Merge título
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }, // título
    { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } }, // sucursal
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Jornada');

  const fileName = `CROMA_${nomMostrar.replace(/\s+/g,'_')}.xlsx`;
  XLSX.writeFile(wb, fileName);
  showToast(`✓ Descargado: ${fileName}`);
}

function switchDetalleTab(tab, btn) {
  document.querySelectorAll('.detalle-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('detalleTabJornada').style.display  = tab === 'jornada'    ? 'block' : 'none';
  document.getElementById('detalleTabEvolucion').style.display = tab === 'evolucion'  ? 'block' : 'none';
  const vacEl = document.getElementById('detalleTabVacaciones');
  if (vacEl) vacEl.style.display = tab === 'vacaciones' ? 'block' : 'none';
  const bhEl = document.getElementById('detalleTabBancoHoras');
  if (bhEl) bhEl.style.display = tab === 'bancoHoras' ? 'block' : 'none';
  if (tab === 'vacaciones' || tab === 'bancoHoras') {
    const tituloEl = document.querySelector('.detalle-titulo');
    if (tituloEl) {
      const nomDiv = tituloEl.textContent.trim().replace(/^#\d+\s*/,'').trim();
      const empNombre = state.datos.find(r => {
        const n = r.EMPLEADO.replace(/^\d+\s+/,'').trim();
        return n.toLowerCase() === nomDiv.toLowerCase();
      })?.EMPLEADO || nomDiv;
      if (tab === 'vacaciones') cargarVacacionesAdmin(empNombre);
      if (tab === 'bancoHoras') cargarBancoHorasDetalleAdmin(empNombre);
    }
  }
}

function generarEvolucionHTML(datos, nombreEmp, suc) {
  const registros = datos.filter(r => r.EMPLEADO === nombreEmp);
  if (!registros.length) return '<p style="color:#999;font-size:13px">Sin datos históricos.</p>';

  // Agrupar por mes
  const porMes = {};
  registros.forEach(r => {
    const key = `${r.AÑO}||${r.MES}`;
    if (!porMes[key]) porMes[key] = { horas: 0, dias: new Set(), hsExtra: 0, hsFeriado: 0, sabados: new Set() };
    const hs = parseFloat(r.TOTAL_HS) || 0;
    const fecha = new Date(r.AÑO, MESES_ES.indexOf(r.MES), parseInt(r.DIA));
    porMes[key].horas += hs;
    porMes[key].dias.add(r.DIA);
    if (esFeriado(fecha)) {
      porMes[key].hsFeriado += hs;                 // feriado: aparte, no cuenta como extra
    } else if (hs > 8) {
      porMes[key].hsExtra += hs - 8;
    }
    const dow = fecha.getDay();
    if (dow === 6) porMes[key].sabados.add(r.DIA);
  });

  const meses = Object.entries(porMes).sort((a, b) => {
    const [aY, aM] = a[0].split('||');
    const [bY, bM] = b[0].split('||');
    return (parseInt(aY)*12 + MESES_ES.indexOf(aM)) - (parseInt(bY)*12 + MESES_ES.indexOf(bM));
  });

  const maxHoras = Math.max(...meses.map(([,v]) => v.horas)) || 1;

  // Tabla + mini barras
  const filas = meses.map(([key, v]) => {
    const [anio, mes] = key.split('||');
    const pct = (v.horas / maxHoras * 100).toFixed(0);
    return `<tr>
      <td style="white-space:nowrap;font-weight:500">${mes} ${anio}</td>
      <td>${v.dias.size}</td>
      <td>
        <div class="comp-bar-row">
          <div class="comp-bar" style="width:${pct}%;background:${suc.color}"></div>
          <span><strong>${v.horas.toFixed(0)}</strong>h</span>
        </div>
      </td>
      <td>${v.hsExtra > 0 ? `<span class="hs-extra">${v.hsExtra.toFixed(0)}h</span>` : '—'}</td>
      <td>${v.hsFeriado > 0 ? `<span class="hs-feriado">${v.hsFeriado.toFixed(0)}h</span>` : '—'}</td>
      <td>${v.sabados.size || '—'}</td>
    </tr>`;
  }).join('');

  const totalH = meses.reduce((a,[,v]) => a + v.horas, 0);
  const promH  = meses.length ? totalH / meses.length : 0;

  return `
    <div style="margin-bottom:1rem;display:flex;gap:2rem">
      <div><span style="font-size:22px;font-weight:700;font-family:'Bebas Neue'">${meses.length}</span><br><span style="font-size:11px;color:var(--text-muted);text-transform:uppercase">Meses</span></div>
      <div><span style="font-size:22px;font-weight:700;font-family:'Bebas Neue'">${totalH.toFixed(0)}</span><br><span style="font-size:11px;color:var(--text-muted);text-transform:uppercase">Hs totales</span></div>
      <div><span style="font-size:22px;font-weight:700;font-family:'Bebas Neue'">${promH.toFixed(0)}</span><br><span style="font-size:11px;color:var(--text-muted);text-transform:uppercase">Hs promedio/mes</span></div>
    </div>
    <table class="detalle-tabla">
      <thead><tr><th>Mes</th><th>Días</th><th>Horas</th><th>Hs extra</th><th>Hs feriado</th><th>Sábados</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>`;
}

function cerrarDetalle(event) {
  if (event && event.target !== event.currentTarget) return;
  const el = document.getElementById('detalleOverlay');
  if (el) el.remove();
  document.body.style.overflow = '';
}

