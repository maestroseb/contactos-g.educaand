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
 *   - incluirCentro {boolean}  sincronizar los contactos del centro
 *   - gruposCentro {string[]}  si se indica, solo estos grupos del centro
 *   - incluirPropios {boolean} sincronizar los contactos propios del usuario
 * @return {Object} resumen {creados, actualizados, sinCambios, omitidos}
 */
function sincronizar(opciones) {
  opciones = opciones || { incluirCentro: true, incluirPropios: true };

  // Para sincronizar los contactos del centro hay que pertenecer al claustro
  // (grupo de Google o lista administrada) o al alumnado de algún curso. El
  // alumnado solo recibe a su clase, su tutor/a y su profesorado; el profesorado
  // recibe siempre el claustro y, además, los grupos de alumnos que haya elegido.
  const email = correoUsuarioActual_();
  if (opciones.incluirCentro && !puedeSincronizarCentro_(email)) {
    throw new Error('NO_MIEMBRO');
  }
  const esAlumnoSolo = opciones.incluirCentro && !esAdmin_(email) && !esMiembroClaustro_(email);

  // Reunir la lista de contactos a sincronizar.
  let filas = [];
  let pausados = [];
  if (opciones.incluirCentro) {
    const centro = esAlumnoSolo ? contactosDeClase_(email) : leerContactosCentro_();
    // Personas «en pausa»: se quedan en el listado pero NO se sincronizan; se les
    // retiran las etiquetas (baja temporal reversible). Se recogen de la lista
    // completa, independientemente del filtro por grupos.
    pausados = centro.filter(c => c && c.pausado && c.email).map(c => ({ email: c.email, grupos: c.grupos || [] }));
    let activos = centro.filter(c => !(c && c.pausado));
    if (opciones.gruposCentro && opciones.gruposCentro.length) {
      const sel = opciones.gruposCentro;
      activos = activos.filter(c => c.grupos.some(g => sel.indexOf(g) !== -1));
    }
    filas = filas.concat(activos);
    if (!esAlumnoSolo) filas = filas.concat(contactosDeCursosDocente_(email));
  }
  if (opciones.incluirPropios) {
    filas = filas.concat(leerContactosPropios_());
  }

  const resumen = procesarContactos_(filas);
  // Al sincronizar el centro, retira de Google las etiquetas de quien se haya
  // quitado del claustro o de un curso (bajas) o esté en pausa. No se borra el contacto.
  if (opciones.incluirCentro) {
    try { retirarEtiquetasDeBajas_(filas, pausados, resumen, !esAlumnoSolo); } catch (e) { Logger.log('retirarEtiquetasDeBajas_: ' + e.message); }
  }
  return resumen;
}

/**
 * Retira de los contactos de Google del usuario las etiquetas de las personas
 * dadas de baja en el claustro o en un curso (registros de bajas) y de las que
 * están «en pausa». NO borra el contacto ni sus demás datos: solo quita las
 * pertenencias a esas etiquetas y garantiza que sigue en «Mis contactos». Nunca
 * quita una etiqueta que la persona sigue teniendo en la lista actual.
 *
 * Si `borrarAlumnos` (sincroniza un docente), el alumnado dado de baja de un
 * curso que ya no se sincroniza por ninguna otra vía se ELIMINA por completo
 * de sus contactos (solo si aún tiene la etiqueta del curso, es decir, si llegó
 * por la sincronización). Entre compañeros solo se retira la etiqueta.
 */
