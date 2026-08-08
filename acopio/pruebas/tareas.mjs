// =====================================================================
//  Encargos del admin a los contratistas.
//
//  Lo que se prueba aquí es lo que no se ve: que una tarea creada sin
//  señal suba entera y en el orden correcto, que completarla NO se mande
//  como un upsert —el servidor le exigiría al contratista permiso para
//  crear, que no tiene—, y que darle dos veces no la mande dos veces.
// =====================================================================
import { instalar } from './ayudas/idb.mjs';
import { ok, titulo, cerrar } from './ayudas/decir.mjs';

const tiendas = instalar();
const { servidor } = await import('./ayudas/supabase.mjs');
const { cargarStore } = await import('./ayudas/cargar.mjs');
const Store = await cargarStore();

await Store.iniciar();

const enCola = async () => (await Store.pendientes());
const modoDe = async (id) => (await enCola()).find((o) => o.id === id)?.modo;

// ---------------------------------------------------------------------
titulo('Una tarea se guarda en el celular antes de subir.');

const t = await Store.crearTarea({
  titulo: '  Remuestrear el PG1042  ', detalle: '  Vino con humedad  ',
  prioridad: 'urgente', asignado_a: 'u2', usuario_id: 'yo'
});
ok(t.titulo === 'Remuestrear el PG1042', `el título se recorta ("${t.titulo}")`);
ok(t.detalle === 'Vino con humedad', 'y el detalle también');
ok(t.prioridad === 'urgente', 'la prioridad se respeta');
ok(t.completado_en === null, 'nace pendiente');
ok((await Store.tareas()).length === 1, 'ya está guardada en el celular, sin haber subido');
ok(await modoDe(`tareas:${t.id}`) === 'insertar',
   'y en la cola va como "insertar", que es idempotente');

// ---------------------------------------------------------------------
titulo('Completar NO se manda como upsert.');

// Esto no es un detalle: un upsert es un insert con salida por conflicto,
// y Postgres le pide permiso de INSERTAR aunque la fila ya exista. El
// contratista no lo tiene —solo el admin crea tareas—, así que un upsert
// le rebotaría y la tarea se quedaría trabada en la cola para siempre.
await Store.sincronizar();
ok(!!servidor.tablas.tareas.get(t.id), 'la tarea subió');

await Store.completarTarea(t.id, { usuario_id: 'u2', nota: '  Ya quedó  ' });
ok(await modoDe(`tareas:${t.id}`) === 'actualizar',
   'completarla va como "actualizar", no como upsert');

const local = (await Store.tareas())[0];
ok(!!local.completado_en, 'en pantalla ya sale completada, sin esperar al servidor');
ok(local.completado_por === 'u2', 'y con quién la completó');
ok(local.nota_cierre === 'Ya quedó', 'la nota se recorta y se guarda');

// ---------------------------------------------------------------------
titulo('Darle dos veces a "completada" no la manda dos veces.');

const antes = servidor.intentos.length;
await Store.completarTarea(t.id, { usuario_id: 'u3', nota: 'otra vez' });
const igual = (await Store.tareas())[0];
ok(igual.completado_por === 'u2', 'la segunda vez no cambia quién la completó');
ok(igual.nota_cierre === 'Ya quedó', 'ni la nota');
ok((await enCola()).filter((o) => o.id === `tareas:${t.id}`).length === 1,
   'y en la cola sigue habiendo UNA sola operación, no dos');

await Store.sincronizar();
ok(servidor.tablas.tareas.get(t.id)?.completado_por === 'u2',
   'el servidor la recibe completada una vez');
ok(servidor.intentos.length > antes, 'y sí se mandó, no se quedó en el celular');

// ---------------------------------------------------------------------
titulo('Una tarea sobre un lote no puede subir antes que el lote.');

// El orden de la cola importa: si la tarea llegara primero, el servidor
// la rechazaría por llave foránea y se gastaría los reintentos.
servidor.tablas.proveedores.set('p1', { id: 'p1', abreviatura: 'PG', nombre: 'Prueba', activo: true });
const lote = await Store.crearLote({ codigo: 'PG1042', proveedor_id: 'p1', placa: 'WGY308',
  material: 'granel', forma: 'elipse', x: 0, y: 0, usuario_id: 'yo' });
const conLote = await Store.crearTarea({
  titulo: 'Mover el PG1042', prioridad: 'alta', lote_id: lote.id, usuario_id: 'yo'
});
const op = (await enCola()).find((o) => o.id === `tareas:${conLote.id}`);
ok(op.depende.includes(`lotes:${lote.id}`),
   `la tarea depende de su lote (${JSON.stringify(op.depende)})`);

await Store.sincronizar();
await Store.sincronizar();
ok(!!servidor.tablas.tareas.get(conLote.id), 'las dos subieron');
ok(servidor.tablas.tareas.get(conLote.id).lote_id === lote.id, 'y la tarea quedó amarrada al lote');

// ---------------------------------------------------------------------
titulo('Borrar una tarea la quita de las dos partes.');

await Store.borrarTarea(conLote.id);
ok((await Store.tareas()).every((x) => x.id !== conLote.id), 'desaparece del celular enseguida');
ok(await modoDe(`del:tareas:${conLote.id}`) === 'borrar', 'y queda encolado el borrado');

// ---------------------------------------------------------------------
titulo('Las tareas llegan por la vuelta rápida, no por la lenta.');

// Una tarea urgente que tardara una hora en llegar no serviría de nada.
// La hora va un segundo por delante a propósito: el servidor de verdad
// la pone al escribir, y dos escrituras en el MISMO milisegundo hacían
// que la prueba pasara o fallara según lo rápido que fuera la máquina.
const luego = new Date(Date.now() + 1000).toISOString();
servidor.tablas.tareas.set('T9', {
  id: 'T9', titulo: 'Desde otro celular', detalle: null, prioridad: 'urgente',
  asignado_a: null, lote_id: null, pila_id: null, creado_por: 'yo',
  creado_en: luego, completado_en: null, completado_por: null,
  nota_cierre: null, actualizado_en: luego
});
servidor.bajado.length = 0;
await Store.sincronizar();          // vuelta normal, sin adelantar el reloj
ok((await Store.tareas()).some((x) => x.id === 'T9'),
   'una tarea creada en otro celular llega en la vuelta de siempre');

cerrar();
