# AVISOS — Referencia técnica de API

> **2026-08-18 — Migrado a Sheets API directa.** AVISOS ya no depende de
> Apps Script salvo para el envío de emails (ver Flujo). El frontend real
> (`croma-calendario-main`, separado de `croma-horarios-main` el mismo día)
> consume esto vía `/api/avisos/mios`. `EVENTOS`/`ANUNCIOS` siguen sin
> tocarse, en paralelo, ajenos a este módulo.

## Flujo

```
Frontend (croma-calendario-main)
        │  fetch con Authorization: Bearer <JWT>
        ▼
croma-backend (Node/Express)  — /api/avisos/*, /api/avisos/mios
        │  verificarJWT + requiereRol('admin','jefe','horarios') (gestión)
        │  services/avisos-sheets.js — lee/escribe la hoja AVISOS directo
        │  vía Sheets API v4 (services/sheets.js), cola de escritura en
        │  memoria por hoja (services/sheets-cola-escritura.js)
        ▼
Google Sheets — hoja AVISOS / AVISOS_LEIDOS
```

Única dependencia de Apps Script que le queda a este módulo: el envío de
emails del canal `email` (no hay SMTP propio en croma-backend todavía) —
`services/avisos-sheets.js` llama a la acción GAS `enviar_emails_aviso`
(nueva, sin lectura/escritura de hoja) de forma best-effort, fire-and-forget,
después de crear el aviso. Un fallo ahí nunca revierte la creación.

Las acciones viejas de GAS (`guardar_aviso`, `editar_aviso`, etc., en
`Code-Jornada.js`) se dejaron intactas sin usar — mismo criterio de
reversibilidad que el resto de `docs/PLAN-SHEETS-API-DIRECTA.md`: no se
retira código viejo hasta que lo nuevo lleve un tiempo largo estable.

## Permisos

Todas las rutas de `/api/avisos` requieren JWT válido con rol `admin` o `jefe`
(`verificarJWT`, `requiereRol('admin', 'jefe')`). Un JWT de rol `empleado`
recibe `403`. Sin JWT, `401`.

## Endpoints (croma-backend)

| Método | Ruta | Acción GAS | Rate limit |
|---|---|---|---|
| GET | `/api/avisos` | `get_avisos` | — |
| GET | `/api/avisos/:id` | `get_aviso` | — |
| POST | `/api/avisos` | `guardar_aviso` | 60 / 15 min |
| PUT | `/api/avisos/:id` | `editar_aviso` | 60 / 15 min |
| POST | `/api/avisos/:id/archivar` | `archivar_aviso` | 60 / 15 min |
| POST | `/api/avisos/:id/restaurar` | `restaurar_aviso` | 60 / 15 min |

### `POST /api/avisos` — crear

**Request**
```json
{
  "tipo": "local_cerrado",
  "titulo": "LOCAL CERRADO",
  "mensaje": "El local permanecerá cerrado por refacciones.",
  "fecha_desde": "2026-08-10",
  "fecha_hasta": "2026-08-10",
  "destinatarios": { "modo": "sucursal", "ids": ["01", "05"] },
  "canales": { "calendario": true, "banner": true, "email": true, "whatsapp": false },
  "prioridad": "normal"
}
```

**Response 200**
```json
{ "ok": true, "aviso": { "id": "AVI-...", "...": "...", "version": 1 } }
```

**Response 400** (validación Node, antes de llamar a GAS)
```json
{ "ok": false, "error": "Datos inválidos", "errores": { "titulo": "El título es obligatorio." } }
```

**Response 200 con `ok:false`** (validación GAS — puede detectar reglas que Node no chequea, ej. sucursal inexistente)
```json
{ "ok": false, "error": "Datos inválidos", "errores": { "destinatarios": "Hay una sucursal inválida en la selección." } }
```

### `PUT /api/avisos/:id` — editar

