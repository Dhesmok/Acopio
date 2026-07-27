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
    const req = indexedDB.open(DB, 3);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const t of TIENDAS)
        if (!d.objectStoreNames.contains(t)) d.createObjectStore(t, { keyPath: 'id' });
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
  return (await idb.todos('eventos'))
    .filter((e) => e.pila_id === pilaId && (e.tipo === 'ingreso_pila' || e.tipo === 'salida_pila'))
    .sort((a, b) => b.ocurrido_en.localeCompare(a.ocurrido_en));
}

export async function historial(loteId) {
  return (await idb.todos('eventos'))
    .filter((e) => e.lote_id === loteId)
    .sort((a, b) => b.ocurrido_en.localeCompare(a.ocurrido_en));
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
  const fila = {
    id: uuid(), codigo: cod, proveedor_id,
    placa: (placa || '').trim().toUpperCase(), fecha_recepcion: hoyLocal(),
    material: material || 'granel', forma: forma || 'elipse',
    puntos: null, x, y, rx: 46, ry: 34, rot: 0,
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
    + `Esta quedó como pila ${nuevo}. Los lotes que le metiste siguen dentro.`);
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
// silencio todo lo que la persona escribía. Se comprueba antes de bajar.
async function perfilVivo() {
  const { data: s } = await sb.auth.getSession();
  const uid = s?.session?.user?.id;
  if (!uid) return false;
  const { data, error } = await sb.from('perfiles').select('id').eq('id', uid).maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

async function bajar() {
  const r = await Promise.all([
    sb.from('proveedores').select('*').eq('activo', true),
    sb.from('pilas').select('*'),
    sb.from('lotes').select('*'),
    sb.from('eventos').select('*').order('ocurrido_en', { ascending: false }).limit(2000),
    sb.from('mapa_figuras').select('*'),
    sb.from('mapa_config').select('*').eq('id', 'unico').maybeSingle(),
    sb.from('perfiles').select('id, nombre, rol')
  ]);
  for (const x of r) if (x.error) throw new Error(x.error.message);
  const [prov, pil, lot, eve, fig, cfg, per] = r;

  await idb.vaciar('proveedores'); await idb.varios('proveedores', prov.data);
  await idb.vaciar('pilas');       await idb.varios('pilas', pil.data);
  await idb.vaciar('lotes');       await idb.varios('lotes', lot.data);
  await idb.vaciar('eventos');     await idb.varios('eventos', eve.data);
  await idb.vaciar('figuras');     await idb.varios('figuras', fig.data);
  await idb.vaciar('perfiles'); await idb.varios('perfiles', per.data);
  if (cfg.data) { await idb.vaciar('config'); await idb.guardar('config', cfg.data); }

  // Un rechazo del servidor NO puede hacer desaparecer nada de la pantalla:
  // lo rechazado se vuelve a pintar, marcado, hasta que se resuelva.
  const destinoDe = (t) =>
    t === 'mapa_figuras' ? 'figuras' : t === 'mapa_config' ? 'config' : t;
  for (const op of await idb.todos('fallidos')) {
    if (op.modo === 'borrar') continue;
    const destino = destinoDe(op.tabla);
    if (!TIENDAS.includes(destino)) continue;
    await idb.guardar(destino, { ...op.fila, _rechazado: true });
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
