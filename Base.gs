const PARAMS = {
  version: 'Versión: 3.3 (agosto 2024)',
  nombreApp: 'Asistente de Contactos',
  icono: '👥',
  tituloMensajes: 'Asistente de Contactos',
  activador: {
    clavePropActivador: 'usuarioActivadorCrearContactos',
    hora: 0, // hora aproximada a la que se realizará el proceso de sincronización
    cadaNumDias: 1 // cada cuántos días se realizará la sincronización
  },
};

/** Menú al abrir la hoja de cálculo */
function onOpen() {
  var ui = SpreadsheetApp.getUi();

  var scriptProperties = PropertiesService.getScriptProperties();
  var esPrimeraVez = scriptProperties.getProperty('esPrimeraVez');

  if (!esPrimeraVez) {
    resetearPropiedadesDisparadores();
    scriptProperties.setProperty('esPrimeraVez', 'true');  // Marcamos que ya se ejecutó
  }

  construirMenu();  // Llama a la función de construcción del menú cuando se abre la hoja
}

/** Menú al regenerar */
function reconstruirMenu() {
  construirMenu();  // Llama a la misma función cuando necesitas reconstruir el menú dinámicamente
}

/** Menú */
function construirMenu() {
  var ui = SpreadsheetApp.getUi();
  var menu = ui.createMenu(`${PARAMS.icono} ${PARAMS.nombreApp}`);

  // Añade las opciones de menú habituales
  menu.addItem('⬆️ Subir Contactos', 'confirmarYCrearContactos');

  const emailUsuario = Session.getActiveUser().getEmail();
  const usuarioActivador = PropertiesService.getScriptProperties().getProperty(emailUsuario);

  // Agregar ítems dependiendo del estado del usuario
  try {
    if (usuarioActivador) {
      menu.addItem('🔴 Detener la sincronización diaria de contactos', 'eliminarActivadorCrearContactos');
    } else {
      menu.addItem('🔁 Sincronizar contactos diariamente', 'confirmarYSincronizacionDiaria');
    }
  } catch (e) {
    menu.addItem('🔓 Autorizar Acceso', 'solicitarPermisos');
  }

  // Verificar si el usuario actual es el propietario de la hoja
  var propietarioHoja = SpreadsheetApp.getActiveSpreadsheet().getOwner().getEmail();

  if (emailUsuario === propietarioHoja) {
    // Añadir una línea de separación antes de la última opción
    menu.addSeparator();

    // Comprobación del estado del disparador en PropertiesService
    var fechaConfigurada = obtenerFechaConfigurada();

    // Verificar si el disparador de limpieza anual está configurado
    var disparadorLimpiezaActivo = PropertiesService.getScriptProperties().getProperty('disparadorLimpiezaConfigurado') === 'true';

    // Ajustar el texto del menú según el estado del disparador
    var textoLimpiezaAnual;
    if (disparadorLimpiezaActivo) {
      textoLimpiezaAnual = `🧹 Configurar Limpieza Anual (Fecha establecida: ${fechaConfigurada})`;
    } else {
      textoLimpiezaAnual = `🧹 Configurar Limpieza Anual (Fecha NO establecida)`;
    }

    // Añadir el ítem al menú con el texto adecuado
    menu.addItem(textoLimpiezaAnual, 'verificarYConfigurarDisparadorLimpieza');

    // Si el disparador está activo, ofrecer la opción de eliminarlo
    if (disparadorLimpiezaActivo) {
      menu.addItem('🗑️ Eliminar Disparador de Limpieza Anual', 'eliminarDisparadoresLimpieza');
    }
  }

  // Añadir una línea de separación antes de la última opción
  menu.addSeparator();
  menu.addItem('ℹ️ Acerca del Asistente de Contactos', 'acercaDe');

  // Añadir el menú a la interfaz de usuario
  menu.addToUi();
}


