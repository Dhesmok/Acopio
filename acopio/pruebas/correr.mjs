// Corre las siete tandas, cada una en su propio proceso: comparten
// globales (indexedDB, el reloj) y mezclarlas daría resultados falsos.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const tandas = ['cola.mjs', 'pilas-y-fechas.mjs', 'mapa.mjs', 'sincronizacion.mjs', 'informe.mjs', 'historia.mjs', 'tareas.mjs'];

let mal = 0;
for (const t of tandas) {
  console.log(`\n${'='.repeat(60)}\n  ${t}\n${'='.repeat(60)}`);
  const r = spawnSync(process.execPath, [join(aqui, t)],
    { stdio: 'inherit', env: { ...process.env, TZ: process.env.TZ || 'America/Bogota' } });
  if (r.status !== 0) mal++;
}

console.log(mal ? `\n✗ ${mal} de ${tandas.length} tandas fallaron\n`
                : `\n✓ las ${tandas.length} tandas pasaron\n`);
process.exit(mal ? 1 : 0);
