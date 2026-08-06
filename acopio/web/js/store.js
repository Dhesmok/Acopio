// =====================================================================
//  store.js · datos locales + cola de sincronización
//  Regla de oro: GUARDAR NUNCA FALLA. Todo se escribe en el celular y
//  sube solo cuando vuelve la señal.
// =====================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

const DB = 'acopio';
const TIENDAS = ['lotes', 'pilas', 'proveedores', 'eventos', 'figuras',
                 'config', 'perfiles', 'cola', 'fallidos', 'meta'];
let db = null;

// ------------------------------------------------------------ IndexedDB
function abrir() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 4);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const t of TIENDAS)
        if (!d.objectStoreNames.contains(t)) d.createObjectStore(t, { keyPath: 'id' });
      // Desde que la sincronización es incremental, los eventos ya no se
      // borran y se rebajan enteros en cada vuelta: se acumulan. Buscar el
      // historial de un lote recorriéndolos TODOS deja de ser gratis, y
      // con los años sería lentísimo. Con índice va directo.
      const ev = req.transaction.objectStore('eventos');
      if (!ev.indexNames.contains('lote_id')) ev.createIndex('lote_id', 'lote_id');
      if (!ev.indexNames.contains('pila_id')) ev.createIndex('pila_id', 'pila_id');
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
const pedir = (r) => new Promise((res, rej) => {
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const st = (t, m = 'readonly') => db.transaction(t, m).objectStore(t);
const idb = {
  todos: (t) => pedir(st(t).getAll()),
  uno: (t, id) => pedir(st(t).get(id)),
  // por índice: sin recorrer la tienda entera
  por: (t, indice, valor) => pedir(st(t).index(indice).getAll(valor)),
  guardar: (t, o) => pedir(st(t, 'readwrite').put(o)),
  borrar: (t, id) => pedir(st(t, 'readwrite').delete(id)),
  async varios(t, os) { const s = st(t, 'readwrite'); await Promise.all(os.map((o) => pedir(s.put(o)))); },
  vaciar: (t) => pedir(st(t, 'readwrite').clear())
};

export async function iniciar() { db = await abrir(); }

// ------------------------------------------------------------ utilidades
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    }));
const ahora = () => new Date().toISOString();

// La fecha del patio es la del reloj de quien registra, no la de UTC.
// `toISOString()` va cinco horas adelante en Colombia: un lote recibido
// a las 7 de la noche quedaba con la fecha del día siguiente, y después
// no aparecía donde nadie lo buscaba.
const hoyLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function meta(k, v) {
  if (v === undefined) { const m = await idb.uno('meta', k); return m ? m.valor : null; }
  await idb.guardar('meta', { id: k, valor: v });
  return v;
}

// -------------------------------------------------------------- lecturas
export const lotes = () => idb.todos('lotes');
export const pilas = () => idb.todos('pilas');
export const proveedores = () => idb.todos('proveedores');
export const figuras = () => idb.todos('figuras');
export const perfiles = () => idb.todos('perfiles');
export const fallidos = () => idb.todos('fallidos');
export const olvidarFallidos = () => idb.vaciar('fallidos');

// Devuelve los rechazados a la cola. Se usa después de corregir la base:
// los cambios vuelven a intentarse en vez de perderse.
//
// El `orden` original NO se toca. Reasignarlo aquí ponía los eventos antes
// que su lote (la lista sale ordenada por clave y "eventos:" va antes que
// "lotes:"), así que el reintento repetía el mismo error de llave foránea
// aunque la base ya estuviera arreglada.
export async function reintentarFallidos() {
  for (const op of await idb.todos('fallidos')) {
    await idb.guardar('cola', { ...op, intentos: 0, error: null, detalle: null, fallo_en: null });
    await idb.borrar('fallidos', op.id);
  }
}
export const pendientes = () => idb.todos('cola');
// Todos los eventos guardados en el celular, para rehacer el patio de un
// día pasado.
export const eventos = () => idb.todos('eventos');

// Cuánta historia se trae de una vez al pedir mirar atrás. Un patio con
// años encima puede tener decenas de miles de eventos, y bajarlos todos
// de golpe con la señal de una mina es tenerse que esperar sin saber
// cuánto. Se traen seis mil por vez —algo más de un megabyte—, se quedan
// guardados, y la vez siguiente se sigue desde donde se quedó: a la
// segunda o tercera vez de abrirlo, ya está entera y no se baja nada.
const PAGINA = 1000;
const PAGINAS_POR_VEZ = 6;

