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
 *   { id, nombre, tutor: email, profesores: [email], alumnos: [{nombre, apellidos, email, alias}] }
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
  if (MEMO_.cursos) return MEMO_.cursos;
  return (MEMO_.cursos = (leerTrozos_(PROP_ALUMNADO_PREFIJO, PROP_ALUMNADO_NUM, CACHE_ALUMNADO) || []).map(desempaquetarCurso_));
}

function guardarCursos_(lista) {
  MEMO_.cursos = lista || [];
  guardarTrozos_(PROP_ALUMNADO_PREFIJO, PROP_ALUMNADO_NUM, CACHE_ALUMNADO, (lista || []).map(empaquetarCurso_));
}

/* ------------------------ Formato compacto ------------------------ *
 * Para que quepan centros grandes (1000+ alumnos) en el almacén interno, los
 * datos se guardan compactos (≈ la mitad de espacio):
 *  - claves de una letra y alumnos como arrays [nombre, apellidos, correo];
 *  - el dominio «@g.educaand.es» se omite (se repone al leer);
 *  - se quitan los valores vacíos del final.
 * La lectura acepta también el formato antiguo (objetos), así que no hace
 * falta migrar: se compacta solo al volver a guardar. */

const DOMINIO_ = '@g.educaand.es';

function empaquetarEmail_(e) {
  e = low_(e);
  return e.slice(-DOMINIO_.length) === DOMINIO_ ? e.slice(0, -DOMINIO_.length) : e;
}

function desempaquetarEmail_(e) {
  e = String(e || '');
  return e && e.indexOf('@') === -1 ? e + DOMINIO_ : e;
}

/** Quita los elementos vacíos del final de un array. */
function recortar_(arr) {
  while (arr.length && (arr[arr.length - 1] === '' || arr[arr.length - 1] == null)) arr.pop();
  return arr;
}

function empaquetarCurso_(c) {
  return {
    i: c.id, n: c.nombre, t: empaquetarEmail_(c.tutor),
    p: (c.profesores || []).map(empaquetarEmail_),
    a: (c.alumnos || []).map(a => recortar_([a.nombre || '', a.apellidos || '', empaquetarEmail_(a.email), a.alias || '']))
  };
}

function desempaquetarCurso_(c) {
  if (!c || !c.a) return c;   // formato antiguo
  return {
    id: c.i, nombre: c.n, tutor: desempaquetarEmail_(c.t),
    profesores: (c.p || []).map(desempaquetarEmail_),
    alumnos: c.a.map(a => ({ nombre: a[0] || '', apellidos: a[1] || '', email: desempaquetarEmail_(a[2]), alias: a[3] || '' }))
  };
}

/** Espacio usado del almacén interno (bytes aprox.) y límite (500 KB). */
function usoAlmacen_() {
  const props = PropertiesService.getScriptProperties().getProperties();
  let bytes = 0;
  Object.keys(props).forEach(k => { bytes += Utilities.newBlob(k + String(props[k])).getBytes().length; });
  return { bytes: bytes, limite: 500 * 1024 };
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
  const k = 'rol:' + low_(email);
  if (MEMO_[k] !== undefined) return MEMO_[k];
  let rol = '';
  if (esAdmin_(email)) rol = 'admin';
  else if (esMiembroClaustro_(email)) rol = 'profesor';
  else if (esAlumno_(email)) rol = 'alumno';
  return (MEMO_[k] = rol);
}

/** ¿Es docente (admin o claustro)? */
function esDocente_(email) { const r = rolDe_(email); return r === 'admin' || r === 'profesor'; }

/** ¿Puede sincronizar «los contactos del centro» (lo que le corresponda)? */
function puedeSincronizarCentro_(email) { return !!rolDe_(email); }

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
      out.push({ nombre: a.nombre || '', apellidos: a.apellidos || '', alias: a.alias || '', email: low_(a.email), grupos: [curso.nombre], alumno: true });
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
      out.push({ nombre: a.nombre || '', apellidos: a.apellidos || '', alias: a.alias || '', email: low_(a.email), grupos: [curso.nombre], alumno: true });
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
  if (!esDocente_(email)) throw new Error('NO_AUTORIZADO');
  (esAdmin_(email) ? leerCursos_() : cursosDeDocente_(email)).forEach(c => { validos[c.id] = true; });
  const lista = (ids || []).filter(id => validos[id]);
  PropertiesService.getUserProperties().setProperty(CLAVE_CURSOS_SYNC_, JSON.stringify(lista));
  return lista;
}

/** Endpoint: cursos elegibles del usuario actual (para refrescar el menú). */
function getCursosSync() {
  const email = correoUsuarioActual_();
  return esDocente_(email) ? cursosElegibles_(email) : [];
}

