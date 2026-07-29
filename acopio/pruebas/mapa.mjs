// =====================================================================
//  El mapa se dibuja metiendo texto en innerHTML. Un código de lote con
//  un "<" dejaba el plano entero sin dibujar, y para todos.
// =====================================================================
import { ok, titulo, cerrar } from './ayudas/decir.mjs';

globalThis.addEventListener = () => {};
// El vuelo hasta una figura buscada usa los cuadros del navegador. Aquí
// no hay pantalla que pintar: el reloj corre de una y el vuelo termina
// en el acto, que es justo lo que las pruebas necesitan comprobar.
globalThis.requestAnimationFrame = (fn) => { fn(performance.now() + 1e4); return 1; };
globalThis.cancelAnimationFrame = () => {};
globalThis.matchMedia = () => ({ matches: false });

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

// ---------------------------------------------------------------------
titulo('El rótulo se ajusta a su figura, no al revés.');

const conCodigo = (codigo, rx = 46, ry = 34) =>
  ({ id: 'lx' + codigo, codigo, estado: 'muestreado', pila_id: null,
     forma: 'elipse', x: 400, y: 400, rx, ry, rot: 0 });
// tamaño del rótulo de una figura, leído del SVG que sale de pintar()
const tamRotulo = (figura, texto) => {
  Mapa.pintar({ config: { ancho: 1000, alto: 700 }, figuras: [], pilas: [],
                lotes: [], ...figura });
  const m = lienzo.innerHTML.match(
    new RegExp(`font-size="([\\d.]+)"[^>]*>${texto.replace(/[.*+?^${}()|[\\]\\\\-]/g, '\\\\$&')}<`));
  return m ? +m[1] : null;
};

const corto = tamRotulo({ lotes: [conCodigo('PG1')] }, 'PG1');
const largo = tamRotulo({ lotes: [conCodigo('SJ1015.2')] }, 'SJ1015.2');
const larguisimo = tamRotulo({ lotes: [conCodigo('ABG-2026-000117')] }, 'ABG-2026-000117');
ok(corto > largo && largo > larguisimo,
   `a más caracteres, menos tamaño (${corto} > ${largo} > ${larguisimo})`);
// el `largo > 0` no sobra: sin la corrección no hay `font-size` en el
// SVG, `largo` vale null y la comparación pasaba sola sin probar nada
ok(largo > 0 && largo * 0.6 * 'SJ1015.2'.length <= 46 * 2,
   'un código de ocho caracteres cabe en el ancho de su óvalo');
ok(larguisimo >= 11,
   `y uno absurdamente largo se planta en el suelo legible, no se hace invisible (${larguisimo})`);

// La misma figura, más grande, admite el rótulo más grande. Se usa un
// código largo a propósito: uno corto llega al tope de 20 px en las dos
// —el tope existe para que un código de tres letras no acabe siendo un
// titular dentro de su óvalo— y la prueba no compararía nada.
const chica = tamRotulo({ lotes: [conCodigo('ABG-2026-000117', 30, 22)] }, 'ABG-2026-000117');
const grande = tamRotulo({ lotes: [conCodigo('ABG-2026-000117', 120, 90)] }, 'ABG-2026-000117');
ok(grande > chica, `una figura más grande lleva el rótulo más grande (${grande} > ${chica})`);

const caseta = tamRotulo({ figuras: [{ id: 'f1', forma: 'rectangulo', etiqueta: 'CASETA',
  x: 300, y: 300, rx: 180, ry: 110, rot: 0, color: '#ccc' }] }, 'CASETA');
ok(caseta > 25, `la etiqueta de una caseta grande la llena, no se queda en 13px (${caseta})`);