// Baja el siguiente tramo de historia, hacia atrás. Devuelve hasta dónde
// alcanza ya y si se llegó al principio de todo.
export async function ahondarHistoria() {
  const guardados = await idb.todos('eventos');
  const conocidos = new Set(guardados.map((e) => e.id));
  let fondo = guardados.reduce((m, e) => (!m || e.ocurrido_en < m ? e.ocurrido_en : m), null);

  if (await meta('historia_entera')) return { desde: fondo, entera: true, traidos: 0 };
  if (!navigator.onLine) return { desde: fondo, entera: false, traidos: 0, sinSenal: true };

  let traidos = 0, entera = false;
  for (let i = 0; i < PAGINAS_POR_VEZ; i++) {
    const q = sb.from('eventos').select('*')
      .order('ocurrido_en', { ascending: false }).limit(PAGINA);
    // `lte` y no `lt`: dos eventos pueden caer en el mismo milisegundo
    // —una pila entera cambia de estado a la vez— y cortar por debajo se
    // saltaría los hermanos. Vuelven a venir los del borde, que ya están.
    if (fondo) q.lte('ocurrido_en', fondo);
    const { data, error } = await q;
    if (error || !data?.length) break;

    const nuevos = data.filter((e) => !conocidos.has(e.id));
    await idb.varios('eventos', data);
    for (const e of nuevos) conocidos.add(e.id);
    traidos += nuevos.length;

    // menos filas de las que caben: se llegó al principio de todo
    if (data.length < PAGINA) { entera = true; break; }
    // una página entera con la misma hora: no se puede bajar más sin
    // dejar de avanzar, y seguir sería dar vueltas sobre lo mismo
    if (!nuevos.length) break;
    fondo = data.reduce((m, e) => (e.ocurrido_en < m ? e.ocurrido_en : m), data[0].ocurrido_en);
  }
  if (entera) await meta('historia_entera', true);
  return { desde: fondo, entera, traidos };
}

// Avisos de una sola vez: cosas que la app resolvió sola pero que la
// persona tiene que saber (una pila que hubo que renombrar al subir).
export const avisos = async () => (await meta('avisos')) || [];
export const olvidarAvisos = () => meta('avisos', []);
async function anotarAviso(texto) {
  const v = (await meta('avisos')) || [];
  v.push({ texto, en: ahora() });
  await meta('avisos', v.slice(-10));
}

export const lote = (id) => idb.uno('lotes', id);
export const pila = (id) => idb.uno('pilas', id);

export async function config() {
  return (await idb.uno('config', 'unico')) || {
    id: 'unico', ancho: 1000, alto: 700, color_fondo: '#e4e7e2',
    imagen_url: null, imagen_x: 0, imagen_y: 0,
    imagen_ancho: 1000, imagen_alto: 700, imagen_opacidad: 1
  };
}

export async function historialPila(pilaId) {
  return (await idb.por('eventos', 'pila_id', pilaId))
    .filter((e) => e.tipo === 'ingreso_pila' || e.tipo === 'salida_pila')
    .sort((a, b) => b.ocurrido_en.localeCompare(a.ocurrido_en));
}

// Todo lote tiene exactamente un evento de 'recepcion', y los eventos no
// se borran nunca. Así que la prueba de que tenemos su historia completa
// es tener ese evento: si falta, la descarga inicial se quedó corta y hay
// que ir a buscar la de ese lote. Antes simplemente faltaba, sin decirlo.
export async function historial(loteId) {
  let evs = await idb.por('eventos', 'lote_id', loteId);
  if (!evs.some((e) => e.tipo === 'recepcion') && navigator.onLine) {
    const { data } = await sb.from('eventos').select('*').eq('lote_id', loteId);
    if (data?.length) {
      await idb.varios('eventos', data);          // queda en el celular
      const ya = new Set(evs.map((e) => e.id));
      evs = evs.concat(data.filter((e) => !ya.has(e.id)));
    }
  }
  return evs.sort((a, b) => b.ocurrido_en.localeCompare(a.ocurrido_en));
}

// ¿Alcanzamos a traer la historia entera de este lote?
export const historialCompleto = (evs) => evs.some((e) => e.tipo === 'recepcion');