function retirarEtiquetasDeBajas_(filasActuales, pausados, resumen, borrarAlumnos) {
  const bajasAlu = leerBajasAlumnado_();
  const bajas = leerBajas_().concat(bajasAlu, pausados || []);
  if (!bajas.length) return;

  // Alumnado dado de baja: email -> { etiquetaCurso: true }.
  const alumnosBaja = {};
  if (borrarAlumnos) bajasAlu.forEach(b => {
    if (!b.alumno) return;
    const set = alumnosBaja[String(b.email || '').trim().toLowerCase()] = {};
    (b.grupos || []).forEach(g => { set[String(g || '').trim().toLowerCase()] = true; });
  });
  const aBorrar = [];

  // email -> { etiqueta: true } que se están sincronizando ahora: no se tocan.
  const activos = {};
  (filasActuales || []).forEach(f => {
    const e = String(f.email || '').trim().toLowerCase(); if (!e) return;
    const set = activos[e] || (activos[e] = {});
    (f.grupos || []).forEach(g => { const gl = String(g || '').trim().toLowerCase(); if (gl) set[gl] = true; });
  });

  // email -> { etiquetaEnMinusculas: true } a retirar.
  const porEmail = {};
  bajas.forEach(b => {
    const e = String(b.email || '').trim().toLowerCase();
    if (!e) return;
    (b.grupos || []).forEach(g => {
      const gl = String(g || '').trim().toLowerCase();
      if (gl && !(activos[e] && activos[e][gl])) (porEmail[e] || (porEmail[e] = {}))[gl] = true;
    });
  });
  if (!Object.keys(porEmail).length) return;

  // resourceName del grupo -> nombre (para saber qué etiqueta es cada pertenencia).
  const nombrePorRN = {};
  (People.ContactGroups.list().contactGroups || []).forEach(g => { nombrePorRN[g.resourceName] = g.name; });

  const aActualizar = [];
  obtenerTodosLosContactos_().forEach(c => {
    const emails = (c.emailAddresses || []).map(e => String(e.value || '').trim().toLowerCase());
    // Etiquetas a quitar (de cualquiera de sus correos) salvo las que sigue teniendo.
    let quitar = null;
    emails.forEach(e => { Object.keys(porEmail[e] || {}).forEach(g => { (quitar = quitar || {})[g] = true; }); });
    if (!quitar) return;
    emails.forEach(e => { Object.keys(activos[e] || {}).forEach(g => { delete quitar[g]; }); });
    if (!Object.keys(quitar).length) return;

    const membs = c.memberships || [];
    // Alumno/a dado de baja que ya no se sincroniza por ninguna vía: se borra entero.
    if (!emails.some(e => activos[e]) && emails.some(e => alumnosBaja[e] && membs.some(m => {
      const rn = m.contactGroupMembership && m.contactGroupMembership.contactGroupResourceName;
      return rn && alumnosBaja[e][(nombrePorRN[rn] || '').trim().toLowerCase()];
    }))) { aBorrar.push(c.resourceName); return; }

    const nuevas = membs.filter(m => {
      const rn = m.contactGroupMembership && m.contactGroupMembership.contactGroupResourceName;
      if (!rn) return true;                                   // conserva pertenencias que no sean de grupo
      const nombre = (nombrePorRN[rn] || '').trim().toLowerCase();
      return !quitar[nombre];                                 // quita solo las etiquetas de la baja
    });
    if (nuevas.length === membs.length) return;               // no tenía esas etiquetas

    // Si se queda sin ninguna etiqueta, se deja en «Mis contactos» para que no
    // desaparezca (el alumnado con etiqueta nunca va a «Mis contactos»).
    if (!nuevas.some(m => m.contactGroupMembership)) nuevas.push(MEMB_MYCONTACTS_);

    aActualizar.push({ resourceName: c.resourceName, persona: { resourceName: c.resourceName, etag: c.etag, memberships: nuevas } });
  });
  if (aBorrar.length) {
    const fallB = ejecutarPorLotes_(aBorrar, 200,
      function (chunk) { People.People.batchDeleteContacts({ resourceNames: chunk }); },
      function (rn) { People.People.deleteContact(rn); });
    resumen.eliminados = (resumen.eliminados || 0) + aBorrar.length - fallB.length;
    resumen.errores += fallB.length;
  }
  if (!aActualizar.length) { if (aBorrar.length) { try { eliminarGruposVacios_(); } catch (e) {} } return; }

  const fall = ejecutarPorLotes_(aActualizar, 200,
    function (chunk) {
      const map = {};
      chunk.forEach(u => { map[u.resourceName] = u.persona; });
      People.People.batchUpdateContacts({ contacts: map, updateMask: 'memberships', readMask: 'names' });
    },
    function (u) { People.People.updateContact(u.persona, u.resourceName, { updatePersonFields: 'memberships' }); });
  resumen.actualizados += (aActualizar.length - fall.length);
  resumen.errores += fall.length;
  try { eliminarGruposVacios_(); } catch (e) { /* silencioso */ }
}

