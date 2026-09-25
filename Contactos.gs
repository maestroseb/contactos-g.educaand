/**
 * Contactos.gs — Núcleo de sincronización con la People API.
 *
 * Portado de crearContactos.gs / Mis Contactos.gs del proyecto de hoja, pero
 * trabajando con OBJETOS de contacto normalizados (ver DatosCentral.gs) en
 * lugar de leer celdas. Se ejecuta SIEMPRE como el usuario que accede, así que
 * escribe en SUS propios Google Contacts.
 */

/**
 * Sincroniza. Punto de entrada llamado desde la web y desde el disparador diario.
 * @param {Object} opciones
 *   - incluirCentro {boolean}  sincronizar lo que le corresponde del centro
 *   - gruposCentro {string[]}  si se indica, solo estos grupos del claustro
 *   - soloCursos {boolean}     (docentes) no traer el claustro, solo sus grupos de alumnos
 *   - cursos {string[]}        (docentes) ids de grupos de alumnos a sincronizar (se guardan)
 *   - incluirPropios {boolean} sincronizar los contactos propios del usuario
 * @return {Object} resumen {creados, actualizados, sinCambios, omitidos, errores, eliminados}
 *
 * Flujo optimizado: se leen los contactos UNA vez (y otra solo si se fusionaron
 * duplicados), se decide todo en memoria y se escribe en lotes. Un bloqueo por
 * usuario impide dos sincronizaciones a la vez (manual + diaria).
 */
function sincronizar(opciones) {
  opciones = opciones || { incluirCentro: true, incluirPropios: true };

  // Centro: el claustro (profesorado/admin) o su clase (alumnado); el profesorado
  // recibe además los grupos de alumnos que haya elegido.
  const email = correoUsuarioActual_();
  const rol = opciones.incluirCentro ? rolDe_(email) : '';
  if (opciones.incluirCentro && !rol) throw new Error('NO_MIEMBRO');
  if (opciones.incluirCentro && !cursoAbiertoPara_(email)) throw new Error('CURSO_CERRADO');
  const esAlumnoSolo = rol === 'alumno';

  const lock = LockService.getUserLock();
  if (!lock.tryLock(1000)) throw new Error('EN_CURSO');
  try {
    // Si quedó pendiente desvincularse del curso anterior, se hace antes.
    if (opciones.incluirCentro && vinculacionCaducada_()) desvincularCurso_();
    // Selección de grupos de alumnos enviada desde el menú (se recuerda para la diaria).
    if (Array.isArray(opciones.cursos) && !esAlumnoSolo && rol) guardarCursosSync(opciones.cursos);
    let filas = [];
    let pausados = [];
    if (opciones.incluirCentro) {
      if (esAlumnoSolo) {
        filas = contactosDeClase_(email);
      } else {
        const centro = leerContactosCentroStore_();
        // Personas «en pausa»: siguen en el listado pero NO se sincronizan; se les
        // retiran las etiquetas (baja temporal reversible).
        pausados = centro.filter(c => c && c.pausado && c.email).map(c => ({ email: c.email, grupos: c.grupos || [] }));
        let activos = opciones.soloCursos ? [] : centro.filter(c => c && !c.pausado);
        if (opciones.gruposCentro && opciones.gruposCentro.length) {
          const sel = opciones.gruposCentro;
          activos = activos.filter(c => (c.grupos || []).some(g => sel.indexOf(g) !== -1));
        }
        filas = activos.concat(contactosDeCursosDocente_(email));
      }
    }
    if (opciones.incluirPropios) filas = filas.concat(leerContactosPropios_());

    // Una sola fila por correo, uniendo sus etiquetas (claustro + curso + propios).
    let omitidos = 0;
    filas = fusionarPorEmail_(filas.filter(f => {
      const ok = f && f.email && isValidEmail_(String(f.email).trim());
      if (!ok) omitidos++;
      return ok;
    }));

    escribirProgreso_('preparando', 0, filas.length);
    let contactos = obtenerTodosLosContactos_();
    try { if (fusionarDuplicados_(contactos)) contactos = obtenerTodosLosContactos_(); }
    catch (e) { Logger.log('fusionarDuplicados_: ' + e.message); }

    const vaciadas = {};   // etiquetas que esta sincronización puede haber dejado vacías
    const resumen = procesarContactos_(filas, contactos, vaciadas);
    resumen.omitidos += omitidos;
    if (opciones.incluirCentro) {
      try { retirarEtiquetasDeBajas_(filas, pausados, resumen, !esAlumnoSolo, contactos, vaciadas); }
      catch (e) { Logger.log('retirarEtiquetasDeBajas_: ' + e.message); }
    }
    try { eliminarGruposVacios_(vaciadas); } catch (e) { Logger.log('eliminarGruposVacios_: ' + e.message); }
    if (opciones.incluirCentro) marcarCursoVinculado_();
    return resumen;
  } finally {
    limpiarProgreso_();
    lock.releaseLock();
  }
}

