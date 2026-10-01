// verificarCredencialesAsync, _mostrarLoginAppLegado, togglePinVisibility
// e intentarLogin (pantalla de login propia con usuario+PIN, comparado
// client-side) se eliminaron en el Commit 4 — el login real pasa por el
// Hub (mostrarLoginApp, abajo, redirige a croma-app.com.ar), que valida
// contra croma-backend. Confirmado sin referencias antes de borrar.
// ── PANTALLA DE LOGIN ──────────────────────────────────
function mostrarLoginApp() {
  // Redirigir al login central de Croma App
  location.href = 'https://croma-app.com.ar/';
}

function cerrarSesion() {
  if (sesionActual?.empleadoNombre) {
    localStorage.removeItem(`croma_horarios_${sesionActual.empleadoNombre.replace(/\s+/g,'_')}`);
  }
  const vieneDeCromaApp = sesionActual?.fromCromaApp;
  sesionActual = null;
  _recibosPortal = null; // limpia cache del Portal — nunca sobrevive a un logout
  adminAutenticado = false;
  sessionStorage.removeItem('croma_admin_auth');
  localStorage.removeItem('croma_session');

  if (vieneDeCromaApp) {
    sessionStorage.clear();
    ['croma_auth','croma_rol','croma_suc','croma_remember'].forEach(k => localStorage.removeItem(k));
    location.href = 'https://croma-app.com.ar/?logout=1';
  } else {
    mostrarLoginApp();
  }
}

// ── INICIAR APP SEGÚN ROL ──────────────────────────────
function iniciarAppConSesion() {
  if (sesionActual.rol === 'admin' || sesionActual.rol === 'horarios') {
    adminAutenticado = true;
    sessionStorage.setItem('croma_admin_auth', '1');
    document.getElementById('navBtnAdmin').style.display       = '';
    // "Calendario" (sistema viejo, ver Etapa 6/9 avisos-provider) jubilado
    // del top bar — se deja oculto a propósito, no se restaura su display.
    document.getElementById('drawerNavAdmin').style.display    = '';
    document.getElementById('bellWrap').style.display       = 'flex';
    document.getElementById('bellWrapEmp').style.display    = 'none';
    document.querySelectorAll('.nav-btn').forEach(b => b.style.display = '');
    document.querySelectorAll('.drawer-nav-btn').forEach(b => b.style.display = '');
    // Re-ocultar "Calendario" (sistema viejo jubilado) después del forEach
    // genérico de arriba, que los vuelve a mostrar a todos por igual.
    document.getElementById('navBtnCalendario').style.display = 'none';
    document.getElementById('drawerNavCalendario').style.display = 'none';
    actualizarIndicadorSesion();
    showApp();
    const vistaGuardada = localStorage.getItem('croma_vista') || 'empleados';
    setView(vistaGuardada);
    cargarDatos({ unica: APPS_SCRIPT_URL });
    setTimeout(actualizarBadgeCampana, 1500);
  } else {
    const btnSel = document.getElementById('btnSelector');
    if (btnSel) btnSel.style.display = 'none';
    document.getElementById('btnRefresh')?.style && (document.getElementById('btnRefresh').style.display = 'none');
    document.getElementById('btnPrint')?.style && (document.getElementById('btnPrint').style.display = 'none');
    document.querySelector('.top-nav') && (document.querySelector('.top-nav').style.display = 'none');
    document.querySelector('.top-search') && (document.querySelector('.top-search').style.display = 'none');
    document.querySelector('.controls-bar') && (document.querySelector('.controls-bar').style.display = 'none');
    document.querySelector('.hamburger-btn') && (document.querySelector('.hamburger-btn').style.display = 'none');
    document.getElementById('bellWrap') && (document.getElementById('bellWrap').style.display = 'none');
    document.getElementById('bellWrapEmp') && (document.getElementById('bellWrapEmp').style.display = 'flex');
    document.getElementById('mainApp').innerHTML = '<div id="vistaEmpleadoContainer" style="padding:1rem"></div>';
    actualizarIndicadorSesion();
    showApp();
    cargarDatosEmpleado();
  }
}

function actualizarIndicadorSesion() {
  // Agregar/actualizar chip de sesión en la topbar
  let chip = document.getElementById('sesionChip');
  if (!chip) {
    chip = document.createElement('div');
    chip.id = 'sesionChip';
    chip.className = 'sesion-chip';
    // Insertar antes de top-actions
    const topActions = document.querySelector('.top-actions');
    topActions.parentNode.insertBefore(chip, topActions);
  }
  const esAdmin = sesionActual.rol === 'admin' || sesionActual.rol === 'horarios';
  const esEmpleado = sesionActual.rol === 'empleado';
  // Portal Empleado: "Mi perfil" y el nombre se sacaron de la topbar y
  // viven en "Más" (ver masListado en renderVistaEmpleado) — acá queda
  // solo el botón de salir, como en el resto de la app.
  chip.innerHTML = `
    ${esAdmin ? `<span class="sesion-nombre">${icon('user','icon-14')} Admin</span>` : ''}
    ${!esAdmin && !esEmpleado ? `<span class="sesion-nombre">${sesionActual.nombre}</span>` : ''}
    <button class="sesion-logout" onclick="cerrarSesion()" title="Cerrar sesión" aria-label="Cerrar sesión">
      ${icon('logOut','icon-13')}
    </button>
  `;
}

// ── VISTA EMPLEADO LOGUEADO ────────────────────────────
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 horas — cache válido aunque cierren el navegador

async function cargarDatosEmpleado() {
  const nombreEmp = sesionActual?.empleadoNombre || sesionActual?.nombre || '';
  const cacheKey  = `croma_horarios_${nombreEmp.replace(/\s+/g,'_')}`;

  // ── Leer cache, pero solo si tiene menos de 4 horas ──
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      const { datos, perfiles, categorias, ts } = JSON.parse(cached);
      const edad = Date.now() - (ts || 0);
      if (datos?.length && edad < CACHE_TTL_MS) {
        // Cache fresco → mostrar al instante
        state.datos = datos;
        if (perfiles) Object.assign(EMPLEADOS_PERFILES, perfiles);
        if (categorias?.length) CATEGORIAS_CONFIG = categorias;
        setConnected(true);
        mostrarVistaEmpleado();
        // Refrescar silenciosamente en background
        _refrescarDatosEmpleadoBg(cacheKey);
        return;
      } else {
        // Cache vencido → borrarlo y cargar normal
        localStorage.removeItem(cacheKey);
      }
    } catch(e) { localStorage.removeItem(cacheKey); }
  }

  // ── Sin cache válido: carga bloqueante ──
  showToast('Cargando tu jornada...');
  await _refrescarDatosEmpleadoBg(cacheKey, true);
}

