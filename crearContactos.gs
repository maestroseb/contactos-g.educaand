function crearContactos() {
  const emailUsuario = Session.getActiveUser().getEmail();
  var hojaConfiguracion = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('⚙️ Configuración');
  var correo = hojaConfiguracion.getRange('D4').getValue().toString().trim().toLowerCase();

  if (correo === "<< Correo electrónico del grupo del profesorado >>".toLowerCase()) {
    correo = "";
  }

  const esMiembro = correo ? esMiembroDelGrupo(emailUsuario) : true;

  if (esMiembro) {
    var hojaContactos = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Subir Contactos");
    var datos = hojaContactos.getDataRange().getValues();

    // Obtener todos los contactos existentes con manejo de paginación
    var contactosExistentes = obtenerTodosLosContactos();
    Logger.log("Total de contactos recuperados: " + contactosExistentes.length);
    
    var emailsExistentes = contactosExistentes.reduce((obj, contacto) => {
      if (contacto.emailAddresses) {
        contacto.emailAddresses.forEach(function (email) {
          const normalizedEmail = email.value.trim().toLowerCase();
          obj[normalizedEmail] = contacto;
        });
      }
      return obj;
    }, {});

    var gruposExistentes = {};
    var grupos = People.ContactGroups.list().contactGroups;
    for (var i = 0; i < grupos.length; i++) {
      gruposExistentes[grupos[i].name] = grupos[i].resourceName;
    }

    var correosProcesados = new Set();

    for (var i = 1; i < datos.length; i++) {
      var email = datos[i][4] ? datos[i][4].toString().trim().toLowerCase() : '';
      var nombre = datos[i][1] ? datos[i][1].toString().trim() : '';
      if (!email && !nombre) {
        continue;
      }
      if (!email || !isValidEmail(email)) {
        Logger.log("El contacto en la fila " + (i + 1) + " no tiene un correo electrónico válido. Se omite este contacto.");
        continue;
      }

      if (correosProcesados.has(email)) {
        Logger.log("Correo duplicado en la fila " + (i + 1) + ": " + email + ". Se omite este contacto.");
        continue;
      }

      correosProcesados.add(email);

      var contactoExistente = emailsExistentes[email];
      var apellido = datos[i][2] ? datos[i][2].toString().trim() : '';
      var tipoEmail = datos[i][3] ? datos[i][3].toString().trim() : '';
      var telefono = datos[i][5] ? datos[i][5].toString().trim() : '';
      var puesto = datos[i][6] ? datos[i][6].toString().trim() : '';
      var grupo1 = datos[i][7] ? datos[i][7].toString().trim() : '';
      var grupo2 = datos[i][8] ? datos[i][8].toString().trim() : '';
      var grupo3 = datos[i][9] ? datos[i][9].toString().trim() : '';
      var grupo4 = datos[i][10] ? datos[i][10].toString().trim() : '';

      var contacto = {
        names: [{
          givenName: nombre,
          familyName: apellido
        }],
        emailAddresses: [{
          type: tipoEmail,
          value: email
        }],
        phoneNumbers: [{
          type: "Movil",
          value: telefono
        }],
        organizations: [{
          name: puesto
        }],
        memberships: []
      };

      var gruposContactos = [grupo1, grupo2, grupo3, grupo4];
      var hayGrupos = gruposContactos.some(grupo => grupo);

      for (var j = 0; j < gruposContactos.length; j++) {
        var nombreGrupo = gruposContactos[j];
        if (nombreGrupo) {
          var idGrupo = gruposExistentes[nombreGrupo];
          if (!idGrupo) {
            var nuevoGrupo = People.ContactGroups.create({
              contactGroup: {
                name: nombreGrupo
              }
            });
            idGrupo = nuevoGrupo.resourceName;
            gruposExistentes[nombreGrupo] = idGrupo;
          }
          contacto.memberships.push({
            contactGroupMembership: {
              contactGroupResourceName: idGrupo
            }
          });
        }
      }

      if (!hayGrupos) {
        contacto.memberships.push({
          contactGroupMembership: {
            contactGroupResourceName: "contactGroups/myContacts"
          }
        });
      }

      if (contactoExistente) {
        // Comparación campo por campo para mayor precisión
        if (esContactoDiferente(contactoExistente, contacto)) {
          contacto.resourceName = contactoExistente.resourceName;
          contacto.etag = contactoExistente.etag;
          People.People.updateContact(contacto, contactoExistente.resourceName, {
            updatePersonFields: 'names,emailAddresses,organizations,phoneNumbers,memberships'
          });
          Logger.log("Contacto actualizado: " + nombre + " " + apellido);
        } else {
          Logger.log("No se encontraron cambios para: " + nombre + " " + apellido);
        }
      } else {
        People.People.createContact(contacto);
        Logger.log("Contacto creado: " + nombre + " " + apellido);
      }
    }
    eliminarGruposVacios();
    
    // Llamada a la función para fusionar duplicados
    fusionarDuplicados();
    
  } else {
    SpreadsheetApp.getUi().alert(
      PARAMS.tituloMensajes,
      '😢 No puedes subir los contactos puesto que NO perteneces al grupo especificado en la pestaña ⚙️ Configuración. \n\nElimina el grupo para no tener en cuenta los contactos de ese centro (y solo subir los tuyos propios) o modifica el correo por uno al que sí pertenezcas para poder realizar la sincronización.',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  }
}

function fusionarDuplicados() {
  Logger.log("Iniciando proceso de fusión de duplicados...");

  // Obtener todos los contactos existentes con manejo de paginación
  var contactosExistentes = obtenerTodosLosContactos();
  Logger.log("Total de contactos recuperados: " + contactosExistentes.length);

  // Mapeo de correos electrónicos a contactos
  var emailToContactsMap = {};

  contactosExistentes.forEach(contacto => {
    if (contacto.emailAddresses) {
      contacto.emailAddresses.forEach(email => {
        var normalizedEmail = email.value.trim().toLowerCase();
        if (!emailToContactsMap[normalizedEmail]) {
          emailToContactsMap[normalizedEmail] = [];
        }
        emailToContactsMap[normalizedEmail].push(contacto);
      });
    }
  });

  var duplicadosFusionados = 0;

  // Iterar sobre el mapa y fusionar duplicados
  for (var email in emailToContactsMap) {
    var contactos = emailToContactsMap[email];
    if (contactos.length > 1) {
      Logger.log("Se encontraron " + contactos.length + " contactos con el correo: " + email);
      
      // Seleccionar el primer contacto como principal
      var contactoPrincipal = contactos[0];
      
      // Comprobar que contactoPrincipal tiene resourceName y etag
      if (!contactoPrincipal.resourceName || !contactoPrincipal.etag) {
        Logger.log("El contacto principal no tiene resourceName o etag. Se omite la fusión para este correo: " + email);
        continue;
      }
      
      // Fusionar la información de los contactos duplicados en el contacto principal
      for (var i = 1; i < contactos.length; i++) {
        var duplicado = contactos[i];
        
        // Fusionar nombres
        if (duplicado.names) {
          duplicado.names.forEach(nombre => {
            var exists = contactoPrincipal.names.some(n => n.givenName === nombre.givenName && n.familyName === nombre.familyName);
            if (!exists) {
              contactoPrincipal.names.push(nombre);
            }
          });
        }
        
        // Fusionar direcciones de correo electrónico
        if (duplicado.emailAddresses) {
          duplicado.emailAddresses.forEach(emailDup => {
            var exists = contactoPrincipal.emailAddresses.some(e => e.value.toLowerCase() === emailDup.value.toLowerCase());
            if (!exists) {
              contactoPrincipal.emailAddresses.push(emailDup);
            }
          });
        }
        
        // Fusionar números de teléfono
        if (duplicado.phoneNumbers) {
          duplicado.phoneNumbers.forEach(tel => {
            var exists = contactoPrincipal.phoneNumbers.some(p => p.value === tel.value);
            if (!exists) {
              contactoPrincipal.phoneNumbers.push(tel);
            }
          });
        }
        
        // Fusionar organizaciones
        if (duplicado.organizations) {
          duplicado.organizations.forEach(org => {
            var exists = contactoPrincipal.organizations.some(o => o.name === org.name);
            if (!exists) {
              contactoPrincipal.organizations.push(org);
            }
          });
        }
        
        // Fusionar membresías (grupos)
        if (duplicado.memberships) {
          duplicado.memberships.forEach(membership => {
            if (membership.contactGroupMembership && membership.contactGroupMembership.contactGroupResourceName) {
              var resourceName = membership.contactGroupMembership.contactGroupResourceName.trim().toLowerCase();
              var exists = contactoPrincipal.memberships.some(m => 
                m.contactGroupMembership && 
                m.contactGroupMembership.contactGroupResourceName.trim().toLowerCase() === resourceName
              );
              if (!exists) {
                contactoPrincipal.memberships.push(membership);
              }
            } else {
              Logger.log("Membresía sin contactGroupMembership en contacto duplicado: " + obtenerNombreCompleto(duplicado));
            }
          });
        }
      }

      // Actualizar el contacto principal con la información fusionada
      try {
        var updatedContact = People.People.updateContact(contactoPrincipal, contactoPrincipal.resourceName, {
          updatePersonFields: 'names,emailAddresses,phoneNumbers,organizations,memberships'
        });
        Logger.log("Contacto principal actualizado con información fusionada: " + obtenerNombreCompleto(updatedContact));
        duplicadosFusionados++;
      } catch (error) {
        Logger.log("Error al actualizar contacto principal: " + obtenerNombreCompleto(contactoPrincipal) + " - " + error.message);
        continue; // No borrar los duplicados si la actualización falló
      }

      // Verificar que el contacto principal se actualizó correctamente
      var contactoVerificado;
      try {
        contactoVerificado = People.People.get(contactoPrincipal.resourceName, {
          personFields: 'names,emailAddresses,phoneNumbers,organizations,memberships'
        });
      } catch (error) {
        Logger.log("Error al verificar contacto principal actualizado: " + obtenerNombreCompleto(contactoPrincipal) + " - " + error.message);
        continue; // No borrar los duplicados si no se pudo verificar
      }

      // Eliminar los contactos duplicados restantes
      for (var i = 1; i < contactos.length; i++) {
        var duplicado = contactos[i];
        try {
          People.People.deleteContact(duplicado.resourceName);
          Logger.log("Contacto duplicado eliminado: " + obtenerNombreCompleto(duplicado));
        } catch (error) {
          Logger.log("Error al eliminar contacto duplicado: " + obtenerNombreCompleto(duplicado) + " - " + error.message);
        }
      }
    }
  }

  Logger.log("Proceso de fusión de duplicados finalizado. Total de grupos de duplicados fusionados: " + duplicadosFusionados);
}

function obtenerNombreCompleto(contacto) {
  var nombre = contacto.names && contacto.names[0] ? contacto.names[0].givenName : '';
  var apellido = contacto.names && contacto.names[0] ? contacto.names[0].familyName : '';
  return nombre + " " + apellido;
}

function obtenerTodosLosContactos() {
  var contactos = [];
  var pagina = null;

  do {
    var respuesta = People.People.Connections.list('people/me', {
      personFields: 'names,emailAddresses,phoneNumbers,organizations,memberships',
      pageToken: pagina,
      pageSize: 1000 // Ajusta según tus necesidades
    });
    if (respuesta.connections) {
      contactos = contactos.concat(respuesta.connections);
    }
    pagina = respuesta.nextPageToken;
  } while (pagina);

  return contactos;
}

function esContactoDiferente(contactoExistente, nuevoContacto) {
  var diferencias = [];
  
  function compararCampo(campoExistente, campoNuevo, nombreCampo) {
    if ((campoExistente || "").toLowerCase() !== (campoNuevo || "").toLowerCase()) {
      diferencias.push(nombreCampo + ": " + (campoExistente || "undefined") + " vs " + (campoNuevo || "vacío"));
    }
  }
  
  // Verificar si los nombres existen antes de compararlos
  var nombreExistente = contactoExistente.names && contactoExistente.names[0];
  var nombreNuevo = nuevoContacto.names && nuevoContacto.names[0];
  compararCampo(nombreExistente ? nombreExistente.givenName : "", nombreNuevo ? nombreNuevo.givenName : "", "Given name");
  compararCampo(nombreExistente ? nombreExistente.familyName : "", nombreNuevo ? nombreNuevo.familyName : "", "Family name");

  // Verificar si las direcciones de correo existen antes de compararlas
  var emailExistente = contactoExistente.emailAddresses && contactoExistente.emailAddresses[0];
  var emailNuevo = nuevoContacto.emailAddresses && nuevoContacto.emailAddresses[0];
  compararCampo(emailExistente ? emailExistente.value : "", emailNuevo ? emailNuevo.value : "", "Email");

  // Verificar si los números de teléfono existen antes de compararlos
  var telefonoExistente = contactoExistente.phoneNumbers && contactoExistente.phoneNumbers[0];
  var telefonoNuevo = nuevoContacto.phoneNumbers && nuevoContacto.phoneNumbers[0];
  compararCampo(telefonoExistente ? telefonoExistente.value : "", telefonoNuevo ? telefonoNuevo.value : "", "Phone");

  // Verificar si las organizaciones existen antes de compararlas
  var organizacionExistente = contactoExistente.organizations && contactoExistente.organizations[0];
  var organizacionNueva = nuevoContacto.organizations && nuevoContacto.organizations[0];
  compararCampo(organizacionExistente ? organizacionExistente.name : "", organizacionNueva ? organizacionNueva.name : "", "Organization");

  // Verificar los grupos
  if (!sonMismosGrupos(contactoExistente.memberships || [], nuevoContacto.memberships || [])) {
    diferencias.push("Groups are different");
  }

  if (diferencias.length > 0) {
    Logger.log("Diferencias encontradas para " + (nombreNuevo ? nombreNuevo.givenName : "") + " " + (nombreNuevo ? nombreNuevo.familyName : "") + ": " + diferencias.join(", "));
    return true;
  }
  
  return false;
}

function sonMismosGrupos(gruposExistentes, nuevosGrupos) {
  // Normalizar, filtrar valores vacíos y ordenar los grupos para comparación
  var normalizar = function(grupo) {
    return grupo && grupo.contactGroupMembership && grupo.contactGroupMembership.contactGroupResourceName
      ? grupo.contactGroupMembership.contactGroupResourceName.trim().toLowerCase()
      : '';
  };

  var filtrarVacios = function(grupo) {
    return grupo !== ''; // Filtrar los valores vacíos
  };

  var existentes = gruposExistentes.map(normalizar).filter(filtrarVacios).sort();
  var nuevos = nuevosGrupos.map(normalizar).filter(filtrarVacios).sort();

  // Registro detallado para diagnóstico
  Logger.log("Grupos existentes (filtrados): " + existentes.join(", "));
  Logger.log("Nuevos grupos (filtrados): " + nuevos.join(", "));

  // Comparar los grupos normalizados y filtrados
  return existentes.join() === nuevos.join();
}

function obtenerTodosLosContactos() {
  var contactos = [];
  var pagina = null;

  do {
    var respuesta = People.People.Connections.list('people/me', {
      personFields: 'names,emailAddresses,phoneNumbers,organizations,memberships',
      pageToken: pagina,
      pageSize: 1000 // Ajusta según tus necesidades
    });
    if (respuesta.connections) {
      contactos = contactos.concat(respuesta.connections);
    }
    pagina = respuesta.nextPageToken;
  } while (pagina);

  return contactos;
}


function isValidEmail(email) {
  var re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  return re.test(String(email).toLowerCase());
}