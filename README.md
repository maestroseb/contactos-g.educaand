# Asistente de Contactos — Web App (v4)

Web App de Apps Script que sustituye a la hoja madre/hija, pensada para
**distribuirse por centros**: cada centro copia la plantilla, su administrador
la despliega y **un asistente lo configura todo desde la web** — sin tocar
ninguna hoja de cálculo.

Dos vistas según quién entra:

- **Administrador** (se detecta solo en el primer despliegue) → asistente de
  configuración y gestión del claustro.
- **Profesorado** → sincroniza los contactos del centro y/o los suyos en **su**
  cuenta de Google Contacts, con opción diaria.

## Modelo de distribución (copia por centro)

- La **plantilla** es un **proyecto standalone** de Apps Script (sin hoja de
  cálculo asociada). Cada admin hace una **copia** → pasa a ser el dueño y, al
  desplegar por primera vez, queda registrado como administrador de su centro.
- **No hay hoja que editar ni ID que configurar**: toda la información (centro,
  especialidades, etiquetas, claustro y contactos) se guarda en el **almacén
  interno del proyecto** (`PropertiesService`), que leen todos los usuarios de
  esa web app sin compartir nada.
- Los datos de cada centro quedan **aislados** en su propia copia.

## Control de acceso

`g.educaand.es` es el dominio de **todo el profesorado andaluz**, así que el
acceso no se controla solo por dominio. El portero está en `doGet` y admite
**dos fuentes de pertenencia al claustro, combinables**:

1. Un **grupo de Google** del profesorado (el admin lo gestiona), y/o
2. una **lista de personas** que administra el admin desde la web (se forma con
   los contactos del claustro y correos extra).

Perteneces si estás en el grupo **o** en la lista. Quien no, ve una página de
acceso denegado. Al salir del grupo/lista, la sincronización diaria se detiene
sola y se avisa por correo.

## Estructura

| Archivo | Papel |
|---|---|
| `appsscript.json` | Manifiesto: web app `DOMAIN` + `USER_ACCESSING`, People API |
| `Config.gs` | Constantes y **valores por defecto** (especialidades, etiquetas) |
| `Estado.gs` | **Almacén interno**: admin, configuración y lista del claustro |
| `WebApp.gs` | `doGet` (3 estados) + API que llama el cliente |
| `DatosCentral.gs` | Contactos del centro (almacén) y propios (por usuario) + parseo de pegado |
| `Grupos.gs` | Pertenencia al claustro (grupo de Google y/o lista) |
| `Contactos.gs` | Núcleo People API: crear/actualizar/fusionar/traer/eliminar |
| `SincronizacionDiaria.gs` | Disparador diario por usuario |
| `CentrosCatalogo.gs` | Catálogo de centros de Andalucía para verificar el código |
| `Favicon.gs` | Icono de la app para la pestaña del navegador (data URI) |
| `Index.html` | Esqueleto de la página (incluye el resto) |
| `AccesoDenegado.html` | Página para no miembros / centro en preparación |
| `Estilos.html` | CSS premium (claro/oscuro, shell con pestañas) |
| `Iconos.html` | Iconos SVG (estilo Lucide) |
| `App.html` | Shell, navegación por pestañas y utilidades del cliente |
| `MisContactos.html` | Pestaña de profesorado (todos): sincronizar y contactos propios |
| `Configuracion.html` | Pestaña de configuración del centro (solo admin) |
| `ContactosCentro.html` | Pestaña del claustro / importación (solo admin) |

## Interfaz

Aplicación con **pestañas** (shell con barra lateral) y diseño propio en claro
y oscuro, con iconos SVG (sin emojis):

- **Mis contactos** (todos): sincronizar el centro por grupos, contactos
  propios, sincronización diaria y gestión de los contactos de Google.
- **Configuración** (solo admin): centro (con verificación de código),
  especialidades, etiquetas y definición del claustro (grupo y/o lista).
- **Contactos del centro** (solo admin): claustro editable e importación
  subiendo el Excel/CSV o el PDF de Séneca, o pegando (celdas de una hoja de
  cálculo con tabuladores, CSV con comas —respetando comillas— o punto y coma, o
  el pegado «vertical» de la pantalla de Séneca con un valor por línea). Se
  detecta el formato solo y las columnas por sus encabezados («Empleado/a»,
  «Cuenta Google/Microsoft», «Puesto», «Teléfono», «Móvil»…) o, si no los hay,
  por su contenido; del teléfono se prioriza el móvil (empieza por 6 o 7) y se
  descartan duplicados.

En el primer uso, el admin entra directamente en «Configuración» (con aviso de
pendiente). El correo del usuario se resuelve con `getEffectiveUser` como
respaldo para que la detección del admin sea fiable en la web app.

**Pendiente / mejoras:**

- Edición en línea de los contactos ya existentes en "Mis contactos de Google".
- Si un claustro es muy grande, revisar límites del almacén (ya se trocea).
- Exportar/backup del claustro fuera del proyecto.

## Puesta en marcha (resumen)

1. Copiar la plantilla (**proyecto standalone**) — cada admin la suya.
2. Crear proyecto de Google Cloud **Interno** y enlazarlo (evita el aviso de
   app no verificada). Habilitar People API.
3. Desplegar como **aplicación web**: ejecutar como *usuario que accede*, acceso
   *cualquier usuario de g.educaand.es*.
4. Abrir la URL como admin → completar el **asistente**.
5. Repartir la URL al claustro.

## Desarrollo (clasp)

Los archivos del proyecto están en la **raíz del repositorio** (no en una
subcarpeta). Para subirlos con [clasp](https://github.com/google/clasp), crea
un `.clasp.json` en la raíz apuntando al proyecto de Apps Script:

```json
{ "scriptId": "TU_SCRIPT_ID" }
```

Luego, desde la raíz del repo: `clasp push` (responde `y` si pregunta por el
manifiesto). El `.clasp.json` es local y no se versiona.