async function _refrescarDatosEmpleadoBg(cacheKey, bloqueante = false) {
  try {
    // Filtrar por empleado del lado del servidor: baja el payload de "toda
    // la hoja" a solo las filas de este empleado (mucho más rápido).
    // Fase 1B: antes pegaba a accion=datos_portal_empleado (GAS, 4
    // ejecuciones internas). Ahora pasa por croma-backend, que arma el
    // mismo contrato combinando GAS (sin horarios) + Sheets API en
    // paralelo — mismo formato de respuesta, paridad validada campo a
    // campo (ver docs/PLAN-SHEETS-API-DIRECTA.md).
    const nombreEmp = sesionActual?.empleadoNombre || sesionActual?.nombre || '';

    const [horariosResp] = await Promise.allSettled([
      apiDatosPortalEmpleado(nombreEmp ? '?empleado=' + encodeURIComponent(nombreEmp) : '', { method: 'GET' }).then(async consolidado => {
        if (consolidado.ok === false) throw new Error(consolidado.error || 'Error');
        await Promise.allSettled([
          cargarPerfiles(consolidado.perfiles),
          cargarCertificados(consolidado.certificados),
          cargarVacacionesAprobadas(consolidado.vacacionesAprobadas),
        ]);
        return consolidado.horarios;
      }),
    ]);

    if (horariosResp.status === 'rejected') {
      if (bloqueante) {
        setConnected(false);
        showToast('Error al cargar: ' + horariosResp.reason?.message);
        mostrarVistaEmpleadoError();
      } else {
        showToast('Sin conexión — mostrando datos guardados');
      }
      return;
    }

    const json = horariosResp.value;
    if (json.ok === false) throw new Error(json.error || 'Error');

    const NOMBRE_A_ID = {
      'PASEO': '01', 'WAVE': '05', 'CIPO': '09', 'CIPO SAN MARTIN': '09',
      'PERITO': '10', 'PERITO MORENO': '10', 'CENTE': '12', 'CENTENARIO': '12',
      'ROCA180': '14', 'ROCA': '14', 'DEPO': 'DEPO', 'OFICINA': 'OFICINA',
    };
    state.datos = (json.data || []).map(r => {
      const localRaw = String(r.LOCAL || r.local || r.HOJA || '').trim().toUpperCase();
      return {
        LOCAL:    NOMBRE_A_ID[localRaw] || localRaw,
        AÑO:      String(r.AÑO     || r.anio     || ''),
        MES:      String(r.MES     || r.mes       || '').trim().toUpperCase(),
        DIA:      String(r.DIA     || r.dia       || '0'),
        EMPLEADO: String(r.EMPLEADO|| r.empleado  || '').trim(),
        H_ENTRADA:String(r.H_ENTRADA|| r.entrada  || ''),
        H_SALIDA: String(r.H_SALIDA || r.salida   || ''),
        NOTA:     String(r.NOTA    || r.nota      || '').trim(),
        TOTAL_HS: parseFloat(r.TOTAL_HS || r.total) || 0,
        MARCA_TEMPORAL: r.MARCA_TEMPORAL || r.marca || '',
      };
    });

    // Guardar con timestamp para TTL
    try {
      localStorage.setItem(cacheKey, JSON.stringify({
        datos: state.datos,
        perfiles: EMPLEADOS_PERFILES,
        categorias: CATEGORIAS_CONFIG,
        ts: Date.now(),
      }));
    } catch(e) {}

    setConnected(true);
    mostrarVistaEmpleado();
    if (!bloqueante) showToast('✓ Datos actualizados');

  } catch(err) {
    if (bloqueante) {
      setConnected(false);
      showToast('Error al cargar: ' + err.message);
      mostrarVistaEmpleadoError();
    } else {
      showToast('Sin conexión — mostrando datos guardados');
    }
  }
}

// Lleva al empleado logueado a fichar.html (check-in con GPS) sin re-loguear:
// escribe la sesión en el formato que espera fichar.html y navega.
//
// Fase 7C (2026-08-15) — bug encontrado en QA real: fichar.html ahora
// exige un JWT real (POST /api/fichadas), pero este puente nunca lo
// incluía — el flujo legado hablaba directo con GAS, que no lo pedía. El
// JWT SÍ existe acá (croma_token, el mismo que usa _getJwtUser() más
// abajo para leer usuario/rol) — solo faltaba pasarlo. También se movió
// el destino de localStorage a sessionStorage, para que coincida con
// dónde fichar.html lee la sesión desde 7C (ver fichar.html, leerSesion()).
function irAFicharEmpleado() {
  try {
    const token = sessionStorage.getItem('croma_token') || localStorage.getItem('croma_token');
    const ses = {
      nombre:         sesionActual.nombre,
      rol:            sesionActual.rol || 'empleado',
      empleadoNombre: sesionActual.empleadoNombre || sesionActual.nombre,
      token:          token || null,
    };
    sessionStorage.setItem('croma_session', JSON.stringify(ses));
  } catch(e) {}
  window.location.href = 'fichar.html';
}

