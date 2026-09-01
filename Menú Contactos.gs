/**
 * Función para eliminar todos los activadores para comprobarYCrearContactos
 */
function eliminarActivadorComprobarYCrearContactos() {
  const activadores = ScriptApp.getProjectTriggers();
  activadores.forEach((activador) => {
    // Verificar si el activador es para comprobarYCrearContactos
    if (activador.getHandlerFunction() === 'comprobarYCrearContactos') {
      ScriptApp.deleteTrigger(activador);
    }
  });
}

/**
 * Esta función se activa de manera manual en el menú. Realiza la comprobación si el miembro pertenece al grupo del profesorado.
 * En caso afirmativo, activa un trigger para la función comprobarYCrearContactos.
 */
function crearActivadorCrearContactos() {

  const emailUsuario = Session.getActiveUser().getEmail();
  const usuarioActivador = PropertiesService.getScriptProperties().getProperty(emailUsuario);

  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('⚙️ Configuración');
  var correo = hoja.getRange('D4').getValue();

  // Ignorar el correo si contiene el texto específico y tratar como si no hubiese correo
  if (correo === "<< Correo electrónico del grupo del profesorado >>") {
    correo = ""; // Tratar como si estuviera vacío
  }

  // Comprobar si el usuario está en el grupo y si la configuración permite la sincronización
  const esMiembro = correo ? esMiembroDelGrupo(emailUsuario) : true;

  if (!usuarioActivador && esMiembro) {
    eliminarActivadorComprobarYCrearContactos(); // Elimina los activadores existentes

    // Crear disparador para comprobar y crear contactos
    ScriptApp.newTrigger('comprobarYCrearContactos')
      .timeBased()
      .everyDays(PARAMS.activador.cadaNumDias)
      .atHour(PARAMS.activador.hora)
      .create();

    PropertiesService.getScriptProperties().setProperty(emailUsuario, 'activado');
    onOpen();
    SpreadsheetApp.getUi().alert(
      PARAMS.tituloMensajes,
      `🟢 Los contactos se sincronizarán cada ${PARAMS.activador.cadaNumDias} día(s) a las ${PARAMS.activador.hora}:00 horas aproximadamente.`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } else if (!esMiembro && correo) {
    SpreadsheetApp.getUi().alert(
      PARAMS.tituloMensajes,
      '😢 No puedes subir los contactos puesto que NO perteneces al grupo especificado en la pestaña ⚙️ Configuración. \n\nElimina el grupo para no tener en cuenta los contactos de ese centro (y solo subir los tuyos propios) o modifica el correo por uno al que sí pertenezcas para poder realizar la sincronización.',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  }

}

function obtenerNombreDeCentro() {

  var hojaConfiguracion = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('⚙️ Configuración');
  var nombreCentro = hojaConfiguracion.getRange('F4').getValue();

  Logger.log("Nombre del Centro: " + nombreCentro);

  return nombreCentro;

}

/**
 * Esta función se activa cuando el trigger es válido. Lo que hace es comprobar periódicamente si el usuario es miembro del grupo del claustro.
 * Cuando deje de serlo envía un email advirtiéndolo y activa eliminarActivadorCrearContactosSilencioso
 */
function comprobarYCrearContactos() {

  try {
    const emailUsuario = Session.getActiveUser().getEmail();
    var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('⚙️ Configuración');
    var correo = hoja.getRange('D4').getValue();

    // Ignorar el correo si contiene el texto específico y tratar como si no hubiese correo
    if (correo === "<< Correo electrónico del grupo del profesorado >>") {
      correo = ""; // Tratar como si estuviera vacío
    }

    const esMiembro = correo ? esMiembroDelGrupo(emailUsuario) : true;

    if (esMiembro) {
      crearContactos();
    } else {
      var nombreCentro = obtenerNombreDeCentro();
      var hoja = SpreadsheetApp.getActiveSpreadsheet();
      var urlHoja = hoja.getUrl();
      var cuerpoHtml =
        '<p>¡Hola!</p>' +
        '<p>Esperamos que estés bien. Te escribimos para informarte de un cambio importante en la sincronización de tus contactos con la hoja de cálculo <strong>' + PARAMS.nombreApp + '</strong>.</p>' +
        '<p>Hemos detectado que ya no formas parte del grupo especificado en la pestaña <strong>⚙️ Configuración</strong> de la hoja de cálculo, que corresponde al <strong>' + nombreCentro + '</strong>.</p>' +
        '<p>Debido a esto, hemos detenido automáticamente la sincronización de contactos para tu cuenta. Esto es una medida de seguridad y gestión para asegurar que solo los miembros actuales del grupo tengan acceso a esta funcionalidad.</p>' +
        '<p>Si crees que esto es un error o si has cambiado de centro, por favor actualiza la configuración en la pestaña <strong>⚙️ Configuración</strong> o ponte en contacto con tu administrador para más asistencia.</p>' +
        '<p>Puedes acceder a la hoja de cálculo <a href="' + urlHoja + '">aquí</a>.</p>' +
        '<p>Lamentamos cualquier inconveniente que esto pueda causarte.</p>' +
        '<p>Gracias por usar <strong>' + PARAMS.nombreApp + '</strong>.</p>' +
        '<p>Saludos cordiales.</p>';

      MailApp.sendEmail({
        to: emailUsuario,
        subject: 'Actualización Importante: Sincronización de Contactos Desactivada',
        htmlBody: cuerpoHtml
      });

      eliminarEtiquetasContactosSincronizados();  // Limpia las etiquetas de los contactos sincronizados. Esta función está en el archivo Limpieza.
      eliminarActivadorCrearContactosSilencioso();  // Elimina los disparadores existentes
    }
  } catch (error) {
    eliminarActivadorCrearContactosSilencioso(); // Elimina el activador actual si hay un error
    // Opcional: Reintentar después de 5 minutos, eliminar si no se desea
    ScriptApp.newTrigger('comprobarYCrearContactos')
      .timeBased()
      .after(5 * 60 * 1000) // 5 minutos
      .create();

    Logger.log('Error en comprobarYCrearContactos: ' + error.message);
  }

}

/**
 * Esta función no se ejecuta automáticamente. Solo sirve para comprobar que funcione el envío de correo electrónico cuando una persona deja de pertenecer al centro y el formato con el que se envía.
 */
function enviarCorreo(emailUsuario, nombreCentro) {

  var emailUsuario = Session.getActiveUser().getEmail();
  var nombreCentro = obtenerNombreDeCentro();
  var hoja = SpreadsheetApp.getActiveSpreadsheet();
  var urlHoja = hoja.getUrl();

  var cuerpoHtml =
    '<p>¡Hola!</p>' +
    '<p>Esperamos que estés bien. Te escribimos para informarte de un cambio importante en la sincronización de tus contactos con la hoja de cálculo <strong>' + PARAMS.nombreApp + '</strong>.</p>' +
    '<p>Hemos detectado que ya no formas parte del grupo especificado en la pestaña <strong>⚙️ Configuración</strong> de la hoja de cálculo, que corresponde al <strong>' + nombreCentro + '</strong>.</p>' +
    '<p>Debido a esto, hemos detenido automáticamente la sincronización de contactos para tu cuenta. Esto es una medida de seguridad y gestión para asegurar que solo los miembros actuales del grupo tengan acceso a esta funcionalidad.</p>' +
    '<p>Si crees que esto es un error o si has cambiado de centro, por favor actualiza la configuración en la pestaña <strong>⚙️ Configuración</strong> o ponte en contacto con tu administrador para más asistencia.</p>' +
    '<p>Puedes acceder a la hoja de cálculo <a href="' + urlHoja + '">aquí</a>.</p>' +
    '<p>Lamentamos cualquier inconveniente que esto pueda causarte.</p>' +
    '<p>Gracias por usar <strong>' + PARAMS.nombreApp + '</strong>.</p>' +
    '<p>Saludos cordiales.</p>';

  MailApp.sendEmail({
    to: emailUsuario,
    subject: 'Actualización Importante: Sincronización de Contactos Desactivada',
    htmlBody: cuerpoHtml
  });

}

/** 
 * Esta función se activa cuando el usuario deja de pertenecer al grupo del profesorado. 
 * Es silencioso y no regenera el menú ni saltan notificaciones
 * Se utiliza para evitar errores respecto a eliminarActivadorCrearContactos.
*/
function eliminarActivadorCrearContactosSilencioso() {

  const emailUsuario = Session.getActiveUser().getEmail();
  Logger.log('Intentando eliminar el activador para: ' + emailUsuario);
  const usuarioActivador = PropertiesService.getScriptProperties().getProperty(emailUsuario);

  if (usuarioActivador) {
    const activadores = ScriptApp.getProjectTriggers();
    Logger.log('Se encontraron ' + activadores.length + ' activador(es) para revisar.');

    activadores.forEach((activador) => {
      Logger.log('Revisando activador: ' + activador.getUniqueId() + ' con función: ' + activador.getHandlerFunction());
      if (activador.getHandlerFunction() === 'comprobarYCrearContactos') {
        ScriptApp.deleteTrigger(activador);
        Logger.log('Activador eliminado: ' + activador.getUniqueId());
      }
    });

    PropertiesService.getScriptProperties().deleteProperty(emailUsuario);
    Logger.log('Propiedad eliminada para: ' + emailUsuario);
  } else {
    Logger.log('No se encontró activador para: ' + emailUsuario);
  }

}


/**
 * Desactivar el trigger para sincronizar contactos de manera manual mediante el menú. Con este botón se regenera el menú y salta aviso
*/
function eliminarActivadorCrearContactos() {

  // Obtener el correo electrónico del usuario activo
  const emailUsuario = Session.getActiveUser().getEmail();

  // Determinar si ya se ha activado la creación de contactos para este usuario
  const usuarioActivador = PropertiesService.getScriptProperties().getProperty(emailUsuario);

  if (usuarioActivador) {
    // Eliminar todos los activadores relevantes instalados por este script
    const activadores = ScriptApp.getProjectTriggers();
    activadores.forEach(activador => {
      if (activador.getHandlerFunction() === 'comprobarYCrearContactos') {
        ScriptApp.deleteTrigger(activador);
      }
    });

    // Actualizar propiedad, regenerar menú e informar al usuario
    PropertiesService.getScriptProperties().deleteProperty(emailUsuario);
    onOpen();
    SpreadsheetApp.getUi().alert(
      PARAMS.tituloMensajes,
      '🔴 Se ha desactivado la sincronización diaria de contactos.',
      SpreadsheetApp.getUi().ButtonSet.OK
    );

  } else {
    SpreadsheetApp.getUi().alert(
      PARAMS.tituloMensajes,
      '⚠️ La creación de contactos no está activada.',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  }

}

