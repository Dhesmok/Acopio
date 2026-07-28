// =====================================================================
//  El mapa se dibuja metiendo texto en innerHTML. Un código de lote con
//  un "<" dejaba el plano entero sin dibujar, y para todos.
// =====================================================================
import { ok, titulo, cerrar } from './ayudas/decir.mjs';

globalThis.addEventListener = () => {};

const lienzo = {
  attrs: {}, innerHTML: '', isConnected: true, oyentes: {},
  getAttribute: (k) => lienzo.attrs[k],
  setAttribute: (k, v) => { lienzo.attrs[k] = v; },
  addEventListener(tipo, fn) { (lienzo.oyentes[tipo] ||= []).push(fn); },
  // un nodo de mentira que aguanta lo que mapa.js le hace al arrastrar
  querySelector: () => ({ setAttribute() {}, classList: { add() {}, remove() {} } }),
  querySelectorAll: () => [],
  setPointerCapture() {},
  getBoundingClientRect: () => ({ width: 1000, height: 700 }),
  // el plano y la pantalla coinciden uno a uno: así las cuentas de la
  // prueba se leen sin tener que deshacer una transformación
  createSVGPoint: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }),
  getScreenCTM: () => ({ inverse: () => null })
};
const disparar = (tipo, ev) => lienzo.oyentes[tipo]?.forEach((fn) => fn(ev));
// `manija` = el dedo cayó sobre una manija de ajuste;
// `figura`  = cayó sobre un lote o una pila del plano.
const evento = (x, y, { manija, figura } = {}) => ({
  pointerId: 1, clientX: x, clientY: y,
  target: {
    closest: (sel) => sel === '[data-handle]' ? (manija ? { dataset: { handle: manija } } : null)
           : sel === '[data-id]' ? (figura ? { dataset: figura, setAttribute() {} } : null)
           : null
  }
});

const Mapa = await import('../web/js/mapa.js');
Mapa.montar({ set innerHTML(_) {}, querySelector: () => lienzo }, {});

titulo('Un código o una etiqueta con caracteres raros no rompen el mapa.');

const veneno = 'AB<script>&"malo';
Mapa.pintar({
  config: { ancho: 1000, alto: 700, color_fondo: '#e4e7e2' },
  figuras: [{ id: 'f1', forma: 'rectangulo', x: 10, y: 10, rx: 50, ry: 50, rot: 0,
              color: '#c7cdc5', etiqueta: veneno }],
  pilas:   [{ id: 'p1', codigo: veneno, tipo: 'otro', estado: 'abierta',
              forma: 'elipse', x: 100, y: 100, rx: 90, ry: 60, rot: 0 }],
  lotes:   [{ id: 'l1', codigo: veneno, estado: 'por_muestrear', pila_id: null,
              forma: 'elipse', x: 200, y: 200, rx: 46, ry: 34, rot: 0 }]
});

const svg = lienzo.innerHTML;
ok(svg.length > 0, 'el mapa se dibujó');
ok(!svg.includes('<script'), 'no quedó ninguna etiqueta <script> suelta en el SVG');
ok(svg.includes('AB&lt;script&gt;&amp;&quot;malo'),
   'el texto peligroso salió escapado, y se sigue leyendo tal cual');

// Si las etiquetas no cierran bien, el navegador no dibuja nada
const balanceado = (s) => {
  const cuenta = (xs) => xs.reduce((a, x) => (a[x] = (a[x] || 0) + 1, a), {});
  const abre = cuenta([...s.matchAll(/<([a-zA-Z]+)(?:\s[^>]*?)?(?<!\/)>/g)].map((m) => m[1]));
  const cierra = cuenta([...s.matchAll(/<\/([a-zA-Z]+)>/g)].map((m) => m[1]));
  return Object.keys(cierra).every((k) => abre[k] === cierra[k]);
};
ok(balanceado(svg), 'las etiquetas del SVG quedaron balanceadas (el mapa no se parte)');

// El caso real que lo motivó: un número de lote con un "<" de más
lienzo.innerHTML = '';
Mapa.pintar({
  config: { ancho: 1000, alto: 700 }, figuras: [], pilas: [],
  lotes: [{ id: 'l2', codigo: 'PG12<5', estado: 'por_muestrear', pila_id: null,
            forma: 'elipse', x: 0, y: 0, rx: 46, ry: 34, rot: 0 }]
});
ok(lienzo.innerHTML.includes('PG12&lt;5'), 'un código tipo "PG12<5" se dibuja sin romper nada');

// ---------------------------------------------------------------------
titulo('Ajustar una forma se ve MIENTRAS se ajusta, no al soltar.');

