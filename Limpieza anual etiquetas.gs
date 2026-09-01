/** 
 * 1. Configurar Disparador para Limpieza Anual
 * Crearemos un disparador que se configure para correr cada año en la fecha especificada por PARAMS.fechaLimpieza, y que se actualice automáticamente si es modificado. Este disparador limpiará las etiquetas de la hoja ⬆️ Datos.
 */

// Función para verificar y configurar el disparador con selector de mes y día
function verificarYConfigurarDisparadorLimpieza() {
  var scriptProperties = PropertiesService.getScriptProperties();

  // Verificamos si los disparadores realmente existen
  if (!disparadoresExisten()) {
    // Si no existen, actualizamos la propiedad a 'false'
    scriptProperties.setProperty('disparadorLimpiezaConfigurado', 'false');
  }

  var disparadorConfigurado = scriptProperties.getProperty('disparadorLimpiezaConfigurado');
  var configuracionPrevias = getConfiguracionPrevias(); // Obtenemos la última configuración guardada

  var ui = SpreadsheetApp.getUi();
  var fechaConfigurada = obtenerFechaConfigurada();

  if (disparadorConfigurado === 'true') {
    var response = ui.alert('Disparador ya configurado',
      'El disparador de limpieza anual ya está configurado.' + '\nFecha establecida: ' + fechaConfigurada + '.\n\n¿Desea reconfigurarlo?',
      ui.ButtonSet.YES_NO);
    if (response == ui.Button.NO) {
      return;
    }
  }

  // Si no está configurado o se desea reconfigurar
  var configuracionPrevias = getConfiguracionPrevias(); // Obtenemos la última configuración guardada
  var mesPredeterminado = configuracionPrevias.mes || ''; // Usa el mes previo o una cadena vacía si no hay configuración previa
  var diaPredeterminado = configuracionPrevias.dia || ''; // Usa el día previo o una cadena vacía si no hay configuración previa

  var nombreDelMesPredeterminado = mesPredeterminado ? nombreDelMes(mesPredeterminado) : '';

  var mensajePrompt = 'Último mes guardado: ' + mesPredeterminado;
  if (nombreDelMesPredeterminado) {
    mensajePrompt += ' (' + nombreDelMesPredeterminado + ')';
  }

  var mes = ui.prompt('Ingrese el mes en número (1-12):', mensajePrompt, ui.ButtonSet.OK_CANCEL).getResponseText();
  var dia = ui.prompt('Ingrese el día del mes:', 'Último día guardado: ' + diaPredeterminado, ui.ButtonSet.OK_CANCEL).getResponseText();

  if (mes && dia) {
    var mensaje = configurarDisparadorLimpiezaAnual(parseInt(mes), parseInt(dia));
    scriptProperties.setProperty('disparadorLimpiezaConfigurado', 'true');
    ui.alert('Configuración Exitosa', mensaje, ui.ButtonSet.OK);
  } else {
    ui.alert('Configuración Cancelada', 'No se ha configurado ningún disparador.', ui.ButtonSet.OK);
  }

  // Reconstruir el menú para reflejar los cambios
  reconstruirMenu();
  
}


// Función para verificar si los disparadores existen
function disparadoresExisten() {
  var allTriggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < allTriggers.length; i++) {
    if (allTriggers[i].getHandlerFunction() == 'limpiarEtiquetasEnDatos' ||
      allTriggers[i].getHandlerFunction() == 'configurarDisparadorLimpiezaAnual') {
      return true;
    }
  }
  return false;
}

// Función para configurar el disparador de limpieza anual
function configurarDisparadorLimpiezaAnual(mes, dia) {
  // Primero, elimina cualquier disparador existente
  eliminarDisparadoresLimpieza();

  var properties = PropertiesService.getScriptProperties();
  properties.setProperty('ultimoMes', mes.toString());
  properties.setProperty('ultimoDia', dia.toString());

  // Configura la fecha de limpieza
  var fechaLimpieza = new Date();
  fechaLimpieza.setMonth(mes - 1, dia);
  fechaLimpieza.setHours(0, 0, 0, 0);
  if (fechaLimpieza < new Date()) {
    fechaLimpieza.setFullYear(fechaLimpieza.getFullYear() + 1);
  }

  ScriptApp.newTrigger('limpiarEtiquetasEnDatos')
    .timeBased()
    .at(fechaLimpieza)
    .create();
  reconstruirMenu();

  // Programa este método para ejecutarse de nuevo al día siguiente del año siguiente
  ScriptApp.newTrigger('configurarDisparadorLimpiezaAnual')
    .timeBased()
    .at(new Date(fechaLimpieza.getTime() + 1000 * 60 * 60 * 24)) // Configurar para el día después de la limpieza
    .create();
  var fechaConfigurada = obtenerFechaConfigurada();
  var mensaje = "🗓️ Disparador anual para limpieza de etiquetas configurado para el " + fechaConfigurada;
  Logger.log(mensaje);
  return mensaje;
}