function mostrarVistaEmpleado() {
  const nombreEmp = sesionActual.empleadoNombre;
  if (!nombreEmp) {
    showToast('Error: usuario sin empleado vinculado');
    return;
  }

  const misRegistros = state.datos.filter(r =>
    r.EMPLEADO.trim().toLowerCase() === nombreEmp.trim().toLowerCase()
  );

  if (!misRegistros.length) {
    mostrarVistaEmpleadoSinDatos(nombreEmp);
    return;
  }

  const sucConteo = {};
  misRegistros.forEach(r => { sucConteo[r.LOCAL] = (sucConteo[r.LOCAL]||0) + 1; });
  const sucId = Object.entries(sucConteo).sort((a,b)=>b[1]-a[1])[0][0];

  // El contenedor ya fue creado en iniciarAppConSesion
  const container = document.getElementById('vistaEmpleadoContainer');
  if (container) container.innerHTML = '';
  else {
    document.getElementById('mainApp').innerHTML = '<div id="vistaEmpleadoContainer" style="padding:1rem"></div>';
  }
  _empSemanaOffset  = 0;
  _empPortalActual  = nombreEmp;
  _empSucIdActual   = sucId;
  _empMisRegistros  = misRegistros;
  renderVistaEmpleado(nombreEmp, sucId, misRegistros);
  // Verificar anuncios y eventos nuevos (sin bloquear)
  // Etapa 3.3 (transición AVISOS): verificarAnunciosEmpleado() (fetch
  // legacy de ANUNCIOS) deja de invocarse acá — Banner (3.1), Novedades
  // (3.2) y Campana (3.3, línea de abajo) ya cubren sus tres consumidores
  // reales vía Provider. La función NO se borra en esta etapa (queda como
  // código sin caller, ver inventario de la Etapa 3.3) — solo se retira
  // esta invocación.
  // Etapa 3.1 (transición AVISOS): Banner migrado al Provider. sucId ya
  // está resuelto acá mismo (línea de arriba) — se pasa explícito, sin
  // volver a descubrirlo dentro de la función nueva.
  setTimeout(() => verificarBannerViaProvider(nombreEmp, sucId), 1200);
  // Etapa 3.2: mismo patrón para Novedades.
  setTimeout(() => verificarNovedadesViaProvider(nombreEmp, sucId), 1200);
  // Etapa 3.3: mismo patrón para Campana (último consumidor directo).
  setTimeout(() => verificarCampanaViaProvider(nombreEmp, sucId), 1200);
  // Etapa 3.4: Mi Semana + Local Cerrado vía Provider. cargarEventosEmpleado()
  // deja de invocarse acá (queda como código sin caller, no se borra). Sin
  // rango: una sola consulta, igual patrón de tráfico que antes — la
  // navegación de semanas sigue sin generar fetches nuevos.
  setTimeout(() => cargarEventosViaProvider(nombreEmp, sucId), 1400);
  // Turno planificado (Horario semanal) para "Mi semana" — ver
  // cargarPlanHorarioEmpleado(). _empSemanaOffset ya quedó en 0 arriba.
  // El grid ya se renderizó una vez con lo que había en caché (o "Libre"
  // si no había nada todavía); esto lo actualiza cuando llega la respuesta.
  cargarPlanHorarioEmpleado(0);
}

function mostrarVistaEmpleadoSinDatos(nombreEmp) {
  const mainApp = document.getElementById('mainApp');
  mainApp.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:1rem">
      <div>${icon('fileText','icon-48')}</div>
      <h2 style="font-family:'Bebas Neue';font-size:24px;letter-spacing:2px">Sin registros</h2>
      <p style="color:var(--text-secondary);font-size:14px">No se encontraron registros para <strong>${nombreEmp}</strong>.</p>
      <p style="color:var(--text-muted);font-size:12px">Verificá que el nombre de usuario coincida exactamente con el registro en el sistema.</p>
    </div>
  `;
}

function mostrarVistaEmpleadoError() {
  const mainApp = document.getElementById('mainApp');
  mainApp.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:1rem">
      <div>${icon('alertTriangle','icon-48')}</div>
      <h2 style="font-family:'Bebas Neue';font-size:24px;letter-spacing:2px">Error de conexión</h2>
      <p style="color:var(--text-secondary);font-size:14px">No se pudo conectar con el servidor.</p>
      <button class="btn-connect" style="width:auto;padding:10px 24px" onclick="cargarDatosEmpleado()">Reintentar</button>
    </div>
  `;
}