/* --------------------------- Etiquetas (grupos) --------------------------- */

/** Etiquetas del usuario (paginadas; la API devuelve 30 por defecto). Memoria por ejecución. */
function listarGrupos_() {
  if (MEMO_.grupos) return MEMO_.grupos;
  let lista = [], token = null;
  do {
    const r = People.ContactGroups.list({ pageSize: 1000, pageToken: token, groupFields: 'name,groupType,memberCount' });
    if (r.contactGroups) Array.prototype.push.apply(lista, r.contactGroups);
    token = r.nextPageToken;
  } while (token);
  return (MEMO_.grupos = lista);
}

/** resourceName de la etiqueta con ese nombre, creándola si no existe. */
function idGrupo_(nombre) {
  const g = listarGrupos_().filter(x => x.name === nombre)[0];
  if (g) return g.resourceName;
  const creado = conReintentos_(function () { return People.ContactGroups.create({ contactGroup: { name: nombre } }); });
  listarGrupos_().push({ resourceName: creado.resourceName, name: nombre, groupType: 'USER_CONTACT_GROUP' });
  return creado.resourceName;
}

/** Mapa resourceName -> nombre de etiqueta. */
function nombresDeGrupos_() {
  const m = {};
  listarGrupos_().forEach(g => { m[g.resourceName] = g.name; });
  return m;
}

/**
 * Retira de los contactos de Google del usuario las etiquetas de las personas
 * dadas de baja en el claustro o en un curso (registros de bajas) y de las que
 * están «en pausa». NO borra el contacto ni sus demás datos. Solo actúa sobre
 * contactos que NO se acaban de sincronizar (a esos procesarContactos_ ya les
 * ha dejado exactamente sus etiquetas actuales), así que sus etags son válidos.
 *
 * Si `borrarAlumnos` (sincroniza un docente), el alumnado dado de baja de un
 * curso que ya no le llega por ninguna vía se ELIMINA por completo de sus
 * contactos (solo si aún lleva la etiqueta del curso, es decir, si llegó por la
 * sincronización). Entre compañeros solo se retira la etiqueta.
 */