// Todas las observaciones, agrupadas por lote, para el informe.
//
// Se piden al servidor cuando hay señal. En el celular solo está el
// historial de los lotes que alguien llegó a abrir, así que un informe
// hecho con lo que hay guardado saldría con la mitad de las
// observaciones y sin avisar de que faltan. `completo` dice si se
// pudieron traer todas, para poder decirlo en pantalla en vez de
// entregar un archivo cojo como si estuviera entero.
export async function observaciones() {
  const guardadas = (await idb.todos('eventos'))
    .filter((e) => e.tipo === 'observacion' && e.nota);
  let completo = false, evs = guardadas;
  if (navigator.onLine) {
    // De página en página. Una consulta suelta la corta el servidor a su
    // tope de filas SIN AVISAR, y ese es el peor de los casos: el informe
    // saldría con observaciones de menos diciendo que está completo. Se
    // pide por trozos hasta que uno vuelve corto, que es la única señal
    // fiable de que ya no queda nada.
    const trozo = 1000, TOPE = 50;      // 50 000 observaciones y paramos
    const traidas = [];
    let entero = false;
    for (let i = 0; i < TOPE; i++) {
      const { data, error } = await sb.from('eventos')
        .select('lote_id,nota,ocurrido_en')
        .eq('tipo', 'observacion')
        .order('ocurrido_en', { ascending: false })
        .range(traidas.length, traidas.length + trozo - 1);
      if (error || !data) break;
      traidas.push(...data);
      if (data.length < trozo) { entero = true; break; }
    }
    if (entero) { evs = traidas.filter((e) => e.nota); completo = true; }
  }
  const notas = new Map();
  for (const e of evs.sort((a, b) => (b.ocurrido_en || '').localeCompare(a.ocurrido_en || ''))) {
    const dia = (e.ocurrido_en || '').slice(0, 10);
    const linea = dia ? `${dia}: ${e.nota}` : e.nota;
    notas.set(e.lote_id, notas.has(e.lote_id) ? `${notas.get(e.lote_id)} · ${linea}` : linea);
  }
  return { notas, completo };
}

// ------------------------------------------------------------ escrituras
// modo: 'insertar' (idempotente) | 'guardar' (upsert) | 'borrar'
// Los campos internos (los que empiezan por _) no existen en el servidor
const limpiar = (fila) =>
  Object.fromEntries(Object.entries(fila).filter(([k]) => !k.startsWith('_')));

// El orden de la cola es el orden en que se mandan las cosas, y un hijo
// nunca puede ir antes que su padre. Dos operaciones creadas dentro del
// mismo milisegundo empataban y el desempate lo decidía el nombre de la
// clave, no el tiempo: por eso esto avanza aunque el reloj no.
let ultimoOrden = 0;
const siguienteOrden = () => (ultimoOrden = Math.max(Date.now(), ultimoOrden + 1));

// De qué otra operación de la cola depende esta. Un evento no existe sin
// su lote; mover un lote no significa nada si el lote todavía no subió.
function padres(clave, tabla, fila) {
  const p = [];
  if (tabla === 'eventos') {
    if (fila.lote_id) p.push(`lotes:${fila.lote_id}`);
    if (fila.pila_id) p.push(`pilas:${fila.pila_id}`);
  } else if (tabla === 'lotes') {
    p.push(`lotes:${fila.id}`);
    if (fila.pila_id) p.push(`pilas:${fila.pila_id}`);
  } else if (tabla === 'pilas') {
    p.push(`pilas:${fila.id}`);
  }
  return p.filter((k) => k !== clave);   // nadie es padre de sí mismo
}

async function encolar(clave, tabla, modo, fila) {
  const limpia = limpiar(fila);
  await idb.guardar('cola', {
    id: clave, orden: siguienteOrden(), tabla, modo,
    fila: limpia, depende: padres(clave, tabla, limpia),
    intentos: 0, creado_en: ahora()
  });
}

export async function crearLote({ codigo, proveedor_id, placa, material, forma, x, y, usuario_id }) {
  const cod = codigo.trim().toUpperCase();
  // Tocar "Poner en el mapa" diez veces tiene que dejar UN lote. El código
  // es único en el servidor: si ya está guardado aquí, se devuelve ese
  // mismo en vez de crear un gemelo que el servidor va a rechazar.
  const ya = (await idb.todos('lotes')).find((l) => l.codigo === cod);
  if (ya) return ya;

  const t = ahora();
  const fma = forma || 'elipse';
  // El granel nace REDONDO, no ovalado: un montón de material volcado no
  // tiene una dirección larga, y la que traía el óvalo era inventada. Si
  // en el patio quedó alargado, se estira a mano con las manijas. El
  // bigbag se queda como estaba. Los 40 de radio son la misma superficie
  // que tenía el óvalo de 46 × 34, así que el patio no cambia de aspecto.
  const tam = fma === 'rectangulo' ? { rx: 46, ry: 34 } : { rx: 40, ry: 40 };

  const fila = {
    id: uuid(), codigo: cod, proveedor_id,
    placa: (placa || '').trim().toUpperCase(), fecha_recepcion: hoyLocal(),
    material: material || 'granel', forma: fma,
    puntos: null, x, y, ...tam, rot: 0,
    estado: 'por_muestrear', estado_desde: t, fecha_recogida: null,
    pila_id: null, ultimo_evento_en: t, creado_por: usuario_id, creado_en: t
  };
  await idb.guardar('lotes', fila);
  await idb.guardar('eventos', {
    id: uuid(), lote_id: fila.id, tipo: 'recepcion', estado_nuevo: 'por_muestrear',
    pila_id: null, fecha_recogida: null, nota: null,
    usuario_id, ocurrido_en: t, local: true
  });
  await encolar(`lotes:${fila.id}`, 'lotes', 'insertar', fila);
  return fila;
}

