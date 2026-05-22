# Croma · Panel de Horarios

Panel web para visualizar los horarios de empleados de todas las sucursales Croma, conectado en tiempo real a los Google Sheets de cada local.

## Archivos

| Archivo | Descripción |
|---|---|
| `index.html` | Estructura principal del panel |
| `style.css` | Estilos y diseño |
| `app.js` | Lógica, conexión a Sheets, renders |
| `apps-script.js` | Código que va en cada Google Sheet |

---

## Configuración paso a paso

### 1. Google Sheet de cada sucursal

El panel espera que cada Sheet tenga una hoja llamada **`Respuestas de formulario 1`** con estas columnas (en cualquier orden):

```
LOCAL | AÑO | MES | DIA | MARCA TEMPORAL | EMPLEADO | H. ENTRADA | H. SALIDA | NOTA | TOTAL HS
```

### 2. Instalar el Apps Script en cada Sheet

1. Abrí el Google Sheet de la sucursal
2. Ir a **Extensiones → Apps Script**
3. Borrá el código existente y pegá todo el contenido de `apps-script.js`
4. Si el nombre de tu hoja es distinto a `Respuestas de formulario 1`, cambiá la constante `NOMBRE_HOJA` al inicio del script
5. Guardá (Ctrl+S)
6. Clic en **Implementar → Nueva implementación**
   - Tipo: **Aplicación web**
   - Ejecutar como: **Yo**
   - Acceso: **Cualquier persona**
7. Autorizá los permisos (es normal que diga "no verificada", igual continuá)
8. Copiá la URL generada — la vas a necesitar en la web

Repetí este proceso para cada una de las 6 sucursales.

### 3. Configurar la web

1. Abrí la web en tu navegador
2. En la pantalla de configuración, pegá la URL de Apps Script de cada sucursal
3. Clic en **Conectar y ver horarios**
4. Las URLs quedan guardadas en el navegador — no hace falta ingresarlas de vuelta

---

## Sucursales

| ID | Nombre |
|---|---|
| 01 | PASEO |
| 05 | WAVE |
| 09 | CIPO SAN MARTIN |
| 10 | PERITO MORENO |
| 12 | CENTENARIO |
| 14 | ROCA |

---

## Funcionalidades

- **Vista semana** — grilla por sucursal con turnos Mañana / Tarde / Completo / Franco / Falta
- **Vista empleados** — tarjetas con horas, días trabajados y promedio por día
- **Vista reportes** — ranking de horas, cobertura por sucursal, empleados sin turno
- **Navegación semanal** — semana anterior / siguiente
- **Filtros** — por sucursal, empleado y tipo de turno
- **Actualización manual** — botón refresh para traer datos nuevos
- **Impresión** — botón para imprimir la grilla de la semana

---

## Notas técnicas

- Los datos se cargan al iniciar, al presionar refresh y cada 5 min hay auto-refresh
- Las URLs de conexión se guardan en `localStorage` del navegador
- El modo demo funciona sin conexión para mostrar el panel con datos de ejemplo
- Compatible con Chrome, Firefox y Edge modernos
