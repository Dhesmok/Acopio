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

const nodoFalso = () => ({ setAttribute() {}, classList: { add() {}, remove() {} } });

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
const ultimoTrazo = dibujo.lastIndexOf('stroke="#14171a"');
const primerRelleno = dibujo.indexOf('fill="#e8b48a"/>');
ok(primerRelleno > 0 && ultimoTrazo < primerRelleno,
   'los rellenos van todos después de los contornos, no lote por lote');
ok(dibujo.includes('stroke-width="4"'),
   'el contorno se dibuja al doble: su propio relleno le come la mitad de adentro');
ok((dibujo.match(/data-id="la"/g) || []).length === 3,
   'cada lote sale en las tres capas, y las tres responden al dedo');
ok((dibujo.match(/>PG1</g) || []).length === 1,
   'pero el código se escribe una sola vez');

// El rótulo tapado era el otro lado del mismo problema: con el código
// dentro de su lote, el relleno del vecino se comía media palabra.
const ultimoRelleno = dibujo.lastIndexOf('fill="#e8b48a"/>');
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
const trazos = conPilas.lastIndexOf('stroke="#14171a"');
const rellenos = conPilas.indexOf('fill="#e8b48a"/>');
ok(trazos < rellenos, 'los rellenos siguen yendo después de los contornos');

// Y la pila vuelve a llevar su cerco encima, no en una capa aparte
ok(/class="pila-forma"[^>]*stroke="#[0-9a-f]{6}"/.test(conPilas),
   'cada pila dibuja su propio cerco');

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
// repetir, así que en el patio se apunta pegado: ABG40(2) y ABG40.2 son
// los dos la segunda volqueta del lote ABG40.
const parte = (c) => `${Mapa.partesCodigo(c).base}|${Mapa.partesCodigo(c).volqueta}`;
ok(parte('ABG40(2)') === 'ABG40|2', 'ABG40(2) es el lote ABG40, volqueta 2');
ok(parte('ABG40.2') === 'ABG40|2', 'ABG40.2 también');
ok(parte('SJ1015.3') === 'SJ1015|3', 'y SJ1015.3, que es la forma que más se usa');
ok(parte('ABG40(12)') === 'ABG40|12', 'el número puede tener dos cifras');

// Lo que NO se toca, que es lo que evita estropear códigos de verdad
ok(parte('PG1042') === 'PG1042|', 'un código normal se queda entero');
ok(parte('PG213()') === 'PG213()|', 'un paréntesis vacío se deja tal cual: no sabemos qué quiso decir');
ok(parte('ABG-2026-000117') === 'ABG-2026-000117|', 'un código con guiones y ceros no es una volqueta');
ok(parte('SJ1015.B') === 'SJ1015.B|', 'después del punto tiene que haber un número');
ok(parte('') === '|', 'y un código vacío no revienta');

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
ok(vencido.includes('fill="#ffffff"'), 'el código encima va en blanco, que sobre negro se lee');

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
const fuenteApp = await readFile(new URL('../web/js/app.js', import.meta.url), 'utf8');
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
ok(/#boton-nuevo\s*{[^}]*align-self:\s*flex-end/.test(css),
   '«Nuevo lote» se alinea a la derecha dentro de la columna flotante');
ok(/#boton-nuevo:empty[^{]*{[^}]*display:\s*none/.test(css),
   'y sin botón dentro no deja un hueco que tape el plano');

// ---------------------------------------------------------------------
titulo('El texto encima de un color se lee: ámbar con letra oscura.');

// El corte de claridad vive por duplicado —claro() en mapa.js pinta los
// códigos del plano, contraste() en app.js pinta botones y etiquetas—.
// Si se separan, el mismo lote sale con letra blanca en el plano y
// oscura en su ficha.
const fuenteMapa = await readFile(new URL('../web/js/mapa.js', import.meta.url), 'utf8');
const corte = (t) => (t.match(/\(r \* 299 \+ g \* 587 \+ b \* 114\) \/ 1000 > (\d+)/) || [])[1];
ok(corte(fuenteMapa) && corte(fuenteMapa) === corte(fuenteApp),
   `plano y ficha usan el mismo corte de claridad (${corte(fuenteMapa)})`);

