/**
 * Alumnado.gs — Cursos (tutorías) con su alumnado y su equipo docente.
 *
 * Dos niveles de administración:
 *  - Súper admin (esAdmin_): ve, audita, crea/borra todos los cursos y asigna tutor/a.
 *  - Docente del claustro: crea sus propios cursos (queda como tutor/a) y
 *    gestiona SOLO los suyos (nombre, alumnado y profesorado).
 *
 * El nombre del curso es la ETIQUETA de ese grupo de alumnos.
 *  - El alumnado sincroniza a sus compañeros (etiqueta «<curso>»), a su tutor/a
 *    y al profesorado elegido (etiqueta «Profesorado <curso>»), nunca las
 *    etiquetas del claustro ni teléfonos.
 *  - El profesorado sincroniza siempre el claustro y, además, los grupos de
 *    alumnos que elija entre los cursos en los que da clase.
 *  - Las bajas (alumnos quitados, cursos renombrados/borrados, docentes
 *    retirados) se anotan para retirar esas etiquetas al sincronizar.
 *
 * Formato de cada curso:
 *   { id, nombre, tutor: email, profesores: [email], alumnos: [{nombre, apellidos, email}] }
 */

const PROP_ALUMNADO_PREFIJO = 'alumnado_';
const PROP_ALUMNADO_NUM = 'alumnadoNumTrozos';
const CACHE_ALUMNADO = 'cacheAlumnado_v1';
const PROP_BAJAS_ALU_PREFIJO = 'bajasAlumnado_';
const PROP_BAJAS_ALU_NUM = 'bajasAlumnadoNumTrozos';
const CACHE_BAJAS_ALU = 'cacheBajasAlumnado_v1';
const CLAVE_CURSOS_SYNC_ = 'cursosSync';   // (UserProperties) cursos que el docente sincroniza

function etqProfesorado_(nombreCurso) { return 'Profesorado ' + nombreCurso; }

function low_(e) { return String(e || '').trim().toLowerCase(); }

function leerCursos_() {
  return leerTrozos_(PROP_ALUMNADO_PREFIJO, PROP_ALUMNADO_NUM, CACHE_ALUMNADO);
}

function guardarCursos_(lista) {
  guardarTrozos_(PROP_ALUMNADO_PREFIJO, PROP_ALUMNADO_NUM, CACHE_ALUMNADO, lista);
}

/* ------------------------------ Roles ------------------------------ */

function cursosDeTutor_(email) {
  const e = low_(email);
  if (!e) return [];
  return leerCursos_().filter(c => low_(c.tutor) === e);
}

function esTutor_(email) { return cursosDeTutor_(email).length > 0; }

function cursosDeAlumno_(email) {
  const e = low_(email);
  if (!e) return [];
  return leerCursos_().filter(c => (c.alumnos || []).some(a => low_(a.email) === e));
}

function esAlumno_(email) { return cursosDeAlumno_(email).length > 0; }

/** Cursos en los que el correo es tutor/a o profesor/a. */
function cursosDeDocente_(email) {
  const e = low_(email);
  if (!e) return [];
  return leerCursos_().filter(c => low_(c.tutor) === e || (c.profesores || []).map(low_).indexOf(e) !== -1);
}

/** Rol principal para la interfaz: 'admin' | 'profesor' | 'alumno' | ''. */
function rolDe_(email) {
  if (esAdmin_(email)) return 'admin';
  if (esMiembroClaustro_(email)) return 'profesor';
  if (esAlumno_(email)) return 'alumno';
  return '';
}

/** ¿Puede sincronizar «los contactos del centro» (lo que le corresponda)? */
function puedeSincronizarCentro_(email) {
  return esAdmin_(email) || esMiembroClaustro_(email) || esAlumno_(email);
}

/* ------------------------- Contactos del alumno ------------------------- */

/**
 * Lista de contactos que sincroniza un alumno: sus compañeros de curso
 * (etiqueta = nombre del curso), su tutor/a y el profesorado elegido por el
 * tutor (etiqueta «Profesorado <curso>»). Del profesorado se toman nombre,
 * apellidos y puesto del claustro (sin teléfono ni etiquetas del claustro).
 */
function contactosDeClase_(email) {
  const yo = low_(email);
  const claustro = {};
  leerContactosCentroStore_().forEach(c => { if (c && c.email) claustro[low_(c.email)] = c; });

  const out = [];
  cursosDeAlumno_(yo).forEach(curso => {
    (curso.alumnos || []).forEach(a => {
      if (!a.email || low_(a.email) === yo) return;
      out.push({ nombre: a.nombre || '', apellidos: a.apellidos || '', email: low_(a.email), grupos: [curso.nombre] });
    });
    const tutor = low_(curso.tutor);
    [tutor].concat((curso.profesores || []).map(low_)).filter(String).forEach(e => {
      const c = claustro[e] || {};
      out.push({
        nombre: c.nombre || '', apellidos: c.apellidos || '', email: e,
        puesto: e === tutor ? 'Tutor/a ' + curso.nombre : (c.puesto || ''),
        grupos: [etqProfesorado_(curso.nombre)]
      });
    });
  });
  return fusionarPorEmail_(out);
}

