// =====================================================================
//  mapa.js · el plano del acopio
//  Figuras arrastrables y editables: óvalo, rectángulo o polígono con
//  vértices que se mueven uno a uno.
// =====================================================================

let svg, cb = {}, vista = { x: 0, y: 0, w: 1000, h: 700 };
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

export const COLORES_BASE = {
  por_muestrear: '#d99a06', muestreado: '#e8b48a', remuestreo: '#8a5cd6',
  facturado: '#2b5ca8', devolucion: '#b8352a', plataforma: '#0f6d78', despachado: '#5f6863',
  pila_alimentacion: '#1f7a54', pila_devolucion: '#b8352a',
  pila_espera: '#d99a06', pila_otro: '#14171a'
};
const paleta = () => ({ ...COLORES_BASE, ...(datos.config?.colores || {}) });

// Deja la interacción en cero. Es CRÍTICO: si queda un puntero apuntado
// de un arrastre que se interrumpió (por ejemplo porque el lienzo se
// rearmó mientras el dedo seguía abajo), interactuando() sigue dando
// true, pintar() se va por el atajo y el mapa no se vuelve a dibujar
// NUNCA MÁS: se guarda todo pero en pantalla no pasa nada.
function reiniciarInteraccion() {
  punteros.clear();
  modo = 'ninguno';
  arrastre = null;
  pinchInicial = null;
  movio = false;
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
  seleccion = null;
  contenedor.innerHTML = `<svg id="lienzo" xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid meet" touch-action="none"></svg>`;
  svg = contenedor.querySelector('#lienzo');
  svg.addEventListener('pointerdown', abajo);
  svg.addEventListener('pointermove', movimiento);
  svg.addEventListener('pointerup', arriba);
  svg.addEventListener('pointercancel', arriba);
  svg.addEventListener('lostpointercapture', arriba);
  svg.addEventListener('wheel', rueda, { passive: false });
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
    aplicarVista();
    if (k < 1) animacion = requestAnimationFrame(paso);
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
  const r = svg.getBoundingClientRect();
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
  const fuera = (l) => l.estado === 'despachado' || l.estado === 'plataforma';
  // `naciendo` es el lote que la volqueta está descargando en la capa de
  // encima: no se dibuja hasta que el material cae, o se vería aparecer
  // antes de que lo traigan.
  const sueltos = datos.lotes.filter((l) => !l.pila_id && !fuera(l) && l.id !== datos.naciendo);
  const pilasVivas = datos.pilas.filter((p) => p.estado === 'abierta');

  svg.innerHTML = `
    <defs>
      <pattern id="reticula" width="50" height="50" patternUnits="userSpaceOnUse">
        <path d="M50 0H0V50" fill="none" stroke="#14171a" stroke-width="1" opacity=".07"/>
      </pattern>
    </defs>
    <rect x="${-1e4}" y="${-1e4}" width="${3e4}" height="${3e4}" fill="${esc(c.color_fondo || '#e4e7e2')}"/>
    ${c.imagen_url ? `<image href="${esc(c.imagen_url)}" x="${c.imagen_x}" y="${c.imagen_y}"
        width="${c.imagen_ancho}" height="${c.imagen_alto}"
        opacity="${c.imagen_opacidad ?? 1}" preserveAspectRatio="none"/>` : ''}
    ${c.imagen_url ? '' : `<rect x="0" y="0" width="${c.ancho}" height="${c.alto}" fill="url(#reticula)"/>`}
    <rect x="0" y="0" width="${c.ancho}" height="${c.alto}"
          fill="none" stroke="#14171a" stroke-width="2" stroke-dasharray="10 8" opacity=".3"/>
    ${datos.figuras.map(figuraFondo).join('')}
    ${capasPila(pilasVivas, datos.lotes, sueltos)}
    <g class="atenuado">${capasLote(sueltos.filter((l) => tenue(l.id)), pilasVivas.length)}</g>
    ${capasLote(sueltos.filter((l) => !tenue(l.id)), pilasVivas.length)}
    ${recorrido(datos.recorrido)}
    ${seleccion ? manijas() : ''}`;
}

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
// El contorno además se pinta a través de la MISMA máscara que los cercos
// de las pilas: un lote encima de una pila también es el mismo material,
// y su raya negra cruzando el cerco era justo lo que quedaba por quitar.
// El relleno viene después sin máscara, así que dentro de la pila el lote
// se sigue viendo entero: lo único que la máscara le quita es el trazo.
function capasLote(ls, hayPilas) {
  // El lote señalado va al final: su aro de "aquí está" tiene que quedar
  // por encima de los vecinos que lo toquen, no debajo.
  const orden = ls.filter((l) => l.id !== datos.resaltado)
    .concat(ls.filter((l) => l.id === datos.resaltado));
  const contornos = orden.map((l) => figuraLote(l, 'trazo')).join('');
  return (hayPilas ? `<g mask="url(#fuera-de-pilas)">${contornos}</g>` : contornos)
    + orden.map((l) => figuraLote(l, 'relleno')).join('')
    + orden.map((l) => figuraLote(l, 'rotulo')).join('');
}

