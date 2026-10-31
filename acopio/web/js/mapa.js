// =====================================================================
//  mapa.js · el plano del acopio
//  Figuras arrastrables y editables: óvalo, rectángulo o polígono con
//  vértices que se mueven uno a uno.
// =====================================================================

import * as Dib from './dibujo.js';

let svg, svgGps, capa, caja0, cb = {}, vista = { x: 0, y: 0, w: 1000, h: 700 };
let datos = { config: {}, figuras: [], pilas: [], lotes: [] };
let seleccion = null;
let modo = 'ninguno', arrastre = null;
let repintadoPendiente = null;   // lo que llegó mientras se interactuaba
const punteros = new Map();
let pinchInicial = null, movio = false;

// El plano se dibuja metiendo texto en innerHTML, así que todo lo que
// venga de la base entra escapado. Un código de lote con "<" o "&" no
// rompía solo esa figura: dejaba el mapa entero sin dibujar, y para
// todos, no solo para quien escribió el código. Va aquí y no importado
// del resto de la app a propósito: el mapa se dibuja solo.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Un mismo lote puede llegar en varias volquetas, y como el código no se
// puede repetir, en el patio se apunta la volqueta pegada al código:
// ABG40(2), ABG40.2 y ABG40-2 son los tres la SEGUNDA volqueta del lote
// ABG40. El guion se admite porque en algunos teléfonos el punto y los
// paréntesis casi no se ven en la pantalla, y quien apunta desde el
// patio acaba escribiendo la raya, que se distingue de lejos.
//
// Se separa para poder mostrar el código a secas y el número pequeño
// arriba, como un exponente: dentro de un óvalo no sobra sitio, y así lo
// que se lee de un vistazo es el lote, con la volqueta al lado sin
// estorbar. El dato guardado NO se toca: en la base, en el buscador y en
// el informe el código sigue siendo el que escribió quien lo registró.
//
// Solo se reconoce con NÚMERO. Un "PG213()" con el paréntesis vacío se
// deja tal cual: no sabemos qué quiso decir, y adivinar sería peor.
export function partesCodigo(codigo) {
  const t = String(codigo ?? '');
  // El guion es el único de los tres que también se usa DENTRO del
  // código —ABG-1004 es el proveedor y el lote—, así que el de la
  // volqueta se reconoce por dónde está y por lo que lleva detrás, no
  // por ser el primero: ABG-1004-2 es el viaje 2 del lote ABG-1004.
  //
  // Delante tiene que haber un código de lote entero, que siempre acaba
  // en el número del lote: por eso en ABG-26 el 26 es el lote y no una
  // volqueta —"ABG" a secas no es un lote—. Y detrás va un número de
  // viaje: una o dos cifras y sin ceros delante, porque un lote se trae
  // en dos o en doce volquetas, nunca en la 000117. Así el guion de un
  // código largo con serial (ABG-2026-000117) se queda donde está.
  const m = t.match(/^(.+?)(?:\((\d+)\)|\.(\d+)|-([1-9]\d?))$/);
  if (!m) return { base: t, volqueta: '' };
  if (m[4] !== undefined && !/\d$/.test(m[1])) return { base: t, volqueta: '' };
  return { base: m[1], volqueta: m[2] || m[3] || m[4] };
}

export const COLORES_BASE = {
  por_muestrear: '#d99a06', muestreado: '#e8b48a', remuestreo: '#8a5cd6',
  facturado: '#2b5ca8', devolucion: '#b8352a', alimentado: '#0f6d78', despachado: '#5f6863',
  pila_alimentacion: '#1f7a54', pila_devolucion: '#b8352a',
  pila_espera: '#d99a06', pila_otro: '#14171a'
};
const paleta = () => ({ ...COLORES_BASE, ...(datos.config?.colores || {}) });

// Ya no está en el patio: despachado se lo llevaron, alimentado se
// consumió en planta. 'plataforma' es el estado retirado, por si queda
// alguno suelto. Ni se dibuja ni se le puede soltar nada encima —lo
// segundo importa: una figura invisible que sigue atrapando el dedo es
// de las cosas más difíciles de entender desde el patio.
const fuera = (l) => l.estado === 'despachado' || l.estado === 'alimentado'
                  || l.estado === 'plataforma';

// Deja la interacción en cero. Es CRÍTICO: si queda un puntero apuntado
// de un arrastre que se interrumpió (por ejemplo porque el lienzo se
// rearmó mientras el dedo seguía abajo), interactuando() sigue dando
// true, pintar() se va por el atajo y el mapa no se vuelve a dibujar
// NUNCA MÁS: se guarda todo pero en pantalla no pasa nada.
function reiniciarInteraccion() {
  if (espera) clearTimeout(espera);
  espera = null;
  punteros.clear();
  modo = 'ninguno';
  arrastre = null;
  pinchInicial = null;
  movio = false;
  caja = null;      // la caja guardada era la del gesto que se cortó
  gpsAlSoltar();
}

// Red de seguridad: si el dedo se levanta fuera del lienzo, o el
// navegador cancela la captura porque el nodo desapareció, igual hay
// que soltar el estado.
let redPuesta = false;
function ponerRed() {
  if (redPuesta) return;
  redPuesta = true;
  const soltar = (ev) => {
    if (!punteros.has(ev.pointerId)) return;
    arriba(ev);
  };
  addEventListener('pointerup', soltar, true);
  addEventListener('pointercancel', soltar, true);
}

// -------------------------------------------------------------- montaje
export function montar(contenedor, callbacks) {
  cb = callbacks;
  reiniciarInteraccion();
  repintadoPendiente = null;
  ultimoDibujo = '';
  seleccion = null;
  // El lienzo es MÁS GRANDE que su caja: sobra un SOBRA de cada lado,
  // escondido por el recorte de la caja. Es el margen que se ve al
  // desplazar o alejar con el dedo antes de volver a dibujar (ver
  // verVista). Va en el propio elemento, y no en la hoja de estilos,
  // porque la cuenta del encuadre depende de este número.
  //
  // El transform del gesto se le pone a una CAPA que envuelve al SVG, no
  // al SVG: en el propio <svg> el navegador vuelve a calcular la
  // disposición de todo lo de adentro en cada cambio, y se perdía la
  // mitad de lo ganado. En un <div> con will-change lo mueve la tarjeta
  // gráfica sin preguntarle nada a nadie.
  const pct = (v) => `${+(v * 100).toFixed(3)}%`;
  contenedor.innerHTML = `<div class="lienzo-capa" style="position:absolute;left:${pct(-SOBRA)};top:${
      pct(-SOBRA)};width:${pct(1 + 2 * SOBRA)};height:${pct(1 + 2 * SOBRA)};transform-origin:0 0;will-change:transform">
    <svg id="lienzo" xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid meet" touch-action="none"></svg>
    <svg class="lienzo-gps" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"
      preserveAspectRatio="xMidYMid meet"><g id="capa-gps" class="capa-gps"></g></svg></div>`;
  svg = contenedor.querySelector('#lienzo');
  svgGps = contenedor.querySelector('.lienzo-gps');
  gpsAncho = 0;          // capa nueva y vacía: se llena con el primer encuadre
  capa = contenedor.querySelector('.lienzo-capa');
  caja0 = contenedor;
  pintada = null;
  svg.addEventListener('pointerdown', abajo);
  svg.addEventListener('pointermove', movimiento);
  svg.addEventListener('pointerup', arriba);
  svg.addEventListener('pointercancel', arriba);
  svg.addEventListener('lostpointercapture', arriba);
  svg.addEventListener('wheel', rueda, { passive: false });
  // Mantener el dedo sobre el plano es un gesto de la app (mover un
  // lote), no del navegador. Sin esto, en el celular salía el menú de
  // "Copiar imagen / Descargar imagen" de la foto de fondo, incluso con
  // la app instalada, porque por dentro sigue siendo el navegador.
  svg.addEventListener('contextmenu', (ev) => ev.preventDefault());
  ponerRed();
}

export function encuadrar() {
  const m = 24;
  vista = {
    x: -m, y: -m,
    w: (Number(datos.config.ancho) || 1000) + m * 2,
    h: (Number(datos.config.alto) || 700) + m * 2
  };
  aplicarVista();
}

export const centroVista = () => ({ x: vista.x + vista.w / 2, y: vista.y + vista.h / 2 });

// ------------------------------------------------------------ ir hasta
// Cuánto ocupa una figura a cada lado de su centro. Con giro se usa la
// diagonal: una figura girada 45° ocupa más que su ancho.
function radioDe(o) {
  let rx = o.rx, ry = o.ry;
  if (o.forma === 'poligono') {
    const ps = listaPuntos(o);
    rx = Math.max(...ps.map((p) => Math.abs(p.x)));
    ry = Math.max(...ps.map((p) => Math.abs(p.y)));
  }
  if (o.rot) { const d = Math.hypot(rx, ry); return { x: d, y: d }; }
  return { x: rx, y: ry };
}

let animacion = 0;
const menosMovimiento = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// El encuadre se desliza en vez de saltar: si el plano cambia de golpe,
// nadie sabe hacia dónde se movió ni de dónde venía.
function deslizarHasta(destino, ms = 420) {
  cancelAnimationFrame(animacion);
  if (menosMovimiento()) { vista = destino; aplicarVista(); return; }
  const desde = { ...vista }, t0 = performance.now();
  const suave = (t) => 1 - (1 - t) ** 3;
  const paso = (ahora) => {
    const k = Math.min((ahora - t0) / ms, 1), e = suave(k);
    vista = { x: desde.x + (destino.x - desde.x) * e, y: desde.y + (destino.y - desde.y) * e,
              w: desde.w + (destino.w - desde.w) * e, h: desde.h + (destino.h - desde.h) * e };
    if (k < 1) { verVista(); animacion = requestAnimationFrame(paso); } else aplicarVista();
  };
  animacion = requestAnimationFrame(paso);
}