/**
 * Alumnado de los cursos que el docente ha elegido sincronizar (solo de los
 * cursos en los que da clase, o de cualquiera si es admin). Etiqueta = curso.
 */
function contactosDeCursosDocente_(email) {
  const sel = leerCursosSync_();
  if (!sel.length) return [];
  const permitidos = esAdmin_(email) ? leerCursos_() : cursosDeDocente_(email);
  const yo = low_(email);
  const out = [];
  permitidos.filter(c => sel.indexOf(c.id) !== -1).forEach(curso => {
    (curso.alumnos || []).forEach(a => {
      if (!a.email || low_(a.email) === yo) return;
      out.push({ nombre: a.nombre || '', apellidos: a.apellidos || '', email: low_(a.email), grupos: [curso.nombre] });
    });
  });
  return fusionarPorEmail_(out);
}

/** Une las entradas con el mismo correo juntando sus etiquetas. */
function fusionarPorEmail_(lista) {
  const idx = {}, out = [];
  lista.forEach(c => {
    const e = low_(c.email);
    if (!idx[e]) { idx[e] = Object.assign({}, c, { grupos: (c.grupos || []).slice() }); out.push(idx[e]); return; }
    (c.grupos || []).forEach(g => { if (idx[e].grupos.indexOf(g) === -1) idx[e].grupos.push(g); });
    if (!idx[e].puesto && c.puesto) idx[e].puesto = c.puesto;
  });
  return out;
}

/* ------------------- Selección de cursos del docente ------------------- */

function leerCursosSync_() {
  try { const a = JSON.parse(PropertiesService.getUserProperties().getProperty(CLAVE_CURSOS_SYNC_) || '[]'); return Array.isArray(a) ? a : []; }
  catch (e) { return []; }
}

/** Guarda qué grupos de alumnos sincroniza el docente (manual y diaria). */
function guardarCursosSync(ids) {
  const validos = {};
  const email = correoUsuarioActual_();
  (esAdmin_(email) ? leerCursos_() : cursosDeDocente_(email)).forEach(c => { validos[c.id] = true; });
  const lista = (ids || []).filter(id => validos[id]);
  PropertiesService.getUserProperties().setProperty(CLAVE_CURSOS_SYNC_, JSON.stringify(lista));
  return lista;
}

/** Endpoint: cursos elegibles del usuario actual (para refrescar el menú). */
function getCursosSync() { return cursosElegibles_(correoUsuarioActual_()); }

/** Cursos que el docente puede elegir para sincronizar, con su marca actual. */
function cursosElegibles_(email) {
  const sel = leerCursosSync_();
  return (esAdmin_(email) ? leerCursos_() : cursosDeDocente_(email))
    .map(c => ({ id: c.id, nombre: c.nombre, marcado: sel.indexOf(c.id) !== -1 }));
}

/* ----------------------- Bajas del alumnado ----------------------- */

function leerBajasAlumnado_() {
  const a = leerTrozos_(PROP_BAJAS_ALU_PREFIJO, PROP_BAJAS_ALU_NUM, CACHE_BAJAS_ALU);
  return Array.isArray(a) ? a : [];
}

/**
 * Compara un curso antes/después y anota como baja las etiquetas que alguien
 * deja de tener: alumnos quitados (etiqueta del curso), docentes quitados
 * («Profesorado <curso>»), y todo el curso si se renombra o se borra.
 * Quien vuelve a tener una etiqueta sale de las bajas de esa etiqueta.
 */
