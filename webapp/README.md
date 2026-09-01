# Asistente de Contactos — Web App (v4)

Migración del Asistente de Contactos de **hoja de cálculo** a una **Web App de
Apps Script** con dos vistas según quién entre:

- **Administrador** → gestiona la lista central del centro (equivale a la "hoja madre").
- **Profesorado** → sincroniza los contactos del centro y/o los suyos propios en
  **su** cuenta de Google Contacts, con opción de sincronización diaria.

> Diseño y decisiones: ver el documento de diseño enlazado en la conversación.
> Este directorio es un **proyecto standalone independiente**; los archivos `.gs`
> del proyecto de hoja siguen en la raíz del repo como referencia.

## Control de acceso (importante)

`g.educaand.es` es el dominio de **todo el profesorado andaluz**, no solo de un
centro. Por eso el acceso NO se controla solo por dominio:

- La web se despliega con acceso **de dominio** (necesario para la app "Interna"
  sin verificación), pero el **portero real está en `doGet`**: comprueba la
  pertenencia al **grupo de Google del profesorado** del centro (el correo de
  `⚙️ Configuración!D4`). Quien no pertenezca ve una página de *acceso denegado*.
- Ese grupo lo **administra la persona admin**: añadir/quitar a alguien del grupo
  es lo que le da o le quita el acceso.
- Cuando alguien sale del claustro (del grupo), la **sincronización diaria** se
  detiene sola y se le avisa por correo (`SincronizacionDiaria.gs`).

Es el mismo comportamiento que la hoja madre/hija: manda la pertenencia al grupo.

## Estructura

| Archivo | Papel |
|---|---|
| `appsscript.json` | Manifiesto: web app `DOMAIN` + `USER_ACCESSING`, People API, scopes |
| `Config.gs` | **Único sitio a configurar**: ID de la hoja central, admins, pestañas |
| `WebApp.gs` | `doGet` + enrutado por rol + API que llama el cliente |
| `DatosCentral.gs` | Acceso a la hoja central por ID + contactos propios (por usuario) |
| `Grupos.gs` | Comprobación de pertenencia al grupo del profesorado |
| `Contactos.gs` | Núcleo People API: crear/actualizar/traer/eliminar |
| `SincronizacionDiaria.gs` | Disparador diario por usuario (desatendido) |
| `Index.html` | Shell de la página |
| `AccesoDenegado.html` | Página para quien no pertenece al claustro |
| `Estilos.html` | CSS (claro/oscuro) |
| `Usuario.html` / `Admin.html` | Vistas (definen `window.VISTA.render`) |
| `Cliente.html` | Arranque y utilidades del cliente |

## Estado actual (andamiaje)

Funciona de punta a punta: detección de rol, vista de profesorado (sincronizar
centro por grupos, diaria, traer/eliminar "mis contactos") y vista de admin en
solo lectura. **Pendiente (marcado con `TODO`):**

- Edición en línea de la lista central desde el panel admin (`adminGuardarDatos`).
- Portar la fusión de duplicados completa (`fusionarDuplicados_`).
- Formulario de "mis contactos propios" en la vista de profesorado.
- Conmutador de vistas para que el admin use también la vista de profesorado.

## Puesta en marcha

1. **Crear el proyecto**: nuevo proyecto en <https://script.google.com> (con la
   cuenta que será la dueña) y subir estos archivos (recomendado con
   [`clasp`](https://github.com/google/clasp): `clasp push`).
2. **Configurar** `Config.gs`: `idHojaCentral` (ID de la hoja madre) y `admins`.
3. **Compartir la hoja central** en solo lectura con el dominio `g.educaand.es`.
4. **Proyecto de Google Cloud → consentimiento "Interno"** (opción A del diseño):
   asociar un proyecto de Cloud del dominio y marcar la pantalla de
   consentimiento OAuth como *Interna*. Así no aparece el aviso de "app no
   verificada" ni hace falta verificación.
5. **Activar el servicio avanzado People** (ya declarado en `appsscript.json`).
6. **Desplegar** como *Aplicación web*: ejecutar como **usuario que accede**,
   con acceso **cualquier usuario del dominio**.
7. Repartir la **URL** al claustro. Cada persona autoriza una vez y listo.
