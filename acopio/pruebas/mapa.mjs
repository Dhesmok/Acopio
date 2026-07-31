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
titulo('El cerco de dos pilas que se cruzan tampoco se parte.');

// La pila no puede usar el truco de las capas: su relleno es casi
// transparente y no borra nada. Va con máscara.
const dosPilas = [
  { id: 'pa', codigo: 'A', tipo: 'otro', estado: 'abierta',
    forma: 'elipse', x: 300, y: 300, rx: 90, ry: 60, rot: 0 },
  { id: 'pb', codigo: 'B', tipo: 'otro', estado: 'abierta',
    forma: 'elipse', x: 420, y: 300, rx: 90, ry: 60, rot: 0 }
];
Mapa.pintar({ config: { ancho: 1000, alto: 700 }, figuras: [], lotes: [], pilas: dosPilas });
const conPilas = lienzo.innerHTML;
ok(conPilas.includes('<mask id="fuera-de-pilas"'), 'el cerco se pinta a través de una máscara');
ok((conPilas.match(/fill="#000"/g) || []).length === 2,
   'que tapa las dos pilas: dentro de cualquiera de ellas no se dibuja cerco');
ok(conPilas.includes('mask="url(#fuera-de-pilas)"'), 'y la capa de cercos la usa');
ok(/class="pila-forma"[^>]*stroke="none"/.test(conPilas),
   'el relleno ya no lleva cerco propio, o volvería a cruzar al vecino');
// El contorno del lote pasa por la MISMA máscara: un lote encima de una
// pila también es el mismo material.
Mapa.pintar({ config: { ancho: 1000, alto: 700 }, figuras: [], pilas: dosPilas,
              lotes: [{ id: 'lx', codigo: 'PG1', estado: 'muestreado', pila_id: null,
                        forma: 'elipse', x: 320, y: 300, rx: 60, ry: 45, rot: 0 }] });
ok(lienzo.innerHTML.includes('<g mask="url(#fuera-de-pilas)">'),
   'los contornos de los lotes van por la máscara de las pilas');

// La región de una máscara RECORTA: lo que cae fuera no sale. Y arrastrar
// un lote no repinta, así que la región tiene que aguantar el arrastre sin
// quedarse corta, o el lote pierde el contorno a mitad de camino.
const region = lienzo.innerHTML.match(
  /<mask id="fuera-de-pilas"[^>]*x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/);
ok(region, 'la máscara declara su región');
const [, mx, my, mw, mh] = region.map(Number);
ok(mx <= 0 && my <= 0 && mx + mw >= 1000 && my + mh >= 700,
   `la región cubre el patio entero (${mx}, ${my}, ${mw} × ${mh})`);
ok(mx < -300 && mx + mw > 1300,
   'y sobra sitio para arrastrar un lote fuera del patio sin que pierda el contorno');

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

cerrar();
