// ── HELPERS ───────────────────────────────────────────
function _playNotifSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [[523, 0], [659, 0.18]].forEach(([freq, when]) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + when);
      gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + when + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + when + 0.5);
      osc.start(ctx.currentTime + when);
      osc.stop(ctx.currentTime + when + 0.55);
    });
    return true;
  } catch(e) { return false; }
}

var _pendingNotifSound = false;

function sonarNotificacion() {
  // Los navegadores bloquean AudioContext sin interacción previa.
  // Intentamos reproducir; si falla, esperamos el primer toque del usuario.
  if (!_playNotifSound()) {
    _pendingNotifSound = true;
    const handler = function() {
      if (_pendingNotifSound) { _playNotifSound(); _pendingNotifSound = false; }
      document.removeEventListener('touchstart', handler);
      document.removeEventListener('click', handler);
    };
    document.addEventListener('touchstart', handler, { once: true });
    document.addEventListener('click', handler, { once: true });
  }
}

// ── ADMIN: cargar y renderizar lista de anuncios ──────
// Barrida final GAS→Node (2026-09-18): antes pegaba directo a
// accion=get_anuncios (GAS, doGet, sin auth). Ahora usa apiAnuncios() (JWT
// automático). Shape de respuesta sin cambios ({ok,anuncios}).
async function cargarListaAnuncios() {
  const el = document.getElementById('adminAnunciosList');
  if (!el) return;
  try {
    const json = await apiAnuncios('', { method: 'GET' });
    if (!json.ok) throw new Error(json.error || 'Error');
    _anunciosCache = json.anuncios || [];
    renderListaAnuncios(_anunciosCache);
  } catch(e) {
    el.innerHTML = `<div style="padding:1.5rem;color:#dc2626;font-size:13px">Error: ${e.message}</div>`;
  }
}

function renderListaAnuncios(anuncios) {
  const el = document.getElementById('adminAnunciosList');
  if (!el) return;
  if (!anuncios.length) {
    el.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:13px">No hay anuncios enviados aún.<br>Creá el primero con el botón de arriba.</div>';
    return;
  }
  el.innerHTML = anuncios.map(a => {
    let destLabel = 'Todos los empleados';
    try {
      const lista = JSON.parse(a.destinatarios);
      if (Array.isArray(lista) && lista.length) {
        destLabel = lista.map(n => n.replace(/^\d+\s+/,'')).join(', ');
      }
    } catch(e) {}
    return `<div class="anuncio-admin-item">
      <div class="anuncio-admin-meta">
        <span class="anuncio-admin-fecha">${icon('calendar','icon-14')} ${a.fecha}</span>
        <span class="anuncio-admin-dest">${icon('users','icon-14')} ${esc(destLabel)}</span>
        <button class="btn-admin-edit" style="background:#fee2e2;color:#991b1b;border-color:#fca5a5;font-size:11px;margin-left:auto"
          onclick="eliminarAnuncioAdmin('${a.id}')">${icon('trash','icon-14')} Eliminar</button>
      </div>
      <div class="anuncio-admin-titulo">${esc(a.titulo)}</div>
      <div class="anuncio-admin-msg">${esc(a.mensaje)}</div>
    </div>`;
  }).join('');
}

