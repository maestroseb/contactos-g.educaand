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

const PROP_ADMIN = 'adminEmail';       // administrador principal (primer usuario)
const PROP_ADMINS = 'adminsExtra';     // administradores adicionales (JSON array)
const PROP_CONFIG = 'configCentro';
const PROP_CONTACTOS_PREFIJO = 'contactosCentro_';
const PROP_CONTACTOS_NUM = 'contactosCentroNumTrozos';
const PROP_BAJAS = 'bajasClaustro';    // personas retiradas del claustro (para quitarles las etiquetas al sincronizar)

/* --------------------------- Caché compartida --------------------------- *
 * La configuración y la lista del claustro son globales del proyecto (iguales
 * para todos los usuarios) y se leen en CADA carga y CADA comprobación de
 * pertenencia. Se guardan en la caché del script (compartida) para no releer
 * y reparsear las Script Properties una y otra vez. Se invalida al guardar. */
const CACHE_CONFIG = 'cacheConfig_v1';
const CACHE_CONTACTOS = 'cacheContactos_v1';
const CACHE_ADMINS = 'cacheAdmins_v1';
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

/** ¿Es este correo el administrador PRINCIPAL (el original, no eliminable)? */
function esAdminPrincipal_(email) {
  const admin = getAdminEmail_();
  return !!admin && !!email && admin.trim().toLowerCase() === email.trim().toLowerCase();
}

/** ¿Es este correo administrador (principal o adicional)? */
function esAdmin_(email) {
  if (!email) return false;
  if (esAdminPrincipal_(email)) return true;
  return getAdminsExtra_().indexOf(email.trim().toLowerCase()) !== -1;
}

/**
 * Traspasa el rol de administrador PRINCIPAL a otro correo. El principal
 * antiguo NO se expulsa: pasa a ser administrador adicional (evita bloqueos).
 * Devuelve el correo del nuevo principal.
 */
function traspasarAdminPrincipal_(nuevoEmail) {
  const nuevo = String(nuevoEmail || '').trim().toLowerCase();
  if (!nuevo) throw new Error('EMAIL_VACIO');
  const antiguo = getAdminEmail_().trim().toLowerCase();
  if (nuevo === antiguo) return getAdminEmail_();  // sin cambios

  PropertiesService.getScriptProperties().setProperty(PROP_ADMIN, nuevo);
  // Reconstruye la lista de adicionales: el nuevo deja de estar (ya es principal)
  // y el antiguo se conserva como adicional. setAdminsExtra_ ya excluye al owner.
  let extra = getAdminsExtra_().filter(function (e) { return e !== nuevo; });
  if (antiguo && extra.indexOf(antiguo) === -1) extra.push(antiguo);
  setAdminsExtra_(extra);
  return nuevo;
}

/** Lista de administradores adicionales (en minúsculas), con caché. */
function getAdminsExtra_() {
  const cache = cacheScript_();
  if (cache) {
    const c = cache.get(CACHE_ADMINS);
    if (c !== null) { try { return JSON.parse(c); } catch (e) {} }
  }
  const raw = PropertiesService.getScriptProperties().getProperty(PROP_ADMINS);
  let lista = [];
  if (raw) { try { lista = JSON.parse(raw); } catch (e) { lista = []; } }
  if (!Array.isArray(lista)) lista = [];
  if (cache) { try { cache.put(CACHE_ADMINS, JSON.stringify(lista), CACHE_TTL); } catch (e) {} }
  return lista;
}

/**
 * Guarda la lista de administradores adicionales. Normaliza a minúsculas,
 * quita duplicados y NUNCA incluye al administrador principal (que ya lo es
 * por sí mismo y no se puede degradar aquí, para evitar bloqueos).
 */
function setAdminsExtra_(lista) {
  const owner = getAdminEmail_().trim().toLowerCase();
  const set = {}, out = [];
  (lista || []).forEach(function (e) {
    const v = String(e || '').trim().toLowerCase();
    if (v && v !== owner && !set[v]) { set[v] = true; out.push(v); }
  });
  const json = JSON.stringify(out);
  PropertiesService.getScriptProperties().setProperty(PROP_ADMINS, json);
  const cache = cacheScript_();
  if (cache) { try { cache.put(CACHE_ADMINS, json, CACHE_TTL); } catch (e) {} }
  return out;
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
  return leerTrozos_(PROP_CONTACTOS_PREFIJO, PROP_CONTACTOS_NUM, CACHE_CONTACTOS);
}

/** Guarda la lista de contactos del centro en el almacén (troceada + caché). */
function guardarContactosCentroStore_(lista) {
  guardarTrozos_(PROP_CONTACTOS_PREFIJO, PROP_CONTACTOS_NUM, CACHE_CONTACTOS, lista);
  return (lista || []).length;
}

