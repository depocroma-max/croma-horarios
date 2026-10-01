// ── CERTIFICADOS ──────────────────────────────────────
// prefetched: ver nota en cargarPerfiles().
async function cargarCertificados(prefetched) {
  try {
    // Fase 4A Sheets API: antes pegaba directo a GAS (?accion=cargar_certificados).
    const json = prefetched || await apiCertificadosSheets('', { method: 'GET' });
    if (json.ok) {
      CERTIFICADOS_CACHE = (json.certificados || []).map(c => {
        // La fecha puede venir como Date object o string — normalizar a "YYYY-MM-DD"
        let fecha = c.fecha;
        if (fecha instanceof Date || (typeof fecha === 'object' && fecha !== null)) {
          const d = new Date(fecha);
          fecha = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        } else if (typeof fecha === 'string' && fecha.includes('/')) {
          // formato DD/MM/YYYY
          const [dd,mm,yyyy] = fecha.split('/');
          fecha = `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
        } else {
          // ya es string YYYY-MM-DD, limpiar
          fecha = String(fecha).substring(0,10);
        }
        return { ...c, fecha };
      });
    }
    return CERTIFICADOS_CACHE;
  } catch(e) {
    console.warn('Error cargando certificados:', e);
    return [];
  }
}

function getCertificadosDe(nombreEmp) {
  // Normalizar: quitar número del principio y colapsar espacios múltiples
  const normalizar = n => n.trim().toLowerCase().replace(/^\d+\s+/, '').replace(/\s+/g, ' ');
  const empNorm = normalizar(nombreEmp);
  return CERTIFICADOS_CACHE.filter(c => normalizar(c.empleado) === empNorm);
}

// ── VACACIONES APROBADAS (para el historial, igual que certificados) ──
// prefetched: ver nota en cargarPerfiles().
// Barrida final GAS→Node (2026-09-18): antes pegaba directo a
// accion=get_solicitudes_vac&estado=aprobada (GAS). Ahora usa el endpoint
// Node ya existente y productivo /api/vacaciones-aprobadas-sheets (Fase
// 4B, JWT automático vía _apiFetch) — mismo contrato {ok,solicitudes}.
async function cargarVacacionesAprobadas(prefetched) {
  try {
    const json = prefetched || await _apiFetch('/api/vacaciones-aprobadas-sheets', '', { method: 'GET' });
    if (json.ok) VACACIONES_APROBADAS_CACHE = json.solicitudes || [];
    return VACACIONES_APROBADAS_CACHE;
  } catch(e) {
    console.warn('Error cargando vacaciones aprobadas:', e);
    return [];
  }
}

function getVacacionesAprobadasDe(nombreEmp) {
  const normalizar = n => n.trim().toLowerCase().replace(/^\d+\s+/, '').replace(/\s+/g, ' ');
  const empNorm = normalizar(nombreEmp);
  return VACACIONES_APROBADAS_CACHE.filter(v => normalizar(v.empleado) === empNorm);
}

async function guardarCertificado(cert) {
  try {
    const json = await apiCertificadosAdmin('', { method: 'POST', body: JSON.stringify(cert) });
    if (json.ok) {
      CERTIFICADOS_CACHE.push({ ...cert, id: json.id });
      return { ok: true, id: json.id };
    }
    return { ok: false };
  } catch(e) { return { ok: false }; }
}

async function borrarCertificado(id) {
  try {
    const json = await apiCertificadosAdmin(`/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (json.ok) CERTIFICADOS_CACHE = CERTIFICADOS_CACHE.filter(c => c.id !== id);
    return json.ok;
  } catch(e) { return false; }
}

function abrirFormCertificado(nombreEmp, desdeAdmin) {
  _certFlujoDesdeAdmin = !!desdeAdmin;

  const tiposOpts = TIPOS_CERTIFICADO.map(t =>
    `<option value="${t}">${t}</option>`
  ).join('');

  const nomMatch  = nombreEmp.match(/^(\d+)\s+(.+)$/);
  const nomMostrar = nomMatch ? nomMatch[2] : nombreEmp;

  const html = `
  <div class="admin-overlay" id="adminOverlay" onclick="cerrarAdmin(event)">
    <div class="admin-panel admin-panel-sm" onclick="event.stopPropagation()">
      <div class="admin-header">
        <div class="admin-titulo">Agregar certificado — ${nomMostrar}</div>
        <button class="detalle-close" onclick="cerrarAdmin()" aria-label="Cerrar">${icon('x','icon-16')}</button>
      </div>
      <div class="admin-form">
        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Rango de fechas</label>
          <div style="display:flex;gap:8px">
            <div style="flex:1;display:flex;flex-direction:column;gap:4px">
              <span style="font-size:11px;color:var(--text-muted)">Desde</span>
              <input type="date" class="admin-input" id="certDesde" aria-label="Desde" onchange="renderCertRango()" />
            </div>
            <div style="flex:1;display:flex;flex-direction:column;gap:4px">
              <span style="font-size:11px;color:var(--text-muted)">Hasta</span>
              <input type="date" class="admin-input" id="certHasta" aria-label="Hasta" onchange="renderCertRango()" />
            </div>
          </div>
        </div>
        <div class="admin-form-grupo">
          <label class="emp-filtro-label" for="certTipo">Tipo de certificado</label>
          <select class="admin-input" id="certTipo" onchange="onCertTipoChange()">
            ${tiposOpts}
          </select>
        </div>
        <div class="admin-form-grupo" id="certNotaGrupo" style="display:none">
          <label class="emp-filtro-label" for="certNotaPersonalizada">Descripción</label>
          <input type="text" class="admin-input" id="certNotaPersonalizada" placeholder="Ej: Trámite migratorio" />
        </div>
        <div class="admin-form-grupo" id="certDiasGrupo" style="display:none">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:2px">
            <label class="emp-filtro-label" style="margin:0">Días cubiertos</label>
            <div style="display:flex;gap:6px">
              <button type="button" class="cert-bulk" onclick="setCertTodos('incluir')">Todos incluir</button>
              <button type="button" class="cert-bulk" onclick="setCertTodos('quitar')">Todos quitar</button>
            </div>
          </div>
          <div id="certDiasContainer"></div>
        </div>
        <p id="certError" style="color:#dc2626;font-size:12px;display:none;margin-bottom:0.5rem"></p>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:1rem">
          <button class="btn-connect" style="margin:0" onclick="confirmarCertificado('${nombreEmp.replace(/'/g,"\\'")}')">
            Guardar certificado
          </button>
          <button class="btn-demo" onclick="cerrarAdmin()">Cancelar</button>
        </div>
      </div>
    </div>
  </div>`;
  montarOverlayAdmin(html);

  // Estado de cobertura por día (los certificados no suman horas)
  CERT_DIAS_STATE = {};

  // Rango por defecto: hoy → hoy
  const hoy = new Date();
  const hoyISO = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-${String(hoy.getDate()).padStart(2,'0')}`;
  document.getElementById('certDesde').value = hoyISO;
  document.getElementById('certHasta').value = hoyISO;
  renderCertRango();
}

// Estado del formulario de certificados por rango
let CERT_DIAS_STATE = {};   // { 'YYYY-MM-DD': 'incluir' | 'quitar' }

function renderCertRango() {
  const desde = document.getElementById('certDesde')?.value;
  const hasta = document.getElementById('certHasta')?.value;
  const grupo = document.getElementById('certDiasGrupo');
  const cont  = document.getElementById('certDiasContainer');
  if (!grupo || !cont) return;
  if (!desde || !hasta) { grupo.style.display = 'none'; return; }

  const [y1,m1,d1] = desde.split('-').map(Number);
  const [y2,m2,d2] = hasta.split('-').map(Number);
  const ini = new Date(y1, m1-1, d1);
  const fin = new Date(y2, m2-1, d2);
  grupo.style.display = 'block';
  if (fin < ini) {
    cont.innerHTML = '<p style="color:#dc2626;font-size:12px;margin:0">La fecha "Hasta" es anterior a "Desde".</p>';
    return;
  }

  // Construir lista de días del rango (límite de seguridad: 120 días)
  const dias = [];
  const cur = new Date(ini);
  let guard = 0;
  while (cur <= fin && guard < 120) {
    const iso = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
    dias.push(iso);
    if (!(iso in CERT_DIAS_STATE)) {
      // Por defecto se incluyen todos los días del rango, lunes a domingo,
      // sin importar si ese día se trabaja o no.
      CERT_DIAS_STATE[iso] = 'incluir';
    }
    cur.setDate(cur.getDate() + 1);
    guard++;
  }
  // Limpiar días que ya no están en el rango
  Object.keys(CERT_DIAS_STATE).forEach(k => { if (!dias.includes(k)) delete CERT_DIAS_STATE[k]; });

  const DIAS_SEMANA = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const seg = (iso, val, label) => {
    const activo = CERT_DIAS_STATE[iso] === val ? 'active' : '';
    return `<button type="button" class="cert-seg ${activo}" data-iso="${iso}" data-val="${val}" onclick="setCertDia('${iso}','${val}')">${label}</button>`;
  };
  const filas = dias.map(iso => {
    const [yy,mm,dd] = iso.split('-').map(Number);
    const dObj = new Date(yy, mm-1, dd);
    const finde = dObj.getDay() === 0 || dObj.getDay() === 6;
    const fer   = esFeriado(dObj);
    return `<div class="cert-dia-row ${finde ? 'cert-dia-finde' : ''} ${fer ? 'cert-dia-feriado' : ''}">
      <span class="cert-dia-lbl">${DIAS_SEMANA[dObj.getDay()]} ${String(dd).padStart(2,'0')}/${String(mm).padStart(2,'0')}${fer ? ' <span class="cert-dia-fer-tag">Feriado</span>' : ''}</span>
      <div class="cert-seg-group">
        ${seg(iso,'incluir','Incluir')}
        ${seg(iso,'quitar','Quitar')}
      </div>
    </div>`;
  }).join('');

  cont.innerHTML =
    `<div class="cert-dias-nota">El certificado no suma horas: solo marca el día como CERTIFICADO. "Quitar" excluye ese día puntual.</div>
     <div class="cert-dias-cont">${filas}</div>`;
}

function setCertDia(iso, val) {
  CERT_DIAS_STATE[iso] = val;
  document.querySelectorAll(`.cert-seg[data-iso="${iso}"]`).forEach(b => {
    b.classList.toggle('active', b.dataset.val === val);
  });
}

function setCertTodos(val) {
  Object.keys(CERT_DIAS_STATE).forEach(k => CERT_DIAS_STATE[k] = val);
  renderCertRango();
}

function onCertTipoChange() {
  const tipo = document.getElementById('certTipo')?.value;
  const grupo = document.getElementById('certNotaGrupo');
  if (grupo) grupo.style.display = tipo === 'Personalizado' ? 'block' : 'none';
}

async function confirmarCertificado(nombreEmp) {
  const tipo  = document.getElementById('certTipo')?.value;
  const notaP = document.getElementById('certNotaPersonalizada')?.value.trim();
  const errEl = document.getElementById('certError');
  errEl.style.display = 'none';

  // Días seleccionados (excluyendo los marcados como "quitar")
  const dias = Object.keys(CERT_DIAS_STATE)
    .filter(iso => CERT_DIAS_STATE[iso] !== 'quitar')
    .sort();

  if (!dias.length) {
    errEl.textContent = 'Elegí al menos un día del rango.'; errEl.style.display='block'; return;
  }
  if (tipo === 'Personalizado' && !notaP) {
    errEl.textContent = 'Escribí una descripción'; errEl.style.display='block'; return;
  }

  const nota = tipo === 'Personalizado' ? notaP : tipo;
  // Guardar nombre sin número (ej: "38 BRUNO ALONSO" → "BRUNO ALONSO")
  const empLimpio = nombreEmp.trim().replace(/^\d+\s+/, '');

  const btn = document.querySelector('#adminOverlay .btn-connect');
  let okCount = 0, fail = 0;
  for (let i = 0; i < dias.length; i++) {
    const fecha = dias[i];
    const hs = 0; // los certificados no suman horas
    if (btn) { btn.disabled = true; btn.textContent = `Guardando ${i+1}/${dias.length}...`; }
    const r = await guardarCertificado({ empleado: empLimpio, fecha, tipo, hs, nota });
    if (r.ok) okCount++; else fail++;
  }

  if (okCount > 0) {
    cerrarAdmin();
    showToast(fail
      ? `Guardados ${okCount} · fallaron ${fail}`
      : `✓ ${okCount} certificado${okCount > 1 ? 's' : ''} guardado${okCount > 1 ? 's' : ''}`);
    if (_certFlujoDesdeAdmin) {
      _certFlujoDesdeAdmin = false;
      renderAdminInline();
      const railBtn = document.querySelector("#adminRail .rail-item[onclick*=\"'certificados'\"]");
      if (railBtn) switchAdminTab('certificados', railBtn);
    } else {
      // Reabrir la ficha del empleado para ver los certificados
      const suc = state.datos.find(r => r.EMPLEADO === nombreEmp);
      if (suc) abrirDetalleEmpleado(nombreEmp, suc.LOCAL);
    }
  } else {
    if (btn) { btn.disabled = false; btn.textContent = 'Guardar certificado'; }
    errEl.textContent = 'Error al guardar. Revisá la conexión.'; errEl.style.display='block';
  }
}

async function eliminarCertificado(id, nombreEmp, mesAnio) {
  if (!confirm('¿Borrar este certificado?')) return;
  const ok = await borrarCertificado(id);
  if (ok) {
    showToast('✓ Certificado eliminado');
    const suc = state.datos.find(r => r.EMPLEADO === nombreEmp);
    if (suc) abrirDetalleEmpleado(nombreEmp, suc.LOCAL);
  } else {
    showToast('Error al eliminar');
  }
}

