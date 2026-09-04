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
 * contactos. Admite MÚLTIPLES formatos y detecta cuál es automáticamente:
 *
 *   · Columnas separadas por TABULADOR (copiar celdas de una hoja de cálculo).
 *   · CSV separado por punto y coma «;» (exportación típica de Excel en español).
 *   · CSV separado por COMA «,» respetando comillas ("Apellidos, Nombre",…).
 *   · Formato «vertical»: un valor por línea (copiar y pegar de la pantalla de
 *     Séneca), con registros separados por saltos y campos partidos.
 *
 * Para las tres primeras, si hay una FILA DE ENCABEZADOS (p. ej. la de Séneca:
 * «Empleado/a», «Cuenta Google/Microsoft», «Puesto», «Teléfono», «Móvil»…) mapea
 * cada columna por su nombre; si no, cae a una heurística por posición. Del
 * teléfono siempre prioriza el móvil (empieza por 6 o 7), quita duplicados y,
 * si hay varios móviles, se queda con el primero.
 */
function parsearClaustroPegado_(texto) {
  const noVacias = String(texto || '').split(/\r?\n/).filter(l => l.trim() !== '');
  if (!noVacias.length) return [];

  const delim = detectarDelimitador_(noVacias);

  // Sin delimitador de columnas: puede ser el formato «vertical» de Séneca
  // (un valor por línea) o una lista de una sola columna.
  if (!delim) {
    const hayEmail = noVacias.some(l => /@/.test(l));
    const hayNombre = noVacias.some(esLineaNombre_);
    if (hayEmail && hayNombre) return parsearVertical_(noVacias);
    return parsearHeuristico_(noVacias.map(l => [l.trim()]));
  }

  const matriz = noVacias.map(l => partirCampos_(l, delim));
  const cab = detectarCabecera_(matriz);
  return cab ? parsearConCabecera_(matriz, cab) : parsearHeuristico_(matriz);
}

/**
 * Detecta el delimitador de columnas (TAB, «;» o «,»). Devuelve el que parte la
 * mayoría de las líneas en 2+ columnas, con prioridad TAB > «;» > «,» (la coma
 * es la última porque también aparece dentro de «Apellidos, Nombre»). Si ninguno
 * lo consigue, devuelve null (una sola columna / formato vertical).
 */
function detectarDelimitador_(lineas) {
  const minimo = Math.max(1, Math.ceil(lineas.length * 0.6));
  const candidatos = ['\t', ';', ','];
  for (let k = 0; k < candidatos.length; k++) {
    const d = candidatos[k];
    let conCols = 0;
    lineas.forEach(l => { if (partirCampos_(l, d).length >= 2) conCols++; });
    if (conCols >= minimo) return d;
  }
  return null;
}

/** Parte una línea por `delim` respetando comillas dobles ("a,b" = un campo). */
function partirCampos_(linea, delim) {
  const s = String(linea);
  const out = [];
  let campo = '', enComillas = false, i = 0;
  while (i < s.length) {
    const c = s[i];
    if (enComillas) {
      if (c === '"') {
        if (s[i + 1] === '"') { campo += '"'; i += 2; continue; }
        enComillas = false; i++; continue;
      }
      campo += c; i++; continue;
    }
    if (c === '"') { enComillas = true; i++; continue; }
    if (c === delim) { out.push(campo); campo = ''; i++; continue; }
    campo += c; i++;
  }
  out.push(campo);
  return out.map(x => x.trim());
}

/** ¿La línea es un nombre «Apellidos, Nombre»? (lleva coma, empieza por letra, sin @). */
function esLineaNombre_(l) {
  const t = String(l).trim();
  return t.indexOf(',') > 0 && !/^\d/.test(t) && t.indexOf('@') === -1 && /[A-Za-zÀ-ÿ]/.test(t);
}

/** ¿Parece un teléfono? (9–12 dígitos). */
function esTelefonoVal_(v) { const d = String(v || '').replace(/\D/g, ''); return d.length >= 9 && d.length <= 12; }

/**
 * Elige el mejor teléfono de una lista de candidatos: descarta los que no lo
 * parezcan, quita duplicados (por dígitos), prioriza el móvil (empieza por 6 o
 * 7) y, si no hay móvil, devuelve el primero. Conserva el formato original.
 */
