// =====================================================
//  AVISOS · Transición Legacy → AVISOS — Etapa 6/9 (corte)
//  AVISOS Provider
//
//  Implementa el contrato oficial definido en el ADR-CONTRATO-PROVIDER
//  (Etapa 0). Este archivo NO sabe nada de EVENTOS, ANUNCIOS ni AVISOS —
//  eso vive exclusivamente dentro de cada Strategy registrada. El
//  Provider solo: valida la forma de entrada, delega a la Strategy
//  activa, mide observabilidad, y devuelve la salida tal cual la
//  produjo la Strategy, sin agregar ni quitar nada del contrato.
//
//  Corte real hecho: Strategy activa = 'avisos'. Las 4 pantallas del
//  Portal (Banner/Novedades/Campana/Mi Semana) ya leen de acá.
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
    // Etapa "Deduplicación de montaje": consultasSolicitadas cuenta TODA
    // llamada a consultar() (la frontera pública), consultasReales cuenta
    // solo las que efectivamente dispararon una consulta nueva (no
    // reutilizaron una Promise en vuelo). consultasDeduplicadas e
    // inFlightActuales son derivados, no contadores propios — ver debug().
    // Deliberadamente separado de `consultas` (arriba), que sigue
    // midiendo consultas reales por Strategy vía _registrarConsulta() y
    // no debe confundirse con esto.
    consultasSolicitadas: 0,
    consultasReales: 0,
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
    const copia = JSON.parse(JSON.stringify(_obs));
    copia.consultasDeduplicadas = _obs.consultasSolicitadas - _obs.consultasReales;
    copia.inFlightActuales = _enVuelo.size;
    return copia;
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

  // Etapa 6/9 (corte): Strategy activa en producción = 'avisos'. El
  // Portal (Banner/Novedades/Campana/Mi Semana) ya no lee EVENTOS/
  // ANUNCIOS — lee la hoja AVISOS vía AvisosStrategy. 'legacy' y 'dual'
  // siguen registradas y disponibles por CromaAvisosProviderSandbox para
  // comparar o revertir sin tocar código, si hiciera falta.
  let _strategyActivaNombre = 'avisos';

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

  // Ejecuta una Strategy puntual POR NOMBRE, sin leer ni mutar
  // _strategyActivaNombre — usada tanto por consultar() (con el nombre de
  // la Strategy activa) como por el Provider Sandbox (con cualquier
  // nombre, para comparar Strategies sin tocar configuración de
  // producción). Misma observabilidad y manejo de errores en ambos casos.
  async function _consultarConStrategyEspecifica(nombre, entrada) {
    const errorEntrada = _validarEntrada(entrada);
    if (errorEntrada) return { ok: false, error: errorEntrada };

    const strategy = _strategies[nombre];
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
    _registrarConsulta(nombre, resultado, t1 - t0, tiempoNormalizacionMs);

    // El timing de normalización es una señal de observabilidad interna,
    // nunca parte del contrato de salida expuesto al consumidor (ADR,
    // "No responsabilidades" / invariante de formato de salida).
    if (resultado && typeof resultado === 'object' && '_tiempoNormalizacionMs' in resultado) {
      delete resultado._tiempoNormalizacionMs;
    }
    return resultado;
  }

  // ── Deduplicación de montaje (Etapa "Deduplicación de montaje") ────
  // Únicamente en consultar() — la frontera pública que usan los 4
  // consumidores reales del Portal (Banner/Novedades/Campana/Mi Semana).
  // _consultarConStrategyEspecifica NUNCA pasa por acá: el Sandbox y
  // DualStrategy (que la llaman directo) deben seguir trayendo datos
  // frescos siempre, sin deduplicar. No es un cache de resultados: la
  // entrada del Map vive solo mientras la Promise está pendiente, se
  // borra en el finally sin importar éxito o error — no hay TTL post-
  // resolución. Ver análisis de la carrera con marcarLeido() en el plan
  // aprobado: no se agrega invalidación activa a propósito, la ventana
  // residual es auto-limitada (dura como máximo un round-trip) y no
  // justifica la complejidad de cancelar Promises.
  const _enVuelo = new Map();

  function _claveEnVuelo(strategyNombre, entrada) {
    return [
      strategyNombre,
      entrada && entrada.empleado || '',
      entrada && entrada.sucursalId || '',
      entrada && entrada.rango && entrada.rango.desde || '',
      entrada && entrada.rango && entrada.rango.hasta || '',
    ].join('::');
  }

  async function consultar(entrada) {
    _obs.consultasSolicitadas++;

    const clave = _claveEnVuelo(_strategyActivaNombre, entrada);
    const pendiente = _enVuelo.get(clave);
    if (pendiente) return pendiente;

    _obs.consultasReales++;
    const promesa = _consultarConStrategyEspecifica(_strategyActivaNombre, entrada)
      .finally(function () { _enVuelo.delete(clave); });
    _enVuelo.set(clave, promesa);
    return promesa;
  }

  async function marcarLeido(empleado, itemId) {
    return _marcarLeidoConStrategyEspecifica(_strategyActivaNombre, empleado, itemId);
  }

  // Ejecuta marcarLeido() de una Strategy puntual POR NOMBRE, sin leer
  // ni mutar _strategyActivaNombre — mismo criterio que
  // _consultarConStrategyEspecifica. Agregado para DualStrategy (Etapa
  // DualStrategy): necesita delegar marcarLeido EXCLUSIVAMENTE a
  // 'legacy' sin importar cuál sea la Strategy activa real, y no existía
  // ningún camino para invocar una Strategy de escritura por nombre
  // hasta ahora.
  async function _marcarLeidoConStrategyEspecifica(nombre, empleado, itemId) {
    const strategy = _strategies[nombre];
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
    _consultarConStrategyEspecifica,
    _marcarLeidoConStrategyEspecifica,
  };

  // ── Provider Sandbox ────────────────────────────────────────────────
  // Punto de entrada de consola para ejecutar el Provider contra datos
  // reales sin pasar por ninguna pantalla. Pensado para sobrevivir
  // varias etapas de la transición (no es una herramienta temporal de
  // esta etapa puntual) — sirve tanto para la Validación real de la
  // Etapa 1 como para comparar Strategies entre sí más adelante.
  const ProviderSandbox = {
    // Ejecuta una consulta real contra la Strategy ACTIVA (la misma que
    // usaría cualquier pantalla futura) y devuelve la respuesta tal cual.
    consultar: function (empleado, sucursalId, rango) {
      return CromaAvisosProvider.consultar({ empleado: empleado, sucursalId: sucursalId, rango: rango });
    },
    // Ejecuta una Strategy puntual POR NOMBRE ('legacy' | 'avisos'), sin
    // tocar cuál está activa en producción. Para QA comparativo — nunca
    // usar cambiarStrategy() con este fin.
    consultarCon: function (nombreStrategy, empleado, sucursalId, rango) {
      return CromaAvisosProvider._consultarConStrategyEspecifica(nombreStrategy, {
        empleado: empleado, sucursalId: sucursalId, rango: rango,
      });
    },
    // Corre 'legacy' y 'avisos' para el mismo caso, en paralelo, sin
    // mutar la Strategy activa — pensado para el QA comparativo de la
    // Etapa 2 y para reutilizarse en cualquier etapa futura que necesite
    // comparar Strategies entre sí.
    compararStrategies: async function (empleado, sucursalId, rango) {
      const entrada = { empleado: empleado, sucursalId: sucursalId, rango: rango };
      const [legacy, avisos] = await Promise.all([
        CromaAvisosProvider._consultarConStrategyEspecifica('legacy', entrada),
        CromaAvisosProvider._consultarConStrategyEspecifica('avisos', entrada),
      ]);
      return { legacy: legacy, avisos: avisos };
    },
    // Trae, en un solo llamado, lo que devuelve la Strategy activa Y sus
    // datos crudos, para comparar a simple vista en la consola. No es
    // parte del contrato — exclusivamente diagnóstico.
    diagnostico: async function (empleado, sucursalId) {
      const strategy = _strategies[_strategyActivaNombre];
      const viaProvider = await CromaAvisosProvider.consultar({ empleado: empleado, sucursalId: sucursalId });
      const crudo = (strategy && typeof strategy._crudo === 'function')
        ? await strategy._crudo(empleado, sucursalId)
        : null;
      return { strategyActiva: _strategyActivaNombre, viaProvider: viaProvider, crudo: crudo };
    },
    // Cambia la Strategy activa de PRODUCCIÓN — reservado exclusivamente
    // para los cortes reales de etapa (Etapas 6/9). Nunca usar esto para
    // comparar Strategies en QA: para eso están consultarCon() y
    // compararStrategies(), que no tocan este estado.
    cambiarStrategy: function (nombre) { CromaAvisosProvider._setStrategyActiva(nombre); },
    strategyActiva: function () { return CromaAvisosProvider._getStrategyActivaNombre(); },
    debug: function () { return CromaAvisosProvider.debug(); },
  };

  window.CromaAvisosProviderSandbox = ProviderSandbox;
})();
