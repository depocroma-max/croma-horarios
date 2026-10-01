// ── RENDER GRILLA ──────────────────────────────────────
function renderGrilla(datos) {
  const lunes   = getLunes(state.semanaOffset);
  const { sucursal, empleado, turno } = getFilters();
  const semana  = getDatosSemana(datos, state.semanaOffset);
  const hoy     = new Date();

  // armar encabezados de días
  const thDias = DIAS.map((d, i) => {
    const f = new Date(lunes); f.setDate(lunes.getDate() + i);
    if (diaFiltrado(f)) return '';
    const esHoy = f.toDateString() === hoy.toDateString();
    const esFer = esFeriado(f);
    return `<th class="${esHoy ? 'hoy' : ''} ${esFer ? 'th-feriado' : ''}">${d}${esFer?' 🗓':''}${f.getDay()===6?' (Sáb)':f.getDay()===0?' (Dom)':''}<br><small>${formatFecha(f)}</small></th>`;
  }).join('');

  let html = '';

  SUCURSALES_TODAS.forEach(suc => {
    if (sucursal !== 'all' && sucursal !== suc.id) return;

    const filasSuc = semana.filter(r => r.LOCAL === suc.id);
    const empsSet  = [...new Set(filasSuc.map(r => r.EMPLEADO))].sort();
    const empsFilt = empleado === 'all' ? empsSet : empsSet.filter(e => e === empleado);
    if (!empsFilt.length) return;

    html += `
    <div class="sucursal-block">
      <div class="sucursal-header">
        <div class="suc-stripe" style="background:${suc.color}"></div>
        <span class="suc-nombre">${suc.nombre}</span>
        <span class="suc-badge" style="background:${suc.colorLight};color:${suc.color}">
          ${empsFilt.length} empleado${empsFilt.length !== 1 ? 's' : ''}
        </span>
        <span class="suc-meta">${filasSuc.length} registros esta semana</span>
      </div>
      <div class="grilla-wrap">
        <table class="grilla">
          <thead>
            <tr>
              <th class="th-emp">Empleado</th>
              ${thDias}
              <th>Horas</th>
            </tr>
          </thead>
          <tbody>`;

    empsFilt.forEach(emp => {
      let totalEmp = 0;
      const celdas = DIAS.map((_, i) => {
        const f = new Date(lunes); f.setDate(lunes.getDate() + i);
        if (diaFiltrado(f)) return '';
        const esHoy = f.toDateString() === hoy.toDateString();

        // Buscar TODOS los registros del empleado en ese día (para turno cortado)
        const regsDelDia = filasSuc.filter(r =>
          r.EMPLEADO === emp &&
          String(r.DIA) === String(f.getDate()) &&
          r.MES === MESES_ES[f.getMonth()] &&
          String(r.AÑO) === String(f.getFullYear())
        ).sort((a, b) => (a.H_ENTRADA || '').localeCompare(b.H_ENTRADA || ''));

        if (!regsDelDia.length) {
          return `<td class="${esHoy ? 'hoy' : ''}"><span class="empty-dash">·</span></td>`;
        }

        // Acumular horas
        regsDelDia.forEach(r => { totalEmp += parseFloat(r.TOTAL_HS) || 0; });

        // Generar pills para cada turno del día
        let pillsHtml = '';
        regsDelDia.forEach(r => {
          const tipo = clasificarTurno(r.H_ENTRADA, r.H_SALIDA);
          if (turno !== 'all' && tipo !== turno) return;
          // Siempre mostrar hora debajo de la pill
          const tieneHora = r.H_ENTRADA && r.H_SALIDA;
          pillsHtml += `<div class="turno-doble">
            ${pillHTML(tipo)}
            ${tieneHora ? `<span class="turno-hora">${r.H_ENTRADA}–${r.H_SALIDA}</span>` : ''}
          </div>`;
        });

        if (!pillsHtml) pillsHtml = '<span class="empty-dash">·</span>';

        return `<td class="${esHoy ? 'hoy' : ''}" style="vertical-align:top;padding:6px 8px">${pillsHtml}</td>`;
      }).join('');

      html += `<tr>
        <td class="td-emp td-emp-link" onclick="abrirDetalleEmpleadoPeriodo('${emp.replace(/'/g,"\\'")}', 'semana')" style="cursor:pointer">${emp}</td>
        ${celdas}
        <td><strong>${totalEmp.toFixed(1)}</strong>h</td>
      </tr>`;
    });

    html += `</tbody></table></div></div>`;
  });

  document.getElementById('grillaContainer').innerHTML = html ||
    '<p style="padding:2rem;color:#999;font-size:14px">No hay datos para los filtros seleccionados.</p>';
}