function elegirTelefono_(candidatos) {
  const vistos = [], lista = [];
  (candidatos || []).forEach(v => {
    if (!esTelefonoVal_(v)) return;
    const d = String(v).replace(/\D/g, '');
    if (vistos.indexOf(d) !== -1) return;
    vistos.push(d);
    lista.push({ d: d, limpio: (/^\s*\+/.test(String(v)) ? '+' : '') + d });   // dígitos (con «+» si lo traía)
  });
  for (let i = 0; i < lista.length; i++) if (/^[67]/.test(lista[i].d)) return lista[i].limpio;
  return lista.length ? lista[0].limpio : '';
}

/**
 * Parsea el formato «vertical» de Séneca (un valor por línea). No se fía del nº
 * de líneas por persona (a veces hay saltos de más, y la «Fecha de cese» puede
 * venir vacía): segmenta cada registro por su LÍNEA DE NOMBRE y clasifica el
 * resto por contenido. Descarta el bloque de encabezados si lo hay (todo lo
 * anterior al primer nombre).
 */
function parsearVertical_(lineas) {
  const filas = lineas.map(l => String(l).trim());
  let ini = -1;
  for (let i = 0; i < filas.length; i++) { if (esLineaNombre_(filas[i])) { ini = i; break; } }
  if (ini === -1) return [];

  // Un registro empieza en cada línea de nombre; las demás líneas se le acumulan.
  const registros = [];
  let actual = null;
  for (let i = ini; i < filas.length; i++) {
    const l = filas[i];
    if (esLineaNombre_(l)) { actual = [l]; registros.push(actual); }
    else if (actual && l !== '') actual.push(l);
  }

  const esFecha = c => /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(c);
  const esDni = c => /^\d{7,8}\s*[a-zA-Z]$/.test(c);

  const out = [];
  registros.forEach(reg => {
    const resto = reg.slice(1);

    let email = '';
    for (const l of resto) { if (l.indexOf('@') !== -1) { email = limpiarEmail_(l); break; } }
    const local = email ? email.split('@')[0] : '';

    const telefono = elegirTelefono_(resto.filter(l => l.indexOf('@') === -1));

    // Puesto = 1ª línea de texto que no sea DNI, fecha, teléfono, correo ni el usuario IdEA.
    let puesto = '';
    for (const l of resto) {
      if (!l || l.indexOf('@') !== -1) continue;
      if (esFecha(l) || esDni(l) || esTelefonoVal_(l)) continue;
      if (local && l.toLowerCase() === local) continue;
      puesto = l; break;
    }

    const p = separarNombre_(reg[0]);
    if (!email && !p.nombre && !p.apellidos) return;
    out.push({
      nombre: p.nombre, apellidos: p.apellidos, tipoEmail: 'Trabajo',
      email: email, telefono: telefono, puesto: puesto, grupos: []
    });
  });
  return out;
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
    const telefono = elegirTelefono_([val(cols, idx.telefono), val(cols, idx.movil)]);
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
  const pareceDni = c => /^\d{7,8}\s*[a-z]$/i.test(c);
  const pareceFecha = c => /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(c);

  matriz.forEach(cols => {
    let emailIdx = -1;
    for (let i = 0; i < cols.length; i++) { if (cols[i].indexOf('@') !== -1) { emailIdx = i; break; } }
    const email = emailIdx >= 0 ? limpiarEmail_(cols[emailIdx]) : '';
    const local = email ? email.split('@')[0] : '';

    const p = separarNombre_(emailIdx === 0 ? '' : (cols[0] || ''));

    let puesto = '';
    const telefonos = [], etiquetas = [];
    for (let j = 0; j < cols.length; j++) {
      const v = cols[j];
      if (j === 0 || j === emailIdx || !v) continue;
      if (esTelefonoVal_(v)) { telefonos.push(v); continue; }
      // DNI, fechas, «No/Sí» y el usuario IdEA (= parte local del correo) no son puesto ni etiqueta.
      if (pareceDni(v) || pareceFecha(v) || /^(no|si|sí)$/i.test(v) || (local && v.toLowerCase() === local)) continue;
      if (!puesto) puesto = v;
      else etiquetas.push(v);
    }

    if (!email && !p.nombre && !p.apellidos) return;
    out.push({
      nombre: p.nombre, apellidos: p.apellidos, tipoEmail: 'Trabajo',
      email: email, telefono: elegirTelefono_(telefonos), puesto: puesto, grupos: etiquetas
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
