/**
 * Alumnado.gs — Cursos (tutorías) con su alumnado y su equipo docente.
 *
 * Dos niveles de administración:
 *  - Súper admin (esAdmin_): crea/borra cursos, asigna el tutor y gestiona todos.
 *  - Tutor/a: gestiona SOLO el alumnado y el profesorado de su(s) curso(s).
 *
 * El alumnado de un curso puede entrar en la web app y sincronizar únicamente a
 * sus compañeros, a su tutor/a y al profesorado que el tutor haya elegido.
 *
 * Formato de cada curso:
 *   { id, nombre, tutor: email, profesores: [email], alumnos: [{nombre, apellidos, email}] }
 */

const PROP_ALUMNADO_PREFIJO = 'alumnado_';
const PROP_ALUMNADO_NUM = 'alumnadoNumTrozos';
const CACHE_ALUMNADO = 'cacheAlumnado_v1';

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
 * Lista de contactos que sincroniza un alumno: sus compañeros de curso, su
 * tutor/a y el profesorado elegido por el tutor. Del profesorado se toman
 * nombre, apellidos y puesto del claustro (sin teléfono).
 */
function contactosDeClase_(email) {
  const yo = low_(email);
  const claustro = {};
  leerContactosCentroStore_().forEach(c => { if (c && c.email) claustro[low_(c.email)] = c; });

  const out = [];
  cursosDeAlumno_(yo).forEach(curso => {
    const etqClase = 'Clase ' + curso.nombre;
    const etqProfes = 'Profesorado ' + curso.nombre;
    (curso.alumnos || []).forEach(a => {
      if (!a.email || low_(a.email) === yo) return;
      out.push({ nombre: a.nombre || '', apellidos: a.apellidos || '', email: low_(a.email), grupos: [etqClase] });
    });
    const docentes = [curso.tutor].concat(curso.profesores || []).map(low_).filter(String);
    docentes.forEach((e, i) => {
      const c = claustro[e] || {};
      const esTutor = i === 0 && e === low_(curso.tutor);
      out.push({
        nombre: c.nombre || '', apellidos: c.apellidos || '', email: e,
        puesto: esTutor ? 'Tutor/a ' + curso.nombre : (c.puesto || ''),
        grupos: [etqProfes]
      });
    });
  });
  return out;
}

/* ------------------------------- API ------------------------------- */

/** Datos de la pestaña Alumnado: todos los cursos (admin) o los suyos (tutor). */
function getAlumnado() {
  const email = correoUsuarioActual_();
  const admin = esAdmin_(email);
  const cursos = admin ? leerCursos_() : cursosDeTutor_(email);
  if (!admin && !cursos.length) throw new Error('NO_AUTORIZADO');
  const claustro = leerContactosCentroStore_()
    .filter(c => c && c.email)
    .map(c => ({ nombre: c.nombre || '', apellidos: c.apellidos || '', email: low_(c.email), puesto: c.puesto || '' }));
  return { esAdmin: admin, yo: low_(email), cursos: cursos, claustro: claustro };
}

/**
 * Crea o actualiza un curso. El admin puede cambiarlo todo; el tutor solo el
 * alumnado y el profesorado de SU curso (nombre y tutor se conservan).
 * Usa un bloqueo para que dos tutores guardando a la vez no se pisen.
 */
function guardarCurso(curso) {
  const email = correoUsuarioActual_();
  const admin = esAdmin_(email);
  curso = curso || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const cursos = leerCursos_();
    const idx = cursos.findIndex(c => c.id && c.id === curso.id);
    const previo = idx >= 0 ? cursos[idx] : null;
    if (!admin && (!previo || low_(previo.tutor) !== low_(email))) throw new Error('NO_AUTORIZADO');

    const nombre = admin ? String(curso.nombre || '').trim() : previo.nombre;
    if (!nombre) throw new Error('Pon un nombre al curso.');
    if (cursos.some((c, i) => i !== idx && low_(c.nombre) === low_(nombre))) {
      throw new Error('Ya existe un curso llamado «' + nombre + '».');
    }
    const tutor = admin ? low_(curso.tutor) : previo.tutor;

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
    return limpio;
  } finally {
    lock.releaseLock();
  }
}

/** Elimina un curso (solo admin). */
function eliminarCurso(id) {
  exigirAdmin_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    guardarCursos_(leerCursos_().filter(c => c.id !== id));
    return true;
  } finally {
    lock.releaseLock();
  }
}