function renderVistaEmpleado(nombreEmp, sucId, misRegistros) {
  // Estado de la pestaña Recibos del Portal — se reinicia en cada render
  // del Portal (login, refresh manual), nunca reutiliza datos de una
  // sesión/empleado anterior. Independiente de _recibosFicha (admin).
  _recibosPortal = { cargado: false, lista: [] };

  const suc = SUCURSALES_TODAS.find(s => s.id === sucId) || { color: '#888', colorLight: '#eee', nombre: sucId };
  const perfil = EMPLEADOS_PERFILES[nombreEmp] || {};
  const cat = CATEGORIAS_CONFIG.find(c => c.id === perfil.categoria_id);

  const numMatch   = nombreEmp.match(/^(\d+)\s+(.+)$/);
  const numVend    = numMatch ? numMatch[1] : '';
  const nomMostrar = numMatch ? numMatch[2] : nombreEmp;
  const iniciales  = nomMostrar.split(' ').slice(0,2).map(p=>p[0]?.toUpperCase()).join('');

  // Períodos disponibles
  const ORDEN_MESES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
                       'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
  const periodosSet = new Set();
  misRegistros.forEach(r => periodosSet.add(r.MES + ' ' + r.AÑO));
  const periodos = Array.from(periodosSet).sort((a, b) => {
    const [mA, aA] = a.split(' '), [mB, aB] = b.split(' ');
    if (aA !== aB) return parseInt(aA) - parseInt(aB);
    return ORDEN_MESES.indexOf(mA) - ORDEN_MESES.indexOf(mB);
  });

  const periodoActual = periodos[periodos.length - 1] || 'TODOS';

  // Calcular totales para el período seleccionado
  function calcTotales(periodo) {
    const regs = periodo === 'TODOS'
      ? misRegistros
      : misRegistros.filter(r => r.MES + ' ' + r.AÑO === periodo);

    const porFecha = {};
    regs.forEach(r => {
      const key = `${r.AÑO}-${r.MES}-${r.DIA}`;
      if (!porFecha[key]) porFecha[key] = [];
      porFecha[key].push(r);
    });

    const DIAS_SEMANA = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
    const filas = Object.entries(porFecha).map(([key, rrs]) => {
      rrs.sort((a,b) => (a.H_ENTRADA||'').localeCompare(b.H_ENTRADA||''));
      const r0 = rrs[0];
      const fecha = new Date(r0.AÑO, MESES_ES.indexOf(r0.MES), parseInt(r0.DIA));
      const fechaStr = fecha.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'});
      const diaSem = DIAS_SEMANA[fecha.getDay()];
      const esSab  = fecha.getDay() === 6;
      const esDom  = fecha.getDay() === 0;
      const esFer  = esFeriado(fecha);
      const turno1 = r0.H_ENTRADA && r0.H_SALIDA ? `${normalizarLibreTxt(r0.H_ENTRADA)} – ${normalizarLibreTxt(r0.H_SALIDA)}` : '—';
      const turno2 = rrs[1]?.H_ENTRADA ? `${normalizarLibreTxt(rrs[1].H_ENTRADA)} – ${normalizarLibreTxt(rrs[1].H_SALIDA)}` : '';
      const hsTotal = rrs.reduce((a,r)=>a+(parseFloat(r.TOTAL_HS)||0),0);
      const hsExtra = calcularHsExtra(nombreEmp, hsTotal, fecha);
      const hsFeriado = calcularHsFeriado(hsTotal, fecha);
      const nota    = rrs.map(r=>r.NOTA).filter(Boolean).join(' / ');
      let horaReg = '', horaReg2 = '';
      try { if (r0.MARCA_TEMPORAL) horaReg = new Date(r0.MARCA_TEMPORAL).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}); } catch(e){}
      try { if (rrs[1]?.MARCA_TEMPORAL) horaReg2 = new Date(rrs[1].MARCA_TEMPORAL).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}); } catch(e){}
      return { fechaStr, diaSem, turno1, turno2, hsTotal, hsExtra, hsFeriado, esSab, esDom, esFer, nota, horaReg, horaReg2 };
    }).sort((a,b) => {
      // ordenar más viejo primero
      const da = a.fechaStr.split('/').reverse().join('-');
      const db = b.fechaStr.split('/').reverse().join('-');
      return da.localeCompare(db);
    });

    // Vista empleado: no se muestran certificados en este portal.
    const totalHoras     = filas.reduce((a,f)=>a+f.hsTotal,0);
    const totalHsExtra   = filas.reduce((a,f)=>a+f.hsExtra,0);
    const totalHsFeriado = filas.reduce((a,f)=>a+(f.hsFeriado||0),0);
    const totalSabs      = filas.filter(f=>f.esSab).length;
    return { filas, totalHoras, totalHsExtra, totalHsFeriado, totalSabs, diasUnicos: filas.length };
  }

  let { filas, totalHoras, totalHsExtra, totalHsFeriado, totalSabs, diasUnicos } = calcTotales(periodoActual);

  const opcionesMes = ['<option value="TODOS">Todos los registros</option>']
    .concat(periodos.map(p => `<option value="${p}" ${p===periodoActual?'selected':''}>${p}</option>`))
    .join('');

  const avatarInner = perfil.foto_url
    ? `<img src="${perfil.foto_url}" alt="${nomMostrar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentElement.innerHTML='${iniciales}'">`
    : (numVend ? `<span style="font-size:18px;font-weight:700;color:${suc.color}">#${numVend}</span>` : `<span style="font-size:18px;font-weight:700;color:${suc.color}">${iniciales}</span>`);

  const primerNombre = (nomMostrar || '').split(' ')[0] || nomMostrar;
  const nombreLegalPortal = getNombresLegales()[_normalizarNombreEmpleadoJS(nombreEmp)] || '';

  function normalizarLibreTxt(txt) {
    const v = String(txt || '').trim();
    return v.toUpperCase() === 'FRANCO' ? 'Libre' : v;
  }

  function fechaKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }

  function getEmpSemanaLabel(offset) {
    const lunes = getLunes(offset);
    const dom   = new Date(lunes); dom.setDate(lunes.getDate() + 6);
    const fmtOpts = { day: '2-digit', month: 'short' };
    const desde = lunes.toLocaleDateString('es-AR', fmtOpts);
    const hasta = dom.toLocaleDateString('es-AR', fmtOpts);
    if (offset === 0) return 'Esta semana · ' + desde + ' – ' + hasta;
    if (offset === 1) return 'Próxima semana · ' + desde + ' – ' + hasta;
    if (offset === -1) return 'Semana pasada · ' + desde + ' – ' + hasta;
    return (offset > 0 ? '+' : '') + offset + ' semanas · ' + desde + ' – ' + hasta;
  }

  // Delegado a _buildSemanaEmpleadoCards() (fuera de este closure, también
  // usado por empNavSemana() — antes eran dos copias separadas de la misma
  // lógica). misRegistros de este closure ya está asignado a _empMisRegistros
  // en mostrarVistaEmpleado() antes de llamar acá, así que la versión global
  // ve exactamente los mismos datos.
  function buildSemanaEmpleado() {
    return _buildSemanaEmpleadoCards();
  }

  function getProximoTurno() {
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    // Agrupar registros por día
    const porDia = {};
    misRegistros.forEach(r => {
      const f = new Date(r.AÑO, MESES_ES.indexOf(r.MES), parseInt(r.DIA));
      f.setHours(0,0,0,0);
      if (f < hoy) return;
      const key = f.getTime();
      if (!porDia[key]) porDia[key] = { f, regs: [] };
      porDia[key].regs.push(r);
    });
    const dias = Object.values(porDia)
      .filter(d => d.regs.some(r => r.H_ENTRADA && r.H_SALIDA))
      .sort((a,b) => a.f - b.f);
    if (!dias.length) return '<span class="portal-next-empty">Sin próximos turnos cargados</span>';
    const { f, regs } = dias[0];
    regs.sort((a,b) => (a.H_ENTRADA||'').localeCompare(b.H_ENTRADA||''));
    const fecha = f.toLocaleDateString('es-AR', { weekday:'long', day:'2-digit', month:'2-digit' });
    const hsTotal = regs.reduce((a,r) => a + (parseFloat(r.TOTAL_HS)||0), 0);
    const turnosHtml = regs.filter(r => r.H_ENTRADA && r.H_SALIDA).map(r =>
      `<strong>${normalizarLibreTxt(r.H_ENTRADA)} → ${normalizarLibreTxt(r.H_SALIDA)}</strong>`
    ).join('<span style="color:var(--text-muted);margin:0 4px">·</span>');
    return `<span class="portal-next-date">${fecha}</span>${turnosHtml}<small>${hsTotal.toFixed(1)} hs</small>`;
  }

  function buildFilas(fs) {
    return fs.map(f => {
      if (f.esCert) return `
      <tr class="fila-certificado">
        <td>${f.fechaStr}</td>
        <td>${f.diaSem}</td>
        <td class="hora-reg">—</td>
        <td colspan="2"><span class="tag-cert">CERT</span> ${esc(f.nota)}</td>
        <td></td>
        <td>—</td>
        <td>—</td>
        <td></td>
        <td></td>
      </tr>`;
      return `
      <tr class="${f.esSab?'fila-sabado':''} ${f.esDom?'fila-domingo':''} ${f.esFer?'fila-feriado':''}">
        <td>${f.fechaStr}${f.esFer?' <span class="tag-feriado">F</span>':''}</td>
        <td>${f.diaSem}</td>
        <td class="hora-reg">${f.horaReg||'—'}${f.horaReg2 ? `<br><span class="hora-reg-2">${f.horaReg2}</span>` : ''}</td>
        <td class="turno-cell">${f.turno1}</td>
        <td class="turno-cell">${f.turno2||'—'}</td>
        <td><strong>${f.hsTotal.toFixed(1)}</strong></td>
        <td>${f.hsExtra>0?`<span class="hs-extra">${f.hsExtra.toFixed(1)}</span>`:'—'}</td>
        <td>${f.hsFeriado>0?`<span class="hs-feriado">${f.hsFeriado.toFixed(1)}</span>`:'—'}</td>
        <td>${f.esSab?'<span class="check-sab">✓</span>':''}</td>
        <td class="nota-cell">${esc(f.nota)}</td>
      </tr>`;
    }).join('');
  }

  function buildCards(fs) {
    return fs.map(f => {
      if (f.esCert) return `
        <div class="ev-card" style="border-left:3px solid #2563eb;background:#eff6ff">
          <div class="ev-card-top">
            <div class="ev-card-fecha">
              <span class="ev-card-dia-sem">${f.diaSem}</span>
              <span class="ev-card-fecha-str">${f.fechaStr}</span>
            </div>
            <div class="ev-card-hs">
            </div>
          </div>
          <div class="ev-card-turnos">
            <span class="tag-cert">CERT</span>
            <span class="ev-card-turno">${esc(f.nota)}</span>
          </div>
        </div>`;
      const clases = [f.esSab?'ev-card-sabado':'', f.esDom?'ev-card-domingo':'', f.esFer?'ev-card-feriado':''].filter(Boolean).join(' ');
      const turno2html = f.turno2 && f.turno2 !== '—' ? `<span class="ev-card-turno">${f.turno2}</span>` : '';
      const extraHtml  = f.hsExtra > 0 ? `<span class="ev-card-extra">+${f.hsExtra.toFixed(1)} extra</span>` : '';
      const feriadoHtml = f.hsFeriado > 0 ? `<span class="ev-card-feriado-hs">+${f.hsFeriado.toFixed(1)} feriado</span>` : '';
      const sabHtml    = f.esSab ? `<span class="ev-card-sab">Sáb ✓</span>` : '';
      const notaHtml   = f.nota  ? `<div class="ev-card-nota">${esc(f.nota)}</div>` : '';
      return `
        <div class="ev-card ${clases}">
          <div class="ev-card-top">
            <div class="ev-card-fecha">
              <span class="ev-card-dia-sem">${f.diaSem}</span>
              <span class="ev-card-fecha-str">${f.fechaStr}${f.esFer?' <span class="tag-feriado">F</span>':''}</span>
            </div>
            <div class="ev-card-hs">
              <span class="ev-card-hs-val">${f.hsTotal.toFixed(1)}<small>hs</small></span>
              ${extraHtml}${feriadoHtml}${sabHtml}
            </div>
          </div>
          <div class="ev-card-turnos">
            <span class="ev-card-turno">${f.turno1}</span>
            ${turno2html}
            ${f.horaReg ? `<span class="ev-card-hora-reg">Reg. ${f.horaReg}${f.horaReg2 ? ` / ${f.horaReg2}` : ''}</span>` : ''}
          </div>
          ${notaHtml}
        </div>`;
    }).join('');
  }

  const empresaBadge = perfil.empresa
    ? `<span class="emp-empresa-badge ${perfil.empresa==='MOSHE SRL'?'badge-moshe':'badge-cromawave'}">${perfil.empresa}</span>`
    : '';
  const catBadge = cat
    ? `<span class="emp-cat-badge">${cat.nombre}</span>`
    : '';

  const _vc = document.getElementById('vistaEmpleadoContainer');
  _vc.innerHTML = `
    <div class="emp-vista-personal emp-portal-mobilefirst emp-portal-bottomnav-pad">

    <div id="portalVistaInicio">
      <!-- PORTAL EMPLEADO -->
      <section class="portal-hero" style="--portal-color:${suc.color};--portal-soft:${suc.colorLight}">
        <div class="portal-profile-card">
          <div class="emp-vista-avatar-wrap">
            <div class="emp-vista-avatar ${perfil.foto_url?'emp-avatar-foto':''}"
                 id="empVistaAvatarDiv"
                 style="${perfil.foto_url?'':'background:'+suc.colorLight}">
              ${avatarInner}
            </div>
            <button class="btn-cambiar-foto" onclick="triggerCambiarFoto('${nombreEmp.replace(/'/g,"\\'")}')" title="Cambiar foto" aria-label="Cambiar foto">${icon('camera','icon-16')}</button>
            <input type="file" id="inputFotoEmpleado" aria-label="Cambiar foto" accept="image/*" style="display:none"
                   onchange="subirFotoEmpleado(this, '${nombreEmp.replace(/'/g,"\\'")}')">
          </div>
          <div class="portal-profile-info">
            <span class="portal-kicker">Portal empleado</span>
            <h1 class="portal-greeting">Hola ${primerNombre}</h1>
            ${nombreLegalPortal ? `<p style="font-size:12px;color:var(--text-muted);margin-top:-4px">${nombreLegalPortal}</p>` : ''}
            <p>${suc.nombre}</p>
            <div class="emp-badges-row">${empresaBadge}${catBadge}</div>
          </div>
        </div>

        <div class="portal-next-card">
          <span class="portal-kicker">Turno de hoy</span>
          ${getProximoTurno()}
          <button class="btn-fichar-cta" style="margin:6px 0 0" onclick="irAFicharEmpleado()">
            ${icon('clock','icon-18')}
            Registrar mi jornada
          </button>
        </div>
      </section>

      <!-- SECCIÓN ANUNCIOS (historial) -->
      <div id="anunciosSectionWrap" style="display:none">
        <section class="portal-section portal-anuncios-section">
          <div class="portal-section-head">
            <div>
              <span class="portal-kicker">Novedades <span class="anuncio-seccion-badge" id="anunciosBadgeCount" style="display:none"></span></span>
              <h2>Anuncios</h2>
            </div>
          </div>
          <div id="anunciosSectionList"></div>
        </section>
      </div>
    </div><!-- fin portalVistaInicio -->

    <div id="portalVistaSemana" style="display:none">
      <section class="portal-section portal-week-section">
        <div class="portal-section-head">
          <div>
            <span class="portal-kicker" id="empSemanaLabel">${getEmpSemanaLabel(_empSemanaOffset)}</span>
            <h2>Mi semana</h2>
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            <button class="emp-semana-nav-btn" onclick="empNavSemana(-1)" title="Semana anterior" aria-label="Semana anterior">&#8592;</button>
            <button class="emp-semana-nav-btn emp-semana-nav-hoy" onclick="empNavSemana(0,'reset')" title="Ir a esta semana">Hoy</button>
            <button class="emp-semana-nav-btn" onclick="empNavSemana(1)" title="Semana siguiente" aria-label="Semana siguiente">&#8594;</button>
          </div>
        </div>
        <div class="portal-week-grid" id="empSemanaGrid">
          ${buildSemanaEmpleado()}
        </div>
      </section>
    </div><!-- fin portalVistaSemana -->

    <div id="portalVistaHistorial" style="display:none">
      <section class="portal-summary-grid" style="margin-bottom:1rem">
        <div class="portal-summary-card">
          <span>Días</span>
          <strong id="evDias">${diasUnicos}</strong>
        </div>
        <div class="portal-summary-card">
          <span>Hs totales</span>
          <strong id="evHoras">${totalHoras.toFixed(1)}</strong>
        </div>
        <div class="portal-summary-card">
          <span>Hs extra</span>
          <strong id="evExtra">${totalHsExtra.toFixed(1)}</strong>
        </div>
        <div class="portal-summary-card">
          <span>Hs feriado</span>
          <strong id="evFeriado">${totalHsFeriado.toFixed(1)}</strong>
        </div>
        <div class="portal-summary-card">
          <span>Sábados</span>
          <strong id="evSabs">${totalSabs}</strong>
        </div>
      </section>

      <!-- SELECTOR DE PERÍODO -->
      <div class="emp-vista-toolbar">
        <div style="display:flex;align-items:center;gap:8px">
          <label style="font-size:13px;color:var(--text-secondary);font-weight:500" for="evSelectMes">Período:</label>
          <select id="evSelectMes" class="filter-select" style="font-size:13px">
            ${opcionesMes}
          </select>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn-detalle-accion" onclick="imprimirVistaEmpleado()" title="Imprimir">
            ${icon('printer','icon-14')}
            Imprimir
          </button>
        </div>
      </div>

      <!-- TABLA (desktop) / CARDS (mobile) -->
      <div class="detalle-tabla-wrap ev-tabla-desktop" id="evTablaWrap">
        <table class="detalle-tabla">
          <thead>
            <tr>
              <th>Fecha</th><th>Día</th><th>Hora reg.</th>
              <th>Turno 1</th><th>Turno 2</th>
              <th>Hs total</th><th>Hs extra</th><th>Hs feriado</th><th>Sáb.</th><th>Nota</th>
            </tr>
          </thead>
          <tbody id="evTbody">${buildFilas(filas)}</tbody>
          <tfoot id="evTfoot">
            <tr>
              <td colspan="2"><strong>TOTALES</strong></td>
              <td><strong>${diasUnicos}</strong></td>
              <td colspan="2"></td>
              <td><strong>${totalHoras.toFixed(1)}</strong></td>
              <td>${totalHsExtra>0?`<span class="hs-extra">${totalHsExtra.toFixed(1)}</span>`:'—'}</td>
              <td>${totalHsFeriado>0?`<span class="hs-feriado">${totalHsFeriado.toFixed(1)}</span>`:'—'}</td>
              <td><strong>${totalSabs}</strong></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div class="ev-cards-mobile" id="evCardsWrap">
        ${buildCards(filas)}
        <div class="ev-card-totales">
          <span>${diasUnicos} días</span>
          <span>${totalHoras.toFixed(1)} hs totales</span>
          ${totalHsExtra>0?`<span class="ev-card-extra">+${totalHsExtra.toFixed(1)} extra</span>`:''}
          ${totalHsFeriado>0?`<span class="ev-card-feriado-hs">+${totalHsFeriado.toFixed(1)} feriado</span>`:''}
          <span>${totalSabs} sábados</span>
        </div>
      </div>
    </div><!-- fin portalVistaHistorial -->

    <div id="portalVistaMas" style="display:none">
      <div id="masListado">
        <button type="button" class="portal-mas-item" onclick="switchMasSeccion('vacaciones')">${icon('palmtree','icon-18')}<span>Vacaciones</span>${icon('chevronRight','icon-16 chevron-mas')}</button>
        <button type="button" class="portal-mas-item" onclick="switchMasSeccion('bancoHoras')">${icon('timer','icon-18')}<span>Banco de horas</span>${icon('chevronRight','icon-16 chevron-mas')}</button>
        <button type="button" class="portal-mas-item" onclick="switchMasSeccion('recibos')">${icon('fileText','icon-18')}<span>Recibos</span>${icon('chevronRight','icon-16 chevron-mas')}</button>
        <button type="button" class="portal-mas-item" onclick="abrirMiPerfil()">${icon('user','icon-18')}<span>Mi perfil</span>${icon('chevronRight','icon-16 chevron-mas')}</button>
      </div>

      <div id="masSeccionVacaciones" class="portal-mas-seccion" style="display:none">
        <button type="button" class="portal-mas-volver" onclick="switchMasSeccion('lista')">${icon('arrowLeft','icon-14')} Más</button>
        <div class="portal-mas-card">
          <div id="evTabVacaciones">
            <p style="color:var(--text-muted);font-size:13px">Cargando vacaciones...</p>
          </div>
        </div>
      </div>

      <div id="masSeccionBancoHoras" class="portal-mas-seccion" style="display:none">
        <button type="button" class="portal-mas-volver" onclick="switchMasSeccion('lista')">${icon('arrowLeft','icon-14')} Más</button>
        <div class="portal-mas-card">
          <div id="evTabBancoHoras">
            <p style="color:var(--text-muted);font-size:13px">Cargando banco de horas...</p>
          </div>
        </div>
      </div>

      <div id="masSeccionRecibos" class="portal-mas-seccion" style="display:none">
        <button type="button" class="portal-mas-volver" onclick="switchMasSeccion('lista')">${icon('arrowLeft','icon-14')} Más</button>
        <div class="portal-mas-card">
          <div class="emp-vista-toolbar">
            <div>
              <h2 style="font-family:var(--font-display);font-size:18px;letter-spacing:.5px;color:#0d0d0d;margin:0">Mis recibos</h2>
              <p style="font-size:12px;color:var(--text-muted);margin:2px 0 0">Tus recibos de sueldo publicados van a aparecer acá.</p>
            </div>
            <button class="detalle-footer-refresh" onclick="_recargarRecibosPortal()" title="Actualizar" aria-label="Actualizar">${icon('refresh','icon-14')}</button>
          </div>
          <div id="portalRecibosContenido">
            <div class="ajuste-empty-state"><div class="spinner" role="status" aria-label="Cargando"></div><p class="text-secondary">Cargando tus recibos…</p></div>
          </div>
        </div>
      </div>
    </div><!-- fin portalVistaMas -->

    <nav class="portal-bottomnav">
      <button type="button" class="portal-bottomnav-item active" onclick="switchPortalVista('inicio',this)">${icon('building','icon-20')}<span>Inicio</span></button>
      <button type="button" class="portal-bottomnav-item" onclick="switchPortalVista('semana',this)">${icon('calendar','icon-20')}<span>Mi semana</span></button>
      <button type="button" class="portal-bottomnav-item" onclick="switchPortalVista('historial',this)">${icon('clock','icon-20')}<span>Historial</span></button>
      <button type="button" class="portal-bottomnav-item" onclick="switchPortalVista('mas',this)">${icon('moreVertical','icon-20')}<span>Más</span></button>
    </nav>

    </div>
  `;

  // Evento cambio de período
  document.getElementById('evSelectMes').addEventListener('change', function() {
    const p = this.value;
    const t = calcTotales(p);
    document.getElementById('evDias').textContent  = t.diasUnicos;
    document.getElementById('evHoras').textContent = t.totalHoras.toFixed(1);
    document.getElementById('evExtra').textContent = t.totalHsExtra.toFixed(1);
    const evFerEl = document.getElementById('evFeriado');
    if (evFerEl) evFerEl.textContent = t.totalHsFeriado.toFixed(1);
    document.getElementById('evSabs').textContent  = t.totalSabs;
    document.getElementById('evTbody').innerHTML   = buildFilas(t.filas);
    // Actualizar cards mobile
    const cardsWrap = document.getElementById('evCardsWrap');
    if (cardsWrap) cardsWrap.innerHTML = buildCards(t.filas) + `
      <div class="ev-card-totales">
        <span>${t.diasUnicos} días</span>
        <span>${t.totalHoras.toFixed(1)} hs totales</span>
        ${t.totalHsExtra>0?`<span class="ev-card-extra">+${t.totalHsExtra.toFixed(1)} extra</span>`:''}
        ${t.totalHsFeriado>0?`<span class="ev-card-feriado-hs">+${t.totalHsFeriado.toFixed(1)} feriado</span>`:''}
        <span>${t.totalSabs} sábados</span>
      </div>`;
    document.getElementById('evTfoot').innerHTML   = `
      <tr>
        <td colspan="2"><strong>TOTALES</strong></td>
        <td><strong>${t.diasUnicos}</strong></td>
        <td colspan="2"></td>
        <td><strong>${t.totalHoras.toFixed(1)}</strong></td>
        <td>${t.totalHsExtra>0?`<span class="hs-extra">${t.totalHsExtra.toFixed(1)}</span>`:'—'}</td>
        <td>${t.totalHsFeriado>0?`<span class="hs-feriado">${t.totalHsFeriado.toFixed(1)}</span>`:'—'}</td>
        <td><strong>${t.totalSabs}</strong></td>
        <td></td>
      </tr>`;
  });

  // Cargar vacaciones y banco de horas del empleado en background
  cargarVacacionesEmpleado(nombreEmp);
  cargarBancoHorasEmpleado(nombreEmp);
}