function registrarBajasCurso_(previo, nuevo) {
  const pares = c => {
    const out = {};
    if (!c) return out;
    const add = (e, g) => { e = low_(e); if (e) (out[e] = out[e] || {})[g] = true; };
    (c.alumnos || []).forEach(a => add(a.email, c.nombre));
    [c.tutor].concat(c.profesores || []).forEach(e => add(e, etqProfesorado_(c.nombre)));
    return out;
  };
  const antes = pares(previo), despues = pares(nuevo);
  const ahora = Date.now();
  const bajas = {};
  leerBajasAlumnado_().forEach(b => { bajas[low_(b.email)] = { grupos: b.grupos || [], ts: b.ts || ahora }; });
  // Quita de las bajas lo que vuelve a estar.
  Object.keys(despues).forEach(e => {
    if (!bajas[e]) return;
    bajas[e].grupos = bajas[e].grupos.filter(g => !despues[e][g]);
  });
  // Añade lo que se pierde.
  Object.keys(antes).forEach(e => {
    Object.keys(antes[e]).forEach(g => {
      if (despues[e] && despues[e][g]) return;
      const b = bajas[e] || (bajas[e] = { grupos: [], ts: ahora });
      if (b.grupos.indexOf(g) === -1) b.grupos.push(g);
      b.ts = ahora;
    });
  });
  const lista = Object.keys(bajas).filter(e => bajas[e].grupos.length)
    .map(e => ({ email: e, grupos: bajas[e].grupos, ts: bajas[e].ts }))
    .filter(b => (ahora - b.ts) < CADUCIDAD_BAJAS_)
    .sort((a, b) => b.ts - a.ts).slice(0, 1000);
  guardarTrozos_(PROP_BAJAS_ALU_PREFIJO, PROP_BAJAS_ALU_NUM, CACHE_BAJAS_ALU, lista);
}

/* ------------------------------- API ------------------------------- */

/** Datos de la pestaña Alumnado: todos los cursos (admin) o los suyos (tutor/a). */
function getAlumnado() {
  const email = correoUsuarioActual_();
  const admin = esAdmin_(email);
  if (!admin && !esMiembroClaustro_(email)) throw new Error('NO_AUTORIZADO');
  const cursos = admin ? leerCursos_() : cursosDeTutor_(email);
  const claustro = leerContactosCentroStore_()
    .filter(c => c && c.email)
    .map(c => ({ nombre: c.nombre || '', apellidos: c.apellidos || '', email: low_(c.email), puesto: c.puesto || '' }));
  return { esAdmin: admin, yo: low_(email), cursos: cursos, claustro: claustro };
}

/**
 * Crea o actualiza un curso.
 *  - Admin: todo, incluido el tutor/a.
 *  - Docente: crea cursos propios (queda como tutor/a) y edita los suyos
 *    (nombre, alumnado y profesorado); no puede cambiar el tutor/a.
 * Usa un bloqueo para que dos docentes guardando a la vez no se pisen.
 */
function guardarCurso(curso) {
  const email = correoUsuarioActual_();
  const admin = esAdmin_(email);
  if (!admin && !esMiembroClaustro_(email)) throw new Error('NO_AUTORIZADO');
  curso = curso || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const cursos = leerCursos_();
    const idx = curso.id ? cursos.findIndex(c => c.id === curso.id) : -1;
    const previo = idx >= 0 ? cursos[idx] : null;
    if (curso.id && !previo) throw new Error('El curso ya no existe. Recarga la página.');
    if (!admin && previo && low_(previo.tutor) !== low_(email)) throw new Error('NO_AUTORIZADO');

    const nombre = String(curso.nombre || '').trim();
    if (!nombre) throw new Error('Pon un nombre al curso.');
    if (cursos.some((c, i) => i !== idx && low_(c.nombre) === low_(nombre))) {
      throw new Error('Ya existe un curso llamado «' + nombre + '».');
    }
    const tutor = admin ? low_(curso.tutor) : (previo ? previo.tutor : low_(email));

    const profSet = {};
    const profesores = (curso.profesores || []).map(low_)
      .filter(e => e && e !== tutor && !profSet[e] && (profSet[e] = true));

    const aluSet = {};
    const alumnos = [];
    (curso.alumnos || []).forEach(a => {
      const e = low_(a && a.email);
      const n = String((a && a.nombre) || '').trim(), ap = String((a && a.apellidos) || '').trim();
      if (!e && !n && !ap) return;
      if (e && aluSet[e]) return;
      if (e) aluSet[e] = true;
      alumnos.push({ nombre: n, apellidos: ap, email: e });
    });

    const limpio = { id: previo ? previo.id : Utilities.getUuid(), nombre: nombre, tutor: tutor, profesores: profesores, alumnos: alumnos };
    if (previo) cursos[idx] = limpio; else cursos.push(limpio);
    cursos.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es', { numeric: true }));
    guardarCursos_(cursos);
    registrarBajasCurso_(previo, limpio);
    return limpio;
  } finally {
    lock.releaseLock();
  }
}

/** Elimina un curso (admin, o su tutor/a). */
function eliminarCurso(id) {
  const email = correoUsuarioActual_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const cursos = leerCursos_();
    const previo = cursos.filter(c => c.id === id)[0];
    if (!previo) return true;
    if (!esAdmin_(email) && low_(previo.tutor) !== low_(email)) throw new Error('NO_AUTORIZADO');
    guardarCursos_(cursos.filter(c => c.id !== id));
    registrarBajasCurso_(previo, null);
    return true;
  } finally {
    lock.releaseLock();
  }
}