// ════════════════════════════════════════════════════════
//  EN VIVO — quién está en cada sucursal AHORA MISMO
//  (calculado con los registros de hoy: H_ENTRADA / H_SALIDA)
// ════════════════════════════════════════════════════════
const DIAS_FULL_ES = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
let enVivoInterval = null;

// Rollback temporal, mismo criterio ya usado en croma-panel-main:
//   true  = /api/envivo-hoy (HORARIOS + FICHADAS, estado calculado por
//           croma-backend) — el frontend solo renderiza.
//   false = legacy: state.datos (DATOS GENERALES) + estadoEnVivo() acá.
// Sin fallback automático Node->legacy ante error — ver cargarEnVivoNode().
const ENVIVO_NODE = true;
let envivoDataNode = null;
let envivoErrorNode = null;

async function cargarEnVivoNode() {
  const container = document.getElementById('enVivoContainer');
  if (container) container.innerHTML = '<p style="padding:2rem;color:#999;font-size:14px">Cargando...</p>';
  envivoErrorNode = null;
  let data = await apiEnVivo('');
  if (!(data && data.ok)) {
    // _apiFetch traga excepciones de red sin loguear nada — un hipo
    // transitorio de conexión se veía como error sin ninguna pista en
    // consola. Un reintento silencioso a los 2s cubre ese caso común
    // sin esconder una falla real (si vuelve a fallar, ahí sí se loguea
    // y se muestra el error).
    console.warn('[envivo] primer intento falló, reintentando en 2s:', data);
    await new Promise(r => setTimeout(r, 2000));
    data = await apiEnVivo('');
  }
  if (data && data.ok) {
    envivoDataNode = data.data;
  } else {
    envivoDataNode = null;
    envivoErrorNode = (data && data.error) || 'No se pudo cargar En vivo.';
    console.error('[envivo] falló también el reintento:', data);
  }
  renderEnVivoNode();
}

