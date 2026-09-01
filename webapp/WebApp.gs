/**
 * WebApp.gs — Punto de entrada de la aplicación web y API para el cliente.
 * Sustituye a onOpen()/menús del proyecto de hoja por doGet() + HTML.
 */

/**
 * Servido al abrir la URL de la web app.
 *
 * PORTERO: aunque la app es accesible por todo el dominio g.educaand.es (todo
 * el profesorado andaluz), aquí se comprueba la pertenencia al GRUPO del
 * profesorado del centro (el que administra el admin). Quien no pertenezca a
 * este claustro NO entra — igual que en la hoja madre/hija.
 */
function doGet(e) {
  const email = correoUsuarioActual_();
  const esAdmin = esAdministrador_(email);
  const correoGrupo = correoGrupoProfesorado_();
  // esMiembroDelGrupo_ devuelve true si no hay grupo configurado (sin restricción).
  const esMiembro = esMiembroDelGrupo_(email, correoGrupo);

  // Sin acceso: no es admin y no pertenece al claustro -> puerta cerrada.
  if (!esAdmin && !esMiembro) {
    const denegado = HtmlService.createTemplateFromFile('AccesoDenegado');
    denegado.email = email;
    denegado.nombreCentro = nombreCentro_();
    denegado.nombreApp = PARAMS.nombreApp;
    return denegado.evaluate()
      .setTitle(PARAMS.icono + ' ' + PARAMS.nombreApp)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

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
    hayGrupoProfesorado: !!correoGrupoProfesorado_(),
    numColDatos: PARAMS.datosLayout.numColumnas
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
 * Lee la lista central (⬆️ Datos) para editarla en el panel admin.
 * @return {Object} { cabeceras: string[], filas: any[][] }
 */
function adminLeerDatos() {
  if (!esAdministrador_(correoUsuarioActual_())) throw new Error('NO_AUTORIZADO');
  return {
    cabeceras: PARAMS.datosLayout.cabeceras,
    filas: leerFilasDatos_()
  };
}

/**
 * Guarda la lista central editada. `filas` es una matriz (una fila por
 * contacto, columnas según datosLayout). Devuelve el nº de filas guardadas.
 */
function adminGuardarDatos(filas) {
  if (!esAdministrador_(correoUsuarioActual_())) throw new Error('NO_AUTORIZADO');
  return escribirFilasDatos_(filas);
}
