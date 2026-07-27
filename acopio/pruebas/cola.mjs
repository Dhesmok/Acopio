// =====================================================================
//  La cola de sincronización: dependencias, orden y reintentos.
//  Cubre el incidente que originó todo esto: lotes duplicados y una
//  fila de errores `eventos_lote_id_fkey` que no señalaban al culpable.
// =====================================================================
import { instalar } from './ayudas/idb.mjs';
import { ok, titulo, cerrar } from './ayudas/decir.mjs';

const tiendas = instalar();
const { servidor } = await import('./ayudas/supabase.mjs');
const { cargarStore } = await import('./ayudas/cargar.mjs');
const Store = await cargarStore();

const cola = () => [...tiendas.get('cola').keys()];
const malos = () => [...tiendas.get('fallidos').values()];

await Store.iniciar();

// ---------------------------------------------------------------------
titulo('El servidor rechaza el lote. Sus eventos NO se mandan.');
servidor.reglas.lotes = () =>
  ({ code: '42501', message: 'new row violates row-level security policy for table "lotes"' });

const lote = await Store.crearLote({ codigo: 'abg12', proveedor_id: 'p1', placa: 'xyz123',
  material: 'granel', forma: 'elipse', x: 10, y: 10, usuario_id: 'yo' });
await Store.registrarEvento({ lote_id: lote.id, tipo: 'observacion', nota: 'una', usuario_id: 'yo' });
await Store.registrarEvento({ lote_id: lote.id, tipo: 'cambio_estado',
  estado_nuevo: 'muestreado', usuario_id: 'yo' });

ok(cola().length === 3, `la cola tiene 3 operaciones (${cola().join(', ')})`);

for (let i = 0; i < 3; i++) await Store.sincronizar();

ok(!servidor.intentos.some((k) => k.startsWith('eventos:')),
   `ningún evento se mandó al servidor (solo se mandó: ${[...new Set(servidor.intentos)].join(', ')})`);
ok(malos().length === 3, 'los 3 quedaron guardados como no aceptados');
ok(/permiso/.test(malos().find((m) => m.tabla === 'lotes').error),
   'el lote explica la causa real, en cristiano');
const ev = malos().find((m) => m.tabla === 'eventos');
ok(/[Ee]spera a un lote/.test(ev.error), `el evento dice que solo está esperando: "${ev.error}"`);
ok(!/foreign key/.test(ev.error), 'ningún mensaje habla de llave foránea');

// ---------------------------------------------------------------------
titulo('Se arregla la base y se reintenta: el lote sube ANTES que sus eventos.');
delete servidor.reglas.lotes;
servidor.intentos.length = 0;
await Store.reintentarFallidos();
await Store.sincronizar();

const orden = servidor.intentos.filter((k) => /^(lotes|eventos):/.test(k));
ok(orden[0]?.startsWith('lotes:'), `lo primero fue el lote (${orden.join(' → ')})`);
ok(servidor.tablas.lotes.size === 1, 'el lote llegó al servidor');
ok(servidor.tablas.eventos.size === 2, 'los 2 eventos llegaron detrás');
ok(cola().length === 0 && malos().length === 0, 'no quedó nada pendiente ni rechazado');

// ---------------------------------------------------------------------
titulo('Tocar "Poner en el mapa" diez veces deja UN lote.');
const antes = (await Store.lotes()).length;
const creados = [];
for (let i = 0; i < 10; i++) {
  creados.push(await Store.crearLote({ codigo: 'ABG99', proveedor_id: 'p1', placa: 'XYZ123',
    material: 'granel', forma: 'elipse', x: 10, y: 10, usuario_id: 'yo' }));
}
ok(new Set(creados.map((l) => l.id)).size === 1, 'los diez toques devuelven el mismo lote');
ok((await Store.lotes()).length === antes + 1, 'solo se agregó un lote a la pantalla');

await Store.sincronizar();
ok(servidor.tablas.lotes.size === 2, `el servidor tiene 2 lotes, no 11 (tiene ${servidor.tablas.lotes.size})`);
ok(malos().length === 0, 'ningún rechazo por código repetido');

// ---------------------------------------------------------------------
titulo('Un error del servidor no se confunde con falta de señal.');
servidor.reglas.eventos = () => ({ code: '42501', message: 'row-level security' });
await Store.registrarEvento({ lote_id: lote.id, tipo: 'observacion', nota: 'dos', usuario_id: 'yo' });
const r = await Store.sincronizar();
ok(r.motivo !== 'sin_conexion', `un 42501 no se reporta como falta de señal (${JSON.stringify(r)})`);
delete servidor.reglas.eventos;

cerrar();
