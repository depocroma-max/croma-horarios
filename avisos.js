// =====================================================
//  AVISOS · Fase 1 — shell visual con datos mock
//  Sin backend, sin drawer, sin calendario "funcional"
//  (grilla navegable, sin avisos pintados en las celdas).
//  Encapsulado en un único namespace: CromaAvisos.
// =====================================================

(function () {
  'use strict';

  const SUCURSALES = [
    { id: 'todas',    label: 'Todas' },
    { id: '01',       label: 'Paseo',          var: '--suc-01' },
    { id: '05',       label: 'Wave',           var: '--suc-05' },
    { id: '09',       label: 'Cipo',           var: '--suc-09' },
    { id: '10',       label: 'Perito Moreno',  var: '--suc-10' },
    { id: '12',       label: 'Centenario',     var: '--suc-12' },
    { id: '14',       label: 'Roca',           var: '--suc-14' },
    { id: 'DEPO',     label: 'Depo',           var: '--suc-depo' },
    { id: 'OFICINA',  label: 'Oficina',        var: '--suc-oficina' },
  ];

  const TIPO_META = {
    informacion:   { label: 'Información',   icono: 'ⓘ' },
    evento:        { label: 'Evento',        icono: '●' },
    local_cerrado: { label: 'Local cerrado', icono: '▓' },
  };

  const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
    'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  const state = {
    sucursal: 'todas',
    vista: 'hoy',
    busqueda: '',
    calAnio: null,
    calMes: null, // 0-11
    archivadosAbiertos: false,
  };

  let inicializado = false;

  // ── Helpers de fecha ──────────────────────────────────
  function hoyDate() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function hoyISO() { return isoDeDate(hoyDate()); }
  function isoDeDate(d) { return d.toISOString().slice(0, 10); }
  function fmtCorta(iso) {
    const [y, m, d] = iso.split('-');
    return d + '/' + m;
  }
  function fmtRango(desde, hasta) {
    return desde === hasta ? fmtCorta(desde) : fmtCorta(desde) + ' → ' + fmtCorta(hasta);
  }

  // ── Resolución de datos (contrato definitivo) ─────────
  function todosLosAvisos() {
    return (window.CROMA_AVISOS_MOCK || []).slice();
  }

  function estadoDe(aviso) {
    if (aviso.archivado) return 'archivado';
    const hoy = hoyISO();
    if (aviso.fechaDesde > hoy) return 'programado';
    if (aviso.fechaHasta >= hoy) return 'activo';
    return 'vencido';
  }

  // Regla de visibilidad por tab de sucursal (modelo funcional aprobado):
  // - "todos" siempre visible en cualquier tab, incluida "Todas"
  // - "sucursal" visible en "Todas" y en cada sucursal incluida
  // - "administracion" nunca aparece en tabs de sucursal (es por rol, no geográfico)
  // - "empleado" se ubica en la tab de la sucursal de ese empleado (mock trae sucursalId)
  function visibleEnTab(aviso, sucId) {
    const d = aviso.destinatarios;
    if (d.modo === 'administracion') return false;
    if (sucId === 'todas') return true;
    if (d.modo === 'todos') return true;
    if (d.modo === 'sucursal') return d.ids.indexOf(sucId) !== -1;
    if (d.modo === 'empleado') return d.sucursalId === sucId;
    return false;
  }

  function labelDestinatarios(aviso) {
    const d = aviso.destinatarios;
    if (d.modo === 'todos') return 'Todos';
    if (d.modo === 'administracion') return 'Administración';
    if (d.modo === 'empleado') return d.nombres.join(', ');
    if (d.modo === 'sucursal') {
      return d.ids.map(function (id) {
        const s = SUCURSALES.find(function (x) { return x.id === id; });
        return s ? s.label : id;
      }).join(' + ');
    }
    return '';
  }

  function coincideBusqueda(aviso, q) {
    if (!q) return true;
    q = q.toLowerCase();
    return aviso.titulo.toLowerCase().indexOf(q) !== -1 ||
           aviso.mensaje.toLowerCase().indexOf(q) !== -1;
  }

  function avisosFiltrados() {
    return todosLosAvisos()
      .filter(function (a) { return visibleEnTab(a, state.sucursal); })
      .filter(function (a) { return coincideBusqueda(a, state.busqueda); });
  }

  function colorSucursalDeAviso(aviso) {
    if (aviso.destinatarios.modo === 'sucursal' && aviso.destinatarios.ids.length === 1) {
      const s = SUCURSALES.find(function (x) { return x.id === aviso.destinatarios.ids[0]; });
      if (s && s.var) return s.var;
    }
    if (aviso.destinatarios.modo === 'empleado') {
      const s = SUCURSALES.find(function (x) { return x.id === aviso.destinatarios.sucursalId; });
      if (s && s.var) return s.var;
    }
    return null;
  }

  // ── Render: shell general ─────────────────────────────
  function render() {
    const cont = document.getElementById('avisosContainer');
    if (!cont) return;

    const sucOpts = SUCURSALES.map(function (s) {
      const activo = s.id === state.sucursal ? ' active' : '';
      const dotStyle = s.var ? ' style="--suc-dot:var(' + s.var + ')"' : '';
      return '<button class="avz-suc-tab' + activo + '" data-suc="' + s.id + '"' + dotStyle + '>' +
        (s.var ? '<span class="avz-suc-dot"></span>' : '') + s.label + '</button>';
    }).join('');

    cont.innerHTML =
      '<div class="avz-shell">' +
        '<div class="avz-header">' +
          '<h1 class="avz-titulo">AVISOS</h1>' +
          '<div class="avz-header-acciones">' +
            '<div class="avz-view-toggle">' +
              btnVista('hoy', 'Hoy') + btnVista('calendario', 'Calendario') + btnVista('lista', 'Lista') +
            '</div>' +
            '<div class="avz-search">' + icon('search', 'icon-16') +
              '<input type="search" id="avzBuscar" placeholder="Buscar avisos..." value="' + escapeAttr(state.busqueda) + '" />' +
            '</div>' +
            '<button class="btn btn-primary avz-btn-beta" id="avzBtnNuevo" disabled title="Disponible en la próxima fase">' +
              icon('plus', 'icon-16') + ' Nuevo aviso' +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div class="avz-suc-tabs" id="avzSucTabs">' + sucOpts + '</div>' +
        '<div class="avz-quick-actions">' +
          '<button class="btn btn-outline avz-btn-beta" disabled title="Disponible en la próxima fase">🔒 Cerrar local</button>' +
          '<button class="btn btn-outline avz-btn-beta" disabled title="Disponible en la próxima fase">⧉ Duplicar último</button>' +
        '</div>' +
        '<div class="avz-body" id="avzBody"></div>' +
      '</div>';

    document.getElementById('avzSucTabs').addEventListener('click', function (e) {
      const btn = e.target.closest('.avz-suc-tab');
      if (!btn) return;
      state.sucursal = btn.dataset.suc;
      render();
    });
    cont.querySelectorAll('.avz-view-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        state.vista = b.dataset.vista;
        render();
      });
    });
    document.getElementById('avzBuscar').addEventListener('input', function (e) {
      state.busqueda = e.target.value;
      renderBody();
    });

    renderBody();
  }

  function btnVista(id, label) {
    const activo = state.vista === id ? ' active' : '';
    return '<button class="avz-view-btn' + activo + '" data-vista="' + id + '">' + label + '</button>';
  }

  function escapeAttr(s) { return String(s || '').replace(/"/g, '&quot;'); }
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;';
    });
  }

  function renderBody() {
    const body = document.getElementById('avzBody');
    if (!body) return;
    if (state.vista === 'hoy') body.innerHTML = renderHoy();
    else if (state.vista === 'calendario') { body.innerHTML = renderCalendarioShell(); wireCalendario(); }
    else body.innerHTML = renderLista();
    wireAccionesFila(body);
  }

  // ── Vista Hoy ──────────────────────────────────────────
  function renderHoy() {
    const avisos = avisosFiltrados();
    const hoy = hoyISO();
    const activos = avisos.filter(function (a) { return estadoDe(a) === 'activo'; });
    const cierresHoy = activos.filter(function (a) {
      return a.tipo === 'local_cerrado' && a.fechaDesde <= hoy && a.fechaHasta >= hoy;
    });
    const urgentes = activos.filter(function (a) { return a.prioridad === 'urgente'; });
    const en7dias = avisos.filter(function (a) {
      const st = estadoDe(a);
      if (st !== 'programado' && st !== 'activo') return false;
      const dias = diffDias(hoy, a.fechaDesde);
      return dias >= 0 && dias <= 7 && a.prioridad !== 'urgente' &&
        !(a.tipo === 'local_cerrado' && cierresHoy.indexOf(a) !== -1);
    }).sort(function (a, b) { return a.fechaDesde < b.fechaDesde ? -1 : 1; });

    if (!cierresHoy.length && !urgentes.length && !en7dias.length) {
      return '<div class="avz-vacio">' +
        '<div class="avz-vacio-titulo">Nada activo por ahora.</div>' +
        '<div class="avz-vacio-sub">Todo tranquilo en ' + (state.sucursal === 'todas' ? 'todas las sucursales' : 'esta sucursal') + '.</div>' +
      '</div>';
    }

    let html = '<div class="avz-hoy-fecha">' + fechaLargaHoy() + '</div>';

    cierresHoy.forEach(function (a) {
      const cv = colorSucursalDeAviso(a);
      const bg = cv ? ' style="background:var(' + cv + '-light,var(--gray-50))"' : '';
      html += '<div class="avz-card avz-card-cierre"' + bg + '>' +
        '<span class="avz-card-icono">▓</span>' +
        '<div class="avz-card-texto">' +
          '<div class="avz-card-titulo">' + escapeHtml(a.titulo) + '</div>' +
          '<div class="avz-card-sub">' + escapeHtml(labelDestinatarios(a)) + '</div>' +
        '</div>' +
        '<div class="avz-card-fecha">' + fmtRango(a.fechaDesde, a.fechaHasta) + '</div>' +
      '</div>';
    });

    urgentes.forEach(function (a) {
      html += '<div class="avz-card avz-card-urgente">' +
        '<span class="avz-card-icono">🔴</span>' +
        '<div class="avz-card-texto">' +
          '<div class="avz-card-titulo">Urgente · ' + escapeHtml(a.titulo) + '</div>' +
          '<div class="avz-card-sub">' + escapeHtml(labelDestinatarios(a)) + '</div>' +
        '</div>' +
      '</div>';
    });

    if (en7dias.length) {
      html += '<div class="avz-proximos-label">Próximos 7 días</div>';
      en7dias.forEach(function (a) {
        html += '<div class="avz-proximo-fila">' +
          '<span class="avz-card-icono">' + TIPO_META[a.tipo].icono + '</span>' +
          '<span class="avz-proximo-fecha">' + fmtCorta(a.fechaDesde) + '</span>' +
          '<span class="avz-proximo-titulo">' + escapeHtml(a.titulo) + '</span>' +
          '<span class="avz-proximo-dest">' + escapeHtml(labelDestinatarios(a)) + '</span>' +
        '</div>';
      });
    }

    return html;
  }

  function fechaLargaHoy() {
    const d = new Date();
    const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    return dias[d.getDay()] + ', ' + d.getDate() + ' de ' + MESES[d.getMonth()].toLowerCase();
  }

  function diffDias(isoA, isoB) {
    const a = new Date(isoA + 'T00:00:00');
    const b = new Date(isoB + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  }

  // ── Vista Lista ────────────────────────────────────────
  function renderLista() {
    const avisos = avisosFiltrados();
    if (!avisos.length) {
      return '<div class="avz-lista-toolbar">' + selectsListaInertes() + '</div>' +
        '<div class="avz-vacio">' +
          '<div class="avz-vacio-titulo">' + (state.busqueda ? 'No encontramos avisos que coincidan con "' + escapeHtml(state.busqueda) + '"' : 'Todavía no hay avisos') + '</div>' +
          '<div class="avz-vacio-sub">' + (state.busqueda ? 'Probá con otra búsqueda.' : 'Los avisos que se publiquen van a aparecer acá.') + '</div>' +
        '</div>';
    }

    const grupos = { activo: [], programado: [], vencido: [] };
    const archivados = [];
    avisos.forEach(function (a) {
      const st = estadoDe(a);
      if (st === 'archivado') archivados.push(a);
      else grupos[st].push(a);
    });

    let html = '<div class="avz-lista-toolbar">' + selectsListaInertes() + '</div>';
    html += renderGrupo('Activos', grupos.activo);
    html += renderGrupo('Programados', grupos.programado);
    html += renderGrupo('Vencidos', grupos.vencido);

    if (archivados.length) {
      html += '<button class="avz-archivados-toggle" id="avzToggleArchivados">' +
        (state.archivadosAbiertos ? '▾' : '▸') + ' Archivados (' + archivados.length + ')</button>';
      if (state.archivadosAbiertos) html += renderGrupo(null, archivados);
    }
    return html;
  }

  function selectsListaInertes() {
    return '<select class="avz-select" disabled title="Disponible en la próxima fase"><option>Tipo</option></select>' +
      '<select class="avz-select" disabled title="Disponible en la próxima fase"><option>Estado</option></select>' +
      '<select class="avz-select" disabled title="Disponible en la próxima fase"><option>Prioridad</option></select>';
  }

  function renderGrupo(label, avisos) {
    if (!avisos.length) return '';
    let html = label ? '<div class="avz-lista-grupo-label">' + label + '</div>' : '';
    avisos.forEach(function (a) {
      html += '<div class="avz-fila">' +
        '<span class="avz-fila-icono">' + TIPO_META[a.tipo].icono + '</span>' +
        '<div class="avz-fila-info">' +
          '<div class="avz-fila-titulo">' +
            (a.prioridad === 'urgente' ? '<span class="avz-urgente-dot"></span>' : '') +
            escapeHtml(a.titulo) +
          '</div>' +
          '<div class="avz-fila-dest">' + escapeHtml(labelDestinatarios(a)) + '</div>' +
        '</div>' +
        '<span class="avz-fila-fecha">' + fmtRango(a.fechaDesde, a.fechaHasta) + '</span>' +
        '<div class="avz-fila-acciones">' +
          '<button class="avz-fila-accion-btn" disabled title="Disponible en la próxima fase">' + icon('edit', 'icon-14') + '</button>' +
          '<button class="avz-fila-accion-btn" disabled title="Disponible en la próxima fase">' + icon('trash', 'icon-14') + '</button>' +
        '</div>' +
      '</div>';
    });
    return html;
  }

  function wireAccionesFila(body) {
    const toggle = body.querySelector('#avzToggleArchivados');
    if (toggle) toggle.addEventListener('click', function () {
      state.archivadosAbiertos = !state.archivadosAbiertos;
      renderBody();
    });
  }

  // ── Vista Calendario (grilla real, sin avisos pintados) ─
  function renderCalendarioShell() {
    if (state.calAnio === null) {
      const hoy = hoyDate();
      state.calAnio = hoy.getFullYear();
      state.calMes = hoy.getMonth();
    }
    const cabeceraDias = DIAS_SEMANA.map(function (d) { return '<span>' + d + '</span>'; }).join('');
    return '<div class="avz-cal-toolbar">' +
        '<div class="avz-cal-nav">' +
          '<button class="avz-cal-nav-btn" id="avzMesPrev" aria-label="Mes anterior">' + icon('chevronLeft', 'icon-16') + '</button>' +
          '<span class="avz-cal-mes">' + MESES[state.calMes] + ' ' + state.calAnio + '</span>' +
          '<button class="avz-cal-nav-btn" id="avzMesNext" aria-label="Mes siguiente">' + icon('chevronRight', 'icon-16') + '</button>' +
        '</div>' +
        '<button class="avz-cal-hoy-btn" id="avzMesHoy">Hoy</button>' +
      '</div>' +
      '<div class="avz-cal-grid">' +
        '<div class="avz-cal-dias-header">' + cabeceraDias + '</div>' +
        '<div class="avz-cal-semanas" id="avzCalSemanas">' + renderSemanas(state.calAnio, state.calMes) + '</div>' +
      '</div>' +
      '<div class="avz-cal-legenda">' +
        '<span>● Evento</span><span>▓ Local cerrado</span><span>ⓘ Información</span><span>🔴 Urgente</span>' +
      '</div>';
  }

  function renderSemanas(anio, mes) {
    const primerDia = new Date(anio, mes, 1);
    // lunes = 0 ... domingo = 6
    const offset = (primerDia.getDay() + 6) % 7;
    const diasEnMes = new Date(anio, mes + 1, 0).getDate();
    const diasMesAnterior = new Date(anio, mes, 0).getDate();
    const hoy = hoyISO();

    const celdas = [];
    for (let i = 0; i < offset; i++) {
      celdas.push({ num: diasMesAnterior - offset + i + 1, fuera: true });
    }
    for (let d = 1; d <= diasEnMes; d++) {
      celdas.push({ num: d, fuera: false, iso: isoDeDate(new Date(anio, mes, d)) });
    }
    while (celdas.length % 7 !== 0) {
      celdas.push({ num: celdas.length - offset - diasEnMes + 1, fuera: true });
    }

    let html = '';
    for (let s = 0; s < celdas.length; s += 7) {
      html += '<div class="avz-cal-semana">';
      for (let i = s; i < s + 7; i++) {
        const c = celdas[i];
        const esHoy = !c.fuera && c.iso === hoy;
        html += '<div class="avz-cal-celda' + (c.fuera ? ' fuera-de-mes' : '') + (esHoy ? ' es-hoy' : '') + '">' +
          '<div class="avz-cal-num">' + c.num + '</div>' +
        '</div>';
      }
      html += '</div>';
    }
    return html;
  }

  function wireCalendario() {
    const prev = document.getElementById('avzMesPrev');
    const next = document.getElementById('avzMesNext');
    const hoyBtn = document.getElementById('avzMesHoy');
    if (prev) prev.addEventListener('click', function () { cambiarMes(-1); });
    if (next) next.addEventListener('click', function () { cambiarMes(1); });
    if (hoyBtn) hoyBtn.addEventListener('click', function () {
      const hoy = hoyDate();
      state.calAnio = hoy.getFullYear();
      state.calMes = hoy.getMonth();
      renderBody();
    });
  }

  function cambiarMes(delta) {
    state.calMes += delta;
    if (state.calMes < 0) { state.calMes = 11; state.calAnio--; }
    else if (state.calMes > 11) { state.calMes = 0; state.calAnio++; }
    renderBody();
  }

  // ── Integración con la navegación existente ───────────
  // No se toca app.js: el botón "Avisos · Beta" usa una clase propia
  // (no ".nav-btn"/".drawer-nav-btn") para no engancharse al router
  // genérico de setView(). Activamos la vista a mano y corregimos el
  // único efecto colateral que setView() hubiera dejado mal si
  // reusáramos ese router: la .controls-bar (semana/mes/filtros)
  // quedando visible porque 'avisos' no existe en su lista sinControls.
  function activar() {
    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
    document.querySelectorAll('.nav-btn, .drawer-nav-btn').forEach(function (b) { b.classList.remove('active'); });
    const view = document.getElementById('viewAvisos');
    if (view) view.classList.add('active');
    const btnTop = document.getElementById('avzNavBtn');
    const btnDrawer = document.getElementById('avzDrawerNavBtn');
    if (btnTop) btnTop.classList.add('active');
    if (btnDrawer) btnDrawer.classList.add('active');
    const controlsBar = document.querySelector('.controls-bar');
    if (controlsBar) controlsBar.style.display = 'none';
    const statsRow = document.querySelector('.stats-row');
    if (statsRow) statsRow.style.display = 'none';
    localStorage.setItem('croma_vista', 'avisos');
    render();
    const drawerOverlay = document.getElementById('drawerOverlay');
    const drawerMenu = document.getElementById('drawerMenu');
    if (drawerOverlay) drawerOverlay.classList.remove('open');
    if (drawerMenu) drawerMenu.classList.remove('open');
  }

  // El acceso "Avisos · Beta" debe verse únicamente para rol admin.
  // En vez de reimplementar esa lógica de permisos (que ya existe en
  // app.js), la espejamos: el botón nativo #navBtnAdmin solo se hace
  // visible ahí para admin (iniciarAppConSesion), así que seguimos
  // exactamente su mismo estado en vez de duplicar la condición.
  function sincronizarVisibilidadAdmin() {
    const ref = document.getElementById('navBtnAdmin');
    const btnTop = document.getElementById('avzNavBtn');
    const btnDrawer = document.getElementById('avzDrawerNavBtn');
    if (!ref) return;
    const visible = ref.style.display !== 'none';
    if (btnTop) btnTop.style.display = visible ? '' : 'none';
    if (btnDrawer) btnDrawer.style.display = visible ? '' : 'none';
  }

  function init() {
    if (inicializado) return;
    inicializado = true;
    const btnTop = document.getElementById('avzNavBtn');
    const btnDrawer = document.getElementById('avzDrawerNavBtn');
    if (btnTop) btnTop.addEventListener('click', activar);
    if (btnDrawer) btnDrawer.addEventListener('click', activar);

    const ref = document.getElementById('navBtnAdmin');
    if (ref) {
      new MutationObserver(sincronizarVisibilidadAdmin)
        .observe(ref, { attributes: true, attributeFilter: ['style'] });
    }
    sincronizarVisibilidadAdmin();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Exposición mínima para integración/debug — el resto queda privado.
  window.CromaAvisos = { activar: activar };
})();
