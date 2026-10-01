// ── FICHADAS — Administración › Fichadas (Fase 1) ──────
// Consulta + descarga vía croma-backend (JWT admin/jefe) → GAS
// (accion=exportar_fichadas, protegida por BACKEND_SECRET). Nunca llama a
// GAS directo desde acá — mismo patrón que el resto de Administración.
let _fichadasUltimaConsulta = null; // { total, colaboradores, sin_empresa, preview }
let _fichadasCargando = false;
let _fichadasDebounceTimer = null;

function renderFichadasTab() {
  const cont = document.getElementById('adminTabFichadas');
  if (!cont) return;

  const hoy = new Date();
  const anioActual = hoy.getFullYear();
  const MESES_LBL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const empNombres = obtenerEmpleadosAdmin().map(e => e.nombre).sort();

  cont.innerHTML =
    "<div class='admin-head'>" +
      "<h1>Fichadas</h1>" +
      "<p>Consultá y descargá fichadas filtradas por período, empresa, sucursal o colaborador.</p>" +
    "</div>" +
    "<div class='filters-bar' style='flex-wrap:wrap'>" +
      "<select class='f-select' id='fichAnio' aria-label='Año' onchange='_fichadasConsultar()'>" +
        "<option value=''>Todos los años</option>" +
        [anioActual, anioActual - 1, anioActual - 2].map(a => `<option value="${a}" ${a === anioActual ? 'selected' : ''}>${a}</option>`).join('') +
      "</select>" +
      "<select class='f-select' id='fichMes' aria-label='Mes' onchange='_fichadasConsultar()'>" +
        "<option value=''>Todos los meses</option>" +
        MESES_LBL.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('') +
      "</select>" +
      "<select class='f-select' id='fichEmpresa' aria-label='Empresa' onchange='_fichadasConsultar()'>" +
        "<option value=''>Todas las empresas</option>" +
        EMPRESAS.map(e => `<option value="${e}">${e}</option>`).join('') +
      "</select>" +
      "<select class='f-select' id='fichSucursal' aria-label='Sucursal' onchange='_fichadasConsultar()'>" +
        "<option value=''>Todas las sucursales</option>" +
        SUCURSALES_TODAS.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('') +
      "</select>" +
      "<input type='text' class='f-select' id='fichColaborador' aria-label='Buscar colaborador' list='fichColaboradorList' placeholder='Todos los colaboradores (nómina completa)' oninput='_fichadasConsultarDebounced()' style='min-width:220px' />" +
      "<datalist id='fichColaboradorList'>" + empNombres.map(n => `<option value="${n}">`).join('') + "</datalist>" +
      "<button class='f-clear' onclick='_fichadasLimpiarFiltros()'>Limpiar</button>" +
    "</div>" +
    "<div class='card' id='fichAlcanceCard' style='padding:14px 16px;margin:14px 0'>" +
      "<div style='display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap'>" +
        "<div style='flex:1;min-width:220px'>" +
          "<div id='fichAlcanceResumen' style='font-size:13px;color:var(--text-secondary);line-height:1.7'></div>" +
          "<div class='stat-strip' id='fichStats' style='margin-top:10px'></div>" +
        "</div>" +
        "<button class='btn-connect' id='fichBtnDescargar' style='width:auto;padding:0 18px;height:38px;margin:0;display:inline-flex;align-items:center;gap:7px;white-space:nowrap' disabled onclick='_fichadasDescargar()'>" + icon('download','icon-16') + " Descargar CSV</button>" +
      "</div>" +
    "</div>" +
    "<div class='dt-wrap'>" +
      "<div class='dt-scroll'>" +
      "<table class='dt-table' id='fichTablaPreview'>" +
        "<thead><tr><th>Empresa</th><th>Sucursal</th><th>Empleado</th><th>Fecha</th><th>Entrada</th><th>Salida</th><th>Total hs</th><th>Estado</th></tr></thead>" +
        "<tbody id='fichTablaPreviewBody'></tbody>" +
      "</table>" +
      "</div>" +
    "</div>";

  _fichadasConsultar();
}

function _fichadasConsultarDebounced() {
  clearTimeout(_fichadasDebounceTimer);
  _fichadasDebounceTimer = setTimeout(_fichadasConsultar, 400);
}

function _fichadasFiltrosActuales() {
  return {
    anio:        document.getElementById('fichAnio')?.value || '',
    mes:         document.getElementById('fichMes')?.value || '',
    empresa:     document.getElementById('fichEmpresa')?.value || '',
    sucursal:    document.getElementById('fichSucursal')?.value || '',
    colaborador: document.getElementById('fichColaborador')?.value.trim() || '',
  };
}

