// =====================================================================
//  store.js importa supabase-js desde un CDN, que Node no puede resolver
//  ni queremos que resuelva: las pruebas no tocan la red. Aquí se hace
//  una copia del archivo REAL con esa única línea cambiada por el
//  servidor de mentira, y se carga esa copia.
//
//  Se prueba el archivo de verdad, no una versión paralela que se queda
//  vieja: cualquier cambio en web/js/store.js entra aquí solo.
// =====================================================================
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));

export async function cargarStore() {
  const origen = join(aqui, '..', '..', 'web', 'js', 'store.js');
  const codigo = (await readFile(origen, 'utf8'))
    .replace(/^import \{ createClient \}.*$/m,
      `import { createClient } from ${JSON.stringify(pathToFileURL(join(aqui, 'supabase.mjs')).href)};`)
    .replace(/^import \{ SUPABASE_URL.*$/m,
      "const SUPABASE_URL = 'https://prueba.local', SUPABASE_PUBLISHABLE_KEY = 'prueba';");

  const carpeta = join(tmpdir(), 'acopio-pruebas');
  await mkdir(carpeta, { recursive: true });
  // el nombre cambia en cada corrida para que Node no reuse la copia vieja
  const destino = join(carpeta, `store-${process.pid}-${Date.now()}.mjs`);
  await writeFile(destino, codigo);
  return import(pathToFileURL(destino).href);
}
