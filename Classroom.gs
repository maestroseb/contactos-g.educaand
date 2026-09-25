/**
 * Classroom.gs — Importar alumnado desde Google Classroom.
 *
 * Usa el servicio avanzado «Classroom» (API v1) como el docente que accede:
 * solo ve SUS clases (en las que es profesor/a) y el alumnado de esas clases.
 * Nada se guarda aquí: el docente revisa las filas y pulsa «Guardar curso»,
 * donde se validan como cualquier otro alumnado.
 */

/** Clases activas en las que el usuario es profesor/a: [{id, nombre}]. */
function getClassroomCursos() {
  if (!esDocente_(correoUsuarioActual_())) throw new Error('NO_AUTORIZADO');
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