// Las pilas no pueden usar el mismo truco: su relleno es casi
// transparente —hay que ver el patio y los lotes por debajo— y un
// relleno transparente no borra nada. Se resuelve con una máscara: el
// trazo de todas las pilas se pinta SOLO fuera del conjunto de pilas,
// así que donde dos se cruzan no queda raya y el par se lee como un
// mismo cerco. El doble de grosor es por lo mismo de siempre: la
// máscara le quita su propia mitad de dentro.
// `enmascarados` son las demás figuras que van a pasar por esta misma
// máscara —los contornos de los lotes—. Hacen falta aquí porque la región
// de una máscara RECORTA: lo que cae fuera no es que salga sin enmascarar,
// es que no sale. Ceñirla a las pilas dejó a los lotes de más allá sin
// contorno ninguno.
function capasPila(ps, lotes, enmascarados = []) {
  if (!ps.length) return '';
  const col = (p) => esc(paleta()[`pila_${p.tipo}`] || '#14171a');
  const puesta = (p, attrs, clase = '') =>
    `<g ${trazo(p)} class="${clase}">${cuerpo(p, attrs)}</g>`;

  // La región se ciñe al terreno de lo que pasa por la máscara y no al
  // plano entero: una región enorme es memoria de vídeo tirada en un
  // teléfono.
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of ps.concat(enmascarados)) {
    const r = radioDe(p);
    x1 = Math.min(x1, p.x - r.x); x2 = Math.max(x2, p.x + r.x);
    y1 = Math.min(y1, p.y - r.y); y2 = Math.max(y2, p.y + r.y);
  }
  const m = 40;
  const caja = `x="${x1 - m}" y="${y1 - m}" width="${x2 - x1 + m * 2}" height="${y2 - y1 + m * 2}"`;

  return `
    <mask id="fuera-de-pilas" maskUnits="userSpaceOnUse" ${caja}>
      <rect ${caja} fill="#fff"/>
      ${ps.map((p) => puesta(p, 'fill="#000"')).join('')}
    </mask>
    <g mask="url(#fuera-de-pilas)">
      ${ps.map((p) => puesta(p, `class="pila-trazo" fill="none" stroke="${col(p)}"`,
        apagado(p.id).trim())).join('')}
    </g>
    ${ps.map((p) => figuraPila(p, lotes)).join('')}`;
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

// Hueco útil dentro de cada forma.
//
// En una elipse el ancho NO es constante: depende de a qué altura se
// mida. Un renglón de texto es bajo, así que puede usar casi toda la
// cuerda central —2·rx·√(1−(h/ry)²)— en vez del rectángulo inscrito, que
// es mucho más estrecho. Usar el rectángulo inscrito dejaba los códigos
// bastante más pequeños de lo que hacía falta.
function cajaInterior(o, tam = 0) {
  if (o.forma === 'poligono') {
    const ps = listaPuntos(o);
    const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
    // un polígono irregular aprovecha bastante menos que su caja
    return { w: (Math.max(...xs) - Math.min(...xs)) * .68,
             h: (Math.max(...ys) - Math.min(...ys)) * .5 };
  }
  if (o.forma === 'rectangulo') return { w: o.rx * 1.78, h: o.ry * 1.5 };
  const media = tam ? Math.min(tam * .38, o.ry * .92) : o.ry * .6;
  const cuerda = 2 * o.rx * Math.sqrt(Math.max(1 - (media / o.ry) ** 2, .05));
  return { w: cuerda * .88, h: o.ry * 1.2 };
}

