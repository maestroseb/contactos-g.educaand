/**
 * DatosCentral.gs — Acceso a los datos del centro y de cada usuario.
 *
 * Los contactos del centro viven en el almacén interno (Estado.gs), no en una
 * hoja. Los contactos propios de cada usuario van en sus UserProperties.
 */

/** Contactos del centro (los que sincroniza el claustro). */
function leerContactosCentro_() {
  return leerContactosCentroStore_();
}

/** Etiquetas/grupos presentes en los contactos del centro (para la vista). */
function gruposDelCentro_() {
  const set = {};
  leerContactosCentro_().forEach(c => (c.grupos || []).forEach(g => { if (g) set[g] = true; }));
  return Object.keys(set).sort((a, b) => a.localeCompare(b));
}

/**
 * Convierte texto pegado (p. ej. exportado de Séneca) en contactos.
 *
 * Es flexible con el formato: separa columnas por TABULADOR y detecta
 * automáticamente cuál es el correo (la que contiene "@"). La 1ª columna es el
 * nombre ("Apellidos, Nombre"), y del resto de columnas: la que parece número
 * es el teléfono, la primera de texto es el puesto/especialidad y las demás,
 * etiquetas. Así admite tanto "Nombre · Correo · Puesto" como
 * "Nombre · Correo · Teléfono · Puesto · Etiquetas…".
 */
function parsearClaustroPegado_(texto) {
  const filas = String(texto || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = [];
  const pareceTelefono = c => /^[+(]?\d[\d\s().-]{5,}$/.test(c);

  filas.forEach(linea => {
    const cols = linea.split('\t').map(s => s.trim());

    // Columna del correo (la que tenga @).
    let emailIdx = -1;
    for (let i = 0; i < cols.length; i++) { if (cols[i].indexOf('@') !== -1) { emailIdx = i; break; } }
    const email = emailIdx >= 0 ? cols[emailIdx].toLowerCase() : '';

    // Nombre = 1ª columna (salvo que sea el propio correo).
    let nombreCompleto = (emailIdx === 0) ? '' : (cols[0] || '');
    let apellidos = '', nombre = nombreCompleto;
    if (nombreCompleto.indexOf(',') !== -1) {
      const p = nombreCompleto.split(',');
      apellidos = p[0].trim();
      nombre = p.slice(1).join(',').trim();
    }

    // Resto de columnas: teléfono / puesto / etiquetas.
    let telefono = '', puesto = '';
    const etiquetas = [];
    for (let j = 0; j < cols.length; j++) {
      if (j === 0 || j === emailIdx || !cols[j]) continue;
      if (!telefono && pareceTelefono(cols[j])) telefono = cols[j];
      else if (!puesto) puesto = cols[j];
      else etiquetas.push(cols[j]);
    }

    if (!email && !nombre) return;
    out.push({
      nombre: nombre, apellidos: apellidos, tipoEmail: 'Trabajo',
      email: email, telefono: telefono, puesto: puesto, grupos: etiquetas
    });
  });
  return out;
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