function retirarEtiquetasDeBajas_(filasActuales, pausados, resumen, borrarAlumnos, contactos, vaciadas) {
  const bajasAlu = leerBajasAlumnado_();
  const bajas = leerBajas_().concat(bajasAlu, pausados || []);
  if (!bajas.length) return;

  const low = s => String(s || '').trim().toLowerCase();
  const activos = {};
  (filasActuales || []).forEach(f => { activos[low(f.email)] = true; });

  // email -> { etiquetaEnMinusculas: true } a retirar.
  const porEmail = {};
  bajas.forEach(b => {
    const e = low(b.email);
    if (!e || activos[e]) return;
    const set = porEmail[e] || (porEmail[e] = {});
    (b.grupos || []).forEach(g => { if (low(g)) set[low(g)] = true; });
  });
  if (!Object.keys(porEmail).length) return;

  // Alumnado dado de baja (para borrarlo entero del profesorado).
  const alumnosBaja = {};
  if (borrarAlumnos) bajasAlu.forEach(b => { if (b.alumno) alumnosBaja[low(b.email)] = true; });

  const nombrePorRN = nombresDeGrupos_();
  const aActualizar = [], aBorrar = [];
  contactos.forEach(c => {
    const emails = (c.emailAddresses || []).map(e => low(e.value));
    if (emails.some(e => activos[e])) return;
    const quitar = {};
    emails.forEach(e => { Object.keys(porEmail[e] || {}).forEach(g => { quitar[g] = true; }); });
    if (!Object.keys(quitar).length) return;

    const membs = c.memberships || [];
    const nombreDe = m => low(nombrePorRN[m.contactGroupMembership && m.contactGroupMembership.contactGroupResourceName]);
    const afectadas = membs.filter(m => m.contactGroupMembership && quitar[nombreDe(m)]);
    if (!afectadas.length) return;                           // no tenía esas etiquetas
    afectadas.forEach(m => { vaciadas[nombreDe(m)] = true; });

    if (emails.some(e => alumnosBaja[e])) { aBorrar.push(c.resourceName); return; }

    const nuevas = membs.filter(m => afectadas.indexOf(m) === -1);
    // Si se queda sin etiquetas, se deja en «Mis contactos» para que no desaparezca.
    if (!nuevas.some(m => m.contactGroupMembership)) nuevas.push(MEMB_MYCONTACTS_);
    aActualizar.push({ resourceName: c.resourceName, persona: { resourceName: c.resourceName, etag: c.etag, memberships: nuevas } });
  });

  if (aBorrar.length) {
    const fallB = ejecutarPorLotes_(aBorrar, 500,
      function (chunk) { People.People.batchDeleteContacts({ resourceNames: chunk }); },
      function (rn) { People.People.deleteContact(rn); });
    resumen.eliminados = (resumen.eliminados || 0) + aBorrar.length - fallB.length;
    resumen.errores += fallB.length;
  }
  if (aActualizar.length) {
    const fall = ejecutarPorLotes_(aActualizar, 200,
      function (chunk) {
        const map = {};
        chunk.forEach(u => { map[u.resourceName] = u.persona; });
        People.People.batchUpdateContacts({ contacts: map, updateMask: 'memberships', readMask: 'names' });
      },
      function (u) { People.People.updateContact(u.persona, u.resourceName, { updatePersonFields: 'memberships' }); });
    resumen.actualizados += (aActualizar.length - fall.length);
    resumen.errores += fall.length;
  }
}

/** Pertenencia al grupo del sistema «Mis contactos» (para que se vean/sincronicen
 *  en el móvil, no solo dentro de una etiqueta). */
const MEMB_MYCONTACTS_ = { contactGroupMembership: { contactGroupResourceName: 'contactGroups/myContacts' } };

/**
 * Crea o actualiza los contactos (sin duplicar). Decide todo en memoria
 * (empareja por correo, no pisa datos que la lista no trae) y solo AL FINAL
 * envía los cambios en LOTES (hasta 200 por llamada), con reintentos y caída a
 * uno-a-uno si un lote falla. Anota en `vaciadas` las etiquetas que pierde algún
 * contacto (candidatas a quedar vacías).
 */
