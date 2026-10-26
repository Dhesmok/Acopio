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

// Clave para la imagen satelital con la que el admin calibra el GPS desde
// la oficina (Fondo del mapa → GPS → Desde la oficina).
//
// Vacía, la app usa el servicio público de Esri: funciona ya, pero Esri lo
// ofrece para uso no comercial. Para la empresa: crear una cuenta gratuita
// en location.arcgis.com, generar una clave de API con el permiso de
// mapas base (basemaps), restringirla al dominio de la app (Netlify) y
// pegarla aquí. Como la clave publicable de Supabase, viaja dentro del
// JavaScript: lo que la protege es esa restricción de dominio. El nivel
// gratuito trae millones de cuadros de mapa al mes; calibrar un patio
// gasta unos cientos.
export const ESRI_CLAVE = '';