/** Cursos que el docente puede elegir para sincronizar, con su marca actual. */
function cursosElegibles_(email) {
  const sel = leerCursosSync_();
  return (esAdmin_(email) ? leerCursos_() : cursosDeDocente_(email))
    .map(c => ({ id: c.id, nombre: c.nombre, marcado: sel.indexOf(c.id) !== -1 }));
}

/* ----------------------- Bajas del alumnado ----------------------- */

function leerBajasAlumnado_(fresco) {
  const a = leerTrozos_(PROP_BAJAS_ALU_PREFIJO, PROP_BAJAS_ALU_NUM, CACHE_BAJAS_ALU, null, fresco);
  if (!Array.isArray(a)) return [];
  // Compacto: [correo, [etiquetas], ts en segundos, 1 si era alumno/a]
  return a.map(b => Array.isArray(b)
    ? { email: desempaquetarEmail_(b[0]), grupos: b[1] || [], ts: (b[2] || 0) * 1000, alumno: !!b[3] }
    : b);
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
  leerBajasAlumnado_(true).forEach(b => { bajas[low_(b.email)] = { grupos: b.grupos || [], ts: b.ts || ahora, alumno: !!b.alumno }; });
  // Correos que eran alumnado del curso (para borrarlos del profesorado).
  const eraAlumno = {};
  ((previo && previo.alumnos) || []).forEach(a => { if (a.email) eraAlumno[low_(a.email)] = true; });
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
      if (eraAlumno[e]) b.alumno = true;
      b.ts = ahora;
    });
  });
  const lista = Object.keys(bajas).filter(e => bajas[e].grupos.length)
    .map(e => ({ email: e, grupos: bajas[e].grupos, ts: bajas[e].ts, alumno: bajas[e].alumno || undefined }))
    .filter(b => (ahora - b.ts) < CADUCIDAD_BAJAS_)
    .sort((a, b) => b.ts - a.ts).slice(0, 1500);
  guardarTrozos_(PROP_BAJAS_ALU_PREFIJO, PROP_BAJAS_ALU_NUM, CACHE_BAJAS_ALU,
    lista.map(b => recortar_([empaquetarEmail_(b.email), b.grupos, Math.round(b.ts / 1000), b.alumno ? 1 : ''])));
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
  return { esAdmin: admin, yo: low_(email), cursos: cursos, claustro: claustro, uso: admin ? usoAlmacen_() : null };
}

/** Lectura sin memoria ni caché (dentro del bloqueo, antes de modificar). */
function leerCursosFrescos_() {
  return (MEMO_.cursos = (leerTrozos_(PROP_ALUMNADO_PREFIJO, PROP_ALUMNADO_NUM, CACHE_ALUMNADO, null, true) || []).map(desempaquetarCurso_));
}

/* Límites (evitan que un error o un abuso llene el almacén compartido). */
const LIM_ = { cursosPorDocente: 30, alumnosPorCurso: 80, profesPorCurso: 80, texto: 80, nombreCurso: 60 };
const RE_ALUMNO_ = /^[^@\s]+@g\.educaand\.es$/;

/** Etiquetas reservadas: las del claustro y la configuración (en minúsculas). */
function etiquetasReservadas_() {
  const set = { mycontacts: true, starred: true, friends: true, family: true, coworkers: true, blocked: true };
  gruposDelCentro_().forEach(g => { set[low_(g)] = true; });
  etiquetasSugeridasDe_((getConfig_() || {}).etiquetas).forEach(g => { set[low_(g)] = true; });
  return set;
}

/**
 * Crea o actualiza un curso.
 *  - Admin: todo, incluido el tutor/a.
 *  - Docente: crea cursos propios (queda como tutor/a) y edita los suyos
 *    (nombre, alumnado y profesorado); no puede cambiar el tutor/a.
 * Valida en el servidor: nombre (no puede coincidir con etiquetas del claustro),
 * correos del alumnado @g.educaand.es, profesorado del claustro y límites de
 * tamaño. Usa el bloqueo del script y relee sin caché antes de modificar.
 * Devuelve { curso, cursosSync } (para refrescar el menú sin otra llamada).
 */
