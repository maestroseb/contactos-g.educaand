// En este archivo se agrupan todas las funciones necesarias para traer los contactos de Google Contacts en la pestaña "👥 Mis contactos" y eliminar o actualizar cualquiera de ellos.

function botonMisContactos() {
  var ui = SpreadsheetApp.getUi();
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("👥 Mis Contactos");

  // Encontrar la última fila con contenido en las columnas B, C o D
  var ultimaFila = hoja.getLastRow();
  
  if (ultimaFila < 5) {
    ultimaFila = 5;
  }

  var rangoDatos = hoja.getRange("B5:D" + ultimaFila).getValues();
  
  // Comprobar si el rango B5:D está en blanco
  var estaEnBlanco = rangoDatos.every(function(fila) {
    return fila.every(function(celda) {
      return !celda || celda.toString().trim() === "";
    });
  });

  if (estaEnBlanco) {
    // Si el rango está en blanco, mostrar mensaje de descarga
    var respuesta = ui.alert("Descargar contactos", "Se va a proceder a cargar tus contactos de Google. ¿Deseas continuar?", ui.ButtonSet.OK_CANCEL);
    if (respuesta == ui.Button.OK) {
      traerContactos();
    }
    return; // Terminar la función después de descargar los contactos
  }

  // Comprobar si hay filas marcadas en A5:A para eliminación
  var datosA5A = hoja.getRange("A5:A" + ultimaFila).getValues().flat();
  var datosD5D = hoja.getRange("D5:D" + ultimaFila).getValues().flat();

  // Revisar y contar todas las filas que están marcadas con un valor 'verdadero' en la columna A que también tienen datos en la columna D
  var filasMarcadas = datosA5A.reduce(function(contador, valor, indice) {
    if (valor && valor.toString().toLowerCase() === 'true' && datosD5D[indice].trim() !== "") {
      return contador + 1;
    }
    return contador;
  }, 0);

  if (filasMarcadas > 0) {
    var respuestaEliminacion = ui.alert("Eliminar contactos", "Se han detectado cambios en uno o varios contactos. Estos se sincronizarán y la página se actualizará para reflejar los cambios.\n\nIMPORTANTE: Estás a punto de eliminar " + filasMarcadas + " contactos. ¿Deseas continuar?", ui.ButtonSet.OK_CANCEL);
    if (respuestaEliminacion == ui.Button.CANCEL) {
      return; // Terminar la función si se cancela la eliminación
    }
  } else {
    // Si no hay contactos para eliminar, mostrar el mensaje de sincronización
    var respuestaSincronizacion = ui.alert("Sincronizar contactos", "Si has realizado modificaciones en uno o varios contactos, estos se sincronizarán y la página se actualizará para reflejar los cambios.", ui.ButtonSet.OK_CANCEL);
    if (respuestaSincronizacion == ui.Button.CANCEL) {
      return; // Terminar la función si se cancela la sincronización
    }
  }

  // Ejecutar las funciones si el usuario acepta eliminar o sincronizar contactos
  try {
    eliminarContactosMarcados();
  } catch (error) {
    console.error('Error en eliminarContactosMarcados: ' + error.message);
  }
  try {
    actualizarContactos();
  } catch (error) {
    console.error('Error en actualizarContactos: ' + error.message);
  }
  try {
    eliminarGruposVacios();
  } catch (error) {
    console.error('Error en eliminarGruposVacios: ' + error.message);
  }
  try {
    limpiarHoja();
  } catch (error) {
    console.error('Error en limpiarHoja: ' + error.message);
  }
  try {
    traerContactos();
  } catch (error) {
    console.error('Error en traerContactos: ' + error.message);
  }
}



