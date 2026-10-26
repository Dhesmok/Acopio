// Credenciales públicas del proyecto Supabase.
// Settings → Claves API → "Clave publicable".
// OJO: la URL va SIN /rest/v1/ al final.
// Está pensada para vivir en el navegador: quien protege los datos es la
// política RLS del esquema, no el secreto de esta clave.
// NUNCA usar aquí la clave secreta (sb_secret_...).
export const SUPABASE_URL = 'https://wgsqcjvwlgzgxkmvqfet.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_C_hPz_sKn7Fa5IR-mH12Bw_T0_e10I2';

// Dominio que se le agrega al usuario para armar el correo interno.
// Los contratistas escriben solo "wilson"; la app entra como
// "wilson@construnus.com". DEBE coincidir con el dominio con el que
// creaste los usuarios en Supabase → Authentication → Users.
export const DOMINIO_USUARIOS = 'construnus.com';

// Días que se proponen por defecto al fijar una fecha de recogida.
// Es solo la sugerencia inicial del calendario: siempre se puede cambiar.
export const DIAS_RECOGIDA_SUGERIDOS = 3;

// Proveedor que aparece elegido al abrir "Nuevo lote". Es la abreviatura
// tal como está en la tabla proveedores. Se pone el más frecuente para
// ahorrar un toque en la mayoría de los registros; si no existe, la app
// usa el primero de la lista.
export const PROVEEDOR_POR_DEFECTO = 'PG';

// Clave de Esri para la foto satelital de respaldo en la ventana de
// calibrar el GPS (la principal es la de Google, que no pide nada). Vacía
// funciona igual, con el servicio público de Esri. Solo haría falta si
// algún día se usa para algo comercial: se saca gratis en
// location.arcgis.com, con permiso de mapas base (basemaps) y restringida
// al dominio de la app.
export const ESRI_CLAVE = '';