function procesarContactos_(filas, contactosExistentes, vaciadas) {
  const resumen = { creados: 0, actualizados: 0, sinCambios: 0, omitidos: 0, errores: 0 };
  // No se toca el correo en las actualizaciones (es la clave de emparejamiento
  // y así no se borran otros correos que tuviera el contacto).
  const MASK_UPDATE = 'names,phoneNumbers,organizations,memberships,nicknames';

  const emailsExistentes = {};
  contactosExistentes.forEach(c => {
    (c.emailAddresses || []).forEach(e => { emailsExistentes[String(e.value || '').trim().toLowerCase()] = c; });
  });
  const nombrePorRN = nombresDeGrupos_();

  const total = filas.length;
  let hechos = 0;
  const aCrear = [];       // [{ contactPerson: persona }]
  const aActualizar = [];  // [{ resourceName, persona }]

  filas.forEach(f => {
    if (++hechos % 25 === 0) escribirProgreso_('subiendo', hechos, total);
    const email = String(f.email).trim().toLowerCase();
    const grupos = (f.grupos || []).filter(String);
    const nuevasMemb = grupos.map(n => ({ contactGroupMembership: { contactGroupResourceName: idGrupo_(n) } }));

    // En «Mis contactos» además de en sus etiquetas (para el móvil), salvo el alumnado.
    const memb = (f.alumno && grupos.length) ? nuevasMemb
      : (grupos.length ? nuevasMemb.concat([MEMB_MYCONTACTS_]) : [MEMB_MYCONTACTS_]);

    const existente = emailsExistentes[email];
    if (existente) {
      // Actualización NO destructiva: lo que la lista no trae se conserva.
      const persona = {
        resourceName: existente.resourceName,
        etag: existente.etag,
        names: (f.nombre || f.apellidos) ? [{ givenName: f.nombre || '', familyName: f.apellidos || '' }] : (existente.names || []),
        emailAddresses: existente.emailAddresses || [{ type: 'work', value: email }],
        phoneNumbers: f.telefono ? [{ type: 'mobile', value: f.telefono }] : (existente.phoneNumbers || []),
        organizations: f.puesto ? [{ name: f.puesto }] : (existente.organizations || []),
        nicknames: f.alias ? [{ value: f.alias }] : (existente.nicknames || []),
        memberships: grupos.length ? memb : (existente.memberships || [])
      };
      if (esContactoDiferente_(existente, persona)) {
        aActualizar.push({ resourceName: existente.resourceName, persona: persona });
        if (grupos.length) (existente.memberships || []).forEach(m => {
          const n = m.contactGroupMembership && nombrePorRN[m.contactGroupMembership.contactGroupResourceName];
          if (n && grupos.indexOf(n) === -1) vaciadas[n.trim().toLowerCase()] = true;
        });
      } else resumen.sinCambios++;
    } else {
      const persona = {
        names: [{ givenName: f.nombre || '', familyName: f.apellidos || '' }],
        emailAddresses: [{ type: 'work', value: email }],
        memberships: memb
      };
      if (f.telefono) persona.phoneNumbers = [{ type: 'mobile', value: f.telefono }];
      if (f.puesto) persona.organizations = [{ name: f.puesto }];
      if (f.alias) persona.nicknames = [{ value: f.alias }];
      aCrear.push({ contactPerson: persona });
    }
  });

  // --- Envío en lotes (a prueba de errores) ---
  escribirProgreso_('guardando', 1, 1);

  const fallCrear = ejecutarPorLotes_(aCrear, 200,
    function (chunk) { People.People.batchCreateContacts({ contacts: chunk, readMask: 'names' }); },
    function (item) { People.People.createContact(item.contactPerson); });
  resumen.creados = aCrear.length - fallCrear.length;

  const fallAct = ejecutarPorLotes_(aActualizar, 200,
    function (chunk) {
      const map = {};
      chunk.forEach(function (u) { map[u.resourceName] = u.persona; });
      People.People.batchUpdateContacts({ contacts: map, updateMask: MASK_UPDATE, readMask: 'names' });
    },
    function (u) { People.People.updateContact(u.persona, u.resourceName, { updatePersonFields: MASK_UPDATE }); });
  resumen.actualizados = aActualizar.length - fallAct.length;
  resumen.errores = fallCrear.length + fallAct.length;
  escribirProgreso_('fusionando', 1, 1);
  return resumen;
}

/* --------------------- Ejecución por lotes a prueba de errores --------------------- */

/** Reintenta fn con espera creciente SOLO ante errores transitorios (cuota,
 *  5xx). Un error permanente (400, 404, 409…) se lanza al momento. */
function conReintentos_(fn, intentos) {
  intentos = intentos || 4;
  var espera = 600;
  for (var i = 0; i < intentos; i++) {
    try { return fn(); }
    catch (e) {
      var transitorio = /429|RESOURCE_EXHAUSTED|UNAVAILABLE|quota|rate|5\d\d|Internal|backend|timed? ?out/i.test(String(e && e.message));
      if (!transitorio || i === intentos - 1) throw e;
      Utilities.sleep(espera);
      espera *= 2;
    }
  }
}

/**
 * Procesa `items` en lotes de `tam`. Si un lote falla (tras reintentos), cae a
 * procesar sus elementos UNO A UNO para que un solo contacto problemático no
 * tumbe todo. Devuelve el array de elementos que fallaron incluso uno a uno.
 */
function ejecutarPorLotes_(items, tam, opLote, opUno) {
  var fallidos = [];
  for (var i = 0; i < items.length; i += tam) {
    var chunk = items.slice(i, i + tam);
    if (!chunk.length) continue;
    var okLote = true;
    try { conReintentos_(function () { opLote(chunk); }); }
    catch (e) { okLote = false; Logger.log('Lote falló, cae a uno-a-uno: ' + e.message); }
    if (!okLote) {
      chunk.forEach(function (it) {
        try { conReintentos_(function () { opUno(it); }, 2); }
        catch (e2) { fallidos.push(it); Logger.log('Elemento falló: ' + e2.message); }
      });
    }
  }
  return fallidos;
}