// Mismo DOM/clases CSS que renderEnVivo() (legacy) — nunca reinterpreta
// item.estado ni recalcula atraso con Date(): la única fecha usada acá es
// cosmética (hora de "actualizado" de la barra), igual que en
// croma-panel-main/renderEnVivoPanelNode().
function renderEnVivoNode() {
  const container = document.getElementById('enVivoContainer');
  if (!container) return;

  if (envivoDataNode === null) {
    container.innerHTML = `<p style="padding:2rem;color:#999;font-size:14px">${envivoErrorNode || 'Error al cargar los datos en vivo'}</p>`;
    return;
  }

  let totalPresentes = 0;
  let cards = '';

  SUCURSALES.forEach(suc => {
    const items = envivoDataNode.filter(r => r.sucursal === suc.nombre);
    const presentes  = items.filter(r => r.estado === 'PRESENTE');
    const pausados   = items.filter(r => r.estado === 'PAUSA');
    const atrasados  = items.filter(r => r.estado === 'ATRASO');
    const proximos   = items.filter(r => r.estado === 'PROXIMO');
    const terminados = items.filter(r => r.estado === 'FINALIZADO');
    totalPresentes += presentes.length;

    const hayDatos = items.length > 0;

    cards += `<div class="envivo-card ${presentes.length ? 'activa' : 'vacia'}" style="--card-suc:${suc.color}">`;
    cards += `<div class="envivo-card-head">
        <span class="envivo-card-pin" style="color:${suc.color}">${icon('mapPin','icon-16')}</span>
        <span class="envivo-card-suc">${suc.nombre}</span>
        <span class="envivo-card-count ${presentes.length ? '' : 'cero'}"><b>${presentes.length}</b><span>en turno</span></span>
      </div>`;

    if (presentes.length) {
      cards += '<div class="envivo-presentes">';
      presentes.forEach(item => {
        let meta = `Ingreso ${item.real ? item.real.entrada : '?'} - Sale ${item.real ? item.real.salida : '?'}`;
        if (item.puntualidad && item.puntualidad.estado === 'LLEGO_TARDE') meta += ` · llegó ${item.puntualidad.minutos} min tarde`;
        if (item.plan && item.plan.estado === 'SIN_HORARIO') meta += ' · sin horario cargado';
        if (item.inconsistencias && item.inconsistencias.length) meta += ' · ⚠ revisar horario';
        cards += `<div class="envivo-emp">
          ${avatarEnVivoHTML(item.empleado, suc, 'presente')}
          <div class="envivo-emp-info">
            <span class="envivo-emp-nombre">${nombreCortoEnVivo(item.empleado)}</span>
            <span class="envivo-emp-meta">${meta}</span>
          </div>
        </div>`;
      });
      cards += '</div>';
    } else if (hayDatos) {
      cards += '<div class="envivo-vacia-msg">Nadie en turno ahora</div>';
    } else {
      cards += '<div class="envivo-vacia-msg">Sin registros hoy</div>';
    }

    if (pausados.length || atrasados.length || proximos.length || terminados.length) {
      cards += '<div class="envivo-card-foot">';
      pausados.forEach(item => {
        const vuelve = item.proximo ? item.proximo.entrada : '?';
        cards += `<div class="envivo-foot-line">${icon('pause','icon-14')} <b>${nombreCortoEnVivo(item.empleado)}</b> en pausa · vuelve ${vuelve}</div>`;
      });
      atrasados.forEach(item => {
        const minutos = item.puntualidad ? item.puntualidad.minutos : '?';
        const esVuelta = item.puntualidad && item.puntualidad.estado === 'ATRASO_DE_VUELTA';
        const bloque = (item.plan && item.plan.bloqueActualIndex != null && item.plan.bloques[item.plan.bloqueActualIndex]) ? item.plan.bloques[item.plan.bloqueActualIndex].entrada : '?';
        cards += `<div class="envivo-foot-line">${icon('alertTriangle','icon-14')} <b>${nombreCortoEnVivo(item.empleado)}</b> ${esVuelta ? 'atrasado de vuelta · debía volver ' : 'atrasado · debía entrar '}${bloque} · ${minutos} min</div>`;
      });
      proximos.forEach(item => {
        const entra = item.proximo ? item.proximo.entrada : '?';
        cards += `<div class="envivo-foot-line">${icon('clock','icon-12')}<b>${nombreCortoEnVivo(item.empleado)}</b> entra ${entra}</div>`;
      });
      terminados.sort((a, b) => a.empleado.localeCompare(b.empleado)).forEach(item => {
        const salida = item.real ? item.real.salida : '?';
        const extra = (item.plan && item.plan.estado === 'SIN_HORARIO') ? ' (sin horario cargado)' : '';
        cards += `<div class="envivo-foot-line fin">${icon('check','icon-12')}<b>${nombreCortoEnVivo(item.empleado)}</b> terminó ${salida}${extra}</div>`;
      });
      cards += '</div>';
    }

    cards += '</div>';
  });

  container.innerHTML = cards;

  const bar = document.getElementById('enVivoBar');
  if (bar) {
    // Cosmético únicamente (hora de refresco de pantalla) — nunca decide estado.
    const ahora = new Date();
    const hh = String(ahora.getHours()).padStart(2, '0');
    const mm = String(ahora.getMinutes()).padStart(2, '0');
    bar.innerHTML =
      `<span class="envivo-bar-dia">${DIAS_FULL_ES[ahora.getDay()]} ${ahora.getDate()} ${MESES_ES[ahora.getMonth()].toLowerCase()}</span>` +
      `<span class="envivo-bar-hora">actualizado <b>${hh}:${mm}</b></span>` +
      `<span class="envivo-bar-total"><span class="envivo-live-dot"></span>EN VIVO · <b>${totalPresentes}</b>&nbsp;trabajando</span>`;
  }
}