// Función auxiliar para obtener la última fecha guardada y poder mostrarla al regenerar el menú
function obtenerFechaConfigurada() {
  var properties = PropertiesService.getScriptProperties();
  var ultimoMes = properties.getProperty('ultimoMes');
  var ultimoDia = properties.getProperty('ultimoDia');

  if (ultimoMes && ultimoDia) {
    return `${ultimoDia} de ${nombreDelMes(ultimoMes)}`;
  }

}

// Función auxiliar para convertir el número de mes a nombre
function nombreDelMes(mes) {
  const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  return meses[parseInt(mes) - 1];  // Asegurar conversión de número a índice correcto
}

function confirmarYCrearContactos() {
  var ui = SpreadsheetApp.getUi();

  // Obtener el mensaje personalizado de sincronización
  var mensaje = obtenerMensajeSubirContactos();
  
  // Mostrar el mensaje de confirmación con el mensaje personalizado
  var respuesta = ui.alert('Confirmación', mensaje + '\n\n¿Estás seguro de que deseas subir los contactos a tu cuenta de Google Contacts?', ui.ButtonSet.OK_CANCEL);

  // Comprobar la respuesta del usuario
  if (respuesta == ui.Button.OK) {
    crearContactos();  // Llamar a la función para crear contactos si el usuario acepta
  } 
}

function confirmarYSincronizacionDiaria() {
  var ui = SpreadsheetApp.getUi();

  // Obtener el correo electrónico del usuario activo
  const emailUsuario = Session.getActiveUser().getEmail();
  const usuarioActivador = PropertiesService.getScriptProperties().getProperty(emailUsuario);

  // Verificar si el usuario ya ha activado la sincronización diaria
  if (usuarioActivador) {
    // Mostrar un mensaje indicando que ya está activada la sincronización
    ui.alert('Sincronización Diaria Activada', 'Ya has activado la sincronización diaria de contactos. No hace falta que hagas nada más 😉', ui.ButtonSet.OK);
  } else {
    // Obtener el mensaje personalizado de sincronización
    var mensaje = obtenerMensajeSincronizacionDiaria();

    // Mostrar el mensaje de confirmación con el mensaje personalizado
    var respuesta = ui.alert('Confirmación de SINCRONIZACIÓN DIARIA', mensaje + '\n\n¿Estás seguro de que deseas activar la sincronización diaria de los contactos en tu cuenta de Google Contacts?', ui.ButtonSet.OK_CANCEL);

    // Comprobar la respuesta del usuario
    if (respuesta == ui.Button.OK) {
      crearActivadorCrearContactos();  // Llamar a la función para sincronizar diariamente los contactos si el usuario acepta
      
      // Guardar en las propiedades del script que el usuario ha activado la sincronización
      PropertiesService.getScriptProperties().setProperty(emailUsuario, 'activado');
    } 
  }
}


/** Esta función reestablece los disparadores a FALSE cuando se detecte que el documento es una copia. */
function resetearPropiedadesDisparadores() {
  var scriptProperties = PropertiesService.getScriptProperties();

  // Restablecer las propiedades de los disparadores a 'false'
  scriptProperties.setProperty('disparadorLimpiezaConfigurado', 'false');

  Logger.log("Las propiedades de los disparadores han sido restablecidas.");
}

