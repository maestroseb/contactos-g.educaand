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
 * Convierte texto (pegado, o extraído de un Excel/PDF en el cliente) en
 * contactos. Las columnas van separadas por TABULADOR y las filas por saltos.
 *
 * Estrategia en dos niveles:
 *   1) Si detecta una FILA DE ENCABEZADOS (p. ej. la de Séneca: «Empleado/a»,
 *      «Cuenta Google/Microsoft», «Puesto», «Teléfono», «Móvil»…), mapea cada
 *      columna por su nombre. Es lo más fiable: ignora las columnas que no
 *      interesan (DNI, fechas, «Usuario IdEA», «Coordinador»…) en vez de
 *      confundirlas con el puesto o las etiquetas.
 *   2) Si no hay encabezados reconocibles, cae a una heurística por posición
 *      (1ª columna = nombre «Apellidos, Nombre», la del «@» = correo, la que
 *      parece número = teléfono, la 1ª de texto = puesto y el resto etiquetas),
 *      saltándose lo que parezca DNI o fecha.
 *
 * Tolera espacios sobrantes dentro de una celda (habituales al extraer de un
 * PDF: correos y teléfonos que quedan partidos).
 */
function parsearClaustroPegado_(texto) {
  const matriz = String(texto || '')
    .split(/\r?\n/)
    .filter(l => l.trim() !== '')
    .map(l => l.split('\t').map(s => s.trim()));
  if (!matriz.length) return [];

  const cab = detectarCabecera_(matriz);
  return cab ? parsearConCabecera_(matriz, cab) : parsearHeuristico_(matriz);
}