// Encuadra el plano sobre un conjunto de figuras. Se usa al buscar: en
// vez de decir dónde está el lote, el plano va hasta él.
export function enfocar(objs, { margen = 90, animar = true } = {}) {
  if (!objs?.length || !svg) return;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const o of objs) {
    const r = radioDe(o);
    x1 = Math.min(x1, o.x - r.x); x2 = Math.max(x2, o.x + r.x);
    y1 = Math.min(y1, o.y - r.y); y2 = Math.max(y2, o.y + r.y);
  }
  const caja = { x: x1 - margen, y: y1 - margen,
                 w: (x2 - x1) + margen * 2, h: (y2 - y1) + margen * 2 };

  // El lienzo dibuja con "meet", así que si la caja no tiene su misma
  // proporción sobra espacio por un lado y la figura queda descentrada.
  const r = cajaLienzo();
  const prop = r.height / Math.max(r.width, 1);
  if (caja.h / caja.w < prop) {
    const h = caja.w * prop; caja.y -= (h - caja.h) / 2; caja.h = h;
  } else {
    const w = caja.h / prop; caja.x -= (w - caja.w) / 2; caja.w = w;
  }
  // Un solo lote no puede llenar la pantalla: sin nada alrededor, saber
  // dónde está no sirve de nada.
  const minimo = 320;
  if (caja.w < minimo) {
    const f = minimo / caja.w;
    caja.x -= caja.w * (f - 1) / 2; caja.y -= caja.h * (f - 1) / 2;
    caja.w *= f; caja.h *= f;
  }
  if (animar) deslizarHasta(caja); else { vista = caja; aplicarVista(); }
}
export const limpiarSeleccion = () => { seleccion = null; pintarYa(); };
export const seleccionar = (tipo, id) => { seleccion = { tipo, id }; pintarYa(); };
export const haySeleccion = () => seleccion;

// Modo edición: un toque basta para seleccionar, sin mantener presionado
let modoEdicion = false;
export function editar(activo) {
  modoEdicion = activo;
  if (!activo) seleccion = null;
  pintarYa();
}
export const enEdicion = () => modoEdicion;

// Repinta AHORA, aunque haya un gesto en curso.
//
// `pintar` aplaza los repintados que llegan de fuera durante un gesto,
// porque rehacer el SVG destruiría el nodo que se está arrastrando. Pero
// los repintados que pide el propio mapa —mientras se estira, se gira o
// se mueve un vértice— son justamente lo que hay que ver: aplazarlos
// dejaba a la persona ajustando a ciegas hasta soltar el dedo.
//
// Lo que llegó de fuera NO se descarta: sigue esperando su turno al final
// del gesto.
let repintadoPropio = false;
function pintarYa() {
  repintadoPropio = true;
  try { pintar(datos); } finally { repintadoPropio = false; }
}

// --------------------------------------------------------------- dibujo
// Interactuando = hay un gesto de verdad en curso. Repintar en ese momento
// destruye el nodo que se está arrastrando y produce el parpadeo.
// Se mira SOLO el modo, no los punteros: un puntero que quedó apuntado
// por un gesto interrumpido dejaba el mapa congelado para siempre.
// Y si el lienzo ya no está en la página, nada puede impedir el dibujo.
const interactuando = () => !repintadoPropio && modo !== 'ninguno' && !!svg && svg.isConnected;

export function pintar(d) {
  if (interactuando()) { repintadoPendiente = d; return; }
  datos = d;
  // solo un repintado de verdad cancela lo que estaba en espera; uno
  // propio del gesto no puede tragarse los datos nuevos que llegaron
  if (!repintadoPropio) repintadoPendiente = null;
  if (!svg.getAttribute('viewBox')) encuadrar();
  const c = datos.config;
  // `naciendo` es el lote que la volqueta está descargando en la capa de
  // encima: no se dibuja hasta que el material cae, o se vería aparecer
  // antes de que lo traigan.
  // Un grupo de bigbags ocupa lo que dicen su cantidad y su reparto, no
  // el rx/ry que quedó guardado: los guardados antes de achicar los
  // bigbags al 60 % traían el tamaño viejo, y el halo, el dedo y el
  // código caían lejos del grupo.
  for (const l of datos.lotes) if (esGrupoBigbags(l)) {
    const dd = Dib.disposicionBigbags(l.bigbags, l.bigbags_fila);
    l.rx = dd.rx; l.ry = dd.ry;
  }
  const sueltos = datos.lotes.filter((l) => !l.pila_id && !fuera(l) && l.id !== datos.naciendo);
  apilado = calcularApilado(sueltos);
  const pilasVivas = datos.pilas.filter((p) => p.estado === 'abierta');

  const dibujo = `
    <defs>
      <pattern id="reticula" width="50" height="50" patternUnits="userSpaceOnUse">
        <path d="M50 0H0V50" fill="none" stroke="#14171a" stroke-width="1" opacity=".07"/>
      </pattern>${Dib.DEFS}
    </defs>
    <rect x="${-1e4}" y="${-1e4}" width="${3e4}" height="${3e4}" fill="${esc(c.color_fondo || '#e4e7e2')}"/>
    ${c.imagen_url ? `<image class="fondo-plano" href="${esc(c.imagen_url)}" x="${c.imagen_x}" y="${c.imagen_y}"
        width="${c.imagen_ancho}" height="${c.imagen_alto}"
        opacity="${c.imagen_opacidad ?? 1}" preserveAspectRatio="none"/>` : ''}
    ${c.imagen_url ? '' : `<rect x="0" y="0" width="${c.ancho}" height="${c.alto}" fill="url(#reticula)"/>`}
    <rect x="0" y="0" width="${c.ancho}" height="${c.alto}"
          fill="none" stroke="#14171a" stroke-width="2" stroke-dasharray="10 8" opacity=".3"/>
    ${datos.figuras.map(figuraFondo).join('')}
    ${capasPila(pilasVivas, datos.lotes)}
    <g class="atenuado">${capasLote(sueltos.filter((l) => tenue(l.id)))}</g>
    ${capasLote(sueltos.filter((l) => !tenue(l.id)))}
    ${recorrido(datos.recorrido)}
    ${seleccion ? manijas() : ''}`;

  // Si sale exactamente el mismo plano, no se toca el SVG.
  //
  // La app se sincroniza cada 20 segundos y casi siempre no ha cambiado
  // nada, pero el repintado rearmaba igual el plano entero: cientos de
  // figuras destruidas y vueltas a crear, con su parpadeo. Y si caía
  // mientras alguien arrastraba el plano, se quedaba esperando y el
  // parpadeo saltaba justo al levantar el dedo, que es donde más se nota.
  //
  // Se compara el TEXTO ya armado y no los datos: armarlo cuesta unos
  // milisegundos y no puede equivocarse: si el dibujo es idéntico, la
  // pantalla ya lo está mostrando. Con una firma de los datos habría que
  // acertar qué campos entran, y olvidar uno significa cambios que se
  // guardan pero no se ven nunca.
  if (dibujo === ultimoDibujo) return;
  ultimoDibujo = dibujo;
  // La capa del GPS NO va aquí: ver ponerGps.
  svg.innerHTML = dibujo;
}

// ------------------------------------------------------------------ GPS
// Quién está dónde, ya en coordenadas del plano. Lo calcula la app; aquí
// solo se dibuja:
//   { yo: {x, y, radio, viejo}, otros: [{x, y, nombre, viejo}],
//     marcas: [{x, y, etiqueta}] }   ← los puntos de una calibración
let gps = null;
let gpsAncho = 0;                     // con qué zoom se dibujó la capa

// Mientras el dedo está abajo, la posición nueva espera a que se suelte.
// Llega cada segundo, y cada vez la tarjeta gráfica tenía que volver a
// preparar la capa a mitad del gesto: con la CPU frenada 6 veces eran
// tirones de 50 a 120 ms en pleno pellizco. Un punto que se queda quieto
// el segundo o dos que dura un gesto no se nota.
let gpsPendiente = false;
export function pintarGps(g) {
  gps = g;
  if (modo !== 'ninguno') { gpsPendiente = true; return; }
  ponerGps();
}
function gpsAlSoltar() {
  if (gpsPendiente && modo === 'ninguno') ponerGps();
}

// Solo se toca la capa, nunca el plano.
//
// Y la capa ni siquiera vive dentro del plano: es otro <svg>, encima, con
// el mismo encuadre y su propia capa en la tarjeta gráfica. Dentro del
// plano, cualquier cambio en ella —el punto que se mueve cada segundo, y
// sobre todo el latido del punto azul, que es una animación que no
// para— obligaba a volver a pintar el plano ENTERO, en cada cuadro.
// Medido con la CPU frenada 6 veces: con el GPS prendido el mapa iba a
// la mitad de cuadros, quieto o moviéndolo.
function ponerGps() {
  gpsPendiente = false;
  const n = svgGps?.querySelector('#capa-gps');
  if (n) n.innerHTML = capaGps();
}

// Los puntos se miden en PÍXELES DE PANTALLA, como las manijas: el punto
// de una persona no puede volverse una mota al alejar ni un plato al
// acercar. El círculo de precisión sí va en unidades del plano, porque
// es una distancia de verdad sobre el patio.
function capaGps() {
  if (!gps || !svg) return '';
  gpsAncho = vista.w;
  const u = unidadesPorPixel();
  const n = (v) => +v.toFixed(1);
  const marcas = (gps.marcas || []).map((m) => `<g class="gps-marca${m.mala ? ' gps-marca-mala' : ''}${
      m.pendiente ? ' gps-marca-pendiente' : ''}">
      <circle cx="${n(m.x)}" cy="${n(m.y)}" r="${n(11 * u)}" stroke-width="${n(3 * u)}"/>
      <text x="${n(m.x)}" y="${n(m.y + 4.5 * u)}" text-anchor="middle"
        font-size="${n(13 * u)}">${esc(m.etiqueta)}</text></g>`).join('');
  const otros = (gps.otros || []).map((o) => `<g class="gps-otro${o.viejo ? ' gps-viejo' : ''}">
      <circle cx="${n(o.x)}" cy="${n(o.y)}" r="${n(7 * u)}" stroke-width="${n(2.5 * u)}"/>
      <text x="${n(o.x)}" y="${n(o.y - 13 * u)}" text-anchor="middle"
        font-size="${n(12.5 * u)}" stroke-width="${n(3.5 * u)}">${esc(o.nombre)}</text></g>`).join('');
  const y = gps.yo;
  const yo = y ? `<g class="gps-yo${y.viejo ? ' gps-viejo' : ''}">
      ${y.radio > 0 ? `<circle class="gps-precision" cx="${n(y.x)}" cy="${n(y.y)}" r="${n(y.radio)}"/>` : ''}
      <circle class="gps-punto" cx="${n(y.x)}" cy="${n(y.y)}" r="${n(8 * u)}" stroke-width="${n(3 * u)}"/>
    </g>` : '';
  return marcas + otros + yo;
}

