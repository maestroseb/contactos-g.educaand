/**
 * WebApp.gs — Punto de entrada de la aplicación web y API para el cliente.
 * Sustituye a onOpen()/menús del proyecto de hoja por doGet() + HTML.
 */

/** Servido al abrir la URL de la web app. */
function doGet(e) {
  const email = correoUsuarioActual_();
  const esAdmin = esAdministrador_(email);

  const plantilla = HtmlService.createTemplateFromFile('Index');
  plantilla.esAdmin = esAdmin;
  plantilla.vista = esAdmin ? 'Admin' : 'Usuario';

  return plantilla.evaluate()
    .setTitle(PARAMS.icono + ' ' + PARAMS.nombreApp)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Permite incluir un archivo HTML dentro de otro (<?!= include('...') ?>). */
function include(nombre) {
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}

/* ===================================================================== *
 *  API llamada desde el cliente con google.script.run                   *
 * ===================================================================== */

/** Estado inicial que pinta la interfaz al cargar. */
function getEstadoInicial() {
  const email = correoUsuarioActual_();
  return {
    email: email,
    esAdmin: esAdministrador_(email),
    nombreApp: PARAMS.nombreApp,
    icono: PARAMS.icono,
    version: PARAMS.version,
    nombreCentro: nombreCentro_(),
    gruposCentro: gruposDelCentro_(),
    contactosPropios: leerContactosPropios_(),
    diariaActiva: tieneSincronizacionDiaria(),
    hayGrupoProfesorado: !!correoGrupoProfesorado_()
  };
}

/** Sincroniza ahora con las opciones elegidas en la interfaz. */
function sincronizarAhora(opciones) {
  return sincronizar(opciones);
}

/** Guarda la lista de contactos propios del usuario (desde el formulario). */
function guardarPropios(lista) {
  guardarContactosPropios_(lista || []);
  return leerContactosPropios_();
}

/* ------------------------- Endpoints de admin ------------------------ */

/**
 * Lee la pestaña "⬆️ Datos" de la hoja central para editarla en el panel admin.
 * Devuelve una matriz de filas (tal cual).
 */
function adminLeerDatos() {
  if (!esAdministrador_(correoUsuarioActual_())) throw new Error('NO_AUTORIZADO');
  const hoja = abrirHojaCentral_().getSheetByName(PARAMS.hojas.datos);
  return hoja.getDataRange().getValues();
}

/**
 * Guarda cambios en la pestaña "⬆️ Datos" de la hoja central.
 * TODO(Fase 4): validar y escribir el rango editado desde el panel admin.
 */
function adminGuardarDatos(filas) {
  if (!esAdministrador_(correoUsuarioActual_())) throw new Error('NO_AUTORIZADO');
  // Implementación en la Fase 4.
  return true;
}