// Esta función se autoejecuta ante ciertas acciones en la hoja de cálculo
function onEdit(e) {
  var hoja = e.source.getActiveSheet();
  var nombreHoja = hoja.getName();
  var filaEditada = e.range.getRow();
  var columnaEditada = e.range.getColumn();

  // Lógica para la hoja "👥 Mis Contactos"
  if (nombreHoja === "👥 Mis Contactos") {
    // Aquí se invoca la función contactosAactualizar si estás haciendo algo específico en esta hoja
    contactosAactualizar(e);
  }

  // Lógica específica para la hoja "⚙️ Configuración"
  if (nombreHoja === '⚙️ Configuración') {
    // Asegurarse de que estamos en la hoja correcta y que el cambio se hizo en B4
    if (filaEditada === 4 && columnaEditada === 2) {
      var valorB4 = hoja.getRange('B4').getValue();

      // Si B4 ahora tiene "Hoja PRINCIPAL" o está vacío, borramos el contenido de D4 y D7
      if (valorB4 === 'Hoja PRINCIPAL' || valorB4 === '') {
        hoja.getRange('D4').clearContent();
        hoja.getRange('D7').clearContent();
        var ultimaFila = hoja.getLastRow();
        // Suponiendo que quieres establecer FALSO desde H11 hasta el final de la hoja donde haya datos
        var ultimaFila = hoja.getLastRow();
        if (ultimaFila >= 11) { // Verificar si hay al menos una fila para actualizar
          hoja.getRange('H11:H' + ultimaFila).setValue(false); // Establecer FALSO en todas las celdas de H11 hasta H última fila
        }
      }
    }
    // Si se edita D4, limpia D7
    if (filaEditada === 4 && columnaEditada === 4) {
      hoja.getRange('D7').clearContent();
    }

    // Si D4 está vacío, impide añadir contenido en D7
    var contenidoD4 = hoja.getRange('D4').getValue();
    if (contenidoD4 === '<< Correo electrónico del grupo del profesorado >>' && filaEditada === 7 && columnaEditada === 4) {
      e.range.clearContent();
      SpreadsheetApp.getUi().alert('No puedes añadir una URL hasta que hayas incluido un correo de grupo.');
    }
  }



}

function esMiembroDelGrupo(emailUsuario) {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('⚙️ Configuración');
  var correo = hoja.getRange('D4').getValue();

  // Ignorar el correo si contiene el texto específico y tratar como si no hubiese correo
  if (correo === "<< Correo electrónico del grupo del profesorado >>") {
    return false; // O ajusta esta parte según lo que necesites hacer en este caso
  }

  try {
    var grupo = GroupsApp.getGroupByEmail(correo);
    var miembros = grupo.getUsers();
    for (var i = 0; i < miembros.length; i++) {
      if (miembros[i].getEmail() === emailUsuario) {
        return true;
      }
    }
  } catch (e) {
    Logger.log('Error al verificar la pertenencia al grupo: ' + e.message + ' (Grupo: ' + correo + ')');
    return false;
  }
  return false;
}

function checkUrl() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName('⚙️ Configuración');
  var cell = sheet.getRange('D7');
  var cellUrl = cell.getValue();
  var sheetUrl = spreadsheet.getUrl();

  // Extrae el ID de la hoja de cálculo de cellUrl
  var cellId = cellUrl.match(/\/d\/(.+?)\//)[1];
  Logger.log('cellId: ' + cellId);

  // Extrae el ID de la hoja de cálculo de sheetUrl
  var sheetId = sheetUrl.match(/\/d\/(.+?)\//)[1];
  Logger.log('sheetId: ' + sheetId);

  if (cellId == sheetId) {
    var ui = SpreadsheetApp.getUi();
    ui.alert('La URL introducida es la misma que la URL de esta hoja de cálculo. Debes poner la URL de la hoja original donde están los contactos del profesorado del centro para sincronizar.');
    cell.clearContent();
  }
}

function abrirConfiguracion() {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("⚙️ Configuración");
  SpreadsheetApp.setActiveSheet(hoja);
}

function abrirDatos() {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("⬆️ Datos");
  SpreadsheetApp.setActiveSheet(hoja);
}

function abrirMisContactos() {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("👥 Mis Contactos");
  SpreadsheetApp.setActiveSheet(hoja);
}

function acercaDe() {

  const panel = HtmlService.createTemplateFromFile('Acerca de');
  panel.version = PARAMS.version;
  panel.appName = PARAMS.nombreApp;
  SpreadsheetApp.getUi().showModalDialog(panel.evaluate().setWidth(470).setHeight(440), `${PARAMS.icono} ¿Qué es ${PARAMS.nombreApp}?`);

}