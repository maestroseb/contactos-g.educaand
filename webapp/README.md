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

- La **plantilla** es una hoja en blanco con este script asociado. Cada admin
  hace una **copia** → pasa a ser el dueño y, al desplegar por primera vez,
  queda registrado como administrador de su centro.
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
| `CentrosCatalogo.gs` | Catálogo de centros para verificar el código (muestra: Almería) |
| `Index.html` | Shell de la página |
| `AccesoDenegado.html` | Página para no miembros / centro en preparación |
| `Estilos.html` | CSS (claro/oscuro) |
| `Configurar.html` | Asistente de configuración inicial (admin) |
| `Usuario.html` / `Admin.html` | Vistas (registran `window.VISTAS.usuario` / `.admin`) |
| `Cliente.html` | Arranque, utilidades y conmutador de vistas |

## Estado actual

Funciona de punta a punta: detección de admin, asistente (código de centro con
verificación, especialidades/etiquetas editables, claustro por grupo y/o lista,
importación por pegado), vista de profesorado (sincronizar centro, propios,
diaria, traer/eliminar) y panel de admin (editar claustro, reconfigurar,
sincronizar).

**Pendiente / mejoras:**

- Completar `CentrosCatalogo.gs` con **todas** las provincias (ahora solo
  Almería; extraíble de la pestaña de centros de la hoja original).
- Edición en línea de los contactos ya existentes en "Mis contactos de Google".
- Si un claustro es muy grande, revisar límites del almacén (ya se trocea).
- Probar el despliegue real y depurar (Apps Script no se ejecuta fuera de Google).

## Puesta en marcha (resumen)

1. Copiar la plantilla (hoja + script) — cada admin la suya.
2. Crear proyecto de Google Cloud **Interno** y enlazarlo (evita el aviso de
   app no verificada). Habilitar People API.
3. Desplegar como **aplicación web**: ejecutar como *usuario que accede*, acceso
   *cualquier usuario de g.educaand.es*.
4. Abrir la URL como admin → completar el **asistente**.
5. Repartir la URL al claustro.

> Guía detallada de despliegue: ver el documento enlazado en la conversación.