// el rótulo de un polígono va en el centro de sus vértices, no en el
// origen: al arrastrarlos, el origen deja de estar dentro de la figura
Mapa.pintar({ config: { ancho: 1000, alto: 700 }, figuras: [], lotes: [], pilas: [
  { id: 'pz', codigo: 'SAN JUDAS', tipo: 'otro', estado: 'abierta', forma: 'poligono',
    x: 300, y: 300, rx: 150, ry: 110, rot: 0,
    puntos: [{ x: -120, y: 60 }, { x: -80, y: -90 }, { x: 60, y: -120 },
             { x: 120, y: 40 }, { x: 0, y: 110 }] }] });
const anclaX = +lienzo.innerHTML.match(/<text x="([-\d.]+)"[^>]*class="txt-pila"/)[1];
ok(Math.abs(anclaX - (-4)) < 0.5, `se ancla en el centro de los vértices, x=${anclaX} (no en 0)`);

// ---------------------------------------------------------------------
titulo('Buscar un lote lleva el plano hasta él y lo señala.');

const perdido = { id: 'lp', codigo: 'PG1042', estado: 'muestreado', pila_id: null,
                  forma: 'elipse', x: 860, y: 600, rx: 46, ry: 34, rot: 0 };
const plano = { config: { ancho: 1000, alto: 700 }, figuras: [], pilas: [], lotes: [
  perdido, { id: 'lo', codigo: 'PG7', estado: 'muestreado', pila_id: null,
             forma: 'elipse', x: 60, y: 60, rx: 46, ry: 34, rot: 0 }] };

Mapa.pintar(plano);
Mapa.encuadrar();
const todo = Mapa.obtenerVista();
Mapa.enfocar([perdido]);
const cerca = Mapa.obtenerVista();

ok(cerca.w < todo.w, `el plano se acercó (${Math.round(cerca.w)} de ancho, antes ${Math.round(todo.w)})`);
ok(cerca.x < perdido.x && perdido.x < cerca.x + cerca.w &&
   cerca.y < perdido.y && perdido.y < cerca.y + cerca.h,
   'y el lote quedó dentro del encuadre');
const centroX = cerca.x + cerca.w / 2, centroY = cerca.y + cerca.h / 2;
ok(Math.abs(centroX - perdido.x) < 1 && Math.abs(centroY - perdido.y) < 1,
   `centrado en el lote (${Math.round(centroX)}, ${Math.round(centroY)})`);
// Un óvalo de 46 × 34 llenando la pantalla no dice dónde está: hace
// falta ver patio alrededor para reconocer el sitio.
ok(cerca.w >= 320, `queda patio alrededor, no solo el lote (${Math.round(cerca.w)} de ancho)`);

// dos lotes: el encuadre tiene que abarcar a los dos
Mapa.enfocar(plano.lotes);
const ambos = Mapa.obtenerVista();
ok(ambos.x < 60 && ambos.x + ambos.w > 860, 'con dos resultados, el encuadre abarca a los dos');

// el dedo manda: tocar el plano corta el vuelo en curso
Mapa.enfocar([perdido]);
disparar('pointerdown', evento(500, 350));
disparar('pointerup', evento(500, 350));
ok(true, 'tocar el plano durante el vuelo no lanza ningún error');

// --- la señal sobre la figura encontrada ---
Mapa.pintar({ ...plano, resaltado: perdido.id });
const conAro = lienzo.innerHTML;
ok(conAro.includes('halo-hallazgo'), 'la figura buscada lleva su aro de señal');
ok((conAro.match(/halo-hallazgo/g) || []).length === 1,
   'y solo ella: las demás quedan como estaban');
ok(conAro.includes('g-resaltado'), 'el grupo queda marcado para el estilo');

// el aro NO puede tocar el color ni el borde: dicen el estado y el vencido
Mapa.pintar(plano);
const sinAro = lienzo.innerHTML;
const cuerpoDe = (html) => html.match(/<ellipse rx="46" ry="34" fill="([^"]+)" stroke="([^"]+)"/);
ok(String(cuerpoDe(conAro)) === String(cuerpoDe(sinAro)),
   'el lote resaltado conserva su color y su borde de siempre');
ok(!sinAro.includes('halo-hallazgo'), 'al quitar el resaltado, el aro desaparece');

cerrar();
