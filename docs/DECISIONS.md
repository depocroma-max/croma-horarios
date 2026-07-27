# Decisiones Técnicas (ADR) · Croma Horarios — extracto versionado

> **Versión:** 1.0.0 · **Creado:** 2026-07-27 · **Última actualización:** 2026-07-27

> **Esto NO es el registro completo de ADRs del ecosistema Croma.** El registro
> completo (ADR-001 a ADR-034, decisiones compartidas por todas las apps: stack,
> Design System, PWA, etc.) vive en `../../docs/DECISIONS.md`, **fuera de
> cualquier repositorio git** — esa carpeta `docs/` de nivel superior no está
> versionada. No se copió ni se movió ese archivo acá para no duplicar ni
> desincronizar la fuente compartida.
>
> Este archivo contiene **únicamente** el ADR específico de Croma Horarios que
> este trabajo (Commits 1-5) agregó al registro completo, para que quede
> versionado en el repo que realmente cambió. Es un extracto — si se edita el
> ADR-035 acá, replicar el cambio también en `../../docs/DECISIONS.md`.

---

## ADR-035 · Empleados como entidad principal, Usuarios como acceso opcional

- **Fecha:** 2026-07-27 · **Estado:** Aceptada
- **Contexto:** Croma Horarios manejaba la creación de empleados y la creación de
  usuarios de acceso (login PIN) como dos flujos separados, sin relación forzada,
  con `guardar_usuarios` (GAS) reescribiendo toda la hoja `USUARIOS`
  (`clearContents()`) en cada guardado, y `cargar_usuarios` devolviendo PIN en
  texto plano sin ningún control de acceso.
- **Decisión:** el **empleado** pasa a ser la entidad principal (hoja `EMPLEADOS`);
  el **acceso** (hoja `USUARIOS`) es una capacidad opcional, uno-a-uno por nombre
  normalizado (sin `empleado_id` todavía). Toda mutación de acceso pasa por
  `croma-backend` (JWT + `requiereRol`) y de ahí a acciones GAS nuevas protegidas
  por `BACKEND_SECRET`, con operaciones puntuales por fila (sin `clearContents()`)
  y auditoría con sanitización recursiva de PIN/hash/token. El número de vendedor
  Sysneo se agrega como referencia local, sin integración con Sysneo.
- **Consecuencias:** ✅ un administrador puede crear un empleado sin acceso, crear
  el acceso después, desactivarlo sin borrar al empleado, y reactivarlo
  reutilizando el mismo registro. ✅ el PIN deja de exponerse por `cargar_usuarios`
  sin secreto. ✅ se mantiene compatibilidad completa con `guardar_perfil` y
  `cargar_usuarios` (contratos sin cambios). ✅ `guardar_usuarios` se retiró por
  completo en un fix de seguridad posterior (Commit 5) — ya no acepta escrituras
  bajo ninguna circunstancia, se mantiene solo por compatibilidad nominal del
  nombre de la acción. ⚠️ el PIN sigue en texto plano en la hoja (migración a
  `PIN_HASH` fuera de alcance). ⚠️ sin `empleado_id`, un futuro renombrado masivo
  de empleados sigue siendo un cambio grande no implementado.

Detalle completo de arquitectura, seguridad, operación y despliegue en
[ADMIN-EMPLEADOS-ACCESO.md](./ADMIN-EMPLEADOS-ACCESO.md) (esta misma carpeta).

---

## Documentación relacionada (dentro de este repo)

[ADMIN-EMPLEADOS-ACCESO](./ADMIN-EMPLEADOS-ACCESO.md) · [README](./README.md)
