/**
 * SincronizacionDiaria.gs — Disparadores por usuario para la sincronización
 * desatendida cada 24 h. Cada usuario que activa el diario crea SU propio
 * disparador (que se ejecuta a su nombre), igual que en el proyecto de hoja.
 */

const CLAVE_OPCIONES_DIARIA_ = 'opcionesSincronizacionDiaria';
const CACHE_DIARIA_ = 'diariaActiva_v1';

/** ¿Tiene el usuario actual la sincronización diaria activada? (con caché por usuario) */
function tieneSincronizacionDiaria() {
  let cache = null;
  try { cache = CacheService.getUserCache(); } catch (e) {}
  if (cache) {
    const v = cache.get(CACHE_DIARIA_);
    if (v !== null) return v === '1';
  }
  const activa = ScriptApp.getProjectTriggers()
    .some(t => t.getHandlerFunction() === 'ejecutarSincronizacionDiaria');
  if (cache) { try { cache.put(CACHE_DIARIA_, activa ? '1' : '0', 21600); } catch (e) {} }
  return activa;
}

/** Invalida la caché del estado del diario (tras activar/desactivar). */
function invalidarCacheDiaria_() {
  try { CacheService.getUserCache().remove(CACHE_DIARIA_); } catch (e) {}
}

/**
 * Activa el diario para el usuario actual con las opciones dadas
 * (mismo objeto que sincronizar()).
 */
function activarSincronizacionDiaria(opciones) {
  const email = correoUsuarioActual_();
  if (opciones && opciones.incluirCentro && !esAdmin_(email) && !esMiembroClaustro_(email)) {
    throw new Error('NO_MIEMBRO');
  }

  desactivarSincronizacionDiaria_();  // evita duplicar disparadores

  PropertiesService.getUserProperties()
    .setProperty(CLAVE_OPCIONES_DIARIA_, JSON.stringify(opciones || {}));

  ScriptApp.newTrigger('ejecutarSincronizacionDiaria')
    .timeBased()
    .everyDays(PARAMS.sincronizacionDiaria.cadaNumDias)
    .atHour(PARAMS.sincronizacionDiaria.hora)
    .create();

  invalidarCacheDiaria_();
  return true;
}

/** Desactiva el diario para el usuario actual. */
function desactivarSincronizacionDiaria() {
  desactivarSincronizacionDiaria_();
  return true;
}

function desactivarSincronizacionDiaria_() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'ejecutarSincronizacionDiaria') {
      ScriptApp.deleteTrigger(t);
    }
  });
  invalidarCacheDiaria_();
}

/**
 * Función que dispara el trigger. Comprueba pertenencia al grupo; si el usuario
 * ya no pertenece, avisa por correo y se desactiva (como en el proyecto de hoja).
 */
function ejecutarSincronizacionDiaria() {
  try {
    const raw = PropertiesService.getUserProperties().getProperty(CLAVE_OPCIONES_DIARIA_);
    const opciones = raw ? JSON.parse(raw) : { incluirCentro: true, incluirPropios: true };

    const email = correoUsuarioActual_();
    if (opciones.incluirCentro && !esAdmin_(email) && !esMiembroClaustro_(email)) {
      notificarBajaDelGrupo_();
      desactivarSincronizacionDiaria_();
      return;
    }
    sincronizar(opciones);
  } catch (e) {
    Logger.log('Error en ejecutarSincronizacionDiaria: ' + e.message);
  }
}

/** Envía el aviso de que se ha detenido la sincronización por salir del grupo. */
function notificarBajaDelGrupo_() {
  const email = correoUsuarioActual_();
  const centro = nombreCentro_();
  const html =
    '<p>¡Hola!</p>' +
    '<p>Hemos detectado que ya no formas parte del grupo del profesorado del <strong>' +
    centro + '</strong>, por lo que hemos detenido la sincronización automática de contactos.</p>' +
    '<p>Si crees que es un error o has cambiado de centro, ponte en contacto con tu administrador.</p>' +
    '<p>Gracias por usar <strong>' + PARAMS.nombreApp + '</strong>.</p>';
  MailApp.sendEmail({
    to: email,
    subject: 'Sincronización de contactos desactivada',
    htmlBody: html
  });
}
