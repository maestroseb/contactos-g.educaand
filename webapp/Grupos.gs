/**
 * Grupos.gs — Pertenencia al claustro.
 *
 * Se admiten DOS fuentes de pertenencia, combinables:
 *  - Un GRUPO de Google del profesorado (correo de grupo), y/o
 *  - una LISTA de correos que administra el admin desde la web.
 * Una persona pertenece al claustro si está en el grupo O en la lista.
 */

/** ¿Pertenece el usuario al grupo de Google indicado? */
function esMiembroDelGrupo_(emailUsuario, correoGrupo) {
  if (!correoGrupo) return false;
  try {
    return GroupsApp.getGroupByEmail(correoGrupo).hasUser(emailUsuario);
  } catch (e) {
    Logger.log('Error comprobando el grupo ' + correoGrupo + ': ' + e.message);
    return false;
  }
}

/**
 * Correos que forman el claustro según la LISTA administrada por el admin.
 * Se toman de los contactos del centro guardados en el almacén.
 */
function emailsClaustro_() {
  const set = {};
  leerContactosCentroStore_().forEach(c => {
    if (c.email) set[String(c.email).trim().toLowerCase()] = true;
  });
  const cfg = getConfig_();
  // Correos extra que el admin haya añadido explícitamente (sin ser contacto).
  if (cfg && cfg.miembrosExtra) {
    cfg.miembrosExtra.forEach(e => { if (e) set[String(e).trim().toLowerCase()] = true; });
  }
  return set;
}

/**
 * ¿Pertenece el usuario al claustro? (grupo de Google O lista administrada).
 * Si no hay ninguna de las dos fuentes configurada, devuelve false (solo el
 * admin podrá entrar).
 */
function esMiembroClaustro_(email) {
  if (!email) return false;
  const cfg = getConfig_() || {};
  const usarGrupo = cfg.usarGrupo !== false && !!cfg.grupoProfesorado;
  const usarLista = cfg.usarLista !== false;

  if (usarGrupo && esMiembroDelGrupo_(email, cfg.grupoProfesorado)) return true;
  if (usarLista) {
    const lista = emailsClaustro_();
    if (lista[email.trim().toLowerCase()]) return true;
  }
  return false;
}
