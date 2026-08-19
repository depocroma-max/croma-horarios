# PLAN — Sacar a Apps Script del camino crítico (Sheets API directa)

> **Estado (2026-08-18):** en curso, bastante avanzado — desactualizado si decía
> "sin empezar". Ya migrados: Horarios, Perfiles, Vacaciones (lectura), Portal
> Empleado, Avisos (completo). Fichadas parcial. Ver tabla de fases más abajo
> para el detalle actualizado por módulo.

## 0. Decisión aceptada — hosting de croma-backend

Migrar estos módulos a croma-backend implica que **todo** (fichadas,
horarios, panel, los 2 kioscos) pasa a depender de que el proceso Node en
esta PC esté corriendo — hoy, si esta máquina se cae, esas 4 superficies
siguen andando igual porque le pegan directo a Google. Esto se evaluó y
**se decide conscientemente seguir así por ahora** (2026-08-12): croma-backend
sigue corriendo en esta PC, sin mudarlo a un hosting con más garantías de
uptime (VPS, Cloud Run, Render, etc.). Se evalúa mudarlo más adelante, por
separado — no es parte de este plan ni un bloqueante para arrancarlo.

## 1. Por qué

Hoy un único Apps Script (`Code-Jornada.js`) es el backend de fichadas,
horarios, perfiles, vacaciones, banco de horas, avisos, certificados, login de
empleados, identidad y (parcialmente) recibos — consumido por 4 superficies
(croma-horarios, croma-panel, `fichar.html`, `kiosco.html`) más croma-backend.

Apps Script Web Apps tienen un límite bajo de **ejecuciones simultáneas**. Con
uso real concurrente (varios empleados a la vez), las ejecuciones se amontonan
y generan timeouts/503 intermitentes — confirmado en vivo: la misma acción
(`accion=perfiles`) respondió entre 2.5s y 23s, y tiró 404 sin que se tocara
nada (2026-08-12). Ya se mitigó bastante (caché con `CacheService`, timeouts
más realistas, consolidar llamadas, sacar la descarga de recibos a Drive
directo) pero el techo de capacidad estructural sigue siendo el de GAS.

**La causa raíz no es Apps Script como lenguaje, es su modelo de ejecución
para Web Apps.** La API de Google Sheets (v4, REST) accede a las mismas hojas
sin ese límite de concurrencia — es la misma clase de fix que ya se hizo para
Recibos con Drive API (ver `../../../croma-backend/GOOGLE_DRIVE_SETUP.md`).

## 2. Principio rector: aditivo, reversible, nunca todo-o-nada