function _fichadasLimpiarFiltros() {
  ['fichAnio', 'fichMes', 'fichEmpresa', 'fichSucursal', 'fichColaborador'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  _fichadasConsultar();
}

function _fichadasQueryString(filtros) {
  const qs = new URLSearchParams();
  if (filtros.anio) qs.set('anio', filtros.anio);
  if (filtros.mes) qs.set('mes', filtros.mes);
  if (filtros.empresa) qs.set('empresa', filtros.empresa);
  if (filtros.sucursal) qs.set('sucursal', filtros.sucursal);
  if (filtros.colaborador) qs.set('colaborador', filtros.colaborador);
  return qs.toString();
}

function _fichadasDescribirAlcance(f) {
  const MESES_LBL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  let periodo;
  if (f.anio && f.mes)      periodo = `${MESES_LBL[Number(f.mes) - 1]} ${f.anio}`;
  else if (f.anio)          periodo = `Año ${f.anio} (todos los meses)`;
  else if (f.mes)           periodo = `${MESES_LBL[Number(f.mes) - 1]} (todos los años)`;
  else                      periodo = 'Todo el historial';

  const sucNombre = f.sucursal ? (SUCURSALES_TODAS.find(s => s.id === f.sucursal)?.nombre || f.sucursal) : 'Todas';

  return {
    periodo,
    empresa:     f.empresa || 'Todas',
    sucursal:    sucNombre,
    colaborador: f.colaborador || 'Nómina completa',
  };
}

async function _fichadasConsultar() {
  const cont = document.getElementById('adminTabFichadas');
  if (!cont) return;
  const filtros = _fichadasFiltrosActuales();
  const alcance = _fichadasDescribirAlcance(filtros);
  const btn = document.getElementById('fichBtnDescargar');

  _fichadasCargando = true;
  if (btn) btn.disabled = true;

  const resumenEl = document.getElementById('fichAlcanceResumen');
  const statsEl   = document.getElementById('fichStats');
  if (resumenEl) {
    resumenEl.innerHTML =
      `<strong>Período:</strong> ${alcance.periodo} &nbsp;·&nbsp; ` +
      `<strong>Empresa:</strong> ${alcance.empresa} &nbsp;·&nbsp; ` +
      `<strong>Sucursal:</strong> ${alcance.sucursal} &nbsp;·&nbsp; ` +
      `<strong>Colaborador:</strong> ${alcance.colaborador}`;
  }
  if (statsEl) statsEl.innerHTML = `<div class='stat-item'><span class='stat-num'>…</span><span class='stat-label'>consultando</span></div>`;

  const data = await apiFichadas(`/exportar?${_fichadasQueryString(filtros)}`, { method: 'GET' });
  _fichadasCargando = false;

  const tbody = document.getElementById('fichTablaPreviewBody');

  if (!data.ok) {
    if (statsEl) statsEl.innerHTML = `<div class='alert alert-danger' style='margin:0'>${icon('alertTriangle','icon-16')} ${data.error || 'No se pudo consultar las fichadas.'}</div>`;
    if (tbody) tbody.innerHTML = "<tr><td colspan='8' style='text-align:center;padding:2rem;color:var(--text-muted)'>—</td></tr>";
    _fichadasUltimaConsulta = null;
    if (btn) btn.disabled = true;
    return;
  }

  _fichadasUltimaConsulta = data;

  if (statsEl) {
    statsEl.innerHTML =
      `<div class='stat-item'><span class='stat-num'>${data.total}</span><span class='stat-label'>fichadas encontradas</span></div>` +
      `<span class='stat-sep'></span>` +
      `<div class='stat-item'><span class='stat-num'>${data.colaboradores}</span><span class='stat-label'>colaboradores</span></div>` +
      `<span class='stat-sep'></span>` +
      `<div class='stat-item'><span class='stat-num' style='${data.sin_empresa > 0 ? 'color:var(--warning)' : ''}'>${data.sin_empresa}</span><span class='stat-label'>sin empresa asociada</span></div>`;
  }

  if (tbody) {
    if (!data.preview.length) {
      tbody.innerHTML = "<tr><td colspan='8' style='text-align:center;padding:2.5rem;color:var(--text-muted);font-size:13px'>Sin fichadas para este filtro.</td></tr>";
    } else {
      tbody.innerHTML = data.preview.map(f =>
        `<tr><td>${f.empresa || '—'}</td><td>${f.sucursal}</td><td>${f.empleado}</td><td>${f.fecha}</td><td>${f.entrada}</td><td>${f.salida_hs}</td><td>${f.total}</td><td>${f.estado}</td></tr>`
      ).join('');
      if (data.total > data.preview.length) {
        tbody.innerHTML += `<tr><td colspan='8' style='text-align:center;padding:10px;color:var(--text-muted);font-size:12px'>… y ${data.total - data.preview.length} fichadas más (vista previa limitada a ${data.preview.length})</td></tr>`;
      }
    }
  }

  if (btn) btn.disabled = data.total === 0;
}

async function _fichadasDescargar() {
  if (_fichadasCargando || !_fichadasUltimaConsulta || _fichadasUltimaConsulta.total === 0) return;
  const btn = document.getElementById('fichBtnDescargar');
  if (btn) btn.disabled = true;

  const filtros = _fichadasFiltrosActuales();

  try {
    const resp = await fetch(`${BACKEND_URL}/api/fichadas/exportar.csv?${_fichadasQueryString(filtros)}`, {
      headers: { 'Authorization': `Bearer ${_getToken()}` },
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      showToast(err.error || 'No se pudo descargar el archivo');
      return;
    }
    const blob = await resp.blob();
    const cd = resp.headers.get('Content-Disposition') || '';
    const nombreArchivo = (cd.match(/filename="(.+)"/) || [])[1] || 'fichadas.csv';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast('Error de conexión al descargar');
  } finally {
    if (btn) btn.disabled = !_fichadasUltimaConsulta || _fichadasUltimaConsulta.total === 0;
  }
}

async function buscarJornadasAjuste() {
  const empleado = document.getElementById('ajusteBuscarEmp')?.value.trim();
  const mes = parseInt(document.getElementById('ajusteMes')?.value);
  const anio = parseInt(document.getElementById('ajusteAnio')?.value);
  const resEl = document.getElementById('ajusteResultados');
  if (!resEl) return;

  if (!empleado) {
    resEl.innerHTML = "<div class='alert alert-warning'>" + icon('alertTriangle', 'icon-16') + " Ingresá un nombre de empleado para buscar.</div>";
    return;
  }

  const registro = state.datos.find(r => r.EMPLEADO === empleado);
  if (!registro) {
    resEl.innerHTML = "<div class='alert alert-danger'>" + icon('alertTriangle', 'icon-16') + " No se encontró ningún empleado con ese nombre exacto.</div>";
    return;
  }
  const local = registro.LOCAL;

  resEl.innerHTML = "<div class='ajuste-empty-state'><div class='spinner' role='status' aria-label='Cargando'></div><p class='text-secondary'>Buscando jornadas...</p></div>";

  try {
    // Fase 8A: lectura vía croma-backend (JWT admin/jefe/horarios, Sheets API)
    // en vez de accion=get_fichadas_empleado (GAS) — mismo contrato
    // {ok, fichadas}. fichar.html/kiosco.html siguen en GAS (fuera de 8A).
    const json = await apiFichadas(`/empleado?empleado=${encodeURIComponent(empleado)}&incluir_anuladas=1`, { method: 'GET' });
    if (!json.ok) throw new Error(json.error || 'Error al cargar las jornadas');

    const periodo = `${anio}-${String(mes).padStart(2, '0')}`;
    const fichadasPeriodo = (json.fichadas || []).filter(f => f.fecha.startsWith(periodo));
    const jornadas = _agruparFichadasEnJornadas(empleado, local, fichadasPeriodo)
      .sort((a, b) => b.fecha.localeCompare(a.fecha));

    jornadas.forEach(j => { JORNADAS_AJUSTE_CACHE[`${j.empleado}|${j.fecha}`] = j; });

    if (!jornadas.length) {
      resEl.innerHTML = "<div class='ajuste-empty-state'>" + icon('fileText', 'icon-48') + "<p class='text-secondary'>No hay jornadas para ese empleado en ese período.</p></div>";
      return;
    }

    resEl.innerHTML = renderTablaAjusteJornada(jornadas);
  } catch (e) {
    resEl.innerHTML = "<div class='alert alert-danger'>" + icon('alertTriangle', 'icon-16') + " No se pudieron cargar las jornadas. Revisá la conexión e intentá de nuevo.</div>";
  }
}

function renderTablaAjusteJornada(filas) {
  const fmtTurno = t => {
    if (!t) return '<span class="text-muted">—</span>';
    const anulado = t.estado === 'ANULADA' ? ' <span class="badge badge-neutral" style="margin-left:4px">Anulado</span>' : '';
    return `${t.entrada}–${t.salida}${anulado}`;
  };
  const filasHTML = filas.map(j => {
    const totalHs = _calcularHsJornada(j);
    const empEnc = j.empleado.replace(/'/g, "\\'");
    const ajustada = AJUSTES_SESSION.has(`${j.empleado}|${j.fecha}`);
    return "<tr>" +
      `<td>${_fechaDisplay(j.fecha)}</td>` +
      `<td>${fmtTurno(j.turno1)}</td>` +
      `<td>${fmtTurno(j.turno2)}</td>` +
      `<td><strong>${totalHs.toFixed(1)}</strong></td>` +
      `<td>${ajustada ? `<span class="badge badge-info">${icon('edit', 'icon-12')} Ajustada</span>` : '<span class="text-muted" style="font-size:12px">—</span>'}</td>` +
      `<td><button class="btn-icon" title="Ajustar jornada" aria-label="Ajustar jornada del ${_fechaDisplay(j.fecha)}" onclick="abrirModalAjusteJornada('${empEnc}','${j.fecha}')">${icon('edit', 'icon-16')}</button></td>` +
      "</tr>";
  }).join('');

  return "<div class='admin-table-wrap'>" +
    "<table class='admin-tabla'>" +
      "<thead><tr><th>Fecha</th><th>Turno 1</th><th>Turno 2</th><th>Hs total</th><th>Estado</th><th></th></tr></thead>" +
      "<tbody>" + filasHTML + "</tbody>" +
    "</table>" +
  "</div>";
}

function _calcularHsJornada(j) {
  const hsTurno = t => {
    if (!t || t.estado === 'ANULADA') return 0;
    const [eh, em] = t.entrada.split(':').map(Number);
    const [sh, sm] = t.salida.split(':').map(Number);
    let hs = (sh * 60 + sm - (eh * 60 + em)) / 60;
    if (hs < 0) hs += 24;
    return hs;
  };
  return hsTurno(j.turno1) + hsTurno(j.turno2);
}

// ── Modal "Ajuste de jornada" (comparador Antes → Después) ────

function abrirModalAjusteJornada(empleado, fechaISO) {
  const key = `${empleado}|${fechaISO}`;
  const j = JORNADAS_AJUSTE_CACHE[key];
  if (!j) { showToast('No se encontró la jornada'); return; }

  const nomMatch = empleado.match(/^(\d+)\s+(.+)$/);
  const nomMostrar = nomMatch ? nomMatch[2] : empleado;
  const motivoOpts = MOTIVOS_AJUSTE.map(m => `<option value="${m.id}">${m.label}</option>`).join('');

  const turnoBlock = (n, t) => {
    const activo = t && t.estado !== 'ANULADA';
    return `
    <div class="admin-form-grupo ajuste-turno-block">
      <label class="emp-filtro-label">Turno ${n}</label>
      <div class="ajuste-diff-row">
        <div class="ajuste-diff-antes">
          <span class="ajuste-diff-tag">Antes</span>
          <span>${activo ? `${t.entrada} – ${t.salida}` : '<span class="text-muted">Sin turno</span>'}</span>
        </div>
        <div class="ajuste-diff-arrow">${icon('arrowRight', 'icon-16')}</div>
        <div class="ajuste-diff-despues">
          <span class="ajuste-diff-tag">Después</span>
          <div style="display:flex;gap:6px;align-items:center">
            <input type="time" class="admin-input" id="ajusteEntrada${n}" aria-label="Hora de entrada, turno ${n}" value="${activo ? t.entrada : ''}" onchange="onAjusteCampoChange(${n})" style="margin:0" />
            <span class="text-muted">–</span>
            <input type="time" class="admin-input" id="ajusteSalida${n}" aria-label="Hora de salida, turno ${n}" value="${activo ? t.salida : ''}" onchange="onAjusteCampoChange(${n})" style="margin:0" />
          </div>
        </div>
      </div>
      <p id="ajusteDiffTexto${n}" class="ajuste-diff-texto"></p>
    </div>`;
  };

  const html = `
  <div class="admin-overlay" id="adminOverlay" onclick="cerrarAdmin(event)">
    <div class="admin-panel" onclick="event.stopPropagation()">
      <div class="admin-header">
        <div class="admin-titulo">Ajuste de jornada — ${nomMostrar} · ${_fechaDisplay(fechaISO)}</div>
        <button class="detalle-close" onclick="cerrarAdmin()" aria-label="Cerrar">${icon('x', 'icon-16')}</button>
      </div>
      <div class="admin-form">
        ${turnoBlock(1, j.turno1)}
        ${turnoBlock(2, j.turno2)}

        <div class="admin-form-grupo ajuste-diff-row" style="align-items:center">
          <div class="ajuste-diff-antes">
            <span class="ajuste-diff-tag">Antes</span>
            <span>${j.recupera_horas ? 'Sí' : 'No'}</span>
          </div>
          <div class="ajuste-diff-arrow">${icon('arrowRight', 'icon-16')}</div>
          <div class="ajuste-diff-despues">
            <span class="ajuste-diff-tag">Después</span>
            <label class="form-switch"><input type="checkbox" id="ajusteRecuperaHoras" aria-label="Recupera horas" ${j.recupera_horas ? 'checked' : ''}><span class="switch-track"></span></label>
          </div>
        </div>

        <div class="admin-form-grupo">
          <label class="emp-filtro-label" for="ajusteCertificado">Certificado <span class="text-muted" style="font-weight:400">(se guarda aparte, en Certificados)</span></label>
          <select class="admin-input" id="ajusteCertificado">
            <option value="">Sin certificado</option>
            ${TIPOS_CERTIFICADO.map(t => `<option value="${t}">${t}</option>`).join('')}
          </select>
        </div>

        <div class="admin-form-grupo ajuste-diff-row">
          <div class="ajuste-diff-antes">
            <span class="ajuste-diff-tag">Antes</span>
            <span>${j.observacion ? esc(j.observacion) : '<span class="text-muted">Sin observación</span>'}</span>
          </div>
          <div class="ajuste-diff-arrow">${icon('arrowRight', 'icon-16')}</div>
          <div class="ajuste-diff-despues">
            <span class="ajuste-diff-tag">Después</span>
            <textarea class="admin-input" id="ajusteObservacion" aria-label="Observación" rows="2" style="margin:0;height:auto;min-height:64px;padding:10px 12px;resize:vertical;font-family:inherit">${j.observacion || ''}</textarea>
          </div>
        </div>

        <div class="admin-form-grupo">
          <label class="emp-filtro-label" for="ajusteMotivo">Motivo del ajuste *</label>
          <select class="admin-input" id="ajusteMotivo" onchange="onMotivoAjusteChange()">
            <option value="">Seleccioná un motivo</option>
            ${motivoOpts}
          </select>
        </div>
        <div class="admin-form-grupo" id="ajusteMotivoDetalleGrupo" style="display:none">
          <label class="emp-filtro-label" for="ajusteMotivoDetalle">Detalle del motivo *</label>
          <input type="text" class="admin-input" id="ajusteMotivoDetalle" placeholder="Detallá el motivo del ajuste" />
        </div>

        <p id="ajusteError" class="form-error" style="display:none;margin-bottom:0.5rem"></p>

        <div style="display:flex;flex-direction:column;gap:8px;margin-top:1rem">
          <button class="btn-connect" style="margin:0" onclick="confirmarAjusteJornada('${empleado.replace(/'/g, "\\'")}','${fechaISO}')">
            Guardar ajuste
          </button>
          <button class="btn-demo" onclick="cerrarAdmin()">Cancelar</button>
        </div>
      </div>
    </div>
  </div>`;

  montarOverlayAdmin(html);
}

function onAjusteCampoChange(turno) {
  const entrada = document.getElementById(`ajusteEntrada${turno}`)?.value;
  const salida = document.getElementById(`ajusteSalida${turno}`)?.value;
  const texto = document.getElementById(`ajusteDiffTexto${turno}`);
  if (!texto) return;
  texto.textContent = (!entrada && !salida) ? '' : `Nuevo turno ${turno}: ${entrada || '—'} – ${salida || '—'}`;
}

function onMotivoAjusteChange() {
  const motivo = document.getElementById('ajusteMotivo')?.value;
  const grupo = document.getElementById('ajusteMotivoDetalleGrupo');
  if (grupo) grupo.style.display = motivo === 'otro' ? 'block' : 'none';
}

async function confirmarAjusteJornada(empleado, fechaISO) {
  const errEl = document.getElementById('ajusteError');
  errEl.style.display = 'none';

  const key = `${empleado}|${fechaISO}`;
  const j = JORNADAS_AJUSTE_CACHE[key];
  if (!j) { showToast('No se encontró la jornada'); return; }

  const leerTurno = n => ({
    entrada: document.getElementById(`ajusteEntrada${n}`)?.value || null,
    salida: document.getElementById(`ajusteSalida${n}`)?.value || null,
  });
  const t1 = leerTurno(1), t2 = leerTurno(2);
  const motivo = document.getElementById('ajusteMotivo')?.value;
  const motivoDetalle = document.getElementById('ajusteMotivoDetalle')?.value.trim();
  const recuperaHoras = document.getElementById('ajusteRecuperaHoras')?.checked;
  const observacion = document.getElementById('ajusteObservacion')?.value.trim();

  const err = m => { errEl.textContent = m; errEl.style.display = 'block'; };

  if (!motivo) return err('Elegí un motivo para el ajuste.');
  if (motivo === 'otro' && !motivoDetalle) return err('Detallá el motivo del ajuste.');
  if ((t1.entrada && !t1.salida) || (!t1.entrada && t1.salida)) return err('Completá entrada y salida del Turno 1.');
  if ((t2.entrada && !t2.salida) || (!t2.entrada && t2.salida)) return err('Completá entrada y salida del Turno 2.');
  if (!t1.entrada && !t2.entrada) return err('La jornada no puede quedar sin ningún turno.');
  if (t2.entrada && !t1.entrada) return err('No puede haber Turno 2 sin Turno 1.');
  if (t1.entrada && t1.salida && t1.entrada >= t1.salida) return err('La salida del Turno 1 debe ser posterior a la entrada.');
  if (t2.entrada && t2.salida && t2.entrada >= t2.salida) return err('La salida del Turno 2 debe ser posterior a la entrada.');

  const payload = {
    empleado, local: j.local,
    fecha_jornada: fechaISO, fecha_jornada_original: fechaISO,
    id_fichada_turno1: j.turno1?.id_fichada || null,
    entrada1: t1.entrada, salida1: t1.salida,
    turno1_original: j.turno1 ? { entrada: j.turno1.entrada, salida: j.turno1.salida, estado: j.turno1.estado } : null,
    id_fichada_turno2: j.turno2?.id_fichada || null,
    entrada2: t2.entrada, salida2: t2.salida,
    turno2_original: j.turno2 ? { entrada: j.turno2.entrada, salida: j.turno2.salida, estado: j.turno2.estado } : null,
    recupera_horas: !!recuperaHoras,
    observacion: observacion || '',
    motivo, motivo_detalle: motivo === 'otro' ? motivoDetalle : null,
    admin_usuario: sesionActual?.nombre || '',
    timestamp_cliente: new Date().toISOString(),
  };

  const btn = document.querySelector('#adminOverlay .btn-connect');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

  try {
    const json = await apiFichadas('/ajustar', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (!json.ok) {
      err(json.mensaje || 'No se pudo guardar el ajuste.');
      if (btn) { btn.disabled = false; btn.textContent = 'Guardar ajuste'; }
      return;
    }

    AJUSTES_SESSION.add(key);
    cerrarAdmin();
    showToast('✓ Jornada ajustada correctamente');
    buscarJornadasAjuste();
  } catch (e) {
    err('No se pudo conectar con el servidor. Revisá la conexión e intentá de nuevo.');
    if (btn) { btn.disabled = false; btn.textContent = 'Guardar ajuste'; }
  }
}

// ══════════════════════════════════════════════════════
//  ADMINISTRACIÓN UNIFICADA: EMPLEADOS + ACCESO (Commit 3)
// ══════════════════════════════════════════════════════
// Reemplaza el modal de empleado + la tab de usuarios por una única ficha
// por empleado (Perfil / Datos laborales / Acceso). Todo lo que toca
// acceso (usuario/PIN/estado/número Sysneo) va contra croma-backend
// (Node, JWT) — rutas exactas confirmadas contra
// croma-backend/src/routes/empleados.js y mi-perfil.js (Commit 1):
//   GET  /api/empleados/usuarios
//   POST /api/empleados
//   PUT  /api/empleados/:nombre
//   POST /api/empleados/:nombre/acceso
//   PATCH /api/empleados/:nombre/acceso/estado
//   POST /api/empleados/:nombre/acceso/pin
//   POST /api/empleados/:nombre/numero-sysneo
//   POST /api/mi-perfil/pin
// Nunca se llama accion=cargar_usuarios ni accion=guardar_usuarios desde
// acá. Nunca se cachea ni se loguea un PIN.

function _normalizarNombreEmpleadoJS(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

async function _apiFetch(base, path, opciones) {
  opciones = opciones || {};
  try {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opciones.headers || {});
    const token = _getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const resp = await fetch(`${BACKEND_URL}${base}${path}`, Object.assign({}, opciones, { headers }));
    const data = await resp.json().catch(() => null);
    if (!data) return { ok: false, error: 'Respuesta inválida del servidor' };
    return data;
  } catch (err) {
    return { ok: false, error: 'Error de conexión. Revisá tu internet e intentá de nuevo.' };
  }
}
const apiEmpleados = (path, opciones) => _apiFetch('/api/empleados', path, opciones);
const apiMiPerfil  = (path, opciones) => _apiFetch('/api/mi-perfil', path, opciones);
const apiFichadas  = (path, opciones) => _apiFetch('/api/fichadas', path, opciones);
const apiKioscos   = (path, opciones) => _apiFetch('/api/kioscos', path, opciones);
const apiSucursales = (path, opciones) => _apiFetch('/api/sucursales', path, opciones);
const apiBancoHoras = (path, opciones) => _apiFetch('/api/banco-horas', path, opciones);
const apiRecibos   = (path, opciones) => _apiFetch('/api/recibos', path, opciones);
// Fase 6B: reemplaza accion=solicitar_vac/responder_solicitud/inicializar_vac/
// ajustar_vac/agregar_vacacion_admin (GAS público, sin auth) por estos 5
// endpoints Node (JWT, rol server-side, BACKEND_SECRET agregado por el
// backend). Las acciones GAS viejas siguen intactas mientras dure la
// transición — rollback: restaurar los call-sites desde el historial de git.
const apiVacaciones = (path, opciones) => _apiFetch('/api/vacaciones', path, opciones);
// Fase 6B: reemplaza accion=guardar_certificado/borrar_certificado.
const apiCertificadosAdmin = (path, opciones) => _apiFetch('/api/certificados', path, opciones);
// Fase 6C.1: reemplaza accion=guardar_config.
const apiConfig = (path, opciones) => _apiFetch('/api/config', path, opciones);
// Fase 6C.2: reemplaza accion=guardar_evento/eliminar_evento y
// accion=guardar_anuncio/eliminar_anuncio.
const apiEventos  = (path, opciones) => _apiFetch('/api/eventos', path, opciones);
// Barrida final GAS→Node (2026-09-30): reemplaza accion=guardar_categoria
// (GAS, GET público, sin auth — único frontend→GAS directo que quedaba
// vivo). JWT automático vía _apiFetch.
const apiCategorias = (path, opciones) => _apiFetch('/api/categorias', path, opciones);
const apiAnuncios = (path, opciones) => _apiFetch('/api/anuncios', path, opciones);
// Fase 6C.1: reemplaza accion=guardar_foto_url (paso 2 de subirFotoEmpleado)
// — reutiliza apiMiPerfil (ya definida arriba, base '/api/mi-perfil').
// Fase 1 Sheets API (docs/PLAN-SHEETS-API-DIRECTA.md): reemplaza el fetch
// directo a GAS (?accion=horarios) del Panel/Admin. accion=horarios en GAS
// sigue intacta — si hace falta revertir, alcanza con volver a llamarla
// directo en cargarDatos() (ver ese fetch más arriba en este archivo).
const apiHorariosSheets = (path, opciones) => _apiFetch('/api/horarios-sheets', path, opciones);
// En vivo (HORARIOS+FICHADAS, estado ya calculado por croma-backend) —
// mismo motor y endpoint ya productivo en croma-panel-main desde Fase 3D.
// Rollback: ENVIVO_NODE=false (ver bloque "EN VIVO" más arriba en este
// archivo) vuelve a state.datos/DATOS GENERALES sin tocar esta línea.
const apiEnVivo = (path, opciones) => _apiFetch('/api/envivo-hoy', path, opciones);
// Horario semanal (HORARIOS, lo que carga el encargado) — usado en el
// Portal Empleado para mostrar en "Mi semana" el turno planificado de los
// días que todavía no se fichan (ver cargarPlanHorarioEmpleado()). Sin
// restricción de rol en el backend (GET /api/horarios-semanales solo pide
// JWT válido, cualquier rol incluido empleado — confirmado en
// croma-backend/src/routes/horarios-semanales.js).
const apiHorariosSemanales = (path, opciones) => _apiFetch('/api/horarios-semanales', path, opciones);
// Fase 1B: reemplaza accion=datos_portal_empleado del Portal Empleado.
// croma-backend arma el mismo contrato combinando GAS (sin_horarios=1,
// perfiles+certificados+vacaciones) + Sheets API (horarios) en paralelo —
// getHorarios() deja de ejecutarse en GAS. accion=datos_portal_empleado
// sigue intacta en GAS — rollback: volver el fetch de abajo a la URL vieja.
const apiDatosPortalEmpleado = (path, opciones) => _apiFetch('/api/datos-portal-empleado', path, opciones);
// Fase 2A: reemplaza accion=perfiles del Panel/Admin y de Administración
// (ambos pasan por cargarPerfiles()). accion=perfiles sigue intacta en GAS
// — rollback: volver el fetch de cargarPerfiles() a la URL vieja.
const apiPerfilesSheets = (path, opciones) => _apiFetch('/api/perfiles-sheets', path, opciones);
// Fase 4A: reemplaza accion=cargar_certificados del Panel/Admin
// (cargarCertificados()). accion=cargar_certificados sigue intacta en GAS
// — rollback: volver el fetch de cargarCertificados() a la URL vieja.
const apiCertificadosSheets = (path, opciones) => _apiFetch('/api/certificados-sheets', path, opciones);
// Mensaje seguro de una respuesta {ok:false,...} — las rutas de Recibos usan
// "mensaje", los middlewares de auth (401/403) usan "error", _apiFetch usa
// "error" para sus propios fallos de red/parseo. Un solo lugar para no
// tener que recordar cuál es cuál en cada handler.
// DEUDA TÉCNICA (registrada, no bloquea Fase 3): unificar todo el backend
// (auth, empleados, fichadas, recibos, etc.) a un único contrato de error
// {code, message} y borrar este shim. Tocaría middlewares/auth.js y varias
// rutas a la vez — fuera de alcance de un commit de frontend.
function _msgApi(data, fallback) {
  return (data && (data.mensaje || data.error)) || fallback;
}

// ── Fuente del listado administrativo ─────────────────
let USUARIOS_ADMIN_CACHE = null; // lista saneada (sin PIN) desde GET /api/empleados/usuarios

async function cargarUsuariosAdmin() {
  const data = await apiEmpleados('/usuarios');
  if (!data.ok) {
    console.warn('No se pudo cargar el listado de usuarios:', data.error);
    if (!USUARIOS_ADMIN_CACHE) USUARIOS_ADMIN_CACHE = [];
    return USUARIOS_ADMIN_CACHE;
  }
  USUARIOS_ADMIN_CACHE = data.usuarios || [];
  return USUARIOS_ADMIN_CACHE;
}

function getUsuariosAdmin() { return USUARIOS_ADMIN_CACHE || []; }

// NOMBRE_LEGAL (Fase 2) — viaja por un canal autenticado pero SIN
// restricción de rol (GET /api/nombres-legales, cualquier sesión con JWT
// válido), nunca por getPerfiles() (público, sin auth). Visible para todo
// el staff logueado a propósito — decisión confirmada explícitamente,
// ver conversación de diseño — no solo admin/jefe como al principio.
let NOMBRES_LEGALES_CACHE = null;

async function cargarNombresLegales() {
  const data = await _apiFetch('/api/nombres-legales', '', { method: 'GET' });
  if (!data.ok) {
    console.warn('No se pudo cargar nombres legales:', data.error);
    if (!NOMBRES_LEGALES_CACHE) NOMBRES_LEGALES_CACHE = {};
    return NOMBRES_LEGALES_CACHE;
  }
  NOMBRES_LEGALES_CACHE = {};
  (data.nombres || []).forEach(n => {
    NOMBRES_LEGALES_CACHE[_normalizarNombreEmpleadoJS(n.nombre)] = n.nombre_legal || '';
  });
  return NOMBRES_LEGALES_CACHE;
}

function getNombresLegales() { return NOMBRES_LEGALES_CACHE || {}; }

// Para pantallas admin que necesitan la lista de usuarios pero pueden
// abrirse sin haber pasado antes por la vista Administración (p.ej. "Nuevo
// evento" desde Calendario, "Nuevo anuncio"): asegura que se haya pedido
// al menos una vez antes de usarla, sin volver a pedirla si ya está en
// cache. Devuelve la lista saneada (sin PIN).
async function _asegurarUsuariosAdmin() {
  if (USUARIOS_ADMIN_CACHE === null) await cargarUsuariosAdmin();
  return getUsuariosAdmin();
}

// EMPLEADOS (prioridad) + nombres históricos de DATOS GENERALES
// (compatibilidad, sin crear nada ahí — ver diseño aprobado). Semana/Mes/
// Calendario NO usan esta función, siguen leyendo state.datos directo.
function obtenerEmpleadosAdmin() {
  const porNorm = {};

  (state.datos || []).forEach(r => {
    if (!r.EMPLEADO) return;
    const norm = _normalizarNombreEmpleadoJS(r.EMPLEADO);
    if (!porNorm[norm]) porNorm[norm] = { nombre: r.EMPLEADO, origen: 'horarios' };
  });

  Object.keys(EMPLEADOS_PERFILES).forEach(nombre => {
    const norm = _normalizarNombreEmpleadoJS(nombre);
    // EMPLEADOS pisa lo derivado de horarios pero conserva el nombre tal
    // como está guardado en esta hoja (fuente prioritaria).
    porNorm[norm] = Object.assign({}, porNorm[norm], EMPLEADOS_PERFILES[nombre], { nombre, origen: 'empleados' });
  });

  const usuarioPorNorm = {};
  getUsuariosAdmin().forEach(u => {
    if (u.empleadoNombre) usuarioPorNorm[_normalizarNombreEmpleadoJS(u.empleadoNombre)] = u;
  });

  const nombresLegales = getNombresLegales();

  return Object.keys(porNorm).map(norm => {
    return Object.assign({}, porNorm[norm], {
      _usuario: usuarioPorNorm[norm] || null,
      nombre_legal: nombresLegales[norm] || '',
    });
  }).sort((a, b) => {
    const na = parseInt(a.nombre) || 999, nb = parseInt(b.nombre) || 999;
    return na !== nb ? na - nb : a.nombre.localeCompare(b.nombre);
  });
}

function _infoSysneoAdmin(emp) {
  return emp.numero_vendedor_sysneo
    ? { label: emp.numero_vendedor_sysneo, clase: 'badge badge-info', tono: 'info', asignado: true }
    : { label: 'Pendiente', clase: 'badge badge-neutral', tono: 'neutral', asignado: false };
}

function _infoAccesoAdmin(emp) {
  const u = emp._usuario;
  if (!u) return { label: 'Sin acceso', clase: 'badge badge-neutral', tono: 'neutral' };
  if (u.estado === 'inactivo') return { label: 'Acceso desactivado', clase: 'badge badge-warning', tono: 'warning' };
  if (u.fin_acceso) {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const fin = new Date(u.fin_acceso + 'T00:00:00');
    if (!isNaN(fin.getTime()) && fin < hoy) return { label: 'Acceso vencido', clase: 'badge badge-danger', tono: 'danger' };
  }
  return { label: 'Con acceso', clase: 'badge badge-success', tono: 'success' };
}

async function _refrescarAdminEmpleados() {
  await Promise.all([cargarPerfiles(), cargarUsuariosAdmin(), cargarNombresLegales()]);
  renderAdminInline();
}

// ── Ficha unificada (crear / editar) ──────────────────
// tabInicial: 'perfil' (default) | 'laboral' | 'acceso'
function abrirFormularioEmpleado(nombre, tabInicial) {
  const esNuevo = !nombre;
  const emp = esNuevo ? {} : (obtenerEmpleadosAdmin().find(e => e.nombre === nombre) || { nombre });
  const nomEnc = (nombre || '').replace(/'/g, "\\'");
  const tieneAcceso = !!emp._usuario;

  const sucOpts = ['<option value="">Sin asignar</option>']
    .concat(SUCURSALES_TODAS.filter(s => s.activa !== false || s.id === emp.sucursal_id).map(s => `<option value="${s.id}" ${emp.sucursal_id === s.id ? 'selected' : ''}>${s.nombre}</option>`)).join('');
  const catOpts = ['<option value="">Sin categoría</option>']
    .concat(CATEGORIAS_CONFIG.map(c => `<option value="${c.id}" ${emp.categoria_id === c.id ? 'selected' : ''}>${c.nombre}</option>`)).join('');
  const empOpts = ['<option value="">Sin empresa</option>']
    .concat(EMPRESAS.map(e => `<option value="${e}" ${emp.empresa === e ? 'selected' : ''}>${e}</option>`)).join('');
  const reglaOpts = `
    <option value="" ${!emp.regla_custom ? 'selected' : ''}>Usar regla de la categoría</option>
    <option value="lv4" ${emp.regla_custom === 'lv4' ? 'selected' : ''}>4h Lun-Vie (excedente = extra)</option>
    <option value="lv8" ${emp.regla_custom === 'lv8' ? 'selected' : ''}>8h Lun-Vie (excedente = extra)</option>
    <option value="personalizado" ${emp.regla_custom === 'personalizado' ? 'selected' : ''}>Personalizado (usar Hs base)</option>
  `;

  const nombreCampoHtml = esNuevo
    ? `<input type="text" class="admin-input" id="formEmpNombre" placeholder="Ej: Aixa Rojas" autocomplete="off" />`
    : `<input type="text" class="admin-input" id="formEmpNombre" value="${emp.nombre}" readonly />
       <span style="font-size:11px;color:var(--text-muted);margin-top:4px;display:block">
         El nombre no puede modificarse desde esta pantalla porque está vinculado a registros históricos.
       </span>`;

  const nomMostrar = esNuevo ? '' : emp.nombre.replace(/^\d+\s+/, '');

  // Pestaña Recibos: solo admin/jefe (mismo gate que ya protege toda esta
  // ficha vía _isAdminJwt/adminAutenticado) y solo para un empleado ya
  // existente — no tiene sentido antes de guardar el alta. Redundante con
  // el backend a propósito (defensa en profundidad, la fuente de verdad
  // sigue siendo requiereRol('admin','jefe') en /api/recibos).
  const puedeVerRecibos = !esNuevo && (sesionActual?.rol === 'admin' || sesionActual?.rol === 'jefe');
  _recibosFicha = puedeVerRecibos
    ? { nombre: emp.nombre, nombreLegal: emp.nombre_legal || '', empresa: emp.empresa || '', historial: false, cargado: false, lista: [] }
    : null;

  // Encabezado enriquecido — solo para un empleado que ya existe (para
  // "Nuevo empleado" no hay nada todavía que resumir). Reutiliza datos que
  // ya están disponibles en `emp` (Perfil/Laboral/Acceso), no agrega
  // ningún dato ni lógica nueva — es un resumen de lectura.
  const infoAcceso = _infoAccesoAdmin(emp);
  const sucNombreEmp = emp.sucursal_id ? (SUCURSALES_TODAS.find(s => s.id === emp.sucursal_id)?.nombre || '') : '';
  const inicialAvatar = (nomMostrar || '?').charAt(0).toUpperCase();
  const avatarHtml = emp.foto_url
    ? `<img src="${emp.foto_url}" alt="" onerror="this.parentElement.textContent='${inicialAvatar}'" />`
    : inicialAvatar;

  const headerHtml = esNuevo ? `
      <div class="admin-header">
        <div class="admin-titulo">Nuevo empleado</div>
        <button class="detalle-close" onclick="cerrarFormularioEmpleado()">${icon('x','icon-16')}</button>
      </div>` : `
      <div class="admin-header admin-header-rich">
        <div class="admin-ficha-identidad">
          <div class="admin-ficha-avatar">${avatarHtml}</div>
          <div style="min-width:0">
            <div class="admin-ficha-nombre">${nomMostrar}</div>
            ${emp.nombre_legal ? `<div class="admin-ficha-legal">${emp.nombre_legal}</div>` : ''}
            <div class="admin-ficha-chips">
              ${emp.empresa ? `<span class="detalle-chip">${icon('building','icon-12')}${emp.empresa}</span>` : ''}
              ${sucNombreEmp ? `<span class="detalle-chip">${icon('mapPin','icon-12')}${sucNombreEmp}</span>` : ''}
              ${emp.numero_vendedor_sysneo ? `<span class="detalle-chip">#${emp.numero_vendedor_sysneo}</span>` : ''}
              <span class="${infoAcceso.clase}">${infoAcceso.label}</span>
            </div>
          </div>
        </div>
        <button class="detalle-close admin-ficha-close" onclick="cerrarFormularioEmpleado()">${icon('x','icon-16')}</button>
      </div>`;

  const html = `
  <div class="admin-overlay" id="adminOverlay" onclick="cerrarFormularioEmpleado(event)">
    <div class="admin-panel" onclick="event.stopPropagation()">
      ${headerHtml}
      <div class="admin-form admin-form-sticky-footer">
        <div class="admin-form-body">
        <input type="hidden" id="formEmpNombreOriginal" value="${nomEnc}" />
        <input type="hidden" id="formEmpTieneAccesoOriginal" value="${tieneAcceso ? '1' : ''}" />
        <div class="admin-tabs" id="formEmpTabs">
          <button class="admin-tab active" type="button" onclick="_switchFormEmpTab('perfil', this)">Perfil</button>
          <button class="admin-tab" type="button" onclick="_switchFormEmpTab('laboral', this)">Datos laborales</button>
          <button class="admin-tab" type="button" onclick="_switchFormEmpTab('acceso', this)">Acceso</button>
          ${puedeVerRecibos ? `<button class="admin-tab" type="button" onclick="_switchFormEmpTab('recibos', this)">Recibos</button>` : ''}
        </div>

        <div id="formEmpTabPerfil" class="admin-tab-content">
          <div class="admin-form-grid">
          <div class="admin-form-grupo">
            <label class="emp-filtro-label" for="formEmpNombre">Nombre operativo</label>
            ${nombreCampoHtml}
          </div>
          <div class="admin-form-grupo">
            <label class="emp-filtro-label" for="formEmpNombreLegal">Nombre legal completo${esNuevo ? ' *' : ''}</label>
            <input type="text" class="admin-input" id="formEmpNombreLegal" value="${emp.nombre_legal || ''}"
              placeholder="Ej: Aixa Rojas Fernández" autocomplete="off" ${esNuevo ? 'required' : ''} />
            <span style="font-size:11px;color:var(--text-muted);margin-top:4px;display:block">
              Se utiliza para recibos de sueldo y documentación formal. No modifica el nombre usado en fichadas e historial.
            </span>
          </div>
          <div class="admin-form-grupo">
            <label class="emp-filtro-label" for="formEmpApodo">Apodo</label>
            <input type="text" class="admin-input" id="formEmpApodo" value="${emp.apodo || ''}"
              placeholder="Ej: Turco" autocomplete="off" maxlength="30" />
            <span style="font-size:11px;color:var(--text-muted);margin-top:4px;display:block">
              Opcional. Aparece junto al nombre en las tarjetas de Empleados y se puede buscar por él.
            </span>
          </div>
          <div class="admin-form-grupo admin-form-grid-full">
            <label class="emp-filtro-label">Número de vendedor Sysneo</label>
            <span class="${_infoSysneoAdmin(emp).clase}">${_infoSysneoAdmin(emp).label}</span>
            <span style="font-size:11px;color:var(--text-muted);margin-top:4px;display:block">Se edita desde la pestaña Datos laborales.</span>
          </div>
          <div class="admin-foto-preview admin-form-grid-full" id="adminFotoPreview">
            ${emp.foto_url
              ? `<img src="${emp.foto_url}" onerror="this.parentElement.innerHTML='Sin foto'" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid #e2e8f0">`
              : `<div style="width:80px;height:80px;border-radius:50%;background:#f1f5f9;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--text-muted)">Sin foto</div>`}
          </div>
          <div class="admin-form-grupo">
            <label class="emp-filtro-label" for="formEmpFotoUrl">URL de foto (Google Drive)</label>
            <input type="url" class="admin-input" id="formEmpFotoUrl" value="${emp.foto_url || ''}"
              placeholder="https://drive.google.com/..." oninput="previewFoto(this.value)" />
            <span style="font-size:11px;color:var(--text-muted);margin-top:4px;display:block">Compartir foto como "Cualquiera con el enlace puede ver" y pegar la URL aquí</span>
          </div>
          <div class="admin-form-grupo">
            <label class="emp-filtro-label" for="formEmpCelular">Celular (WhatsApp)</label>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:13px;color:var(--text-secondary);white-space:nowrap">+549</span>
              <input type="text" class="admin-input" id="formEmpCelular" value="${emp.celular || ''}"
                placeholder="2994123456" inputmode="numeric" autocomplete="off" style="flex:1;margin:0" />
            </div>
            <span style="font-size:11px;color:var(--text-muted);margin-top:4px;display:block">Sin el 0 ni el 15 — solo los 10 dígitos</span>
          </div>
          </div>
        </div>

        <div id="formEmpTabLaboral" class="admin-tab-content" style="display:none">
          <div class="admin-form-grid">
          <div class="admin-form-grupo">
            <label class="emp-filtro-label" for="formEmpSucursal">Sucursal principal</label>
            <select class="admin-input" id="formEmpSucursal">${sucOpts}</select>
          </div>
          <div class="admin-form-grupo">
            <label class="emp-filtro-label" for="formEmpFechaIngreso">Fecha de ingreso</label>
            <input type="date" class="admin-input" id="formEmpFechaIngreso" value="${emp.fecha_ingreso || ''}" />
          </div>
          <div class="admin-form-grupo">
            <label class="emp-filtro-label" for="formEmpEmpresa">Empresa</label>
            <select class="admin-input" id="formEmpEmpresa">${empOpts}</select>
          </div>
          <div class="admin-form-grupo">
            <label class="emp-filtro-label" for="formEmpCategoria">Categoría</label>
            <select class="admin-input" id="formEmpCategoria">${catOpts}</select>
          </div>
          <div class="admin-form-grupo">
            <label class="emp-filtro-label" for="formEmpReglaCustom">Regla personalizada de horas extra</label>
            <select class="admin-input" id="formEmpReglaCustom" onchange="_toggleHsBaseFormEmp(this.value)">${reglaOpts}</select>
          </div>
          <div class="admin-form-grupo" id="formEmpHsBaseGrupo" style="${emp.regla_custom === 'personalizado' ? '' : 'display:none'}">
            <label class="emp-filtro-label" for="formEmpHsBase">Horas base por día (límite para extra)</label>
            <input type="number" class="admin-input" id="formEmpHsBase" value="${emp.hs_base || 8}" min="1" max="12" step="0.5" />
          </div>
          <div class="admin-form-grupo">
            <label class="emp-filtro-label" for="formEmpSysneo">Número de vendedor Sysneo</label>
            <div style="display:flex;align-items:center;gap:8px">
              <input type="text" class="admin-input" id="formEmpSysneo" value="${emp.numero_vendedor_sysneo || ''}"
                placeholder="Opcional" autocomplete="off" style="flex:1;margin:0" />
              <span class="${_infoSysneoAdmin(emp).clase}">${_infoSysneoAdmin(emp).label}</span>
            </div>
            <span style="font-size:11px;color:var(--text-muted);margin-top:4px;display:block">
              Este número se crea manualmente en Sysneo y acá se guarda únicamente como referencia. Croma Horarios no se conecta ni sincroniza con Sysneo.
            </span>
          </div>
          <div class="admin-form-grupo">
            <label class="emp-filtro-label" for="formEmpEstado">Estado del empleado</label>
            <select class="admin-input" id="formEmpEstado">
              <option value="activo" ${emp.estado !== 'inactivo' ? 'selected' : ''}>Activo</option>
              <option value="inactivo" ${emp.estado === 'inactivo' ? 'selected' : ''}>Inactivo</option>
            </select>
          </div>
          </div>
        </div>

        <div id="formEmpTabAcceso" class="admin-tab-content" style="display:none">
          ${_renderTabAccesoEmpleado(emp, tabInicial === 'acceso')}
        </div>

        ${puedeVerRecibos ? `
        <div id="formEmpTabRecibos" class="admin-tab-content" style="display:none">
          ${_renderTabRecibosEmpleado(emp)}
        </div>` : ''}

        <p id="formEmpError" class="alert alert-danger" style="display:none;margin-top:1rem"></p>
        </div>

        <div class="admin-form-footer">
          <button class="btn-connect" style="margin:0" id="formEmpBtnGuardar" onclick="guardarFormularioEmpleado()">
            ${esNuevo ? 'Crear empleado' : 'Guardar cambios'}
          </button>
          <button class="btn-demo" id="formEmpBtnCancelar" onclick="cerrarFormularioEmpleado()">Cancelar</button>
        </div>
      </div>
    </div>
  </div>`;

  montarOverlayAdmin(html);
  if (tabInicial === 'laboral' || tabInicial === 'acceso') {
    const idx = tabInicial === 'laboral' ? 1 : 2;
    _switchFormEmpTab(tabInicial, document.querySelectorAll('#formEmpTabs .admin-tab')[idx]);
  }
}

function _renderTabAccesoEmpleado(emp, crearAccesoInicial) {
  const tieneAcceso = !!emp._usuario;

  if (!tieneAcceso) {
    return `
      <div class="admin-form-grupo">
        <label class="form-switch"><input type="checkbox" id="formEmpCrearAcceso" aria-label="Crear acceso para este empleado" ${crearAccesoInicial ? 'checked' : ''} onchange="_toggleCrearAccesoEmpleado(this.checked)"><span class="switch-track"></span></label>
        <span style="margin-left:10px;font-size:13px;color:#1e293b;vertical-align:middle">Crear acceso para este empleado</span>
      </div>
      <div id="formEmpAccesoCampos" style="${crearAccesoInicial ? '' : 'display:none'}">
        <div class="admin-form-grupo">
          <label class="emp-filtro-label" for="formEmpUsername">Nombre de usuario</label>
          <input type="text" class="admin-input" id="formEmpUsername" placeholder="Ej: aixa03" autocomplete="off" autocapitalize="off" />
        </div>
        <div class="admin-form-grupo">
          <label class="emp-filtro-label" for="formEmpPin">PIN</label>
          <input type="text" class="admin-input" id="formEmpPin" placeholder="Ej: 1234" maxlength="8" inputmode="numeric" autocomplete="off" />
        </div>
      </div>
    `;
  }

  const u = emp._usuario;
  return `
    <div class="admin-form-grupo">
      <label class="emp-filtro-label" for="formEmpUsername">Nombre de usuario</label>
      <input type="text" class="admin-input" id="formEmpUsername" value="${u.nombre}" readonly />
    </div>
    <div class="admin-form-grupo">
      <label class="emp-filtro-label" for="formEmpPin">PIN</label>
      <div><button type="button" class="btn-admin-edit" id="formEmpBtnCambiarPin" onclick="_mostrarCampoPinEmpleado()">Cambiar PIN</button></div>
      <input type="text" class="admin-input" id="formEmpPin" placeholder="PIN nuevo" maxlength="8" inputmode="numeric" autocomplete="off" style="display:none;margin-top:8px" />
      <span style="font-size:11px;color:var(--text-muted);margin-top:4px;display:block">Dejalo así para conservar el PIN actual</span>
    </div>
    <div class="admin-form-grupo">
      <label class="emp-filtro-label" for="formEmpAccesoEstado">Estado del acceso</label>
      <select class="admin-input" id="formEmpAccesoEstado">
        <option value="activo" ${u.estado !== 'inactivo' ? 'selected' : ''}>Activo</option>
        <option value="inactivo" ${u.estado === 'inactivo' ? 'selected' : ''}>Inactivo</option>
      </select>
    </div>
    <div class="admin-form-grupo">
      <label class="emp-filtro-label" for="formEmpFinAcceso">Fin de acceso (opcional)</label>
      <input type="date" class="admin-input" id="formEmpFinAcceso" value="${u.fin_acceso || ''}" />
    </div>
    <input type="hidden" id="formEmpAccesoEstadoOriginal" value="${u.estado !== 'inactivo' ? 'activo' : 'inactivo'}" />
    <input type="hidden" id="formEmpFinAccesoOriginal" value="${u.fin_acceso || ''}" />
  `;
}

function _toggleCrearAccesoEmpleado(checked) {
  const el = document.getElementById('formEmpAccesoCampos');
  if (el) el.style.display = checked ? '' : 'none';
}

function _toggleHsBaseFormEmp(val) {
  const el = document.getElementById('formEmpHsBaseGrupo');
  if (el) el.style.display = val === 'personalizado' ? 'block' : 'none';
}

function _mostrarCampoPinEmpleado() {
  const el = document.getElementById('formEmpPin');
  if (el) { el.style.display = ''; el.focus(); }
  const btn = document.getElementById('formEmpBtnCambiarPin');
  if (btn) btn.style.display = 'none';
}

// El aviso "falta nombre legal" dentro de _renderTabRecibosEmpleado()
// aparece tanto en la ficha completa (donde existe #formEmpTabs) como en
// Administración → Recibos (donde no existe ninguna ficha montada) — este
// helper elige el comportamiento correcto según el contexto en vez de
// asumir siempre la ficha.
function _irAPerfilDesdeRecibos(nombre) {
  const tabs = document.querySelectorAll('#formEmpTabs .admin-tab');
  if (tabs.length) { _switchFormEmpTab('perfil', tabs[0]); return; }
  abrirFormularioEmpleado(nombre);
}

function _switchFormEmpTab(tab, btn) {
  document.querySelectorAll('#formEmpTabs .admin-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('formEmpTabPerfil').style.display  = tab === 'perfil'  ? '' : 'none';
  document.getElementById('formEmpTabLaboral').style.display = tab === 'laboral' ? '' : 'none';
  document.getElementById('formEmpTabAcceso').style.display  = tab === 'acceso'  ? '' : 'none';
  const tabRecibos = document.getElementById('formEmpTabRecibos');
  if (tabRecibos) {
    tabRecibos.style.display = tab === 'recibos' ? '' : 'none';
    if (tab === 'recibos') _cargarRecibosEmpleado();
  }
  _actualizarFooterFormEmp(tab);
}

// El footer es consciente de la pestaña activa: en Recibos no hay "Guardar
// cambios" porque no es un formulario que se guarda — cada acción (subir,
// reemplazar) ya tiene su propio flujo. Mismo botón "Cancelar", solo
// cambia de texto a "Cerrar" para no sumar un botón nuevo.
function _actualizarFooterFormEmp(tab) {
  const btnGuardar = document.getElementById('formEmpBtnGuardar');
  const btnCancelar = document.getElementById('formEmpBtnCancelar');
  if (!btnGuardar || !btnCancelar) return;
  const esRecibos = tab === 'recibos';
  btnGuardar.style.display = esRecibos ? 'none' : '';
  btnCancelar.textContent = esRecibos ? 'Cerrar' : 'Cancelar';
}

function cerrarFormularioEmpleado(event) {
  if (event && event.target !== event.currentTarget) return;
  cerrarAdmin();
  // Invalida cualquier fetch de recibos en vuelo — ver chequeo de "gen" en
  // _fetchRecibosEmpleado. Sin esto, una respuesta lenta podría llegar
  // después de reabrir la ficha para OTRO empleado y pisar su listado.
  _recibosFicha = null;
}