const lote = { id: 'l1', codigo: 'PG1', estado: 'por_muestrear', pila_id: null,
               forma: 'elipse', x: 200, y: 200, rx: 46, ry: 34, rot: 0 };
Mapa.pintar({ config: { ancho: 1000, alto: 700 }, figuras: [], pilas: [], lotes: [lote] });
Mapa.editar(true);
Mapa.seleccionar('lote', lote.id);
ok(lienzo.innerHTML.includes('data-handle="tamano"'), 'al seleccionar aparecen las manijas');

// dedo abajo sobre la manija de tamaño, y arrastrar hasta 120 × 90
disparar('pointerdown', evento(lote.x + lote.rx, lote.y + lote.ry, { manija: 'tamano' }));
disparar('pointermove', evento(lote.x + 120, lote.y + 90));

ok(lote.rx === 120 && lote.ry === 90, `la figura se recalculó (${lote.rx} × ${lote.ry})`);
ok(lienzo.innerHTML.includes('rx="120"') && lienzo.innerHTML.includes('ry="90"'),
   'y el plano YA muestra el tamaño nuevo, con el dedo todavía abajo');

// lo que llegó de fuera durante el gesto no se pierde por repintar
const otro = { ...lote, id: 'l9', codigo: 'PG9', x: 500, y: 500 };
Mapa.pintar({ config: { ancho: 1000, alto: 700 }, figuras: [], pilas: [], lotes: [lote, otro] });
ok(!lienzo.innerHTML.includes('PG9'), 'un repintado de fuera espera a que termine el gesto');
disparar('pointerup', evento(lote.x + 120, lote.y + 90));
ok(lienzo.innerHTML.includes('PG9'), 'y entra en cuanto se suelta el dedo');

// ---------------------------------------------------------------------
titulo('Fuera de modo edición, arrastrar un lote NO lo mueve.');

const suelto = { id: 'l3', codigo: 'PG3', estado: 'por_muestrear', pila_id: null,
                 forma: 'elipse', x: 300, y: 300, rx: 46, ry: 34, rot: 0 };
let guardado = null, tocado = null;
Mapa.montar({ set innerHTML(_) {}, querySelector: () => lienzo }, {
  alGuardarGeom: (...a) => { guardado = a; },
  alTocar: (tipo, id) => { tocado = { tipo, id }; },
  alSeleccionar() {}, alTocarVacio() {}, puedeEditarFondo: () => true
});
Mapa.pintar({ config: { ancho: 1000, alto: 700 }, figuras: [], pilas: [], lotes: [suelto] });
Mapa.editar(false);

const dedoSobre = { tipo: 'lote', id: suelto.id };
disparar('pointerdown', evento(suelto.x, suelto.y, { figura: dedoSobre }));
disparar('pointermove', evento(suelto.x + 220, suelto.y + 160, { figura: dedoSobre }));
disparar('pointerup',   evento(suelto.x + 220, suelto.y + 160, { figura: dedoSobre }));

ok(suelto.x === 300 && suelto.y === 300, `el lote sigue donde estaba (${suelto.x}, ${suelto.y})`);
ok(guardado === null, 'no se pidió guardar ninguna geometría');
ok(tocado === null, 'y como el dedo se arrastró, tampoco se abrió la ficha');

// el mismo dedo, pero sin arrastrar: eso sí abre la ficha
disparar('pointerdown', evento(suelto.x, suelto.y, { figura: dedoSobre }));
disparar('pointerup',   evento(suelto.x, suelto.y, { figura: dedoSobre }));
ok(tocado?.id === suelto.id, 'un toque limpio abre la ficha del lote');
ok(suelto.x === 300 && suelto.y === 300, 'y sigue sin moverse');

// ---------------------------------------------------------------------
titulo('En modo edición sí se mueve, y avisa de dónde venía.');
Mapa.editar(true);
disparar('pointerdown', evento(suelto.x, suelto.y, { figura: dedoSobre }));
disparar('pointermove', evento(suelto.x + 220, suelto.y + 160, { figura: dedoSobre }));
disparar('pointerup',   evento(520, 460, { figura: dedoSobre }));

ok(suelto.x === 520 && suelto.y === 460, `ahora sí se movió (${suelto.x}, ${suelto.y})`);
ok(guardado !== null, 'se pidió guardar la geometría');
const [, , origen, antes] = guardado || [];
ok(origen?.x === 300 && origen?.y === 300, 'se informa de dónde venía, para el recorrido');
ok(antes?.x === 300 && antes?.y === 300, 'y se guarda una instantánea para poder cancelar');

// cancelar devuelve la figura a su sitio
Mapa.deshacerGeom('lote', suelto.id, antes);
ok(suelto.x === 300 && suelto.y === 300, 'cancelar lo devuelve exactamente a donde estaba');

cerrar();