/* --------------------------- Progreso de sincronización --------------------------- */

/** Guarda el progreso en la caché del usuario para que la barra lo consulte. */
function escribirProgreso_(fase, hechos, total) {
  try {
    CacheService.getUserCache().put('progresoSync',
      JSON.stringify({ fase: fase, hechos: hechos, total: total }), 600);
  } catch (e) { /* la caché es best-effort */ }
}

/** Endpoint que consulta la barra de progreso. Devuelve {fase,hechos,total} o null. */
function getProgresoSync() {
  try {
    const v = CacheService.getUserCache().get('progresoSync');
    return v ? JSON.parse(v) : null;
  } catch (e) { return null; }
}

/** Limpia el progreso al terminar. */
function limpiarProgreso_() {
  try { CacheService.getUserCache().remove('progresoSync'); } catch (e) {}
}

/* --------------------------- Mis Contactos --------------------------- */

/** Trae los contactos del usuario para mostrarlos/editarlos en la web. */
function getMisContactos() {
  // Solo etiquetas del usuario (no las del sistema: «Mis contactos», destacados…).
  const grupos = {};
  listarGrupos_().forEach(g => { if (g.groupType === 'USER_CONTACT_GROUP') grupos[g.resourceName] = g.name; });

  return obtenerTodosLosContactos_().map(c => ({
    resourceName: c.resourceName,
    etag: c.etag,
    nombre: c.names ? c.names[0].givenName : '',
    apellidos: c.names ? c.names[0].familyName : '',
    alias: c.nicknames ? c.nicknames[0].value : '',
    email: c.emailAddresses ? c.emailAddresses[0].value : '',
    telefono: c.phoneNumbers ? c.phoneNumbers[0].value : '',
    puesto: c.organizations ? c.organizations[0].name : '',
    grupos: (c.memberships || [])
      .filter(m => m.contactGroupMembership)
      .map(m => grupos[m.contactGroupMembership.contactGroupResourceName])
      .filter(Boolean)
  }));
}

/**
 * Aplica en bloque los cambios hechos en la rejilla de «Mis contactos de Google».
 * Solo toca lo que realmente cambió (cada edición trae su propia máscara de
 * campos) y borra en lote. Trabaja SIEMPRE sobre los contactos del usuario que
 * accede. Devuelve un resumen y la lista actualizada.
 *
 * @param {Object} payload
 *   - editados: [{ resourceName, etag, mask, nombre, apellidos, email, telefono, puesto, grupos[] }]
 *   - eliminados: [resourceName]
 */
