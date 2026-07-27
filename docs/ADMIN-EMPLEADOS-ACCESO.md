# Administración unificada: Empleados + Acceso · Croma Horarios

> **Versión:** 1.2.0 · **Creado:** 2026-07-27 · **Última actualización:** 2026-07-27
> Documenta el trabajo de los Commits 1-5 (backend Node, GAS, frontend, pruebas,
> retiro del guardado legado de usuarios).
>
> **Esta es la copia versionada dentro del repo `croma-horarios-main`** (el único
> de los dos repos afectados por este trabajo — `croma-backend` es un repo aparte
> sin copia propia de esta documentación). El documento original vive en
> `../../docs/ADMIN-EMPLEADOS-ACCESO.md`, **fuera de cualquier repositorio git**
> (esa carpeta `docs/` de nivel superior no está versionada). Esta copia es la
> fuente de verdad versionada; mantenerlas sincronizadas a mano si se edita una.
>
> Ver también `../../docs/ARCHITECTURE.md`, `../../docs/DECISIONS.md` (ADR-035,
> también resumido en [DECISIONS.md](./DECISIONS.md) de esta misma carpeta).

> **Estado:** implementado y probado localmente. **Todavía no desplegado ni
> pusheado** a ninguno de los dos repos (`croma-backend`, `croma-horarios-main`) al
> momento de escribir esto. Ver [Despliegue](#despliegue) para el orden exacto.

---

## Índice

1. [Arquitectura](#arquitectura)
2. [Seguridad](#seguridad)
3. [Operación](#operación)
4. [Despliegue](#despliegue)
5. [Fuera de alcance (pendiente, no implementado)](#fuera-de-alcance-pendiente-no-implementado)

---

## Arquitectura

### EMPLEADOS como entidad principal

El **empleado** es la entidad principal de la administración de personal en Croma
Horarios. Vive en la hoja `EMPLEADOS` del Sheet de Horarios, con estas columnas
(las últimas tres agregadas por este trabajo):

`NOMBRE | EMPRESA | CATEGORIA | HS_BASE | FOTO_URL | ACTIVO | REGLA_CUSTOM | FECHA_INGRESO | SUCURSAL_ID | NUMERO_VENDEDOR_SYSNEO | CELULAR | ESTADO`

Un empleado puede existir **sin acceso a Croma Horarios** — es el caso por defecto.

**Fuente del listado administrativo:** `EMPLEADOS` tiene prioridad, con los nombres
históricos de la hoja `DATOS GENERALES` (el cronograma de turnos) como
compatibilidad — un empleado creado desde el formulario nuevo **sin turnos
cargados todavía** aparece igual en Administración. Las vistas operativas (Semana,
Mes, Calendario) **no** pasan por esta fuente combinada: siguen leyendo
`DATOS GENERALES` directo, sin cambios, tal como decidido en el diseño original.
Ver `obtenerEmpleadosAdmin()` en `app.js`.

### USUARIOS como acceso opcional

El **acceso** (usuario + PIN para loguearse en Croma Horarios) vive en la hoja
`USUARIOS`: `NOMBRE | PIN | ROL | EMPLEADO_NOMBRE | CELULAR | ESTADO | FIN_ACCESO`.

**Relación:** un empleado puede tener **como máximo un** registro de acceso, activo
o inactivo (uno a uno). Reactivar el acceso reutiliza la misma fila — nunca se crea
un segundo usuario para el mismo empleado.

### Vinculación por nombre normalizado

Todavía **no existe un `empleado_id`** ni ningún identificador estable. El vínculo
empleado↔usuario, y la deduplicación EMPLEADOS↔DATOS GENERALES, se hacen comparando
el nombre **normalizado**: `trim()` + espacios múltiples colapsados + minúsculas
(`_normalizarNombreEmpleado` en GAS, `_normalizarNombreEmpleadoJS` en el frontend).
La normalización es **solo para comparar** — el valor guardado en la hoja nunca se
reescribe a partir de la versión normalizada.

**Limitación actual: no se puede renombrar a un empleado** desde el formulario
unificado. El campo Nombre queda `readonly` al editar, con el texto: *"El nombre no
puede modificarse desde esta pantalla porque está vinculado a registros
históricos."* Motivo: `NOMBRE` es la clave implícita en Usuarios, Fichadas,
Certificados, Vacaciones, Banco de horas y Cronogramas — renombrar rompería todos
esos vínculos. Una función de renombrado masivo (que actualice todas las hojas a la
vez) queda fuera de alcance.

### Número de vendedor Sysneo — referencia local independiente

`NUMERO_VENDEDOR_SYSNEO` es un campo **opcional y local**. Se muestra con estado
visual **Pendiente** (vacío) o **Asignado** (con badge `badge-info`). Reglas:

- No se valida contra Sysneo — Croma Horarios **nunca se conecta** a Sysneo.
- Único **localmente** (server-side, en GAS) cuando tiene valor — error explícito
  si ya está asignado a otro empleado.
- No participa en login ni en cronogramas.
- El prefijo numérico que ya tienen algunos nombres históricos (p. ej.
  `"40 FRAN PACHADO"`) **no tiene relación** con este campo — es una convención de
  texto libre preexistente, nunca interpretada ni reescrita por este trabajo.

---

## Seguridad

### Cadena de llamadas: Navegador → Node → GAS

```
Navegador (JWT) → croma-backend (Node) → Google Apps Script (Code-Jornada.js)
```

El navegador **nunca** llama a las acciones sensibles de GAS directo. Todas las
rutas de administración de empleados/acceso pasan por `croma-backend`
(`/api/empleados/*`, `/api/mi-perfil/pin`), protegidas con `verificarJWT` +
`requiereRol('admin','jefe')` (excepto `/api/mi-perfil/pin`, que acepta cualquier
rol autenticado pero solo permite cambiar el PIN propio — el nombre de usuario sale
del JWT, nunca del body).

### JWT y roles

- El JWT lo emite `croma-backend` (`/auth/login`, `/auth/pin-login`), firmado con
  `JWT_SECRET`.
- Roles: `admin`, `jefe` (acceso administrativo completo), `empleado` (acceso
  propio únicamente).
- El middleware `requiereRol(...)` en `croma-backend/src/middlewares/auth.js`
  aplica la restricción en cada ruta.

### BACKEND_SECRET — solo Node/GAS, nunca el navegador

`GAS_BACKEND_SECRET` (Node, en `.env`) / `BACKEND_SECRET` (GAS, en Script
Properties) es el mismo valor en ambos lados. Se manda **siempre por POST, en el
body** (`clave_backend`), nunca en query string. Confirmado en la inspección de
red y de `localStorage`/`sessionStorage` del navegador (Commit 4): el secreto no
aparece en ningún lugar accesible desde el cliente.

GAS rechaza con `{ ok:false, error:"No autorizado" }` si el secreto:
- no está configurado en ese entorno,
- llega vacío,
- no coincide.

### PIN no expuesto al frontend

- El PIN **nunca** se devuelve en ninguna respuesta que llegue al navegador. El
  listado admin (`GET /api/empleados/usuarios`) devuelve `pin_length` en vez de
  `pin`.
- Al editar un acceso existente, el campo PIN nunca se precarga — hay que tocar
  explícitamente "Cambiar PIN" para escribir uno nuevo. Vacío = conservar el
  actual.
- El cambio de PIN propio (`POST /api/mi-perfil/pin`) valida el PIN actual
  **enteramente en GAS** — nunca se compara en el cliente ni se descarga la lista
  de usuarios para eso.
- Auditoría (hoja `AUDITORIA`): sanitización **recursiva** — cualquier campo
  llamado `pin`, `pin_actual`, `pin_nuevo`, `pin_hash`, `password`, `token`,
  `authorization` o `clave_backend`, a cualquier profundidad del objeto, se
  reemplaza por `'[omitido]'` antes de escribir la fila. Los eventos
  `PIN_CAMBIADO` además mandan `null` explícito como antes/después (doble
  resguardo), y `INTENTO_BLOQUEADO_GUARDAR_USUARIOS` nunca registra el contenido
  del intento, solo si traía el parámetro `datos` o no.
- Se purga cualquier cache viejo de `localStorage.croma_usuarios_cache` (que
  guardaba PIN en texto plano) al cargar la app, tanto en `app.js` como en
  `fichar.html` (pantalla de fichaje GPS, corregida en el Commit 4 — tenía su
  propia copia de este problema, independiente de `app.js`).

### Acciones legadas pendientes

| Acción | Estado | Riesgo residual |
|---|---|---|
| `cargar_usuarios` (GAS, GET) | **Sigue existiendo por compatibilidad interna** — no se retiró, a diferencia de `guardar_usuarios`. **Node puede seguir usándola** (y la usa: `cargarUsuariosInterno()` la llama con `clave_backend` para el login por PIN, con secreto válido devuelve la lista completa incluido el PIN, que Node nunca reenvía tal cual al navegador). **Desde el navegador queda bloqueada**: sin `BACKEND_SECRET` responde `{ ok:false, error:"No autorizado" }`, sin lista ni PIN. | Bajo — el único cliente autorizado (Node) nunca expone el secreto; sin él, cualquier otro llamador queda bloqueado. |
| `guardar_usuarios` (GAS) | **Retirada en el Commit 5** (`fix(seguridad): retirar guardado legado de usuarios`). Ya no parsea el payload ni toca la hoja `USUARIOS` bajo ninguna circunstancia — responde siempre `{ ok:false, error:"Acción obsoleta. Utilice la API protegida." }` y audita el intento (sin datos sensibles). Se conserva la acción reconocida en el router por compatibilidad nominal únicamente. | Resuelto. `clearContents()` ya no es alcanzable desde ninguna acción del archivo (verificado por test que barre el archivo completo). |
| PIN en texto plano en la hoja `USUARIOS` | Sin cambios — **fuera de alcance explícito** de este trabajo (ver [Fuera de alcance](#fuera-de-alcance-pendiente-no-implementado)). | Medio-alto, preexistente. Requiere una migración a `PIN_HASH` coordinada aparte. |

---

## Operación

### Cómo crear un empleado

1. Administración → pestaña Empleados → **"+ Nuevo empleado"**.
2. Completar Nombre (obligatorio) en la pestaña Perfil.
3. Completar Sucursal, Empresa, Categoría, Fecha de ingreso, Número Sysneo
   (opcional) en Datos laborales.
4. Si además va a tener acceso: pestaña Acceso → activar "Crear acceso para este
   empleado" → completar usuario y PIN.
5. Guardar. Si el acceso falla pero el empleado se creó, ver
   [empleado_creado_acceso_fallido](#qué-hacer-ante-empleado_creado_acceso_fallido).

### Cómo crear acceso (a un empleado que ya existía sin uno)

Desde la tabla: botón **"Crear acceso"** en la fila del empleado → completar
usuario y PIN → Guardar. Internamente usa `POST /api/empleados/:nombre/acceso`
(no vuelve a crear el empleado).

### Cómo desactivar / reactivar

- **Desactivar:** botón "Desactivar" en la fila (pide confirmación) → el empleado
  sigue existiendo y activo, solo pierde el acceso a la app.
- **Reactivar:** botón "Reactivar" en la fila del empleado con acceso inactivo —
  reutiliza el mismo registro de usuario (mismo PIN que tenía).

### Cómo cambiar PIN

- **Como admin:** botón "Cambiar PIN" en la fila, o desde la ficha del empleado
  (pestaña Acceso → "Cambiar PIN"). No requiere conocer el PIN anterior.
- **Desde Mi Perfil** (el propio empleado): botón Mi Perfil → completar PIN
  actual + PIN nuevo + repetir. Se valida el PIN actual server-side.

### Cómo asignar número Sysneo

Botón "Asignar Sysneo" en la fila de la tabla (acción rápida, no requiere abrir
la ficha completa), o desde la pestaña Datos laborales de la ficha del empleado.
Error explícito si el número ya está usado por otro empleado.

### Qué hacer ante `empleado_creado_acceso_fallido`

Si al crear un empleado con acceso el backend responde
`{ ok:false, estado:"empleado_creado_acceso_fallido", empleado_guardado:true, usuario_creado:false, error:"..." }`:

- El **empleado ya quedó guardado** — no hay que volver a crearlo.
- La app muestra el mensaje específico y reabre la ficha del empleado en la
  pestaña Acceso para reintentar solo esa parte.
- Causas típicas: username duplicado, PIN vacío o demasiado corto.

---

## Despliegue

Orden verificado contra la compatibilidad real del código (no es el orden
"lógico" ingenuo — ver la justificación de cada paso):

1. **Backup** de la Sheet completa y del `.env` actual de `croma-backend`.
2. **Configurar `GAS_BACKEND_SECRET`** en el `.env` de `croma-backend` (generar
   con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
3. **Configurar el mismo valor como `BACKEND_SECRET`** en Script Properties de
   Apps Script (editor de GAS → Configuración del proyecto → Propiedades de
   secuencia de comandos).
4. **Desplegar GAS** (Code-Jornada.js → "Implementar" → nueva versión, **mantiene
   la URL**). A partir de acá, `cargar_usuarios` sin secreto empieza a devolver
   `No autorizado`, y `guardar_usuarios` deja de aceptar escrituras
   incondicionalmente (siempre respondía `Acción obsoleta`, sin excepción, desde
   este deploy en adelante).
5. **Desplegar Node** (`croma-backend`) — reiniciar el servicio para que tome el
   `GAS_BACKEND_SECRET` nuevo y las rutas `/api/empleados/*` y `/api/mi-perfil/pin`.
   **Importante:** los pasos 4 y 5 deben quedar lo más juntos posible en el tiempo
   — entre que GAS empieza a exigir el secreto y Node lo manda, el login por PIN
   (`/auth/login`, `/auth/pin-login`, y el de `fichar.html`) puede fallar
   intermitentemente si un empleado intenta loguearse justo en esa ventana.
6. **Desplegar frontend** (`app.js`, `fichar.html`) — subir todos los archivos
   modificados juntos (regla de deploy de GitHub Pages ya establecida).
7. **Pruebas smoke** en producción, en este orden: login staff, login PIN desde
   el Hub, login desde `fichar.html`, listar empleados en Administración, crear
   un empleado de prueba **con nombre claramente marcado** (ej. `"ZZZ Prueba
   Despliegue"`) sin acceso, verificar que aparece, editarlo, borrarlo a mano de
   la Sheet al terminar (no hay borrado desde la UI, es intencional).
8. **Monitoreo:** revisar la hoja `AUDITORIA` después de las pruebas smoke — debe
   tener las filas esperadas (`EMPLEADO_CREADO`, etc.) y **cero** apariciones de
   la palabra `pin` en las columnas `DATOS_ANTERIORES`/`DATOS_NUEVOS`.
9. **Rollback si falla:** cada paso es reversible de forma independiente — GAS
   por redeploy de la versión anterior (Apps Script guarda versiones), Node
   revirtiendo el commit y reiniciando, frontend resubiendo los archivos
   anteriores. `cargar_usuarios` sin secreto sigue existiendo en modo degradado
   (responde `No autorizado`, no un error de ruta); `guardar_usuarios` queda
   retirada de forma permanente independientemente del estado del resto — un
   rollback parcial del frontend no deja el sistema sin forma de gestionar
   usuarios (las rutas nuevas de Node siguen disponibles).

### Por qué este orden y no otro

- Node **sí puede** enviar `GAS_BACKEND_SECRET` a un GAS que todavía no lo pide —
  es compatible: el GAS viejo simplemente ignora ese campo extra en el body, sin
  romper nada. Por eso Node puede desplegarse (o arrancar con el secreto ya
  configurado) antes que GAS sin ningún efecto adverso.
- GAS, una vez desplegado, empieza a **exigir** el secreto — recién ahí importa
  que Node ya lo esté mandando. Si Node no lo manda todavía en ese momento, el
  login por PIN se corta. Por eso los pasos 4-5 van pegados: no porque Node no
  pueda mandarlo antes, sino porque GAS es el que activa la exigencia.
- El frontend va último porque depende de que las rutas Node (`/api/empleados/*`)
  ya respondan con datos reales, no con 502 (que es lo que devuelven hoy, contra
  el GAS todavía no desplegado — comportamiento esperado y ya verificado).

---

## Fuera de alcance (pendiente, no implementado)

Documentado explícitamente para no perderlo de vista, **sin ampliar el alcance
de este trabajo**:

- **Edición self-service de celular** (que el propio empleado edite su celular
  desde Mi Perfil) — no hay ruta aprobada para eso; las 7 rutas de
  `/api/empleados/*` son todas admin/jefe. Mi Perfil hoy solo muestra el celular
  de lectura, con nota de que lo edite un admin.
- **Cambio de username** en un acceso ya creado — el campo queda `readonly` al
  editar; no hay endpoint para renombrarlo sin mandar también un PIN nuevo.
- **`empleado_id`** — la vinculación sigue siendo por nombre normalizado. Migrar
  a un ID real es un cambio más grande (afecta Fichadas, Certificados,
  Vacaciones, Banco de horas) que no se emprendió acá.
- **`PIN_HASH`** — el PIN sigue en texto plano en la hoja `USUARIOS`. La columna
  puede reservarse a futuro pero no se implementa lógica de hash parcial en esta
  versión (ver tabla de [acciones legadas pendientes](#seguridad)).
- **Migración completa fuera de Google Sheets** — no evaluada acá.
- **Integración en tiempo real con Sysneo** — explícitamente descartada por
  diseño: el número de vendedor es una referencia local, sin conexión ni
  validación contra Sysneo, y así debe seguir.

---

## Documentación relacionada (dentro de este repo)

[DECISIONS](./DECISIONS.md) · [README](./README.md)

Documentación general compartida del ecosistema (fuera de este repo, no
versionada en git): `../../docs/README.md`, `../../docs/ARCHITECTURE.md`,
`../../docs/DECISIONS.md`, `../../docs/FILE_STRUCTURE.md`.
