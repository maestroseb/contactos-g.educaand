# Asistente de Contactos

Web App de Google Apps Script para sincronizar los contactos de un centro
educativo (`g.educaand.es`) con Google Contacts. Sustituye a la antigua hoja de
cálculo «madre/hija»: cada centro copia una plantilla, su administrador la
despliega y un asistente lo configura todo desde la web, sin tocar hojas.

## Estructura del repositorio

- **`webapp/`** — el proyecto de Apps Script (lo que se despliega). Su
  [`README`](webapp/README.md) explica la arquitectura, el control de acceso y
  los pasos de despliegue.
- **`datos/`** — material fuente, no desplegable. Contiene
  `centros-andalucia.csv`, del que se genera `webapp/CentrosCatalogo.gs`.

## Puesta en marcha (resumen)

1. Copiar la plantilla (hoja + script) — una por centro.
2. Crear un proyecto de Google Cloud **Interno** y enlazarlo (evita el aviso de
   app no verificada). Habilitar People API.
3. Desplegar como **aplicación web**: ejecutar como *usuario que accede*, acceso
   *cualquier usuario de g.educaand.es*.
4. Abrir la URL como admin → completar la pestaña **Configuración**.
5. Repartir la URL al claustro.

Detalle completo en [`webapp/README.md`](webapp/README.md).