export async function crearPila({ codigo, tipo, nota, x, y, rx, ry, usuario_id }) {
  const t = ahora();
  const fila = {
    id: uuid(), codigo: codigo.trim().toUpperCase(), tipo, estado: 'abierta',
    nota: nota || null, x, y, rx: rx || 100, ry: ry || 70, rot: 0,
    creado_por: usuario_id, creado_en: t, actualizado_en: t
  };
  await idb.guardar('pilas', fila);
  await encolar(`pilas:${fila.id}`, 'pilas', 'insertar', fila);
  return fila;
}

// Posición y forma: se sobrescriben, no generan evento. La clave de la
// cola es fija por objeto, así arrastrarlo diez veces sube una sola vez.
export async function guardarFigura(tabla, fila) {
  await idb.guardar(tabla === 'mapa_figuras' ? 'figuras' : tabla, fila);
  await encolar(`fig:${tabla}:${fila.id}`, tabla, 'guardar', fila);
}

export async function borrarFiguraFondo(id) {
  await idb.borrar('figuras', id);
  await encolar(`del:mapa_figuras:${id}`, 'mapa_figuras', 'borrar', { id });
}

export async function guardarConfig(cfg) {
  const fila = { ...cfg, id: 'unico' };
  await idb.guardar('config', fila);
  await encolar('fig:mapa_config:unico', 'mapa_config', 'guardar', fila);
}

export async function actualizarLote(id, cambios) {
  const l = await idb.uno('lotes', id);
  const fila = { ...l, ...cambios };
  await idb.guardar('lotes', fila);
  await encolar(`fig:lotes:${id}`, 'lotes', 'guardar', fila);
  return fila;
}

export async function renombrarPila(id, cambios) {
  const p = await idb.uno('pilas', id);
  const fila = { ...p, ...cambios, actualizado_en: ahora() };
  await idb.guardar('pilas', fila);
  await encolar(`fig:pilas:${id}`, 'pilas', 'guardar', fila);
  return fila;
}

export async function registrarEvento({
  lote_id, tipo, estado_nuevo, pila_id, fecha_recogida, x, y, nota, usuario_id
}) {
  const t = ahora();
  const fila = {
    id: uuid(), lote_id, tipo,
    estado_nuevo: estado_nuevo || null, pila_id: pila_id || null,
    fecha_recogida: fecha_recogida || null,
    x: x ?? null, y: y ?? null, nota: nota || null,
    usuario_id, ocurrido_en: t
  };
  await idb.guardar('eventos', fila);
  await aplicarLocal(fila);
  await encolar(`eventos:${fila.id}`, 'eventos', 'insertar', fila);
  return fila;
}

// misma derivación que el trigger del servidor
async function aplicarLocal(e) {
  const l = await idb.uno('lotes', e.lote_id);
  if (!l) return;
  if (e.tipo === 'cambio_estado') {
    l.estado = e.estado_nuevo;
    l.estado_desde = e.ocurrido_en;
    l.fecha_recogida = e.fecha_recogida || null;
  } else if (e.tipo === 'programar_recogida') l.fecha_recogida = e.fecha_recogida;
  else if (e.tipo === 'ingreso_pila') l.pila_id = e.pila_id;
  else if (e.tipo === 'salida_pila') l.pila_id = null;
  l.ultimo_evento_en = e.ocurrido_en;
  await idb.guardar('lotes', l);
}

// -------------------------------------------------------- sincronización
let ocupado = false;

export async function sincronizar() {
  if (ocupado || !navigator.onLine) return { ok: false, motivo: 'sin_conexion' };
  ocupado = true;
  try {
    // Antes que nada: si el perfil no está activo, ni subir ni bajar tiene
    // sentido. Intentarlo solo gasta los reintentos de la cola.
    if (!(await perfilVivo())) throw new Error('perfil_inactivo');
    await subir();
    await bajar();
    await meta('ultima_sync', ahora());
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: e.message };
  } finally { ocupado = false; }
}

async function aFallidos(op, error, detalle) {
  await idb.guardar('fallidos', { ...op, error, detalle: detalle || null, fallo_en: ahora() });
  await idb.borrar('cola', op.id);
}