/* --------------------- Almacén troceado genérico --------------------- *
 * Un array JSON guardado en varias propiedades (prefijo + i) para no superar
 * el límite por propiedad, con copia en la caché compartida del script. */

function leerTrozos_(prefijo, propNum, claveCache) {
  const cache = cacheScript_();
  if (cache) {
    const c = cache.get(claveCache);
    if (c !== null) { try { return JSON.parse(c); } catch (e) {} }
  }
  const props = PropertiesService.getScriptProperties();
  const n = parseInt(props.getProperty(propNum) || '0', 10);
  let lista = [];
  if (n) {
    let json = '';
    for (let i = 0; i < n; i++) json += (props.getProperty(prefijo + i) || '');
    try { lista = JSON.parse(json); } catch (e) { lista = []; }
  }
  if (cache) {
    try {
      const s = JSON.stringify(lista);
      if (s.length < CACHE_MAX) cache.put(claveCache, s, CACHE_TTL);
    } catch (e) {}
  }
  return lista;
}

function guardarTrozos_(prefijo, propNum, claveCache, lista) {
  const props = PropertiesService.getScriptProperties();
  const json = JSON.stringify(lista || []);
  const TAM = 8000; // margen bajo el límite por propiedad

  // Borra los trozos anteriores.
  const previos = parseInt(props.getProperty(propNum) || '0', 10);
  for (let i = 0; i < previos; i++) props.deleteProperty(prefijo + i);

  // Escribe los nuevos.
  let trozos = 0;
  for (let i = 0; i < json.length; i += TAM) {
    props.setProperty(prefijo + trozos, json.substring(i, i + TAM));
    trozos++;
  }
  props.setProperty(propNum, String(trozos));

  // Refresca la caché compartida (o la invalida si es demasiado grande).
  const cache = cacheScript_();
  if (cache) {
    try { if (json.length < CACHE_MAX) cache.put(claveCache, json, CACHE_TTL); else cache.remove(claveCache); }
    catch (e) {}
  }
}

/* --------------------- Bajas del claustro (tombstones) --------------------- *
 * Cuando alguien se quita del listado del claustro se anota aquí su correo y
 * las etiquetas que tenía. En la siguiente sincronización se le RETIRAN esas
 * etiquetas de sus contactos de Google (sin borrar el contacto). Cada baja
 * lleva fecha (ts) para poder podar las muy antiguas. */

const MAX_BAJAS_ = 300;                     // tope de bajas guardadas (las más recientes)
const CADUCIDAD_BAJAS_ = 180 * 24 * 3600 * 1000;  // 180 días

/** Lee la lista de bajas [{email, grupos:[], ts}]. */
function leerBajas_() {
  const raw = PropertiesService.getScriptProperties().getProperty(PROP_BAJAS);
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}

/** Guarda la lista de bajas (podando antigüedad y tamaño). */
function guardarBajas_(bajas) {
  const ahora = Date.now();
  let lista = (bajas || []).filter(b => b && b.email && (!b.ts || (ahora - b.ts) < CADUCIDAD_BAJAS_));
  lista.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  if (lista.length > MAX_BAJAS_) lista = lista.slice(0, MAX_BAJAS_);
  PropertiesService.getScriptProperties().setProperty(PROP_BAJAS, JSON.stringify(lista));
}

/**
 * Actualiza el registro de bajas al guardar el claustro: compara la lista previa
 * con la nueva; los correos que ya no están (y tenían etiquetas) se anotan como
 * baja con sus etiquetas; los que vuelven a estar se quitan del registro.
 */
function registrarBajas_(previa, nueva) {
  const enNueva = {};
  (nueva || []).forEach(c => { const e = String(c.email || '').trim().toLowerCase(); if (e) enNueva[e] = true; });
  const gruposPrev = {};
  (previa || []).forEach(c => { const e = String(c.email || '').trim().toLowerCase(); if (e) gruposPrev[e] = (c.grupos || []); });

  // Parte de las bajas actuales, quitando las que han vuelto al claustro.
  let bajas = leerBajas_().filter(b => !enNueva[String(b.email || '').trim().toLowerCase()]);
  const idx = {};
  bajas.forEach(b => { idx[String(b.email || '').trim().toLowerCase()] = b; });

  const ahora = Date.now();
  Object.keys(gruposPrev).forEach(e => {
    if (enNueva[e]) return;                       // sigue en el claustro: no es baja
    const grupos = (gruposPrev[e] || []).filter(String);
    if (!grupos.length) return;                   // no tenía etiquetas: nada que retirar
    if (idx[e]) {
      const set = {};
      (idx[e].grupos || []).concat(grupos).forEach(g => { if (g) set[g] = true; });
      idx[e].grupos = Object.keys(set); idx[e].ts = ahora;
    } else {
      const b = { email: e, grupos: grupos.slice(), ts: ahora };
      bajas.push(b); idx[e] = b;
    }
  });
  guardarBajas_(bajas);
}
