// =====================================================================
//  IndexedDB de mentira, en memoria. Solo lo que store.js usa.
//  Respeta lo que importa: getAll devuelve en orden de clave, y los
//  índices existen (que es de donde salió más de un error real).
// =====================================================================
const pedirDespues = (fn) => {
  const req = { onsuccess: null, onerror: null, result: undefined, error: null };
  queueMicrotask(() => {
    try { req.result = fn(); req.onsuccess?.(); }
    catch (e) { req.error = e; req.onerror?.(); }
  });
  return req;
};

const ordenar = (m) => new Map([...m.entries()]
  .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));

class Indice {
  constructor(datos, campo) { this.datos = datos; this.campo = campo; }
  getAll(valor) {
    return pedirDespues(() => [...this.datos.values()]
      // IndexedDB no indexa las filas cuya clave es nula
      .filter((o) => o[this.campo] != null && String(o[this.campo]) === String(valor)));
  }
}

class Tienda {
  constructor(datos, indices) { this.datos = datos; this.indices = indices; }
  getAll() { return pedirDespues(() => [...this.datos.values()]); }
  get(id) { return pedirDespues(() => this.datos.get(id)); }
  put(o) { return pedirDespues(() => { this.datos.set(o.id, structuredClone(o)); return o.id; }); }
  delete(id) { return pedirDespues(() => { this.datos.delete(id); }); }
  clear() { return pedirDespues(() => { this.datos.clear(); }); }
  index(nombre) {
    if (!this.indices.has(nombre)) throw new Error(`no existe el índice ${nombre}`);
    return new Indice(this.datos, nombre);
  }
  get indexNames() { return { contains: (n) => this.indices.has(n) }; }
}

export function instalar() {
  const tiendas = new Map();
  const indices = new Map();          // nombre de tienda -> Set de índices

  const dameTienda = (n) => {
    const m = tiendas.get(n);
    const ord = ordenar(m);
    m.clear(); for (const [k, v] of ord) m.set(k, v);
    return new Tienda(m, indices.get(n));
  };

  const db = {
    objectStoreNames: { contains: (n) => tiendas.has(n) },
    createObjectStore: (n) => { tiendas.set(n, new Map()); indices.set(n, new Set()); return dameTienda(n); },
    transaction: () => ({ objectStore: dameTienda })
  };

  globalThis.indexedDB = {
    open: () => {
      const req = {
        onupgradeneeded: null, onsuccess: null, onerror: null, result: db,
        transaction: { objectStore: (n) => {
          const t = dameTienda(n);
          t.createIndex = (nombre, campo) => indices.get(n).add(campo || nombre);
          return t;
        } }
      };
      queueMicrotask(() => { req.onupgradeneeded?.(); req.onsuccess?.(); });
      return req;
    }
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
    randomUUID: () => 'u' + (instalar.n = (instalar.n || 0) + 1).toString().padStart(4, '0')
  } });
  return tiendas;
}