async function subir() {
  const cola = (await idb.todos('cola')).sort((a, b) => a.orden - b.orden);

  // `rotos`   = lo que el servidor ya rechazó de plano.
  // `esperan` = lo que sigue en la cola y todavía no confirmó.
  // Un evento cuyo lote no llegó al servidor SOLO puede fallar: mandarlo
  // gasta sus tres intentos y deja en pantalla un error de llave foránea
  // que no le dice nada a quien está en el patio. Mejor no mandarlo.
  const rotos = new Set((await idb.todos('fallidos')).map((o) => o.id));
  const esperan = new Set(cola.map((o) => o.id));

  for (const op of cola) {
    const dep = op.depende || [];
    const roto = dep.find((k) => rotos.has(k));
    if (roto) {
      await aFallidos(op, `Espera a ${nombreDe(roto)}, que el servidor no aceptó. Se sube solo en cuanto eso quede resuelto.`);
      rotos.add(op.id); esperan.delete(op.id);
      continue;
    }
    // el padre sigue pendiente: este cambio espera al siguiente intento,
    // sin gastar reintentos ni ensuciar la pantalla con un error prestado
    if (dep.some((k) => esperan.has(k))) continue;

    let error = null;
    if (op.modo === 'borrar') {
      ({ error } = await sb.from(op.tabla).delete().eq('id', op.fila.id));
    } else {
      ({ error } = await sb.from(op.tabla).upsert(op.fila, {
        onConflict: 'id', ignoreDuplicates: op.modo === 'insertar'
      }));
    }
    if (!error) { await idb.borrar('cola', op.id); esperan.delete(op.id); continue; }
    if (esRed(error)) throw new Error('sin_conexion');
    // Choque de nombres entre pilas: se renombra y sigue esperando turno
    if (op.tabla === 'pilas' && error.code === '23505' && await renombrarPorChoque(op)) continue;
    op.intentos = (op.intentos || 0) + 1;
    if (op.intentos >= 3) {
      await aFallidos(op, mensajeError(error), error.message);
      rotos.add(op.id); esperan.delete(op.id);
    } else await idb.guardar('cola', op);
  }
}

// El consecutivo de una pila lo elige cada celular por su cuenta, así que
// dos personas sin señal escogen el mismo y el servidor rechaza el
// segundo: `pilas.codigo` es único. Pero el nombre es una ETIQUETA, no la
// identidad —esa es el id—, y perder la pila (con los lotes que alguien
// ya le metió) por un nombre repetido no tiene sentido. Se le da el
// siguiente libre y se avisa.
async function renombrarPorChoque(op) {
  const { data, error } = await sb.from('pilas').select('codigo');
  if (error || !data) return false;
  const usados = new Set([
    ...data.map((p) => String(p.codigo)),
    ...(await idb.todos('pilas')).map((p) => String(p.codigo))
  ]);
  let n = 1;
  while (usados.has(String(n))) n++;
  const antes = op.fila.codigo, nuevo = String(n);
  if (antes === nuevo) return false;        // no era el nombre: que falle normal

  op.fila = { ...op.fila, codigo: nuevo };
  op.intentos = 0;
  await idb.guardar('cola', op);

  // la pila en pantalla y, si quedó pendiente, el cambio de nombre que ya
  // estaba en la cola: los tres tienen que decir lo mismo
  const local = await idb.uno('pilas', op.fila.id);
  if (local) await idb.guardar('pilas', { ...local, codigo: nuevo });
  const fig = await idb.uno('cola', `fig:pilas:${op.fila.id}`);
  if (fig) await idb.guardar('cola', { ...fig, fila: { ...fig.fila, codigo: nuevo } });

  await anotarAviso(`La pila ${antes} ya existía en el servidor, creada desde otro celular. `
    + `Esta quedó como pila ${nuevo}. Sus lotes siguen dentro.`);
  return true;
}

const nombreDe = (clave) => ({
  lotes: 'un lote', pilas: 'una pila', eventos: 'un movimiento'
}[clave.split(':')[0]] || 'otro cambio');

// Sin señal el error viene sin `code` de Postgres. Con `code` el servidor
// SÍ contestó, y tratarlo como falta de señal dejaba la cola parada para
// siempre sin decir por qué.
const esRed = (e) => {
  if (!navigator.onLine) return true;
  if (e.code) return false;
  const m = (e.message || '').toLowerCase();
  return /fetch|network|timeout|load failed|abort/.test(m);
};

