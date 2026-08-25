// =====================================================================
//  Pruebas de auditoría: casos de combinación de acciones y fallos edge.
// =====================================================================
import { instalar } from './ayudas/idb.mjs';
import { ok, titulo, cerrar } from './ayudas/decir.mjs';

const tiendas = instalar();
const { servidor } = await import('./ayudas/supabase.mjs');
const { cargarStore } = await import('./ayudas/cargar.mjs');
const Store = await cargarStore();

await Store.iniciar();

// ---------------------------------------------------------------------
titulo('1. salir() protege contra pérdida de datos si hay pendientes');

const lote1 = await Store.crearLote({ codigo: 'AUD01', proveedor_id: 'p1', placa: 'AAA111',
  material: 'granel', forma: 'elipse', x: 10, y: 10, usuario_id: 'yo' });

let errorCapturado = null;
try {
  await Store.salir();
} catch (e) {
  errorCapturado = e;
}
ok(errorCapturado !== null && /cambios sin subir/.test(errorCapturado.message),
   `salir() lanzó error al haber pendientes: "${errorCapturado?.message}"`);

// ---------------------------------------------------------------------
titulo('2. Corregir lote rechazado por duplicado actualiza cola/fallidos y permite reintento exitoso');

servidor.reglas.lotes = (fila) => {
  if (fila.codigo === 'AUD01') return { code: '23505', message: 'duplicate key value violates unique constraint "lotes_codigo_key"' };
  return null;
};

// Sincronizar para forzar fallo por duplicado de AUD01
for (let i = 0; i < 3; i++) await Store.sincronizar();

const fallidos1 = await Store.fallidos();
ok(fallidos1.some((f) => f.id === `lotes:${lote1.id}`), 'el lote quedó en fallidos por código duplicado');

// Corregir código desde UI
delete servidor.reglas.lotes;
await Store.actualizarLote(lote1.id, { codigo: 'AUD01-FIX' });

const colaTrasFix = await Store.pendientes();
const fallidosTrasFix = await Store.fallidos();
ok(!fallidosTrasFix.some((f) => f.id === `lotes:${lote1.id}`), 'ya no está en fallidos tras corrección');
ok(colaTrasFix.some((c) => c.id === `lotes:${lote1.id}` && c.fila.codigo === 'AUD01-FIX'),
   'volvió a la cola con el código corregido');

await Store.sincronizar();
ok(servidor.tablas.lotes.has(lote1.id), 'el lote subió exitosamente al servidor tras corregirlo');
ok(servidor.tablas.lotes.get(lote1.id).codigo === 'AUD01-FIX', 'subió con el código AUD01-FIX');

// ---------------------------------------------------------------------
titulo('3. Replay de sincronización en bajar() conserva campos actualizados (código, material, puntos)');

const lote2 = await Store.crearLote({ codigo: 'AUD02', proveedor_id: 'p1', placa: 'BBB222',
  material: 'granel', forma: 'elipse', x: 20, y: 20, usuario_id: 'yo' });
await Store.sincronizar();

// Mientras desconectado, actualizar código y material
await Store.actualizarLote(lote2.id, { codigo: 'AUD02-MOD', material: 'bigbag' });

// Ejecutar sincronización (bajar reejecuta queue replay)
await Store.sincronizar();

const lote2Local = await Store.lote(lote2.id);
ok(lote2Local.codigo === 'AUD02-MOD', `el código actualizado se conservó durante el replay (${lote2Local.codigo})`);
ok(lote2Local.material === 'bigbag', `el material actualizado se conservó (${lote2Local.material})`);

// ---------------------------------------------------------------------
titulo('4. Crear tarea offline y completarla offline mantiene modo "insertar"');

const tarea1 = await Store.crearTarea({
  titulo: 'Tarea offline', detalle: 'Prueba', prioridad: 'alta',
  asignado_a: null, lotes_ids: [], pilas_ids: [], monedas: 5, usuario_id: 'yo'
});

const opTareaIni = (await Store.pendientes()).find((c) => c.id === `tareas:${tarea1.id}`);
ok(opTareaIni.modo === 'insertar', 'al crear la tarea el modo es "insertar"');

await Store.completarTarea(tarea1.id, { usuario_id: 'yo', nota: 'lista' });

const opTareaFin = (await Store.pendientes()).find((c) => c.id === `tareas:${tarea1.id}`);
ok(opTareaFin.modo === 'insertar', 'tras completarla offline el modo sigue siendo "insertar"');
ok(opTareaFin.fila.completado_en !== null, 'la fila incluye la fecha de completado');

await Store.sincronizar();
ok(servidor.tablas.tareas.has(tarea1.id), 'la tarea subió al servidor');
ok(servidor.tablas.tareas.get(tarea1.id).completado_en !== null, 'la tarea llegó al servidor ya completada');

// ---------------------------------------------------------------------
titulo('5. Crear tarea offline y borrarla offline limpia la cola sin enviar peticiones fantasma');

const tarea2 = await Store.crearTarea({
  titulo: 'Tarea borrada offline', detalle: 'Temporal', prioridad: 'baja',
  asignado_a: null, lotes_ids: [], pilas_ids: [], monedas: 0, usuario_id: 'yo'
});

ok((await Store.pendientes()).some((c) => c.id === `tareas:${tarea2.id}`), 'la tarea está en cola');

await Store.borrarTarea(tarea2.id);

ok(!(await Store.pendientes()).some((c) => c.id === `tareas:${tarea2.id}` || c.id === `del:tareas:${tarea2.id}`),
   'se limpió de la cola sin dejar operacion de borrado fantasma');

// ---------------------------------------------------------------------
titulo('6. Borrar tarea existente en servidor pero editada offline encola borrado en servidor');

const tarea3 = await Store.crearTarea({
  titulo: 'Tarea servidor', detalle: 'Existente', prioridad: 'media',
  asignado_a: null, lotes_ids: [], pilas_ids: [], monedas: 1, usuario_id: 'yo'
});
await Store.sincronizar();
ok(servidor.tablas.tareas.has(tarea3.id), 'la tarea ya está en el servidor');

// Editar offline (crea modo "actualizar" en cola)
await Store.completarTarea(tarea3.id, { usuario_id: 'yo', nota: 'cierre parcial' });
ok((await Store.pendientes()).some((c) => c.id === `tareas:${tarea3.id}` && c.modo === 'actualizar'),
   'hay operacion actualizar en cola');

// Borrar offline
await Store.borrarTarea(tarea3.id);
ok((await Store.pendientes()).some((c) => c.id === `del:tareas:${tarea3.id}` && c.modo === 'borrar'),
   'encoló la operación del:tareas:id con modo borrar para eliminarla del servidor');

await Store.sincronizar();
ok(!servidor.tablas.tareas.has(tarea3.id), 'la tarea fue eliminada exitosamente del servidor');

// ---------------------------------------------------------------------
titulo('7. Formato de fecha de recepción en lote nuevo usa huso de Colombia (YYYY-MM-DD)');

ok(/^\d{4}-\d{2}-\d{2}$/.test(lote1.fecha_recepcion), `fecha_recepcion tiene formato YYYY-MM-DD (${lote1.fecha_recepcion})`);

// ---------------------------------------------------------------------
// Limpieza final con forzar
await Store.salir({ forzar: true });

cerrar();