function guardarMisContactos(payload) {
  payload = payload || {};
  const editados = payload.editados || [];
  const eliminados = payload.eliminados || [];
  const resumen = { actualizados: 0, eliminados: 0, errores: 0 };

  function membershipsDe(grupos) {
    const arr = (grupos || []).filter(String)
      .map(nombre => ({ contactGroupMembership: { contactGroupResourceName: idGrupo_(nombre) } }));
    // Siempre en "Mis contactos" (además de sus etiquetas) para que se vea en el móvil.
    return arr.concat([MEMB_MYCONTACTS_]);
  }

  // Actualizaciones con la máscara exacta de lo que cambió (así nunca se pisan
  // otros campos), agrupadas por máscara y enviadas en lotes de 200.
  const porMascara = {};
  editados.forEach(function (e) {
    if (!e.resourceName || !e.mask) return;
    const persona = { resourceName: e.resourceName, etag: e.etag };
    if (e.mask.indexOf('names') !== -1) persona.names = [{ givenName: e.nombre || '', familyName: e.apellidos || '' }];
    if (e.mask.indexOf('emailAddresses') !== -1) persona.emailAddresses = e.email ? [{ value: e.email }] : [];
    if (e.mask.indexOf('phoneNumbers') !== -1) persona.phoneNumbers = e.telefono ? [{ type: 'mobile', value: e.telefono }] : [];
    if (e.mask.indexOf('organizations') !== -1) persona.organizations = e.puesto ? [{ name: e.puesto }] : [];
    if (e.mask.indexOf('nicknames') !== -1) persona.nicknames = e.alias ? [{ value: e.alias }] : [];
    if (e.mask.indexOf('memberships') !== -1) persona.memberships = membershipsDe(e.grupos);
    (porMascara[e.mask] = porMascara[e.mask] || []).push({ resourceName: e.resourceName, persona: persona });
  });
  Object.keys(porMascara).forEach(function (mask) {
    const items = porMascara[mask];
    const fall = ejecutarPorLotes_(items, 200,
      function (chunk) {
        const map = {};
        chunk.forEach(function (u) { map[u.resourceName] = u.persona; });
        People.People.batchUpdateContacts({ contacts: map, updateMask: mask, readMask: 'names' });
      },
      function (u) { People.People.updateContact(u.persona, u.resourceName, { updatePersonFields: mask }); });
    resumen.actualizados += items.length - fall.length;
    resumen.errores += fall.length;
  });

  // Borrados en lote (con caída a uno-a-uno).
  if (eliminados.length) {
    const fall = ejecutarPorLotes_(eliminados, 500,
      function (chunk) { People.People.batchDeleteContacts({ resourceNames: chunk }); },
      function (rn) { People.People.deleteContact(rn); });
    resumen.eliminados = eliminados.length - fall.length;
    resumen.errores += fall.length;
  }

  try { eliminarGruposVacios_(null); } catch (e2) { /* silencioso */ }
  return { resumen: resumen, lista: getMisContactos() };
}

/* --------------------------- Utilidades --------------------------- */

function obtenerTodosLosContactos_() {
  let contactos = [];
  let pagina = null;
  do {
    const r = People.People.Connections.list('people/me', {
      personFields: 'names,emailAddresses,phoneNumbers,organizations,memberships,nicknames',
      pageToken: pagina,
      pageSize: 1000
    });
    if (r.connections) Array.prototype.push.apply(contactos, r.connections);
    pagina = r.nextPageToken;
  } while (pagina);
  return contactos;
}

function esContactoDiferente_(existente, nuevo) {
  function comp(a, b) { return (a || '').toLowerCase() !== (b || '').toLowerCase(); }
  const ne = existente.names && existente.names[0];
  const nn = nuevo.names && nuevo.names[0];
  if (comp(ne ? ne.givenName : '', nn ? nn.givenName : '')) return true;
  if (comp(ne ? ne.familyName : '', nn ? nn.familyName : '')) return true;
  const ee = existente.emailAddresses && existente.emailAddresses[0];
  const en = nuevo.emailAddresses && nuevo.emailAddresses[0];
  if (comp(ee ? ee.value : '', en ? en.value : '')) return true;
  const te = existente.phoneNumbers && existente.phoneNumbers[0];
  const tn = nuevo.phoneNumbers && nuevo.phoneNumbers[0];
  if (comp(te ? te.value : '', tn ? tn.value : '')) return true;
  const oe = existente.organizations && existente.organizations[0];
  const on = nuevo.organizations && nuevo.organizations[0];
  if (comp(oe ? oe.name : '', on ? on.name : '')) return true;
  const ke = existente.nicknames && existente.nicknames[0];
  const kn = nuevo.nicknames && nuevo.nicknames[0];
  if (comp(ke ? ke.value : '', kn ? kn.value : '')) return true;
  return !sonMismosGrupos_(existente.memberships || [], nuevo.memberships || []);
}

function sonMismosGrupos_(a, b) {
  const norm = g => (g && g.contactGroupMembership && g.contactGroupMembership.contactGroupResourceName)
    ? g.contactGroupMembership.contactGroupResourceName.trim().toLowerCase() : '';
  const A = a.map(norm).filter(String).sort();
  const B = b.map(norm).filter(String).sort();
  return A.join() === B.join();
}

/**
 * Borra las etiquetas del usuario que se han quedado vacías. Con `candidatas`
 * ({nombreEnMinúsculas: true}) solo mira esas (las que esta sincronización ha
 * podido vaciar), para no tocar etiquetas vacías que el usuario tenga a propósito.
 * Usa memberCount del listado (una sola llamada, sin un get por etiqueta).
 */