function guardarCurso(curso) {
  const email = correoUsuarioActual_();
  const admin = esAdmin_(email);
  if (!admin && !esMiembroClaustro_(email)) throw new Error('NO_AUTORIZADO');
  if (!cursoAbiertoPara_(email)) throw new Error('CURSO_CERRADO');
  curso = curso || {};
  const t = v => String(v || '').trim().slice(0, LIM_.texto);

  const nombre = String(curso.nombre || '').trim();
  if (!nombre) throw new Error('Pon un nombre al curso.');
  if (nombre.length > LIM_.nombreCurso) throw new Error('El nombre del curso es demasiado largo (máx. ' + LIM_.nombreCurso + ').');
  if (/^profesorado\s/i.test(nombre) || etiquetasReservadas_()[low_(nombre)]) {
    throw new Error('«' + nombre + '» ya es una etiqueta del claustro o reservada. Elige otro nombre para el curso.');
  }

  const claustro = emailsClaustro_();
  const profSet = {};
  const profesoresIn = (curso.profesores || []).map(low_).filter(e => e && claustro[e] && !profSet[e] && (profSet[e] = true));
  if (profesoresIn.length > LIM_.profesPorCurso) throw new Error('Demasiado profesorado en el curso.');

  const aluSet = {}, alumnos = [], invalidos = [];
  (curso.alumnos || []).forEach(a => {
    const e = low_(a && a.email), n = t(a && a.nombre), ap = t(a && a.apellidos), al = t(a && a.alias);
    if (!e && !n && !ap) return;
    if (e && !RE_ALUMNO_.test(e)) { invalidos.push(e); return; }
    if (e && aluSet[e]) return;
    if (e) aluSet[e] = true;
    alumnos.push(al ? { nombre: n, apellidos: ap, email: e, alias: al } : { nombre: n, apellidos: ap, email: e });
  });
  // Siempre ordenado por apellidos y nombre.
  alumnos.sort((a, b) => (a.apellidos || '\uffff').localeCompare(b.apellidos || '\uffff', 'es', { sensitivity: 'base' }) ||
    a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
  if (invalidos.length) {
    throw new Error('Correos no válidos (deben ser @g.educaand.es): ' + invalidos.slice(0, 5).join(', ') + (invalidos.length > 5 ? '…' : ''));
  }
  if (alumnos.length > LIM_.alumnosPorCurso) throw new Error('Demasiados alumnos en un curso (máx. ' + LIM_.alumnosPorCurso + ').');

  return conBloqueo_(function () {
    const cursos = leerCursosFrescos_();
    const idx = curso.id ? cursos.findIndex(c => c.id === curso.id) : -1;
    const previo = idx >= 0 ? cursos[idx] : null;
    if (curso.id && !previo) throw new Error('El curso ya no existe. Recarga la página.');
    if (!admin && previo && low_(previo.tutor) !== low_(email)) throw new Error('NO_AUTORIZADO');
    if (!admin && !previo && cursos.filter(c => low_(c.tutor) === low_(email)).length >= LIM_.cursosPorDocente) {
      throw new Error('Has alcanzado el máximo de ' + LIM_.cursosPorDocente + ' cursos.');
    }
    if (cursos.some((c, i) => i !== idx && low_(c.nombre) === low_(nombre))) {
      throw new Error('Ya existe un curso llamado «' + nombre + '».');
    }
    let tutor = admin ? low_(curso.tutor) : (previo ? previo.tutor : low_(email));
    if (admin && tutor && !claustro[tutor]) throw new Error('El tutor/a debe estar en el claustro.');
    const profesores = profesoresIn.filter(e => e !== tutor);

    const limpio = { id: previo ? previo.id : Utilities.getUuid(), nombre: nombre, tutor: tutor, profesores: profesores, alumnos: alumnos };

    // Comprobación de espacio antes de escribir.
    const antes = previo ? bytes_(JSON.stringify(empaquetarCurso_(previo))) : 0;
    const despues = bytes_(JSON.stringify(empaquetarCurso_(limpio)));
    const uso = usoAlmacen_();
    if (uso.bytes - antes + despues > uso.limite * 0.95) throw new Error('ALMACEN_LLENO');

    if (previo) cursos[idx] = limpio; else cursos.push(limpio);
    cursos.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es', { numeric: true }));
    guardarCursos_(cursos);
    registrarBajasCurso_(previo, limpio);
    return { curso: limpio, cursosSync: cursosElegibles_(email) };
  });
}

/** Elimina un curso (admin, o su tutor/a si sigue en el claustro). Devuelve los cursosSync. */
function eliminarCurso(id) {
  const email = correoUsuarioActual_();
  if (!esDocente_(email)) throw new Error('NO_AUTORIZADO');
  return conBloqueo_(function () {
    const cursos = leerCursosFrescos_();
    const previo = cursos.filter(c => c.id === id)[0];
    if (previo) {
      if (!esAdmin_(email) && low_(previo.tutor) !== low_(email)) throw new Error('NO_AUTORIZADO');
      guardarCursos_(cursos.filter(c => c.id !== id));
      registrarBajasCurso_(previo, null);
    }
    return { cursosSync: cursosElegibles_(email) };
  });
}