// ── ADMIN: modal nuevo anuncio ─────────────────────────
async function abrirNuevoAnuncio() {
  const usuarios = (await _asegurarUsuariosAdmin()).filter(u => u.rol === 'empleado' && u.empleadoNombre && u.estado !== 'inactivo');

  // Filas de empleados: checkbox destinatario + icono WA si tiene celular
  const empOpts = usuarios.map(u => {
    const nom     = u.empleadoNombre.replace(/^\d+\s+/,'');
    const celular = u.celular ? u.celular.replace(/\D/g,'') : '';
    const waBtn   = celular
      ? `<span class="anuncio-wa-toggle" title="Enviar por WhatsApp también"
           onclick="toggleWaCheck(this)" data-celular="${celular}" data-activo="0">
           <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.122 1.532 5.859L.057 23.535a.75.75 0 0 0 .916.916l5.676-1.475A11.943 11.943 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75a9.698 9.698 0 0 1-4.953-1.356l-.355-.211-3.67.953.976-3.567-.232-.368A9.699 9.699 0 0 1 2.25 12C2.25 6.615 6.615 2.25 12 2.25S21.75 6.615 21.75 12 17.385 21.75 12 21.75z"/></svg>
           WA
         </span>`
      : `<span style="font-size:10px;color:#cbd5e1" title="Sin número cargado">sin WA</span>`;
    return `<div class="anuncio-dest-row">
      <label class="anuncio-dest-check" style="flex:1;margin:0">
        <input type="checkbox" name="anuncioDestinatarios" value="${u.empleadoNombre}" class="anuncio-dest-cb" />
        <span>${nom}</span>
      </label>
      ${waBtn}
    </div>`;
  }).join('');

  const html = `
  <div class="admin-overlay" id="adminOverlay" onclick="cerrarAdmin(event)">
    <div class="admin-panel admin-panel-sm" onclick="event.stopPropagation()">
      <div class="admin-header">
        <div class="admin-titulo">Nuevo anuncio</div>
        <button class="detalle-close" onclick="cerrarAdmin()" aria-label="Cerrar">${icon('x','icon-16')}</button>
      </div>
      <div class="admin-form">
        <div class="admin-form-grupo">
          <label class="emp-filtro-label" for="anuncioTitulo">Título del anuncio</label>
          <input type="text" class="admin-input" id="anuncioTitulo" placeholder="Ej: Reunión de equipo" maxlength="80" />
        </div>
        <div class="admin-form-grupo">
          <label class="emp-filtro-label" for="anuncioMensaje">Mensaje</label>
          <textarea class="admin-input" id="anuncioMensaje" rows="4"
            style="height:auto;resize:vertical;padding-top:10px;padding-bottom:10px"
            placeholder="Escribí el mensaje completo aquí..."></textarea>
        </div>
        <div class="admin-form-grupo">
          <label class="emp-filtro-label" for="anuncioVigencia">Vigencia (opcional)</label>
          <div style="display:flex;align-items:center;gap:10px">
            <input type="date" class="admin-input" id="anuncioVigencia" style="margin:0;flex:1" />
            <span style="font-size:11px;color:var(--text-muted);white-space:nowrap">Si no se pone, caduca a los 30 días</span>
          </div>
        </div>
        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Destinatarios</label>
          <label class="anuncio-dest-check" style="margin-bottom:6px;font-weight:600">
            <input type="checkbox" id="anuncioDestTodos" checked onchange="toggleTodosAnuncio(this)" />
            <span>${icon('users','icon-14')} Todos los empleados</span>
          </label>
          <div id="anuncioDestLista" style="display:none;flex-direction:column;gap:4px;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;max-height:200px;overflow-y:auto">
            ${empOpts || '<span style="font-size:12px;color:var(--text-muted)">No hay empleados con usuario vinculado</span>'}
            <div style="margin-top:6px;padding-top:6px;border-top:1px solid #f1f5f9;font-size:11px;color:var(--text-muted)">
              Hacé clic en el botón <strong style="color:#25D366">WA</strong> para enviar también por WhatsApp a ese empleado
            </div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:1.5rem">
          <button class="btn-connect" style="margin:0" onclick="publicarAnuncio()">${icon('bell','icon-16')} Publicar anuncio</button>
          <button class="btn-demo" onclick="cerrarAdmin()">Cancelar</button>
        </div>
      </div>
    </div>
  </div>`;
  montarOverlayAdmin(html);
}

function toggleTodosAnuncio(chk) {
  const lista = document.getElementById('anuncioDestLista');
  if (!lista) return;
  lista.style.display = chk.checked ? 'none' : 'flex';
}

