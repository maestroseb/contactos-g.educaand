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
  // (grupo de Google o lista administrada). El admin siempre puede.
  const email = correoUsuarioActual_();
  if (opciones.incluirCentro && !esAdmin_(email) && !esMiembroClaustro_(email)) {
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
  const total = filas.length;
  let hechos = 0;
  escribirProgreso_('subiendo', 0, total);

  filas.forEach(f => {
    escribirProgreso_('subiendo', ++hechos, total);
    const email = (f.email || '').trim().toLowerCase();
    if (!email || !isValidEmail_(email)) { resumen.omitidos++; return; }
    if (procesados.has(email)) { resumen.omitidos++; return; }
    procesados.add(email);

    const contacto = {
      names: [{ givenName: f.nombre || '', familyName: f.apellidos || '' }],
      emailAddresses: [{ type: f.tipoEmail || 'Trabajo', value: email }],
      memberships: []
    };
    // Solo se aporta teléfono/organización si la lista los trae. Si no, más
    // abajo se conservan los que ya tuviera el contacto (no se pisan).
    if (f.telefono) contacto.phoneNumbers = [{ type: 'Movil', value: f.telefono }];
    if (f.puesto) contacto.organizations = [{ name: f.puesto }];

    const grupos = (f.grupos || []).filter(String);
    grupos.forEach(nombreGrupo => {
      let idGrupo = gruposExistentes[nombreGrupo];
      if (!idGrupo) {
        idGrupo = People.ContactGroups.create({ contactGroup: { name: nombreGrupo } }).resourceName;
        gruposExistentes[nombreGrupo] = idGrupo;
      }
      contacto.memberships.push({ contactGroupMembership: { contactGroupResourceName: idGrupo } });
    });
    const existente = emailsExistentes[email];
    if (existente) {
      // Actualización NO destructiva: lo que la lista no trae se conserva.
      const campos = ['names', 'emailAddresses'];
      if (!contacto.phoneNumbers && existente.phoneNumbers) contacto.phoneNumbers = existente.phoneNumbers;
      if (!contacto.organizations && existente.organizations) contacto.organizations = existente.organizations;
      if (contacto.phoneNumbers) campos.push('phoneNumbers');
      if (contacto.organizations) campos.push('organizations');
      // Si la lista no trae nombre, se conserva el que ya tuviera.
      if (!f.nombre && !f.apellidos && existente.names) contacto.names = existente.names;
      // Etiquetas: solo se actualizan si la lista trae alguna; si no, se
      // conservan (no se quitan las etiquetas personales que ya tuvieras).
      if (grupos.length > 0) campos.push('memberships');
      else contacto.memberships = existente.memberships || [];

      if (esContactoDiferente_(existente, contacto)) {
        contacto.resourceName = existente.resourceName;
        contacto.etag = existente.etag;
        People.People.updateContact(contacto, existente.resourceName, { updatePersonFields: campos.join(',') });
        resumen.actualizados++;
      } else {
        resumen.sinCambios++;
      }
    } else {
      if (grupos.length === 0) {
        contacto.memberships.push({ contactGroupMembership: { contactGroupResourceName: 'contactGroups/myContacts' } });
      }
      People.People.createContact(contacto);
      resumen.creados++;
    }
  });

  escribirProgreso_('fusionando', total, total);
  eliminarGruposVacios_();
  fusionarDuplicados_();
  limpiarProgreso_();
  return resumen;
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
 * Fusiona contactos que comparten correo (portado de fusionarDuplicados()
 * del proyecto de hoja). Reúne nombres, correos, teléfonos, organizaciones y
 * grupos en el primer contacto, lo actualiza y elimina los duplicados.
 */
function fusionarDuplicados_() {
  const existentes = obtenerTodosLosContactos_();
  const porEmail = {};
  existentes.forEach(c => {
    (c.emailAddresses || []).forEach(e => {
      const k = e.value.trim().toLowerCase();
      (porEmail[k] = porEmail[k] || []).push(c);
    });
  });

  Object.keys(porEmail).forEach(email => {
    const contactos = porEmail[email];
    if (contactos.length < 2) return;

    const principal = contactos[0];
    if (!principal.resourceName || !principal.etag) return;

    for (let i = 1; i < contactos.length; i++) {
      const dup = contactos[i];
      fusionarCampo_(principal, dup, 'names', (n, arr) =>
        arr.some(x => x.givenName === n.givenName && x.familyName === n.familyName));
      fusionarCampo_(principal, dup, 'emailAddresses', (e, arr) =>
        arr.some(x => x.value.toLowerCase() === e.value.toLowerCase()));
      fusionarCampo_(principal, dup, 'phoneNumbers', (t, arr) => arr.some(x => x.value === t.value));
      fusionarCampo_(principal, dup, 'organizations', (o, arr) => arr.some(x => x.name === o.name));
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

    try {
      People.People.updateContact(principal, principal.resourceName, {
        updatePersonFields: 'names,emailAddresses,phoneNumbers,organizations,memberships'
      });
    } catch (e) {
      Logger.log('No se pudo fusionar ' + email + ': ' + e.message);
      return; // no borrar duplicados si falló la actualización
    }

    for (let i = 1; i < contactos.length; i++) {
      try { People.People.deleteContact(contactos[i].resourceName); }
      catch (e) { Logger.log('No se pudo eliminar duplicado: ' + e.message); }
    }
  });
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
