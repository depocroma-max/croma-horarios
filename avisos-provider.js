// =====================================================
//  AVISOS · Transición Legacy → AVISOS — Etapa 1
//  AVISOS Provider
//
//  Implementa el contrato oficial definido en el ADR-CONTRATO-PROVIDER
//  (Etapa 0). Este archivo NO sabe nada de EVENTOS, ANUNCIOS ni AVISOS —
//  eso vive exclusivamente dentro de cada Strategy registrada. El
//  Provider solo: valida la forma de entrada, delega a la Strategy
//  activa, mide observabilidad, y devuelve la salida tal cual la
//  produjo la Strategy, sin agregar ni quitar nada del contrato.
//
//  Ninguna pantalla usa este archivo todavía (Etapa 1 del Plan de
//  Implementación). Se carga en index.html sin conectarse a ningún
//  flujo visible — mismo patrón que tuvo avisos.js en su Fase 1.
// =====================================================

(function () {
  'use strict';

  function _ahora() {
    return (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
  }

  // ── Observabilidad — activa desde esta primera Strategy real
  //    (ajuste aprobado en el cierre de la Etapa 0: no se espera a la
  //    convivencia/Etapa 6 para empezar a medir). Incluye tiempo de
  //    normalización por separado del tiempo total de consulta, para
  //    poder comparar LegacyStrategy contra AvisosStrategy más adelante
  //    (ajuste aprobado antes de esta implementación). ────────────────
  const _obs = {
    consultas: 0,
    errores: 0,
    itemsDevueltos: 0,
    tiempoConsultaMsTotal: 0,
    tiempoNormalizacionMsTotal: 0,
    porStrategy: {},
  };

  function _registrarConsulta(strategyNombre, resultado, tiempoConsultaMs, tiempoNormalizacionMs) {
    _obs.consultas++;
    _obs.tiempoConsultaMsTotal += tiempoConsultaMs;
    if (typeof tiempoNormalizacionMs === 'number') _obs.tiempoNormalizacionMsTotal += tiempoNormalizacionMs;
    if (!resultado || !resultado.ok) _obs.errores++;
    else _obs.itemsDevueltos += (resultado.items || []).length;

    if (!_obs.porStrategy[strategyNombre]) {
      _obs.porStrategy[strategyNombre] = {
        consultas: 0, errores: 0, items: 0,
        tiempoConsultaMsTotal: 0, tiempoNormalizacionMsTotal: 0,
      };
    }
    const s = _obs.porStrategy[strategyNombre];
    s.consultas++;
    s.tiempoConsultaMsTotal += tiempoConsultaMs;
    if (typeof tiempoNormalizacionMs === 'number') s.tiempoNormalizacionMsTotal += tiempoNormalizacionMs;
    if (!resultado || !resultado.ok) s.errores++;
    else s.items += (resultado.items || []).length;
  }

  function debug() {
    // Copia — nadie por fuera del Provider debe poder mutar el contador real.
    return JSON.parse(JSON.stringify(_obs));
  }

  // ── Registro de Strategies ─────────────────────────────────────────
  // Cada Strategy se registra a sí misma al cargarse (ver
  // avisos-provider-legacy-strategy.js). El Provider nunca importa ni
  // conoce el nombre de archivo de ninguna Strategy — solo el nombre
  // lógico ('legacy', y más adelante 'avisos'/'dual').
  const _strategies = {};

  function registrarStrategy(nombre, impl) {
    if (!nombre || typeof impl !== 'object' || typeof impl.consultar !== 'function') {
      throw new Error('Strategy inválida: debe tener nombre y un método consultar().');
    }
    _strategies[nombre] = impl;
  }

  // Etapa 1: solo existe 'legacy'. No hay ninguna decisión de negocio
  // codificada acá sobre cuál Strategy usar — es un valor fijo, listo
  // para que las Etapas 2 y 6 lo cambien sin tocar el resto de este
  // archivo ni ninguna pantalla.
  let _strategyActivaNombre = 'legacy';

  function _setStrategyActiva(nombre) {
    if (!_strategies[nombre]) throw new Error('Strategy no registrada: ' + nombre);
    _strategyActivaNombre = nombre;
  }

  function _getStrategyActivaNombre() {
    return _strategyActivaNombre;
  }

  // ── Contrato de entrada — validación mínima de forma ───────────────
  function _validarEntrada(entrada) {
    if (!entrada || typeof entrada !== 'object') return 'Entrada inválida.';
    if (!entrada.empleado || typeof entrada.empleado !== 'string') return 'Falta identidad del empleado.';
    return null;
  }

  // ── API pública — contrato oficial (ADR-CONTRATO-PROVIDER) ─────────

  async function consultar(entrada) {
    const errorEntrada = _validarEntrada(entrada);
    if (errorEntrada) return { ok: false, error: errorEntrada };

    const strategy = _strategies[_strategyActivaNombre];
    if (!strategy) return { ok: false, error: 'No hay ninguna Strategy activa.' };

    const t0 = _ahora();
    let resultado;
    try {
      resultado = await strategy.consultar(entrada);
    } catch (e) {
      resultado = { ok: false, error: 'Error interno del Provider: ' + (e && e.message) };
    }
    const t1 = _ahora();

    const tiempoNormalizacionMs = resultado && typeof resultado._tiempoNormalizacionMs === 'number'
      ? resultado._tiempoNormalizacionMs
      : undefined;
    _registrarConsulta(_strategyActivaNombre, resultado, t1 - t0, tiempoNormalizacionMs);

    // El timing de normalización es una señal de observabilidad interna,
    // nunca parte del contrato de salida expuesto al consumidor (ADR,
    // "No responsabilidades" / invariante de formato de salida).
    if (resultado && typeof resultado === 'object' && '_tiempoNormalizacionMs' in resultado) {
      delete resultado._tiempoNormalizacionMs;
    }
    return resultado;
  }

  async function marcarLeido(empleado, itemId) {
    const strategy = _strategies[_strategyActivaNombre];
    if (!strategy || typeof strategy.marcarLeido !== 'function') {
      return { ok: false, error: 'No disponible.' };
    }
    try {
      return await strategy.marcarLeido(empleado, itemId);
    } catch (e) {
      return { ok: false, error: 'Error interno del Provider: ' + (e && e.message) };
    }
  }

  async function contarNoLeidos(entrada) {
    const errorEntrada = _validarEntrada(entrada);
    if (errorEntrada) return { ok: false, error: errorEntrada };

    const strategy = _strategies[_strategyActivaNombre];
    if (!strategy || typeof strategy.contarNoLeidos !== 'function') {
      return { ok: false, error: 'No disponible.' };
    }
    try {
      return await strategy.contarNoLeidos(entrada);
    } catch (e) {
      return { ok: false, error: 'Error interno del Provider: ' + (e && e.message) };
    }
  }

  window.CromaAvisosProvider = {
    consultar,
    marcarLeido,
    contarNoLeidos,
    registrarStrategy,
    debug,
    // Uso interno / Provider Sandbox — no forman parte del contrato
    // público consumido por pantallas.
    _setStrategyActiva,
    _getStrategyActivaNombre,
  };

  // ── Provider Sandbox ────────────────────────────────────────────────
  // Punto de entrada de consola para ejecutar el Provider contra datos
  // reales sin pasar por ninguna pantalla. Pensado para sobrevivir
  // varias etapas de la transición (no es una herramienta temporal de
  // esta etapa puntual) — sirve tanto para la Validación real de la
  // Etapa 1 como para comparar Strategies entre sí más adelante.
  const ProviderSandbox = {
    // Ejecuta una consulta real y devuelve la respuesta tal cual la
    // recibiría cualquier pantalla futura.
    consultar: function (empleado, sucursalId, rango) {
      return CromaAvisosProvider.consultar({ empleado: empleado, sucursalId: sucursalId, rango: rango });
    },
    // Trae, en un solo llamado, lo que devuelve el Provider Y los datos
    // crudos de las fuentes legacy, para comparar a simple vista en la
    // consola durante QA técnico / Validación real. No es parte del
    // contrato — es exclusivamente una herramienta de diagnóstico.
    diagnostico: async function (empleado, sucursalId) {
      const strategy = _strategies[_strategyActivaNombre];
      const viaProvider = await CromaAvisosProvider.consultar({ empleado: empleado, sucursalId: sucursalId });
      const crudo = (strategy && typeof strategy._crudo === 'function')
        ? await strategy._crudo(empleado, sucursalId)
        : null;
      return { strategyActiva: _strategyActivaNombre, viaProvider: viaProvider, crudo: crudo };
    },
    cambiarStrategy: function (nombre) { CromaAvisosProvider._setStrategyActiva(nombre); },
    strategyActiva: function () { return CromaAvisosProvider._getStrategyActivaNombre(); },
    debug: function () { return CromaAvisosProvider.debug(); },
  };

  window.CromaAvisosProviderSandbox = ProviderSandbox;
})();
