// Comprobaciones y conteo, para que cada tanda no repita lo mismo.
let fallas = 0;

export const ok = (condicion, texto) => {
  console.log(`  ${condicion ? '·  ok ' : '· FALLA'}  ${texto}`);
  if (!condicion) fallas++;
};

export const titulo = (t) => console.log(`\n${t}`);

export const cerrar = () => {
  if (fallas) console.log(`\n${fallas} comprobación(es) fallaron\n`);
  process.exit(fallas ? 1 : 0);
};

// Reloj fijo, para probar lo que depende de la hora sin esperar a que sea
// de noche. Devuelve una función para devolver el reloj a su sitio.
export function congelarReloj(iso) {
  const Real = Date, fijo = Date.parse(iso);
  globalThis.Date = class extends Real {
    constructor(...a) { super(...(a.length ? a : [fijo])); }
    static now() { return fijo; }
  };
  return () => { globalThis.Date = Real; };
}