Igual body que crear, pero **parcial**: solo los campos presentes se
actualizan, el resto conserva su valor. La validación en GAS corre sobre el
resultado **mergeado** (existente + cambios), no solo sobre el diff — no es
posible dejar una fila en un estado inconsistente (ej. mandar solo
`{ "destinatarios": { "modo": "todos" } }` sobre un aviso `local_cerrado`
existente es rechazado, porque el merge resultante viola la regla "local
cerrado siempre usa Sucursal(es)").

### `POST /api/avisos/:id/archivar` / `POST /api/avisos/:id/restaurar`

Sin body. Alternan el campo `archivado`. Nunca hay borrado físico — no existe
un `DELETE`.

### `GET /api/avisos`

```json
{ "ok": true, "avisos": [ { "id": "...", "tipo": "...", "titulo": "...", "mensaje": "...",
  "fecha_desde": "...", "fecha_hasta": "...", "destinatarios": {...}, "canales": {...},
  "prioridad": "normal", "archivado": false, "autor": "...", "fecha_creacion": "...",
  "modificado_por": "...", "fecha_modificacion": "...", "version": 1 } ] }
```

Devuelve **todas** las filas, sin filtrar por rol ni por sucursal — ese
filtrado (tabs de sucursal, regla de "Administración siempre visible", etc.)
sigue siendo responsabilidad del cliente que consuma esto, igual que lo es
hoy con `get_eventos`/`get_anuncios`. `estado` (activo/programado/vencido)
**no viaja** — se deriva de `fecha_desde`/`fecha_hasta` contra la fecha
actual, del lado de quien consume.

## Errores

| Código | Cuándo |
|---|---|
| 400 | Payload inválido (Node) — `errores` con detalle por campo |
| 401 | Sin JWT o JWT inválido/expirado |
| 403 | JWT válido pero rol no autorizado (`empleado`) |
| 404 (dentro de un 200, `ok:false`) | `id` no encontrado — GAS no distingue HTTP 404, responde `{ ok:false, error:'Aviso no encontrado' }` con status 200, igual criterio que el resto de las acciones de este backend |
| 502 | GAS no disponible o error inesperado |

## Modelo de datos — hoja `AVISOS`

```
ID | TITULO | MENSAJE | TIPO | FECHA_DESDE | FECHA_HASTA | DESTINATARIOS |
CANALES | PRIORIDAD | ARCHIVADO | AUTOR | FECHA_CREACION | MODIFICADO_POR |
FECHA_MODIFICACION | VERSION
```

- `DESTINATARIOS` y `CANALES` viajan como JSON string dentro de la celda.
- `TIPO` ∈ `informacion | evento | local_cerrado`.
- `DESTINATARIOS.modo` ∈ `todos | sucursal | empleado | administracion | personal`.
  `local_cerrado` **solo** admite `modo:'sucursal'` (nunca `'todos'` — un
  cierre que afecte a todas las sucursales se expresa seleccionándolas
  explícitamente, no con el atajo `'todos'`, que es reservado para
  comunicados generales).
  - `personal` (agregado 2026-08-18): visible ÚNICAMENTE para la cuenta
    que lo creó (`AUTOR === identidad.usuario`) — ni siquiera otro
    admin/horarios lo ve al consultar `GET /api/avisos/mios`. No depende
    de rol ni de sucursal, solo de autoría. Pensado para marcar algo en
    el calendario propio sin que se le avise a nadie más.
- `PRIORIDAD` ∈ `normal | urgente`.
- `ARCHIVADO` es el único estado que se persiste. `activo/programado/vencido`
  se derivan siempre de las fechas — nunca se guardan, para que no puedan
  desincronizarse del dato real.
- `VERSION`: entero, arranca en 1, se incrementa en cada escritura sobre una
  fila existente (editar/archivar/restaurar). **No** se usa todavía para
  optimistic locking ni ninguna validación — es preparación para el futuro
  (auditoría rápida, comparación de registros, estrategias de concurrencia).

## Acciones Apps Script (`despacharAccionSegura`)

Todas requieren el sobre `{ accion, clave_backend, datos }` — nunca se llaman
directo desde el navegador.

| Acción | Datos | Efecto |
|---|---|---|
| `get_avisos` | — | Lista completa |
| `get_aviso` | `{ id }` | Un aviso |
| `guardar_aviso` | `{ actor, titulo, mensaje, tipo, fecha_desde, fecha_hasta, destinatarios, canales, prioridad }` | Crea, `version:1`, audita `AVISO_CREADO` |
| `editar_aviso` | `{ actor, id, ...campos a cambiar }` | Edita (parcial), `version++`, audita `AVISO_EDITADO` |
| `archivar_aviso` | `{ actor, id }` | `archivado:true`, `version++`, audita `AVISO_ARCHIVADO` |
| `restaurar_aviso` | `{ actor, id }` | `archivado:false`, `version++`, audita `AVISO_RESTAURADO` |
| `debug_resolver_destinatarios` | `{ destinatarios, canales, sucursal_id }` | **Solo QA** — ejecuta los helpers puros de resolución y devuelve el resultado, sin tocar la hoja. Ver [QA](#qa) |

Toda mutación usa `LockService.getScriptLock()` (evita carreras — Sheets no
tiene transacciones) y termina en `registrarAuditoria()`, sobre la misma hoja
`AUDITORIA` que ya usan las acciones de Empleados/Acceso.

## QA — validar sin depender del frontend

Regla del proyecto: todo helper complejo debe poder validarse
independientemente del frontend. Para AVISOS:

1. **Helpers puros** (`_resolverVisibleEnSucursal`, `_resolverCanalesActivos`,
   `_validarDatosAviso`) no tienen efectos secundarios ni dependen de
   `SpreadsheetApp` — se pueden copiar y correr con `node` directo (así se
   validaron en esta fase, 19 casos cubriendo las reglas de tabs/destinatarios
   ya cerradas en el diseño de producto).
2. **Acción `debug_resolver_destinatarios`**: llamar por POST directo a la
   URL de Apps Script con el sobre `{ accion:'debug_resolver_destinatarios',
   clave_backend:'<secreto>', datos:{ destinatarios, canales, sucursal_id } }`
   — devuelve `visible_en_sucursal` y `canales_activos` sin tocar ninguna
   hoja, para probar la lógica de resolución contra el GAS real.
3. **CRUD completo**: `curl` directo contra `croma-backend` local con un JWT
   de prueba (`admin`/`jefe`) cubre crear → editar → archivar → restaurar →
   listar sin necesidad de levantar el frontend.

## Convivencia con EVENTOS/ANUNCIOS

`EVENTOS` y `ANUNCIOS` no fueron tocados por esta fase — mismas hojas, mismas
funciones, mismo `doGet` sirviéndolas igual que siempre. `AVISOS` es
enteramente aditivo. El reemplazo real (frontend consumiendo esta API,
migración de datos, retiro de Eventos/Anuncios) queda para fases
posteriores.
