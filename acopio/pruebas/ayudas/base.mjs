// =====================================================================
//  Una base de datos de verdad, de usar y tirar.
//
//  Las monedas se calculan con SQL. Comprobarlas leyendo el archivo solo
//  diría que el texto está escrito, no que las cuentas salgan, así que
//  hace falta un PostgreSQL de verdad.
//
//  Cada corrida se crea SU PROPIA base, carga el esquema entero y mete
//  sus datos. Nada de apoyarse en una base que alguien dejó preparada:
//  una prueba que da por hecho un estado que no crea ella misma pasa sin
//  comprobar nada el día que ese estado no está, que es peor que no
//  tenerla.
// =====================================================================
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Dónde está el servidor. En GitHub llega por variable de entorno; en un
// portátil, por el socket de siempre. Si no hay ninguno, no se enchufa.
const CANDIDATOS = [
  process.env.ACOPIO_PG,
  'postgresql://postgres@localhost:54329/postgres',
  'postgresql://postgres@localhost:5432/postgres'
].filter(Boolean);

const correr = (uri, args, tragarError = false) => execFileSync('psql',
  [uri, '-v', 'ON_ERROR_STOP=1', '-tAq', ...args],
  { encoding: 'utf8', stdio: tragarError ? ['ignore', 'pipe', 'ignore'] : ['ignore', 'pipe', 'pipe'] });

export function servidorVivo() {
  for (const uri of CANDIDATOS) {
    try { correr(uri, ['-c', 'select 1'], true); return uri; } catch { /* el siguiente */ }
  }
  return null;
}

// Crea una base limpia con el esquema cargado. Devuelve cómo hablarle y
// cómo tirarla.
export function baseNueva(nombre = `acopio_prueba_${process.pid}`) {
  const raiz = servidorVivo();
  if (!raiz) return null;

  correr(raiz, ['-c', `drop database if exists ${nombre}`], true);
  correr(raiz, ['-c', `create database ${nombre}`]);
  const uri = raiz.replace(/\/[^/]*$/, `/${nombre}`);

  const f = (p) => fileURLToPath(new URL(p, import.meta.url));
  correr(uri, ['-f', f('./supabase-falso.sql')]);
  correr(uri, ['-f', f('../../sql/schema.sql')]);

  return {
    uri,
    // Una consulta que devuelve texto plano, para comparar.
    sql: (q) => correr(uri, ['-c', q]).trim(),
    // Para lo que DEBE fallar: interesa que reviente, no lo que diga.
    rechaza(q) {
      try { correr(uri, ['-c', q], true); return false; } catch { return true; }
    },
    // La ruta se lee desde `pruebas/`, que es donde vive quien llama:
    // resolverla desde aquí obligaría a escribirla al revés.
    cargar: (ruta) => correr(uri, ['-f', fileURLToPath(new URL(ruta, new URL('../', import.meta.url)))]),
    tirar() { correr(raiz, ['-c', `drop database if exists ${nombre}`], true); }
  };
}