// Al acercar o alejar, los puntos se quedarían con el tamaño del zoom
// anterior hasta la siguiente lectura del GPS. Se vuelven a dibujar en
// cuanto el zoom cambia de verdad —no en cada cuadro del pellizco—, y
// son cuatro círculos: no cuesta nada.
function gpsAlZoom() {
  if (gps && Math.abs(vista.w - gpsAncho) > gpsAncho * .12) ponerGps();
}

// Marcar un punto del plano con un toque. Lo usa la calibración: el
// admin se para en un sitio y toca dónde queda ese sitio en el dibujo.
// Mientras esté puesto, un toque NO abre fichas: marca. Desplazar y
// acercar siguen funcionando igual, para poder buscar el sitio.
let marcador = null;
export function alMarcar(fn) { marcador = fn || null; }
// Qué está pintado ahora mismo. Se vacía al montar: el lienzo es otro y
// está en blanco, así que hay que volver a dibujarlo aunque toque lo
// mismo que había en el anterior.
let ultimoDibujo = '';

// Los lotes se dibujan en TRES pasadas: todos los contornos, encima
// todos los rellenos, y encima todos los rótulos.
//
// Los contornos abajo son lo que borra la línea negra donde dos círculos
// se cruzan: el relleno de cualquier lote tapa el trazo de los demás, y
// dos lotes que se tocan se leen como un solo montón de material, que es
// lo que son en el patio. El trazo va al DOBLE de grueso a propósito,
// porque el trazo del SVG está centrado en el borde y su propio relleno
// le come la mitad de adentro: a la vista queda el grosor de siempre.
//
// Los rótulos arriba del todo son la otra cara de lo mismo: con el
// rótulo dentro de su lote, el relleno del vecino se comía el código a
// medias y quedaba media palabra tapada. Ningún relleno se dibuja ya por
// encima de un código.
function capasLote(ls) {
  // El lote señalado va al final: su aro de "aquí está" tiene que quedar
  // por encima de los vecinos que lo toquen, no debajo.
  const orden = ls.filter((l) => l.id !== datos.resaltado)
    .concat(ls.filter((l) => l.id === datos.resaltado));
  // Los bigbags MONTADOS sobre otro lote van en una pasada aparte, al
  // final y en el orden en que se montaron: están más arriba que todo lo
  // que hay en el piso, y el de encima tapa al de abajo.
  const montado = (l) => !!apilado.get(l.id)?.abajo;
  const piso = orden.filter((l) => !montado(l));
  const arriba = orden.filter(montado).sort((a, b) => apilado.get(a.id).orden - apilado.get(b.id).orden);
  const pasada = (xs) => xs.map((l) => figuraLote(l, 'trazo')).join('')
    + xs.map((l) => figuraLote(l, 'relleno')).join('');
  return pasada(piso) + arriba.map((l) => figuraLote(l, 'trazo') + figuraLote(l, 'relleno')).join('')
    + orden.map((l) => figuraLote(l, 'rotulo')).join('');
}

// ------------------------------------------------- bigbags montados
// Un lote de bigbags puede ir MONTADO sobre otro (lotes.sobre_lote): sus
// bigbags llenan las columnas del de abajo sin pasar de 3 de alto. No es
// una pila: cada lote sigue siendo suelto y con su código.
//
// `apilado` dice, para cada lote visible:
//   { abajo, cols, orden }   si va montado: sobre qué lote del piso y en
//                            qué columnas y niveles quedaron sus bigbags
//   { carga: n }             si en el piso y tiene n lotes montados encima
let apilado = new Map();
function calcularApilado(visibles) {
  const porId = new Map(visibles.map((l) => [l.id, l]));
  const res = new Map();
  // el lote del piso de cada montaje, y a qué profundidad está cada uno
  const raiz = (l) => {
    let x = l, prof = 0; const vistos = new Set();
    while (x.sobre_lote && porId.has(x.sobre_lote) && !vistos.has(x.id)) {
      vistos.add(x.id); x = porId.get(x.sobre_lote); prof++;
    }
    return { r: x, prof };
  };
  const grupos = new Map();
  for (const l of visibles) {
    if (!l.sobre_lote || !esGrupoBigbags(l)) continue;
    const { r, prof } = raiz(l);
    if (r.id === l.id || !esGrupoBigbags(r)) continue;
    if (!grupos.has(r.id)) grupos.set(r.id, []);
    grupos.get(r.id).push({ l, prof });
  }
  let orden = 0;
  for (const [rid, encima] of grupos) {
    encima.sort((a, b) => a.prof - b.prof || String(a.l.id).localeCompare(String(b.l.id)));
    const reparto = Dib.repartirEncima(porId.get(rid), encima.map((e) => e.l));
    let n = 0;
    for (const { l } of encima) {
      const cols = reparto.get(l.id);
      if (cols) res.set(l.id, { abajo: porId.get(rid), cols, orden: orden++, k: n++ });
    }
    if (n) res.set(rid, { carga: n });
  }
  return res;
}
const visiblesEnPiso = () => datos.lotes.filter((l) => !l.pila_id && !fuera(l));
// Lo que la app necesita saber para decidir al soltar un lote encima de otro.
export function cabeEncima(lote, sobre) {
  const prueba = visiblesEnPiso().filter((l) => l.id !== lote.id)
    .concat({ ...lote, sobre_lote: sobre.id });
  return !!calcularApilado(prueba).get(lote.id)?.abajo;
}
export function encimaDe(id) {
  return [...calcularApilado(visiblesEnPiso())].filter(([, v]) => v.abajo?.id === id).map(([k]) => k);
}
export const tieneCarga = (id) => !!calcularApilado(visiblesEnPiso()).get(id)?.carga;
export function montadoSobre(id) {
  return calcularApilado(visiblesEnPiso()).get(id)?.abajo?.id || null;
}

// Las pilas se dibujan una a una, con su cerco. Hubo una versión que
// las pasaba por una MÁSCARA para que dos pilas que se cruzan se leyeran
// como un mismo cerco, y de paso para que el contorno de un lote no
// cruzara por dentro de una pila.
//
// Se quitó: en un teléfono de verdad esa capa se quedaba en blanco de
// vez en cuando durante el pellizco. En las capturas del patio se ve
// clavado —un cuadro con contornos y cercos, el siguiente sin NINGUNO de
// los dos, varias veces por segundo—, y esas dos cosas eran justo lo que
// vivía dentro de la máscara. Una máscara obliga al navegador a dibujar
// esa capa aparte y a rehacerla en cada cambio de escala; cuando no
// llega a tiempo, la deja vacía. Aquí no se reproducía porque este
// navegador dibuja por software.
//
// Lo que se pierde es que un lote se funda con la pila de debajo y que
// dos pilas se fundan entre sí. Lo que NO se pierde es lo importante:
// los lotes se siguen fundiendo entre ellos, que se hace con el orden de
// las capas y no necesita máscara ninguna.
function capasPila(ps, lotes) {
  return ps.map((p) => figuraPila(p, lotes)).join('');
}

const trazo = (o) => `transform="translate(${o.x} ${o.y}) rotate(${o.rot || 0})"`;
const apagado = (id) => (datos.destacados && !datos.destacados.has(id)) ? ' atenuado' : '';
const tenue = (id) => !!apagado(id);

// Vértices por defecto de un polígono, derivados del tamaño actual
export function puntosPorDefecto(rx, ry, n = 6) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { x: +(Math.cos(a) * rx).toFixed(1), y: +(Math.sin(a) * ry).toFixed(1) };
  });
}
const listaPuntos = (o) => (o.puntos && o.puntos.length >= 3)
  ? o.puntos : puntosPorDefecto(o.rx, o.ry);

// Polígono con las esquinas suavizadas: el radio de cada esquina se
// limita al lado más corto que la toca, para que nunca se deforme.
export function rutaRedondeada(ps, maxR = 18) {
  const n = ps.length;
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = ps[(i - 1 + n) % n], b = ps[i], c = ps[(i + 1) % n];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const l2 = Math.hypot(c.x - b.x, c.y - b.y) || 1;
    const r = Math.min(maxR, l1 * 0.35, l2 * 0.35);
    const e = { x: b.x + ((a.x - b.x) / l1) * r, y: b.y + ((a.y - b.y) / l1) * r };
    const f = { x: b.x + ((c.x - b.x) / l2) * r, y: b.y + ((c.y - b.y) / l2) * r };
    d += `${i ? 'L' : 'M'}${e.x.toFixed(1)} ${e.y.toFixed(1)} Q${b.x.toFixed(1)} ${b.y.toFixed(1)} ${f.x.toFixed(1)} ${f.y.toFixed(1)} `;
  }
  return d + 'Z';
}

// Cuerpo de una figura en coordenadas locales
function cuerpo(o, attrs) {
  if (o.forma === 'poligono')
    return `<path d="${rutaRedondeada(listaPuntos(o))}" ${attrs}/>`;
  if (o.forma === 'rectangulo')
    return `<rect x="${-o.rx}" y="${-o.ry}" width="${o.rx * 2}" height="${o.ry * 2}" rx="5" ${attrs}/>`;
  return `<ellipse rx="${o.rx}" ry="${o.ry}" ${attrs}/>`;
}

// Anillo de "aquí está": dos copias de la misma forma, sin relleno,
// dibujadas DEBAJO de la figura. La figura tapa la mitad interior del
// trazo, así que lo que se ve es un aro por fuera. Van dos porque uno
// solo no sirve: el aro amarillo se pierde sobre un lote que ya es
// amarillo, y el negro se pierde sobre una foto oscura. Juntos —negro a
// rayas sobre amarillo— es cinta de peligro, y se ve sobre lo que sea.
function halo(o) {
  return cuerpo(o, 'class="halo-hallazgo" fill="none"')
       + cuerpo(o, 'class="halo-rayas" fill="none"');
}

// ------------------------------------------------- texto dentro de figura
// El rótulo va DENTRO de la figura, así que su tamaño no puede ser fijo:
// depende de lo grande que sea la figura y de lo largo que sea el texto.
// Con un tamaño fijo, un código como SJ1015.2 se salía por los lados de
// su óvalo y "CASETA" quedaba minúscula dentro de una caseta enorme.