// Esta función lo que hace es revisar los contactos que han sido modificados en alguno de sus campos. Los que cumplan la condición, el trigger pondrá un valor TRUE en la columna "Contacto editado" (al final). Este valor TRUE servirá para que la función actualizarContactos realice las modificaciones pertinentes en Google Contacts.
function contactosAactualizar(e) {
  var sheet = e.source.getActiveSheet();

  if (sheet.getName() === "👥 Mis Contactos") {
    var rangoEditado = e.range;
    var numFilasEditadas = rangoEditado.getNumRows();
    var primeraFilaEditada = rangoEditado.getRow();
    var columnaEditada = rangoEditado.getColumn();

    // Iterar sobre todas las filas afectadas por la edición
    for (var i = 0; i < numFilasEditadas; i++) {
      var filaActual = primeraFilaEditada + i;

      // Ajustar las condiciones para excluir cambios en la columna A y considerar hasta la columna K
      // Ahora comprobamos si la columna editada está entre 2 y 10 (B a K)
      if (filaActual >= 5 && columnaEditada > 1 && columnaEditada <= 10) {
        // Marca la fila actual para actualizar en la columna K (índice 11), sin importar si la celda editada está vacía o no
        sheet.getRange(filaActual, 11).setValue(true);
      }
    }
  }
}

function eliminarContactosMarcados() {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("👥 Mis Contactos");

  // Comprueba si hay al menos 5 filas en la hoja
  if (hoja.getLastRow() >= 5) {
    // Obtén los datos de la hoja a partir de la fila 5
    var datos = hoja.getRange(5, 1, hoja.getLastRow() - 4, hoja.getLastColumn()).getValues();

    for (var i = 0; i < datos.length; i++) {
      var casillaMarcada = datos[i][0]; // Asume que la columna 0 contiene las casillas de verificación
      var resourceName = datos[i][11]; // Asume que la columna "Resource Name" es la columna L

      if (casillaMarcada && resourceName !== "") { // Si la casilla de verificación está marcada y el resourceName no está vacío
        var exito = false;
        do {
          try {
            // Usa la API de People para eliminar el contacto
            People.People.deleteContact(resourceName);
            exito = true; // Si la solicitud fue exitosa, establece exito en true
          } catch (error) {
            console.error('Error en eliminarContactosMarcados: ' + error.message);
            // Espera 1 segundo antes de reintentar
            Utilities.sleep(1000);
          }
        } while (!exito); // Continúa reintentando hasta que la solicitud sea exitosa
      }
    }
  }
}

function actualizarContactos() {
  console.log('Iniciando la función actualizarContactos');
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("👥 Mis Contactos");

  if (sheet.getLastRow() >= 5) {
    console.log('Procesando datos de la hoja');
    var dataRange = sheet.getRange(5, 1, sheet.getLastRow() - 4, sheet.getLastColumn());
    var data = dataRange.getValues();

    var grupos = People.ContactGroups.list().contactGroups.reduce((obj, group) => {
      obj[group.name] = group.resourceName;
      return obj;
    }, {});

    for (var i = 0; i < data.length; i++) {
      if (data[i][10] === true) {
        try {
          var contactoInfo = {
            "givenName": data[i][1],
            "familyName": data[i][2],
            "emailValue": data[i][3],
            "phoneValue": data[i][4].toString(),
            "organizationName": data[i][5],
            "resourceName": data[i][11],
            "etag": data[i][12],
            "memberships": [data[i][6], data[i][7], data[i][8], data[i][9]].filter(Boolean)
          };

          if (contactoInfo.memberships.length === 0) {
            // Agregar al grupo 'myContacts' si no hay ningún otro grupo
            contactoInfo.memberships.push('myContacts'); // Asegúrate de usar el resourceName correcto para 'myContacts'
          }

          console.log('Actualizando contacto:', contactoInfo.givenName, contactoInfo.familyName);

          var bodyRequest = {
            "resourceName": contactoInfo.resourceName,
            "etag": contactoInfo.etag,
            "names": [{
              "givenName": contactoInfo.givenName,
              "familyName": contactoInfo.familyName
            }],
            "emailAddresses": [{
              "value": contactoInfo.emailValue
            }],
            "phoneNumbers": [{
              "value": contactoInfo.phoneValue
            }],
            "organizations": [{
              "name": contactoInfo.organizationName
            }],
            "memberships": contactoInfo.memberships.map(group => {
              return { "contactGroupMembership": { "contactGroupResourceName": grupos[group] || crearGrupo(group) } };
            })
          };

          var contactoActualizado = People.People.updateContact(
            bodyRequest, contactoInfo.resourceName, { updatePersonFields: 'names,emailAddresses,organizations,phoneNumbers,memberships' }
          );

          sheet.getRange(i + 5, 13).setValue(contactoActualizado.etag);
        } catch (error) {
          console.error('Error actualizando contacto ' + contactoInfo.givenName + ' ' + contactoInfo.familyName + ' en fila ' + (i + 5) + ':', error.message);
        }
      }
    }

    try {
      eliminarGruposVacios();
    } catch (error) {
      console.error('Error en eliminarGruposVacios:', error.message);
    }

    if (sheet.getLastRow() >= 5) {
      sheet.getRange(5, 13, sheet.getLastRow() - 4).clearContent();
    }
  } else {
    console.log('No hay suficientes filas para procesar en la hoja');
  }

  console.log('Finalizada la función actualizarContactos');
}


