/**
 * Classroom.gs — Importar alumnado desde Google Classroom.
 *
 * Usa el servicio avanzado «Classroom» (API v1) como el docente que accede:
 * solo ve SUS clases (en las que es profesor/a) y el alumnado de esas clases.
 * Nada se guarda aquí: el docente revisa las filas y pulsa «Guardar curso»,
 * donde se validan como cualquier otro alumnado.
 */

const SCOPES_CLASSROOM_ = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/classroom.profile.emails'
];

/**
 * Enlace para que el usuario conceda los permisos de Classroom si le faltan
 * (p. ej. autorizó la app antes de añadir Classroom o desmarcó esas casillas en
 * la pantalla de permisos de Google). Devuelve '' si no falta nada.
 */
function enlacePermisosClassroom_() {
  let info;
  try { info = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL, SCOPES_CLASSROOM_); }
  catch (e) { info = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL); }
  return info.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED ? (info.getAuthorizationUrl() || '') : '';
}

/** Ejecuta fn traduciendo la falta de permisos de Classroom a PERMISO_CLASSROOM|<enlace>. */
function conPermisosClassroom_(fn) {
  const falta = enlacePermisosClassroom_();
  if (falta) throw new Error('PERMISO_CLASSROOM|' + falta);
  try { return fn(); }
  catch (e) {
    const m = String(e && e.message);
    if (!/has not been used|is disabled/i.test(m) && /insufficient|scope|PERMISSION_DENIED|403|authoriz/i.test(m)) {
      let url = '';
      try { url = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL).getAuthorizationUrl() || ''; } catch (e2) {}
      throw new Error('PERMISO_CLASSROOM|' + url);
    }
    throw e;
  }
}

/** Clases activas en las que el usuario es profesor/a: [{id, nombre}]. */
function getClassroomCursos() {
  if (!esDocente_(correoUsuarioActual_())) throw new Error('NO_AUTORIZADO');
  return conPermisosClassroom_(leerClassroomCursos_);
}

function leerClassroomCursos_() {
  const out = [];
  let token = null;
  do {
    const r = conReintentos_(function () {
      return Classroom.Courses.list({ teacherId: 'me', courseStates: ['ACTIVE'], pageSize: 100, pageToken: token });
    });
    (r.courses || []).forEach(c => {
      out.push({ id: c.id, nombre: [c.name, c.section].filter(Boolean).join(' · ') });
    });
    token = r.nextPageToken;
  } while (token);
  return out.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
}

/** Alumnado de una clase de Classroom: [{nombre, apellidos, email}]. */
function getClassroomAlumnos(courseId) {
  if (!esDocente_(correoUsuarioActual_())) throw new Error('NO_AUTORIZADO');
  courseId = String(courseId || '');
  if (!/^\d+$/.test(courseId)) throw new Error('Clase no válida.');
  return conPermisosClassroom_(function () { return leerClassroomAlumnos_(courseId); });
}

function leerClassroomAlumnos_(courseId) {
  const out = [];
  let token = null;
  do {
    const r = conReintentos_(function () {
      return Classroom.Courses.Students.list(courseId, { pageSize: 100, pageToken: token });
    });
    (r.students || []).forEach(s => {
      const p = s.profile || {}, n = p.name || {};
      let nombre = n.givenName || '', apellidos = n.familyName || '';
      if (!apellidos && n.fullName) { const sp = separarNombre_(n.fullName); nombre = sp.nombre; apellidos = sp.apellidos; }
      out.push({ nombre: nombre, apellidos: apellidos, email: String(p.emailAddress || '').toLowerCase() });
    });
    token = r.nextPageToken;
  } while (token);
  return out.sort((a, b) => (a.apellidos || '\uffff').localeCompare(b.apellidos || '\uffff', 'es', { sensitivity: 'base' }) ||
    a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
}