// Dónde se ancla el rótulo. En elipse y rectángulo, el origen. En un
// polígono, el centro de sus vértices: al arrastrarlos deja de estar en
// el origen, y el rótulo se quedaba colgado fuera de la figura.
function anclaTexto(o) {
  if (o.forma !== 'poligono') return { x: 0, y: 0 };
  const ps = listaPuntos(o);
  return { x: ps.reduce((a, p) => a + p.x, 0) / ps.length,
           y: ps.reduce((a, p) => a + p.y, 0) / ps.length };
}

// ¿Cabe el rectángulo de centro (cx, cy) y medio ancho/alto (a, b)
// dentro del polígono `ps`? Basta con que el centro quede adentro y que
// ningún lado del polígono toque el rectángulo. Mirar solo las esquinas
// no alcanza: en una pila con un entrante (una L, una media luna) las
// cuatro quedan adentro con el borde metido en medio del texto.
function rectanguloDentro(ps, cx, cy, a, b) {
  const x0 = cx - a, x1 = cx + a, y0 = cy - b, y1 = cy + b;
  let dentro = false;
  for (let i = 0, j = ps.length - 1; i < ps.length; j = i++) {
    const [px, py] = ps[i], [qx, qy] = ps[j];
    if ((py > cy) !== (qy > cy) && cx < qx + (cy - qy) * (px - qx) / (py - qy)) dentro = !dentro;
    // recorte de Liang-Barsky: ¿algún tramo del lado cae en el rectángulo?
    const dx = px - qx, dy = py - qy;
    let t0 = 0, t1 = 1, toca = true;
    for (const [pp, q] of [[-dx, qx - x0], [dx, x1 - qx], [-dy, qy - y0], [dy, y1 - qy]]) {
      if (pp === 0) { if (q < 0) { toca = false; break; } continue; }
      const r = q / pp;
      if (pp < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
      if (t0 > t1) { toca = false; break; }
    }
    if (toca) return false;
  }
  return dentro;
}

// El ancho de un texto se sabe sin medirlo si se conoce cuánto avanza
// cada carácter. La monoespaciada de los códigos avanza ~0.6 em; la
// etiqueta del fondo va en versalitas espaciadas y avanza ~0.72.
//
// El tamaño es el MAYOR que deja el bloque de texto entero —con su filo
// negro y un margen— dentro de la forma DE VERDAD, girada como esté. Antes
// se medía contra la caja del polígono, y una pila larga y en diagonal
// tiene una caja enorme: "PILA 1 (ARENAS)" salía a tope y cruzaba el
// montón de lado a lado. `max` es el techo: un código de tres letras en
// un lote grande no se vuelve un titular. `min` es el suelo legible: si
// ni así cabe, prefiere sobresalir un poco a volverse invisible.
const FILO = .22;   // el trazo negro del pintado, en em (ver Dib.pintado)
//
// `giro` (grados, en el marco de la figura) mide el texto girado: se
// gira la figura al revés alrededor del ancla y se mide derecho.
//
// `centro` (opcional, en el marco de la figura) mide el bloque puesto en
// otro sitio que el ancla: así se busca dónde le cabe más grande.
//
// El resultado se RECUERDA: depende solo de la forma, del texto y de las
// opciones, y el plano se vuelve a armar en cada sincronización, cada
// búsqueda y cada cambio de estado. Medido con la CPU frenada 6 veces,
// esta búsqueda (doce tanteos por rótulo, contra los 28 lados del óvalo)
// era casi todo lo que costaba armar el plano: ~270 ms por repintado con
// 150 lotes, aunque no hubiera cambiado nada.
const medidas = new Map();
function recordarMedida(clave, calcular) {
  let v = medidas.get(clave);
  if (v === undefined) {
    if (medidas.size > 4000) medidas.clear();
    v = calcular();
    medidas.set(clave, v);
  }
  return v;
}
// lo que define la forma de una figura en su propio marco
const firmaForma = (o) => o.forma === 'poligono'
  ? 'p' + listaPuntos(o).map((q) => `${q.x},${q.y}`).join(';')
  : `${o.forma === 'rectangulo' ? 'r' : 'e'}${o.rx},${o.ry}`;
function tamanoTexto(o, texto, op) {
  const c = op.centro;
  return recordarMedida(`t|${firmaForma(o)}|${texto}|${op.min}|${op.max}|${op.lineas ?? 1}|${
    op.paso ?? .6}|${op.margen ?? 5}|${op.giro ?? 0}|${c ? `${c.x},${c.y}` : ''}`,
    () => medirTexto(o, texto, op));
}
function medirTexto(o, texto, { min, max, lineas = 1, paso = .6, margen = 5, giro = 0, centro = null }) {
  const c = centro || anclaTexto(o), g = -giro * Math.PI / 180, cs = Math.cos(g), sn = Math.sin(g);
  const ps = verticesDe(o).map(([x, y]) => giro
    ? [c.x + (x - c.x) * cs - (y - c.y) * sn, c.y + (x - c.x) * sn + (y - c.y) * cs] : [x, y]);
  const em = Math.max(String(texto).length, 1) * paso + FILO;
  // alto de los renglones: mayúsculas y paréntesis, sin el aire de abajo
  const alto = lineas * .9 + FILO;
  const cabe = (t) => rectanguloDentro(ps, c.x, c.y, t * em / 2 + margen, t * alto / 2 + margen);
  if (cabe(max)) return max;
  if (!cabe(min)) return min;
  let bajo = min, alto2 = max;
  for (let i = 0; i < 12; i++) {
    const m = (bajo + alto2) / 2;
    if (cabe(m)) bajo = m; else alto2 = m;
  }
  return +bajo.toFixed(1);
}

function figuraFondo(f) {
  return `<g data-tipo="figura" data-id="${esc(f.id)}" ${trazo(f)} class="g-fondo${apagado(f.id)}">
    ${cuerpo(f, `fill="${esc(f.color)}" opacity=".85"`)}
    ${f.etiqueta ? (() => {
      const c = anclaTexto(f);
      const t = tamanoTexto(f, f.etiqueta, { min: 9, max: 38, paso: .72 });
      return `<text x="${c.x}" y="${c.y + t * .34}" text-anchor="middle" class="txt-fondo"
        font-size="${t}">${esc(f.etiqueta)}</text>`;
    })() : ''}
  </g>`;
}

// Vértices locales de una figura, sea cual sea su forma, para dibujarla
// como montón. Una pila dibujada como óvalo o rectángulo (las de antes)
// sale igual de bien que una de polígono.
function verticesDe(o) {
  if (o.forma === 'poligono') return listaPuntos(o).map((p) => [p.x, p.y]);
  if (o.forma === 'rectangulo') return [[-o.rx, -o.ry], [o.rx, -o.ry], [o.rx, o.ry], [-o.rx, o.ry]];
  return Array.from({ length: 28 }, (_, i) => {
    const a = (i / 28) * Math.PI * 2;
    return [+(Math.cos(a) * o.rx).toFixed(1), +(Math.sin(a) * o.ry).toFixed(1)];
  });
}

// La pila es UN montón con la forma de sus vértices y no muestra los
// lotes de adentro (ver dibujo.js, montonPila). Encima solo lleva su
// nombre, PINTADO sobre el material como el código de los lotes. Cuántos
// lotes tiene y de qué estados se ve al entrar a ella, en su ficha: en el
// plano no hace falta.
// Que en PANTALLA no quede cabeza abajo ni leyéndose de abajo arriba
// más de lo necesario: el ángulo final queda entre −90° y 90°.
const derecho = (giro, rot) => {
  let a = ((giro + rot) % 360 + 540) % 360 - 180;
  if (a > 90) a -= 180; else if (a <= -90) a += 180;
  return a - rot;
};

// El nombre de la pila va SIEMPRE derecho en pantalla, aunque la pila
// esté girada: torcido o de canto se lee mal, y un nombre largo cabe
// mejor partido en 2, 3 o 4 renglones que girado y diminuto. Se prueban
// los renglones y, para cada uno, varios sitios dentro del montón —en
// un triángulo la parte ancha, no el centro de sus vértices—, y gana lo
// que deja la letra más grande. Cada prueba se mide sin suelo, para que
// una pila angosta no empate todo en el mínimo y se quede con un solo
// renglón que se sale por los dos lados. A casi igualdad (8 %), menos
// renglones y más cerca del centro.
//
// Techo 22: el nombre es un rótulo, no un titular. Suelo 8: en una pila
// muy angosta, mejor chico y adentro.
const PILA_MIN = 8, PILA_MAX = 22;
function rotuloPila(p) {
  return recordarMedida(`r|${firmaForma(p)}|${p.rot || 0}|${p.codigo}`, () => calcularRotuloPila(p));
}
function calcularRotuloPila(p) {
  const rot = p.rot || 0, texto = `PILA ${p.codigo}`;
  const giro = derecho(-rot, rot);
  const ps = verticesDe(p), a = anclaTexto(p);
  const xs = ps.map((q) => q[0]), ys = ps.map((q) => q[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  // el ancla primero: a igualdad, se queda en el centro
  const sitios = [a];
  const N = 6;
  for (let i = 1; i < N; i++) for (let j = 1; j < N; j++) {
    const s = { x: x0 + (x1 - x0) * i / N, y: y0 + (y1 - y0) * j / N };
    if (rectanguloDentro(ps, s.x, s.y, .01, .01)) sitios.push(s);
  }
  const op = { min: 3, max: PILA_MAX, paso: .68, margen: 6, giro };
  const palabras = Dib.partirEnRenglones(texto, 99).length;
  let mejor = null;
  for (let n = 1; n <= Math.min(4, palabras); n++) {
    const lineas = Dib.partirEnRenglones(texto, n);
    const largo = lineas.reduce((x, y) => (y.length > x.length ? y : x), '');
    for (const centro of sitios) {
      const t = tamanoTexto(p, largo, { ...op, lineas: lineas.length * Dib.INTERLINEA, centro });
      if (!mejor || t > mejor.t * 1.08) mejor = { lineas, t, giro, c: centro };
    }
  }
  return { ...mejor, t: Math.max(PILA_MIN, mejor.t) };
}

function figuraPila(p, lotes) {
  const n = lotes.filter((l) => l.pila_id === p.id).length;
  const col = paleta()[`pila_${p.tipo}`] || '#14171a';
  const m = Dib.montonPila(verticesDe(p), n, col);
  const { lineas, t, giro, c } = rotuloPila(p);
  return `<g data-tipo="pila" data-id="${esc(p.id)}" ${trazo(p)} class="g-pila${apagado(p.id)}${datos.resaltado === p.id ? ' g-resaltado' : ''}">
    ${datos.resaltado === p.id ? halo(p) : ''}
    <g class="cuerpo-lote">${m.svg}</g>
    <g class="rotulo-mapa"${Math.abs(giro) > .5 ? ` transform="rotate(${+giro.toFixed(1)} ${c.x} ${c.y})"` : ''}>${
      Dib.pintado(lineas.map(esc), t, c.x, c.y + t * .35, { espaciado: .08, clase: 'txt-pila' })}</g>
  </g>`;
}

// El aspecto de un lote según su forma: rectángulo es bigbag; óvalo y
// polígono son material a granel. Lo comparte la volqueta, que deja en
// el piso exactamente el montón que después queda en el plano.
// Un lote de bigbags con CANTIDAD se dibuja como su grupo de columnas;
// uno sin cantidad (los de antes) sigue siendo un solo saco.
export const esGrupoBigbags = (l) => l.forma === 'rectangulo' && Number(l.bigbags) > 0;
export const disposicionBigbags = Dib.disposicionBigbags;
export const ALTO_BIGBAGS = Dib.ALTO_BIGBAGS;
function aspectoLote(l, col) {
  if (esGrupoBigbags(l)) return Dib.grupoBigbags(l, col);
  if (l.forma === 'rectangulo') return Dib.bigbag(l, col);
  return Dib.granel(l.forma === 'poligono' ? { ...l, puntos: listaPuntos(l) } : l, col);
}
const colorLote = (l) => {
  // El compromiso de recogida solo existe mientras el lote es devolución:
  // si pasó a otro estado, la fecha que quedó guardada ya no compromete a
  // nadie y no hay nada que avisar.
  const venc = l.estado === 'devolucion' && !!l.fecha_recogida && l.fecha_recogida < hoyISO();
  // Una devolución sin recoger se pinta NEGRA, entera: en un patio de
  // ciento y pico lotes de colores parecidos, el negro salta a la vista
  // desde el otro lado del plano sin tener que mirar figura por figura.
  return venc ? '#14171a' : (paleta()[l.estado] || '#5f6863');
};
export function dibujoLote(l) {
  const a = aspectoLote(l, colorLote(l));
  return `<g ${trazo(l)}>${a.base}${a.cuerpo}</g>`;
}

// Un lote sale tres veces, una por capa: base (sombra y filo), cuerpo y
// rótulo. Las tres llevan data-id, así que el dedo da con el lote caiga
// donde caiga, y arrastrarlo las mueve todas. Lo de adentro va en un
// grupo aparte (.cuerpo-lote) porque el transform del grupo de afuera
// es la posición: levantar el lote al moverlo se hace en el de adentro.
function figuraLote(l, capa) {
  const col = colorLote(l);
  const ap = apilado.get(l.id);
  // montado: va donde está el de abajo, con su giro
  const marca = `data-tipo="lote" data-id="${esc(l.id)}" ${trazo(ap?.abajo || l)}
    class="g-lote${datos.resaltado === l.id ? ' g-resaltado' : ''}"`;
  const a = ap?.abajo ? Dib.bigbagsEncima(ap.cols, col, l.id) : aspectoLote(l, col);

  if (capa === 'trazo') return `<g ${marca}><g class="cuerpo-lote">${a.base}</g></g>`;
  if (capa === 'relleno') {
    return `<g ${marca}>
      ${datos.resaltado === l.id ? halo(l) : ''}
      <g class="cuerpo-lote">${a.cuerpo}</g>
    </g>`;
  }

  let c = anclaTexto(l);
  const { base, volqueta } = partesCodigo(l.codigo);
  // El suelo son 11 px: por debajo de eso un código deja de leerse a un
  // brazo de distancia. Un código absurdamente largo prefiere sobresalir
  // dos o tres píxeles de su óvalo a volverse ilegible.
  //
  // Para medir se cuentan las dos partes juntas —el exponente ocupa
  // menos, así que sobra sitio antes que faltar—, pero el punto o los
  // paréntesis ya no cuentan: por eso el código queda algo más grande
  // que antes.
  //
  // Un grupo de bigbags lleva el código ADENTRO, centrado y girado con
  // el grupo (nunca cabeza abajo). Probamos a ponerlo debajo del
  // grupo para no tapar los sacos, pero con varios grupos pegados ya no
  // se sabía de quién era cada código: el código tiene que estar sobre
  // SU grupo. Sin placa ni caja: el filo negro del pintado ya lo
  // despega de los sacos.
  //
  // Con lotes montados, todos los códigos del montaje van en un solo
  // bloque centrado, uno por renglón: arriba el último montado y abajo
  // el del piso, como quedan los bigbags.
  const piso = ap?.abajo || l;
  if (esGrupoBigbags(piso)) {
    const encima = [...apilado].filter(([, v]) => v.abajo?.id === piso.id)
      .sort((x, y) => y[1].k - x[1].k).map(([id]) => datos.lotes.find((x) => x.id === id)).filter(Boolean);
    const montaje = [...encima, piso];
    const codigos = montaje.map((x) => { const p = partesCodigo(x.codigo); return p.base + p.volqueta; });
    const largo = codigos.reduce((m, x) => (x.length > m.length ? x : m), '');
    // gira CON el grupo, así siempre cabe a lo largo de los sacos; solo
    // se voltea 180° si el giro lo dejaría cabeza abajo
    const giro = derecho(0, piso.rot || 0);
    const n = montaje.length;
    // Se centra en lo que OCUPAN los bigbags —el promedio de sus
    // columnas—, no en el centro de la caja: con la última fila a medias,
    // el centro de la caja cae entre huecos vacíos. Y se mide contra ese
    // mismo contorno.
    const d = Dib.disposicionBigbags(piso.bigbags, piso.bigbags_fila);
    const cx = +(d.pilas.reduce((a, q) => a + q.x, 0) / d.pilas.length).toFixed(1);
    const cy = +(d.pilas.reduce((a, q) => a + q.y, 0) / d.pilas.length).toFixed(1);
    const forma = { forma: 'poligono', puntos: d.contorno.map(([x, y]) => ({ x, y })) };
    const t = tamanoTexto(forma, largo, { min: 9, max: 18, lineas: n * Dib.INTERLINEA, giro, margen: 2,
                                          centro: { x: cx, y: cy } });
    const i = montaje.findIndex((x) => x.id === l.id);
    const y = cy + (i - (n - 1) / 2) * t * Dib.INTERLINEA;
    return `<g ${marca}><g class="cuerpo-lote rotulo-lote"><g transform="rotate(${+giro.toFixed(1)} ${cx} ${cy})">${
      Dib.pintado(esc(base), t, cx, y + t * .35, { volqueta: esc(volqueta), clase: 'txt-lote' })}</g></g></g>`;
  }
  const t = tamanoTexto(l, base + volqueta, { min: 11, max: 20 });
  // lleva lotes montados pero ya no es grupo (le cambiaron el material)
  if (ap?.carga) c = { x: 0, y: l.ry + t * .75 };
  // El código va PINTADO sobre el montón: letra blanca con filo negro,
  // como marcado con spray en el material. No lleva caja, así que no tapa
  // el relieve, y el filo lo hace legible sobre cualquier color de estado
  // y sobre la foto aérea.
  return `<g ${marca}><g class="cuerpo-lote rotulo-lote">${
    Dib.pintado(esc(base), t, c.x, c.y + t * .35, { volqueta: esc(volqueta), clase: 'txt-lote' })}</g></g>`;
}

const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function recorrido(puntos) {
  if (!puntos || puntos.length < 2) return '';
  const d = puntos.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
  return `<g class="recorrido">
    <path d="${d}" fill="none"/>
    ${puntos.map((p, i) => `<circle cx="${p.x}" cy="${p.y}" r="11"/>
      <text x="${p.x}" y="${p.y + 5}" text-anchor="middle">${i + 1}</text>`).join('')}
  </g>`;
}

function objeto(sel = seleccion) {
  if (!sel) return null;
  const lista = sel.tipo === 'lote' ? datos.lotes : sel.tipo === 'pila' ? datos.pilas : datos.figuras;
  return lista.find((o) => o.id === sel.id);
}

// Manijas: en polígono, un punto por vértice más los "+" para agregar.
//
// Se miden en PÍXELES DE PANTALLA, no en unidades del plano. Antes el
// tamaño salía de lo grande que fuera la figura, así que al achicar un
// lote la manija se achicaba con él: justo en el momento en que más
// falta hace agarrar bien, se volvía inagarrable y había que soltar y
// volver a buscarla. El dedo no cambia de tamaño con el zoom ni con el
// lote, y la manija tampoco.
function manijas() {
  const o = objeto();
  if (!o) return '';
  const u = unidadesPorPixel();
  const r = 13 * u;        // lo que se ve
  const zona = 23 * u;     // lo que responde al dedo, sin dibujarse
  const varilla = 40 * u;  // lo que sube la manija de girar sobre la figura

  // Cada manija es un grupo: un disco invisible que atrapa el dedo con
  // holgura y encima el que se ve. `closest('[data-handle]')` da con el
  // grupo, así que el dedo puede caer en cualquiera de los dos.
  const asa = (x, y, handle, { i, clase = 'manija', radio = r, holgura = zona } = {}) => `
    <g data-handle="${handle}"${i === undefined ? '' : ` data-i="${i}"`}>
      <circle cx="${x}" cy="${y}" r="${holgura}" class="manija-zona"/>
      <circle cx="${x}" cy="${y}" r="${radio}" class="${clase}"/>
    </g>`;

  if (o.forma === 'poligono') {
    const ps = listaPuntos(o);
    // Los "+" van con menos holgura que los vértices: están a media
    // arista, y con la misma zona se pisarían entre sí en un polígono
    // apretado y acabarías agregando un punto al querer mover otro.
    const medios = ps.map((p, i) => {
      const q = ps[(i + 1) % ps.length];
      return asa((p.x + q.x) / 2, (p.y + q.y) / 2, 'agregar',
        { i, clase: 'manija-mas', radio: r * .72, holgura: zona * .62 });
    }).join('');
    const arriba = -alto(ps);
    return `<g ${trazo(o)} class="manijas">
      <path d="${rutaRedondeada(ps)}" class="halo"/>
      ${medios}
      ${ps.map((p, i) => asa(p.x, p.y, 'vertice', { i })).join('')}
      <line x1="0" y1="${arriba}" x2="0" y2="${arriba - varilla}" class="varilla"/>
      ${asa(0, arriba - varilla, 'rotar')}
    </g>`;
  }

  // Un grupo de bigbags no se estira: cada bigbag mide lo mismo. Lo que
  // se ajusta es cómo se reparten las columnas, con una manija en el
  // borde derecho que, al arrastrarla, pone más o menos columnas por fila.
  if (seleccion.tipo === 'lote' && esGrupoBigbags(o)) {
    return `<g ${trazo(o)} class="manijas">
      ${cuerpo(o, 'class="halo"')}
      <line x1="${o.rx}" y1="0" x2="${o.rx + 16 * u}" y2="0" class="varilla"/>
      ${asa(o.rx + 16 * u, 0, 'columnas')}
      <line x1="0" y1="${-o.ry}" x2="0" y2="${-o.ry - varilla}" class="varilla"/>
      ${asa(0, -o.ry - varilla, 'rotar')}
    </g>`;
  }

  // La manija de tamaño se aparta un poco de la esquina para no tapar la
  // figura en un lote pequeño. Puede hacerlo porque el arrastre descuenta
  // dónde se agarró: la esquina sigue al dedo a esa misma distancia, sin
  // saltos.
  const aparte = 7 * u;
  return `<g ${trazo(o)} class="manijas">
    ${cuerpo(o, 'class="halo"')}
    ${asa(o.rx + aparte, o.ry + aparte, 'tamano')}
    <line x1="0" y1="${-o.ry}" x2="0" y2="${-o.ry - varilla}" class="varilla"/>
    ${asa(0, -o.ry - varilla, 'rotar')}
  </g>`;
}
const alto = (ps) => Math.max(...ps.map((p) => Math.abs(p.y)));

// ------------------------------------------------------------ geometría
function aPlano(ev) { return aPlanoPunto(ev.clientX, ev.clientY); }

// Dónde está el lienzo en la pantalla. Preguntarlo NO es gratis: obliga
// al navegador a recalcular la disposición en ese instante, con el plano
// entero por delante. Durante un gesto no se mueve, así que se pregunta
// una vez al apoyar el dedo y se guarda hasta soltarlo. Fuera de un gesto
// se pregunta cada vez, que es lo seguro: la caja cambia al girar el
// teléfono, al abrir el buscador o al cambiar de pestaña.
//
// La caja que cuenta es la VISIBLE, la del contenedor: el lienzo es más
// grande que ella (ver SOBRA) y, mientras el dedo arrastra, lleva además
// un transform que corre su rectángulo. La del lienzo solo queda de
// respaldo, cuando no hay contenedor que medir.
let caja = null;
const cajaLienzo = () => caja || medirCaja();
function medirCaja() {
  return caja0?.getBoundingClientRect ? caja0.getBoundingClientRect() : svg.getBoundingClientRect();
}

// De un punto de la PANTALLA a uno del PLANO, a mano.
//
// Antes se le pedía la matriz al navegador con getScreenCTM(), que
// también fuerza el recálculo. En mitad de un pellizco eso pasaba una vez
// por cada movimiento del dedo, y es de lo que más pesa cuando hay
// cientos de figuras. La cuenta es corta y no toca el DOM: con
// preserveAspectRatio "meet" la escala es la misma en los dos ejes y lo
// que sobra se reparte a los lados.
function aPlanoPunto(cx, cy, v = vista) {
  const r = cajaLienzo();
  const s = Math.min(r.width / v.w, r.height / v.h) || 1;
  return { x: v.x + (cx - r.left - (r.width - v.w * s) / 2) / s,
           y: v.y + (cy - r.top - (r.height - v.h * s) / 2) / s };
}
// Mover el plano SOLO cambia el viewBox. Antes, durante movimientos
// seguidos, se agregaba una clase que escondía y volvía a mostrar los
// códigos de los lotes para ahorrar composición de texto. En teléfonos
// reales ese cambio de `display` era peor: los rótulos, algunos bordes y
// hasta los controles flotantes parpadeaban como si el mapa prendiera y
// apagara una capa blanca. El mapa debe ser estable mientras se desplaza,
// así que no se toca ninguna clase: el navegador conserva la misma escena
// y solo recalcula el encuadre.
//
// Y aun así cambiar el viewBox es caro: el navegador vuelve a calcular,
// a grabar y a rasterizar el SVG ENTERO —cientos de montones con su
// relieve, sus códigos y la foto de fondo— en cada movimiento del dedo.
// Medido con 180 lotes y la CPU frenada 6 veces, como un teléfono de
// gama baja: unos 80 ms por movimiento, el plano a tirones.
//
// Por eso, mientras el dedo arrastra (o el plano vuela hasta un lote),
// el viewBox se queda quieto y lo que se mueve es la IMAGEN ya pintada,
// con un transform del elemento: eso lo hace la tarjeta gráfica, sin
// volver a dibujar nada. Al soltar se fija el viewBox de verdad y se
// quita el transform, las dos cosas en el mismo instante, así que en
// pantalla no salta nada.
//
// Para que al desplazar no asome el vacío por el borde, el lienzo es más
// grande que su caja: SOBRA de cada lado, dibujado pero escondido. Si el
// gesto se va más allá de lo que hay dibujado (o acerca tanto que la
// imagen ya se vería borrosa) se vuelve a dibujar ahí mismo, una vez, y
// se sigue.
const SOBRA = .4;
let pintada = null;          // el encuadre que dice el viewBox ahora mismo

// el viewBox con su sobra: con "meet" la escala queda la misma que la de
// `v` en la caja visible, y los dos centros coinciden
const conSobra = (v) => ({ x: v.x - v.w * SOBRA, y: v.y - v.h * SOBRA,
                           w: v.w * (1 + 2 * SOBRA), h: v.h * (1 + 2 * SOBRA) });

function aplicarVista() {
  if (capa?.style) capa.style.transform = '';
  const v = conSobra(vista);
  svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
  svgGps?.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
  pintada = { ...vista };
  gpsAlZoom();
}

// Mostrar `vista` sin volver a dibujar: se corre y se escala lo que ya
// está pintado con `pintada`.
function verVista() {
  const p = pintada;
  if (!p || !capa?.style) { aplicarVista(); return; }
  const k = p.w / vista.w;                       // cuánto se acercó
  const fuera = vista.x < p.x - p.w * SOBRA * .95 || vista.y < p.y - p.h * SOBRA * .95
    || vista.x + vista.w > p.x + p.w * (1 + SOBRA * .95)
    || vista.y + vista.h > p.y + p.h * (1 + SOBRA * .95);
  // Acercando, la imagen escalada se ve algo borrosa hasta soltar, que es
  // cuando se vuelve a dibujar nítida. Se aguanta hasta ×4 sin redibujar:
  // cada redibujado a mitad del pellizco es un tirón, y en un gama baja
  // eso pesa más que un rato de borroso. Alejando no hay borroso, pero sí
  // un límite: lo que sobra dibujado alrededor (`fuera`).
  if (fuera || k > 4) { aplicarVista(); return; }
  // Cuentas en píxeles, con el origen en la esquina de la caja visible.
  // De la caja visible a la del lienzo hay SOBRA de cada lado.
  const r = cajaLienzo();
  const s0 = Math.min(r.width / p.w, r.height / p.h) || 1;   // escala de lo pintado
  const s1 = s0 * k;
  // dónde cae, con cada encuadre, la esquina de lo pintado (p.x, p.y)
  const x0 = (r.width - p.w * s0) / 2, y0 = (r.height - p.h * s0) / 2;
  const x1 = (r.width - vista.w * s1) / 2 + (p.x - vista.x) * s1;
  const y1 = (r.height - vista.h * s1) / 2 + (p.y - vista.y) * s1;
  // el transform escala desde la esquina del LIENZO, que empieza SOBRA
  // antes que la caja visible
  const ox = -r.width * SOBRA, oy = -r.height * SOBRA;
  const tx = x1 - ox - k * (x0 - ox), ty = y1 - oy - k * (y0 - oy);
  capa.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${k.toFixed(5)})`;
}

// Fija lo que se estaba mostrando con transform, si es que algo cambió.
function asentarVista() {
  if (!pintada || pintada.x !== vista.x || pintada.y !== vista.y || pintada.w !== vista.w
      || pintada.h !== vista.h || capa?.style?.transform) aplicarVista();
}

// Unidades del plano que cubre un píxel de pantalla. Con
// preserveAspectRatio "meet" la escala es la misma en ambos ejes: manda
// el lado que primero se queda sin espacio.
function unidadesPorPixel(v = vista) {
  const r = cajaLienzo();
  const escala = Math.min(r.width / v.w, r.height / v.h);
  return escala > 0 ? 1 / escala : 1;
}

// Deja quieto el punto del plano que está bajo (cx, cy) de la pantalla.
// Sin esto el zoom siempre tira hacia el centro y se siente que el mapa
// se escapa de donde uno está mirando.
//
// Ya no hace falta escribir el encuadre antes de medir: la cuenta usa el
// `vista` que hay en memoria —que el pellizco acaba de actualizar— en vez
// de preguntarle al navegador dónde quedó dibujado.
function anclarEn(cx, cy, ancla, mostrar = aplicarVista) {
  const ahora = aPlanoPunto(cx, cy);
  vista.x += ancla.x - ahora.x;
  vista.y += ancla.y - ahora.y;
  mostrar();
}

// Guardar y reponer el encuadre: al rearmar la barra del mapa no se
// puede perder el zoom en el que estaba trabajando la persona.
export const obtenerVista = () => ({ ...vista });
export function fijarVista(v) {
  if (!v) return;
  vista = { ...v };
  aplicarVista();
}

// punto global → coordenadas locales de la figura
function aLocal(o, pt) {
  const a = (-(o.rot || 0) * Math.PI) / 180;
  const dx = pt.x - o.x, dy = pt.y - o.y;
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
}

function contiene(o, pt) {
  const l = aLocal(o, pt);
  if (o.forma === 'poligono') {
    const ps = listaPuntos(o);
    let dentro = false;
    for (let i = 0, j = ps.length - 1; i < ps.length; j = i++) {
      const xi = ps[i].x, yi = ps[i].y, xj = ps[j].x, yj = ps[j].y;
      if ((yi > l.y) !== (yj > l.y) && l.x < ((xj - xi) * (l.y - yi)) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
  }
  if (o.forma === 'rectangulo') return Math.abs(l.x) <= o.rx && Math.abs(l.y) <= o.ry;
  return (l.x * l.x) / (o.rx * o.rx) + (l.y * l.y) / (o.ry * o.ry) <= 1;
}

export function blancoEn(pt, excluirId) {
  const p = datos.pilas.filter((x) =>
    x.estado === 'abierta' && x.id !== excluirId && contiene(x, pt));
  if (p.length) return { tipo: 'pila', obj: p[0] };
  const l = datos.lotes.filter((x) =>
    !x.pila_id && x.id !== excluirId && !fuera(x) && contiene(x, pt)
    // lo que va montado sobre el lote que se arrastra viaja con él
    && (!excluirId || apilado.get(x.id)?.abajo?.id !== excluirId));
  if (l.length) return { tipo: 'lote', obj: l[0] };
  return null;
}

// ¿el lote se movió de verdad, o solo se acomodó encima de sí mismo?
// Copia de la geometría antes de tocarla, para poder devolverla tal cual
// si quien la movió decide cancelar.
const instantanea = (o) => ({
  x: o.x, y: o.y, rx: o.rx, ry: o.ry, rot: o.rot || 0,
  puntos: o.puntos ? o.puntos.map((p) => ({ ...p })) : null
});

// Deshacer: devuelve la figura a donde estaba y repinta.
export function deshacerGeom(tipo, id, antes) {
  const o = objeto({ tipo, id });
  if (!o || !antes) return;
  Object.assign(o, antes);
  // Lo arrastrado se movió tocando el SVG a mano, sin repintar: el texto
  // armado es igual al de antes del gesto y pintar() no tocaría nada. Se
  // fuerza el repintado para que todo vuelva a su sitio en pantalla.
  ultimoDibujo = '';
  pintarYa();
}

export function movimientoReal(o, desde) {
  if (!desde) return true;
  const d = Math.hypot(o.x - desde.x, o.y - desde.y);
  const radio = o.forma === 'poligono'
    ? Math.max(...listaPuntos(o).map((p) => Math.hypot(p.x, p.y)))
    : Math.max(o.rx, o.ry);
  return d > radio * 1.15;
}

// --------------------------------------------------------- interacción
// Un lote vive en dos capas del SVG, así que arrastrarlo con el dedo es
// mover todos sus nodos: mover solo uno dejaba el contorno atrás.
const nodosDe = (id) => [...svg.querySelectorAll(`[data-id="${id}"]`)];

// Arranca —o REARRANCA— el pellizco con los dos dedos que haya ahora.
// Volver a medirlo cada vez que un dedo entra o sale es lo que evita el
// salto: si un tercer dedo roza la pantalla, o si se levanta uno de los
// dos, el encuadre se vuelve a medir desde donde están los dedos y no
// desde donde estaban. Antes un tercer dedo cancelaba el zoom y hasta
// podía arrancar un arrastre.
// Lo que está montado encima de un lote del piso, con sus nodos.
function cargaDe(o) {
  return [...apilado].filter(([, v]) => v.abajo?.id === o.id).map(([id]) => ({ id, nodos: nodosDe(id) }));
}

// ------------------------------------------------ mantener para mover
// Tres cuartos de segundo: se pidió otra vez la mitad (3 s la primera
// versión, 1,5 s la segunda). Ya no hay que confirmar al soltar, así que
// esta espera es lo único que separa un roce de un traslado: sigue
// siendo bastante más que un toque largo sin querer.
export const MANTENER_MS = 750;
let espera = null;

function empezarAMantener(obj, ev) {
  soltarEspera();
  const u = unidadesPorPixel();
  const r = Math.max(obj.rx || 40, obj.ry || 40) + 14 * u;
  // Va encima de todo y en unidades del plano; el grosor, en píxeles de
  // pantalla, igual que las manijas: con cualquier zoom se ve igual.
  svg.insertAdjacentHTML('beforeend', `<g class="aro-mantener" transform="translate(${obj.x} ${obj.y})"
      style="--mantener:${MANTENER_MS}ms">
    <circle r="${r.toFixed(1)}" fill="none" stroke="#14171a" stroke-width="${(9 * u).toFixed(1)}" opacity=".35"/>
    <circle class="aro-lleno" r="${r.toFixed(1)}" fill="none" stroke="#f2c007" stroke-width="${(6 * u).toFixed(1)}"
      pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1" transform="rotate(-90)"/>
  </g>`);
  const ultimo = { clientX: ev.clientX, clientY: ev.clientY };
  arrastre.espera = setTimeout(() => levantar(obj, ultimo), MANTENER_MS);
  espera = arrastre.espera;
}

function soltarEspera() {
  if (!espera) return;
  clearTimeout(espera);
  espera = null;
  if (arrastre) arrastre.espera = null;
  svg.querySelectorAll('.aro-mantener').forEach((n) => n.remove());
}

// Pasó el tiempo con el dedo quieto: el lote se levanta (crece un poco y
// su sombra se aleja) y desde aquí el dedo lo arrastra, como en modo
// edición. Al soltarlo, la app pregunta "¿Dejar X aquí?" igual que hoy.
function levantar(obj, ev) {
  espera = null;
  svg.querySelectorAll('.aro-mantener').forEach((n) => n.remove());
  if (modo !== 'paneando' || !arrastre || movio) return;
  // si el plano alcanzó a correrse un pelo, vuelve a donde estaba
  vista = { ...arrastre.vista }; aplicarVista();
  const hijos = cargaDe(obj);
  const nodos = nodosDe(obj.id).concat(...hijos.map((h) => h.nodos));
  nodos.forEach((n) => n.classList.add('levantado'));
  try { navigator.vibrate?.(30); } catch { /* sin vibración no pasa nada */ }
  modo = 'arrastrando';
  arrastre = { tipo: 'lote', obj, nodos, inicio: aPlano(ev), levantado: true, hijos: [],
               origen: { x: obj.x, y: obj.y }, antes: instantanea(obj) };
}

function apoyar(nodos) {
  nodos.forEach((n) => { n.classList.remove('levantado'); n.classList.add('apoyando'); });
  setTimeout(() => nodos.forEach((n) => n.classList.remove('apoyando')), 360);
}

function iniciarZoom() {
  const [a, b] = [...punteros.values()];
  const cx = (a.clientX + b.clientX) / 2, cy = (a.clientY + b.clientY) / 2;
  pinchInicial = { d: dist(a, b), ...vista, cx, cy, ancla: aPlanoPunto(cx, cy) };
  modo = 'zoom';
}

// Antes, mientras duraba el pellizco, los códigos de los lotes se
// apagaban: con el viewBox cambiando en cada cuadro, cada glifo se volvía
// a componer a otro tamaño. Ahora el pellizco solo escala la imagen ya
// pintada (ver verVista) y el texto no se recompone, así que apagarlos ya
// no ahorraba nada y costaba DOS repintados enteros: uno al apoyar el
// segundo dedo —el tirón al empezar a acercar— y otro al soltar.

function abajo(ev) {
  cancelAnimationFrame(animacion);   // el dedo manda sobre cualquier vuelo
  asentarVista();                    // y el vuelo cortado queda donde iba
  svg.setPointerCapture(ev.pointerId);
  // La caja del lienzo, una sola vez para todo el gesto. Mientras el dedo
  // esté abajo no puede cambiar, y preguntarla en cada movimiento era
  // obligar al navegador a recalcular la disposición del plano entero.
  if (!punteros.size) caja = medirCaja();
  punteros.set(ev.pointerId, ev);

  if (punteros.size >= 2) { soltarEspera(); iniciarZoom(); return; }

  movio = false;
  const manija = ev.target.closest('[data-handle]');
  if (manija && seleccion) {
    const o = objeto();
    const h = manija.dataset.handle;
    if (h === 'agregar') {
      const ps = listaPuntos(o).slice();
      const i = Number(manija.dataset.i);
      const q = ps[(i + 1) % ps.length];
      ps.splice(i + 1, 0, { x: (ps[i].x + q.x) / 2, y: (ps[i].y + q.y) / 2 });
      o.puntos = ps;
      pintarYa();
      cb.alGuardarGeom?.(seleccion.tipo, o);
      return;
    }
    modo = 'ajustando';
    const inicio = aPlano(ev);
    const i = Number(manija.dataset.i);
    // Dónde se agarró la manija respecto de dónde está de verdad. Sin
    // esto la figura pegaba un salto al primer roce: el dedo casi nunca
    // cae en el centro exacto del disco, y esa diferencia se aplicaba
    // como si fuera un tirón. Con la holgura nueva el disco es más
    // grande, así que el salto también lo era.
    const l = aLocal(o, inicio);
    const desde = h === 'vertice' ? listaPuntos(o)[i]
                : h === 'tamano'  ? { x: o.rx, y: o.ry }
                : h === 'columnas' ? { x: o.rx, y: 0 }
                : null;
    arrastre = {
      handle: h, i, obj: o, inicio,
      desfase: desde ? { x: l.x - desde.x, y: l.y - desde.y } : null,
      // girar se mide en ángulos, no en distancias: se guarda el desvío
      // entre el ángulo del dedo y el que ya tenía la figura
      giro: h === 'rotar'
        ? (o.rot || 0) - (Math.atan2(inicio.y - o.y, inicio.x - o.x) * 180) / Math.PI
        : 0
    };
    return;
  }

  const g = ev.target.closest('[data-id]');
  if (g) {
    const tipo = g.dataset.tipo;
    const obj = objeto({ tipo, id: g.dataset.id });
    if (!obj) return;

    // FUERA de modo edición nada se mueve. El dedo sobre una figura
    // desplaza el plano, igual que sobre el fondo, y al levantarlo sin
    // haber arrastrado se abre la ficha. Antes cualquier roce mientras
    // se miraba el mapa arrastraba el lote a otro sitio, y el único
    // aviso era que la figura había cambiado de lugar.
    if (!modoEdicion) {
      modo = 'paneando';
      arrastre = {
        pantalla: { x: ev.clientX, y: ev.clientY },
        vista: { ...vista }, u: unidadesPorPixel(),
        toque: { tipo, id: obj.id }        // para abrir la ficha si no se movió
      };
      // Mantener el dedo quieto sobre un lote lo LEVANTA para moverlo,
      // sin entrar a modo edición. Tarda a propósito (MANTENER_MS): un
      // roce o un toque largo sin querer no pueden mover material en el
      // plano. Mientras se espera, un aro se va llenando alrededor del
      // lote para que se vea que algo va a pasar y cuánto falta.
      if (tipo === 'lote' && cb.puedeMover?.()) empezarAMantener(obj, ev);
      return;
    }

    if (tipo === 'figura' && !cb.puedeEditarFondo()) return;
    modo = 'arrastrando';
    arrastre = {
      tipo, obj, nodos: nodosDe(obj.id), inicio: aPlano(ev),
      origen: { x: obj.x, y: obj.y },
      antes: instantanea(obj),            // para poder deshacer si se cancela
      hijos: tipo === 'lote' ? cargaDe(obj) : []
    };
    // la selección es inmediata: se ven las manijas al tocar
    if (seleccion?.id !== obj.id) {
      seleccion = { tipo, id: obj.id };
      pintarYa();
      arrastre.nodos = nodosDe(obj.id);
      cb.alSeleccionar?.(tipo, obj);
    }
    return;
  }

  if (modoEdicion && seleccion) {
    seleccion = null;
    pintarYa();
    cb.alTocarVacio?.();
  }
  modo = 'paneando';
  arrastre = {
    pantalla: { x: ev.clientX, y: ev.clientY },
    vista: { ...vista },
    u: unidadesPorPixel()
  };
}

function movimiento(ev) {
  if (!punteros.has(ev.pointerId)) return;
  punteros.set(ev.pointerId, ev);

  if (modo === 'zoom' && punteros.size >= 2) {
    const [a, b] = [...punteros.values()];
    const f = pinchInicial.d / Math.max(dist(a, b), 1);
    const w = Math.min(Math.max(pinchInicial.w * f, 120), 5000);
    const h = w * (pinchInicial.h / pinchInicial.w);
    // el punto que estaba entre los dos dedos sigue estando ahí
    vista = { x: pinchInicial.x, y: pinchInicial.y, w, h };
    anclarEn(pinchInicial.cx, pinchInicial.cy, pinchInicial.ancla, verVista);
    return;
  }
  if (!arrastre) return;

  // El paneo se mide en PÍXELES DE PANTALLA contra un encuadre congelado
  // al apoyar el dedo. Medirlo en coordenadas del plano lo haría contra el
  // viewBox que acabamos de mover: el error se retroalimenta y el mapa
  // oscila entre el encuadre inicial y el nuevo en cada movimiento.
  if (modo === 'paneando') {
    const sx = ev.clientX - arrastre.pantalla.x;
    const sy = ev.clientY - arrastre.pantalla.y;
    if (Math.hypot(sx, sy) > 6) { movio = true; soltarEspera(); }
    if (arrastre.espera) return;        // quieto esperando: el plano no se mueve
    vista.x = arrastre.vista.x - sx * arrastre.u;
    vista.y = arrastre.vista.y - sy * arrastre.u;
    verVista();
    return;
  }

  const p = aPlano(ev);
  const dx = p.x - arrastre.inicio.x, dy = p.y - arrastre.inicio.y;
  if (Math.hypot(dx, dy) > 6) movio = true;

  if (modo === 'arrastrando') {
    arrastre.obj.x = arrastre.origen.x + dx;
    arrastre.obj.y = arrastre.origen.y + dy;
    const t = `translate(${arrastre.obj.x} ${arrastre.obj.y}) rotate(${arrastre.obj.rot || 0})`;
    arrastre.nodos.forEach((n) => n.setAttribute('transform', t));
    // lo que va montado encima se mueve con el de abajo (solo el dibujo:
    // dónde queda lo guarda la app al confirmar)
    for (const h of arrastre.hijos || []) h.nodos.forEach((n) => n.setAttribute('transform', t));
    if (arrastre.tipo === 'lote') resaltarBlanco(arrastre.obj);
  } else if (modo === 'ajustando') {
    const o = arrastre.obj;
    const d = arrastre.desfase || { x: 0, y: 0 };
    const l = aLocal(o, p);
    const lx = l.x - d.x, ly = l.y - d.y;   // descontando dónde se agarró
    if (arrastre.handle === 'columnas') {
      // el borde derecho sigue al dedo: cuántas columnas caben hasta ahí
      const n = Math.max(1, Math.round((2 * Math.max(lx, 0) + Dib.PASO_BIGBAG - Dib.LADO_BIGBAG) / Dib.PASO_BIGBAG));
      if (n !== o.bigbags_fila) {
        const d = Dib.disposicionBigbags(o.bigbags, n);
        o.bigbags_fila = d.porFila; o.rx = d.rx; o.ry = d.ry;
      }
    } else if (arrastre.handle === 'rotar') {
      o.rot = Math.round((Math.atan2(p.y - o.y, p.x - o.x) * 180) / Math.PI + arrastre.giro);
    } else if (arrastre.handle === 'vertice') {
      const ps = listaPuntos(o).slice();
      ps[arrastre.i] = { x: +lx.toFixed(1), y: +ly.toFixed(1) };
      o.puntos = ps;
    } else {
      o.rx = Math.min(Math.max(Math.abs(lx), 14), 900);
      o.ry = Math.min(Math.max(Math.abs(ly), 12), 900);
    }
    pintarYa();
  }
}

function resaltarBlanco(lote) {
  svg.querySelectorAll('.blanco').forEach((n) => n.classList.remove('blanco'));
  const b = blancoEn({ x: lote.x, y: lote.y }, lote.id);
  if (b?.tipo === 'lote' && apilado.get(b.obj.id)?.abajo?.id === lote.id) return;   // su propia carga
  // Todas sus copias, no la primera: la del lote en la capa de trazos
  // queda tapada por los rellenos y el aro azul no se vería.
  if (b) svg.querySelectorAll(`[data-id="${b.obj.id}"] .forma`)
    .forEach((n) => n.classList.add('blanco'));
}

function arriba(ev) {
  // El MISMO dedo se levanta dos y hasta tres veces: la red de seguridad
  // de la ventana escucha en captura y corre ANTES que el oyente del
  // lienzo, y encima `lostpointercapture` llega después. Cerrar el gesto
  // una sola vez no era un lujo: la segunda pasada se llevaba por delante
  // el paneo que el dedo que queda acababa de tomar del pellizco, y el
  // plano se quedaba quieto hasta levantarlo también.
  if (!punteros.delete(ev.pointerId)) return;
  svg.querySelectorAll('.blanco').forEach((n) => n.classList.remove('blanco'));
  soltarEspera();

  if (modo === 'zoom') {
    if (punteros.size >= 2) {
      iniciarZoom();               // sigue el pellizco con los que quedan
    } else if (punteros.size === 1) {
      // Queda un dedo. Antes el mapa se quedaba muerto hasta levantarlo:
      // no hacía zoom (falta un dedo) ni paneaba (el modo seguía siendo
      // zoom), y parecía que el plano se hubiera trabado. Ahora ese dedo
      // se hace cargo y sigue arrastrando el plano desde donde está.
      const [q] = [...punteros.values()];
      modo = 'paneando';
      movio = true;                // viene de un gesto: no es un toque
      arrastre = { pantalla: { x: q.clientX, y: q.clientY },
                   vista: { ...vista }, u: unidadesPorPixel() };
    } else {
      modo = 'ninguno';
      asentarVista();
      caja = null;                 // se soltó todo: la caja puede cambiar
      gpsAlSoltar();
      if (repintadoPendiente) pintar(repintadoPendiente);
    }
    return;
  }

  // Calibrando, un toque marca el punto, caiga sobre una figura o no.
  if (modo === 'paneando' && marcador && !movio) {
    marcador(aPlano(ev));
  // Fuera de modo edición el dedo sobre una figura panea; si no llegó a
  // moverse, era un toque y lo que se quiere es ver la ficha.
  } else if (modo === 'paneando' && arrastre?.toque && !movio) {
    cb.alTocar?.(arrastre.toque.tipo, arrastre.toque.id);
  }

  if (modo === 'arrastrando' && arrastre) {
    const { tipo, obj, origen, antes, levantado } = arrastre;
    if (levantado) apoyar(arrastre.nodos);
    if (levantado && !movio) {
      // se levantó y se soltó en el mismo sitio: no hay nada que guardar
    } else if (!movio) {
      seleccion = { tipo, id: obj.id };
      pintarYa();
      cb.alSeleccionar?.(tipo, obj);
    } else {
      const blanco = tipo === 'lote' ? blancoEn({ x: obj.x, y: obj.y }, obj.id) : null;
      if (blanco) cb.alSoltarSobre?.(obj, blanco, antes);
      else cb.alGuardarGeom?.(tipo, obj, origen, antes);
    }
  } else if (modo === 'ajustando' && arrastre) {
    // tocar un vértice sin moverlo lo elimina, si quedan al menos tres
    if (!movio && arrastre.handle === 'vertice') {
      const o = arrastre.obj, ps = listaPuntos(o).slice();
      if (ps.length > 3) { ps.splice(arrastre.i, 1); o.puntos = ps; pintarYa(); }
    }
    cb.alGuardarGeom?.(seleccion.tipo, arrastre.obj, null, arrastre.antes);
  }
  modo = 'ninguno';
  arrastre = null;
  if (!punteros.size) { asentarVista(); caja = null; }   // se soltó todo: la caja puede cambiar
  gpsAlSoltar();
  if (repintadoPendiente) pintar(repintadoPendiente);
}

// La rueda acerca hacia donde apunta el cursor, no hacia el centro
function rueda(ev) {
  ev.preventDefault();
  const ancla = aPlanoPunto(ev.clientX, ev.clientY);
  const f = ev.deltaY > 0 ? 1.12 : 0.89;
  const w = Math.min(Math.max(vista.w * f, 120), 5000);
  vista.h = w * (vista.h / vista.w);
  vista.w = w;
  anclarEn(ev.clientX, ev.clientY, ancla);
}

export function acercar(f) {
  const w = Math.min(Math.max(vista.w * f, 120), 5000);
  const h = w * (vista.h / vista.w);
  vista.x += (vista.w - w) / 2;
  vista.y += (vista.h - h) / 2;
  vista.w = w; vista.h = h;
  aplicarVista();
}

const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
