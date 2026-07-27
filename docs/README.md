# Documentación versionada · Croma Horarios

> **Creado:** 2026-07-27
> Esta carpeta (`croma-horarios-main/docs/`) contiene la documentación **versionada
> en git** específica de Croma Horarios, generada por el trabajo de administración
> unificada de empleados + acceso (Commits 1-5).

## Por qué existe esta carpeta

El resto de la documentación del ecosistema Croma (`ARCHITECTURE.md`,
`FILE_STRUCTURE.md`, el registro completo de ADRs, etc.) vive en `../../docs/`,
**un nivel por encima del repo**, y esa carpeta **no está bajo control de
versiones** (no es un repositorio git). Para que el trabajo de este commit quedara
versionado junto con el código que documenta, se creó esta copia local dentro de
`croma-horarios-main`, en vez de mover o sobrescribir la documentación compartida
existente.

**No se tocó nada de `../../docs/`** — los archivos `README.md` y `DECISIONS.md`
de esta carpeta son específicos de este repo, no reemplazos de los compartidos.

## Contenido

| Archivo | Qué contiene |
|---|---|
| [ADMIN-EMPLEADOS-ACCESO.md](./ADMIN-EMPLEADOS-ACCESO.md) | Arquitectura, seguridad, operación y despliegue de la administración unificada de empleados + acceso |
| [DECISIONS.md](./DECISIONS.md) | Extracto versionado: solo el ADR-035 (la decisión específica de este trabajo), no el registro completo de ADRs del ecosistema |

## Mantenimiento

Si se edita alguno de estos dos archivos, replicar el cambio también en la copia
compartida (`../../docs/ADMIN-EMPLEADOS-ACCESO.md`, `../../docs/DECISIONS.md` §
ADR-035) para que no queden desincronizadas. No hay automatización para esto
todavía — es manual.
