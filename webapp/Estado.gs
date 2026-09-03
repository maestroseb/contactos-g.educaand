/**
 * Estado.gs — Almacén interno del proyecto (Script Properties).
 *
 * Sustituye a la hoja de cálculo: la configuración del centro, el correo del
 * grupo del profesorado y la lista de contactos del claustro se guardan aquí.
 * Las Script Properties son propias del proyecto y las lee CUALQUIER usuario
 * que use la web app, sin necesidad de compartir ninguna hoja.
 *
 * Solo el administrador (detectado en el primer despliegue) puede escribir.
 */

const PROP_ADMIN = 'adminEmail';
const PROP_CONFIG = 'configCentro';
const PROP_CONTACTOS_PREFIJO = 'contactosCentro_';
const PROP_CONTACTOS_NUM = 'contactosCentroNumTrozos';

/* --------------------------- Caché compartida --------------------------- *
 * La configuración y la lista del claustro son globales del proyecto (iguales
 * para todos los usuarios) y se leen en CADA carga y CADA comprobación de
 * pertenencia. Se guardan en la caché del script (compartida) para no releer
 * y reparsear las Script Properties una y otra vez. Se invalida al guardar. */
const CACHE_CONFIG = 'cacheConfig_v1';
const CACHE_CONTACTOS = 'cacheContactos_v1';
const CACHE_TTL = 21600;   // 6 h (máximo de CacheService)
const CACHE_MAX = 95000;   // no cachear valores por encima del límite (~100 KB)

/** Caché del script (best-effort; nunca debe romper la app si falla). */
function cacheScript_() {
  try { return CacheService.getScriptCache(); } catch (e) { return null; }
}

/* --------------------------- Administrador --------------------------- */

/** Correo del administrador del centro (o '' si aún no hay). */
function getAdminEmail_() {
  return PropertiesService.getScriptProperties().getProperty(PROP_ADMIN) || '';
}

/** Fija el administrador si todavía no hay ninguno (primer usuario que entra). */
function fijarAdminSiVacio_(email) {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty(PROP_ADMIN) && email) {
    props.setProperty(PROP_ADMIN, email);
  }
  return props.getProperty(PROP_ADMIN) || '';
}

/** ¿Es este correo el administrador? */
function esAdmin_(email) {
  const admin = getAdminEmail_();
  return !!admin && !!email && admin.trim().toLowerCase() === email.trim().toLowerCase();
}

/* --------------------------- Configuración --------------------------- */

/** Devuelve el objeto de configuración del centro (o null si no hay). */
function getConfig_() {
  const cache = cacheScript_();
  if (cache) {
    const c = cache.get(CACHE_CONFIG);
    if (c !== null) { try { return c === '' ? null : JSON.parse(c); } catch (e) {} }
  }
  const raw = PropertiesService.getScriptProperties().getProperty(PROP_CONFIG);
  let obj = null;
  if (raw) { try { obj = JSON.parse(raw); } catch (e) { obj = null; } }
  if (cache) { try { cache.put(CACHE_CONFIG, obj ? JSON.stringify(obj) : '', CACHE_TTL); } catch (e) {} }
  return obj;
}

/** Guarda el objeto de configuración del centro (y refresca la caché). */
function setConfig_(obj) {
  const json = JSON.stringify(obj || {});
  PropertiesService.getScriptProperties().setProperty(PROP_CONFIG, json);
  const cache = cacheScript_();
  if (cache) { try { cache.put(CACHE_CONFIG, json, CACHE_TTL); } catch (e) {} }
}

/** ¿Está el centro configurado (asistente completado)? */
function estaConfigurado_() {
  const c = getConfig_();
  return !!(c && c.completo);
}

/** Nombre del centro configurado (o ''). */
function nombreCentro_() {
  const c = getConfig_();
  return (c && c.nombreCentro) ? String(c.nombreCentro).trim() : '';
}

/* ----------------------- Lista de contactos del centro ----------------------- *
 * Se guarda troceada en varias propiedades para no superar el límite de tamaño  *
 * por propiedad (~9 KB). Formato de cada contacto: ver DatosCentral (nombre,
 * apellidos, tipoEmail, email, telefono, puesto, grupos[]). */

/** Lee la lista de contactos del centro desde el almacén (con caché). */
function leerContactosCentroStore_() {
  const cache = cacheScript_();
  if (cache) {
    const c = cache.get(CACHE_CONTACTOS);
    if (c !== null) { try { return JSON.parse(c); } catch (e) {} }
  }
  const props = PropertiesService.getScriptProperties();
  const n = parseInt(props.getProperty(PROP_CONTACTOS_NUM) || '0', 10);
  let lista = [];
  if (n) {
    let json = '';
    for (let i = 0; i < n; i++) json += (props.getProperty(PROP_CONTACTOS_PREFIJO + i) || '');
    try { lista = JSON.parse(json); } catch (e) { lista = []; }
  }
  if (cache) {
    try {
      const s = JSON.stringify(lista);
      if (s.length < CACHE_MAX) cache.put(CACHE_CONTACTOS, s, CACHE_TTL);
    } catch (e) {}
  }
  return lista;
}

/** Guarda la lista de contactos del centro en el almacén (troceada + caché). */
function guardarContactosCentroStore_(lista) {
  const props = PropertiesService.getScriptProperties();
  const json = JSON.stringify(lista || []);
  const TAM = 8000; // margen bajo el límite por propiedad

  // Borra los trozos anteriores.
  const previos = parseInt(props.getProperty(PROP_CONTACTOS_NUM) || '0', 10);
  for (let i = 0; i < previos; i++) props.deleteProperty(PROP_CONTACTOS_PREFIJO + i);

  // Escribe los nuevos.
  let trozos = 0;
  for (let i = 0; i < json.length; i += TAM) {
    props.setProperty(PROP_CONTACTOS_PREFIJO + trozos, json.substring(i, i + TAM));
    trozos++;
  }
  props.setProperty(PROP_CONTACTOS_NUM, String(trozos));

  // Refresca la caché compartida (o la invalida si es demasiado grande).
  const cache = cacheScript_();
  if (cache) {
    try { if (json.length < CACHE_MAX) cache.put(CACHE_CONTACTOS, json, CACHE_TTL); else cache.remove(CACHE_CONTACTOS); }
    catch (e) {}
  }
  return (lista || []).length;
}
