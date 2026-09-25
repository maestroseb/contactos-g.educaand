/**
 * Grupos.gs — Pertenencia al claustro.
 *
 * La pertenencia se decide por la LISTA del claustro que administra el admin.
 * Se mantiene la compatibilidad con configuraciones antiguas que usaban además
 * un GRUPO de Google del profesorado (basta con estar en uno de los dos).
 */

/** ¿Pertenece el usuario al grupo de Google indicado? (solo configuraciones
 *  antiguas que usaban un grupo). Resultado cacheado 10 min por usuario; si la
 *  consulta falla se anota en MEMO_.errorGrupo para no confundirlo con una baja. */
function esMiembroDelGrupo_(emailUsuario, correoGrupo) {
  if (!correoGrupo) return false;
  let cache = null;
  try { cache = CacheService.getUserCache(); } catch (e) {}
  const clave = 'enGrupo_v1';
  if (cache) { const v = cache.get(clave); if (v !== null) return v === '1'; }
  try {
    const si = GroupsApp.getGroupByEmail(correoGrupo).hasUser(emailUsuario);
    if (cache) { try { cache.put(clave, si ? '1' : '0', 600); } catch (e) {} }
    return si;
  } catch (e) {
    MEMO_.errorGrupo = true;
    Logger.log('Error comprobando el grupo ' + correoGrupo + ': ' + e.message);
    return false;
  }
}

/**
 * Correos que forman el claustro según la LISTA administrada por el admin
 * (los contactos del centro guardados en el almacén). Memoria por ejecución.
 */
function emailsClaustro_() {
  if (MEMO_.emailsClaustro) return MEMO_.emailsClaustro;
  const set = {};
  leerContactosCentroStore_().forEach(c => {
    if (c && c.email) set[String(c.email).trim().toLowerCase()] = true;
  });
  return (MEMO_.emailsClaustro = set);
}

/**
 * ¿Pertenece el usuario al claustro? (lista administrada o, en configuraciones
 * antiguas, grupo de Google). Si no hay ninguna fuente, devuelve false (solo el
 * admin podrá entrar).
 */
function esMiembroClaustro_(email) {
  if (!email) return false;
  const cfg = getConfig_() || {};
  if (cfg.usarLista !== false && emailsClaustro_()[email.trim().toLowerCase()]) return true;
  return cfg.usarGrupo !== false && !!cfg.grupoProfesorado && esMiembroDelGrupo_(email, cfg.grupoProfesorado);
}