Mismo criterio que AVISOS (ver `AVISOS_API.md` §"Convivencia con
EVENTOS/ANUNCIOS"): **cada módulo se migra por separado**, la ruta vieja por
GAS sigue funcionando en paralelo hasta que la nueva está probada en
producción, y recién ahí se apaga el consumo viejo. En ningún momento hay un
big-bang. Si algo sale mal en la fase N, alcanza con no cortar el tráfico
hacia la ruta vieja de ese módulo — el resto de la app no se entera.

**Importante — esto NO es "solo cambiar el transporte":** hoy la lógica de
cada acción (armar el JSON de horarios desde las columnas de la hoja, validar
un perfil, calcular banco de horas, etc.) vive *adentro* de funciones de Apps
Script. Migrar un módulo implica **reescribir esa lógica en Node**, leyendo
las mismas filas crudas vía Sheets API. No es un simple find-and-replace de
URL — hay que portar cada función, con sus mismas reglas de negocio, y
probarla contra datos reales antes de cortar el tráfico viejo.

## 3. Arquitectura actual vs. destino

**Actual (todos los módulos):**
```
croma-horarios / croma-panel / fichar.html / kiosco.html
        │  fetch directo a script.google.com/macros/s/.../exec
        ▼
Apps Script (Code-Jornada.js) — doGet / despacharAccionSegura
        │  lee/escribe con SpreadsheetApp (límite de concurrencia acá)
        ▼
Google Sheets
```

**Destino, módulo por módulo migrado:**
```
croma-horarios / croma-panel / fichar.html / kiosco.html
        │  fetch a croma-backend (Node/Express) — /api/<modulo>/*
        ▼
croma-backend
        │  lee/escribe con Sheets API v4 (OAuth, sin límite de concurrencia)
        ▼
Google Sheets  (misma hoja, mismo formato — nadie tiene que aprender nada nuevo)
```

Los módulos **no migrados todavía** siguen exactamente en el camino actual.

## 4. Qué cambia / qué NO cambia

**No cambia:**
- La hoja de cálculo en sí — mismas columnas, mismos nombres, se puede seguir
  editando a mano en Sheets si hace falta (igual que hoy).
- Ningún dato histórico se mueve ni se transforma.
- El contrato JSON hacia el frontend, en lo posible — la idea es que las 4
  superficies apunten a una URL distinta (`croma-backend` en vez de
  `script.google.com`) pero reciban la misma forma de respuesta que ya
  esperan, para minimizar cambios de frontend.

**Sí cambia:**
- Quién ejecuta la lógica de lectura/escritura (Node en vez de Apps Script).
- El transporte (Sheets API REST en vez de exec URL de Apps Script).
- La autenticación de escritura pasa a vivir en croma-backend (mismo patrón
  OAuth ya armado para Drive), no en Script Properties de Apps Script.
- Frontend: cada superficie migrada deja de pegarle a la URL de GAS para ese
  módulo específico y pasa a pegarle a croma-backend.

## 5. Credenciales

Reusar el mismo Client ID OAuth "Desktop app" ya creado para Drive
(`GOOGLE_DRIVE_OAUTH_CLIENT_ID` en `croma-backend/.env`), pero con un refresh
token nuevo que incluya el scope de Sheets:

```
https://www.googleapis.com/auth/spreadsheets
```

(Se puede pedir junto con `drive.readonly` en una sola pantalla de
consentimiento si se rehace el flujo con ambos scopes — más prolijo que tener
dos refresh tokens separados. Repetir el flujo de
`scripts/obtener-refresh-token-drive.js`, adaptado, o generalizarlo para
aceptar una lista de scopes.)

## 6. Concurrencia de escritura

Apps Script usa `LockService.getScriptLock()` para evitar carreras entre
ejecuciones (ej. dos personas subiendo vacaciones al mismo período a la vez).
croma-backend es un único proceso Node de larga duración — alcanza con una
cola en memoria (ej. `async-mutex`, o una cola simple por hoja) que serialice
las escrituras a una misma hoja, sin necesidad de nada tan pesado como
`LockService`. Esto hay que implementarlo **antes** de migrar el primer módulo
que escribe (no hace falta para módulos de solo lectura).

## 7. Orden de migración sugerido (por módulo)

**Decisión (2026-08-13):** se prioriza arrancar directo por **Horarios** en
vez de por Perfiles — es lo que más se nota en el uso real (Portal Empleado),
y al revisar el código se confirmó que `accion=horarios` es **puramente de
lectura**: no existe ninguna acción que escriba en la hoja `DATOS GENERALES`
(los horarios se cargan a mano en la Sheet, o se completan vía fichadas, que
es un módulo aparte). Eso baja el riesgo de arrancar por acá — no hace falta
la cola de escrituras (§6) para esta pieza puntual, es tan "solo lectura"
como Perfiles, solo que con más volumen de tráfico y más columnas para
mapear. `guardar_perfil`/`guardar_categoria` (que antes estaban agrupadas acá
por error) en realidad escriben en `EMPLEADOS`/`CATEGORIAS` — se movieron a
la fase de Perfiles, donde corresponden.

| Fase | Módulo | Acciones GAS que reemplaza | Por qué en este orden |
|---|---|---|---|
| 0 | Infra | — | Cliente Sheets API en croma-backend + script de refresh token con scope de Sheets. Sin esto no arranca nada. |
| 1 | **Horarios** (solo lectura) | `horarios` | Mayor volumen de tráfico, el más pegado al síntoma reportado (Portal Empleado lento/en blanco) — y sin acción de escritura propia, así que arrancar por acá no requiere la cola de concurrencia (§6) todavía. |
| 2 | Perfiles + Categorías | `perfiles`, `guardar_perfil`, `guardar_categoria` | Primer módulo con escritura — acá sí hace falta la cola de concurrencia (§6), con volumen bajo para probarla primero. |
| 3 | Certificados | `cargar_certificados`, `guardar_certificado`, `borrar_certificado` | Mismo patrón que Perfiles, ya validado. |
| 4 | Config / Sucursales geo / Eventos | `get_config`, `guardar_config`, `get_eventos`, `guardar_evento`, `eliminar_evento`, `get_sucursales_geo` | Tráfico bajo, ya cacheados, riesgo bajo. |
| 5 | Vacaciones / Banco de horas | `get_vacaciones`, `solicitar_vac`, `responder_solicitud`, `get_solicitudes_vac`, `get_banco_horas*`, `ajustar_vac`, `inicializar_vac`, `agregar_vacacion_admin` | Más módulos interrelacionados, pero bien acotados. |
| 6 | Login de empleados / Identidad | `cargar_usuarios_interno` (vía `identidad.js`/`gas.js` en croma-backend) | Ya está cacheado y es lo menos urgente (login ya no es el cuello de botella principal). |
| 7 | Recibos (listado + subir + reemplazar) | `listar_recibos_empleado`, `subir_recibo`, `reemplazar_recibo` | La descarga ya se migró a Drive directo — cierra el círculo para que Recibos no dependa de GAS en absoluto. |
| 8 | Fichadas | `guardarFichada`, `get_fichadas_empleado`, `get_fichadas_hoy_local`, `acreditarBanco`, `usarBanco`, `ajustar_jornada` | Al final — es el registro legal de asistencia, se migra último y con más testing, cuando el patrón ya está maduro en 7 módulos. |
| ✅ | Avisos | `get_avisos*`, `guardar_aviso`, `editar_aviso`, `archivar_aviso`, `restaurar_aviso`, `marcar_aviso_leido` | **Migrado 2026-08-18** — `croma-backend/src/services/avisos-sheets.js`. Único resto de GAS: envío de emails (best-effort, acción nueva `enviar_emails_aviso`, sin lectura/escritura de hoja) — no hay SMTP propio en Node todavía. Ver `AVISOS_API.md`. |

Fichar.html y kiosco.html (los 2 kioscos) consumen varias de estas acciones
directo — cada fase que los toque tiene que actualizar esos dos archivos
también, no solo `croma-horarios-main/app.js`.

## 8. Cómo probar cada fase sin tocar producción

Mismo criterio que AVISOS §QA:
1. Escribir el endpoint nuevo en croma-backend, corriendo local en esta PC.
2. Probar con `curl` directo contra `localhost:3000` con un JWT de prueba,
   comparando la respuesta byte a byte (o campo a campo) contra la respuesta
   actual de GAS para la misma consulta.
3. Recién cuando la respuesta coincide, cambiar **un solo consumidor a la
   vez** (ej. primero croma-panel, después croma-horarios, después los
   kioscos) para que pegue a croma-backend en vez de a GAS, con la acción GAS
   original todavía funcionando en paralelo por si hay que revertir rápido
   (alcanza con revertir el cambio de URL en ese frontend puntual).
4. Dejar corriendo unos días antes de pasar a la fase siguiente.

## 9. Checklist de reversión por fase

Si algo falla después de cortar el tráfico de un módulo:
- [ ] Revertir el cambio de URL en el/los frontend(s) afectados (vuelven a
      pegarle a GAS — la acción vieja nunca se borró de `Code-Jornada.js`).
- [ ] No hace falta tocar datos — Sheets API y Apps Script leen/escriben la
      misma hoja, no hay migración de datos que deshacer.
- [ ] Recién retirar la acción vieja de `Code-Jornada.js` cuando el módulo
      lleve un tiempo largo estable en producción (semanas), no antes.

## 10. Riesgos / cosas a validar antes de escribir código

- **Formato de celdas:** Apps Script devuelve `Date` objects nativos para
  columnas de fecha; Sheets API v4 los devuelve como string formateado según
  el `valueRenderOption` elegido (`FORMATTED_VALUE` vs `UNFORMATTED_VALUE`) —
  hay que portar con cuidado la misma normalización que ya hacen funciones
  como `_normalizarPeriodoCelda()` en GAS.
- **Rate limits de Sheets API:** cuotas por proyecto/usuario (ajustables en
  Google Cloud Console) — mucho más altas que la concurrencia de Apps Script,
  pero no infinitas. Verificar cuota default antes de la Fase 5 (horarios,
  el módulo de mayor tráfico).
- **`registrarAuditoria()`:** hoy vive en Apps Script y escribe en la hoja
  `AUDITORIA` — si se migra un módulo que audita, hay que portar esa función
  también (o mantenerla como una llamada liviana a GAS solo para auditoría,
  best-effort, mismo patrón que ya se usó en la Fase de Recibos-Drive).
- **`kiosco.html` / `fichar.html`:** son HTML estáticos sin build step —
  confirmar que cualquier cambio de URL ahí se puede desplegar igual de fácil
  que hoy (GitHub Pages, subida directa).

## 11. Referencia — inventario completo de acciones actuales

Ver conversación del 2026-08-12 (o pedir el inventario de nuevo) para la
lista completa de qué acción usa cada una de las 4 superficies + croma-backend.
Resumen: prácticamente todo pasa por este único Apps Script salvo
autenticación de staff (SQLite propio) y stock/ventas (otra API, `croma-api`,
no relacionada).
