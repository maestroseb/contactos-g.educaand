/**
 * Config.gs — Parámetros estáticos y valores por defecto.
 *
 * En el modelo "copia por centro" NO hay ID de hoja ni admins fijados aquí:
 * el administrador se detecta solo en el primer despliegue y toda la
 * configuración del centro se guarda en el almacén interno del proyecto
 * (ver Estado.gs). Este archivo solo tiene constantes y valores por defecto.
 */

const PARAMS = {
  version: 'Versión: 4.0 (Web App)',
  nombreApp: 'Asistente de Contactos',
  icono: '👥',

  /** Sincronización diaria desatendida (disparador por usuario). */
  sincronizacionDiaria: {
    hora: 0,        // hora aproximada (0-23)
    cadaNumDias: 1  // cada cuántos días
  }
};

/**
 * Valores por defecto que el asistente ofrece al configurar (editables).
 * Se guardan en el almacén al completar la configuración.
 */
const DEFAULTS = {
  especialidades: [
    'Infantil', 'Primaria', 'Inglés', 'Francés', 'Educación Física', 'Música',
    'Pedagogía Terapéutica', 'Audición y Lenguaje', 'Religión', 'Matemáticas',
    'Lengua Castellana', 'Geografía e Historia', 'Biología y Geología',
    'Física y Química', 'Tecnología', 'Dibujo', 'Filosofía', 'Orientación'
  ],
  etiquetas: [
    'Claustro', 'Equipo Directivo', 'PAS', 'Tutores',
    'Dirección', 'Jefatura de Estudios', 'Secretaría', 'Coordinación'
  ]
};

/** Correo del usuario que está usando la app en este momento. */
function correoUsuarioActual_() {
  // Bajo "ejecutar como usuario que accede", el usuario efectivo coincide con
  // el que accede y devuelve el correo de forma fiable (getActiveUser a veces
  // viene vacío en la web app).
  var e = '';
  try { e = Session.getActiveUser().getEmail(); } catch (err) {}
  if (!e) { try { e = Session.getEffectiveUser().getEmail(); } catch (err) {} }
  return e || '';
}