/**
 * Crea o actualiza los contactos (sin duplicar) y fusiona duplicados.
 *
 * Primero decide todo en memoria (empareja por correo, no duplica, no pisa
 * datos que la lista no trae) y solo AL FINAL envía los cambios en LOTES
 * (batchCreate/batchUpdate, hasta 200 por llamada), con reintentos y caída a
 * uno-a-uno si un lote falla. Así es rápido y a prueba de errores.
 */
/** Pertenencia al grupo del sistema «Mis contactos» (para que se vean/sincronicen
 *  en el móvil, no solo dentro de una etiqueta). */
const MEMB_MYCONTACTS_ = { contactGroupMembership: { contactGroupResourceName: 'contactGroups/myContacts' } };

function procesarContactos_(filas) {
  const resumen = { creados: 0, actualizados: 0, sinCambios: 0, omitidos: 0, errores: 0 };
  // No se toca el correo en las actualizaciones (es la clave de emparejamiento
  // y así no se borran otros correos que tuviera el contacto).
  const MASK_UPDATE = 'names,phoneNumbers,organizations,memberships,nicknames';

  const contactosExistentes = obtenerTodosLosContactos_();
  const emailsExistentes = {};
  contactosExistentes.forEach(c => {
    (c.emailAddresses || []).forEach(e => { emailsExistentes[e.value.trim().toLowerCase()] = c; });
  });

  const gruposExistentes = {};
  (People.ContactGroups.list().contactGroups || []).forEach(g => { gruposExistentes[g.name] = g.resourceName; });

  const procesados = {};
  const total = filas.length;
  let hechos = 0;
  const aCrear = [];       // [{ contactPerson: persona }]
  const aActualizar = [];  // [{ resourceName, persona }]
  escribirProgreso_('subiendo', 0, total);

  filas.forEach(f => {
    escribirProgreso_('subiendo', ++hechos, total);
    const email = (f.email || '').trim().toLowerCase();
    if (!email || !isValidEmail_(email)) { resumen.omitidos++; return; }
    if (procesados[email]) { resumen.omitidos++; return; }
    procesados[email] = true;

    const grupos = (f.grupos || []).filter(String);
    const nuevasMemb = grupos.map(nombreGrupo => {
      let idGrupo = gruposExistentes[nombreGrupo];
      if (!idGrupo) {
        idGrupo = conReintentos_(function () { return People.ContactGroups.create({ contactGroup: { name: nombreGrupo } }).resourceName; });
        gruposExistentes[nombreGrupo] = idGrupo;
      }
      return { contactGroupMembership: { contactGroupResourceName: idGrupo } };
    });

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
        emailAddresses: existente.emailAddresses || [{ type: f.tipoEmail || 'Trabajo', value: email }],
        phoneNumbers: f.telefono ? [{ type: 'Movil', value: f.telefono }] : (existente.phoneNumbers || []),
        organizations: f.puesto ? [{ name: f.puesto }] : (existente.organizations || []),
        nicknames: f.alias ? [{ value: f.alias }] : (existente.nicknames || []),
        memberships: grupos.length ? memb : (existente.memberships || [])
      };
      if (esContactoDiferente_(existente, persona)) aActualizar.push({ resourceName: existente.resourceName, persona: persona });
      else resumen.sinCambios++;
    } else {
      const persona = {
        names: [{ givenName: f.nombre || '', familyName: f.apellidos || '' }],
        emailAddresses: [{ type: f.tipoEmail || 'Trabajo', value: email }],
        memberships: memb
      };
      if (f.telefono) persona.phoneNumbers = [{ type: 'Movil', value: f.telefono }];
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
  try { eliminarGruposVacios_(); } catch (e) { Logger.log('eliminarGruposVacios_: ' + e.message); }
  try { fusionarDuplicados_(); } catch (e) { Logger.log('fusionarDuplicados_: ' + e.message); }
  limpiarProgreso_();
  return resumen;
}

/* --------------------- Ejecución por lotes a prueba de errores --------------------- */

/** Reintenta fn con espera creciente ante errores transitorios (rate limit, 5xx). */
function conReintentos_(fn, intentos) {
  intentos = intentos || 4;
  var espera = 600;
  for (var i = 0; i < intentos; i++) {
    try { return fn(); }
    catch (e) {
      if (i === intentos - 1) throw e;
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
  const grupos = {};
  (People.ContactGroups.list({}).contactGroups || []).forEach(g => { grupos[g.resourceName] = g.name; });

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
      .filter(n => n && n !== 'myContacts')
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

  // Resolver nombres de grupo -> resourceName (creando los que falten), solo si
  // alguna edición toca las etiquetas.
  const gruposExistentes = {};
  if (editados.some(e => (e.mask || '').indexOf('memberships') !== -1)) {
    (People.ContactGroups.list().contactGroups || []).forEach(g => { gruposExistentes[g.name] = g.resourceName; });
  }
  function membershipsDe(grupos) {
    const arr = (grupos || []).filter(String).map(nombre => {
      let id = gruposExistentes[nombre];
      if (!id) {
        id = conReintentos_(function () { return People.ContactGroups.create({ contactGroup: { name: nombre } }).resourceName; });
        gruposExistentes[nombre] = id;
      }
      return { contactGroupMembership: { contactGroupResourceName: id } };
    });
    // Siempre en "Mis contactos" (además de sus etiquetas) para que se vea en el móvil.
    return arr.concat([MEMB_MYCONTACTS_]);
  }

  // Actualizaciones: una por contacto, con la máscara exacta de lo que cambió
  // (así nunca se pisan otros campos, p. ej. correos secundarios).
  editados.forEach(function (e) {
    if (!e.resourceName || !e.mask) return;
    const persona = { resourceName: e.resourceName, etag: e.etag };
    if (e.mask.indexOf('names') !== -1) persona.names = [{ givenName: e.nombre || '', familyName: e.apellidos || '' }];
    if (e.mask.indexOf('emailAddresses') !== -1) persona.emailAddresses = e.email ? [{ value: e.email }] : [];
    if (e.mask.indexOf('phoneNumbers') !== -1) persona.phoneNumbers = e.telefono ? [{ type: 'Movil', value: e.telefono }] : [];
    if (e.mask.indexOf('organizations') !== -1) persona.organizations = e.puesto ? [{ name: e.puesto }] : [];
    if (e.mask.indexOf('nicknames') !== -1) persona.nicknames = e.alias ? [{ value: e.alias }] : [];
    if (e.mask.indexOf('memberships') !== -1) persona.memberships = membershipsDe(e.grupos);
    try {
      conReintentos_(function () { People.People.updateContact(persona, e.resourceName, { updatePersonFields: e.mask }); }, 3);
      resumen.actualizados++;
    } catch (err) { resumen.errores++; Logger.log('guardarMisContactos update: ' + err.message); }
  });

  // Borrados en lote (con caída a uno-a-uno).
  if (eliminados.length) {
    const fall = ejecutarPorLotes_(eliminados, 200,
      function (chunk) { People.People.batchDeleteContacts({ resourceNames: chunk }); },
      function (rn) { People.People.deleteContact(rn); });
    resumen.eliminados = eliminados.length - fall.length;
    resumen.errores += fall.length;
  }

  try { eliminarGruposVacios_(); } catch (e2) { /* silencioso */ }
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
    if (r.connections) contactos = contactos.concat(r.connections);
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

function eliminarGruposVacios_() {
  (People.ContactGroups.list().contactGroups || []).forEach(g => {
    if (g.groupType === 'SYSTEM_CONTACT_GROUP') return;
    const r = People.ContactGroups.get(g.resourceName, { maxMembers: 1 });
    if (!r.memberResourceNames || r.memberResourceNames.length === 0) {
      try { People.ContactGroups.remove(g.resourceName); } catch (e) { /* reintento silencioso */ }
    }
  });
}

/**
 * Fusiona contactos que comparten correo (portado de fusionarDuplicados()
 * del proyecto de hoja). Reúne nombres, correos, teléfonos, organizaciones y
 * grupos en el primer contacto, lo actualiza y elimina los duplicados.
 *
 * Trabaja en LOTES a prueba de errores: primero prepara en memoria las
 * fusiones, luego actualiza los principales con batchUpdateContacts y por
 * último borra los duplicados con batchDeleteContacts. Solo se eliminan los
 * duplicados cuyo principal se actualizó correctamente.
 */
function fusionarDuplicados_() {
  const MASK = 'names,emailAddresses,phoneNumbers,organizations,memberships,nicknames';
  const existentes = obtenerTodosLosContactos_();
  const porEmail = {};
  existentes.forEach(c => {
    (c.emailAddresses || []).forEach(e => {
      const k = e.value.trim().toLowerCase();
      (porEmail[k] = porEmail[k] || []).push(c);
    });
  });

  // 1) Preparar fusiones en memoria: [{ resourceName, persona, duplicados:[rn] }]
  const fusiones = [];
  Object.keys(porEmail).forEach(email => {
    const contactos = porEmail[email];
    if (contactos.length < 2) return;

    const principal = contactos[0];
    if (!principal.resourceName || !principal.etag) return;

    const duplicados = [];
    for (let i = 1; i < contactos.length; i++) {
      const dup = contactos[i];
      if (dup.resourceName) duplicados.push(dup.resourceName);
      fusionarCampo_(principal, dup, 'names', (n, arr) =>
        arr.some(x => x.givenName === n.givenName && x.familyName === n.familyName));
      fusionarCampo_(principal, dup, 'emailAddresses', (e, arr) =>
        arr.some(x => x.value.toLowerCase() === e.value.toLowerCase()));
      fusionarCampo_(principal, dup, 'phoneNumbers', (t, arr) => arr.some(x => x.value === t.value));
      fusionarCampo_(principal, dup, 'organizations', (o, arr) => arr.some(x => x.name === o.name));
      fusionarCampo_(principal, dup, 'nicknames', (k, arr) => arr.some(x => x.value === k.value));
      (dup.memberships || []).forEach(m => {
        if (!m.contactGroupMembership) return;
        const rn = m.contactGroupMembership.contactGroupResourceName.trim().toLowerCase();
        principal.memberships = principal.memberships || [];
        const existe = principal.memberships.some(x =>
          x.contactGroupMembership &&
          x.contactGroupMembership.contactGroupResourceName.trim().toLowerCase() === rn);
        if (!existe) principal.memberships.push(m);
      });
    }
    if (duplicados.length) {
      fusiones.push({ resourceName: principal.resourceName, persona: principal, duplicados: duplicados });
    }
  });

  if (!fusiones.length) return;

  // 2) Actualizar los principales en lotes. Los que fallen no borran sus duplicados.
  const fallidos = {};
  ejecutarPorLotes_(fusiones, 200,
    function (chunk) {
      const map = {};
      chunk.forEach(function (fu) { map[fu.resourceName] = fu.persona; });
      People.People.batchUpdateContacts({ contacts: map, updateMask: MASK, readMask: 'names' });
    },
    function (fu) {
      People.People.updateContact(fu.persona, fu.resourceName, { updatePersonFields: MASK });
    }
  ).forEach(function (fu) { fallidos[fu.resourceName] = true; });

  // 3) Borrar en lotes los duplicados de los principales actualizados con éxito.
  const aBorrar = [];
  fusiones.forEach(function (fu) {
    if (fallidos[fu.resourceName]) return;
    fu.duplicados.forEach(function (rn) { aBorrar.push(rn); });
  });
  if (!aBorrar.length) return;

  ejecutarPorLotes_(aBorrar, 200,
    function (chunk) { People.People.batchDeleteContacts({ resourceNames: chunk }); },
    function (rn) { People.People.deleteContact(rn); });
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
