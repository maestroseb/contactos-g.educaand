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

  // Comprobación de pertenencia al grupo del profesorado (si está configurado).
  const correoGrupo = correoGrupoProfesorado_();
  if (opciones.incluirCentro && correoGrupo && !esMiembroDelGrupo_(correoUsuarioActual_(), correoGrupo)) {
    throw new Error('NO_MIEMBRO');
  }

  // Reunir la lista de contactos a sincronizar.
  let filas = [];
  if (opciones.incluirCentro) {
    let centro = leerContactosCentro_();
    if (opciones.gruposCentro && opciones.gruposCentro.length) {
      const sel = opciones.gruposCentro;
      centro = centro.filter(c => c.grupos.some(g => sel.indexOf(g) !== -1));
    }
    filas = filas.concat(centro);
  }
  if (opciones.incluirPropios) {
    filas = filas.concat(leerContactosPropios_());
  }

  return procesarContactos_(filas);
}

/**
 * Crea o actualiza los contactos (sin duplicar) y fusiona duplicados.
 * Equivalente a crearContactos() del proyecto de hoja.
 */
function procesarContactos_(filas) {
  const resumen = { creados: 0, actualizados: 0, sinCambios: 0, omitidos: 0 };

  const contactosExistentes = obtenerTodosLosContactos_();
  const emailsExistentes = {};
  contactosExistentes.forEach(c => {
    (c.emailAddresses || []).forEach(e => {
      emailsExistentes[e.value.trim().toLowerCase()] = c;
    });
  });

  const gruposExistentes = {};
  (People.ContactGroups.list().contactGroups || []).forEach(g => {
    gruposExistentes[g.name] = g.resourceName;
  });

  const procesados = new Set();

  filas.forEach(f => {
    const email = (f.email || '').trim().toLowerCase();
    if (!email || !isValidEmail_(email)) { resumen.omitidos++; return; }
    if (procesados.has(email)) { resumen.omitidos++; return; }
    procesados.add(email);

    const contacto = {
      names: [{ givenName: f.nombre || '', familyName: f.apellidos || '' }],
      emailAddresses: [{ type: f.tipoEmail || 'Trabajo', value: email }],
      phoneNumbers: [{ type: 'Movil', value: f.telefono || '' }],
      organizations: [{ name: f.puesto || '' }],
      memberships: []
    };

    const grupos = (f.grupos || []).filter(String);
    grupos.forEach(nombreGrupo => {
      let idGrupo = gruposExistentes[nombreGrupo];
      if (!idGrupo) {
        idGrupo = People.ContactGroups.create({ contactGroup: { name: nombreGrupo } }).resourceName;
        gruposExistentes[nombreGrupo] = idGrupo;
      }
      contacto.memberships.push({ contactGroupMembership: { contactGroupResourceName: idGrupo } });
    });
    if (grupos.length === 0) {
      contacto.memberships.push({ contactGroupMembership: { contactGroupResourceName: 'contactGroups/myContacts' } });
    }

    const existente = emailsExistentes[email];
    if (existente) {
      if (esContactoDiferente_(existente, contacto)) {
        contacto.resourceName = existente.resourceName;
        contacto.etag = existente.etag;
        People.People.updateContact(contacto, existente.resourceName, {
          updatePersonFields: 'names,emailAddresses,organizations,phoneNumbers,memberships'
        });
        resumen.actualizados++;
      } else {
        resumen.sinCambios++;
      }
    } else {
      People.People.createContact(contacto);
      resumen.creados++;
    }
  });

  eliminarGruposVacios_();
  fusionarDuplicados_();
  return resumen;
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
    email: c.emailAddresses ? c.emailAddresses[0].value : '',
    telefono: c.phoneNumbers ? c.phoneNumbers[0].value : '',
    puesto: c.organizations ? c.organizations[0].name : '',
    grupos: (c.memberships || [])
      .filter(m => m.contactGroupMembership)
      .map(m => grupos[m.contactGroupMembership.contactGroupResourceName])
      .filter(n => n && n !== 'myContacts')
  }));
}

/** Elimina un contacto por resourceName. */
function eliminarContacto(resourceName) {
  People.People.deleteContact(resourceName);
  eliminarGruposVacios_();
  return true;
}

/* --------------------------- Utilidades --------------------------- */

function obtenerTodosLosContactos_() {
  let contactos = [];
  let pagina = null;
  do {
    const r = People.People.Connections.list('people/me', {
      personFields: 'names,emailAddresses,phoneNumbers,organizations,memberships',
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
 * Fusiona contactos que comparten correo (portado de fusionarDuplicados()).
 * Se deja como stub delegando en la versión completa; incorporar la lógica
 * detallada del proyecto de hoja en la Fase 2.
 */
function fusionarDuplicados_() {
  // TODO(Fase 2): portar la fusión campo a campo de crearContactos.gs.
}

function isValidEmail_(email) {
  const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  return re.test(String(email).toLowerCase());
}