function imprimirVistaEmpleado() {
  const selectMes = document.getElementById('evSelectMes');
  const periodo = selectMes ? selectMes.value : 'TODOS';
  const periodoLabel = selectMes
    ? (selectMes.options[selectMes.selectedIndex]?.text || periodo)
    : 'Todos los registros';

  const tablaWrap = document.getElementById('evTablaWrap');
  const tablaHTML = tablaWrap ? tablaWrap.innerHTML : '';

  const nombreEl   = document.querySelector('.portal-profile-info h1');
  const sucursal   = document.querySelector('.portal-profile-info p');
  const nombreTxt  = nombreEl ? nombreEl.textContent.replace('👋','').replace('Hola','').trim() : '';
  const sucursalTxt = sucursal ? sucursal.textContent.trim() : '';

  const dias    = document.getElementById('evDias')?.textContent    || '—';
  const horas   = document.getElementById('evHoras')?.textContent   || '—';
  const extra   = document.getElementById('evExtra')?.textContent   || '—';
  const feriado = document.getElementById('evFeriado')?.textContent || '—';
  const sabs    = document.getElementById('evSabs')?.textContent    || '—';

  const win = window.open('', '_blank', 'width=900,height=700');
  win.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Historial ${periodoLabel} · ${nombreTxt}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'DM Sans', sans-serif; font-size: 13px; color: #111; padding: 28px 32px; background: #fff; }
    .print-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; border-bottom: 2px solid #111; padding-bottom: 14px; }
    .print-brand { font-family: 'Bebas Neue', sans-serif; font-size: 26px; letter-spacing: 3px; color: #111; }
    .print-meta { text-align: right; }
    .print-meta h2 { font-size: 16px; font-weight: 600; margin-bottom: 2px; }
    .print-meta p  { font-size: 12px; color: #555; }
    .print-stats { display: flex; gap: 24px; margin-bottom: 20px; padding: 12px 16px; background: #f7f7f5; border-radius: 8px; border: 1px solid #e5e5e0; }
    .print-stat { display: flex; flex-direction: column; gap: 2px; }
    .print-stat span { font-size: 11px; color: #777; text-transform: uppercase; letter-spacing: 0.5px; }
    .print-stat strong { font-family: 'Bebas Neue', sans-serif; font-size: 22px; letter-spacing: 1px; color: #111; }
    .detalle-tabla { width: 100%; border-collapse: collapse; font-size: 12px; }
    .detalle-tabla thead tr { background: #f7f7f5; }
    .detalle-tabla th { padding: 8px 10px; font-size: 10px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; color: #888; border-bottom: 1px solid #ddd; text-align: center; }
    .detalle-tabla td { padding: 7px 10px; border-bottom: 1px solid #eee; text-align: center; vertical-align: middle; }
    .detalle-tabla tfoot tr { background: #f7f7f5; }
    .detalle-tabla tfoot td { padding: 8px 10px; font-weight: 600; border-top: 2px solid #ddd; }
    .detalle-tabla tr:hover td { background: transparent; }
    .fila-sabado td { background: #fafaf0; }
    .fila-domingo td { color: #aaa; }
    .fila-feriado td { background: #fff8f0; }
    .hs-extra { background: #fef3c7; color: #92400e; padding: 2px 6px; border-radius: 10px; font-weight: 600; font-size: 11px; }
    .hs-feriado { background: #cffafe; color: #0e7490; padding: 2px 6px; border-radius: 10px; font-weight: 600; font-size: 11px; }
    .check-sab { color: #059669; font-weight: 700; }
    .tag-feriado { background: #fed7aa; color: #c2410c; padding: 1px 5px; border-radius: 4px; font-size: 10px; font-weight: 600; }
    .turno-cell { font-variant-numeric: tabular-nums; }
    .print-footer { margin-top: 20px; font-size: 11px; color: #aaa; text-align: right; }
    @media print { body { padding: 12px 16px; } .print-header { margin-bottom: 14px; } }
  </style>
</head>
<body>
  <div class="print-header">
    <div>
      <div class="print-brand">CROMA</div>
      <div style="font-size:11px;color:#888;letter-spacing:2px;margin-top:2px">HORARIOS</div>
    </div>
    <div class="print-meta">
      <h2>${nombreTxt}</h2>
      <p>${sucursalTxt}</p>
      <p style="margin-top:4px;font-weight:600">${periodoLabel}</p>
    </div>
  </div>
  <div class="print-stats">
    <div class="print-stat"><span>Días</span><strong>${dias}</strong></div>
    <div class="print-stat"><span>Hs totales</span><strong>${horas}</strong></div>
    <div class="print-stat"><span>Hs extra</span><strong>${extra}</strong></div>
    <div class="print-stat"><span>Hs feriado</span><strong>${feriado}</strong></div>
    <div class="print-stat"><span>Sábados</span><strong>${sabs}</strong></div>
  </div>
  ${tablaHTML}
  <div class="print-footer">Impreso el ${new Date().toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</div>
  <script>window.onload = function(){ window.focus(); window.print(); }<\/script>
</body>
</html>`);
  win.document.close();
}

// ── MI PERFIL (vista empleado) ─────────────────────────
// Mi Perfil ya no depende de la lista completa de usuarios (eliminada —
// ver SISTEMA DE USUARIOS LEGACY más abajo). El nombre de usuario sale de
// la sesión (JWT), y el celular se lee de EMPLEADOS vía cargarPerfiles()
// (ya cargado por la app, no requiere permisos de admin). El cambio de PIN
// va contra POST /api/mi-perfil/pin — nunca se compara el PIN en el
// cliente, nunca se le pide/devuelve el PIN completo a nadie.
async function abrirMiPerfil() {
  if (!sesionActual || !sesionActual.nombre) { showToast('No se encontró tu sesión'); return; }

  const empleadoNombre = sesionActual.empleadoNombre || null;
  const perfilEmp = empleadoNombre ? (EMPLEADOS_PERFILES[empleadoNombre] || {}) : {};
  const celularActual = perfilEmp.celular || '';

  let overlay = document.getElementById('miPerfilOverlay');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'miPerfilOverlay';
  overlay.className = 'admin-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) cerrarMiPerfil(); };
  overlay.innerHTML = `
    <div class="admin-panel admin-panel-sm" onclick="event.stopPropagation()">
      <div class="admin-header">
        <div class="admin-titulo">Mi perfil</div>
        <button class="detalle-close" onclick="cerrarMiPerfil()">${icon('x','icon-16')}</button>
      </div>
      <div class="admin-form">
        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Usuario</label>
          <div style="padding:10px 14px;background:#f8fafc;border-radius:8px;font-size:14px;color:#374151;border:1px solid #e2e8f0">
            ${sesionActual.nombre}
          </div>
        </div>

        <div class="admin-form-grupo">
          <label class="emp-filtro-label">Celular (WhatsApp)</label>
          <div style="padding:10px 14px;background:#f8fafc;border-radius:8px;font-size:14px;color:#374151;border:1px solid #e2e8f0">
            ${celularActual || 'Sin cargar'}
          </div>
          <span style="font-size:11px;color:var(--text-muted);margin-top:4px;display:block">
            Para actualizarlo, pedile a un administrador que lo edite desde tu ficha de empleado.
          </span>
        </div>

        <div class="admin-form-grupo">
          <label class="emp-filtro-label" for="miPerfilPinActual">PIN actual</label>
          <input type="password" class="admin-input" id="miPerfilPinActual"
            placeholder="PIN actual" maxlength="8" autocomplete="off" />
        </div>
        <div class="admin-form-grupo">
          <label class="emp-filtro-label" for="miPerfilPinNuevo">PIN nuevo</label>
          <input type="password" class="admin-input" id="miPerfilPinNuevo"
            placeholder="PIN nuevo (mínimo 4 dígitos)" maxlength="8" autocomplete="off" />
        </div>
        <div class="admin-form-grupo">
          <input type="password" class="admin-input" id="miPerfilPinRepetir" aria-label="Repetir PIN nuevo"
            placeholder="Repetir PIN nuevo" maxlength="8" autocomplete="off" />
          <span style="font-size:11px;color:var(--text-muted);margin-top:4px;display:block">
            Dejá los tres campos de PIN vacíos si no querés cambiarlo
          </span>
        </div>

        <p id="miPerfilError" style="color:#dc2626;font-size:12px;display:none;margin-bottom:0.5rem"></p>

        <div style="display:flex;flex-direction:column;gap:8px;margin-top:1rem">
          <button class="btn-connect" style="margin:0;width:100%" id="miPerfilBtnGuardar" onclick="guardarMiPerfil()">
            Guardar cambios
          </button>
          <button class="btn-demo" style="width:100%;padding:11px 16px" onclick="cerrarMiPerfil()">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

function cerrarMiPerfil() {
  document.getElementById('miPerfilOverlay')?.remove();
}

async function guardarMiPerfil() {
  const btn = document.getElementById('miPerfilBtnGuardar');
  if (!btn || btn.disabled) return; // evita doble submit
  const pinActual  = document.getElementById('miPerfilPinActual')?.value || '';
  const pinNuevo   = document.getElementById('miPerfilPinNuevo')?.value || '';
  const pinRepetir = document.getElementById('miPerfilPinRepetir')?.value || '';
  const errEl      = document.getElementById('miPerfilError');
  if (errEl) errEl.style.display = 'none';

  if (!pinActual && !pinNuevo && !pinRepetir) { cerrarMiPerfil(); return; } // nada para cambiar

  if (!pinActual || !pinNuevo || !pinRepetir) {
    if (errEl) { errEl.textContent = 'Completá los tres campos de PIN, o dejalos todos vacíos'; errEl.style.display = 'block'; }
    return;
  }
  if (pinNuevo.length < 4) {
    if (errEl) { errEl.textContent = 'El PIN nuevo debe tener al menos 4 caracteres'; errEl.style.display = 'block'; }
    return;
  }
  if (pinNuevo !== pinRepetir) {
    if (errEl) { errEl.textContent = 'Los PINs nuevos no coinciden'; errEl.style.display = 'block'; }
    return;
  }

  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    const data = await apiMiPerfil('/pin', {
      method: 'POST',
      body: JSON.stringify({ pin_actual: pinActual, pin_nuevo: pinNuevo }),
    });
    if (data.ok) {
      showToast('✓ PIN actualizado');
      cerrarMiPerfil();
    } else if (errEl) {
      errEl.textContent = data.error || 'No se pudo cambiar el PIN';
      errEl.style.display = 'block';
    }
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar cambios';
  }
}