// El texto crudo de Postgres no le sirve a nadie en el patio.
function mensajeError(e) {
  const m = e.message || 'Error desconocido';
  if (e.code === '23505') return /codigo/.test(m)
    ? 'Ya hay otro lote con ese código. Corrígelo desde la ficha o descarta este.'
    : 'Ese registro ya existe en el servidor.';
  if (e.code === '23503') return 'Apunta a un lote o una pila que no llegó al servidor.';
  if (e.code === '42501' || /row-level security|policy/i.test(m))
    return 'Tu usuario no tiene permiso para este cambio. Pídele al administrador que active tu perfil.';
  if (e.code === '22P02') return 'Un dato quedó vacío o mal formado (revisa el proveedor del lote).';
  if (e.code === '23502') return 'Falta un dato obligatorio en este registro.';
  return m;
}

// ¿El servidor nos reconoce? Todo perfil nace inactivo, y mientras lo
// esté las políticas devuelven CERO filas sin error: la app parecía estar
// al día, borraba de la pantalla lo que sí estaba guardado y rechazaba en
// silencio todo lo que la persona escribía. Se comprueba antes de subir.
//
// Una vez confirmado no se vuelve a preguntar en un rato: era una
// consulta cada veinte segundos para algo que no cambia casi nunca.
// Mientras NO esté confirmado sí se pregunta en cada vuelta, para que
// quien acaba de ser habilitado lo note enseguida y no en diez minutos.
// Media hora. Antes iba atado a la pasada completa, que era cada diez
// minutos; ahora esa es cada seis horas y enterarse tan tarde de que a
// alguien lo desactivaron sería demasiado. Es una consulta de una fila.
const CONFIRMAR_PERFIL_CADA = 30 * 60_000;
let perfilConfirmado = 0;
async function perfilVivo() {
  if (Date.now() - perfilConfirmado < CONFIRMAR_PERFIL_CADA) return true;
  const { data: s } = await sb.auth.getSession();
  const uid = s?.session?.user?.id;
  if (!uid) return false;
  const { data, error } = await sb.from('perfiles').select('id').eq('id', uid).maybeSingle();
  if (error) throw new Error(error.message);
  if (data) perfilConfirmado = Date.now();
  return !!data;
}

// Cuántos eventos se traen en una pasada completa. El historial entero
// puede ser enorme; lo que falte se busca por lote cuando alguien abre su
// ficha (ver `historial`), así que topar aquí no esconde nada.
const TOPE_EVENTOS = 3000;

// -------------------------------------------------- cuánto se gasta
// Esto se usa en una mina: señal mala, datos que se pagan y un día
// entero sin dónde cargar el celular. Cada consulta cuesta batería
// aunque no traiga nada, porque enciende la radio.
//
// Antes, cada veinte segundos se bajaban ENTEROS los proveedores, las
// figuras del plano, la configuración y los perfiles —cosas que cambian
// una vez al mes—, y cada diez minutos, encima, todos los lotes y los
// tres mil eventos más recientes: cerca de un megabyte, seis veces por
// hora, para enterarse de lo que casi nunca pasa.
//
// Ahora la vuelta normal pregunta SOLO por lo que cambió desde la vez
// anterior: tres consultas que lo habitual es que no traigan ni una
// fila. Lo caro se hace de tarde en tarde.
// Una hora. Pasar lista es lo único que nota un borrado hecho a mano en
// la base de datos, y es también por donde llegan el fondo del mapa, los
// colores y las figuras dibujadas: seis horas para eso era demasiado. Los
// lotes, los estados y las pilas no dependen de esto — esos van por la
// vuelta de cada minuto.
const RECONCILIAR_CADA = 60 * 60_000;
// Se recuerda entre aperturas. Si no, abrir la app treinta veces al día
// —que es lo normal en el patio— hacía treinta reconciliaciones: los
// catálogos enteros cada vez, para nada.
let ultimoCompleto = null;           // sin leer todavía; en cero: toca
let marcados = [];                   // filas pintadas como rechazadas la vuelta pasada

// La marca de agua sale de las filas RECIBIDAS, no del reloj del celular:
// un teléfono con la hora corrida se quedaría sin bajar nada, o bajándolo
// todo siempre.
const marcaMayor = (filas, campo, actual) =>
  (filas || []).reduce((m, f) => (f[campo] && f[campo] > m ? f[campo] : m), actual || '');

