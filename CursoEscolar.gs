/**
 * CursoEscolar.gs — Caducidad anual y apertura del nuevo curso.
 *
 * - Fecha de corte configurable (por defecto 1 de agosto). Al pasarla empieza
 *   un nuevo curso escolar (p. ej. «2026/27») y el centro queda CERRADO hasta
 *   que un administrador revise el claustro y pulse «Abrir curso».
 * - Al llegar el corte, sin depender de nadie:
 *     · los cursos de alumnado se eliminan (se anotan como bajas);
 *     · cada usuario, con SU disparador diario (o al entrar en la web), se
 *       desvincula: se retiran de sus contactos las etiquetas del centro (los
 *       contactos del claustro se quedan en «Mis contactos»), el profesorado
 *       pierde los contactos de alumnado y se desactiva su sincronización diaria.
 * - Para volver a sincronizar, cada persona pulsa de nuevo el botón de la
 *   sincronización diaria (siempre el mismo mecanismo), solo con el curso abierto.
 * - Rescate: si no queda ningún admin, el propietario del proyecto añade en
 *   «Configuración del proyecto → Propiedades del script» la propiedad
 *   RESCATE_ADMIN con el correo del nuevo admin (se aplica en la siguiente visita).
 */

const CLAVE_CURSO_VINCULADO_ = 'cursoVinculado';   // (UserProperties) curso en que el usuario sincronizó

/** Fecha de corte configurada: { mes (1-12), dia }. */
function corte_() {
  const c = ((getConfig_() || {}).corte) || {};
  return { mes: parseInt(c.mes, 10) || DEFAULTS.corte.mes, dia: parseInt(c.dia, 10) || DEFAULTS.corte.dia };
}

/** Curso escolar al que pertenece una fecha, p. ej. «2026/27». */
function cursoDe_(fecha) {
  const c = corte_();
  const y = fecha.getFullYear();
  const a = fecha >= new Date(y, c.mes - 1, c.dia) ? y : y - 1;
  return a + '/' + String((a + 1) % 100).padStart(2, '0');
}

function cursoActual_() { return cursoDe_(new Date()); }

/**
 * Estado del curso escolar: { actual, abierto, corte }. Aplica el corte si toca
 * (una sola vez por curso) y migra instalaciones sin estos datos (quedan
 * abiertas en el curso actual).
 */
function estadoCurso_() {
  if (MEMO_.estadoCurso) return MEMO_.estadoCurso;
  let cfg = getConfig_();
  const actual = cursoActual_();
  if (!cfg || !cfg.completo) return (MEMO_.estadoCurso = { actual: actual, abierto: true, corte: corte_() });
  if (!cfg.cursoAbierto || !cfg.corteAplicado) {
    cfg = conBloqueo_(function () {
      const c = leerConfig_() || {};
      if (!c.cursoAbierto || !c.corteAplicado) {
        setConfig_(Object.assign({}, c, { cursoAbierto: c.cursoAbierto || actual, corteAplicado: c.corteAplicado || actual }));
      }
      return getConfig_();
    });
  }
  if (cfg.corteAplicado !== actual) { aplicarCorte_(actual); cfg = getConfig_(); }
  return (MEMO_.estadoCurso = { actual: actual, abierto: cfg.cursoAbierto === actual, corte: corte_() });
}

/** ¿Está el curso abierto para este usuario? (los admin siempre pueden). */
function cursoAbiertoPara_(email) { return esAdmin_(email) || estadoCurso_().abierto; }

/** Cierra el curso anterior: elimina los cursos de alumnado (anotando bajas). */
function aplicarCorte_(actual) {
  conBloqueo_(function () {
    const cfg = leerConfig_() || {};
    if (cfg.corteAplicado === actual) return;
    leerCursosFrescos_().forEach(c => registrarBajasCurso_(c, null));
    guardarCursos_([]);
    setConfig_(Object.assign({}, cfg, { corteAplicado: actual }));
  });
}

/** Aplica el rescate de administrador si el propietario lo ha pedido. */
function aplicarRescateAdmin_() {
  const props = PropertiesService.getScriptProperties();
  const r = String(props.getProperty('RESCATE_ADMIN') || '').trim().toLowerCase();
  if (!r) return;
  conBloqueo_(function () {
    props.setProperty(PROP_ADMIN, r);
    props.deleteProperty('RESCATE_ADMIN');
    setAdminsExtra_(getAdminsExtra_());   // quita al nuevo principal de los adicionales
  });
}

/* ------------------------------- API (admin) ------------------------------- */

/** Abre el curso actual (tras revisar el claustro). */
function abrirCurso() {
  exigirAdmin_();
  const est = estadoCurso_();
  conBloqueo_(function () {
    setConfig_(Object.assign({}, leerConfig_() || {}, { cursoAbierto: est.actual }));
  });
  MEMO_.estadoCurso = null;
  return estadoCurso_();
}

/** Cambia la fecha de corte (día y mes). */
function guardarCorte(mes, dia) {
  exigirAdmin_();
  mes = parseInt(mes, 10); dia = parseInt(dia, 10);
  const maxDia = new Date(2001, mes, 0).getDate();
  if (!(mes >= 1 && mes <= 12) || !(dia >= 1 && dia <= maxDia)) throw new Error('Fecha de corte no válida.');
  conBloqueo_(function () {
    setConfig_(Object.assign({}, leerConfig_() || {}, { corte: { mes: mes, dia: dia } }));
  });
  MEMO_.estadoCurso = null;
  return estadoCurso_();
}