/** Normaliza para comparar encabezados: minúsculas, sin acentos ni dobles espacios. */
function normalizarTexto_(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Clasifica el texto de una celda de encabezado y devuelve el campo al que
 * corresponde ('nombreCompleto','nombre','apellidos','email','telefono',
 * 'movil','puesto','grupos') o '' si no es reconocible. Compara también el
 * texto sin espacios, para tolerar encabezados partidos por el PDF
 * («Emplea do/a» → «empleado/a», «Coordi nador» → «coordinador»).
 */
function tipoDeCabecera_(celda) {
  const t = normalizarTexto_(celda);
  if (!t) return '';
  const ts = t.replace(/\s+/g, '');
  const m = re => re.test(t) || re.test(ts);

  if (m(/empleado/) || m(/nombreyapellidos/) || m(/apellidosynombre/) ||
      m(/apellidos,?nombre/) || m(/nombrecompleto/)) return 'nombreCompleto';
  if (m(/^apellidos$/)) return 'apellidos';
  if (m(/^nombre$/)) return 'nombre';
  if (m(/cuenta.*(google|microsoft|corporativ)/) || m(/correo/) ||
      m(/^e-?mail$/) || m(/direcciondecorreo/) || m(/^cuenta$/)) return 'email';
  if (m(/movil/)) return 'movil';
  if (m(/telefono/) || m(/^tel$/)) return 'telefono';
  if (m(/puesto/) || m(/especialidad/) || m(/^cargo/)) return 'puesto';
  if (m(/etiquetas?/) || m(/^grupos?$/)) return 'grupos';
  return '';
}

/** Busca la 1ª fila que parezca de encabezados (≥2 columnas reconocidas, con nombre o correo). */
function detectarCabecera_(matriz) {
  for (let i = 0; i < matriz.length; i++) {
    const tipos = matriz[i].map(tipoDeCabecera_);
    const reconocidas = tipos.filter(Boolean).length;
    const fuerte = tipos.some(t => t === 'email' || t === 'nombreCompleto' || t === 'nombre' || t === 'apellidos');
    if (reconocidas >= 2 && fuerte) return { fila: i, tipos: tipos };
  }
  return null;
}

/** Parsea usando el mapa de columnas de la cabecera detectada. */
function parsearConCabecera_(matriz, cab) {
  const tipos = cab.tipos;
  const idx = {};
  tipos.forEach((t, i) => { if (t && idx[t] === undefined) idx[t] = i; });

  const val = (cols, j) => (j === undefined || cols[j] === undefined) ? '' : String(cols[j]).trim();
  const out = [];

  for (let i = cab.fila + 1; i < matriz.length; i++) {
    const cols = matriz[i];
    if (!cols || !cols.length) continue;

    // Salta una fila que sea otra vez la cabecera (PDF que la repite por página).
    const tiposFila = cols.map(tipoDeCabecera_);
    if (tiposFila.filter(Boolean).length >= 2 &&
        tiposFila.some(t => t === 'email' || t === 'nombreCompleto')) continue;

    let nombre = '', apellidos = '';
    if (idx.nombre !== undefined || idx.apellidos !== undefined) {
      nombre = val(cols, idx.nombre);
      apellidos = val(cols, idx.apellidos);
    } else {
      const p = separarNombre_(val(cols, idx.nombreCompleto));
      nombre = p.nombre; apellidos = p.apellidos;
    }

    const email = limpiarEmail_(val(cols, idx.email));
    let telefono = limpiarTelefono_(val(cols, idx.telefono));
    if (!telefono) telefono = limpiarTelefono_(val(cols, idx.movil));
    const puesto = val(cols, idx.puesto);
    const grupos = idx.grupos !== undefined ? troceaEtiquetas_(val(cols, idx.grupos)) : [];

    if (!email && !nombre && !apellidos) continue;
    out.push({
      nombre: nombre, apellidos: apellidos, tipoEmail: 'Trabajo',
      email: email, telefono: telefono, puesto: puesto, grupos: grupos
    });
  }
  return out;
}

/** Heurística por posición (cuando no hay encabezados). */
function parsearHeuristico_(matriz) {
  const out = [];
  const pareceTelefono = c => /^[+(]?\d[\d\s().-]{5,}$/.test(c);
  const pareceDni = c => /^\d{7,8}\s*[a-z]$/i.test(c);
  const pareceFecha = c => /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(c);

  matriz.forEach(cols => {
    let emailIdx = -1;
    for (let i = 0; i < cols.length; i++) { if (cols[i].indexOf('@') !== -1) { emailIdx = i; break; } }
    const email = emailIdx >= 0 ? limpiarEmail_(cols[emailIdx]) : '';

    const p = separarNombre_(emailIdx === 0 ? '' : (cols[0] || ''));

    let telefono = '', puesto = '';
    const etiquetas = [];
    for (let j = 0; j < cols.length; j++) {
      const v = cols[j];
      if (j === 0 || j === emailIdx || !v) continue;
      if (pareceTelefono(v)) { if (!telefono) telefono = limpiarTelefono_(v); continue; }
      // DNI, fechas y el «No/Sí» de coordinador no son puesto ni etiqueta.
      if (pareceDni(v) || pareceFecha(v) || /^(no|si|sí)$/i.test(v)) continue;
      if (!puesto) puesto = v;
      else etiquetas.push(v);
    }

    if (!email && !p.nombre && !p.apellidos) return;
    out.push({
      nombre: p.nombre, apellidos: p.apellidos, tipoEmail: 'Trabajo',
      email: email, telefono: telefono, puesto: puesto, grupos: etiquetas
    });
  });
  return out;
}

/* --------- Utilidades de limpieza de celdas --------- */

/** Separa «Apellidos, Nombre». Sin coma, todo se toma como nombre. */
function separarNombre_(nc) {
  nc = String(nc || '').trim();
  if (nc.indexOf(',') !== -1) {
    const p = nc.split(',');
    return { apellidos: p[0].trim(), nombre: p.slice(1).join(',').trim() };
  }
  return { apellidos: '', nombre: nc };
}

/** Quita espacios (correos partidos por el PDF) y pasa a minúsculas. */
function limpiarEmail_(v) {
  return String(v || '').replace(/\s+/g, '').toLowerCase();
}

/** Normaliza un teléfono: quita el «.0» de Excel y une dígitos partidos. */
function limpiarTelefono_(v) {
  v = String(v || '').trim().replace(/\.0+$/, '');
  if (/^[+(]?\d[\d\s().-]*$/.test(v)) return v.replace(/\s+/g, '');
  return v;
}

/** Trocea una celda de etiquetas separadas por «,» o «;». */
function troceaEtiquetas_(v) {
  return String(v || '').split(/[;,]/).map(s => s.trim()).filter(Boolean);
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