// La rendija: una transacción que empezó antes de nuestra consulta pero
// se confirma después lleva una hora anterior a la que alcanzamos a ver,
// así que un corte exacto se la salta. Antes la tapaba la pasada
// completa bajando el patio entero cada diez minutos.
//
// Ahora la marca va UNA VUELTA POR DETRÁS: se pregunta con el máximo que
// se vio en la pasada anterior, no en esta. Así cada fila que cambia se
// baja dos veces y ni una más —con el patio quieto, la marca no se mueve
// y no se baja nada—, y cualquier fila que se confirme tarde entra en la
// vuelta siguiente. Poner un margen fijo de segundos no servía: las
// filas que caen justo sobre la marca volverían a bajarse en cada
// vuelta, para siempre.
async function marcaYMaximo(tabla, campo, filas) {
  const previo = await meta(`max_${tabla}`);
  const nuevo = marcaMayor(filas, campo, previo);
  // La primera vez no hay nada que tapar —esa pasada se lo trajo todo—,
  // así que la marca arranca al día y no se baja el patio dos veces.
  await meta(`marca_${tabla}`, previo || nuevo);
  await meta(`max_${tabla}`, nuevo);
}

// Cuadrar el celular con el servidor pidiendo solo los `id`: pesan una
// décima parte de las filas enteras y dicen las dos cosas que hacen
// falta. Lo que sobra se borra; lo que falta se devuelve para ir a
// buscarlo, que es más barato que bajarlo todo por si acaso.
//
// Lo que está en la cola no se toca: no aparece en el servidor porque
// todavía no ha subido, no porque lo hayan borrado.
async function conciliar(tabla, filas) {
  const vivos = new Set((filas || []).map((f) => f.id));
  const enCola = new Set((await idb.todos('cola')).map((o) => o.fila?.id).filter(Boolean));
  const aqui = new Set();
  for (const f of await idb.todos(tabla)) {
    aqui.add(f.id);
    if (!vivos.has(f.id) && !enCola.has(f.id)) await idb.borrar(tabla, f.id);
  }
  return [...vivos].filter((id) => !aqui.has(id));
}

// Trae filas sueltas por id, de cien en cien para no armar una dirección
// kilométrica. Normalmente la lista viene vacía y esto no hace nada.
async function traerPorId(tabla, ids) {
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await sb.from(tabla).select('*').in('id', ids.slice(i, i + 100));
    if (error) throw new Error(error.message);
    if (data?.length) await idb.varios(tabla, data);
  }
}

