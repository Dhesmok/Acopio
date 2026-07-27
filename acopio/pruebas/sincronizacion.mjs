// =====================================================================
//  Bajar solo lo que cambió, no truncar el historial en silencio, y que
//  la pasada completa sí note lo que se borró en el servidor.
// =====================================================================
import { instalar } from './ayudas/idb.mjs';
import { ok, titulo, cerrar, congelarReloj } from './ayudas/decir.mjs';

const tiendas = instalar();
const { servidor } = await import('./ayudas/supabase.mjs');
const { cargarStore } = await import('./ayudas/cargar.mjs');
const Store = await cargarStore();

const bajadoDe = (tabla) => servidor.bajado
  .filter((b) => b.tabla === tabla).reduce((n, b) => n + b.filas, 0);

await Store.iniciar();

// ---------------------------------------------------------------------
titulo('Solo se baja lo que cambió, no todo cada vez.');

for (let i = 0; i < 40; i++) {
  const id = `L${i}`;
  servidor.tablas.lotes.set(id, { id, codigo: `PG${i}`, estado: 'por_muestrear',
    pila_id: null, x: 0, y: 0, rx: 46, ry: 34, rot: 0, forma: 'elipse',
    actualizado_en: '2026-07-01T10:00:00.000Z' });
  servidor.tablas.eventos.set(`E${i}`, { id: `E${i}`, lote_id: id, tipo: 'recepcion',
    ocurrido_en: '2026-07-01T10:00:00.000Z', registrado_en: '2026-07-01T10:00:00.000Z' });
}

await Store.sincronizar();                       // primera: completa
ok(bajadoDe('lotes') === 40, `la primera vuelta baja los 40 lotes (bajó ${bajadoDe('lotes')})`);

servidor.bajado.length = 0;
await Store.sincronizar();                       // segunda: nada cambió
ok(bajadoDe('lotes') === 0, `la segunda no baja ningún lote (bajó ${bajadoDe('lotes')})`);
ok(bajadoDe('eventos') === 0, `ni ningún evento (bajó ${bajadoDe('eventos')})`);

// alguien mueve UN lote desde otro celular
Object.assign(servidor.tablas.lotes.get('L7'),
  { actualizado_en: new Date().toISOString(), x: 999 });
servidor.bajado.length = 0;
await Store.sincronizar();
ok(bajadoDe('lotes') === 1, `al cambiar uno, baja solo ese (bajó ${bajadoDe('lotes')})`);
ok((await Store.lote('L7')).x === 999, 'y el cambio llegó a la pantalla');
ok((await Store.lotes()).length === 40, 'los otros 39 siguen ahí, no se borraron');

// ---------------------------------------------------------------------
titulo('El historial viejo ya no desaparece en silencio.');

// un lote cuyo evento de recepción quedó fuera del tope de la descarga
servidor.tablas.lotes.set('LX', { id: 'LX', codigo: 'PG-VIEJO', estado: 'por_muestrear',
  pila_id: null, x: 0, y: 0, rx: 46, ry: 34, rot: 0, forma: 'elipse',
  actualizado_en: '2026-07-01T10:00:00.000Z' });
servidor.tablas.eventos.set('EX', { id: 'EX', lote_id: 'LX', tipo: 'recepcion',
  ocurrido_en: '2020-01-01T10:00:00.000Z', registrado_en: '2020-01-01T10:00:00.000Z' });
await tiendas.get('eventos').delete('EX');       // no está en el celular

const h = await Store.historial('LX');
ok(h.length === 1 && h[0].tipo === 'recepcion',
   'al abrir la ficha se va a buscar la parte que faltaba');
ok(Store.historialCompleto(h), 'y queda marcado como completo');
ok(!!(await tiendas.get('eventos').get('EX')), 'lo traído se guarda en el celular');

// ---------------------------------------------------------------------
titulo('La pasada completa sí nota lo que se borró en el servidor.');
servidor.tablas.lotes.delete('L3');
await Store.sincronizar();
ok(!!(await Store.lote('L3')), 'una vuelta incremental no lo nota (es lo esperado)');

const descongelar = congelarReloj(new Date(Date.now() + 11 * 60_000).toISOString());
await Store.sincronizar();
descongelar();
ok(!(await Store.lote('L3')), 'la pasada completa (cada 10 min) sí lo quita');
ok((await Store.lotes()).length === 40, 'quedan 40 lotes (39 + el viejo)');

// ---------------------------------------------------------------------
titulo('Si desactivan el perfil, no se borra lo que hay en el celular.');
// Las políticas devuelven cero filas SIN error: sin cerrojo, la app
// tomaría ese vacío por la verdad y dejaría la pantalla en blanco.
const habia = (await Store.lotes()).length;
servidor.tablas.perfiles.clear();
const r = await Store.sincronizar();
ok(r.motivo === 'perfil_inactivo', `la app lo detecta y lo dice (${JSON.stringify(r)})`);
ok((await Store.lotes()).length === habia, `los ${habia} lotes siguen en pantalla`);

cerrar();
