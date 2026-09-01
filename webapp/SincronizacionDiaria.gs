/**
 * SincronizacionDiaria.gs — Disparadores por usuario para la sincronización
 * desatendida cada 24 h. Cada usuario que activa el diario crea SU propio
 * disparador (que se ejecuta a su nombre), igual que en el proyecto de hoja.
 */

const CLAVE_OPCIONES_DIARIA_ = 'opcionesSincronizacionDiaria';

/** ¿Tiene el usuario actual la sincronización diaria activada? */
function tieneSincronizacionDiaria() {
  return ScriptApp.getProjectTriggers()
    .some(t => t.getHandlerFunction() === 'ejecutarSincronizacionDiaria');
}

/**
 * Activa el diario para el usuario actual con las opciones dadas
 * (mismo objeto que sincronizar()).
 */
function activarSincronizacionDiaria(opciones) {
  const correoGrupo = correoGrupoProfesorado_();
  if (opciones && opciones.incluirCentro && correoGrupo &&
      !esMiembroDelGrupo_(correoUsuarioActual_(), correoGrupo)) {
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
}

/**
 * Función que dispara el trigger. Comprueba pertenencia al grupo; si el usuario
 * ya no pertenece, avisa por correo y se desactiva (como en el proyecto de hoja).
 */
function ejecutarSincronizacionDiaria() {
  try {
    const raw = PropertiesService.getUserProperties().getProperty(CLAVE_OPCIONES_DIARIA_);
    const opciones = raw ? JSON.parse(raw) : { incluirCentro: true, incluirPropios: true };

    const correoGrupo = correoGrupoProfesorado_();
    if (opciones.incluirCentro && correoGrupo &&
        !esMiembroDelGrupo_(correoUsuarioActual_(), correoGrupo)) {
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
