// =====================================================================
//  Encargos del admin a los contratistas.
//
//  Lo que se prueba aquí es lo que no se ve: que una tarea creada sin
//  señal suba entera y en el orden correcto, que completarla NO se mande
//  como un upsert —el servidor le exigiría al contratista permiso para
//  crear, que no tiene—, y que darle dos veces no la mande dos veces.
// =====================================================================
import { readFile } from 'node:fs/promises';
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
const pila = await Store.crearPila({ codigo: '7', tipo: 'otro', nota: null,
  x: 0, y: 0, rx: 100, ry: 70, usuario_id: 'yo' });
const conLote = await Store.crearTarea({
  titulo: 'Acomodar estos dos', prioridad: 'alta',
  lotes_ids: [lote.id], pilas_ids: [pila.id], usuario_id: 'yo'
});
const op = (await enCola()).find((o) => o.id === `tareas:${conLote.id}`);
ok(op.depende.includes(`lotes:${lote.id}`) && op.depende.includes(`pilas:${pila.id}`),
   `la tarea depende de TODO lo que señala (${JSON.stringify(op.depende)})`);

await Store.sincronizar();
await Store.sincronizar();
ok(!!servidor.tablas.tareas.get(conLote.id), 'las dos subieron');
const subida = servidor.tablas.tareas.get(conLote.id);
ok(subida.lotes_ids.length === 1 && subida.lotes_ids[0] === lote.id,
   'y la tarea quedó amarrada al lote');
ok(subida.pilas_ids.length === 1 && subida.pilas_ids[0] === pila.id, 'y también a la pila');

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
  asignado_a: null, lotes_ids: [], pilas_ids: [], creado_por: 'yo',
  creado_en: luego, completado_en: null, completado_por: null,
  nota_cierre: null, actualizado_en: luego
});
servidor.bajado.length = 0;
await Store.sincronizar();          // vuelta normal, sin adelantar el reloj
ok((await Store.tareas()).some((x) => x.id === 'T9'),
   'una tarea creada en otro celular llega en la vuelta de siempre');

// ---------------------------------------------------------------------
titulo('Solo el dueño de la tarea decide quién puede darla por hecha.');

// Esto vive en DOS sitios a propósito. La pantalla no le enseña el botón
// a quien no es el dueño (`puedeCompletar` en app.js), y el disparador
// del servidor lo comprueba otra vez. Aquí se prueba la regla, que es la
// que no se puede saltar tocando la app por dentro.
const dueno = (t, quien, admin = false) =>
  admin || !t.asignado_a || t.asignado_a === quien;

const mia    = { asignado_a: 'u2' };
const suelta = { asignado_a: null };
ok(dueno(mia, 'u2'),        'el dueño sí puede');
ok(!dueno(mia, 'u3'),       'otro contratista NO puede');
ok(dueno(mia, 'u3', true),  'el admin puede con cualquiera');
ok(dueno(suelta, 'u3'),     'y una tarea sin dueño la cierra quien la haga');

// Y el disparador del servidor dice lo mismo, palabra por palabra.
const disparador = await readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8');
ok(/if old\.asignado_a is not null and old\.asignado_a <> auth\.uid\(\) then\s*\n\s*return old;/
   .test(disparador),
   'el servidor ignora el cierre de quien no es el dueño, en vez de fallar');
ok(/if old\.completado_en is not null then return old; end if;/.test(disparador),
   'y cerrar una ya cerrada tampoco falla: dos personas pueden darle a la vez');

cerrar();