function iniciarEnVivoAuto() {
  if (enVivoInterval) return;
  let ticks = 0;
  enVivoInterval = setInterval(() => {
    if (state.tabActual !== 'envivo') return;
    if (ENVIVO_NODE) {
      // El estado ya viene calculado del backend — no alcanza con
      // re-renderizar cada minuto (no cambia nada del lado del cliente),
      // hace falta volver a pedirlo. Cada 5 min, mismo intervalo que
      // croma-panel-main (FICHADAS se lee fresca en cada request).
      ticks++;
      if (ticks % 5 === 0) cargarEnVivoNode();
    } else {
      renderEnVivo(); // legacy: recalcula en el cliente cada minuto para que avance el reloj
    }
  }, 60000);
}
function detenerEnVivoAuto() {
  if (enVivoInterval) { clearInterval(enVivoInterval); enVivoInterval = null; }
}

function hhmmAMin(s) {
  const x = String(s || '').trim().split(':');
  const h = parseInt(x[0], 10);
  if (isNaN(h)) return NaN;
  const m = parseInt(x[1] || '0', 10);
  return h * 60 + (isNaN(m) ? 0 : m);
}

// Devuelve el estado de un empleado según sus bloques [{ent,sal}] del día
function estadoEnVivo(bloquesRaw, nowMin) {
  const bloques = bloquesRaw
    .map(b => {
      const ini = hhmmAMin(b.ent);
      let fin = hhmmAMin(b.sal);
      if (isNaN(ini) || isNaN(fin)) return null;
      if (fin <= ini) fin += 1440; // cruza medianoche
      return { ini, fin, iniStr: b.ent, finStr: b.sal };
    })
    .filter(Boolean)
    .sort((a, b) => a.ini - b.ini);
  if (!bloques.length) return { estado: 'sinhora' };

  const primero = bloques[0];
  const ultimo  = bloques[bloques.length - 1];
  for (const bl of bloques) {
    if (nowMin >= bl.ini && nowMin < bl.fin) {
      return { estado: 'presente', entra: bl.iniStr, salida: ultimo.finStr, salidaMin: ultimo.fin };
    }
  }
  if (nowMin < primero.ini) return { estado: 'proximo', entra: primero.iniStr, entraMin: primero.ini };
  if (nowMin >= ultimo.fin)  return { estado: 'fin', salida: ultimo.finStr };
  for (let i = 0; i < bloques.length - 1; i++) {
    if (nowMin >= bloques[i].fin && nowMin < bloques[i + 1].ini) {
      return { estado: 'pausa', vuelve: bloques[i + 1].iniStr, vuelveMin: bloques[i + 1].ini, salida: ultimo.finStr };
    }
  }
  return { estado: 'fin', salida: ultimo.finStr };
}

function inicialesEnVivo(nombre) {
  const limpio = String(nombre || '').replace(/^\d+\s+/, '');
  return limpio.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() || '').join('');
}
function nombreCortoEnVivo(nombre) {
  const limpio = String(nombre || '').replace(/^\d+\s+/, '');
  const apodo = EMPLEADOS_PERFILES[nombre]?.apodo || EMPLEADOS_PERFILES[limpio]?.apodo;
  if (apodo) return apodo;
  return limpio.split(' ')[0] || limpio;
}

function avatarEnVivoHTML(nombre, suc, estadoDot) {
  const perfil = EMPLEADOS_PERFILES[nombre] || {};
  const inic = inicialesEnVivo(nombre);
  const dot = estadoDot ? `<span class="estado-dot ${estadoDot}"></span>` : '';
  if (perfil.foto_url) {
    return `<div class="envivo-emp-avatar"><img src="${perfil.foto_url}" alt="" onerror="this.style.display='none';this.parentElement.insertAdjacentText('afterbegin','${inic}')">${dot}</div>`;
  }
  return `<div class="envivo-emp-avatar" style="background:${suc.colorLight};color:${suc.color}">${inic}${dot}</div>`;
}

