// =====================================================
//  AVISOS · Transición Legacy → AVISOS — Etapa DualStrategy
//  DualStrategy — tercera implementación del contrato del Provider.
//  Ejecuta LegacyStrategy + AvisosStrategy en paralelo para CADA
//  consulta, pero devuelve EXCLUSIVAMENTE el resultado de Legacy.
//  AvisosStrategy corre en modo sombra: solo para comparar, medir
//  divergencias y preparar el corte futuro — nunca aporta datos
//  visibles al consumidor mientras esta Strategy exista.
//
//  Fuente de verdad de esta etapa: LEGACY MANDA. Sin merge, sin
//  completar datos desde Avisos, sin failover automático si Legacy
//  falla (aunque Avisos haya funcionado).
//
//  Esta Strategy NO está activa en producción (_strategyActivaNombre
//  sigue en 'legacy', ver avisos-provider.js) — solo es alcanzable a
//  través de CromaAvisosProviderSandbox.consultarCon('dual', ...) o
//  cambiándola manualmente y restaurando de inmediato, igual patrón
//  que ya se usó para QA de AvisosStrategy en etapas anteriores.
// =====================================================

(function () {
  'use strict';

  function _ahora() {
    return (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
  }

  // ── Observabilidad propia de Dual ───────────────────────────────────
  // Deliberadamente SEPARADA de avisos-provider.js: el Provider ya
  // cuenta, dentro de _obs.porStrategy['legacy'/'avisos'], cada
  // sub-consulta que Dual dispara internamente (porque pasan por
  // _consultarConStrategyEspecifica, el mismo camino que usa el
  // Sandbox). Esos contadores del Provider miden tráfico REAL contra
  // cada fuente (útil para operar), pero NO deben confundirse con
  // "cuántas consultas Dual se hicieron" — una consulta Dual genera
  // dos entradas en esas métricas del Provider. _obsDual acá es la
  // métrica de negocio de ESTA Strategy: cuántas veces se comparó,
  // cuántas comparables, cuántas divergentes, etc. No se toca ni se
  // reimplementa el mecanismo del Provider — se documenta y se
  // convive con él.
  const _obsDual = {
    consultasTotales: 0,
    legacyOk: 0,
    legacyError: 0,
    avisosOk: 0,
    avisosError: 0,
    itemsLegacy: 0,
    itemsAvisos: 0,
    diferenciaCantidad: 0, // suma acumulada de |itemsLegacy - itemsAvisos| por consulta
    divergenciasDetectadas: 0,
    noComparables: 0,
    tiempoLegacyMsTotal: 0,
    tiempoAvisosMsTotal: 0,
    tiempoTotalMs: 0,
  };

  // Última comparación detallada — solo diagnóstico (Sandbox/consola),
  // nunca parte del contrato devuelto al consumidor.
  let _ultimaComparacion = null;

  // ── Matching best-effort (aprobado) ─────────────────────────────────
  // Huella: tipo + fechaDesde + fechaHasta + superficies. Los IDs NUNCA
  // se usan para matching (ANC-*/EVT-* vs AVI-* no tienen mapeo y no se
  // inventa uno acá). 0 candidatos o más de 1 candidato → no comparable,
  // nunca se elige uno arbitrariamente.
  function _mismaHuella(a, b) {
    return a.tipo === b.tipo &&
      a.fechaDesde === b.fechaDesde &&
      a.fechaHasta === b.fechaHasta &&
      !!a.superficies.calendario === !!b.superficies.calendario &&
      !!a.superficies.banner === !!b.superficies.banner;
  }

  function _compararItems(itemsLegacy, itemsAvisos) {
    const comparables = [];
    const noComparables = [];

    itemsAvisos.forEach(function (itemAvisos) {
      const candidatos = itemsLegacy.filter(function (itemLegacy) {
        return _mismaHuella(itemAvisos, itemLegacy);
      });

      if (candidatos.length !== 1) {
        noComparables.push({
          avisosId: itemAvisos.id,
          motivo: candidatos.length === 0 ? 'sin_candidato' : 'multiples_candidatos',
          candidatos: candidatos.length,
        });
        return;
      }

      const itemLegacy = candidatos[0];
      const camposDivergentes = [];
      if (itemAvisos.titulo !== itemLegacy.titulo) camposDivergentes.push('titulo');
      if (itemAvisos.mensaje !== itemLegacy.mensaje) camposDivergentes.push('mensaje');
      if (itemAvisos.estado !== itemLegacy.estado) camposDivergentes.push('estado');

      // leido solo es comparable si AMBOS lados tienen superficies.banner
      // === true (contrato v1.1) — si no, no aplica en ninguno de los dos
      // y no se reporta ni como divergencia ni como diferencia esperable.
      let leidoDivergente = false;
      if (itemAvisos.superficies.banner === true && itemLegacy.superficies.banner === true) {
        leidoDivergente = itemAvisos.leido !== itemLegacy.leido;
      }

      comparables.push({
        legacyId: itemLegacy.id,
        avisosId: itemAvisos.id,
        // Divergencia REAL: campos de contenido/estado que deberían
        // coincidir si ambas fuentes describen lo mismo. `leido` queda
        // aparte a propósito (ver §"Diferencias esperables" del plan) —
        // nunca cuenta como divergencia real, aunque difiera.
        divergente: camposDivergentes.length > 0,
        camposDivergentes: camposDivergentes,
        // Diferencia esperada, documentada aparte — no es un bug.
        leidoDivergente: leidoDivergente,
      });
    });

    return { comparables: comparables, noComparables: noComparables };
  }

  const DualStrategy = {
    consultar: async function (entrada) {
      _obsDual.consultasTotales++;

      const tInicio = _ahora();
      const tL0 = _ahora();
      const legacyPromise = CromaAvisosProvider
        ._consultarConStrategyEspecifica('legacy', entrada)
        .then(function (r) { _obsDual.tiempoLegacyMsTotal += (_ahora() - tL0); return r; });

      const tA0 = _ahora();
      const avisosPromise = CromaAvisosProvider
        ._consultarConStrategyEspecifica('avisos', entrada)
        .then(function (r) { _obsDual.tiempoAvisosMsTotal += (_ahora() - tA0); return r; });

      const [legacy, avisos] = await Promise.all([legacyPromise, avisosPromise]);
      _obsDual.tiempoTotalMs += (_ahora() - tInicio);

      if (legacy && legacy.ok) {
        _obsDual.legacyOk++;
        _obsDual.itemsLegacy += legacy.items.length;
      } else {
        _obsDual.legacyError++;
      }

      if (avisos && avisos.ok) {
        _obsDual.avisosOk++;
        _obsDual.itemsAvisos += avisos.items.length;
      } else {
        _obsDual.avisosError++;
      }

      let comparacion = null;
      if (legacy && legacy.ok && avisos && avisos.ok) {
        comparacion = _compararItems(legacy.items, avisos.items);
        _obsDual.diferenciaCantidad += Math.abs(legacy.items.length - avisos.items.length);
        _obsDual.divergenciasDetectadas += comparacion.comparables.filter(function (c) { return c.divergente; }).length;
        _obsDual.noComparables += comparacion.noComparables.length;
      }

      _ultimaComparacion = {
        legacyOk: !!(legacy && legacy.ok),
        avisosOk: !!(avisos && avisos.ok),
        legacyError: (legacy && !legacy.ok) ? legacy.error : null,
        avisosError: (avisos && !avisos.ok) ? avisos.error : null,
        itemsLegacy: (legacy && legacy.ok) ? legacy.items.length : null,
        itemsAvisos: (avisos && avisos.ok) ? avisos.items.length : null,
        comparacion: comparacion,
      };

      // Legacy manda, sin excepción: si Legacy falló, se devuelve tal
      // cual su error — Avisos NUNCA rescata una falla de Legacy en
      // esta etapa, sin importar si avisos.ok === true.
      return legacy;
    },

    // Delega EXCLUSIVAMENTE a LegacyStrategy — decisión confirmada:
    // Avisos está en sombra, escribir también en AVISOS_LEIDOS acá
    // sería un efecto secundario real en una Strategy que todavía solo
    // se observa. Requiere el hook _marcarLeidoConStrategyEspecifica
    // agregado a avisos-provider.js (mismo patrón que
    // _consultarConStrategyEspecifica, ya existente).
    marcarLeido: async function (empleado, itemId) {
      return CromaAvisosProvider._marcarLeidoConStrategyEspecifica('legacy', empleado, itemId);
    },

    // No forma parte del alcance de QA de esta etapa (no está en los 22
    // casos) — se implementa igual, delegando a Legacy, por consistencia
    // con "Legacy manda" y porque LegacyStrategy.contarNoLeidos() es
    // trivialmente replicable sin más hooks nuevos al Provider.
    contarNoLeidos: async function (entrada) {
      const legacy = await CromaAvisosProvider._consultarConStrategyEspecifica('legacy', entrada);
      if (!legacy.ok) return legacy;
      const noLeidos = legacy.items.filter(function (item) {
        return item.superficies.banner && item.estado === 'vigente' && !item.leido;
      });
      return { ok: true, cantidad: noLeidos.length };
    },
  };

  // Diagnóstico de consola — exclusivamente Sandbox/QA, nunca parte del
  // contrato ni de ninguna pantalla. Copia profunda, mismo criterio que
  // CromaAvisosProvider.debug().
  window.CromaAvisosProviderDualDebug = function () {
    return {
      obs: JSON.parse(JSON.stringify(_obsDual)),
      ultimaComparacion: _ultimaComparacion ? JSON.parse(JSON.stringify(_ultimaComparacion)) : null,
    };
  };

  if (window.CromaAvisosProvider && typeof window.CromaAvisosProvider.registrarStrategy === 'function') {
    window.CromaAvisosProvider.registrarStrategy('dual', DualStrategy);
  }
})();
