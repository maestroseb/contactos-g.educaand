/**
 * Config.gs — Configuración central del Asistente de Contactos (Web App v4)
 *
 * Este es el ÚNICO sitio donde tocar valores al desplegar. El resto del
 * proyecto lee de aquí. Sustituye los valores marcados con << ... >>.
 */

const PARAMS = {
  version: 'Versión: 4.0 (Web App)',
  nombreApp: 'Asistente de Contactos',
  icono: '👥',

  /**
   * ID de la HOJA CENTRAL (la "hoja madre" del administrador).
   * Es la parte larga de la URL entre /d/ y /edit.
   * La app la abre en solo lectura para el profesorado (equivale al IMPORTRANGE).
   */
  idHojaCentral: '<< PEGA_AQUI_EL_ID_DE_LA_HOJA_CENTRAL >>',

  /**
   * Correos de las personas ADMINISTRADORAS (verán el panel completo).
   * Todo lo demás verá la vista de profesorado.
   */
  admins: [
    '<< correo-admin-1@g.educaand.es >>'
  ],

  /** Nombres exactos de las pestañas dentro de la hoja central. */
  hojas: {
    datos: '⬆️ Datos',
    subirContactos: 'Subir Contactos',
    configuracion: '⚙️ Configuración'
  },

  /** Celdas de la pestaña ⚙️ Configuración (se mantienen las de la hoja actual). */
  config: {
    correoGrupoProfesorado: 'D4',   // correo del grupo del profesorado
    nombreCentro: 'F4',             // nombre del centro
    placeholderCorreo: '<< Correo electrónico del grupo del profesorado >>'
  },

  /** Sincronización diaria desatendida (disparador por usuario). */
  sincronizacionDiaria: {
    hora: 0,        // hora aproximada (0-23)
    cadaNumDias: 1  // cada cuántos días
  }
};

/** Devuelve true si el correo dado es administrador. */
function esAdministrador_(email) {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return PARAMS.admins.map(a => String(a).trim().toLowerCase()).indexOf(e) !== -1;
}

/** Correo del usuario que está usando la app en este momento. */
function correoUsuarioActual_() {
  return Session.getActiveUser().getEmail();
}