function renderEnVivo() {
  const container = document.getElementById('enVivoContainer');
  if (!container) return;

  const ahora  = new Date();
  const nowMin = ahora.getHours() * 60 + ahora.getMinutes();
  const mesHoy = MESES_ES[ahora.getMonth()];

  // Registros de hoy
  const registrosHoy = state.datos.filter(r =>
    String(r.AÑO) === String(ahora.getFullYear()) &&
    r.MES === mesHoy &&
    String(r.DIA) === String(ahora.getDate())
  );

  let totalPresentes = 0;
  let cards = '';

  SUCURSALES.forEach(suc => {
    const regsSuc = registrosHoy.filter(r => r.LOCAL === suc.id);

    // Agrupar por empleado (puede tener varios registros = turno cortado)
    const porEmp = {};
    regsSuc.forEach(r => {
      if (!porEmp[r.EMPLEADO]) porEmp[r.EMPLEADO] = [];
      if (r.H_ENTRADA && r.H_SALIDA) porEmp[r.EMPLEADO].push({ ent: r.H_ENTRADA, sal: r.H_SALIDA });
    });

    const presentes = [], proximos = [], pausados = [], terminados = [];
    Object.keys(porEmp).forEach(emp => {
      const est = estadoEnVivo(porEmp[emp], nowMin);
      if (est.estado === 'presente') presentes.push({ emp, est });
      else if (est.estado === 'proximo') proximos.push({ emp, est });
      else if (est.estado === 'pausa') pausados.push({ emp, est });
      else if (est.estado === 'fin') terminados.push({ emp, est });
    });
    presentes.sort((a, b) => a.est.salidaMin - b.est.salidaMin);
    proximos.sort((a, b) => a.est.entraMin - b.est.entraMin);
    totalPresentes += presentes.length;

    const hayDatos = Object.keys(porEmp).length > 0;

    cards += `<div class="envivo-card ${presentes.length ? 'activa' : 'vacia'}" style="--card-suc:${suc.color}">`;
    cards += `<div class="envivo-card-head">
        <span class="envivo-card-pin" style="color:${suc.color}">${icon('mapPin','icon-16')}</span>
        <span class="envivo-card-suc">${suc.nombre}</span>
        <span class="envivo-card-count ${presentes.length ? '' : 'cero'}"><b>${presentes.length}</b><span>en turno</span></span>
      </div>`;

    if (presentes.length) {
      cards += '<div class="envivo-presentes">';
      presentes.forEach(o => {
        cards += `<div class="envivo-emp">
          ${avatarEnVivoHTML(o.emp, suc, 'presente')}
          <div class="envivo-emp-info">
            <span class="envivo-emp-nombre">${nombreCortoEnVivo(o.emp)}</span>
            <span class="envivo-emp-meta">Ingreso ${o.est.entra} - Sale ${o.est.salida}</span>
          </div>
        </div>`;
      });
      cards += '</div>';
    } else if (hayDatos) {
      cards += '<div class="envivo-vacia-msg">Nadie en turno ahora</div>';
    } else {
      cards += '<div class="envivo-vacia-msg">Sin registros hoy</div>';
    }

    if (pausados.length || proximos.length || terminados.length) {
      cards += '<div class="envivo-card-foot">';
      pausados.forEach(o => {
        cards += `<div class="envivo-foot-line">${icon('pause','icon-14')} <b>${nombreCortoEnVivo(o.emp)}</b> en pausa · vuelve ${o.est.vuelve}</div>`;
      });
      proximos.forEach(o => {
        cards += `<div class="envivo-foot-line">${icon('clock','icon-12')}<b>${nombreCortoEnVivo(o.emp)}</b> entra ${o.est.entra}</div>`;
      });
      terminados.sort((a, b) => (a.emp).localeCompare(b.emp)).forEach(o => {
        cards += `<div class="envivo-foot-line fin">${icon('check','icon-12')}<b>${nombreCortoEnVivo(o.emp)}</b> terminó ${o.est.salida}</div>`;
      });
      cards += '</div>';
    }

    cards += '</div>';
  });

  container.innerHTML = cards;

  // Barra superior
  const bar = document.getElementById('enVivoBar');
  if (bar) {
    const hh = String(ahora.getHours()).padStart(2, '0');
    const mm = String(ahora.getMinutes()).padStart(2, '0');
    bar.innerHTML =
      `<span class="envivo-bar-dia">${DIAS_FULL_ES[ahora.getDay()]} ${ahora.getDate()} ${MESES_ES[ahora.getMonth()].toLowerCase()}</span>` +
      `<span class="envivo-bar-hora">actualizado <b>${hh}:${mm}</b></span>` +
      `<span class="envivo-bar-total"><span class="envivo-live-dot"></span>EN VIVO · <b>${totalPresentes}</b>&nbsp;trabajando</span>`;
  }
}

