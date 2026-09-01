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
  const raw = PropertiesService.getScriptProperties().getProperty(PROP_CONFIG);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

/** Guarda el objeto de configuración del centro. */
function setConfig_(obj) {
  PropertiesService.getScriptProperties().setProperty(PROP_CONFIG, JSON.stringify(obj || {}));
}

/** ¿Está el centro configurado (asistente completado)? */
function estaConfigurado_() {
  const c = getConfig_();
  return !!(c && c.completo);
}

/** Correo del grupo del profesorado configurado (o ''). */
function correoGrupoProfesorado_() {
  const c = getConfig_();
  return (c && c.grupoProfesorado) ? String(c.grupoProfesorado).trim() : '';
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

/** Lee la lista de contactos del centro desde el almacén. */
function leerContactosCentroStore_() {
  const props = PropertiesService.getScriptProperties();
  const n = parseInt(props.getProperty(PROP_CONTACTOS_NUM) || '0', 10);
  if (!n) return [];
  let json = '';
  for (let i = 0; i < n; i++) json += (props.getProperty(PROP_CONTACTOS_PREFIJO + i) || '');
  try { return JSON.parse(json); } catch (e) { return []; }
}

/** Guarda la lista de contactos del centro en el almacén (troceada). */
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
  return (lista || []).length;
}
