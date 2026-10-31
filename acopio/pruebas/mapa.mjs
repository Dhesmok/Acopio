// =====================================================================
//  El mapa se dibuja metiendo texto en innerHTML. Un código de lote con
//  un "<" dejaba el plano entero sin dibujar, y para todos.
// =====================================================================
import { readFile } from 'node:fs/promises';
import { ok, titulo, cerrar } from './ayudas/decir.mjs';

globalThis.addEventListener = () => {};
// El vuelo hasta una figura buscada usa los cuadros del navegador. Aquí
// no hay pantalla que pintar: el reloj corre de una y el vuelo termina
// en el acto, que es justo lo que las pruebas necesitan comprobar.
globalThis.requestAnimationFrame = (fn) => { fn(performance.now() + 1e4); return 1; };
globalThis.cancelAnimationFrame = () => {};
globalThis.matchMedia = () => ({ matches: false });

const nodoFalso = () => ({ setAttribute() {}, remove() {}, classList: { add() {}, remove() {} } });

const lienzo = {
  attrs: {}, innerHTML: '', isConnected: true, oyentes: {},
  // el lienzo se marca mientras el plano se mueve, para apagar los códigos
  clases: new Set(),
  get classList() {
    return { add: (c) => lienzo.clases.add(c), remove: (c) => lienzo.clases.delete(c),
             contains: (c) => lienzo.clases.has(c) };
  },
  getAttribute: (k) => lienzo.attrs[k],
  setAttribute: (k, v) => { lienzo.attrs[k] = v; },
  addEventListener(tipo, fn) { (lienzo.oyentes[tipo] ||= []).push(fn); },
  // nodos de mentira que aguantan lo que mapa.js les hace al arrastrar.
  // Son varios a propósito: un lote se dibuja en dos capas —contorno y
  // relleno— y arrastrarlo tiene que mover las dos.
  querySelector: () => nodoFalso(),
  querySelectorAll: () => [nodoFalso(), nodoFalso()],
  setPointerCapture() {},
  // como la del navegador: además del tamaño, dónde empieza en pantalla
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 700 }),
};

// El plano y la pantalla coinciden uno a uno mientras el encuadre sea
// EXACTAMENTE la caja del lienzo: así las cuentas de las pruebas de
// gestos se leen sin deshacer ninguna transformación. Antes esto se
// fingía desde el falso getScreenCTM del lienzo; ahora mapa.js hace la
// cuenta de verdad, así que hay que dársela de verdad.
const unoAUno = () => Mapa.fijarVista({ x: 0, y: 0, w: 1000, h: 700 });
const disparar = (tipo, ev) => lienzo.oyentes[tipo]?.forEach((fn) => fn(ev));
// un dedo concreto, para los gestos de dos
const dedo = (id, x, y) => ({ ...evento(x, y), pointerId: id });
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
// Aquí no hay navegador, así que varias cosas se comprueban LEYENDO el
// código de la app. Se lee una vez, al principio.
const fuenteApp = await readFile(new URL('../web/js/app.js', import.meta.url), 'utf8');
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
unoAUno();
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
unoAUno();
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
unoAUno();
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
titulo('Fuera de modo edición, MANTENER presionado un lote lo levanta y se mueve.');

// El reloj de la espera se controla a mano: setTimeout se reemplaza por
// uno que guarda la función y la corre cuando la prueba lo dice.
let relojes = [];
const setTimeoutReal = globalThis.setTimeout, clearTimeoutReal = globalThis.clearTimeout;
globalThis.setTimeout = (fn, ms) => { relojes.push({ fn, ms }); return relojes.length; };
globalThis.clearTimeout = (id) => { if (relojes[id - 1]) relojes[id - 1].fn = null; };
const pasarElTiempo = () => { const r = relojes; relojes = []; r.forEach((x) => x.fn?.()); };

let puedeMover = true;
lienzo.insertAdjacentHTML = () => {};
Mapa.montar({ set innerHTML(_) {}, querySelector: () => lienzo }, {
  alGuardarGeom: (...a) => { guardado = a; },
  alTocar: (tipo, id) => { tocado = { tipo, id }; },
  alSeleccionar() {}, alTocarVacio() {}, puedeEditarFondo: () => true,
  puedeMover: () => puedeMover
});
unoAUno();
Mapa.pintar({ config: { ancho: 1000, alto: 700 }, figuras: [], pilas: [], lotes: [suelto] });
Mapa.editar(false);
guardado = null; tocado = null;

ok(Mapa.MANTENER_MS >= 1000 && Mapa.MANTENER_MS <= 1500,
   `hay que mantenerlo un rato, pero sin hacer esperar (${Mapa.MANTENER_MS} ms)`);