function crearGrupo(nombreGrupo) {
  var grupos = People.ContactGroups.list().contactGroups;
  for (var i = 0; i < grupos.length; i++) {
    if (grupos[i].name == nombreGrupo) {
      return grupos[i].resourceName;
    }
  }
  var nuevoGrupo = People.ContactGroups.create({
    contactGroup: {
      name: nombreGrupo
    }
  });
  return nuevoGrupo.resourceName;
}

function eliminarGruposVacios() {
  // Obtén una lista de todos los grupos de contactos
  var grupos = People.ContactGroups.list().contactGroups;

  // Recorre los grupos de contactos
  for (var i = 0; i < grupos.length; i++) {
    var grupo = grupos[i];

    // Si el grupo es un grupo de contactos del sistema, omítelo
    if (grupo.groupType === "SYSTEM_CONTACT_GROUP") {
      continue;
    }

    // Obtén una lista de todos los contactos en el grupo
    var respuesta = People.ContactGroups.get(grupo.resourceName, {
      maxMembers: 1
    });
    var contactos = respuesta.memberResourceNames;

    // Si el grupo está vacío, elimínalo
    if (!contactos || contactos.length === 0) {
      var exito = false;
      do {
        try {
          People.ContactGroups.remove(grupo.resourceName);
          Logger.log("Grupo de contactos eliminado: " + grupo.name);
          exito = true; // Si la solicitud fue exitosa, establece exito en true
        } catch (error) {
          Logger.log('Error en eliminarGruposVacios: ' + error.message);
          // Espera 1 segundo antes de reintentar
          Utilities.sleep(1000);
        }
      } while (!exito); // Continúa reintentando hasta que la solicitud sea exitosa
    }
  }
}

function limpiarHoja() {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("👥 Mis Contactos");

  // Comprueba si hay más de cuatro filas en la hoja
  if (hoja.getLastRow() > 4) {
    // Borra todos los datos de la hoja, excepto los encabezados de las primeras cuatro filas
    hoja.getRange(5, 1, hoja.getLastRow() - 4, hoja.getLastColumn()).clearContent();
  }
}

