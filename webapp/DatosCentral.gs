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
 * Columnas por tabulador: "Apellidos, Nombre" | Correo | Teléfono |
 * Especialidad/DPTO | Etiqueta 1 | Etiqueta 2 | Etiqueta 3 | Etiqueta 4.
 */
function parsearClaustroPegado_(texto) {
  const filas = String(texto || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = [];
  filas.forEach(linea => {
    const c = linea.split('\t').map(s => s.trim());
    const nombreCompleto = c[0] || '';
    let apellidos = '', nombre = nombreCompleto;
    if (nombreCompleto.indexOf(',') !== -1) {
      const p = nombreCompleto.split(',');
      apellidos = p[0].trim();
      nombre = p.slice(1).join(',').trim();
    }
    const email = c[1] ? c[1].trim().toLowerCase() : '';
    if (!email && !nombre) return;
    out.push({
      nombre: nombre,
      apellidos: apellidos,
      tipoEmail: 'Trabajo',
      email: email,
      telefono: c[2] || '',
      puesto: c[3] || '',
      grupos: [c[4], c[5], c[6], c[7]].map(g => (g ? g.trim() : '')).filter(String)
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