const ambar = negro(null, 'por_muestrear');
ok(ambar.includes('fill="#14171a"'),
   'sobre el ámbar de "por muestrear" el código va oscuro, que blanco casi no se ve');
const azul = negro(null, 'facturado');
ok(azul.includes('fill="#ffffff"'), 'y sobre el azul de "facturado" sigue yendo blanco');

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

// Y el nombre de la plataforma se repinta donde cambia el dato, no en
// cada pantalla: los dos caminos que llevan al mapa no pasan por
// `pintar`, así que el chip de arriba se quedaba con el nombre anterior.
const irAPlat = fuenteApp.slice(fuenteApp.indexOf('const irAPlataforma = '),
                                fuenteApp.indexOf('const alimentado = '));
ok(/pintarChipPlataforma\(\)/.test(irAPlat),
   'y cambiar de plataforma repinta su nombre en la cabecera');

// ---------------------------------------------------------------------
titulo('La volqueta ENTRA: la salida no puede rellenar hacia atrás.');

// Esto llegó roto en la versión que se recibió y no se ve leyendo el
// código: la salida llevaba `both` y un fotograma inicial explícito, así
// que su relleno HACIA ATRÁS aplicaba translateX(0) desde el
// milisegundo cero. Como va la última de la lista, le ganaba a la
// entrada: la volqueta se quedaba quieta en el sitio y no entraba nunca.
// Comprobado en un navegador de verdad; aquí se fija para que nadie lo
// "ordene" de vuelta.
const salida = css.slice(css.indexOf('.vq-camion {'), css.indexOf('@keyframes vq-entrar'));
ok(/vq-salir[^;]*forwards/.test(salida),
   'la salida de la volqueta rellena `forwards`, nunca `both`');
const ruedas = css.slice(css.indexOf('.vq-rueda {'), css.indexOf('@keyframes vq-rodar-entrada'));
ok(/vq-rodar-salida[^;]*forwards/.test(ruedas), 'y las ruedas, igual');

// El relevo con el lote de verdad depende de que el montón tenga su
// misma silueta: el plano se mira desde ARRIBA y el lote es un círculo.
ok(/const monton = \(col\) => `[\s\S]*?<circle r="40"/.test(fuenteApp),
   'el montón sigue siendo un círculo del radio del lote, para que el relevo no se vea');

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
// o más: 1,2 / 1,5 = 0,8 s. Y se dan dos vueltas, 1,6 s en total, que es
// lo que dura la volqueta.
const gag = css.slice(css.indexOf('.ob-cuerpo-palero'), css.indexOf('@keyframes ob-pal-cuerpo'));
const dur = (gag.match(/(\d?\.?\d+)s/) || [])[1];
ok(dur === '.8', `cada vuelta del gag dura ${dur}s, o sea 1,5 veces más rápido que el original`);
ok(/animation: ob-pal-cuerpo \.8s [^;]*\b2;/.test(css), 'y se dan dos vueltas, no una ni infinitas');
ok(/const DURACION_OBREROS = 1600;/.test(fuenteApp),
   'la escena se retira a los 1600 ms, que son las dos vueltas exactas');

// Los ruidos van CON los fotogramas. En una vuelta de 800 ms: la pala
// se clava al 15 % (120 ms), se suelta al 57 % (456), el terrón llega al
// 78 % (624) y el casco rebota al 83 % (664).
for (const [ruido, ms, pct] of [['palada', 120, 15], ['tiro', 456, 57],
                                ['golpe', 624, 78], ['casco', 664, 83]]) {
  ok(new RegExp(`ruidoEn\\('${ruido}', vuelta \\+ ${ms}\\)`).test(fuenteApp),
     `el ruido de "${ruido}" suena a los ${ms} ms, que es el ${pct} % de la vuelta`);
  ok(Math.round(800 * pct / 100) === ms || Math.abs(800 * pct / 100 - ms) <= 4,
     `y ${ms} ms es de verdad el ${pct} % de 800`);
}

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

cerrar();