function toggleWaCheck(el) {
  const activo = el.dataset.activo === '1';
  el.dataset.activo = activo ? '0' : '1';
  el.classList.toggle('anuncio-wa-activo', !activo);
}

async function publicarAnuncio() {
  const titulo  = document.getElementById('anuncioTitulo')?.value.trim();
  const mensaje = document.getElementById('anuncioMensaje')?.value.trim();
  if (!titulo) { showToast('Ingresá un título para el anuncio'); return; }
  if (!mensaje) { showToast('Escribí el mensaje del anuncio'); return; }

  const todosMarcado = document.getElementById('anuncioDestTodos')?.checked;
  let destinatarios = [];
  // Recolectar números WA seleccionados (siempre, independiente de "todos")
  const waNumeros = [];
  if (!todosMarcado) {
    document.querySelectorAll('.anuncio-dest-cb:checked').forEach(cb => destinatarios.push(cb.value));
    if (!destinatarios.length) { showToast('Seleccioná al menos un destinatario'); return; }
    // WA solo de los seleccionados individualmente
    document.querySelectorAll('.anuncio-wa-toggle[data-activo="1"]').forEach(el => {
      waNumeros.push(el.dataset.celular);
    });
  } else {
    // "Todos" — WA de todos los que tengan botón activo (si hay alguno activo)
    document.querySelectorAll('.anuncio-wa-toggle[data-activo="1"]').forEach(el => {
      waNumeros.push(el.dataset.celular);
    });
  }

  const vigencia = document.getElementById('anuncioVigencia')?.value || '';

  try {
    const json = await apiAnuncios('', {
      method: 'POST',
      body: JSON.stringify({ titulo, mensaje, destinatarios, vigencia }),
    });
    if (!json.ok) throw new Error(json.error || 'Error');
    cerrarAdmin();
    showToast('✓ Anuncio publicado');
    _anunciosCache = null;
    cargarListaAnuncios();

    // Abrir links de WhatsApp si hay destinatarios WA seleccionados
    if (waNumeros.length) {
      const textoWA = encodeURIComponent(`📣 *${titulo}*\n\n${mensaje}\n\n_— Croma Horarios_`);
      // Abrir de a uno con pequeño delay para no bloquear el navegador
      waNumeros.forEach((num, i) => {
        setTimeout(() => {
          window.open(`https://wa.me/549${num}?text=${textoWA}`, '_blank');
        }, i * 600);
      });
      showToast(`📱 Abriendo WhatsApp para ${waNumeros.length} empleado${waNumeros.length > 1 ? 's' : ''}...`, 3500);
    }
  } catch(e) {
    showToast('Error: ' + e.message);
  }
}