/* ------------------------- Vinculación del usuario ------------------------- */

function leerCursoVinculado_() { return PropertiesService.getUserProperties().getProperty(CLAVE_CURSO_VINCULADO_) || ''; }
function marcarCursoVinculado_() { PropertiesService.getUserProperties().setProperty(CLAVE_CURSO_VINCULADO_, cursoActual_()); }

/** ¿Tiene el usuario pendiente desvincularse de un curso anterior? */
function vinculacionCaducada_() {
  const v = leerCursoVinculado_();
  return !!v && v !== cursoActual_();
}

/**
 * Desvincula al usuario actual del curso anterior: retira las etiquetas del
 * centro de sus contactos (los que se quedan sin etiquetas pasan a «Mis
 * contactos»), elimina los contactos de alumnado si es docente y desactiva su
 * sincronización diaria. Devuelve un resumen.
 */
function desvincularCurso_() {
  const email = correoUsuarioActual_();
  const docente = !esAlumno_(email) || esMiembroClaustro_(email) || esAdmin_(email);
  const low = s => String(s || '').trim().toLowerCase();

  // Etiquetas gestionadas por el centro y correos de alumnado (actuales y dados de baja).
  const etq = {}, alumnos = {};
  const add = g => { if (low(g)) etq[low(g)] = true; };
  gruposDelCentro_().forEach(add);
  etiquetasSugeridasDe_((getConfig_() || {}).etiquetas).forEach(add);
  leerBajas_().forEach(b => (b.grupos || []).forEach(add));
  leerBajasAlumnado_().forEach(b => {
    (b.grupos || []).forEach(add);
    if (b.alumno) alumnos[low(b.email)] = true;
  });
  leerCursos_().forEach(c => {
    add(c.nombre); add(etqProfesorado_(c.nombre));
    (c.alumnos || []).forEach(a => { if (a.email) alumnos[low(a.email)] = true; });
  });

  const resumen = { actualizados: 0, eliminados: 0, errores: 0 };
  const nombrePorRN = nombresDeGrupos_();
  const vaciadas = {}, aActualizar = [], aBorrar = [];
  obtenerTodosLosContactos_().forEach(c => {
    const membs = c.memberships || [];
    const nombreDe = m => low(nombrePorRN[m.contactGroupMembership && m.contactGroupMembership.contactGroupResourceName]);
    const afectadas = membs.filter(m => m.contactGroupMembership && etq[nombreDe(m)]);
    if (!afectadas.length) return;
    afectadas.forEach(m => { vaciadas[nombreDe(m)] = true; });
    const emails = (c.emailAddresses || []).map(e => low(e.value));
    if (docente && emails.some(e => alumnos[e])) { aBorrar.push(c.resourceName); return; }
    const nuevas = membs.filter(m => afectadas.indexOf(m) === -1);
    if (!nuevas.some(m => m.contactGroupMembership)) nuevas.push(MEMB_MYCONTACTS_);
    aActualizar.push({ resourceName: c.resourceName, persona: { resourceName: c.resourceName, etag: c.etag, memberships: nuevas } });
  });

  if (aBorrar.length) {
    const f = ejecutarPorLotes_(aBorrar, 500,
      function (chunk) { People.People.batchDeleteContacts({ resourceNames: chunk }); },
      function (rn) { People.People.deleteContact(rn); });
    resumen.eliminados = aBorrar.length - f.length; resumen.errores += f.length;
  }
  if (aActualizar.length) {
    const f = ejecutarPorLotes_(aActualizar, 200,
      function (chunk) {
        const map = {};
        chunk.forEach(u => { map[u.resourceName] = u.persona; });
        People.People.batchUpdateContacts({ contacts: map, updateMask: 'memberships', readMask: 'names' });
      },
      function (u) { People.People.updateContact(u.persona, u.resourceName, { updatePersonFields: 'memberships' }); });
    resumen.actualizados = aActualizar.length - f.length; resumen.errores += f.length;
  }
  try { eliminarGruposVacios_(vaciadas); } catch (e) { /* silencioso */ }

  desactivarSincronizacionDiaria_();
  const up = PropertiesService.getUserProperties();
  up.deleteProperty(CLAVE_CURSO_VINCULADO_);
  up.deleteProperty(CLAVE_CURSOS_SYNC_);
  return resumen;
}

/** Endpoint: el usuario entra en la web con la vinculación caducada. */
function desvincularCursoAnterior() {
  if (!vinculacionCaducada_()) return null;
  return desvincularCurso_();
}

/** Correo al usuario cuando su disparador lo desvincula por fin de curso. */
function notificarFinDeCurso_(cursoAnterior) {
  const centro = nombreCentro_();
  MailApp.sendEmail({
    to: correoUsuarioActual_(),
    subject: 'Fin de curso: sincronización de contactos desactivada',
    htmlBody:
      '<p>¡Hola!</p>' +
      '<p>Ha terminado el curso <strong>' + cursoAnterior + '</strong> en <strong>' + centro + '</strong>, así que se ha ' +
      'desactivado tu sincronización diaria de contactos y se han retirado sus etiquetas (tus contactos se conservan).</p>' +
      '<p>Si sigues en el centro, cuando empiece el nuevo curso entra en la aplicación y vuelve a activar la ' +
      'sincronización diaria.</p>' +
      '<p>Gracias por usar <strong>' + PARAMS.nombreApp + '</strong>.</p>'
  });
}
