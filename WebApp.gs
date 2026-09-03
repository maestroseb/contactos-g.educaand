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
  const out = t.evaluate()
    .setTitle(PARAMS.nombreApp)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  ponerFavicon_(out);
  return out;
}

function paginaDenegado_(email, motivo) {
  const t = HtmlService.createTemplateFromFile('AccesoDenegado');
  t.email = email;
  t.nombreCentro = nombreCentro_();
  t.nombreApp = PARAMS.nombreApp;
  t.motivo = motivo || '';
  const out = t.evaluate()
    .setTitle(PARAMS.nombreApp)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
  ponerFavicon_(out);
  return out;
}

/** Aplica el favicon sin romper la carga si la plataforma rechaza el data URI. */
function ponerFavicon_(out) {
  try { out.setFaviconUrl(FAVICON_URL); } catch (e) { /* se queda el favicon por defecto */ }
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
  const cfg = getConfig_() || {};   // una sola lectura (cacheada)
  const perfil = perfilUsuarioActual_(email);
  return {
    email: email,
    nombreUsuario: perfil.nombre,
    fotoUsuario: perfil.foto,
    esAdmin: esAdmin_(email),
    configurado: !!cfg.completo,
    nombreApp: PARAMS.nombreApp,
    icono: PARAMS.icono,
    version: PARAMS.version,
    nombreCentro: (cfg.nombreCentro ? String(cfg.nombreCentro).trim() : ''),
    gruposCentro: gruposDelCentro_(),
    contactosPropios: leerContactosPropios_(),
    diariaActiva: tieneSincronizacionDiaria(),
    etiquetasSugeridas: etiquetasSugeridasDe_(cfg.etiquetas),
    etiquetasCats: cfg.etiquetas || {}
  };
}

/** Etiquetas sugeridas (unión de las categorías configuradas) para autocompletar. */
function etiquetasSugeridasDe_(e) {
  let lista = [];
  if (Array.isArray(e)) lista = e;
  else if (e && typeof e === 'object') Object.keys(e).forEach(k => { lista = lista.concat(e[k] || []); });
  const set = {};
  lista.forEach(t => { if (t) set[String(t).trim()] = true; });
  return Object.keys(set);
}

/* ----------------------------- Asistente ----------------------------- */

/** Datos para el asistente de configuración. */
function getEstadoConfig() {
  exigirAdmin_();
  const claustro = leerContactosCentroStore_()
    .filter(c => c && c.email)
    .map(c => ({ nombre: c.nombre || '', apellidos: c.apellidos || '', email: String(c.email).trim() }));
  return {
    adminEmail: getAdminEmail_(),
    adminsExtra: getAdminsExtra_(),
    yo: correoUsuarioActual_(),
    defaults: DEFAULTS,
    config: getConfig_() || {},
    numContactos: claustro.length,
    claustro: claustro
  };
}

/** Guarda la lista de administradores adicionales (solo un admin puede). */
function guardarAdmins(lista) {
  exigirAdmin_();
  const guardados = setAdminsExtra_(lista);
  return { owner: getAdminEmail_(), extra: guardados };
}

/** Traspasa el rol de principal (solo el principal actual puede hacerlo). */
function hacerPrincipal(email) {
  exigirAdminPrincipal_();
  traspasarAdminPrincipal_(email);
  return { owner: getAdminEmail_(), extra: getAdminsExtra_() };
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
    // Acceso: por defecto, quien esté en la lista de contactos del claustro.
    usarLista: true,
    // Se mantiene el grupo de Google si alguna versión anterior lo configuró.
    usarGrupo: !!actual.grupoProfesorado,
    grupoProfesorado: actual.grupoProfesorado || '',
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

/** Igual que adminImportarPegado pero para los contactos propios (cualquier usuario). */
function parsearPegado(texto) {
  return parsearClaustroPegado_(texto);
}

/* ------------------------- Acciones del profesorado ------------------------- */

function sincronizarAhora(opciones) { return sincronizar(opciones); }

function guardarPropios(lista) {
  guardarContactosPropios_(lista || []);
  return leerContactosPropios_();
}

/* ------------------------------ Perfil ------------------------------ */

/**
 * Perfil visible del usuario actual: { nombre, foto }. Best-effort.
 *   - Lee el propio perfil de Google (People API) para el nombre y la foto.
 *   - Si no hay foto real (o falta permiso de perfil), la foto queda vacía y la
 *     interfaz usa el avatar con la inicial.
 *   - Si no se obtiene el nombre, se recurre al que figure en el claustro.
 * Nunca lanza: ante cualquier fallo devuelve lo que tenga (posiblemente vacío)
 * y la interfaz cae en el correo. El resultado se cachea por usuario.
 */
function perfilUsuarioActual_(email) {
  const cache = (function () { try { return CacheService.getUserCache(); } catch (e) { return null; } })();
  if (cache) {
    const c = cache.get('perfil_v1');
    if (c) { try { return JSON.parse(c); } catch (e) { /* cae y recalcula */ } }
  }

  const perfil = { nombre: '', foto: '' };
  try {
    const me = People.People.get('people/me', { personFields: 'names,photos' });
    if (me && me.names && me.names.length) {
      const n = me.names.filter(x => x.metadata && x.metadata.primary)[0] || me.names[0];
      perfil.nombre = String(n.displayName || '').trim();
    }
    if (me && me.photos && me.photos.length) {
      const p = me.photos.filter(x => x.metadata && x.metadata.primary)[0] || me.photos[0];
      // `default:true` = foto genérica de Google (letra); en ese caso usamos la inicial.
      if (p && p.url && !p.default) perfil.foto = String(p.url).trim();
    }
  } catch (e) { /* sin permiso de perfil o API no disponible: seguimos con lo que haya */ }

  if (!perfil.nombre) perfil.nombre = nombreEnClaustro_(email);

  if (cache) { try { cache.put('perfil_v1', JSON.stringify(perfil), 21600); } catch (e) {} }
  return perfil;
}

/** Nombre completo (nombre + apellidos) del correo dado según el claustro, o ''. */
function nombreEnClaustro_(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return '';
  const c = leerContactosCentroStore_().filter(function (x) {
    return x && x.email && String(x.email).trim().toLowerCase() === e;
  })[0];
  if (!c) return '';
  return [c.nombre, c.apellidos].filter(Boolean).join(' ').trim();
}

/* ------------------------------- Utilidad ------------------------------- */

function exigirAdmin_() {
  if (!esAdmin_(correoUsuarioActual_())) throw new Error('NO_AUTORIZADO');
}

function exigirAdminPrincipal_() {
  if (!esAdminPrincipal_(correoUsuarioActual_())) throw new Error('NO_PRINCIPAL');
}