async function eliminarAnuncioAdmin(id) {
  if (!confirm('¿Eliminar este anuncio?')) return;
  try {
    const json = await apiAnuncios(`/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!json.ok) throw new Error(json.error || 'Error');
    showToast('✓ Anuncio eliminado');
    _anunciosCache = null;
    cargarListaAnuncios();
  } catch(e) {
    showToast('Error: ' + e.message);
  }
}

// ── EMPLEADO: verificar y mostrar anuncios nuevos ─────
var _anunciosTodosCache = [];  // cache para refrescar la seccion al cerrar banner
var _empSemanaOffset   = 0;   // semanas adelante/atrás en el portal empleado
var _empPortalActual   = '';  // nombre del empleado activo en el portal
var _empSucIdActual    = '';  // Etapa 3.2 (transición AVISOS): sucursal ya
                               // resuelta del empleado activo — mismo valor
                               // que calcula mostrarVistaEmpleado(), guardado
                               // ahí mismo para que marcarAnuncioLeido() no
                               // tenga que volver a resolverla. Se sincroniza
                               // siempre junto con _empPortalActual (mismo y
                               // único punto de asignación de ambos).
var _empMisRegistros   = [];  // registros del empleado activo (para re-render semana)
var _anunciosEmpActual  = '';
var _empPlanHorariosCache = {}; // semanaId -> {horarios} de /api/horarios-semanales, o null si falló

// NOTA: sin invocaciones activas hoy (ver comentario más abajo, "queda
// sin ningún caller activo") — se migra igual, por completitud, para que
// no quede ningún fetch directo a GAS en el archivo aunque esté muerta.
async function verificarAnunciosEmpleado(nombreEmp) {
  try {
    const perfil = EMPLEADOS_PERFILES[nombreEmp] || {};
    // Usar _empMisRegistros como fuente principal (ya está cargado), con fallbacks
    const sucId  = (perfil.sucursal_id ||
                    (_empMisRegistros[0] || {}).LOCAL ||
                    (state.datos.find(r => r.EMPLEADO === nombreEmp) || {}).LOCAL ||
                    '').toString().trim();
    const json = await apiAnuncios(`?empleado=${encodeURIComponent(nombreEmp)}&sucursal=${encodeURIComponent(sucId)}`, { method: 'GET' });
    if (!json.ok) return;
    // Filtrar suc_X en el front (el backend los pasa todos para que filtremos aquí)
    const todos = (json.anuncios || []).filter(a => {
      if (a.destinatarios === 'todos') return true;
      if (a.destinatarios === 'suc_' + sucId) return true;
      // Comparación case-insensitive como fallback
      if (a.destinatarios.toLowerCase() === ('suc_' + sucId).toLowerCase()) return true;
      try {
        const lista = JSON.parse(a.destinatarios);
        if (lista[0] && lista[0].startsWith('suc_')) {
          return lista.some(s => s.toLowerCase() === ('suc_' + sucId).toLowerCase());
        }
        return lista.some(n => n.toLowerCase() === nombreEmp.toLowerCase());
      } catch(e) { return a.destinatarios.toLowerCase() === nombreEmp.toLowerCase(); }
    });
    _anunciosTodosCache = todos;
    _anunciosEmpActual  = nombreEmp;
    // El disparo de Banner (Etapa 3.1) y de Novedades (Etapa 3.2) se
    // sacaron de acá — ver verificarBannerViaProvider() y
    // verificarNovedadesViaProvider(). Esta función sigue siendo
    // responsable exclusiva de Campana.
    actualizarBadgeAnunciosEmp(todos);
  } catch(e) {}
}

// ── Banner vía Provider (Etapa 3.1, transición AVISOS) ────────────────
// Único camino que dispara el Banner — separado a propósito de
// verificarAnunciosEmpleado() de arriba, que sigue sirviendo Novedades y
// Campana por su fetch legacy propio, sin ningún cambio. Este camino
// nunca hace fallback a get_anuncios si el Provider falla: si falla,
// Banner simplemente no aparece, y Novedades/Campana no se enteran.
async function verificarBannerViaProvider(nombreEmp, sucursalId) {
  try {
    const resp = await CromaAvisosProvider.consultar({ empleado: nombreEmp, sucursalId: sucursalId });
    if (!resp.ok) return;
    const paraBanner = resp.items.filter(function (item) {
      return item.superficies.banner === true && item.estado === 'vigente' && item.leido === false;
    });
    if (!paraBanner.length) return;
    // fechaPublicacion (contrato v1.2) conserva fecha+hora real cuando la
    // fuente la tiene (igual que mostraba el Banner legacy) — fallback a
    // fechaDesde (solo fecha) para el caso null, nunca se deja sin fecha.
    mostrarBannerAnuncios(paraBanner.map(function (item) {
      return { id: item.id, titulo: item.titulo, mensaje: item.mensaje, fecha: item.fechaPublicacion || item.fechaDesde };
    }), nombreEmp);
  } catch (e) {}
}

// Adaptador compartido: item normalizado del Provider → shape legacy
// (id/titulo/mensaje/fecha/vigencia) que ya consumen renderAnunciosSeccion()
// y actualizarBadgeAnunciosEmp() sin cambios. Extraído acá para no
// duplicarlo entre Novedades (Etapa 3.2) y Campana (Etapa 3.3) — ninguna
// función legacy se toca, esto es exclusivamente código nuevo de esta
// transición.
// vigencia = item.fechaHasta directo (no se usa fechaHastaExplicita):
// tanto el POST de croma-backend como accionGuardarAviso en GAS colapsan
// "sin fecha_hasta" contra fecha_desde antes de guardar, así que
// fechaHasta SIEMPRE viene poblado salvo que el aviso no tenga ninguna
// fecha (informativo puro, sin calendario). En ese caso vigencia queda
// '' y anuncioVencido() usa su propio fallback (30 días desde creación).
// Bug real (Etapa 6/9, corte a Strategy 'avisos'): con
// fechaHastaExplicita hardcodeado en false, vigencia quedaba siempre ''
// y CUALQUIER aviso con fecha vencida seguía notificando como nuevo en
// Novedades/Campana hasta cumplir el fallback de 30 días.
function _adaptarItemsParaAnunciosLegacy(items) {
  return items.map(function (item) {
    return {
      id: item.id,
      titulo: item.titulo,
      mensaje: item.mensaje,
      fecha: item.fechaPublicacion || item.fechaDesde,
      vigencia: item.fechaHasta || '',
    };
  });
}

// ── Novedades vía Provider (Etapa 3.2, transición AVISOS) ─────────────
// Único camino que dispara Novedades — separado de verificarAnunciosEmpleado()
// de arriba (que a partir de la Etapa 3.3 ya no se invoca desde ningún
// flujo activo, ver más abajo). renderAnunciosSeccion() no se modifica:
// recibe el mismo shape de siempre, armado por el adaptador compartido.
// Sin fallback a get_anuncios si el Provider falla — Novedades simplemente
// no se actualiza, sin romper el resto del Portal.
async function verificarNovedadesViaProvider(nombreEmp, sucursalId) {
  try {
    const resp = await CromaAvisosProvider.consultar({ empleado: nombreEmp, sucursalId: sucursalId });
    if (!resp.ok) return;
    const paraNovedades = resp.items.filter(function (item) {
      return item.superficies.banner === true;
    });
    renderAnunciosSeccion(_adaptarItemsParaAnunciosLegacy(paraNovedades), nombreEmp);
  } catch (e) {}
}

// ── Campana vía Provider (Etapa 3.3, transición AVISOS) ────────────────
// Único camino que alimenta el badge de anuncios en #bellBadgeEmp — último
// consumidor directo del fetch legacy de ANUNCIOS. Con esto,
// verificarAnunciosEmpleado() queda sin ningún caller activo (no se borra
// en esta etapa, ver inventario de código sin uso en el informe).
// actualizarBadgeAnunciosEmp() no se modifica: sigue calculando ella misma
// leído/vencido/cantidad y sumando con el badge de vacaciones ya escrito
// (incluida la condición de carrera preexistente con
// actualizarBadgeCampanaEmp, que esta etapa no corrige). Por eso acá NO se
// prefiltra por leído/vigente — solo el filtro estructural de superficie
// (igual que Novedades), dejando el cálculo de negocio donde ya vivía.
async function verificarCampanaViaProvider(nombreEmp, sucursalId) {
  try {
    const resp = await CromaAvisosProvider.consultar({ empleado: nombreEmp, sucursalId: sucursalId });
    if (!resp.ok) return;
    const paraCampana = resp.items.filter(function (item) {
      return item.superficies.banner === true;
    });
    actualizarBadgeAnunciosEmp(_adaptarItemsParaAnunciosLegacy(paraCampana));
  } catch (e) {}
}

function renderAnunciosSeccion(anuncios, nombreEmp) {
  const wrap = document.getElementById('anunciosSectionWrap');
  const list = document.getElementById('anunciosSectionList');
  const badge = document.getElementById('anunciosBadgeCount');
  if (!wrap || !list) return;

  // Un vencido de hace más de 1 día ya ni se muestra (ver
  // anuncioVencidoHaceMasDeUnDia) — el día que vence y el siguiente
  // todavía aparece (tag "Vencido"), después desaparece de la lista.
  const visibles = anuncios.filter(a => !anuncioVencidoHaceMasDeUnDia(a));

  // Bug real: acá nunca se excluía vencido del badge (a diferencia de
  // actualizarBadgeAnunciosEmp, que sí lo hacía) — un anuncio vencido
  // sin leer seguía sumando al contador de "Novedades" para siempre.
  const noLeidos = visibles.filter(a => !_anunciosLeidosEmp.has(a.id) && !anuncioVencido(a));
  if (badge) {
    badge.textContent = noLeidos.length || '';
    badge.style.display = noLeidos.length ? 'inline-flex' : 'none';
  }

  list.innerHTML = visibles.map(function(a, i) {
    const leido   = _anunciosLeidosEmp.has(a.id);
    const vencido = anuncioVencido(a);
    const claseItem = (leido || vencido) ? 'anuncio-hist-leido' : 'anuncio-hist-nuevo';
    const icono     = (leido || vencido) ? icon('fileText','icon-14') : icon('bell','icon-14');
    let badge = '';
    if (vencido)      badge = '<span class="anuncio-hist-badge" style="background:#e2e8f0;color:var(--text-muted)">Vencido</span>';
    else if (!leido)  badge = '<span class="anuncio-hist-badge">Nuevo</span>';
    const vigStr = a.vigencia ? ' · hasta ' + a.vigencia : '';
    return '<div class="anuncio-hist-item ' + claseItem + '" id="anuncioHist' + i + '">' +
      '<div class="anuncio-hist-top">' +
        '<span class="anuncio-hist-icono">' + icono + '</span>' +
        '<div class="anuncio-hist-titulo">' + esc(a.titulo) + '</div>' +
        badge +
        '<span class="anuncio-hist-fecha">' + a.fecha.substring(0, 10) + vigStr + '</span>' +
      '</div>' +
      '<div class="anuncio-hist-msg">' + esc(a.mensaje) + '</div>' +
    '</div>';
  }).join('');

  wrap.style.display = 'block';
}

function actualizarBadgeAnunciosEmp(anuncios) {
  const noLeidos = (anuncios || []).filter(a => !_anunciosLeidosEmp.has(a.id) && !anuncioVencido(a));
  const badge = document.getElementById('bellBadgeEmp');
  if (!badge) return;
  const vacBadgeCount = parseInt(badge.textContent) || 0;
  // Sumar anuncios no leídos al badge existente (vacaciones)
  const total = vacBadgeCount + noLeidos.length;
  badge.textContent = total;
  badge.style.display = total > 0 ? 'flex' : 'none';
}

function mostrarBannerAnuncios(anuncios, nombreEmp) {
  // Remover banner previo si existe
  document.getElementById('anunciosBannerWrap')?.remove();

  const wrap = document.createElement('div');
  wrap.id = 'anunciosBannerWrap';
  wrap.className = 'anuncios-banner-wrap';

  const items = anuncios.map((a, i) => `
    <div class="anuncio-banner-card" id="anuncioBanner${i}">
      <div class="anuncio-banner-top">
        <span class="anuncio-banner-icono">${icon('bell','icon-16')}</span>
        <div class="anuncio-banner-titulo">${esc(a.titulo)}</div>
        <button class="anuncio-banner-close" onclick="marcarAnuncioLeido('${a.id}',${i},'${encodeURIComponent(nombreEmp)}')">${icon('x','icon-16')}</button>
      </div>
      <div class="anuncio-banner-msg">${esc(a.mensaje)}</div>
      <div class="anuncio-banner-fecha">${a.fecha}</div>
    </div>
  `).join('');

  wrap.innerHTML = items;

  // Insertar como notificación flotante (no en el flujo del contenido)
  document.body.appendChild(wrap);

  // Sonar notificación
  sonarNotificacion();
}

// Etapa "Leídos" (transición AVISOS): la escritura directa a
// localStorage.croma_anuncios_leidos desapareció de acá — la pantalla
// delega exclusivamente al Provider, que decide (según la Strategy
// activa) dónde persistir. Con Strategy=legacy, el resultado observable
// es idéntico a antes (Provider → LegacyStrategy → mismo localStorage).
//
// Sin optimistic success: se espera la confirmación real de
// CromaAvisosProvider.marcarLeido() antes de tocar cualquier estado
// local. Si falla, la card NO se remueve y nada se marca — se registra
// el error por consola, sin alert(), el Portal sigue funcionando.
//
// _anunciosLeidosEmp SÍ se actualiza acá tras el éxito — no es
// persistencia duplicada (nunca se vuelve a llamar localStorage.setItem,
// eso ya lo hizo la Strategy dentro del Provider). Es el cache de sesión
// que renderAnunciosSeccion()/actualizarBadgeAnunciosEmp() (Novedades/
// Campana, sin modificar en esta etapa) siguen leyendo directo — sin
// este paso, esas dos pantallas protegidas no se enterarían del cambio
// hasta el próximo reload completo.
async function marcarAnuncioLeido(id, idx, empEnc) {
  const card = document.getElementById('anuncioBanner' + idx);
  if (card) {
    if (card.dataset.marcandoLeido === '1') return; // evita doble click en curso
    card.dataset.marcandoLeido = '1';
  }

  const nombreEmpBanner = decodeURIComponent(empEnc || '');
  let resultado;
  try {
    resultado = await CromaAvisosProvider.marcarLeido(nombreEmpBanner, id);
  } catch (e) {
    resultado = { ok: false, error: e && e.message };
  }

  if (!resultado || !resultado.ok) {
    console.warn('marcarAnuncioLeido: no se pudo persistir el estado de leído, se conserva el banner.', resultado && resultado.error);
    if (card) delete card.dataset.marcandoLeido;
    return;
  }

  _anunciosLeidosEmp.add(id);

  // Animar y remover el banner — solo tras éxito confirmado.
  if (card) {
    card.style.opacity = '0';
    card.style.transform = 'translateY(-8px)';
    setTimeout(function() {
      card.remove();
      const wrap = document.getElementById('anunciosBannerWrap');
      if (wrap && !wrap.querySelector('.anuncio-banner-card')) wrap.remove();
    }, 250);
  }

  // Refrescar Novedades vía Provider — mismo patrón ya establecido desde
  // la Etapa 3.2: usa el contexto ya resuelto por mostrarVistaEmpleado()
  // (_empPortalActual/_empSucIdActual), sin volver a calcular sucursal
  // acá. Si el contexto no existe o no corresponde al empleado del banner
  // que se está cerrando, no se inventa ni se hace fallback legacy — se
  // registra y no se refresca en este ciclo.
  if (_empSucIdActual && _empPortalActual && _empPortalActual === nombreEmpBanner) {
    verificarNovedadesViaProvider(_empPortalActual, _empSucIdActual);
  } else {
    console.warn('marcarAnuncioLeido: contexto de Portal no disponible o no coincide, Novedades no se refrescó', {
      empEnc: nombreEmpBanner, _empPortalActual, _empSucIdActual,
    });
  }
}

function toggleEmpFiltrosMobile(btn) {
  const panel = document.querySelector('.emp-filtros-panel');
  if (!panel) return;
  const open = panel.classList.toggle('mobile-open');
  btn.querySelector('span:last-child').textContent = open ? '▾' : '▸';
}

// Llamar al iniciar sesión de empleado (hook en mostrarVistaEmpleado)
const _origMostrarVistaEmpleado = typeof mostrarVistaEmpleado === 'function' ? mostrarVistaEmpleado : null;
// Interceptar cargarDatosEmpleado para verificar anuncios al cargar
const _origIniciarAppConSesion = window.iniciarAppConSesion;