// Dónde se ancla el rótulo. En elipse y rectángulo, el origen. En un
// polígono, el centro de sus vértices: al arrastrarlos deja de estar en
// el origen, y el rótulo se quedaba colgado fuera de la figura.
function anclaTexto(o) {
  if (o.forma !== 'poligono') return { x: 0, y: 0 };
  const ps = listaPuntos(o);
  return { x: ps.reduce((a, p) => a + p.x, 0) / ps.length,
           y: ps.reduce((a, p) => a + p.y, 0) / ps.length };
}

// El ancho de un texto se sabe sin medirlo si se conoce cuánto avanza
// cada carácter. La monoespaciada de los códigos avanza ~0.6 em; la
// etiqueta del fondo va en versalitas espaciadas y avanza ~0.72, bastante
// más —dar por bueno el 0.6 ahí dejaba "VÍA DE ACCESO PRINCIPAL"
// saliéndose 50 px por los lados—. Manda el límite más estrecho de los
// dos, y el resultado se recorta a un rango que siga siendo legible.
function tamanoTexto(o, texto, { min, max, lineas = 1, paso = .6 }) {
  const calcular = (caja) => Math.max(min, Math.min(max,
    caja.w / Math.max(String(texto).length * paso, 1),
    (caja.h / lineas) * .92));
  let t = calcular(cajaInterior(o));
  // En la elipse el ancho depende del tamaño del texto y el tamaño del
  // ancho: una segunda pasada con la cuerda ya a la altura correcta
  // basta para que converja.
  if (o.forma !== 'rectangulo' && o.forma !== 'poligono') t = calcular(cajaInterior(o, t));
  return +t.toFixed(1);
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

function figuraPila(p, lotes) {
  const n = lotes.filter((l) => l.pila_id === p.id).length;
  const col = paleta()[`pila_${p.tipo}`] || '#14171a';
  return `<g data-tipo="pila" data-id="${esc(p.id)}" ${trazo(p)} class="g-pila${apagado(p.id)}${datos.resaltado === p.id ? ' g-resaltado' : ''}">
    ${datos.resaltado === p.id ? halo(p) : ''}
    ${/* el cerco lo pone capasPila en su capa con máscara; aquí solo el
          relleno, que es además lo que responde al dedo */ ''}
    ${cuerpo(p, `class="pila-forma" fill="${esc(col)}" fill-opacity=".14" stroke="none"`)}
    ${(() => {
      const rotulo = `Pila ${p.codigo}`, c = anclaTexto(p);
      const t = tamanoTexto(p, rotulo, { min: 8, max: 24, lineas: 2 });
      const sub = Math.max(6, +(t * .58).toFixed(1));
      return `<text x="${c.x}" y="${c.y}" text-anchor="middle" class="txt-pila"
          font-size="${t}">${esc(rotulo)}</text>
        <text x="${c.x}" y="${c.y + t * .95}" text-anchor="middle" class="txt-pila-sub"
          font-size="${sub}">${n} lote${n === 1 ? '' : 's'}</text>`;
    })()}
  </g>`;
}

// Un lote sale tres veces, una por capa: contorno, relleno y rótulo.
// Las tres llevan data-id, así que el dedo da con el lote caiga donde
// caiga, y arrastrarlo las mueve todas.
function figuraLote(l, capa) {
  // El compromiso de recogida solo existe mientras el lote es devolución:
  // si pasó a otro estado, la fecha que quedó guardada ya no compromete a
  // nadie y el borde de alarma no tiene nada que avisar.
  const venc = l.estado === 'devolucion'
    && !!l.fecha_recogida && l.fecha_recogida < hoyISO();
  const col = paleta()[l.estado] || '#5f6863';
  const marca = `data-tipo="lote" data-id="${esc(l.id)}" ${trazo(l)}
    class="g-lote${datos.resaltado === l.id ? ' g-resaltado' : ''}"`;

  if (capa === 'trazo') {
    const attrs = `fill="${esc(col)}" stroke="${venc ? '#7a1f16' : '#14171a'}"
     stroke-width="${venc ? 10 : 4}" ${venc ? 'stroke-dasharray="8 5"' : ''}`;
    return `<g ${marca}>${cuerpo(l, attrs)}</g>`;
  }

  if (capa === 'relleno') {
    return `<g ${marca}>
      ${datos.resaltado === l.id ? halo(l) : ''}
      ${cuerpo(l, `fill="${esc(col)}"`)}
    </g>`;
  }

  const c = anclaTexto(l);
  // El suelo son 11 px: por debajo de eso un código deja de leerse a un
  // brazo de distancia. Un código absurdamente largo prefiere sobresalir
  // dos o tres píxeles de su óvalo a volverse ilegible.
  const t = tamanoTexto(l, l.codigo, { min: 11, max: 20 });
  return `<g ${marca}>
    <text x="${c.x}" y="${c.y + t * .35}" text-anchor="middle" class="txt-lote"
      font-size="${t}" fill="${claro(col) ? '#14171a' : '#ffffff'}">${esc(l.codigo)}</text>
  </g>`;
}

// ¿el color de fondo es claro? entonces el texto va oscuro
function claro(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 165;
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

function aPlanoPunto(cx, cy) {
  const p = svg.createSVGPoint();
  p.x = cx; p.y = cy;
  return p.matrixTransform(svg.getScreenCTM().inverse());
}
const aplicarVista = () => svg.setAttribute('viewBox', `${vista.x} ${vista.y} ${vista.w} ${vista.h}`);

// Unidades del plano que cubre un píxel de pantalla. Con
// preserveAspectRatio "meet" la escala es la misma en ambos ejes: manda
// el lado que primero se queda sin espacio.
function unidadesPorPixel(v = vista) {
  const r = svg.getBoundingClientRect();
  const escala = Math.min(r.width / v.w, r.height / v.h);
  return escala > 0 ? 1 / escala : 1;
}

// Deja quieto el punto del plano que está bajo (cx, cy) de la pantalla.
// Sin esto el zoom siempre tira hacia el centro y se siente que el mapa
// se escapa de donde uno está mirando.
function anclarEn(cx, cy, ancla) {
  aplicarVista();
  const ahora = aPlanoPunto(cx, cy);
  vista.x += ancla.x - ahora.x;
  vista.y += ancla.y - ahora.y;
  aplicarVista();
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
  const l = datos.lotes.filter((x) => !x.pila_id && x.id !== excluirId &&
    x.estado !== 'despachado' && x.estado !== 'plataforma' && contiene(x, pt));
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
function iniciarZoom() {
  const [a, b] = [...punteros.values()];
  const cx = (a.clientX + b.clientX) / 2, cy = (a.clientY + b.clientY) / 2;
  pinchInicial = { d: dist(a, b), ...vista, cx, cy, ancla: aPlanoPunto(cx, cy) };
  modo = 'zoom';
}

function abajo(ev) {
  cancelAnimationFrame(animacion);   // el dedo manda sobre cualquier vuelo
  svg.setPointerCapture(ev.pointerId);
  punteros.set(ev.pointerId, ev);

  if (punteros.size >= 2) { iniciarZoom(); return; }

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
      return;
    }

    if (tipo === 'figura' && !cb.puedeEditarFondo()) return;
    modo = 'arrastrando';
    arrastre = {
      tipo, obj, nodos: nodosDe(obj.id), inicio: aPlano(ev),
      origen: { x: obj.x, y: obj.y },
      antes: instantanea(obj)             // para poder deshacer si se cancela
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
    anclarEn(pinchInicial.cx, pinchInicial.cy, pinchInicial.ancla);
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
    if (Math.hypot(sx, sy) > 6) movio = true;
    vista.x = arrastre.vista.x - sx * arrastre.u;
    vista.y = arrastre.vista.y - sy * arrastre.u;
    aplicarVista();
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
    if (arrastre.tipo === 'lote') resaltarBlanco(arrastre.obj);
  } else if (modo === 'ajustando') {
    const o = arrastre.obj;
    const d = arrastre.desfase || { x: 0, y: 0 };
    const l = aLocal(o, p);
    const lx = l.x - d.x, ly = l.y - d.y;   // descontando dónde se agarró
    if (arrastre.handle === 'rotar') {
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
  // Todas sus copias, no la primera: la del lote en la capa de trazos
  // queda tapada por los rellenos y el aro azul no se vería.
  if (b) svg.querySelectorAll(`[data-id="${b.obj.id}"] ellipse,
    [data-id="${b.obj.id}"] rect, [data-id="${b.obj.id}"] polygon`)
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
      if (repintadoPendiente) pintar(repintadoPendiente);
    }
    return;
  }

  // Fuera de modo edición el dedo sobre una figura panea; si no llegó a
  // moverse, era un toque y lo que se quiere es ver la ficha.
  if (modo === 'paneando' && arrastre?.toque && !movio) {
    cb.alTocar?.(arrastre.toque.tipo, arrastre.toque.id);
  }

  if (modo === 'arrastrando' && arrastre) {
    const { tipo, obj, origen, antes } = arrastre;
    if (!movio) {
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