async function bajar() {
  if (ultimoCompleto === null) {
    ultimoCompleto = Number(await meta('ultimo_completo')) || 0;
    // Un celular con la hora adelantada guardaría una marca del futuro y
    // no volvería a reconciliar nunca. Si está por delante, no vale.
    if (ultimoCompleto > Date.now()) ultimoCompleto = 0;
  }
  const completo = Date.now() - ultimoCompleto > RECONCILIAR_CADA;
  const mLotes   = await meta('marca_lotes');
  const mPilas   = await meta('marca_pilas');
  const mEventos = await meta('marca_eventos');

  // La vuelta de siempre: tres preguntas, y solo por lo que cambió.
  const qLotes = sb.from('lotes').select('*');
  const qPilas = sb.from('pilas').select('*');
  const qEventos = sb.from('eventos').select('*');
  if (mLotes)   qLotes.gt('actualizado_en', mLotes);
  if (mPilas)   qPilas.gt('actualizado_en', mPilas);
  if (mEventos) qEventos.gt('registrado_en', mEventos);
  // la primera vez de todas no hay marca: se traen los más recientes
  else qEventos.order('ocurrido_en', { ascending: false }).limit(TOPE_EVENTOS);

  // Y de tarde en tarde, lo caro: los catálogos (que cambian una vez al
  // mes) y la lista de ids para ver si borraron algo. Los eventos no
  // entran aquí: no se borran nunca —la base misma lo impide— así que
  // preguntar por ellos sería gastar por nada.
  const extras = completo ? [
    sb.from('proveedores').select('*').eq('activo', true),
    sb.from('mapa_figuras').select('*'),
    sb.from('mapa_config').select('*').eq('id', 'unico').maybeSingle(),
    sb.from('perfiles').select('id, nombre, rol'),
    sb.from('lotes').select('id'),
    sb.from('pilas').select('id')
  ] : [];

  const r = await Promise.all([qPilas, qLotes, qEventos, ...extras]);
  for (const x of r) if (x.error) throw new Error(x.error.message);
  const [pil, lot, eve, prov, fig, cfg, per, idLotes, idPilas] = r;

  if (completo) {
    // Segundo cerrojo: si no podemos leer NI UN perfil —ni el nuestro—,
    // el nuestro dejó de estar activo mientras trabajábamos. Parar aquí,
    // porque escribir borraría de la pantalla lo que sí está guardado.
    // El primero, `perfilVivo()`, pregunta más a menudo y más barato.
    if (!per.data?.length) { perfilConfirmado = 0; throw new Error('perfil_inactivo'); }

    // Catálogos: son pocos y cambian poco, se reemplazan enteros.
    await idb.vaciar('proveedores'); await idb.varios('proveedores', prov.data);
    await idb.vaciar('figuras');     await idb.varios('figuras', fig.data);
    await idb.vaciar('perfiles');    await idb.varios('perfiles', per.data);
    if (cfg.data) { await idb.vaciar('config'); await idb.guardar('config', cfg.data); }
    ultimoCompleto = Date.now();
    await meta('ultimo_completo', ultimoCompleto);
  }

  await idb.varios('pilas', pil.data);
  await idb.varios('lotes', lot.data);
  await idb.varios('eventos', eve.data);

  // Se cuadra con el servidor comparando ids. Va DESPUÉS de guardar lo
  // que acaba de llegar, o una fila recién creada se borraría por no
  // estar en una lista de ids que se pidió un instante antes.
  //
  // Lo que falta se va a buscar: puede haber una fila que el servidor
  // confirmó con una hora anterior a nuestra marca —la rendija— y que
  // por eso no vendría nunca. Antes esto se tapaba bajando el patio
  // entero cada diez minutos; ahora se baja solo esa fila.
  if (completo) {
    await traerPorId('lotes', await conciliar('lotes', idLotes.data));
    await traerPorId('pilas', await conciliar('pilas', idPilas.data));
  }
  // Los eventos no se podan nunca. Vaciarlos era lo que borraba cada diez
  // minutos toda la historia guardada y dejaba solo una ventana de días:
  // con eso, mirar el patio de la semana pasada salía mal, porque de la
  // mayoría de los lotes no quedaba ni un evento.

  // Si la columna todavía no existe (falta correr migracion.sql) la marca
  // queda vacía y todo sigue bajándose completo: más lento, nunca roto.
  await marcaYMaximo('lotes',   'actualizado_en', lot.data);
  await marcaYMaximo('pilas',   'actualizado_en', pil.data);
  await marcaYMaximo('eventos', 'registrado_en',  eve.data);

  // Un rechazo del servidor NO puede hacer desaparecer nada de la pantalla:
  // lo rechazado se vuelve a pintar, marcado, hasta que se resuelva.
  // Y como ya no se borra todo en cada vuelta, hay que quitar a mano la
  // marca de lo que se resolvió, o queda pegada para siempre.
  const destinoDe = (t) =>
    t === 'mapa_figuras' ? 'figuras' : t === 'mapa_config' ? 'config' : t;
  for (const { t, id } of marcados) {
    const f = await idb.uno(t, id);
    if (f?._rechazado) await idb.guardar(t, { ...f, _rechazado: false });
  }
  marcados = [];
  for (const op of await idb.todos('fallidos')) {
    if (op.modo === 'borrar') continue;
    const destino = destinoDe(op.tabla);
    if (!TIENDAS.includes(destino)) continue;
    await idb.guardar(destino, { ...op.fila, _rechazado: true });
    marcados.push({ t: destino, id: op.fila.id });
    if (op.tabla === 'eventos') await aplicarLocal(op.fila);
  }

  // Lo que sigue en cola se vuelve a aplicar encima: la pantalla nunca retrocede
  const cola = (await idb.todos('cola')).sort((a, b) => a.orden - b.orden);
  for (const op of cola) {
    if (op.modo === 'borrar') {
      await idb.borrar(op.tabla === 'mapa_figuras' ? 'figuras' : op.tabla, op.fila.id);
    } else if (op.tabla === 'eventos') {
      await idb.guardar('eventos', op.fila);
      await aplicarLocal(op.fila);
    } else if (op.tabla === 'mapa_figuras') {
      await idb.guardar('figuras', op.fila);
    } else if (op.tabla === 'mapa_config') {
      await idb.guardar('config', op.fila);
    } else if (op.modo === 'guardar' && (op.tabla === 'lotes' || op.tabla === 'pilas')) {
      const actual = await idb.uno(op.tabla, op.fila.id);
      // solo la geometría pendiente; el estado manda el servidor
      await idb.guardar(op.tabla, actual
        ? { ...actual, x: op.fila.x, y: op.fila.y, rx: op.fila.rx, ry: op.fila.ry, rot: op.fila.rot }
        : op.fila);
    } else {
      await idb.guardar(op.tabla, op.fila);
    }
  }
}

export async function subirImagenFondo(archivo) {
  const ext = (archivo.name.split('.').pop() || 'jpg').toLowerCase();
  const ruta = `fondo-${Date.now()}.${ext}`;
  const { error } = await sb.storage.from('mapa').upload(ruta, archivo, { upsert: true });
  if (error) throw new Error(error.message);
  const { data } = sb.storage.from('mapa').getPublicUrl(ruta);
  return data.publicUrl;
}

export async function salir() {
  await sb.auth.signOut();
  for (const t of TIENDAS) await idb.vaciar(t);
}
