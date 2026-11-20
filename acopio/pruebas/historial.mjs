// =====================================================================
//  El historial de un lote dice lo que pasó, una vez y con palabras.
//  - La recepción provisional del celular no se queda junto a la del
//    servidor ("Recibido en acopio" salía dos veces).
//  - Una corrección de movimiento que el servidor rechaza no deja el
//    evento sin lote, sin tipo y sin fecha.
//  - Los traslados y las entregas al laboratorio tienen su frase.
// =====================================================================
import { readFile } from 'node:fs/promises';
import { instalar } from './ayudas/idb.mjs';
import { ok, titulo, cerrar } from './ayudas/decir.mjs';

const tiendas = instalar();
const { servidor } = await import('./ayudas/supabase.mjs');
const { cargarStore } = await import('./ayudas/cargar.mjs');
const Store = await cargarStore();
await Store.iniciar();

// ---------------------------------------------------------------------
titulo('Un lote creado aquí tiene UNA recepción en su historial, no dos.');

const lote = await Store.crearLote({ codigo: 'ABG1', proveedor_id: 'p1', placa: 'ABC123',
  material: 'granel', forma: 'elipse', x: 10, y: 10, usuario_id: 'yo' });
ok((await Store.historial(lote.id)).filter((e) => e.tipo === 'recepcion').length === 1,
   'sin señal todavía, se ve la provisional');

await Store.sincronizar();
// lo que hace fn_evento_recepcion en la base: su propia recepción, otro id
servidor.tablas.eventos.set('rec-servidor', {
  id: 'rec-servidor', lote_id: lote.id, tipo: 'recepcion', estado_nuevo: 'por_muestrear',
  usuario_id: 'yo', ocurrido_en: lote.creado_en, registrado_en: new Date().toISOString()
});
await Store.sincronizar();
await Store.sincronizar();     // la marca va una vuelta por detrás

const recs = [...tiendas.get('eventos').values()]
  .filter((e) => e.lote_id === lote.id && e.tipo === 'recepcion');
ok(recs.length === 1 && recs[0].id === 'rec-servidor',
   `en el celular queda solo la del servidor (${recs.map((e) => e.id).join(', ')})`);

// un celular que ya tenía las dos guardadas de antes del arreglo
tiendas.get('eventos').set('vieja-local', { id: 'vieja-local', lote_id: lote.id,
  tipo: 'recepcion', local: true, ocurrido_en: lote.creado_en });
const h = await Store.historial(lote.id);
ok(h.filter((e) => e.tipo === 'recepcion').length === 1,
   'y uno que ya tenía las dos repetidas ve una sola al abrir la ficha');
ok(!tiendas.get('eventos').has('vieja-local'), 'la sobrante se borra del celular');

// ---------------------------------------------------------------------
titulo('Una corrección de movimiento rechazada no destroza el evento.');

const mov = await Store.registrarEvento({ lote_id: lote.id, tipo: 'movimiento',
  x: 50, y: 50, usuario_id: 'yo' });
await Store.sincronizar();
ok(servidor.tablas.eventos.has(mov.id), 'el movimiento subió');

servidor.reglas['eventos:update'] = () =>
  ({ code: '42501', message: 'Solo se corrige el último movimiento de un lote' });
await Store.corregirMovimiento(mov, 55, 52);
for (let i = 0; i < 4; i++) await Store.sincronizar();

const local = tiendas.get('eventos').get(mov.id);
ok(local?.lote_id === lote.id && local?.tipo === 'movimiento' && local?.ocurrido_en,
   `el evento conserva lote, tipo y fecha (${JSON.stringify(local)})`);
ok((await Store.historial(lote.id)).some((e) => e.id === mov.id),
   'y sigue apareciendo en el historial del lote');
ok((await Store.fallidos()).some((o) => o.id === `eventos:${mov.id}:corregido`),
   'la corrección queda como rechazada, para que se vea');
delete servidor.reglas['eventos:update'];

// ---------------------------------------------------------------------
titulo('Cada tipo de evento tiene su frase en el historial.');

const fuente = await readFile(new URL('../web/js/app.js', import.meta.url), 'utf8');
const sql = await readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8');
const tipos = (sql.match(/create type tipo_evento as enum\s*\(([^;]+)\)/) || [])[1]
  .match(/'([a-z_]+)'/g).map((t) => t.slice(1, -1));
const funcion = fuente.slice(fuente.indexOf('function textoEvento'),
  fuente.indexOf('async function fichaPila'));
const sinFrase = tipos.filter((t) => !funcion.includes(`case '${t}'`));
ok(tipos.length >= 10 && !sinFrase.length,
   `ningún tipo sale con su nombre interno (faltan: ${sinFrase.join(', ') || 'ninguno'})`);

// ---------------------------------------------------------------------
titulo('supabase-js sobrevive a una actualización de la app.');

const sw = await readFile(new URL('../web/sw.js', import.meta.url), 'utf8');
ok(/caches\.open\(CDN\)/.test(sw), 'las librerías del CDN van en su propia caché');
ok(/k !== VERSION && k !== CDN/.test(sw), 'que activar una versión nueva no borra');
ok(/rescatarCdn/.test(sw), 'y lo que había en la caché vieja se pasa antes de borrarla');
ok(/if \(res\.ok\)[\s\S]{0,80}caches\.open\(CDN\)/.test(sw),
   'un error del CDN no se guarda');

cerrar();
