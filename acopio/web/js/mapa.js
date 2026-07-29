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
    ${pilasVivas.map((p) => figuraPila(p, datos.lotes)).join('')}
    <g class="atenuado">${capasLote(sueltos.filter((l) => tenue(l.id)))}</g>
    ${capasLote(sueltos.filter((l) => !tenue(l.id)))}
    ${recorrido(datos.recorrido)}
    ${seleccion ? manijas() : ''}`;
}

// Los lotes se dibujan en DOS pasadas: primero todos los contornos, y
// encima todos los rellenos con su rótulo. Así el relleno de cualquier
// lote borra el trazo de los demás, y la línea negra desaparece justo
// donde dos círculos se cruzan: dos lotes que se tocan se leen como un
// solo montón de material, que es lo que son en el patio.
//
// El trazo se dibuja al DOBLE de grueso a propósito: el trazo del SVG va
// centrado en el borde, así que su propio relleno le come la mitad de
// adentro. Lo que queda a la vista es el grosor de siempre.
function capasLote(ls) {
  // El lote señalado va al final: su aro de "aquí está" tiene que quedar
  // por encima de los vecinos que lo toquen, no debajo.
  const orden = ls.filter((l) => l.id !== datos.resaltado)
    .concat(ls.filter((l) => l.id === datos.resaltado));
  return orden.map((l) => figuraLote(l, 'trazo')).join('')
       + orden.map((l) => figuraLote(l, 'relleno')).join('');
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
    ${cuerpo(p, `class="pila-forma" fill="${esc(col)}" fill-opacity=".14" stroke="${esc(col)}"`)}
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

// Un lote sale dos veces: en la capa de trazos (contorno + relleno, para
// que el contorno no se vea por dentro) y en la de rellenos (relleno +
// rótulo, que es lo que borra los contornos de los vecinos). Las dos
// llevan data-id, así que tocar cualquiera sigue dando con el lote.
function figuraLote(l, capa) {
  const venc = !!l.fecha_recogida && l.fecha_recogida < hoyISO();
  const col = paleta()[l.estado] || '#5f6863';
  const marca = `data-tipo="lote" data-id="${esc(l.id)}" ${trazo(l)}
    class="g-lote${datos.resaltado === l.id ? ' g-resaltado' : ''}"`;

  if (capa === 'trazo') {
    const attrs = `fill="${esc(col)}" stroke="${venc ? '#7a1f16' : '#14171a'}"
     stroke-width="${venc ? 10 : 4}" ${venc ? 'stroke-dasharray="8 5"' : ''}`;
    return `<g ${marca}>${cuerpo(l, attrs)}</g>`;
  }

  return `<g ${marca}>
    ${datos.resaltado === l.id ? halo(l) : ''}
    ${cuerpo(l, `fill="${esc(col)}"`)}
    ${(() => {
      const c = anclaTexto(l);
      // El suelo son 11 px: por debajo de eso un código deja de leerse a
      // un brazo de distancia. Un código absurdamente largo prefiere
      // sobresalir dos o tres píxeles de su óvalo a volverse ilegible.
      const t = tamanoTexto(l, l.codigo, { min: 11, max: 20 });
      return `<text x="${c.x}" y="${c.y + t * .35}" text-anchor="middle" class="txt-lote"
        font-size="${t}" fill="${claro(col) ? '#14171a' : '#ffffff'}">${esc(l.codigo)}</text>`;
    })()}
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

// Manijas: en polígono, un punto por vértice más los "+" para agregar
function manijas() {
  const o = objeto();
  if (!o) return '';
  const escala = vista.w / 1000;
  const ps0 = o.forma === 'poligono' ? listaPuntos(o) : null;
  const menor = ps0
    ? Math.min(...ps0.map((p) => Math.hypot(p.x, p.y)))
    : Math.min(o.rx, o.ry);
  // ni gigantes en una figura pequeña, ni invisibles en una grande
  const r = Math.max(Math.min(13 * escala, menor * 0.34), 7 * escala);

  if (o.forma === 'poligono') {
    const ps = ps0;
    const medios = ps.map((p, i) => {
      const q = ps[(i + 1) % ps.length];
      return `<circle cx="${(p.x + q.x) / 2}" cy="${(p.y + q.y) / 2}" r="${r * .72}"
                class="manija-mas" data-handle="agregar" data-i="${i}"/>`;
    }).join('');
    return `<g ${trazo(o)} class="manijas">
      <path d="${rutaRedondeada(ps)}" class="halo"/>
      ${medios}
      ${ps.map((p, i) => `<circle cx="${p.x}" cy="${p.y}" r="${r}"
          class="manija" data-handle="vertice" data-i="${i}"/>`).join('')}
      <circle cx="0" cy="${-alto(ps) - 38}" r="${r}" class="manija" data-handle="rotar"/>
      <line x1="0" y1="${-alto(ps)}" x2="0" y2="${-alto(ps) - 38}" class="varilla"/>
    </g>`;
  }

  return `<g ${trazo(o)} class="manijas">
    ${cuerpo(o, 'class="halo"')}
    <circle cx="${o.rx}" cy="${o.ry}" r="${r}" class="manija" data-handle="tamano"/>
    <line x1="0" y1="${-o.ry}" x2="0" y2="${-o.ry - 38}" class="varilla"/>
    <circle cx="0" cy="${-o.ry - 38}" r="${r}" class="manija" data-handle="rotar"/>
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

function abajo(ev) {
  cancelAnimationFrame(animacion);   // el dedo manda sobre cualquier vuelo
  svg.setPointerCapture(ev.pointerId);
  punteros.set(ev.pointerId, ev);

  if (punteros.size === 2) {
    const [a, b] = [...punteros.values()];
    const cx = (a.clientX + b.clientX) / 2, cy = (a.clientY + b.clientY) / 2;
    pinchInicial = { d: dist(a, b), ...vista, cx, cy, ancla: aPlanoPunto(cx, cy) };
    modo = 'zoom';
    return;
  }

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
    arrastre = { handle: h, i: Number(manija.dataset.i), obj: o, inicio: aPlano(ev) };
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

  if (modo === 'zoom' && punteros.size === 2) {
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
    const l = aLocal(o, p);
    if (arrastre.handle === 'rotar') {
      o.rot = Math.round((Math.atan2(p.y - o.y, p.x - o.x) * 180) / Math.PI + 90);
    } else if (arrastre.handle === 'vertice') {
      const ps = listaPuntos(o).slice();
      ps[arrastre.i] = { x: +l.x.toFixed(1), y: +l.y.toFixed(1) };
      o.puntos = ps;
    } else {
      o.rx = Math.min(Math.max(Math.abs(l.x), 14), 900);
      o.ry = Math.min(Math.max(Math.abs(l.y), 12), 900);
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
  punteros.delete(ev.pointerId);
  svg.querySelectorAll('.blanco').forEach((n) => n.classList.remove('blanco'));

  if (modo === 'zoom') {
    if (!punteros.size) {
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
