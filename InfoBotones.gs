function obtenerMensajeSubirContactos() {
  var hojaSubirContactos = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Subir Contactos");
  var hojaDatos = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("⬆️ Datos");

  var correosSubirContactos = hojaSubirContactos.getRange("E2:E" + hojaSubirContactos.getLastRow()).getValues().flat();
  var correosDatos = hojaDatos.getRange("B3:B" + hojaDatos.getLastRow()).getValues().flat();

  correosSubirContactos = correosSubirContactos.filter(correo => correo !== "");
  correosDatos = correosDatos.filter(correo => correo !== "");

  var mensaje = "";

  if (correosSubirContactos.length > 0 && correosDatos.length === 0) {
    mensaje = "Tu administrador ya ha añadido algunos contactos. Aunque la pestaña\n | ⬆️ Datos | esté en blanco, dichos contactos se sincronizarán.";
  } else if (hayContactosNoSincronizados(correosSubirContactos, correosDatos)) {
    mensaje = "Tu administrador ha cargado algunos contactos del centro. Estos se sincronizarán junto a los que tú has añadido.";
  } else {
    mensaje = "Esta opción te permite subir contactos a tu cuenta de Google Contacts.\n" +
              "Asegúrate de que los datos estén correctamente formateados antes de proceder.";
  }

  return mensaje;
}

function obtenerMensajeSincronizacionDiaria() {
  var hojaSubirContactos = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Subir Contactos");
  var hojaDatos = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("⬆️ Datos");

  var correosSubirContactos = hojaSubirContactos.getRange("E2:E" + hojaSubirContactos.getLastRow()).getValues().flat();
  var correosDatos = hojaDatos.getRange("B3:B" + hojaDatos.getLastRow()).getValues().flat();

  correosSubirContactos = correosSubirContactos.filter(correo => correo !== "");
  correosDatos = correosDatos.filter(correo => correo !== "");

  var mensaje = "";

  if (correosSubirContactos.length > 0 && correosDatos.length === 0) {
    mensaje = "Tu administrador ya ha cargado algunos contactos de tu centro. Aunque la pestaña\n | ⬆️ Datos | esté en blanco, esos contactos se sincronizarán diariamente.";
  }
  // Comprobar si hay correos en "Subir Contactos" que no están en "⬆️ Datos"
  else if (hayContactosNoSincronizados(correosSubirContactos, correosDatos)) {
    mensaje = "Este botón te permite SINCRONIZAR DIARIAMENTE tus contactos con tu cuenta de Google Contacts.\n" +
              "Asegúrate de que los datos estén correctamente formateados antes de subirlos.\n\n" +
              "IMPORTANTE: Ten en cuenta que tu administrador ha cargado algunos contactos del centro. Estos se sincronizarán diariamente junto a los que ya has añadido.";
  } else {
    mensaje = "Esta opción te permite subir contactos a tu cuenta de Google Contacts.\n" +
              "Asegúrate de que los datos estén correctamente formateados antes de subirlos.";
  }

  return mensaje;
}

// Función auxiliar para comprobar si hay correos en "Subir Contactos" que no estén en "⬆️ Datos"
function hayContactosNoSincronizados(correosSubirContactos, correosDatos) {
  for (var i = 0; i < correosSubirContactos.length; i++) {
    var correo = correosSubirContactos[i];
    if (!correosDatos.includes(correo)) {
      return true;  // Si hay un correo en "Subir Contactos" que no está en "⬆️ Datos"
    }
  }
  return false;  // Si todos los correos están ya en "⬆️ Datos"
}
