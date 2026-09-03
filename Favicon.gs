/**
 * Favicon.gs — Icono de la app para la pestaña del navegador.
 *
 * IMPORTANTE: HtmlOutput.setFaviconUrl() necesita una URL http(s) pública que
 * Google pueda descargar; los data: URI NO funcionan (la pestaña se queda con
 * el icono por defecto de Apps Script). Por eso se sirve el PNG desde el propio
 * repositorio público (assets/favicon.png), igual que en EvaluAnda.
 *
 * Se aplica con setFaviconUrl(FAVICON_URL) en WebApp.gs (ver ponerFavicon_).
 */
const FAVICON_URL = 'https://raw.githubusercontent.com/maestroseb/contactos-g.educaand/main/assets/favicon.png';
