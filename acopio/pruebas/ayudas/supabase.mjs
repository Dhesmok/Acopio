// Servidor de mentira: guarda filas por tabla y aplica las mismas reglas
// que importan aquí (código único en lotes y pilas, llave foránea de
// eventos) más los filtros que la app usa para bajar solo lo que cambió.
export const servidor = {
  tablas: { lotes: new Map(), pilas: new Map(), eventos: new Map(), perfiles: new Map(),
            proveedores: new Map(), mapa_figuras: new Map(), mapa_config: new Map() },
  reglas: {},          // tabla -> fn(fila) => error | null
  intentos: [],        // lo que se mandó, en orden
  bajado: []           // { tabla, filas } de cada consulta de lectura
};

// Quien está usando la app. Existe y está activo, como en la vida real.
// Para simular un perfil sin habilitar: servidor.tablas.perfiles.clear()
servidor.tablas.perfiles.set('yo', { id: 'yo', nombre: 'Yo', rol: 'admin' });

const err = (code, message) => ({ code, message });
const ahora = () => new Date().toISOString();

export const createClient = () => ({
  auth: {
    getSession: async () => ({ data: { session: { user: { id: 'yo' } } } }),
    signOut: async () => {}
  },
  from(tabla) {
    const filtros = [];
    let tope = null, orden = null, pedidas = '*';
    const api = {
      async upsert(fila) {
        servidor.intentos.push(`${tabla}:${fila.id}`);
        const e = servidor.reglas[tabla]?.(fila);
        if (e) return { error: e };
        if (tabla === 'eventos' && !servidor.tablas.lotes.has(fila.lote_id))
          return { error: err('23503', 'insert or update on table "eventos" violates foreign key constraint "eventos_lote_id_fkey"') };
        if (tabla === 'lotes' || tabla === 'pilas') {   // codigo es UNIQUE en las dos
          for (const [id, f] of servidor.tablas[tabla])
            if (String(f.codigo) === String(fila.codigo) && id !== fila.id)
              return { error: err('23505', `duplicate key value violates unique constraint "${tabla}_codigo_key"`) };
        }
        // el servidor pone la marca de cambio, como el trigger
        const marca = tabla === 'eventos' ? { registrado_en: ahora() } : { actualizado_en: ahora() };
        servidor.tablas[tabla].set(fila.id, { ...fila, ...marca });
        return { error: null };
      },
      delete: () => ({ eq: async () => ({ error: null }) }),
      // Se apunta QUÉ columnas se piden: pedir la lista de ids para
      // cuadrar no es lo mismo que bajarse las filas enteras, y las
      // pruebas de gasto necesitan poder distinguirlo.
      select(campos) { pedidas = campos || '*'; return api; },
      // Ordenar de verdad importa: la app baja los eventos MÁS RECIENTES
      // y luego va bajando hacia atrás de página en página. Con un order
      // que no ordenaba, esa paginación no se estaba probando.
      order(campo, op) { orden = { campo, asc: op?.ascending !== false }; return api; },
      limit(n) { tope = n; return api; },
      eq(campo, valor) { filtros.push((f) => String(f[campo]) === String(valor)); return api; },
      gt(campo, valor) { filtros.push((f) => (f[campo] || '') > valor); return api; },
      lte(campo, valor) { filtros.push((f) => (f[campo] || '') <= valor); return api; },
      in(campo, lista) { const s = new Set(lista.map(String));
                         filtros.push((f) => s.has(String(f[campo]))); return api; },
      resolver() {
        let filas = [...servidor.tablas[tabla].values()].filter((f) => filtros.every((p) => p(f)));
        if (orden) filas.sort((a, b) => {
          const x = String(a[orden.campo] ?? ''), y = String(b[orden.campo] ?? '');
          return (x < y ? -1 : x > y ? 1 : 0) * (orden.asc ? 1 : -1);
        });
        if (tope != null) filas = filas.slice(0, tope);
        // Se devuelven SOLO las columnas pedidas, como hace el servidor
        // de verdad: pedir `id` para cuadrar tiene que pesar lo que pesa.
        if (pedidas !== '*') {
          const cols = pedidas.split(',').map((c) => c.trim());
          filas = filas.map((f) => Object.fromEntries(cols.map((c) => [c, f[c]])));
        }
        servidor.bajado.push({ tabla, filas: filas.length, campos: pedidas,
                               bytes: JSON.stringify(filas).length });
        return filas;
      },
      async maybeSingle() {
        const f = api.resolver();
        return { data: f[0] || null, error: null };
      },
      then(res) { res({ data: api.resolver(), error: null }); }
    };
    return api;
  },
  storage: { from: () => ({}) }
});
