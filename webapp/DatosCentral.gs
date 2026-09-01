/**
 * DatosCentral.gs — Capa de acceso a datos.
 *
 * Sustituye a SpreadsheetApp.getActiveSpreadsheet() del proyecto de hoja:
 * en una web app no hay "hoja activa", así que abrimos la hoja central por ID
 * (PARAMS.idHojaCentral) y los datos propios de cada usuario se guardan en sus
 * UserProperties (privados de cada cuenta).
 */

/** Abre la hoja central por ID. */
function abrirHojaCentral_() {
  return SpreadsheetApp.openById(PARAMS.idHojaCentral);
}

/**
 * Lee los contactos del CENTRO desde la pestaña "Subir Contactos" de la hoja
 * central (la que ya genera las fórmulas: Nombre/Apellidos separados, etc.).
 * Devuelve un array de objetos de contacto normalizados.
 */
function leerContactosCentro_() {
  const hoja = abrirHojaCentral_().getSheetByName(PARAMS.hojas.subirContactos);
  if (!hoja || hoja.getLastRow() < 2) return [];
  const datos = hoja.getDataRange().getValues();
  return filasASontactos_(datos);
}

/**
 * Convierte filas de "Subir Contactos" en objetos normalizados.
 * Columnas (según la hoja actual):
 * 0 Nombre y Apellidos | 1 Nombre | 2 Apellidos | 3 Tipo Email | 4 E-mail |
 * 5 Teléfono | 6 Puesto/Departamento | 7-10 Etiqueta 1..4
 */
function filasASontactos_(datos) {
  const out = [];
  for (let i = 1; i < datos.length; i++) {
    const fila = datos[i];
    const email = fila[4] ? String(fila[4]).trim().toLowerCase() : '';
    const nombre = fila[1] ? String(fila[1]).trim() : '';
    if (!email && !nombre) continue;
    out.push({
      nombre: nombre,
      apellidos: fila[2] ? String(fila[2]).trim() : '',
      tipoEmail: fila[3] ? String(fila[3]).trim() : 'Trabajo',
      email: email,
      telefono: fila[5] ? String(fila[5]).trim() : '',
      puesto: fila[6] ? String(fila[6]).trim() : '',
      grupos: [fila[7], fila[8], fila[9], fila[10]]
        .map(g => (g ? String(g).trim() : ''))
        .filter(String)
    });
  }
  return out;
}

/** Correo del grupo del profesorado configurado en la hoja central (o ''). */
function correoGrupoProfesorado_() {
  const hoja = abrirHojaCentral_().getSheetByName(PARAMS.hojas.configuracion);
  if (!hoja) return '';
  let correo = String(hoja.getRange(PARAMS.config.correoGrupoProfesorado).getValue() || '').trim();
  if (correo.toLowerCase() === PARAMS.config.placeholderCorreo.toLowerCase()) correo = '';
  return correo;
}

/** Nombre del centro configurado en la hoja central. */
function nombreCentro_() {
  const hoja = abrirHojaCentral_().getSheetByName(PARAMS.hojas.configuracion);
  if (!hoja) return '';
  return String(hoja.getRange(PARAMS.config.nombreCentro).getValue() || '').trim();
}

/**
 * Catálogo de grupos/etiquetas que el usuario puede elegir sincronizar.
 * Se derivan de los grupos presentes en los contactos del centro.
 */
function gruposDelCentro_() {
  const set = {};
  leerContactosCentro_().forEach(c => c.grupos.forEach(g => { set[g] = true; }));
  return Object.keys(set).sort((a, b) => a.localeCompare(b));
}

/* ------------------------------------------------------------------ *
 *  Edición de la lista central (⬆️ Datos) desde el panel admin        *
 * ------------------------------------------------------------------ */

/** Lee las filas editables de ⬆️ Datos (matriz de numColumnas por fila). */
function leerFilasDatos_() {
  const L = PARAMS.datosLayout;
  const hoja = abrirHojaCentral_().getSheetByName(PARAMS.hojas.datos);
  const ultima = hoja.getLastRow();
  if (ultima < L.filaInicio) return [];
  const n = ultima - L.filaInicio + 1;
  return hoja.getRange(L.filaInicio, 1, n, L.numColumnas).getValues()
    .filter(f => f.some(c => String(c).trim() !== ''));
}

/**
 * Sobrescribe la zona de datos de ⬆️ Datos con las filas dadas.
 * Limpia el rango anterior y escribe las nuevas (respeta numColumnas).
 */
function escribirFilasDatos_(filas) {
  const L = PARAMS.datosLayout;
  const hoja = abrirHojaCentral_().getSheetByName(PARAMS.hojas.datos);

  // Normaliza cada fila a numColumnas.
  const limpias = (filas || [])
    .map(f => {
      const fila = [];
      for (let i = 0; i < L.numColumnas; i++) fila.push(f[i] != null ? f[i] : '');
      return fila;
    })
    .filter(f => f.some(c => String(c).trim() !== ''));

  // Borra el bloque anterior.
  const ultima = hoja.getLastRow();
  if (ultima >= L.filaInicio) {
    hoja.getRange(L.filaInicio, 1, ultima - L.filaInicio + 1, L.numColumnas).clearContent();
  }
  // Escribe el nuevo.
  if (limpias.length) {
    hoja.getRange(L.filaInicio, 1, limpias.length, L.numColumnas).setValues(limpias);
  }
  return limpias.length;
}

/* ------------------------------------------------------------------ *
 *  Contactos PROPIOS de cada usuario (privados en sus UserProperties) *
 * ------------------------------------------------------------------ */

const CLAVE_CONTACTOS_PROPIOS_ = 'contactosPropios';

/** Devuelve los contactos propios del usuario (array de objetos). */
function leerContactosPropios_() {
  const raw = PropertiesService.getUserProperties().getProperty(CLAVE_CONTACTOS_PROPIOS_);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch (e) { return []; }
}

/** Guarda los contactos propios del usuario. */
function guardarContactosPropios_(lista) {
  PropertiesService.getUserProperties()
    .setProperty(CLAVE_CONTACTOS_PROPIOS_, JSON.stringify(lista || []));
}