ok(!!lienzo.oyentes.contextmenu?.length, 'mantener presionado el plano no abre el menú del navegador');
let prevenido = false;
lienzo.oyentes.contextmenu?.forEach((fn) => fn({ preventDefault: () => { prevenido = true; } }));
ok(prevenido, 'el menú de la imagen de fondo se cancela');
const cssMapa = await readFile(new URL('../web/styles.css', import.meta.url), 'utf8');
ok(/#lienzo, #lienzo \* \{ -webkit-touch-callout: none;/.test(cssMapa), 'ni el menú largo de iPhone');

// mantener sin esperar lo suficiente y moverse = paneo de siempre
disparar('pointerdown', evento(suelto.x, suelto.y, { figura: dedoSobre }));
ok(relojes.some((r) => r.ms === Mapa.MANTENER_MS), 'al apoyar el dedo sobre un lote empieza la espera');
disparar('pointermove', evento(suelto.x + 120, suelto.y, { figura: dedoSobre }));
pasarElTiempo();
disparar('pointermove', evento(suelto.x + 220, suelto.y + 160, { figura: dedoSobre }));
disparar('pointerup',   evento(suelto.x + 220, suelto.y + 160, { figura: dedoSobre }));
ok(suelto.x === 300 && suelto.y === 300, 'si el dedo se movió antes de tiempo, el lote no se levanta');
ok(guardado === null, 'y no se pidió guardar nada');

// ahora sí: quieto hasta que se cumple el tiempo, y después arrastrar
unoAUno();
disparar('pointerdown', evento(suelto.x, suelto.y, { figura: dedoSobre }));
disparar('pointermove', evento(suelto.x + 2, suelto.y + 1, { figura: dedoSobre }));
pasarElTiempo();
disparar('pointermove', evento(suelto.x + 150, suelto.y + 100, { figura: dedoSobre }));
disparar('pointerup',   evento(452, 401, { figura: dedoSobre }));
ok(suelto.x !== 300 || suelto.y !== 300, `mantenido el tiempo, el lote se movió (${suelto.x}, ${suelto.y})`);
ok(guardado?.[2]?.x === 300 && guardado?.[2]?.y === 300,
   'y se pide guardarlo informando de dónde venía (la app pregunta "¿Dejar aquí?")');
ok(tocado === null, 'sin abrir la ficha por el camino');
Mapa.deshacerGeom('lote', suelto.id, guardado?.[3]);

// quien solo mira no levanta nada
puedeMover = false; guardado = null;
unoAUno();
disparar('pointerdown', evento(suelto.x, suelto.y, { figura: dedoSobre }));
ok(!relojes.some((r) => r.ms === Mapa.MANTENER_MS && r.fn), 'para quien no puede mover, ni siquiera empieza la espera');
disparar('pointerup', evento(suelto.x, suelto.y, { figura: dedoSobre }));
puedeMover = true;
globalThis.setTimeout = setTimeoutReal; globalThis.clearTimeout = clearTimeoutReal;
ok(/puedeMover: \(\) => !soloLectura\(\)/.test(fuenteApp),
   'en la app, la empresa (solo lectura) no mueve lotes');

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
const largo = tamRotulo({ lotes: [conCodigo('SJ1015-B')] }, 'SJ1015-B');
const larguisimo = tamRotulo({ lotes: [conCodigo('ABG-2026-000117')] }, 'ABG-2026-000117');
ok(corto > largo && largo > larguisimo,
   `a más caracteres, menos tamaño (${corto} > ${largo} > ${larguisimo})`);
// el `largo > 0` no sobra: sin la corrección no hay `font-size` en el
// SVG, `largo` vale null y la comparación pasaba sola sin probar nada
ok(largo > 0 && largo * 0.6 * 'SJ1015-B'.length <= 46 * 2,
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

// el nombre de un polígono va en el centro de sus vértices, no en el
// origen: al arrastrarlos, el origen deja de estar dentro de la figura
Mapa.pintar({ config: { ancho: 1000, alto: 700 }, figuras: [], lotes: [], pilas: [
  { id: 'pz', codigo: 'SAN JUDAS', tipo: 'otro', estado: 'abierta', forma: 'poligono',
    x: 300, y: 300, rx: 150, ry: 110, rot: 0,
    puntos: [{ x: -120, y: 60 }, { x: -80, y: -90 }, { x: 60, y: -120 },
             { x: 120, y: 40 }, { x: 0, y: 110 }] }] });
const anclaX = +(lienzo.innerHTML.match(/<text x="([-\d.]+)"[^>]*class="txt-pila"/) || [])[1];
ok(Math.abs(anclaX - (-4)) < 0.5, `se ancla en el centro de los vértices, x=${anclaX} (no en 0)`);
const textoPila = (lienzo.innerHTML.match(/<text[^>]*class="txt-pila"[^>]*>([\s\S]*?)<\/text>/) || [])[1] || '';
const renglones = [...textoPila.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((m) => m[1]);
const leido = renglones.length ? renglones.join(' ') : textoPila;
ok(leido === 'PILA SAN JUDAS', `y lleva solo el nombre de la pila (${leido})`);

// Un nombre largo no va en una sola línea que se sale del montón: se
// parte en dos o tres renglones si así la letra queda más grande.
Mapa.pintar({ config: { ancho: 1000, alto: 700 }, figuras: [], lotes: [], pilas: [
  { id: 'pl', codigo: '1 (ARENAS FINAS)', tipo: 'otro', estado: 'abierta', forma: 'elipse',
    x: 300, y: 300, rx: 110, ry: 70, rot: 0 }] });
const largoPila = (lienzo.innerHTML.match(/<text[^>]*class="txt-pila"[^>]*>([\s\S]*?)<\/text>/) || [])[1] || '';
const filas = [...largoPila.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((m) => m[1]);
ok(filas.length >= 2 && filas.length <= 3, `un nombre largo va en ${filas.length} renglones: ${filas.join(' / ')}`);
ok(filas.join(' ') === 'PILA 1 (ARENAS FINAS)', 'sin perder ni cambiar ninguna palabra');
ok(filas.includes('(ARENAS FINAS)'), 'y lo que va entre paréntesis no se parte');
ok(!/\d+ lotes?</.test(lienzo.innerHTML), 'sin la cantidad de lotes: eso se ve al entrar a la pila');

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

// ---------------------------------------------------------------------
titulo('Dos lotes que se tocan se ven como un solo montón de material.');

const pegados = [
  { id: 'la', codigo: 'PG1', estado: 'muestreado', pila_id: null,
    forma: 'elipse', x: 300, y: 300, rx: 46, ry: 34, rot: 0 },
  { id: 'lb', codigo: 'PG2', estado: 'muestreado', pila_id: null,
    forma: 'elipse', x: 360, y: 300, rx: 46, ry: 34, rot: 0 }
];
Mapa.pintar({ config: { ancho: 1000, alto: 700 }, figuras: [], pilas: [], lotes: pegados });
const dibujo = lienzo.innerHTML;

// El borrado de la línea sale del ORDEN: si todos los contornos van antes
// que todos los rellenos, el relleno de un lote tapa el trazo del vecino
// y en el cruce no queda raya negra.
// El filo negro va en la capa de abajo (la que lleva class="forma"); el
// montón, en la de arriba, recortado a su contorno (clip-path).
const ultimoTrazo = dibujo.lastIndexOf('class="forma"');
const primerRelleno = dibujo.indexOf('clip-path="url(#');
ok(primerRelleno > 0 && ultimoTrazo < primerRelleno,
   'los rellenos van todos después de los contornos, no lote por lote');
ok(/class="forma"[^>]*stroke-width="5"/.test(dibujo),
   'el contorno se dibuja al doble: su propio relleno le come la mitad de adentro');
ok((dibujo.match(/data-id="la"/g) || []).length === 3,
   'cada lote sale en las tres capas, y las tres responden al dedo');
ok((dibujo.match(/>PG1</g) || []).length === 1,
   'pero el código se escribe una sola vez');

// El rótulo tapado era el otro lado del mismo problema: con el código
// dentro de su lote, el relleno del vecino se comía media palabra.
const ultimoRelleno = dibujo.lastIndexOf('clip-path="url(#');
const primerRotulo = dibujo.indexOf('class="txt-lote"');
ok(primerRotulo > 0 && ultimoRelleno < primerRotulo,
   'y va después de TODOS los rellenos: ningún vecino puede taparlo');

// El filtro atenúa con opacidad, y la opacidad tiene que aplicarse UNA
// vez al par de capas: puesta en cada lote se aplicaría dos veces y el
// apagado se quedaría a medio camino.
Mapa.pintar({ config: { ancho: 1000, alto: 700 }, figuras: [], pilas: [],
              lotes: pegados, destacados: new Set(['lb']) });
const filtrado = lienzo.innerHTML;
ok(!/class="g-lote[^"]*atenuado/.test(filtrado),
   'el apagado del filtro no va lote por lote');
ok((filtrado.match(/class="atenuado"/g) || []).length === 1,
   'sino en un solo grupo que envuelve las dos capas de los apagados');

// ---------------------------------------------------------------------
titulo('El plano no dibuja ninguna capa con máscara.');

// Hubo una versión que pasaba los cercos de las pilas y los contornos de
// los lotes por una MÁSCARA, para que un lote encima de una pila se
// fundiera con ella y dos pilas se leyeran como un mismo cerco.
//
// En un teléfono de verdad esa capa se quedaba en blanco de vez en
// cuando durante el pellizco. Las capturas del patio lo mostraron
// clavado: un cuadro con contornos y cercos, el siguiente sin NINGUNO de
// los dos, varias veces por segundo. Y esas dos cosas —los contornos y
// los cercos— eran exactamente lo que vivía dentro de la máscara.
//
// Aquí no se reproducía porque este navegador dibuja por software. La
// prueba está para que no vuelva a entrar sin probarlo en un teléfono.
const dosPilas = [
  { id: 'pa', codigo: 'A', tipo: 'otro', estado: 'abierta',
    forma: 'elipse', x: 300, y: 300, rx: 90, ry: 60, rot: 0 },
  { id: 'pb', codigo: 'B', tipo: 'otro', estado: 'abierta',
    forma: 'elipse', x: 420, y: 300, rx: 90, ry: 60, rot: 0 }
];
Mapa.pintar({ config: { ancho: 1000, alto: 700 }, figuras: [], pilas: dosPilas,
              lotes: [{ id: 'lx', codigo: 'PG1', estado: 'muestreado', pila_id: null,
                        forma: 'elipse', x: 320, y: 300, rx: 60, ry: 45, rot: 0 }] });
const conPilas = lienzo.innerHTML;
ok(!conPilas.includes('<mask'), 'no se declara ninguna máscara');
ok(!conPilas.includes('mask="url('), 'y ninguna capa la usa');

// Lo importante NO se pierde: los lotes se siguen fundiendo entre ellos,
// que se hace con el orden de las capas y no necesita máscara.
const desdeLotes = conPilas.indexOf('data-tipo="lote"');
const trazos = conPilas.lastIndexOf('class="forma"');
const rellenos = conPilas.indexOf('clip-path="url(#', desdeLotes);
ok(desdeLotes > 0 && trazos < rellenos, 'los rellenos siguen yendo después de los contornos');

// Y cada pila lleva su propio borde, dentro de su grupo, no en una capa aparte
ok((conPilas.match(/data-tipo="pila"[^>]*>[\s\S]*?class="forma"/g) || []).length === 2,
   'cada pila dibuja su propio borde');

// ---------------------------------------------------------------------
titulo('La manija de ajuste no mengua con la figura.');

// Achicar un lote achicaba también la manija con la que se estaba
// achicando: justo cuando más falta hace agarrar bien, se escapaba.
const medirManija = (rx, ry) => {
  const f = { id: 'lm', codigo: 'PG5', estado: 'muestreado', pila_id: null,
              forma: 'elipse', x: 500, y: 350, rx, ry, rot: 0 };
  Mapa.pintar({ config: { ancho: 1000, alto: 700 }, figuras: [], pilas: [], lotes: [f] });
  Mapa.fijarVista({ x: 0, y: 0, w: 1000, h: 700 });
  Mapa.editar(true);
  Mapa.seleccionar('lote', f.id);
  return +lienzo.innerHTML.match(/r="([\d.]+)" class="manija"/)[1];
};
const enGrande = medirManija(120, 90);
const enChico = medirManija(18, 14);
ok(enGrande === enChico,
   `mide lo mismo en un lote grande y en uno diminuto (${enGrande} = ${enChico})`);
ok(lienzo.innerHTML.includes('class="manija-zona"'),
   'y lleva detrás un disco invisible más ancho, para que el dedo no tenga que apuntar');

// ---------------------------------------------------------------------
titulo('Un repintado que no cambia nada no toca el plano.');

// La app se sincroniza cada 20 segundos y casi siempre no cambió nada.
// Rearmar el SVG entero por eso es el parpadeo: cientos de figuras
// destruidas y vueltas a crear, y encima esperando a que se levante el
// dedo si estaba arrastrando.
const mismos = { config: { ancho: 1000, alto: 700 }, figuras: [], pilas: [],
  lotes: [{ id: 'lq', codigo: 'PG1', estado: 'muestreado', pila_id: null,
            forma: 'elipse', x: 300, y: 300, rx: 46, ry: 34, rot: 0 }] };
Mapa.editar(false);
Mapa.limpiarSeleccion();
Mapa.pintar(mismos);
lienzo.innerHTML = 'NO SE TOCÓ';
Mapa.pintar({ ...mismos, lotes: [{ ...mismos.lotes[0] }] });   // datos nuevos, dibujo igual
ok(lienzo.innerHTML === 'NO SE TOCÓ', 'con el mismo plano no se vuelve a escribir el SVG');

Mapa.pintar({ ...mismos, lotes: [{ ...mismos.lotes[0], estado: 'devolucion' }] });
ok(lienzo.innerHTML !== 'NO SE TOCÓ', 'pero un cambio de verdad sí entra');

// Al montar, el lienzo es OTRO y está en blanco: aunque toque dibujar lo
// mismo que había, hay que volver a escribirlo o el mapa sale vacío.
Mapa.montar({ set innerHTML(_) {}, querySelector: () => lienzo }, {});
lienzo.innerHTML = '';
Mapa.pintar({ ...mismos, lotes: [{ ...mismos.lotes[0], estado: 'devolucion' }] });
ok(lienzo.innerHTML.includes('PG1'), 'y al remontar se dibuja igual, aunque el plano no haya cambiado');

// ---------------------------------------------------------------------
titulo('El número de volqueta se separa del código.');

// Un mismo lote llega en varias volquetas y el código no se puede
// repetir, así que en el patio se apunta pegado: ABG40(2), ABG40.2 y
// ABG40-2 son los tres la segunda volqueta del lote ABG40.
const parte = (c) => `${Mapa.partesCodigo(c).base}|${Mapa.partesCodigo(c).volqueta}`;
ok(parte('ABG40(2)') === 'ABG40|2', 'ABG40(2) es el lote ABG40, volqueta 2');
ok(parte('ABG40.2') === 'ABG40|2', 'ABG40.2 también');
ok(parte('SJ1015.3') === 'SJ1015|3', 'y SJ1015.3, que es la forma que más se usa');
ok(parte('ABG40(12)') === 'ABG40|12', 'el número puede tener dos cifras');
// El guion, porque en algunos teléfonos el punto y los paréntesis casi
// no se ven y desde el patio se acaba escribiendo la raya.
ok(parte('ABG40-2') === 'ABG40|2', 'ABG40-2 es la volqueta 2 igual que ABG40.2');
ok(parte('SJ1015-3') === 'SJ1015|3', 'y SJ1015-3');
ok(parte('ABG40-12') === 'ABG40|12', 'con el guion el número también puede tener dos cifras');
// El guion es el único que también se usa DENTRO del código, entre el
// proveedor y el lote. El de la volqueta es el que va al final.
ok(parte('ABG-1004-2') === 'ABG-1004|2', 'ABG-1004-2 es el viaje 2 del lote ABG-1004');
ok(parte('PG-70-11') === 'PG-70|11', 'y con el lote de dos cifras y el viaje de dos, igual');

// Lo que NO se toca, que es lo que evita estropear códigos de verdad
ok(parte('PG1042') === 'PG1042|', 'un código normal se queda entero');
ok(parte('PG213()') === 'PG213()|', 'un paréntesis vacío se deja tal cual: no sabemos qué quiso decir');
ok(parte('ABG-2026-000117') === 'ABG-2026-000117|', 'un código con guiones y ceros no es una volqueta');
// Delante del guion tiene que haber un código de lote ENTERO, que
// siempre acaba en el número del lote; y detrás, un número de viaje: una
// o dos cifras y sin ceros delante, que es como se traen los lotes.
ok(parte('ABG-2026') === 'ABG-2026|', 'ABG-2026 es un código, no la volqueta 2026');
ok(parte('ABG-26') === 'ABG-26|', 'ni ABG-26 la volqueta 26: "ABG" a secas no es un lote');
ok(parte('SJ1015-03') === 'SJ1015-03|', 'un cero delante no es un número de viaje');
ok(parte('SJ1015-B') === 'SJ1015-B|', 'después del guion tiene que haber un número');
ok(parte('SJ1015.B') === 'SJ1015.B|', 'después del punto tiene que haber un número');
ok(parte('') === '|', 'y un código vacío no revienta');

// El formulario de nuevo lote ya no tiene casilla de viaje: arma la
// sigla y el número, y eso se dibuja entero, sin nada que elevar. Los
// lotes viejos que sí llevan viaje se siguen partiendo como arriba.
const armaCodigo = new Function('num', `
  const $ = () => ({ value: num });
  ${(() => {
    const a = fuenteApp.indexOf('const codigoDe =');
    const b = fuenteApp.indexOf('const rotular =', a);
    return fuenteApp.slice(a, b);
  })()}
  const sigla = () => 'PG';
  return codigoDe();
`);
ok(parte(armaCodigo('1004')) === 'PG1004|', 'el código que arma el formulario no lleva viaje');

// En el plano, el código va entero y el número pequeño encima
Mapa.pintar({ config: { ancho: 1000, alto: 700 }, figuras: [], pilas: [],
  lotes: [{ id: 'lv', codigo: 'ABG40.2', estado: 'muestreado', pila_id: null,
            forma: 'elipse', x: 300, y: 300, rx: 60, ry: 45, rot: 0 }] });
const conVolqueta = lienzo.innerHTML;
ok(!conVolqueta.includes('>ABG40.2<'), 'en el óvalo ya no se escribe "ABG40.2" de corrido');
ok(/>ABG40<tspan[^>]*>2<\/tspan>/.test(conVolqueta),
   'sino "ABG40" con el 2 en un tspan más pequeño y levantado');

// ---------------------------------------------------------------------
titulo('Una devolución sin recoger se pinta negra, no con borde rojo.');

// Un borde hay que buscarlo; en un patio de ciento y pico lotes de
// colores parecidos, el negro salta a la vista desde el otro lado.
const negro = (fecha, estado) => {
  Mapa.pintar({ config: { ancho: 1000, alto: 700 }, figuras: [], pilas: [],
    lotes: [{ id: 'lz', codigo: 'PG9', estado, pila_id: null, forma: 'elipse',
              x: 300, y: 300, rx: 46, ry: 34, rot: 0, fecha_recogida: fecha }] });
  return lienzo.innerHTML;
};
const vencido = negro('2020-01-01', 'devolucion');
ok(vencido.includes('fill="#14171a"'), 'el lote sin recoger se rellena de negro');
ok(!vencido.includes('stroke-dasharray="8 5"'), 'y se va el borde rojo a rayas');
ok(!vencido.includes('stroke-width="10"'), 'y el borde vuelve al grosor de siempre');
const pintadoBlanco = (html) => /<text[^>]*class="txt-lote"[^>]*fill="#fdfbf7"[^>]*stroke="#14171a"[^>]*paint-order="stroke"/.test(html);
ok(pintadoBlanco(vencido), 'el código va pintado en blanco con filo negro, que sobre negro se lee');

const aTiempo = negro('2099-01-01', 'devolucion');
ok(!aTiempo.includes('fill="#14171a" stroke'), 'una devolución en plazo conserva su color');
const otroEstado = negro('2020-01-01', 'muestreado');
ok(!otroEstado.includes('fill="#14171a" stroke'),
   'y una fecha vieja en un lote que ya no es devolución no pinta nada');

// ---------------------------------------------------------------------
titulo('Los controles del mapa siguen flotando sobre el plano.');

// Esta prueba mira el CSS a pelo, y no es por gusto: la capa de controles
// se quedó sin `position: absolute` al reescribir la regla de al lado
// —la que quita las zonas muertas— y los botones se fueron al flujo,
// debajo del lienzo, con cero de alto y fuera de la pantalla. La app
// quedó sin "Nuevo lote", sin buscar, sin filtrar y sin zoom, y ninguna
// prueba se enteró porque aquí no hay navegador que dibuje.
const css = await readFile(new URL('../web/styles.css', import.meta.url), 'utf8');
const bloque = css.slice(css.indexOf('.mapa-controles {'),
                         css.indexOf('}', css.indexOf('.mapa-controles {')));
ok(/position:\s*absolute/.test(bloque),
   'la capa de controles es absoluta: si no, los botones caen fuera de la pantalla');
ok(/inset:\s*0/.test(bloque), 'y cubre el plano entero, que es donde se colocan');

// ---------------------------------------------------------------------
titulo('Los botones de cambiar estado llevan el color de su estado.');

// Leerlas todas cuesta más que dar con la que se busca por el color, que
// además es el color con el que ese lote va a quedar pintado en el plano.
//
// La lista NO se escribe aquí a mano: se saca de la propia app. Al
// agregar "alimentado" el estado se quedó sin color en las tres partes
// —la variable, el botón y la etiqueta— y salió gris sobre gris sin que
// nada se quejara. Así, un estado nuevo sin color rompe la prueba.
const elegibles = (fuenteApp.match(/const ESTADOS_ELEGIBLES = \[([^\]]+)\]/) || [])[1]
  .match(/'([a-z_]+)'/g).map((s) => s.replace(/'/g, ''));
ok(elegibles.length >= 7, `se leyeron los ${elegibles.length} estados elegibles de app.js`);

for (const e of elegibles) {
  ok(new RegExp(`--${e}:\\s*#`).test(css), `"${e}" tiene su color en :root`);
  ok(new RegExp(`\\.acciones button\\[data-estado="${e}"\\][^}]*background:\\s*var\\(--${e}\\)`)
     .test(css), `el botón de "${e}" se pinta con var(--${e})`);
  ok(new RegExp(`\\.etiqueta\\[data-e="${e}"\\][^}]*background:\\s*var\\(--${e}\\)`)
     .test(css), `y su etiqueta también, que es lo que se ve en la lista`);
}
// La regla genérica de hover repintaba el botón de gris y se perdía el
// color justo al tocarlo, que es cuando hace falta verlo.
ok(/:where\(\.acciones\) button[^{]*:not\(\[data-estado\]\)[^{]*:hover/.test(css),
   'y el hover genérico deja en paz a los que llevan color de estado');

// «Nuevo lote» abajo a la derecha, con las demás barras flotantes: era
// lo único que quedaba arriba a la izquierda, lejos del pulgar.
// Ahora comparte renglón con la pastilla del GPS, que va a la izquierda:
// el margen automático es lo que lo mantiene pegado a la derecha.
ok(/#boton-nuevo\s*{[^}]*margin-left:\s*auto/.test(css),
   '«Nuevo lote» se alinea a la derecha dentro de su renglón flotante');
// La pastilla del GPS se pidió abajo a la izquierda, en ese renglón, y
// antes que el botón: si van al revés, el GPS quedaría a la derecha.
const fila = fuenteApp.match(/<div class="fila-inferior">([\s\S]*?)<\/div>\s*<\/div>/)?.[1] || '';
ok(fila.indexOf('id="chip-gps-caja"') >= 0
   && fila.indexOf('id="chip-gps-caja"') < fila.indexOf('id="boton-nuevo"'),
   'la pastilla del GPS va abajo a la izquierda, en el renglón de «Nuevo lote»');
ok(!/class="ctrl-izq"[\s\S]{0,2500}id="chip-gps-caja"/.test(fuenteApp.slice(fuenteApp.indexOf('function montarMapa()'))),
   'y ya no está arriba, debajo de las herramientas');
ok(/#boton-nuevo:empty[^{]*{[^}]*display:\s*none/.test(css),
   'y sin botón dentro no deja un hueco que tape el plano');

// ---------------------------------------------------------------------
titulo('El texto encima de un color se lee: ámbar con letra oscura.');

// En el plano el código va pintado: letra blanca con filo negro, así que
// se lee igual sobre cualquier estado, sobre el relieve del montón y
// sobre la foto aérea, sin caja que lo tape. Fuera del plano (fichas,
// botones) sigue mandando contraste() de app.js.
ok(pintadoBlanco(negro(null, 'por_muestrear')),
   'sobre el ámbar de "por muestrear" el código se lee: blanco con filo negro');
ok(pintadoBlanco(negro(null, 'facturado')), 'y sobre el azul de "facturado", igual');
ok(!/<rect[^>]*fill="#fdfbf7"/.test(negro(null, 'facturado')), 'sin placa ni caja debajo del código');
ok(/function contraste\(/.test(fuenteApp), 'las fichas siguen eligiendo letra clara u oscura según el fondo');

// ---------------------------------------------------------------------
titulo('Mover el plano no toca la escena: solo cambia el encuadre.');

// Esto es una DECISIÓN, no un detalle, y por eso está aquí: que se rompa
// la prueba si alguien vuelve a intentarlo sin probarlo en un teléfono.
//
// Se probó apagar los códigos de los lotes mientras el plano se movía,
// porque un <text> lleva su tamaño en unidades del plano y al acercar hay
// que recomponer cada glifo en cada cuadro. En el banco de pruebas
// ganaba mucho —117 ms por cuadro contra 17 con 200 lotes—, pero en
// teléfonos de verdad salió peor: encender y apagar el `display` de
// doscientos textos hacía parpadear los rótulos, algunos bordes y hasta
// los controles que flotan FUERA del SVG, como si el mapa prendiera y
// apagara una capa blanca.
//
// Vale más una escena estable que un cuadro más rápido: mientras el dedo
// arrastra, lo único que cambia es el viewBox.
Mapa.pintar(mismos);
unoAUno();
const antesDelGesto = lienzo.innerHTML;

disparar('pointerdown', dedo(1, 500, 350));
for (let i = 1; i <= 20; i++) disparar('pointermove', dedo(1, 500 - i * 7, 350 - i * 5));

ok(lienzo.clases.size === 0, 'arrastrando no se le pone ninguna clase al lienzo');
ok(lienzo.innerHTML === antesDelGesto, 'y el SVG no se toca: lo que cambia es el encuadre');
const enc = lienzo.attrs.viewBox.split(' ').map(Number);
ok(enc[0] !== 0 || enc[1] !== 0, `el encuadre sí se movió (${lienzo.attrs.viewBox})`);

disparar('pointerup', dedo(1, 360, 250));
ok(lienzo.clases.size === 0, 'y al soltar tampoco queda ninguna puesta');

// ---------------------------------------------------------------------
titulo('El pellizco apaga los códigos; el paneo no.');

// Desplazar y acercar no cuestan lo mismo. Al desplazar el texto solo se
// vuelve a pintar; al acercar cambia de TAMAÑO en cada cuadro y hay que
// recomponer cada glifo. Medido con 149 lotes y 3 pilas, en un pellizco
// de 30 movimientos con la CPU frenada 10 veces: con los códigos
// puestos, el 10% de los cuadros pasa de 367 ms y el peor llega a 417;
// apagándolos, 50 y 100. A 20 veces, 783 ms contra 100.
//
// Y la marca la pone el GESTO, no un cronómetro: si parpadea a mitad del
// pellizco, el remedio es peor que la enfermedad.
Mapa.pintar(mismos);
unoAUno();

disparar('pointerdown', dedo(1, 400, 300));
ok(!lienzo.clases.has('acercando'), 'un solo dedo es paneo: los códigos se quedan');

disparar('pointerdown', dedo(2, 600, 300));
ok(lienzo.clases.has('acercando'), 'con el segundo dedo empieza el pellizco y se apagan');

let siempreApagados = true;
for (let i = 1; i <= 20; i++) {
  disparar('pointermove', dedo(1, 400 - i * 4, 300));
  disparar('pointermove', dedo(2, 600 + i * 4, 300));
  if (!lienzo.clases.has('acercando')) siempreApagados = false;
}
ok(siempreApagados, 'y siguen apagados TODO el pellizco, sin encenderse ni una vez');

// al levantar un dedo esto pasa a ser paneo, y el paneo no los apaga
disparar('pointerup', dedo(2, 680, 300));
ok(!lienzo.clases.has('acercando'), 'al quedar un dedo vuelven, porque ya es paneo');
disparar('pointerup', dedo(1, 320, 300));
ok(!lienzo.clases.has('acercando'), 'y al soltar del todo tampoco queda la marca puesta');

// ---------------------------------------------------------------------
titulo('El pellizco deja quieto el punto que está entre los dos dedos.');

// La conversión de pantalla a plano se hace a mano, sin preguntarle la
// matriz al navegador: preguntarla obliga a recalcular la disposición en
// ese instante, y en un pellizco eso pasaba una vez por CADA movimiento
// del dedo (medido: 90 recálculos contra 30, y 725 ms contra 227). La
// cuenta tiene que salir clavada o los toques caen donde no es.
Mapa.pintar(mismos);
unoAUno();                                   // lienzo 1000 × 700, escala 1

// dos dedos a 200 px, con el punto medio en (500, 300) → plano (500, 300)
disparar('pointerdown', dedo(1, 400, 300));
disparar('pointerdown', dedo(2, 600, 300));
// se separan hasta 400 px: acerca al doble, así que el encuadre se parte
// por la mitad (500 × 350) y la escala pasa a 2
disparar('pointermove', dedo(1, 300, 300));
disparar('pointermove', dedo(2, 700, 300));

const v = Mapa.obtenerVista();
ok(Math.abs(v.w - 500) < 0.01 && Math.abs(v.h - 350) < 0.01,
   `separar los dedos al doble acerca al doble (${v.w.toFixed(0)} × ${v.h.toFixed(0)})`);
// para que el plano (500, 300) siga cayendo en la pantalla (500, 300) con
// escala 2, el encuadre tiene que empezar en (250, 150)
ok(Math.abs(v.x - 250) < 0.01 && Math.abs(v.y - 150) < 0.01,
   `y el punto entre los dedos no se movió (encuadre en ${v.x.toFixed(0)}, ${v.y.toFixed(0)})`);
disparar('pointerup', dedo(1, 300, 300));
disparar('pointerup', dedo(2, 700, 300));

// ---------------------------------------------------------------------
titulo('Levantar un dedo del pellizco no deja el plano trabado.');

Mapa.editar(false);
Mapa.limpiarSeleccion();
Mapa.pintar({ config: { ancho: 1000, alto: 700 }, figuras: [], pilas: [], lotes: [] });
Mapa.fijarVista({ x: 0, y: 0, w: 1000, h: 700 });

// Aquí se montó el mapa dos veces, así que cada gesto llega por
// duplicado a mapa.js. No es un defecto de la prueba: en el navegador
// pasa igual, porque la red de seguridad de la ventana escucha en
// captura y corre antes que el oyente del lienzo. Cerrar el gesto dos
// veces es justo lo que dejaba el plano trabado.
disparar('pointerdown', dedo(1, 400, 300));
disparar('pointerdown', dedo(2, 600, 300));
disparar('pointermove', dedo(2, 800, 300));
const trasPellizco = Mapa.obtenerVista();
ok(trasPellizco.w < 1000, `el pellizco acercó el plano (${Math.round(trasPellizco.w)} de ancho)`);

// se levanta uno de los dos y el que queda sigue arrastrando el plano
disparar('pointerup', dedo(2, 800, 300));
disparar('pointermove', dedo(1, 300, 300));
const trasArrastre = Mapa.obtenerVista();
ok(trasArrastre.x !== trasPellizco.x,
   'el dedo que queda sigue moviendo el plano, no se queda muerto');
ok(Math.abs(trasArrastre.w - trasPellizco.w) < 0.01,
   'y arrastrar no cambia el acercamiento');
disparar('pointerup', dedo(1, 300, 300));

// ---------------------------------------------------------------------
titulo('Un lote alimentado ya no está en el patio: ni se dibuja ni estorba.');

// Alimentado quiere decir que se consumió en planta. En la vuelta normal
// la app ya no se lo pasa al plano, pero mirando otro día sí llegan
// lotes con el estado que tenían ese día, y ahí el plano tiene que
// saberlo por su cuenta.
const comido = { id: 'lc', codigo: 'PG9001', estado: 'alimentado', pila_id: null,
                 forma: 'elipse', x: 300, y: 300, rx: 46, ry: 34, rot: 0 };
const sigue  = { id: 'ls', codigo: 'PG9002', estado: 'por_muestrear', pila_id: null,
                 forma: 'elipse', x: 600, y: 300, rx: 46, ry: 34, rot: 0 };
Mapa.pintar({ config: { ancho: 1000, alto: 700 }, figuras: [], pilas: [],
              lotes: [comido, sigue] });
unoAUno();
ok(!lienzo.innerHTML.includes('PG9001'), 'el alimentado no se dibuja');
ok(lienzo.innerHTML.includes('PG9002'), 'y el que sigue en el patio sí');

// Y lo que no se ve tampoco puede atrapar el dedo: soltar un lote encima
// de una figura invisible es de lo más difícil de entender desde el patio.
ok(Mapa.blancoEn({ x: 300, y: 300 }) === null,
   'soltar algo sobre donde estaba no lo encuentra');
ok(Mapa.blancoEn({ x: 600, y: 300 })?.obj?.id === 'ls',
   'y sobre el que sí está, lo encuentra normal');

// ---------------------------------------------------------------------
titulo('Llegar al mapa por cualquier camino lo deja a sangre completa.');

// El plano va de borde a borde: esa clase es la que le quita los
// márgenes de la lista. `pintar` la ponía, pero `irAlMapa` —el camino que
// usan Plataformas y "ver en el mapa"— no, así que el plano llegaba
// encogido y con barra de desplazamiento hasta que la sincronización
// siguiente pasaba por `pintar` y lo enderezaba solo a los pocos
// segundos.
const irAlMapaSrc = fuenteApp.slice(fuenteApp.indexOf('function irAlMapa()'),
                                    fuenteApp.indexOf('function textoFiltro()'));
ok(/m\.className = 'a-sangre'/.test(irAlMapaSrc),
   'irAlMapa deja el plano a sangre, sin esperar a la vuelta siguiente');

// ---------------------------------------------------------------------
titulo('La volqueta ENTRA: la salida no puede rellenar hacia atrás.');

// Esto llegó roto en la versión que se recibió y no se ve leyendo el
// código: la salida llevaba `both` y un fotograma inicial explícito, así
// que su relleno HACIA ATRÁS aplicaba translateX(0) desde el
// milisegundo cero. Como va la última de la lista, le ganaba a la
// entrada: la volqueta se quedaba quieta en el sitio y no entraba nunca.
// Comprobado en un navegador de verdad; aquí se fija para que nadie lo
// "ordene" de vuelta.
// Ahora la escena se anima desde app.js: la salida es la animación de
// .vq-mov que arranca con retardo, y tiene que ir `forwards`.
const llegada = fuenteApp.slice(fuenteApp.indexOf('function animarLlegada(lote)'),
                                fuenteApp.indexOf('// ------------------------------------------------ los obreros muestrean'));
ok(/a\('\.vq-mov'[^;]*delay: 1680[^;]*fill: 'forwards'/.test(llegada),
   'la salida de la volqueta rellena `forwards`, nunca `both`');

// El relevo con el lote de verdad depende de que el montón tenga su
// misma silueta. Ya no se dibuja aparte: es el dibujo del lote mismo.
ok(/Mapa\.dibujoLote\(lote\)/.test(llegada),
   'el montón que deja la volqueta es el mismo dibujo del lote, para que el relevo no se vea');
const msDe = (n) => +(fuenteApp.match(new RegExp(`const ${n} = (\\d+)`)) || [])[1];
ok(msDe('LOTE_APARECE') > 0 && msDe('LOTE_APARECE') < msDe('DURACION_VOLQUETA'),
   'el lote de verdad entra antes de que la escena se quite');

// ---------------------------------------------------------------------
titulo('Los obreros salen sin fondo, y a 1,5 veces la velocidad.');

// Se pidió expresamente quitarle el fondo: el plano ya tiene el suyo
// —que puede ser una foto aérea del acopio— y pintarle encima un
// paisaje de perfil taparía justo lo que se está mirando.
const escena = fuenteApp.slice(fuenteApp.indexOf('const escenaObreros = () =>'),
                               fuenteApp.indexOf('function animarMuestreo(lote)'));
ok(escena.length > 500, 'se encontró la escena de los obreros');
for (const [que, patron] of [['cielo', /grad-cielo|capa-cielo/], ['cerros', /Cerros|cerro/i],
                             ['grúa', /grúa|grua/i], ['sol', /sol-escena/],
                             ['suelo', /capa-suelo|var\(--suelo\)/], ['conos', /cono-seguridad/],
                             ['topo', /topo/i]])
  ok(!patron.test(escena), `la escena no trae ${que}`);
ok(/ob-cuerpo-palero|obreroPalero/.test(escena) && /obreroVictima/.test(escena)
   && /obreroJefe/.test(escena), 'pero sí los tres muñecos, que son el chiste');

// El gag original dura 1,2 s por vuelta. Se pidió 1,5 veces más rápido
// o más: 1,2 / 1,5 = 0,8 s.
const gag = css.slice(css.indexOf('.ob-cuerpo-palero'), css.indexOf('@keyframes ob-pal-cuerpo'));
const dur = (gag.match(/(\d?\.?\d+)s/) || [])[1];
ok(dur === '.8', `cada vuelta del gag dura ${dur}s, o sea 1,5 veces más rápido que el original`);

// CUÁNTAS vueltas se dan sale de UN solo sitio, el JavaScript, y llega
// al CSS por `--vueltas`. Escrito dos veces, cambiar una y olvidar la
// otra corta la escena a media palada o la deja congelada al final.
ok(/animation: ob-pal-cuerpo \.8s [^;]*var\(--vueltas\);/.test(css),
   'las vueltas del gag las manda `--vueltas`, no un número escrito en el CSS');
ok(/animation: ob-jefe-mecer 1\.6s [^;]*calc\(var\(--vueltas\) \/ 2\);/.test(css),
   'y el capataz, que va al doble de lento, da la mitad');
ok(!/animation: ob-[a-z-]+ [^;]*\b\d+;/.test(css),
   'no queda ninguna regla del gag con las vueltas a mano');

const vueltas = Number((fuenteApp.match(/const VUELTAS_OBREROS = (\d+);/) || [])[1]);
const vuelta = Number((fuenteApp.match(/const VUELTA_OBREROS = (\d+);/) || [])[1]);
ok(vuelta === 800, `la vuelta son ${vuelta} ms`);
ok(vueltas * vuelta >= 5500 && vueltas * vuelta <= 7000,
   `la escena dura ${(vueltas * vuelta) / 1000} s, que son los "unos 6 segundos" que se pidieron`);
ok(/const DURACION_OBREROS = VUELTA_OBREROS \* VUELTAS_OBREROS;/.test(fuenteApp),
   'y lo que dura se calcula, no se escribe: no se puede desincronizar');

// Los ruidos van CON los fotogramas, en TODAS las vueltas: la pala se
// clava al 15 %, se suelta al 57 %, el terrón llega al 78 % y el casco
// rebota al 83 %.
ok(/for \(let i = 0; i < VUELTAS_OBREROS; i\+\+\)/.test(fuenteApp),
   'los ruidos se programan en todas las vueltas, no solo en las dos primeras');
for (const [ruido, pct] of [['palada', 15], ['tiro', 57], ['golpe', 78], ['casco', 83]])
  ok(new RegExp(`\\['${ruido}', ${pct}\\]`).test(fuenteApp),
     `"${ruido}" suena al ${pct} % de la vuelta (${Math.round(800 * pct / 100)} ms)`);
ok(/Math\.round\(VUELTA_OBREROS \* pct \/ 100\)/.test(fuenteApp),
   'y el milisegundo se saca del porcentaje, que es lo que dice el fotograma');

// ---------------------------------------------------------------------
titulo('La escena de los obreros no se la lleva un dedo.');

// Duraba 1,6 s y se saltaba tocando, como la volqueta. Al alargarla a
// seis segundos eso dejó de servir: en el patio se toca la pantalla todo
// el rato, y lo único que conseguía el atajo era que la escena se fuera
// sin que nadie lo hubiera pedido. Ahora la capa deja pasar el dedo al
// plano, como si no estuviera.
const montaje = fuenteApp.slice(fuenteApp.indexOf('function animarMuestreo(lote)'),
                                fuenteApp.indexOf('function barraEdicion()'));
ok(!/onpointerdown|pointerEvents\s*=\s*'auto'/.test(montaje),
   'ni se salta tocando ni atrapa el dedo');
ok(/\.capa-obreros \{[^}]*pointer-events: none/.test(css),
   'y la capa deja pasar los toques al plano que hay debajo');
// La volqueta sí la conserva: dura 1,7 s y tapa justo donde acaba de
// aparecer el lote, así que ahí poder saltarla sí sirve.
const vqMontaje = fuenteApp.slice(fuenteApp.indexOf('function animarLlegada(lote)'),
                                  fuenteApp.indexOf('// ------------------------------------------------ los obreros muestrean'));
ok(/onpointerdown = terminar/.test(vqMontaje), 'la volqueta, en cambio, sí se salta tocando');

// Muestrear dos lotes seguidos no puede dejar dos cuadrillas encimadas.
ok(/querySelectorAll\('\.capa-obreros'\)/.test(montaje),
   'y montar una escena nueva retira la anterior');

// Sin archivos de sonido nuevos: son cuatro golpes cortísimos y cuatro
// MP3 más serían cuatro descargas y cuatro entradas de caché para nada.
ok(/createOscillator|createBufferSource/.test(fuenteApp),
   'los ruidos se sintetizan, no se descargan');
const sw = await readFile(new URL('../web/sw.js', import.meta.url), 'utf8');
ok((sw.match(/\.mp3/g) || []).length === 2,
   'y la caché sigue con los dos MP3 de siempre, ni uno más');

// Y respetan el interruptor de silencio que ya existía.
ok(/const ruidoEn = \(cual, ms\) => setTimeout\(\(\) => \{\s*\n\s*if \(S\.mudo\) return;/.test(fuenteApp),
   'con los avisos apagados, la escena se ve pero no suena');

// ---------------------------------------------------------------------
titulo('Un lote de bigbags muestra cuántos son, apilados de a tres.');

const d27 = Mapa.disposicionBigbags(27);
ok(Mapa.ALTO_BIGBAGS === 3, 'se apilan de a tres');
ok(d27.pilas.length === 9 && d27.pilas.every((p) => p.alto === 3), '27 bigbags son 9 columnas de 3');
ok(d27.porFila === 3 && d27.filas === 3, 'sin reparto elegido, el grupo sale cuadrado (3 × 3)');
const d28 = Mapa.disposicionBigbags(28);
ok(d28.pilas.length === 10 && d28.pilas.at(-1).alto === 1 && d28.pilas.slice(0, -1).every((p) => p.alto === 3),
   'con 28, la última columna lleva el que sobra');
const enFila = Mapa.disposicionBigbags(27, 9);
ok(enFila.porFila === 9 && enFila.filas === 1, 'repartidas de a 9 por fila quedan en una sola fila');
const lado = (d) => d.pilas.length > 1 ? Math.abs(d.pilas[1].x - d.pilas[0].x) : null;
ok(lado(enFila) === lado(d27), 'cambiar el reparto no cambia el tamaño de cada bigbag');
ok(enFila.rx > d27.rx && enFila.ry < d27.ry, 'solo cambia cuánto ocupa el grupo a lo ancho y a lo alto');
ok(Mapa.disposicionBigbags(27, 50).porFila === 9, 'no se pueden pedir más columnas por fila de las que hay');

const grupo = { id: 'bb', codigo: 'CRN0733', estado: 'muestreado', pila_id: null, material: 'bigbag',
  forma: 'rectangulo', x: 500, y: 350, rot: 0, bigbags: 27, bigbags_fila: null, rx: d27.rx, ry: d27.ry };
Mapa.pintar({ config: { ancho: 1000, alto: 700 }, figuras: [], pilas: [], lotes: [grupo] });
ok((lienzo.innerHTML.match(/class="forma"/g) || []).length === 27, 'en el plano se ven los 27, cada uno con su filo');
ok(Mapa.esGrupoBigbags(grupo) && !Mapa.esGrupoBigbags({ ...grupo, bigbags: null }),
   'un bigbag de antes, sin cantidad, sigue siendo un solo saco');

// en modo edición, la manija del costado reparte; no estira
unoAUno();
Mapa.editar(true);
Mapa.seleccionar('lote', grupo.id);
ok(lienzo.innerHTML.includes('data-handle="columnas"') && !lienzo.innerHTML.includes('data-handle="tamano"'),
   'el grupo tiene manija de reparto y no de tamaño');
disparar('pointerdown', evento(grupo.x + grupo.rx + 16, grupo.y, { manija: 'columnas' }));
disparar('pointermove', evento(grupo.x + enFila.rx + 16, grupo.y));
disparar('pointerup', evento(grupo.x + enFila.rx + 16, grupo.y));
ok(grupo.bigbags_fila === 9, `arrastrar la manija hasta el ancho de 9 columnas las pone en fila (${grupo.bigbags_fila})`);
ok(grupo.rx === enFila.rx && grupo.ry === enFila.ry, 'y el tamaño del lote en el plano sigue al reparto');
Mapa.editar(false);

// ---------------------------------------------------------------------
titulo('Bigbags sobre bigbags: se montan si caben, nunca más de 3 de alto.');

const bbLote = (id, codigo, n, extra = {}) => {
  const d = Mapa.disposicionBigbags(n);
  return { id, codigo, estado: 'muestreado', pila_id: null, material: 'bigbag', forma: 'rectangulo',
           x: 400, y: 300, rot: 0, bigbags: n, bigbags_fila: null, rx: d.rx, ry: d.ry, ...extra };
};
const abajoM = bbLote('m1', 'CRN0901', 4);          // dos columnas: 3 y 1
const dosBb = bbLote('m2', 'CRN0902', 2);
const seis = bbLote('m3', 'CRN0903', 6);
Mapa.pintar({ config: { ancho: 1000, alto: 700 }, figuras: [], pilas: [], lotes: [abajoM, dosBb, seis] });
ok(Mapa.cabeEncima(dosBb, abajoM), 'sobre una columna de 1 caben 2 más (queda en 3)');
ok(!Mapa.cabeEncima(seis, abajoM), 'pero 6 no caben: solo hay sitio para 2');

const chicoArriba = { ...dosBb, sobre_lote: 'm1' };
Mapa.pintar({ config: { ancho: 1000, alto: 700 }, figuras: [], pilas: [], lotes: [abajoM, chicoArriba, seis] });
const dibMontaje = lienzo.innerHTML;
ok(Mapa.montadoSobre('m2') === 'm1' && Mapa.encimaDe('m1').includes('m2'), 'el de 2 queda montado sobre el de 4');
ok(Mapa.tieneCarga('m1') && !Mapa.tieneCarga('m3'), 'y el de abajo sabe que lleva carga');
ok(dibMontaje.includes('>CRN0901<') && dibMontaje.includes('>CRN0902<'), 'se leen los dos códigos: no es una pila');
ok(!dibMontaje.includes('data-tipo="pila"'), 'y no se creó ninguna pila');
ok((dibMontaje.match(/class="forma"/g) || []).length === 4 + 2 + 6, 'se dibujan los 12 bigbags, cada uno con su filo');
ok(dibMontaje.indexOf('data-id="m2"') > dibMontaje.indexOf('data-id="m1"'),
   'el montado se dibuja después (encima) del de abajo');
ok(!Mapa.cabeEncima({ ...seis }, abajoM), 'con 2 ya montados, a la columna no le cabe nada más');

const fuenteAppM = await readFile(new URL('../web/js/app.js', import.meta.url), 'utf8');
ok(/Mapa\.esGrupoBigbags\(lote\) && Mapa\.esGrupoBigbags\(blanco\.obj\)[\s\S]{0,80}montarBigbags/.test(fuenteAppM),
   'soltar bigbags sobre bigbags monta o deja al lado; no arma pila');
ok(/no cabe encima[\s\S]{0,300}alLado\(/.test(fuenteAppM), 'si no cabe, queda pegado al lado');
ok(/sobre_lote = null/.test(fuenteAppM), 'bajarlo al piso lo desmonta');
ok(/await moverCarga\(obj\)/.test(fuenteAppM), 'mover el de abajo se lleva lo montado');
const fuenteMigM = await readFile(new URL('../sql/migracion.sql', import.meta.url), 'utf8');
ok(/add column if not exists sobre_lote uuid references lotes \(id\) on delete set null/.test(fuenteMigM),
   'la migración agrega sobre_lote sin borrar nada');

const fuenteStore = await readFile(new URL('../web/js/store.js', import.meta.url), 'utf8');
ok(/material === 'bigbag' && bigbags > 0 \? \{ bigbags, bigbags_fila: null \} : \{\}/.test(fuenteStore),
   'un lote a granel no manda la columna de bigbags (no rompe un servidor sin migrar)');
const fuenteMigracion = await readFile(new URL('../sql/migracion.sql', import.meta.url), 'utf8');
ok(/add column if not exists bigbags\s+integer/.test(fuenteMigracion)
   && /add column if not exists bigbags_fila integer/.test(fuenteMigracion),
   'la migración agrega las dos columnas sin borrar nada');

// ---------------------------------------------------------------------
titulo('Un botón con icono no lo pierde al pulsarlo.');

// Pasaba de verdad: al tocar el trofeo se quedaba un rectángulo negro y
// pelado hasta recargar la app. `accion` guardaba el TEXTO del botón
// para devolvérselo al terminar, y un icono no tiene texto: poner
// "Cargando…" borraba el dibujo y lo que se devolvía era una cadena
// vacía. Afectaba a todos los botones con icono, no solo al trofeo:
// "Nuevo lote", la campana, "Nueva tarea".
const acc = fuenteApp.slice(fuenteApp.indexOf('function accion(fn,'),
                            fuenteApp.indexOf('const textoFallo ='));
ok(/const antes = this\.innerHTML;/.test(acc),
   'se guarda el contenido del botón, no su texto');
ok(/this\.innerHTML = antes;/.test(acc), 'y se le devuelve entero al terminar');
// El aviso de "ocupado" sigue entrando como TEXTO: si entrara como
// marcado, un mensaje con un < rompería el botón.
ok(/this\.textContent = ocupado;/.test(acc),
   'y lo que se enseña mientras trabaja se pinta como texto, nunca como marcado');

cerrar();
