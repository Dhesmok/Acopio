// =====================================================================
//  Sincronizar: lo que se contesta tiene que ser verdad.
//  - Una vuelta pedida mientras otra está en marcha espera a esa, en vez
//    de contestar "sin conexión" (cerrar sesión ofrecía perder cambios).
//  - Una sesión vencida no se confunde con un perfil sin habilitar.
//  - Editar un lote que ya no está no encola media fila.
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
titulo('Dos vueltas a la vez: la segunda espera a la primera.');

const lote = await Store.crearLote({ codigo: 'ABG7', proveedor_id: 'p1', placa: 'ABC123',
  material: 'granel', forma: 'elipse', x: 10, y: 10, usuario_id: 'yo' });
const [a, b] = await Promise.all([Store.sincronizar(), Store.sincronizar()]);
ok(a.ok && b.ok, `las dos dicen la verdad: subió (${JSON.stringify(a)} / ${JSON.stringify(b)})`);
ok(b.motivo !== 'sin_conexion', 'la segunda no se inventa una falta de señal');
ok(servidor.tablas.lotes.has(lote.id) && !tiendas.get('cola').size,
   'y al terminar no queda nada pendiente');
const c = await Store.sincronizar();
ok(c.ok, 'después de terminar se puede volver a sincronizar');

// ---------------------------------------------------------------------
titulo('Editar un lote que ya no está en el celular no encola nada.');

const antes = tiendas.get('cola').size;
const r = await Store.actualizarLote('no-existe', { x: 1, y: 2 });
ok(r === null && tiendas.get('cola').size === antes, 'no se manda una fila a medias');

// ---------------------------------------------------------------------
titulo('Sin sesión no es lo mismo que sin habilitar.');

// la sesión se venció: el perfil hay que volver a preguntarlo, así que
// se borra la confirmación de media hora con un perfil "olvidado"
const { congelarReloj } = await import('./ayudas/decir.mjs');
const deshacer = congelarReloj(new Date(Date.now() + 2 * 3600_000).toISOString());
Store.sb.auth.getSession = async () => ({ data: { session: null } });
const s = await Store.sincronizar();
deshacer();
ok(s.motivo === 'sin_sesion', `dice que falta la sesión, no que el perfil está inactivo (${s.motivo})`);

const app = await readFile(new URL('../web/js/app.js', import.meta.url), 'utf8');
ok(/sinSesion\(\)[\s\S]{0,400}location\.reload\(\)/.test(app),
   'la franja ofrece volver a entrar, sin borrar el celular');
ok(/r\.motivo !== 'sin_conexion'/.test(app),
   'sin señal no se borra un "sin acceso" que sí era verdad');

// ---------------------------------------------------------------------
titulo('El informe pagina las observaciones con desempate.');

const store = await readFile(new URL('../web/js/store.js', import.meta.url), 'utf8');
ok(/\.eq\('tipo', 'observacion'\)[\s\S]{0,400}\.order\('ocurrido_en'[^)]*\)\.order\('id'\)/.test(store),
   'se ordena por fecha y, a igual fecha, por id');

cerrar();