function traerContactos() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName("👥 Mis Contactos");
  var configSheet = spreadsheet.getSheetByName("⚙️ Configuración");

  // Obtener las etiquetas configuradas para cada categoría desde la hoja de "⚙️ Configuración"
  var columnasEtiquetas = [2, 3, 5, 6]; // Las columnas B, C, E y F
  var filaInicioEtiquetas = 11; // Las etiquetas empiezan en la fila 11
  var etiquetasCategorias = [];
  
  columnasEtiquetas.forEach(function(col) {
    var etiquetas = configSheet.getRange(filaInicioEtiquetas, col, configSheet.getLastRow() - (filaInicioEtiquetas - 1), 1).getValues().flat().filter(String);
    etiquetasCategorias.push(etiquetas);
  });

  let contactos = People.People.Connections.list('people/me', { personFields: 'names,emailAddresses,organizations,phoneNumbers,memberships' });

  // Verificar si hay conexiones/contactos
  if (!contactos.connections || contactos.connections.length === 0) {
    SpreadsheetApp.getUi().alert('¡No hay contactos que mostrar!');
    return; // Detener la ejecución si no hay contactos
  }

  let conexiones = contactos.connections;

  var dataRange = sheet.getDataRange();
  var data = dataRange.getValues();

  var grupos = People.ContactGroups.list({}).contactGroups.reduce((obj, group) => {
    obj[group.resourceName] = group.name;
    return obj;
  }, {});

  var nuevosContactos = [];

  conexiones.forEach(conexion => {
    var dataContacto = [""];

    dataContacto.push(conexion["names"] ? conexion["names"][0]["givenName"] : "N/A"); // Nombre
    dataContacto.push(conexion["names"] ? conexion["names"][0]["familyName"] : "N/A"); // Apellidos
    dataContacto.push(conexion["emailAddresses"] ? conexion["emailAddresses"][0]["value"] : "N/A"); // E-mail
    dataContacto.push(conexion["phoneNumbers"] ? conexion["phoneNumbers"][0]["value"] : ""); // Teléfono
    dataContacto.push(conexion["organizations"] ? conexion["organizations"][0]["name"] : ""); // Puesto / Departamento

    var gruposContacto = [];

    if (conexion["memberships"]) {
      conexion["memberships"].forEach(membership => {
        if (membership["contactGroupMembership"]) {
          var resourceName = membership["contactGroupMembership"]["contactGroupResourceName"];
          var groupName = grupos[resourceName];
          if (groupName !== "myContacts") {
            gruposContacto.push(groupName);
          }
        }
      });
    }

    var gruposMapeados = Array(4).fill(""); // Array para los 4 grupos con valores iniciales vacíos

    // Primero asignar etiquetas listadas en "⚙️ Configuración"
    gruposContacto.forEach(grupo => {
      for (var i = 0; i < etiquetasCategorias.length; i++) {
        if (etiquetasCategorias[i].includes(grupo) && gruposMapeados[i] === "") {
          gruposMapeados[i] = grupo;
          return;
        }
      }
    });

    // Luego asignar etiquetas no listadas a los espacios vacíos restantes
    gruposContacto.forEach(grupo => {
      if (!etiquetasCategorias.flat().includes(grupo)) {
        var indiceVacio = gruposMapeados.indexOf("");
        if (indiceVacio !== -1) {
          gruposMapeados[indiceVacio] = grupo;
        }
      }
    });

    dataContacto = dataContacto.concat(gruposMapeados);
    
    // Añadir un espacio en blanco para la columna K
    dataContacto.push(""); // Espacio en blanco para la columna K

    // Añadir ResourceName y etag
    dataContacto.push(conexion["resourceName"]);
    dataContacto.push(conexion["etag"]);

    var exists = data.some(row => row[1] === dataContacto[1] && row[3] === dataContacto[3]);

    if (!exists) {
      nuevosContactos.push(dataContacto);
    }
  });

  // Ordenar los nuevosContactos primero por Etiqueta 1, luego por apellido, y por nombre si los apellidos son iguales o no definidos
  nuevosContactos.sort(function (a, b) {
    var etiquetaA = (a[6] || "").toLowerCase(); // Etiqueta 1 está en la columna G, índice 6
    var etiquetaB = (b[6] || "").toLowerCase();
    var apellidoA = (a[2] || "").toLowerCase();
    var apellidoB = (b[2] || "").toLowerCase();
    var nombreA = (a[1] || "").toLowerCase();
    var nombreB = (b[1] || "").toLowerCase();

    // Si uno de los contactos no tiene Etiqueta 1, lo movemos al final
    if (!etiquetaA && etiquetaB) return 1; // Si A no tiene etiqueta y B sí, A va después
    if (etiquetaA && !etiquetaB) return -1; // Si A tiene etiqueta y B no, A va antes

    // A partir de aquí, ambos tienen etiquetas o ambos están sin etiquetas
    if (etiquetaA !== etiquetaB) {
      // Primero ordenar por Etiqueta 1 si ambos tienen
      return etiquetaA.localeCompare(etiquetaB);
    } else if (apellidoA === apellidoB) {
      // Si los apellidos son iguales, ordenar por nombre
      return nombreA.localeCompare(nombreB);
    } else {
      // Si las etiquetas son iguales, ordenar por apellido
      return apellidoA.localeCompare(apellidoB);
    }
  });

  // Añadir los nuevos contactos ordenados a la hoja de cálculo
  if (nuevosContactos.length > 0) {
    var startRow = sheet.getLastRow() + 1;
    var numberColumns = nuevosContactos[0].length;
    sheet.getRange(startRow, 1, nuevosContactos.length, numberColumns).setValues(nuevosContactos);
  }

}
