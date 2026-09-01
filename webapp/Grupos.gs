/**
 * Grupos.gs — Comprobación de pertenencia al grupo del profesorado.
 * Portado de esMiembroDelGrupo() del proyecto de hoja.
 */

/**
 * ¿Pertenece el usuario al grupo de Google indicado?
 * @param {string} emailUsuario
 * @param {string} correoGrupo  correo del grupo (Google Groups)
 */
function esMiembroDelGrupo_(emailUsuario, correoGrupo) {
  if (!correoGrupo) return true; // sin grupo configurado => no se restringe
  try {
    const grupo = GroupsApp.getGroupByEmail(correoGrupo);
    return grupo.hasUser(emailUsuario);
  } catch (e) {
    Logger.log('Error comprobando el grupo ' + correoGrupo + ': ' + e.message);
    return false;
  }
}