// Función para eliminar los disparadores y actualizar la propiedad
function eliminarDisparadoresLimpieza() {
  var allTriggers = ScriptApp.getProjectTriggers();
  var disparadoresEliminados = false;

  for (var i = 0; i < allTriggers.length; i++) {
    if (allTriggers[i].getHandlerFunction() == 'limpiarEtiquetasEnDatos' ||
      allTriggers[i].getHandlerFunction() == 'configurarDisparadorLimpiezaAnual') {
      ScriptApp.deleteTrigger(allTriggers[i]);
      disparadoresEliminados = true;
    }
  }

  if (disparadoresEliminados) {
    // Actualiza el estado para indicar que el disparador ya no está configurado
    PropertiesService.getScriptProperties().setProperty('disparadorLimpiezaConfigurado', 'false');
    Logger.log("Disparadores de limpieza eliminados y estado actualizado a 'false'.");
  }

  reconstruirMenu();
}

// Esta función solo sirve para recordar al formulario la última fecha establecida
function getConfiguracionPrevias() {
  var properties = PropertiesService.getScriptProperties();
  return {
    mes: properties.getProperty('ultimoMes'),
    dia: properties.getProperty('ultimoDia')
  };
}

function limpiarEtiquetasEnDatos() {
  var hojaDatos = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("⬆️ Datos");
  var rangoEtiquetas = hojaDatos.getRange("E3:H" + hojaDatos.getLastRow());
  rangoEtiquetas.clearContent();  // Esto elimina el contenido de las celdas en las columnas E, F, G y H
  Logger.log("Etiquetas en las columnas E, F, G y H han sido eliminadas.");
  // Actualizar marca temporal
  actualizarMarcaTemporalEnDatos();
}

// Esta función incluye una marca temporal en la pestaña DATOS cuando se hace la limpieza de etiquetas anualmente. 
function actualizarMarcaTemporalEnDatos() {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("⬆️ Datos");
  var rangoDatos = hoja.getRange("A3:A" + hoja.getLastRow()); // Asume que los datos comienzan en la fila 3
  var datos = rangoDatos.getValues();
  var marcaTemporal = new Date(); // Marca temporal actual
  var marcas = [];

  // Crear un array para las marcas temporales
  for (var i = 0; i < datos.length; i++) {
    if (datos[i][0] !== "") { // Asume que la columna A tiene datos
      marcas.push([marcaTemporal]);
    } else {
      marcas.push([""]); // No colocar marca temporal donde no hay datos
    }
  }

  // Establecer la marca temporal en la columna I
  if (marcas.length > 0) {
    hoja.getRange(2, 9, marcas.length, 1).setValues(marcas); // Columna I desde la fila 2
  }
}

/**
 * 2. Ejecución y Limpieza cuando un Usuario Abandona el Centro
 * Para gestionar la salida de un usuario del grupo, debes tener un mecanismo que verifique periódicamente la pertenencia al grupo y, si el usuario ya no pertenece, ejecutar la limpieza y desactivar los disparadores.
 */
function verificarPertenenciaYActuar() {
  const emailUsuario = Session.getActiveUser().getEmail();
  if (!esMiembroDelGrupo(emailUsuario)) {
    eliminarEtiquetasContactosSincronizados();
    eliminarTodosLosActivadores();
    Logger.log("El usuario ha sido eliminado del grupo y los disparadores han sido limpiados.");
  }
}

function eliminarTodosLosActivadores() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var trigger of triggers) {
    ScriptApp.deleteTrigger(trigger);
  }
}


function eliminarEtiquetasContactosSincronizados() {
  // Obtener la hoja de "Subir Contactos"
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Subir Contactos");
  var datos = hoja.getDataRange().getValues();

  // Crear un conjunto de emails a partir de la hoja
  var emails = new Set();
  for (var i = 1; i < datos.length; i++) {
    var email = datos[i][4] ? datos[i][4].toString() : '';
    if (isValidEmail(email)) {
      emails.add(email);
    }
  }

  // Obtener la lista de contactos del usuario
  var respuesta = People.People.Connections.list('people/me', {
    personFields: 'names,emailAddresses,memberships'
  });

  var contactosExistentes = respuesta.connections ? respuesta.connections : [];

  for (var i = 0; i < contactosExistentes.length; i++) {
    var contacto = contactosExistentes[i];

    // Verificar si el contacto tiene etiquetas (memberships)
    if (contacto.emailAddresses && contacto.memberships && contacto.memberships.length > 0) {
      for (var j = 0; j < contacto.emailAddresses.length; j++) {
        var emailContacto = contacto.emailAddresses[j].value;

        // Eliminar etiquetas solo si el email está en la hoja de "Subir Contactos"
        if (emails.has(emailContacto)) {
          // Establecer memberships a "myContacts"
          contacto.memberships = [{
            contactGroupMembership: {
              contactGroupResourceName: "contactGroups/myContacts"
            }
          }];

          // Actualizar el contacto con la membresía a "myContacts"
          People.People.updateContact(contacto, contacto.resourceName, { updatePersonFields: 'memberships' });
          Logger.log("Etiquetas eliminadas y asignado a 'myContacts' del contacto: " + (contacto.names ? contacto.names[0].displayName : "Desconocido"));
          break; // Salir del bucle ya que no es necesario revisar más emails del mismo contacto
        }
      }
    }
  }
  eliminarGruposVacios();
}
