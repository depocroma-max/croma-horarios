// ── RECIBOS DE SUELDO — pestaña admin dentro de la ficha de empleado ──
// _recibosFicha: estado de la pestaña Recibos para el empleado actualmente
// abierto en la ficha. Se reinicia cada vez que se abre abrirFormularioEmpleado.
// null cuando la pestaña no está disponible (empleado nuevo o rol sin permiso).
let _recibosFicha = null;

function _renderTabRecibosEmpleado(emp) {
  const nombreLegal = (emp.nombre_legal || '').trim();
  const nomEncAviso = String(emp.nombre || '').replace(/'/g, "\\'");
  const avisoNombreLegal = !nombreLegal ? `
    <div class="alert alert-warning" style="margin-bottom:12px;font-size:12.5px">
      ${icon('alertTriangle','icon-16')} Falta el nombre legal de este colaborador — completalo en la pestaña
      <a href="javascript:void(0)" onclick="_irAPerfilDesdeRecibos('${nomEncAviso}')" style="font-weight:600">Perfil</a>
      antes de subir recibos.
    </div>` : '';
  // Nombre/nombre legal/empresa ya se muestran en el encabezado de la
  // ficha (ver admin-header-rich) — acá solo lo específico de Recibos,
  // sin duplicar identidad.
  return `
    <div style="margin-bottom:14px">
      <div style="font-family:var(--font-display);font-size:17px;letter-spacing:.5px;color:#0d0d0d">Recibos de sueldo</div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:2px">Los recibos publicados para este colaborador van a aparecer acá.</div>
    </div>
    ${avisoNombreLegal}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;flex-wrap:wrap">
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary);cursor:pointer">
        <input type="checkbox" id="formEmpRecibosHistorial" onchange="_toggleHistorialRecibos(this.checked)" /> Ver historial completo
      </label>
      <button class="btn-admin-edit" type="button" id="formEmpBtnSubirRecibo" ${nombreLegal ? '' : 'disabled'} onclick="_abrirModalRecibo('subir')">${icon('plus','icon-14')} Subir recibo</button>
    </div>
    <div id="formEmpRecibosListado">
      <div class="ajuste-empty-state"><div class="spinner" role="status" aria-label="Cargando"></div><p class="text-secondary">Cargando recibos…</p></div>
    </div>
  `;
}

// Carga el listado solo la primera vez que se entra a la pestaña — no
// vuelve a pedir al servidor por cada click en "Recibos" salvo forzarRecarga
// (usado tras subir/reemplazar) o al tildar "Ver historial".
function _cargarRecibosEmpleado(forzarRecarga) {
  if (!_recibosFicha) return;
  if (_recibosFicha.cargado && !forzarRecarga) return;
  _recibosFicha.cargado = true;
  _fetchRecibosEmpleado();
}

let _recibosFichaGen = 0; // token de la consulta en vuelo — descarta respuestas obsoletas (ver abajo)

async function _fetchRecibosEmpleado() {
  const cont = document.getElementById('formEmpRecibosListado');
  if (!cont || !_recibosFicha) return;
  cont.innerHTML = "<div class='ajuste-empty-state'><div class='spinner' role='status' aria-label='Cargando'></div><p class='text-secondary'>Cargando recibos…</p></div>";

  const gen = ++_recibosFichaGen;
  const nombreConsultado = _recibosFicha.nombre;
  const qs = _recibosFicha.historial ? '?incluir_historial=true' : '';
  const data = await apiRecibos(`/empleados/${encodeURIComponent(nombreConsultado)}${qs}`, { method: 'GET' });

  // Descartar si mientras esperábamos: se cerró la ficha, se reabrió para
  // OTRO empleado (_recibosFicha ya no es el mismo objeto/nombre), o se
  // disparó una consulta más nueva (doble click en "Ver historial", etc.)
  // que ya actualizó _recibosFichaGen. Sin este chequeo, una respuesta
  // lenta de un empleado anterior podía pisar el listado del actual.
  if (gen !== _recibosFichaGen) return;
  if (!_recibosFicha || _recibosFicha.nombre !== nombreConsultado) return;
  if (!document.getElementById('formEmpRecibosListado')) return;

  if (!data.ok) {
    cont.innerHTML = `<div class="alert alert-danger" style="font-size:12.5px">${icon('alertTriangle','icon-16')} ${_msgApi(data, 'No se pudo cargar el listado de recibos.')}</div>`;
    return;
  }
  _recibosFicha.lista = data.recibos || [];
  _renderListadoRecibos();
}

function _toggleHistorialRecibos(checked) {
  if (!_recibosFicha) return;
  _recibosFicha.historial = checked;
  _fetchRecibosEmpleado();
}

function _formatearPeriodoRecibo(periodo) {
  const MESES_LBL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const m = /^(\d{4})-(\d{2})$/.exec(periodo || '');
  if (!m) return periodo || '—';
  const idx = parseInt(m[2], 10) - 1;
  return `${MESES_LBL[idx] || m[2]} ${m[1]}`;
}

function _formatearFechaRecibo(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
}

function _renderListadoRecibos() {
  const cont = document.getElementById('formEmpRecibosListado');
  if (!cont || !_recibosFicha) return;

  const lista = (_recibosFicha.lista || []).slice().sort((a, b) => {
    if (a.periodo !== b.periodo) return a.periodo < b.periodo ? 1 : -1;
    return (b.version || 0) - (a.version || 0);
  });

  if (lista.length === 0) {
    const msg = _recibosFicha.historial ? 'Sin recibos para mostrar.' : 'Todavía no hay recibos activos cargados.';
    cont.innerHTML = `<div class="ajuste-empty-state">${icon('fileText','icon-48')}<p class="text-secondary">${msg}</p></div>`;
    return;
  }

  const filas = lista.map(r => {
    const activo = r.estado === 'ACTIVO';
    const badge = activo
      ? `<span class="badge badge-success">Activo</span>`
      : `<span class="badge badge-neutral">Reemplazado</span>`;
    const idEnc = String(r.id).replace(/'/g, "\\'");
    const nombreArchivoEsc = String(r.nombre_archivo || '').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    return `<tr>
      <td>${_formatearPeriodoRecibo(r.periodo)}<div style="font-size:11px;color:var(--text-muted)">v${r.version}</div></td>
      <td>${badge}</td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${nombreArchivoEsc}">${nombreArchivoEsc}</td>
      <td>${_formatearFechaRecibo(r.fecha_subida)}${r.subido_por ? `<div style="font-size:11px;color:var(--text-muted)">${r.subido_por}</div>` : ''}</td>
      <td class="al-c">
        <div style="display:flex;gap:6px;justify-content:center">
          <button class="btn-admin-edit" type="button" title="Descargar" onclick="_recibosDescargarAdmin('${idEnc}', this)">${icon('download','icon-14')}</button>
          ${activo ? `<button class="btn-admin-edit" type="button" title="Reemplazar" onclick="_abrirModalRecibo('reemplazar','${idEnc}')">${icon('edit','icon-14')}</button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');

  cont.innerHTML = `<div class="dt-wrap"><table class="dt-table">
    <thead><tr><th>Período</th><th>Estado</th><th>Archivo</th><th>Subido</th><th class="al-c">Acciones</th></tr></thead>
    <tbody>${filas}</tbody>
  </table></div>`;
}

// Overlay propio (no reutiliza #adminOverlay) porque este modal se abre
// ENCIMA de la ficha de empleado, que ya está montada ahí — reutilizar el
// mismo id la reemplazaría y se perdería. Mismo patrón que el diálogo de
// confirmación (#confirmOverlay), apilado por encima vía CSS (ver style.css).
function _mostrarModalRecibo(innerHtml) {
  const existing = document.getElementById('recibosModalOverlay');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.id = 'recibosModalOverlay';
  div.innerHTML = innerHtml;
  document.body.appendChild(div);
}

function _cerrarModalRecibo(event) {
  if (event && event.target !== event.currentTarget) return;
  const el = document.getElementById('recibosModalOverlay');
  if (el) el.remove();
}

function _abrirModalRecibo(modo, reciboId) {
  if (!_recibosFicha) return;
  if (modo === 'subir' && !_recibosFicha.nombreLegal) return; // defensa extra — el botón ya está deshabilitado en este caso

  const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');

  let filaAnterior = null;
  if (modo === 'reemplazar') {
    filaAnterior = (_recibosFicha.lista || []).find(r => String(r.id) === String(reciboId));
    if (!filaAnterior || filaAnterior.estado !== 'ACTIVO') { showToast('Ese recibo ya no está disponible para reemplazar'); return; }
  }

  const periodoCampoHtml = modo === 'reemplazar'
    ? `<input type="text" class="admin-input" id="reciboPeriodoDisplay" value="${esc(_formatearPeriodoRecibo(filaAnterior.periodo))}" readonly />
       <input type="hidden" id="reciboPeriodoFijo" value="${esc(filaAnterior.periodo)}" />
       <span style="font-size:11px;color:var(--text-muted);margin-top:4px;display:block">Versión actual: v${filaAnterior.version}. Se creará una nueva versión y esta quedará marcada como reemplazada.</span>`
    : `<input type="month" class="admin-input" id="reciboPeriodo" />`;

  const html = `
  <div class="admin-overlay recibos-modal-overlay" id="recibosModalOverlayInner" onclick="_cerrarModalRecibo(event)">
    <div class="admin-panel admin-panel-sm" onclick="event.stopPropagation()">
      <div class="admin-header">
        <div class="admin-titulo">${modo === 'reemplazar' ? 'Reemplazar recibo' : 'Subir recibo'}</div>
        <button class="detalle-close" onclick="_cerrarModalRecibo()">${icon('x','icon-16')}</button>
      </div>
      <div class="admin-form">
        <input type="hidden" id="reciboModalIdAnterior" value="${esc(reciboId || '')}" />
        <div class="admin-form-grupo">
          <label class="emp-filtro-label" for="reciboColaboradorDisplay">Colaborador</label>
          <input type="text" class="admin-input" id="reciboColaboradorDisplay" value="${esc(_recibosFicha.nombre)}" readonly />
        </div>
        <div class="admin-form-grupo">
          <label class="emp-filtro-label" for="reciboNombreLegalDisplay">Nombre legal</label>
          <input type="text" class="admin-input" id="reciboNombreLegalDisplay" value="${esc(_recibosFicha.nombreLegal)}" readonly />
        </div>
        <div class="admin-form-grupo">
          <label class="emp-filtro-label" for="reciboEmpresaDisplay">Empresa</label>
          <input type="text" class="admin-input" id="reciboEmpresaDisplay" value="${esc(_recibosFicha.empresa)}" readonly />
        </div>
        <div class="admin-form-grupo">
          <label class="emp-filtro-label" for="${modo === 'reemplazar' ? 'reciboPeriodoDisplay' : 'reciboPeriodo'}">Período</label>
          ${periodoCampoHtml}
        </div>
        <div class="admin-form-grupo">
          <label class="emp-filtro-label" for="reciboArchivo">Archivo PDF (máx. 2MB)</label>
          <input type="file" class="admin-input" id="reciboArchivo" accept="application/pdf" />
        </div>
        <p id="reciboModalError" class="alert alert-danger" style="display:none;margin-top:.5rem"></p>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:1.2rem">
          <button class="btn-connect" style="margin:0" id="reciboModalBtnGuardar" onclick="_guardarRecibo('${modo}')">${modo === 'reemplazar' ? 'Reemplazar recibo' : 'Subir recibo'}</button>
          <button class="btn-demo" onclick="_cerrarModalRecibo()">Cancelar</button>
        </div>
      </div>
    </div>
  </div>`;

  _mostrarModalRecibo(html);
}

const RECIBOS_TAMANO_MAXIMO_BYTES_JS = 2 * 1024 * 1024; // igual que backend/GAS — el servidor revalida igual, esto es solo para no hacer esperar al usuario

function _leerArchivoComoBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const resultado = String(reader.result || '');
      resolve(resultado.split(',')[1] || '');
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

async function _guardarRecibo(modo) {
  if (!_recibosFicha) return;
  const errEl = document.getElementById('reciboModalError');
  const btn = document.getElementById('reciboModalBtnGuardar');
  const mostrarError = (msg) => { if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; } };
  if (errEl) errEl.style.display = 'none';
  if (!btn || btn.disabled) return; // bloqueo de doble-submit

  const archivoInput = document.getElementById('reciboArchivo');
  const file = archivoInput && archivoInput.files && archivoInput.files[0];
  if (!file) { mostrarError('Seleccioná un archivo PDF'); return; }
  if (file.type !== 'application/pdf') { mostrarError('Solo se aceptan archivos PDF'); return; }
  if (file.size === 0) { mostrarError('El archivo está vacío'); return; }
  if (file.size > RECIBOS_TAMANO_MAXIMO_BYTES_JS) { mostrarError('El archivo supera el tamaño máximo permitido (2MB)'); return; }

  let periodo;
  if (modo === 'reemplazar') {
    periodo = document.getElementById('reciboPeriodoFijo')?.value || '';
  } else {
    periodo = document.getElementById('reciboPeriodo')?.value || '';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) { mostrarError('Seleccioná un período válido'); return; }
  }

  btn.disabled = true;
  btn.dataset.textoOriginal = btn.dataset.textoOriginal || btn.textContent;
  btn.textContent = modo === 'reemplazar' ? 'Reemplazando…' : 'Subiendo…';

  try {
    const base64 = await _leerArchivoComoBase64(file);
    const body = {
      periodo,
      nombre_archivo: file.name,
      mime_type: 'application/pdf',
      tamano_bytes: file.size,
      archivo_base64: base64,
    };

    let data;
    if (modo === 'reemplazar') {
      const idAnterior = document.getElementById('reciboModalIdAnterior')?.value || '';
      body.empleado = _recibosFicha.nombre;
      data = await apiRecibos(`/${encodeURIComponent(idAnterior)}/reemplazar`, { method: 'POST', body: JSON.stringify(body) });
    } else {
      data = await apiRecibos(`/empleados/${encodeURIComponent(_recibosFicha.nombre)}`, { method: 'POST', body: JSON.stringify(body) });
    }

    if (!data.ok) {
      mostrarError(_msgApi(data, 'No se pudo completar la operación.'));
      return;
    }

    _cerrarModalRecibo();
    showToast(modo === 'reemplazar' ? 'Recibo reemplazado correctamente' : 'Recibo subido correctamente');
    _fetchRecibosEmpleado();
    if (document.getElementById('adminTablaRecibos')) _cargarEstadoMensualRecibos();
  } catch (err) {
    mostrarError('Error de conexión. Intentá de nuevo.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.textoOriginal || (modo === 'reemplazar' ? 'Reemplazar recibo' : 'Subir recibo'); }
  }
}

async function _recibosDescargarAdmin(id, btn) {
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  const textoOriginal = btn.innerHTML;
  btn.innerHTML = `<span class="spinner" style="width:14px;height:14px;display:inline-block"></span>`;
  try {
    const resp = await fetch(`${BACKEND_URL}/api/recibos/${encodeURIComponent(id)}/descargar`, {
      headers: { 'Authorization': `Bearer ${_getToken()}` },
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      showToast(_msgApi(err, 'No se pudo descargar el recibo'));
      return;
    }
    const blob = await resp.blob();
    const cd = resp.headers.get('Content-Disposition') || '';
    const nombreArchivo = (cd.match(/filename="(.+)"/) || [])[1] || `recibo_${id}.pdf`;
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
    btn.disabled = false;
    btn.innerHTML = textoOriginal;
  }
}

function _mostrarErrorFormEmpleado(msg) {
  const errEl = document.getElementById('formEmpError');
  if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
}

function _setGuardandoFormEmpleado(guardando) {
  const btn = document.getElementById('formEmpBtnGuardar');
  if (!btn) return;
  if (guardando) {
    btn.dataset.textoOriginal = btn.dataset.textoOriginal || btn.textContent;
    btn.textContent = 'Guardando…';
  } else if (btn.dataset.textoOriginal) {
    btn.textContent = btn.dataset.textoOriginal;
  }
  btn.disabled = guardando;
}

async function guardarFormularioEmpleado() {
  const btn = document.getElementById('formEmpBtnGuardar');
  if (!btn || btn.disabled) return; // evita doble submit
  const errEl = document.getElementById('formEmpError');
  if (errEl) errEl.style.display = 'none';

  const nombreOriginal   = document.getElementById('formEmpNombreOriginal')?.value || '';
  const esNuevo          = !nombreOriginal;
  const teniaAccesoAntes = document.getElementById('formEmpTieneAccesoOriginal')?.value === '1';

  const nombre = esNuevo ? (document.getElementById('formEmpNombre')?.value || '').trim() : nombreOriginal;
  if (esNuevo && !nombre) {
    _mostrarErrorFormEmpleado('El nombre es obligatorio');
    return;
  }

  const nombreLegal = (document.getElementById('formEmpNombreLegal')?.value || '').trim();
  // Obligatorio solo al crear — igual que en Node y GAS, no confiar
  // únicamente en esta validación del navegador (se repite en las dos
  // capas del backend).
  if (esNuevo && !nombreLegal) {
    _mostrarErrorFormEmpleado('El nombre legal completo es obligatorio');
    return;
  }

  const fotoUrlRaw = (document.getElementById('formEmpFotoUrl')?.value || '').trim();
  const driveMatch = fotoUrlRaw.match(/\/d\/([^/]+)/);
  const fotoUrl = driveMatch ? `https://drive.google.com/thumbnail?id=${driveMatch[1]}&sz=w200` : fotoUrlRaw;

  const empleadoPayload = {
    nombre,
    nombre_legal:            nombreLegal,
    apodo:                   (document.getElementById('formEmpApodo')?.value || '').trim(),
    empresa:                document.getElementById('formEmpEmpresa')?.value || '',
    categoria_id:            document.getElementById('formEmpCategoria')?.value || '',
    regla_custom:            document.getElementById('formEmpReglaCustom')?.value || '',
    hs_base:                 parseFloat(document.getElementById('formEmpHsBase')?.value) || 8,
    foto_url:                fotoUrl,
    sucursal_id:             document.getElementById('formEmpSucursal')?.value || '',
    fecha_ingreso:           document.getElementById('formEmpFechaIngreso')?.value || '',
    celular:                 (document.getElementById('formEmpCelular')?.value || '').trim().replace(/\D/g, ''),
    numero_vendedor_sysneo:  (document.getElementById('formEmpSysneo')?.value || '').trim(),
    estado:                  document.getElementById('formEmpEstado')?.value || 'activo',
  };

  const crearAccesoCheckbox = document.getElementById('formEmpCrearAcceso'); // solo existe si NO tenía acceso
  const quiereCrearAcceso = !teniaAccesoAntes && !!crearAccesoCheckbox && crearAccesoCheckbox.checked;

  _setGuardandoFormEmpleado(true);
  try {
    if (esNuevo) {
      const usuario = quiereCrearAcceso ? {
        username: (document.getElementById('formEmpUsername')?.value || '').trim(),
        pin:      (document.getElementById('formEmpPin')?.value || '').trim(),
      } : null;

      if (quiereCrearAcceso && (!usuario.username || !usuario.pin)) {
        _mostrarErrorFormEmpleado('Usuario y PIN son obligatorios para crear el acceso');
        _switchFormEmpTab('acceso', document.querySelectorAll('#formEmpTabs .admin-tab')[2]);
        return;
      }

      const data = await apiEmpleados('', {
        method: 'POST',
        body: JSON.stringify({ empleado: empleadoPayload, crear_acceso: quiereCrearAcceso, usuario }),
      });

      if (data.ok) {
        showToast('✓ Empleado creado');
        await _refrescarAdminEmpleados();
        cerrarFormularioEmpleado();
      } else if (data.estado === 'empleado_creado_acceso_fallido') {
        showToast('El empleado fue creado correctamente, pero no se pudo crear el acceso. Podés reintentarlo desde la pestaña Acceso.', 4500);
        await _refrescarAdminEmpleados();
        // No se cierra el formulario: se reabre en modo edición sobre el
        // empleado recién creado, en la pestaña Acceso, para reintentar
        // solo esa parte — el empleado ya quedó guardado (ver diseño,
        // resultado parcial "empleado_creado_acceso_fallido").
        abrirFormularioEmpleado(nombre, 'acceso');
      } else {
        _mostrarErrorFormEmpleado(data.error || 'No se pudo crear el empleado');
      }
      return;
    }

    // ── Edición ──
    const resPerfil = await apiEmpleados(`/${encodeURIComponent(nombre)}`, {
      method: 'PUT',
      body: JSON.stringify({ empleado: empleadoPayload }),
    });
    if (!resPerfil.ok) {
      _mostrarErrorFormEmpleado(resPerfil.error || 'No se pudo guardar el empleado');
      return;
    }

    if (quiereCrearAcceso) {
      const usuario = {
        username: (document.getElementById('formEmpUsername')?.value || '').trim(),
        pin:      (document.getElementById('formEmpPin')?.value || '').trim(),
      };
      if (!usuario.username || !usuario.pin) {
        showToast('✓ Empleado actualizado (no se creó el acceso: faltó usuario o PIN)', 4000);
      } else {
        const resAcceso = await apiEmpleados(`/${encodeURIComponent(nombre)}/acceso`, {
          method: 'POST',
          body: JSON.stringify({ usuario }),
        });
        showToast(resAcceso.ok
          ? '✓ Empleado actualizado y acceso creado'
          : ('Empleado actualizado, pero no se pudo crear el acceso: ' + (resAcceso.error || '')), 4000);
      }
    } else if (teniaAccesoAntes) {
      const estadoAcceso = document.getElementById('formEmpAccesoEstado')?.value;
      const finAcceso     = document.getElementById('formEmpFinAcceso')?.value || null;
      const estadoOriginal = document.getElementById('formEmpAccesoEstadoOriginal')?.value;
      const finAccesoOriginal = document.getElementById('formEmpFinAccesoOriginal')?.value || null;
      // Solo mandar el PATCH si el admin realmente tocó algo de la pestaña
      // Acceso — si no, quedaba disparándose en cada edición de cualquier
      // campo (ej. asignar Sysneo) y registraba ACCESO_ACTIVADO en la
      // auditoría sin que nada hubiera cambiado de verdad.
      if (estadoAcceso && (estadoAcceso !== estadoOriginal || finAcceso !== finAccesoOriginal)) {
        const resEstado = await apiEmpleados(`/${encodeURIComponent(nombre)}/acceso/estado`, {
          method: 'PATCH',
          body: JSON.stringify({ estado: estadoAcceso, fin_acceso: finAcceso }),
        });
        if (!resEstado.ok) showToast('El empleado se guardó, pero no se pudo actualizar el acceso: ' + (resEstado.error || ''), 4500);
      }
      const pinField = document.getElementById('formEmpPin');
      const pinNuevo = pinField && pinField.style.display !== 'none' ? pinField.value.trim() : '';
      if (pinNuevo) {
        const resPin = await apiEmpleados(`/${encodeURIComponent(nombre)}/acceso/pin`, {
          method: 'POST',
          body: JSON.stringify({ pin_nuevo: pinNuevo }),
        });
        if (!resPin.ok) showToast('El empleado se guardó, pero no se pudo cambiar el PIN: ' + (resPin.error || ''), 4500);
      }
      showToast('✓ Empleado actualizado');
    } else {
      showToast('✓ Empleado actualizado');
    }

    await _refrescarAdminEmpleados();
    cerrarFormularioEmpleado();
  } finally {
    _setGuardandoFormEmpleado(false);
  }
}

// ── Menú "Más acciones" (kebab) de la tabla premium ────
// Agrupa acciones contextuales que no entran como ícono compacto directo
// en la fila (Editar / Cambiar PIN o Crear acceso ya están siempre
// visibles — ver renderAdminInline). Popover simple, se cierra al
// clickear afuera.
function abrirMasAccionesEmpleado(event, nombre) {
  event.stopPropagation();
  document.getElementById('dtMenuPopover')?.remove();
  const emp = obtenerEmpleadosAdmin().find(e => e.nombre === nombre);
  if (!emp) return;
  const nomEnc = nombre.replace(/'/g, "\\'");
  const btn = event.currentTarget;
  const rect = btn.getBoundingClientRect();

  const items = [];
  if (emp._usuario && emp._usuario.estado !== 'inactivo') {
    items.push({ label: 'Desactivar acceso', accion: `accionDesactivarAcceso('${nomEnc}')`, peligro: true });
  }
  items.push({
    label: emp.numero_vendedor_sysneo ? 'Editar número Sysneo' : 'Asignar número Sysneo',
    accion: `abrirAsignarSysneo('${nomEnc}')`,
  });

  const menu = document.createElement('div');
  menu.id = 'dtMenuPopover';
  menu.className = 'dt-menu';
  menu.style.position = 'fixed';
  menu.style.top = (rect.bottom + 4) + 'px';
  menu.style.left = Math.max(8, rect.right - 200) + 'px';
  menu.innerHTML = items.map(it =>
    `<button class="dt-menu-item${it.peligro ? ' dt-menu-item--peligro' : ''}" onclick="document.getElementById('dtMenuPopover')?.remove();${it.accion}">${it.label}</button>`
  ).join('');
  document.body.appendChild(menu);

  setTimeout(() => {
    document.addEventListener('click', function _cerrarDtMenu(e2) {
      if (!menu.contains(e2.target)) { menu.remove(); document.removeEventListener('click', _cerrarDtMenu); }
    });
  }, 0);
}

// ── Acciones rápidas desde la tabla ────────────────────
function accionDesactivarAcceso(nombre) {
  mostrarConfirm({
    titulo: 'Desactivar acceso',
    mensaje: `¿Desactivar el acceso de <strong>${nombre.replace(/^\d+\s+/, '')}</strong>? El empleado no se toca, solo deja de poder entrar a Croma Horarios.`,
    textoOk: 'Desactivar',
    peligro: true,
    onOk: async () => {
      const data = await apiEmpleados(`/${encodeURIComponent(nombre)}/acceso/estado`, {
        method: 'PATCH', body: JSON.stringify({ estado: 'inactivo' }),
      });
      if (data.ok) { showToast('✓ Acceso desactivado'); await _refrescarAdminEmpleados(); }
      else showToast('No se pudo desactivar: ' + (data.error || ''));
    },
  });
}

async function accionReactivarAcceso(nombre) {
  const data = await apiEmpleados(`/${encodeURIComponent(nombre)}/acceso/estado`, {
    method: 'PATCH', body: JSON.stringify({ estado: 'activo' }),
  });
  if (data.ok) { showToast('✓ Acceso reactivado'); await _refrescarAdminEmpleados(); }
  else showToast('No se pudo reactivar: ' + (data.error || ''));
}

function abrirCambiarPinAdmin(nombre) {
  const nomEnc = nombre.replace(/'/g, "\\'");
  const html = `
  <div class="admin-overlay" id="adminOverlay" onclick="cerrarAdmin(event)">
    <div class="admin-panel admin-panel-sm" onclick="event.stopPropagation()">
      <div class="admin-header">
        <div class="admin-titulo">Cambiar PIN</div>
        <button class="detalle-close" onclick="cerrarAdmin()">${icon('x','icon-16')}</button>
      </div>
      <div class="admin-form">
        <input type="hidden" id="pinRapidoNombre" value="${nomEnc}" />
        <div class="admin-form-grupo">
          <label class="emp-filtro-label" for="pinRapidoValor">PIN nuevo</label>
          <input type="text" class="admin-input" id="pinRapidoValor" placeholder="Ej: 1234" maxlength="8" inputmode="numeric" autocomplete="off" />
        </div>
        <p id="pinRapidoError" class="alert alert-danger" style="display:none;margin-top:.5rem"></p>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:1.5rem">
          <button class="btn-connect" style="margin:0" id="pinRapidoBtn" onclick="_guardarPinRapido()">Guardar PIN</button>
          <button class="btn-demo" onclick="cerrarAdmin()">Cancelar</button>
        </div>
      </div>
    </div>
  </div>`;
  montarOverlayAdmin(html);
}

async function _guardarPinRapido() {
  const btn = document.getElementById('pinRapidoBtn');
  if (!btn || btn.disabled) return;
  const nombre = document.getElementById('pinRapidoNombre')?.value;
  const pin = (document.getElementById('pinRapidoValor')?.value || '').trim();
  const errEl = document.getElementById('pinRapidoError');
  if (errEl) errEl.style.display = 'none';
  if (!pin || pin.length < 4) {
    if (errEl) { errEl.textContent = 'El PIN debe tener al menos 4 caracteres'; errEl.style.display = 'block'; }
    return;
  }
  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    const data = await apiEmpleados(`/${encodeURIComponent(nombre)}/acceso/pin`, {
      method: 'POST', body: JSON.stringify({ pin_nuevo: pin }),
    });
    if (data.ok) { showToast('✓ PIN actualizado'); cerrarAdmin(); }
    else if (errEl) { errEl.textContent = data.error || 'No se pudo cambiar el PIN'; errEl.style.display = 'block'; }
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar PIN';
  }
}

function abrirAsignarSysneo(nombre) {
  const emp = obtenerEmpleadosAdmin().find(e => e.nombre === nombre) || {};
  const nomEnc = nombre.replace(/'/g, "\\'");
  const html = `
  <div class="admin-overlay" id="adminOverlay" onclick="cerrarAdmin(event)">
    <div class="admin-panel admin-panel-sm" onclick="event.stopPropagation()">
      <div class="admin-header">
        <div class="admin-titulo">Número de vendedor Sysneo</div>
        <button class="detalle-close" onclick="cerrarAdmin()">${icon('x','icon-16')}</button>
      </div>
      <div class="admin-form">
        <input type="hidden" id="sysneoRapidoNombre" value="${nomEnc}" />
        <div class="admin-form-grupo">
          <label class="emp-filtro-label" for="sysneoRapidoValor">Número</label>
          <input type="text" class="admin-input" id="sysneoRapidoValor" value="${emp.numero_vendedor_sysneo || ''}" placeholder="Opcional" autocomplete="off" />
          <span style="font-size:11px;color:var(--text-muted);margin-top:4px;display:block">
            Este número se crea manualmente en Sysneo y acá se guarda únicamente como referencia. Croma Horarios no se conecta ni sincroniza con Sysneo.
          </span>
        </div>
        <p id="sysneoRapidoError" class="alert alert-danger" style="display:none;margin-top:.5rem"></p>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:1.5rem">
          <button class="btn-connect" style="margin:0" id="sysneoRapidoBtn" onclick="_guardarSysneoRapido()">Guardar</button>
          <button class="btn-demo" onclick="cerrarAdmin()">Cancelar</button>
        </div>
      </div>
    </div>
  </div>`;
  montarOverlayAdmin(html);
}

async function _guardarSysneoRapido() {
  const btn = document.getElementById('sysneoRapidoBtn');
  if (!btn || btn.disabled) return;
  const nombre = document.getElementById('sysneoRapidoNombre')?.value;
  const numero = (document.getElementById('sysneoRapidoValor')?.value || '').trim();
  const errEl = document.getElementById('sysneoRapidoError');
  if (errEl) errEl.style.display = 'none';
  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    const data = await apiEmpleados(`/${encodeURIComponent(nombre)}/numero-sysneo`, {
      method: 'POST', body: JSON.stringify({ numero_vendedor_sysneo: numero || null }),
    });
    if (data.ok) { showToast('✓ Número Sysneo guardado'); cerrarAdmin(); await _refrescarAdminEmpleados(); }
    else if (errEl) { errEl.textContent = data.error || 'No se pudo guardar'; errEl.style.display = 'block'; }
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar';
  }
}

// abrirEditarEmpleado (modal de empleado sin acceso) y guardarPerfilDesdeForm
// se eliminaron en el Commit 4 — reemplazados por abrirFormularioEmpleado.
// toggleHsBase también se eliminó (solo la usaba ese modal viejo; el
// formulario nuevo usa _toggleHsBaseFormEmp). Confirmado sin referencias
// antes de borrar. previewFoto se conserva: la reusa el formulario nuevo.
function previewFoto(url) {
  const preview = document.getElementById('adminFotoPreview');
  if (!preview) return;
  if (!url) { preview.innerHTML = '<div style="width:80px;height:80px;border-radius:50%;background:#f1f5f9;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--text-muted)">Sin foto</div>'; return; }
  // Convertir link de Drive a thumbnail si corresponde
  const driveMatch = url.match(/\/d\/([^/]+)/);
  const imgUrl = driveMatch ? `https://drive.google.com/thumbnail?id=${driveMatch[1]}&sz=w200` : url;
  preview.innerHTML = `<img src="${imgUrl}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid #e2e8f0" onerror="this.parentElement.innerHTML='URL inválida'">`;
}

function abrirNuevaCategoria() { abrirEditarCategoria(null); }

function abrirEditarCategoria(catId) {
  const cat = catId ? CATEGORIAS_CONFIG.find(c => c.id === catId) : null;

  const html = `
  <div class="admin-overlay" id="adminOverlay" onclick="cerrarAdmin(event)">
    <div class="admin-panel admin-panel-sm" onclick="event.stopPropagation()">
      <div class="admin-header">
        <div class="admin-titulo">${cat ? 'Editar categoría' : 'Nueva categoría'}</div>
        <button class="detalle-close" onclick="cerrarAdmin();renderAdmin()">${icon('x','icon-16')}</button>
      </div>
      <div class="admin-form">
        <div class="admin-form-grupo">
          <label class="emp-filtro-label" for="catId">ID (código corto)</label>
          <input type="text" class="admin-input" id="catId" value="${cat?.id||''}" placeholder="Ej: JC, MJ, FR..." maxlength="10" ${cat?'readonly':''} />
        </div>
        <div class="admin-form-grupo">
          <label class="emp-filtro-label" for="catNombre">Nombre</label>
          <input type="text" class="admin-input" id="catNombre" value="${cat?.nombre||''}" placeholder="Ej: Jornada Completa" />
        </div>
        <div class="admin-form-grupo">
          <label class="emp-filtro-label" for="catDesc">Descripción</label>
          <input type="text" class="admin-input" id="catDesc" value="${esc(cat?.descripcion)}" placeholder="Ej: 8h Lun-Vie, 4h Sáb" />
        </div>
        <div class="admin-form-grupo">
          <label class="emp-filtro-label" for="catRegla">Regla de cálculo</label>
          <select class="admin-input" id="catRegla">
            <option value="lv8_s4" ${cat?.regla==='lv8_s4'?'selected':''}>8h Lun-Vie, 4h Sáb (Jornada completa)</option>
            <option value="fijo4" ${cat?.regla==='fijo4'?'selected':''}>4h cualquier día (Media jornada)</option>
            <option value="sin_extra" ${cat?.regla==='sin_extra'?'selected':''}>Sin horas extra (Franquero)</option>
            <option value="hs_base" ${cat?.regla==='hs_base'?'selected':''}>Según hs_base del empleado</option>
          </select>
        </div>
        <div class="admin-form-grupo">
          <label class="emp-filtro-label" style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="catPercibe" ${cat?.percibe_extra!==false?'checked':''} style="width:16px;height:16px" />
            Percibe horas extra
          </label>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:1.5rem">
          <button class="btn-connect" style="margin:0" onclick="guardarCategoriaDesdeForm()">Guardar</button>
          <button class="btn-demo" onclick="cerrarAdmin();renderAdmin()">Cancelar</button>
        </div>
      </div>
    </div>
  </div>`;

  montarOverlayAdmin(html);
}

async function guardarCategoriaDesdeForm() {
  const id       = document.getElementById('catId')?.value.trim().toUpperCase();
  const nombre   = document.getElementById('catNombre')?.value.trim();
  const desc     = document.getElementById('catDesc')?.value.trim();
  const regla    = document.getElementById('catRegla')?.value;
  const percibe  = document.getElementById('catPercibe')?.checked;

  if (!id || !nombre) { showToast('Completá ID y Nombre'); return; }

  const cat = { id, nombre, descripcion: desc, regla, percibe_extra: percibe };
  await guardarCategoria(cat);
}

function montarOverlayAdmin(html) {
  const existing = document.getElementById('adminOverlay');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.id = 'adminOverlay';
  div.innerHTML = html;
  document.body.appendChild(div);
  document.body.style.overflow = 'hidden';
}

function cerrarAdmin(event) {
  if (event && event.target !== event.currentTarget) return;
  const el = document.getElementById('adminOverlay');
  if (el) el.remove();
  document.body.style.overflow = '';
}

