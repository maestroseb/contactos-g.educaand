/**
 * WebApp.gs — Punto de entrada de la web app y API para el cliente.
 *
 * Estados:
 *  - Sin configurar + eres el admin  -> asistente de configuración.
 *  - Sin configurar + no eres admin  -> página de "en preparación".
 *  - Configurado + admin             -> panel de administración.
 *  - Configurado + miembro claustro  -> vista de profesorado.
 *  - Configurado + ajeno             -> acceso denegado.
 */

function doGet(e) {
  const email = correoUsuarioActual_();
  fijarAdminSiVacio_(email);           // el primer usuario que entra queda como admin
  const esAdmin = esAdmin_(email);

  if (!estaConfigurado_()) {
    if (esAdmin) return paginaApp_(email, esAdmin);       // mostrará el asistente
    return paginaDenegado_(email, 'La aplicación de este centro todavía se está configurando. Vuelve a intentarlo más tarde.');
  }

  if (!esAdmin && !esMiembroClaustro_(email)) {
    return paginaDenegado_(email, null);
  }
  return paginaApp_(email, esAdmin);
}

function paginaApp_(email, esAdmin) {
  const t = HtmlService.createTemplateFromFile('Index');
  t.esAdmin = esAdmin;
  return t.evaluate()
    .setTitle(PARAMS.icono + ' ' + PARAMS.nombreApp)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function paginaDenegado_(email, motivo) {
  const t = HtmlService.createTemplateFromFile('AccesoDenegado');
  t.email = email;
  t.nombreCentro = nombreCentro_();
  t.nombreApp = PARAMS.nombreApp;
  t.motivo = motivo || '';
  return t.evaluate()
    .setTitle(PARAMS.icono + ' ' + PARAMS.nombreApp)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Permite incluir un archivo HTML dentro de otro. */
function include(nombre) {
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}

/* ===================================================================== *
 *  API llamada desde el cliente con google.script.run                   *
 * ===================================================================== */

/** Estado inicial para pintar la interfaz. */
function getEstadoInicial() {
  const email = correoUsuarioActual_();
  return {
    email: email,
    esAdmin: esAdmin_(email),
    configurado: estaConfigurado_(),
    nombreApp: PARAMS.nombreApp,
    icono: PARAMS.icono,
    version: PARAMS.version,
    nombreCentro: nombreCentro_(),
    gruposCentro: gruposDelCentro_(),
    contactosPropios: leerContactosPropios_(),
    diariaActiva: tieneSincronizacionDiaria()
  };
}

/* ----------------------------- Asistente ----------------------------- */

/** Datos para el asistente de configuración. */
function getEstadoConfig() {
  exigirAdmin_();
  return {
    adminEmail: getAdminEmail_(),
    defaults: DEFAULTS,
    config: getConfig_() || {},
    numContactos: leerContactosCentroStore_().length
  };
}

/** Verifica un código de centro contra el catálogo. */
function verificarCentro(codigo) {
  const nombre = nombreDeCentroPorCodigo_(codigo);
  return { ok: !!nombre, nombre: nombre };
}

/** Guarda la configuración del centro (marca el asistente como completado). */
function guardarConfiguracion(cfg) {
  exigirAdmin_();
  cfg = cfg || {};
  const actual = getConfig_() || {};
  const nuevo = {
    codigoCentro: cfg.codigoCentro || actual.codigoCentro || '',
    nombreCentro: cfg.nombreCentro || actual.nombreCentro || '',
    especialidades: cfg.especialidades || actual.especialidades || DEFAULTS.especialidades,
    etiquetas: cfg.etiquetas || actual.etiquetas || DEFAULTS.etiquetas,
    usarGrupo: cfg.usarGrupo !== undefined ? cfg.usarGrupo : (actual.usarGrupo !== false),
    grupoProfesorado: cfg.grupoProfesorado !== undefined ? cfg.grupoProfesorado : (actual.grupoProfesorado || ''),
    usarLista: cfg.usarLista !== undefined ? cfg.usarLista : (actual.usarLista !== false),
    miembrosExtra: cfg.miembrosExtra || actual.miembrosExtra || [],
    completo: true
  };
  setConfig_(nuevo);
  return nuevo;
}

/* ------------------------- Contactos del centro (admin) ------------------------- */

/** Lee la lista de contactos del centro (para el panel admin). */
function adminLeerContactos() {
  exigirAdmin_();
  return leerContactosCentroStore_();
}

/** Guarda la lista de contactos del centro. */
function adminGuardarContactos(lista) {
  exigirAdmin_();
  return guardarContactosCentroStore_(lista || []);
}

/** Parsea texto pegado (Séneca) y lo devuelve como contactos (sin guardar). */
function adminImportarPegado(texto) {
  exigirAdmin_();
  return parsearClaustroPegado_(texto);
}

/* ------------------------- Acciones del profesorado ------------------------- */

function sincronizarAhora(opciones) { return sincronizar(opciones); }

function guardarPropios(lista) {
  guardarContactosPropios_(lista || []);
  return leerContactosPropios_();
}

/* ------------------------------- Utilidad ------------------------------- */

function exigirAdmin_() {
  if (!esAdmin_(correoUsuarioActual_())) throw new Error('NO_AUTORIZADO');
}