function eliminarGruposVacios_(candidatas) {
  if (candidatas && !Object.keys(candidatas).length) return;
  MEMO_.grupos = null;   // relee el recuento actualizado
  listarGrupos_().forEach(g => {
    if (g.groupType !== 'USER_CONTACT_GROUP' || g.memberCount) return;
    if (candidatas && !candidatas[String(g.name || '').trim().toLowerCase()]) return;
    try { People.ContactGroups.remove(g.resourceName); } catch (e) { /* silencioso */ }
  });
  MEMO_.grupos = null;
}

/**
 * Fusiona contactos que comparten correo. Reúne correos, teléfonos,
 * organizaciones, alias y etiquetas en el primero (el nombre NO: es un campo de
 * valor único), lo actualiza en lote y borra los duplicados. Cada contacto
 * participa en una sola fusión por pasada (evita cadenas A–B–C incoherentes).
 * Devuelve true si ha cambiado algo (para releer los contactos).
 */
function fusionarDuplicados_(existentes) {
  const MASK = 'emailAddresses,phoneNumbers,organizations,memberships,nicknames';
  const porEmail = {};
  existentes.forEach(c => {
    (c.emailAddresses || []).forEach(e => {
      const k = String(e.value || '').trim().toLowerCase();
      if (k) (porEmail[k] = porEmail[k] || []).push(c);
    });
  });

  const usados = {};
  const fusiones = [];
  Object.keys(porEmail).forEach(email => {
    const grupo = porEmail[email].filter(c => c.resourceName && !usados[c.resourceName]);
    if (grupo.length < 2) return;
    const principal = JSON.parse(JSON.stringify(grupo[0]));
    if (!principal.etag) return;
    const duplicados = [];
    grupo.forEach(c => { usados[c.resourceName] = true; });
    grupo.slice(1).forEach(dup => {
      duplicados.push(dup.resourceName);
      fusionarCampo_(principal, dup, 'emailAddresses', (e, arr) =>
        arr.some(x => String(x.value).toLowerCase() === String(e.value).toLowerCase()));
      fusionarCampo_(principal, dup, 'phoneNumbers', (t, arr) => arr.some(x => x.value === t.value));
      fusionarCampo_(principal, dup, 'organizations', (o, arr) => arr.some(x => x.name === o.name));
      fusionarCampo_(principal, dup, 'nicknames', (k, arr) => arr.some(x => x.value === k.value));
      fusionarCampo_(principal, dup, 'memberships', (m, arr) => !m.contactGroupMembership || arr.some(x =>
        x.contactGroupMembership && x.contactGroupMembership.contactGroupResourceName === m.contactGroupMembership.contactGroupResourceName));
    });
    fusiones.push({ resourceName: principal.resourceName, persona: principal, duplicados: duplicados });
  });
  if (!fusiones.length) return false;

  // Actualizar los principales en lotes. Los que fallen no borran sus duplicados.
  const fallidos = {};
  ejecutarPorLotes_(fusiones, 200,
    function (chunk) {
      const map = {};
      chunk.forEach(function (fu) { map[fu.resourceName] = fu.persona; });
      People.People.batchUpdateContacts({ contacts: map, updateMask: MASK, readMask: 'names' });
    },
    function (fu) { People.People.updateContact(fu.persona, fu.resourceName, { updatePersonFields: MASK }); }
  ).forEach(function (fu) { fallidos[fu.resourceName] = true; });

  const aBorrar = [];
  fusiones.forEach(function (fu) { if (!fallidos[fu.resourceName]) Array.prototype.push.apply(aBorrar, fu.duplicados); });
  if (aBorrar.length) {
    ejecutarPorLotes_(aBorrar, 500,
      function (chunk) { People.People.batchDeleteContacts({ resourceNames: chunk }); },
      function (rn) { People.People.deleteContact(rn); });
  }
  return true;
}

/** Añade al contacto principal los valores de un campo del duplicado que falten. */
function fusionarCampo_(principal, dup, campo, yaExiste) {
  if (!dup[campo]) return;
  principal[campo] = principal[campo] || [];
  dup[campo].forEach(v => { if (!yaExiste(v, principal[campo])) principal[campo].push(v); });
}

function isValidEmail_(email) {
  const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  return re.test(String(email).toLowerCase());
}
