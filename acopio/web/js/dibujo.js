// =====================================================================
//  dibujo.js · cómo se ve cada cosa del plano
//
//  El mapa (mapa.js) decide DÓNDE va cada figura, en qué capa y cuándo
//  se repinta. Aquí solo se decide su ASPECTO: el montón de un lote a
//  granel, el saco de un bigbag, la pila como un solo montón y la
//  volqueta que descarga. Todo devuelve texto SVG en coordenadas locales
//  (la figura centrada en 0,0), y mapa.js le pone encima su translate y
//  su giro.
//
//  Reglas que vienen del patio y no del gusto:
//  - Filo negro y sombra sólida desplazada, sin difuminar: al sol, una
//    sombra borrosa desaparece y un gris medio también.
//  - El color sigue siendo el del estado (o el del tipo de pila), el
//    mismo que el admin repinta. El relieve sale de tonos de ESE color,
//    así que de lejos se lee el color y de cerca la forma.
//  - Nada de máscaras: en teléfonos reales una máscara dejaba capas en
//    blanco durante el pellizco (ver mapa.js, capasPila). Aquí solo hay
//    clipPath y patrones.
//  - La forma de cada lote sale de su CÓDIGO, no del azar: el mismo lote
//    se ve siempre igual, en todos los celulares y en cada repintado, y
//    al estirarlo con la manija el contorno se estira sin cambiar.
// =====================================================================

const TINTA = '#14171a';
const f = (n) => +n.toFixed(1);

// ------------------------------------------------------------- color
// Los colores de estado los escribe el admin con un selector de color,
// pero igual se validan: un valor raro no puede romper el plano entero.
const hexValido = (h, resp = '#5f6863') => (/^#[0-9a-f]{6}$/i.test(String(h)) ? h : resp);
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (a) => '#' + a.map((v) => Math.round(Math.max(0, Math.min(255, v)))
  .toString(16).padStart(2, '0')).join('');
// k > 0 aclara hacia el blanco, k < 0 oscurece hacia el negro
export function tono(h, k) {
  const c = rgb(hexValido(h)), t = k > 0 ? 255 : 0, a = Math.abs(k);
  return hex(c.map((v) => v + (t - v) * a));
}

// ------------------------------------------------------- azar fijo
// Un generador con semilla: la misma semilla da siempre la misma serie.
export function azar(semilla) {
  let h = 2166136261;
  for (const ch of String(semilla)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h += 0x6D2B79F5; let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const recto = (pts) => 'M' + pts.map((p) => `${f(p[0])} ${f(p[1])}`).join('L') + 'Z';
// Curva cerrada que pasa por los puntos medios: sin picos ni bucles.
function suave(pts) {
  const n = pts.length, m = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const s = m(pts[n - 1], pts[0]);
  let d = `M${f(s[0])} ${f(s[1])}`;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = m(p, pts[(i + 1) % n]);
    d += `Q${f(p[0])} ${f(p[1])} ${f(q[0])} ${f(q[1])}`;
  }
  return d + 'Z';
}

// ----------------------------------------------- patrones compartidos
// Van una sola vez en el <defs> del plano. Los tonos van en negro y
// blanco con transparencia, así sirven sobre cualquier color de estado.
export const DEFS = `
  <pattern id="gravilla" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(11)">
    <ellipse cx="3" cy="3" rx="1.9" ry="1.5" fill="#0c0c0b" opacity=".24"/><ellipse cx="2.5" cy="2.4" rx="1" ry=".7" fill="#fff" opacity=".45"/>
    <ellipse cx="9" cy="5" rx="1.6" ry="1.3" fill="#0c0c0b" opacity=".22"/><ellipse cx="8.6" cy="4.5" rx=".8" ry=".6" fill="#fff" opacity=".45"/>
    <ellipse cx="5" cy="9.5" rx="2.1" ry="1.6" fill="#0c0c0b" opacity=".24"/><ellipse cx="4.4" cy="8.9" rx="1" ry=".7" fill="#fff" opacity=".45"/>
    <ellipse cx="10.5" cy="10.5" rx="1.2" ry="1" fill="#0c0c0b" opacity=".2"/>
  </pattern>
  <pattern id="tejido" width="6" height="6" patternUnits="userSpaceOnUse">
    <path d="M0 3H6M3 0V6" stroke="#ffffff" stroke-width=".6" opacity=".22"/>
  </pattern>`;

// Las figuras se vuelven a armar en cada repintado (cada sincronización,
// cada cuadro de un ajuste). La geometría de un montón cuesta: se guarda
// por todo lo que la determina y se reaprovecha.
const cache = new Map();
// Cuántas veces se vació. Las figuras guardadas llevan ids numerados con
// el tamaño de la memoria: tras vaciarla se repiten, y mapa.js necesita
// saberlo para no mezclar en el plano piezas de antes y de después.
let vueltas = 0;
export const vueltaCache = () => vueltas;
function recordar(clave, armar) {
  if (cache.has(clave)) return cache.get(clave);
  if (cache.size > 3000) { cache.clear(); vueltas++; }
  const v = armar();
  cache.set(clave, v);
  return v;
}

// ========================================================== granel
// Cinco familias de montón, para que el patio no parezca hecho en serie.
// La familia también sale del código.
//   cono    una sola cima, como cae de la volqueta
//   cresta  una cresta a lo largo, como deja un cargador que va y viene
//   doble   dos cimas: dos descargas que quedaron juntas
//   bajo    montón aplanado y de borde ondulado, más desparramado
//   corte   con una mordida en un lado, donde ya entró el cargador
export const FAMILIAS = ['cono', 'cresta', 'doble', 'bajo', 'corte'];

function borde(rx, ry, rnd, fam) {
  const n = 32, fase = rnd() * 6.28, lob = 3 + ((rnd() * 3) | 0);
  const amp = fam === 'bajo' ? .06 : .025, ruido = fam === 'bajo' ? .04 : .05;
  const mordida = rnd() * Math.PI * 2;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    let r = 1 - ruido * rnd() - amp * (1 + Math.sin(lob * a + fase));
    if (fam === 'corte') {
      // distancia angular a la mordida, suavizada
      const d = Math.atan2(Math.sin(a - mordida), Math.cos(a - mordida));
      if (Math.abs(d) < .75) r -= .2 * Math.cos((d / .75) * Math.PI / 2) ** 2;
    }
    pts.push([Math.cos(a) * rx * r, Math.sin(a) * ry * r]);
  }
  return { pts, mordida };
}

function cimasDe(rx, ry, rnd, fam, mordida) {
  const jx = (rnd() - .5) * rx * .22, jy = (rnd() - .5) * ry * .22;
  const c = [-rx * .08 + jx, -ry * .12 + jy];
  const largo = rx >= ry;
  const eje = (L) => largo ? { a: [c[0] - L, c[1]], b: [c[0] + L, c[1]] }
                           : { a: [c[0], c[1] - L], b: [c[0], c[1] + L] };
  if (fam === 'cresta') return [eje(Math.max(rx, ry) * (.3 + rnd() * .3))];
  if (fam === 'doble') {
    const d = Math.max(rx, ry) * .34;
    const p1 = largo ? [c[0] - d, c[1] - ry * .06] : [c[0] - rx * .06, c[1] - d];
    const p2 = largo ? [c[0] + d, c[1] + ry * .1] : [c[0] + rx * .1, c[1] + d];
    return [{ a: p1, b: p1 }, { a: p2, b: p2 }];
  }
  if (fam === 'corte') {
    // la cima se aleja de la mordida: de ahí se sacó material
    const p = [c[0] - Math.cos(mordida) * rx * .22, c[1] - Math.sin(mordida) * ry * .22];
    return [{ a: p, b: p }];
  }
  // un lote alargado tiene cresta aunque sea "cono": así cae el material
  if (Math.abs(rx - ry) > Math.min(rx, ry) * .3) return [eje(Math.abs(rx - ry) * .6)];
  return [{ a: c, b: c }];
}

function proyectar(p, cimas) {
  let mejor = null, dm = Infinity;
  for (const { a, b } of cimas) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
    const q = [a[0] + dx * t, a[1] + dy * t], d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
    if (d < dm) { dm = d; mejor = q; }
  }
  return mejor;
}

// Caras desde la cima hasta el borde, con tono según hacia dónde miran.
// La luz viene de arriba a la izquierda DE LA PANTALLA: si el lote está
// girado, la luz se gira al revés para que no gire con él.
function facetas(col, pts, cimas, rango, rnd, rot) {
  const luz = Math.atan2(-1, -1) - (rot || 0) * Math.PI / 180;
  const grupos = {};
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[i], q0 = pts[(i + 1) % pts.length];
    const p = [p0[0] * 1.15, p0[1] * 1.15], q = [q0[0] * 1.15, q0[1] * 1.15];
    const pa = proyectar(p0, cimas), qa = proyectar(q0, cimas);
    const mb = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], mc = [(pa[0] + qa[0]) / 2, (pa[1] + qa[1]) / 2];
    let k = Math.cos(Math.atan2(mb[1] - mc[1], mb[0] - mc[0]) - luz) * rango + (rnd() - .5) * .07 - .04;
    k = Math.round(k / .05) * .05;
    (grupos[k] ||= []).push(recto([pa, p, q, qa]));
  }
  return Object.entries(grupos).map(([k, ds]) => `<path d="${ds.join('')}" fill="${tono(col, +k)}"/>`).join('');
}

// Piedras rodadas al pie: más en un lote grande, que tiene más borde.
function sueltas(col, pts, rnd, cuantas) {
  let d = '', luz = '';
  for (let i = 0; i < cuantas; i++) {
    // sobre todo abajo y a la derecha, que es donde rueda lo que cae
    const p = pts[(Math.floor(pts.length * (.05 + rnd() * .55))) % pts.length];
    const L = Math.hypot(p[0], p[1]) || 1, o = 1.04 + rnd() * .1;
    const cx = p[0] * o + (p[0] / L) * 2, cy = p[1] * o + (p[1] / L) * 2, s = 1.8 + rnd() * 2;
    d += `M${f(cx - s)} ${f(cy)}a${f(s)} ${f(s * .8)} 0 1 0 ${f(s * 2)} 0a${f(s)} ${f(s * .8)} 0 1 0 ${f(-s * 2)} 0Z`;
    luz += `M${f(cx - s * .5)} ${f(cy - s * .3)}h${f(s * .6)}`;
  }
  return `<path d="${d}" fill="${tono(col, -.15)}" stroke="${TINTA}" stroke-width="1"/>
    <path d="${luz}" stroke="#fff" stroke-width="1" opacity=".55" stroke-linecap="round"/>`;
}

// Geometría de un lote a granel. `o` trae forma, rx, ry, rot y, si es
// polígono, sus puntos ya listos ([{x, y}]).
function geometriaGranel(o) {
  const rnd = azar(o.codigo || o.id || 'lote');
  const fam = FAMILIAS[(rnd() * FAMILIAS.length) | 0];
  if (o.forma === 'poligono' && o.puntos?.length >= 3) {
    // dibujado a mano: el borde es el suyo, la cima su centro
    const ps = muestrear(o.puntos.map((p) => [p.x, p.y]), 18, 10);
    const c = ps.reduce((s, p) => [s[0] + p[0] / ps.length, s[1] + p[1] / ps.length], [0, 0]);
    return { pts: ps, cimas: [{ a: c, b: c }], rango: .17, rnd, fam: 'mano' };
  }
  const { pts, mordida } = borde(o.rx, o.ry, rnd, fam);
  return { pts, cimas: cimasDe(o.rx, o.ry, rnd, fam, mordida), rango: fam === 'bajo' ? .11 : fam === 'corte' ? .2 : .17, rnd, fam };
}

// Un lote a granel en sus dos capas:
//   base    sombra en el piso, piedras al pie y el FILO negro, grueso
//   cuerpo  el montón, sin filo
// mapa.js pinta primero las bases de TODOS los lotes y encima los
// cuerpos: el cuerpo de un lote tapa el filo del vecino donde se tocan, y
// dos lotes pegados se leen como un solo montón, que es lo que son.
export function granel(o, color) {
  const col = hexValido(color);
  const clave = `g|${o.codigo}|${o.forma}|${o.rx}|${o.ry}|${o.rot || 0}|${col}|${
    o.forma === 'poligono' ? JSON.stringify(o.puntos) : ''}`;
  return recordar(clave, () => {
    const g = geometriaGranel(o);
    const contorno = suave(g.pts);
    const id = 'c' + (cache.size + 1) + '-' + Math.round(g.rnd() * 1e6);
    const cuantas = Math.round(Math.max(3, Math.min(12, (o.rx + o.ry) / 13)));
    const caras = facetas(col, g.pts.filter((_, i) => i % 2 === 0), g.cimas, g.rango, g.rnd, o.rot);
    return {
      base: `<path class="sombra-lote" transform="translate(6 8)" d="${contorno}" fill="#0c0c0b" opacity=".22"/>
        <g class="textura">${sueltas(col, g.pts, g.rnd, cuantas)}</g>
        <path class="forma" d="${contorno}" fill="${col}" stroke="${TINTA}" stroke-width="5" stroke-linejoin="round"/>`,
      cuerpo: `<clipPath id="${id}"><path d="${contorno}"/></clipPath>
        <path d="${contorno}" fill="${tono(col, -.1)}"/>
        <g clip-path="url(#${id})">${caras}
          <rect class="textura" x="${-o.rx * 1.3 - 20}" y="${-o.ry * 1.3 - 20}" width="${o.rx * 2.6 + 40}" height="${o.ry * 2.6 + 40}" fill="url(#gravilla)"/>
          <path d="${contorno}" fill="none" stroke="${tono(col, -.45)}" stroke-width="7" opacity=".5"/></g>`,
      contorno, familia: g.fam
    };
  });
}

// =========================================================== bigbag
// Un saco visto desde arriba: cuatro caras como una almohada, la boca
// amarrada en el centro, las cuatro asas en las esquinas y la tela tejida.
export function bigbag(o, color) {
  const col = hexValido(color);
  return recordar(`b|${o.rx}|${o.ry}|${col}`, () => {
    const w = o.rx * 2, h = o.ry * 2, x0 = -o.rx, y0 = -o.ry, x1 = o.rx, y1 = o.ry;
    const cx = 0, cy = -h * .05, s = Math.min(w, h), r = s * .13, rr = Math.min(9, s * .12);
    const id = 'b' + (cache.size + 1);
    const cara = (pts, c) => `<polygon points="${pts.map((p) => p.map(f).join(',')).join(' ')}" fill="${c}"/>`;
    const asa = (ax, ay, sx, sy) => {
      const a = s * .2, d = `M${f(ax + sx * a)} ${f(ay)} Q${f(ax - sx * a * .35)} ${f(ay - sy * a * .35)} ${f(ax)} ${f(ay + sy * a)}`;
      return `<path d="${d}" fill="none" stroke="${TINTA}" stroke-width="4" stroke-linecap="round"/>
        <path d="${d}" fill="none" stroke="${tono(col, .45)}" stroke-width="1.4" stroke-linecap="round"/>`;
    };
    const rect = `x="${f(x0)}" y="${f(y0)}" width="${f(w)}" height="${f(h)}" rx="${f(rr)}"`;
    return {
      base: `<rect class="sombra-lote" transform="translate(6 8)" ${rect} fill="#0c0c0b" opacity=".22"/>
        <rect class="forma" ${rect} fill="${col}" stroke="${TINTA}" stroke-width="5"/>`,
      cuerpo: `<clipPath id="${id}"><rect ${rect}/></clipPath>
        <g clip-path="url(#${id})">
          ${cara([[x0, y0], [x1, y0], [cx, cy]], tono(col, .22))}
          ${cara([[x0, y0], [x0, y1], [cx, cy]], tono(col, .06))}
          ${cara([[x1, y0], [x1, y1], [cx, cy]], tono(col, -.12))}
          ${cara([[x0, y1], [x1, y1], [cx, cy]], tono(col, -.24))}
          <rect class="textura" ${rect} fill="url(#tejido)"/>
          <path d="M${f(x0)} ${f(y0)}L${cx} ${f(cy)}L${f(x1)} ${f(y0)}M${f(x0)} ${f(y1)}L${cx} ${f(cy)}L${f(x1)} ${f(y1)}" stroke="${TINTA}" stroke-width="1" opacity=".28" fill="none"/>
        </g>
        <circle cx="${cx}" cy="${f(cy)}" r="${f(r)}" fill="${tono(col, -.4)}" stroke="${TINTA}" stroke-width="1.6"/>
        <circle cx="${cx}" cy="${f(cy)}" r="${f(r * .5)}" fill="${tono(col, .3)}" stroke="${TINTA}" stroke-width="1"/>
        ${asa(x0, y0, 1, 1)}${asa(x1, y0, -1, 1)}${asa(x0, y1, 1, -1)}${asa(x1, y1, -1, -1)}`
    };
  });
}

// =================================================== grupo de bigbags
// Un lote en bigbags puede traer muchos: se guarda CUÁNTOS (`bigbags`) y
// en el patio se apilan de a ALTO_BIGBAGS, uno encima de otro. 27 bigbags
// son 9 columnas de 3. Lo que se ajusta en el plano es cómo se reparten
// esas columnas (`bigbags_fila`: cuántas van por fila), nunca el tamaño
// de cada bigbag: un bigbag mide lo mismo en cualquier lote.
export const ALTO_BIGBAGS = 3;
// Medidas al 60 % de las primeras: a 26 unidades un bigbag salía del
// tamaño de medio lote de granel, y en el patio es bastante menos.
export const LADO_BIGBAG = 15.6;      // unidades del plano por bigbag
const HUECO_BIGBAG = 2.4;             // pasillo entre columnas
export const PASO_BIGBAG = LADO_BIGBAG + HUECO_BIGBAG;

// Dónde va cada columna y cuántos bigbags lleva. Las columnas van llenas
// (de a 3) y la última se lleva lo que sobre. Sin `bigbags_fila`, el
// grupo sale lo más cuadrado posible.
export function disposicionBigbags(n, porFila) {
  const total = Math.max(1, Math.round(n) || 1);
  const columnas = Math.ceil(total / ALTO_BIGBAGS);
  const ancho = Math.max(1, Math.min(columnas, Math.round(porFila) || Math.ceil(Math.sqrt(columnas))));
  const filas = Math.ceil(columnas / ancho);
  const W = ancho * PASO_BIGBAG - HUECO_BIGBAG, H = filas * PASO_BIGBAG - HUECO_BIGBAG;
  const pilas = Array.from({ length: columnas }, (_, i) => ({
    x: -W / 2 + (i % ancho) * PASO_BIGBAG + LADO_BIGBAG / 2,
    y: -H / 2 + Math.floor(i / ancho) * PASO_BIGBAG + LADO_BIGBAG / 2,
    alto: i < columnas - 1 ? ALTO_BIGBAGS : total - ALTO_BIGBAGS * (columnas - 1)
  }));
  // El contorno de lo que OCUPA el grupo: las filas llenas y, si la
  // última va a medias, solo sus columnas. Con 12 columnas de a 5 por
  // fila queda una L, no el rectángulo de 3 × 5 con tres huecos vacíos.
  const m = 2, r = columnas - ancho * (filas - 1);
  const x0 = -W / 2 - m, x1 = W / 2 + m, y0 = -H / 2 - m, y1 = H / 2 + m;
  const contorno = r === ancho
    ? [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    : [[x0, y0], [x1, y0], [x1, -H / 2 + (filas - 1) * PASO_BIGBAG - HUECO_BIGBAG + m],
       [-W / 2 + r * PASO_BIGBAG - HUECO_BIGBAG + m, -H / 2 + (filas - 1) * PASO_BIGBAG - HUECO_BIGBAG + m],
       [-W / 2 + r * PASO_BIGBAG - HUECO_BIGBAG + m, y1], [x0, y1]];
  // rx/ry del lote: la caja de todo, con el margen de las sombras
  return { pilas, porFila: ancho, filas, rx: f(W / 2 + m), ry: f(H / 2 + m),
           contorno: contorno.map(([x, y]) => [f(x), f(y)]) };
}

// Las columnas se ven desde arriba: se ve el bigbag de encima, y por
// debajo asoman los bordes de los de abajo, corridos hacia abajo a la
// derecha (la luz viene de arriba a la izquierda). Cuanto más alta la
// columna, más larga su sombra. Unas muescas en la esquina dicen cuántos
// tiene, para no tener que contarlos por los bordes.
//
// `cols` = [{x, y, desde, cuantos}]: en qué columna, desde qué nivel
// (0 = el piso) y cuántos bigbags pone ESTE lote. Un lote en el piso
// empieza en 0; uno montado encima de otro empieza donde acaba el de abajo.
const SUBE_NIVEL = 1.6;
function columnasBigbags(cols, col, clave, { sombra = true } = {}) {
  const L = LADO_BIGBAG, m = L / 2, r = 2.1;
  const sombras = [], bordes = [], cuerpos = [];
  cols.forEach((p, k) => {
    const tope = p.desde + p.cuantos;                   // altura total de la columna
    const subir = (tope - 1) * SUBE_NIVEL;
    const tx = p.x - subir, ty = p.y - subir;
    if (sombra) {
      const s = 2.4 + tope * 1.8;
      sombras.push(`<rect x="${f(p.x - m + s * .6)}" y="${f(p.y - m + s * .8)}" width="${L}" height="${L}" rx="${r}" fill="#0c0c0b" opacity=".22"/>`);
    }
    for (let i = p.desde; i < tope; i++) {
      const x = p.x - i * SUBE_NIVEL - m, y = p.y - i * SUBE_NIVEL - m;
      bordes.push(`<rect class="forma" x="${f(x)}" y="${f(y)}" width="${L}" height="${L}" rx="${r}" fill="${tono(col, -.2 - (tope - 1 - i) * .12)}" stroke="${TINTA}" stroke-width="1.8"/>`);
    }
    const cx = tx, cy = ty - L * .04, x0 = tx - m, y0 = ty - m, x1 = tx + m, y1 = ty + m;
    const cara = (pts, c) => `<polygon points="${pts.map((q) => q.map(f).join(',')).join(' ')}" fill="${c}"/>`;
    const id = `gbc${k}-${clave}`;
    const marcas = Array.from({ length: tope }, (_, i) =>
      `<rect x="${f(x1 - 2.8 - i * 2.2)}" y="${f(y1 - 3.4)}" width="1.5" height="2.2" fill="${TINTA}"/>`).join('');
    cuerpos.push(`<clipPath id="${id}"><rect x="${f(x0)}" y="${f(y0)}" width="${L}" height="${L}" rx="${r}"/></clipPath>
      <g clip-path="url(#${id})">
        ${cara([[x0, y0], [x1, y0], [cx, cy]], tono(col, .22))}
        ${cara([[x0, y0], [x0, y1], [cx, cy]], tono(col, .06))}
        ${cara([[x1, y0], [x1, y1], [cx, cy]], tono(col, -.12))}
        ${cara([[x0, y1], [x1, y1], [cx, cy]], tono(col, -.24))}
        <rect class="textura" x="${f(x0)}" y="${f(y0)}" width="${L}" height="${L}" fill="url(#tejido)"/>
      </g>
      <rect x="${f(x0)}" y="${f(y0)}" width="${L}" height="${L}" rx="${r}" fill="none" stroke="${TINTA}" stroke-width="1.2"/>
      <circle cx="${f(cx)}" cy="${f(cy)}" r="2.1" fill="${tono(col, -.4)}" stroke="${TINTA}" stroke-width="1"/>
      ${marcas}`);
  });
  return { base: (sombras.length ? `<g class="sombra-lote">${sombras.join('')}</g>` : '') + bordes.join(''),
           cuerpo: cuerpos.join('') };
}

export function grupoBigbags(o, color) {
  const col = hexValido(color);
  return recordar(`gb|${o.bigbags}|${o.bigbags_fila || ''}|${col}`, () => {
    const d = disposicionBigbags(o.bigbags, o.bigbags_fila);
    const g = columnasBigbags(d.pilas.map((p) => ({ x: p.x, y: p.y, desde: 0, cuantos: p.alto })),
                              col, `${o.bigbags}-${o.bigbags_fila || 0}`);
    // La base del grupo: un piso con borde que abarca todas sus columnas.
    // Con varios grupos pegados en el patio, es lo que deja ver dónde
    // acaba uno y empieza el otro; sin ella, los sacos de todos se
    // confundían en una sola mancha.
    // Bordea los bigbags que hay, no la caja: si la última fila va a
    // medias, la base no se extiende bajo los huecos vacíos.
    const piso = `<path class="piso-grupo" d="${recto(d.contorno)}" fill="${tono(col, -.55)}" fill-opacity=".45"
      stroke="${TINTA}" stroke-width="1.6" stroke-linejoin="round"/>`;
    return { ...g, base: piso + g.base, disposicion: d };
  });
}

// Un lote MONTADO sobre otro: solo sus bigbags, en los niveles que le
// tocaron. Sin sombra propia: la sombra es la del montón de abajo.
export function bigbagsEncima(cols, color, clave) {
  const col = hexValido(color);
  return recordar(`gm|${JSON.stringify(cols)}|${col}|${clave}`,
    () => columnasBigbags(cols, col, `m${clave}`, { sombra: false }));
}

// Dónde va cada bigbag de los lotes montados unos sobre otros. `abajo` es
// el lote que está en el piso (con su cantidad y su reparto) y `encima`
// los que se le montaron, en el orden en que se montaron. Cada uno llena
// las columnas de abajo, en orden, sin pasar de ALTO_BIGBAGS. El que no
// cabe entero no se monta (devuelve null para él).
export function repartirEncima(abajo, encima) {
  const d = disposicionBigbags(abajo.bigbags, abajo.bigbags_fila);
  const alto = d.pilas.map((p) => p.alto);
  const res = new Map();
  for (const l of encima) {
    let resto = Math.max(1, Math.round(Number(l.bigbags)) || 1);
    const cols = [], antes = alto.slice();
    for (let i = 0; i < alto.length && resto > 0; i++) {
      const c = Math.min(ALTO_BIGBAGS - alto[i], resto);
      if (c > 0) { cols.push({ x: d.pilas[i].x, y: d.pilas[i].y, desde: alto[i], cuantos: c }); alto[i] += c; resto -= c; }
    }
    if (resto > 0) { alto.splice(0, alto.length, ...antes); res.set(l.id, null); continue; }
    res.set(l.id, cols);
  }
  return res;
}

// ============================================================= pila
// La pila es UN montón. No se dibujan los lotes de adentro: con ochenta
// en una pila, ochenta códigos encimados en un teléfono no se leen. El
// borde es el que se le da en el mapa (vértices, como siempre) y al
// sumarle lotes no se ensancha: SUBE.
//
// Cada nivel es la curva "a tal distancia del borde": un montón de
// verdad sube con la misma pendiente desde cualquier lado, sea cual sea
// la forma. Se calcula con un mapa de distancias sobre una cuadrícula y
// se traza con cuadrados marchantes, así que entrantes, cuellos y
// lóbulos salen bien solos (una pila en riñón tiene dos cimas).

// Borde con las esquinas redondeadas igual que rutaRedondeada() de
// mapa.js, muestreado en puntos.
export function muestrear(ps, maxR = 18, paso = 4) {
  const n = ps.length, out = [];
  const esq = ps.map((b, i) => {
    const a = ps[(i - 1 + n) % n], c = ps[(i + 1) % n];
    const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, l2 = Math.hypot(c[0] - b[0], c[1] - b[1]) || 1;
    const r = Math.min(maxR, l1 * .35, l2 * .35);
    return { e: [b[0] + (a[0] - b[0]) / l1 * r, b[1] + (a[1] - b[1]) / l1 * r],
             g: [b[0] + (c[0] - b[0]) / l2 * r, b[1] + (c[1] - b[1]) / l2 * r] };
  });
  for (let i = 0; i < n; i++) {
    const { e, g } = esq[i], b = ps[i];
    for (let j = 0; j < 5; j++) {
      const t = j / 5, u = 1 - t;
      out.push([u * u * e[0] + 2 * u * t * b[0] + t * t * g[0], u * u * e[1] + 2 * u * t * b[1] + t * t * g[1]]);
    }
    const h = esq[(i + 1) % n].e, L = Math.hypot(h[0] - g[0], h[1] - g[1]), k = Math.max(1, Math.ceil(L / paso));
    for (let j = 0; j < k; j++) out.push([g[0] + (h[0] - g[0]) * j / k, g[1] + (h[1] - g[1]) * j / k]);
  }
  return out;
}
const areaDe = (ps) => Math.abs(ps.reduce((s, p, i) => {
  const q = ps[(i + 1) % ps.length]; return s + p[0] * q[1] - q[0] * p[1];
}, 0) / 2);

function campoDistancia(m) {
  const xs = m.map((p) => p[0]), ys = m.map((p) => p[1]);
  const lado = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const g = Math.max(4, lado / 110);           // nunca más de ~110 celdas por lado
  const x0 = Math.min(...xs) - g * 2, y0 = Math.min(...ys) - g * 2;
  const nx = Math.ceil((Math.max(...xs) - x0) / g) + 3, ny = Math.ceil((Math.max(...ys) - y0) / g) + 3;
  const ref = m.filter((_, i) => i % 2 === 0), D = new Float32Array(nx * ny);
  let max = 0;
  for (let j = 0; j < ny; j++) {
    // por filas: dónde entra y sale el borde, y solo se mide lo de adentro
    const y = y0 + j * g, cortes = [];
    for (let a = 0, b = m.length - 1; a < m.length; b = a++) {
      const [xa, ya] = m[a], [xb, yb] = m[b];
      if ((ya > y) !== (yb > y)) cortes.push(xa + (y - ya) * (xb - xa) / (yb - ya));
    }
    cortes.sort((p, q) => p - q);
    for (let c = 0; c + 1 < cortes.length; c += 2) {
      for (let i = Math.max(0, Math.ceil((cortes[c] - x0) / g)); x0 + i * g <= cortes[c + 1] && i < nx; i++) {
        const x = x0 + i * g; let d = Infinity;
        for (const p of ref) { const v = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (v < d) d = v; }
        d = Math.sqrt(d); D[j * nx + i] = d; if (d > max) max = d;
      }
    }
  }
  return { D, nx, ny, x0, y0, g, max };
}

// Cuadrados marchantes: qué lados de cada celda corta la curva.
const TABLA = { 1: 'LB', 2: 'BR', 3: 'LR', 4: 'TR', 5: 'TRLB', 6: 'TB', 7: 'TL',
  8: 'LT', 9: 'TB', 10: 'LTBR', 11: 'TR', 12: 'LR', 13: 'BR', 14: 'LB' };
function curvasA(campo, t) {
  const { D, nx, ny, x0, y0, g } = campo, pts = new Map(), vec = new Map();
  const v = (i, j) => D[j * nx + i];
  const punto = (lado, i, j) => {
    let k, x, y;
    if (lado === 'T' || lado === 'B') {
      const jj = lado === 'T' ? j : j + 1, a = v(i, jj), b = v(i + 1, jj);
      k = `h${i},${jj}`; x = x0 + (i + (t - a) / (b - a)) * g; y = y0 + jj * g;
    } else {
      const ii = lado === 'L' ? i : i + 1, a = v(ii, j), b = v(ii, j + 1);
      k = `v${ii},${j}`; x = x0 + ii * g; y = y0 + (j + (t - a) / (b - a)) * g;
    }
    if (!pts.has(k)) pts.set(k, [x, y]);
    return k;
  };
  const unir = (a, b) => {
    if (!vec.has(a)) vec.set(a, []); if (!vec.has(b)) vec.set(b, []);
    vec.get(a).push(b); vec.get(b).push(a);
  };
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const c = (v(i, j) >= t ? 8 : 0) | (v(i + 1, j) >= t ? 4 : 0) | (v(i + 1, j + 1) >= t ? 2 : 0) | (v(i, j + 1) >= t ? 1 : 0);
    const s = TABLA[c]; if (!s) continue;
    for (let q = 0; q < s.length; q += 2) unir(punto(s[q], i, j), punto(s[q + 1], i, j));
  }
  const vistos = new Set(), lazos = [];
  for (const ini of vec.keys()) {
    if (vistos.has(ini)) continue;
    const lazo = []; let ant = null, act = ini;
    while (act && !vistos.has(act)) {
      vistos.add(act); lazo.push(pts.get(act));
      const sig = (vec.get(act) || []).find((k) => k !== ant && !vistos.has(k));
      ant = act; act = sig;
    }
    if (lazo.length >= 6) lazos.push(lazo.filter((_, i) => i % 2 === 0));
  }
  return lazos;
}

// Cuántos lotes llenan una pila hasta la cima, según su área. Un lote
// ocupa unas 4300 unidades² de plano y en una pila se apilan en unas dos
// capas. Es un número a calibrar con pilas reales del patio.
export const AREA_POR_LOTE = 2200;
const MATERIAL = '#a8957a';

// `ps` son los vértices locales [[x, y]…]; `n` cuántos lotes tiene;
// `colTipo` el color del tipo de pila, que va en la franja del pie: el
// montón es de material, no de color verde o rojo.
export function montonPila(ps, n, colTipo) {
  const col = hexValido(colTipo, TINTA);
  return recordar(`p|${JSON.stringify(ps)}|${n}|${col}`, () => {
    const m = muestrear(ps);
    const campo = campoDistancia(m);
    // las pilas grandes no se llenan de rayas: a lo sumo ~14 niveles
    const paso = Math.max(9, campo.max / 14);
    const Lmax = Math.max(1, Math.floor(campo.max / paso));
    const lleno = Math.max(8, areaDe(m) / AREA_POR_LOTE);
    const L = n <= 0 ? 0 : Math.min(Lmax, Math.max(1, Math.ceil(Lmax * Math.min(1, n / lleno))));
    const contorno = recto(m), id = 'p' + (cache.size + 1);
    let capas = '';
    for (let k = 0; k < L; k++) {
      const d = curvasA(campo, (k + 1) * paso).map(suave).join('');
      if (!d) break;
      const t = -.08 + (k + 1) * (.34 / Math.max(L, 1));
      capas += `<path d="${d}" transform="translate(1.8 2.2)" fill="${tono(MATERIAL, -.5)}" opacity=".55"/>
        <path d="${d}" transform="translate(-1.3 -1.6)" fill="${tono(MATERIAL, .5)}" opacity=".65"/>
        <path d="${d}" fill="${tono(MATERIAL, t)}"/>`;
    }
    const off = 4 + L * .5;
    const xs = m.map((p) => p[0]), ymin = Math.min(...m.map((p) => p[1]));
    const arriba = m.filter((p) => p[1] < ymin + 6);
    return {
      svg: `<path class="sombra-lote" d="${contorno}" transform="translate(${f(off)} ${f(off * 1.25)})" fill="#0c0c0b" opacity=".22"/>
        <clipPath id="${id}"><path d="${contorno}"/></clipPath>
        <path class="forma" d="${contorno}" fill="${tono(MATERIAL, -.16)}" stroke="${TINTA}" stroke-width="2.6" stroke-linejoin="round"/>
        <g clip-path="url(#${id})">${capas}
          <rect class="textura" x="${f(Math.min(...xs) - 20)}" y="${f(ymin - 20)}" width="${f(Math.max(...xs) - Math.min(...xs) + 40)}"
            height="${f(Math.max(...m.map((p) => p[1])) - ymin + 40)}" fill="url(#gravilla)"/>
          <path d="${contorno}" fill="none" stroke="${col}" stroke-width="12"/></g>
        <path d="${contorno}" fill="none" stroke="${TINTA}" stroke-width="2.6" stroke-linejoin="round"/>`,
      niveles: L, nivelesMax: Lmax,
      ancho: Math.max(...xs) - Math.min(...xs),
      tope: [arriba.reduce((s, p) => s + p[0], 0) / arriba.length, ymin]
    };
  });
}

// Texto PINTADO sobre el material: letra blanca con filo negro, como
// marcado con spray. El filo va por detrás del relleno (paint-order), así
// que engorda hacia afuera y la letra no adelgaza. Sirve para el código
// de un lote y para el nombre de una pila. `texto` y `volqueta` llegan ya
// escapados.
//
// `texto` puede ser una lista de renglones: el bloque queda centrado en
// (x, y), así que un nombre en dos o tres renglones no se corre hacia
// abajo.
export const INTERLINEA = 1.1;
export function pintado(texto, t, x, y, { volqueta = '', espaciado = .04, clase = '' } = {}) {
  const lineas = Array.isArray(texto) ? texto : [texto];
  const y0 = y - (lineas.length - 1) * t * INTERLINEA / 2;
  const cuerpo = lineas.length === 1 ? lineas[0]
    : lineas.map((l, i) => `<tspan x="${f(x)}" ${i ? `dy="${f(t * INTERLINEA)}"` : ''}>${l}</tspan>`).join('');
  return `<text x="${f(x)}" y="${f(y0)}" text-anchor="middle"${clase ? ` class="${clase}"` : ''}
    font-size="${f(t)}" letter-spacing="${f(t * espaciado)}" fill="#fdfbf7"
    stroke="${TINTA}" stroke-width="${f(Math.max(2, t * .22))}" stroke-linejoin="round" paint-order="stroke">${cuerpo}${
    volqueta ? `<tspan font-size="62%" dy="${f(-t * .38)}">${volqueta}</tspan>` : ''}</text>`;
}

// Parte un nombre en `n` renglones por sus espacios, de forma que el
// renglón más largo sea lo más corto posible. Lo que va entre paréntesis
// no se parte ("PILA 1" / "(ARENAS FINAS)"), y un nombre de una sola
// palabra tampoco. Con `n` mayor que las palabras, una por renglón.
export function partirEnRenglones(texto, n) {
  const w = String(texto).match(/\([^)]*\)?|[^\s(]+/g) || [];
  if (n <= 1 || w.length < 2) return [w.join(' ')];
  const n2 = Math.min(n, w.length);
  let mejor = null;
  // todas las formas de cortar: los nombres de pila tienen pocas palabras
  const probar = (desde, quedan, r) => {
    if (quedan === 1) {
      const todo = [...r, w.slice(desde).join(' ')];
      const largo = Math.max(...todo.map((x) => x.length));
      if (!mejor || largo < mejor.largo) mejor = { r: todo, largo };
      return;
    }
    for (let i = desde + 1; i <= w.length - quedan + 1; i++) probar(i, quedan - 1, [...r, w.slice(desde, i).join(' ')]);
  };
  probar(0, n2, []);
  return mejor.r;
}

// ======================================================== volqueta
// Vista desde arriba, como el plano. Mira hacia +x y el origen es el
// borde trasero del volco, donde cae el material. Las partes que se
// animan llevan clase: vq-volco, vq-carga, vq-compuerta, vq-piston,
// vq-humo, vq-baliza.
export function volquetaPlanta(carga) {
  const A = '#f2c007', A2 = '#c99d00', col = hexValido(carga);
  const ruedas = [[24, -31], [24, 31], [47, -31], [47, 31], [130, -30], [130, 30]].map(([x, y]) =>
    `<rect x="${x - 10}" y="${y - 5}" width="20" height="10" rx="2.5" fill="${TINTA}"/>
     <path d="M${x - 6} ${y - 5}v10M${x - 1} ${y - 5}v10M${x + 4} ${y - 5}v10" stroke="#55534c" stroke-width="1.4"/>`).join('');
  const costillas = [16, 32, 48, 64, 80].map((x) => `M${x} -29v5M${x} 29v-5`).join('');
  return `
  <rect x="2" y="-30" width="156" height="60" rx="7" fill="#0c0c0b" opacity=".22" transform="translate(7 9)"/>
  ${ruedas}
  <rect x="2" y="-21" width="150" height="42" rx="3" fill="#2a2a26" stroke="${TINTA}" stroke-width="2"/>
  <path d="M8 -21v42M60 -21v42M100 -21v42" stroke="#45433d" stroke-width="2"/>
  <g class="vq-piston" opacity="0">
    <rect x="58" y="-6" width="46" height="12" rx="3" fill="#c9ccc6" stroke="${TINTA}" stroke-width="2"/>
    <rect x="60" y="-4" width="42" height="3" fill="#fff" opacity=".7"/>
    <rect x="96" y="-9" width="12" height="18" rx="2" fill="#5f6863" stroke="${TINTA}" stroke-width="2"/>
  </g>
  <g class="vq-volco">
    <rect x="0" y="-30" width="108" height="60" rx="3" fill="${A}" stroke="${TINTA}" stroke-width="3.5"/>
    <rect x="6" y="-24" width="90" height="48" fill="${A2}" stroke="${TINTA}" stroke-width="2"/>
    <path d="M8 -22l86 44M8 22l86 -44" stroke="${TINTA}" stroke-width="1" opacity=".2"/>
    <g class="vq-carga">
      <rect x="6" y="-24" width="90" height="48" fill="${tono(col, -.12)}"/>
      <path d="M6 -10Q50 -16 96 -8V8Q50 16 6 10Z" fill="${tono(col, .14)}"/>
      <path d="M6 -3Q50 -6 96 -2V2Q50 5 6 3Z" fill="${tono(col, .3)}"/>
      <rect x="6" y="-24" width="90" height="48" fill="url(#gravilla)"/>
    </g>
    <path d="${costillas}" stroke="${TINTA}" stroke-width="2"/>
    <rect x="96" y="-30" width="12" height="60" fill="${A2}" stroke="${TINTA}" stroke-width="2.5"/>
    <path d="M99 -26l6 6M99 -14l6 6M99 -2l6 6M99 10l6 6" stroke="${TINTA}" stroke-width="1.6"/>
  </g>
  <g class="vq-compuerta">
    <rect x="-3" y="-30" width="6" height="60" rx="1.5" fill="${A}" stroke="${TINTA}" stroke-width="2.5"/>
    <circle cx="0" cy="-30" r="3" fill="${TINTA}"/><circle cx="0" cy="30" r="3" fill="${TINTA}"/>
  </g>
  <rect x="-1" y="-27" width="3" height="7" fill="#c0281a"/><rect x="-1" y="20" width="3" height="7" fill="#c0281a"/>
  <rect x="112" y="-28" width="44" height="56" rx="8" fill="${A}" stroke="${TINTA}" stroke-width="3.5"/>
  <rect x="117" y="-21" width="24" height="42" rx="4" fill="#ffd84a" stroke="${TINTA}" stroke-width="1.6"/>
  <path d="M146 -24Q153 0 146 24L152 22Q157 0 152 -22Z" fill="#23303a" stroke="${TINTA}" stroke-width="2"/>
  <path d="M149 -14Q151 -6 150 0" stroke="#fff" stroke-width="1.4" opacity=".7" fill="none"/>
  <path d="M146 -28l3 -6M146 28l3 6" stroke="${TINTA}" stroke-width="2.4"/>
  <rect x="145" y="-40" width="9" height="6" rx="1" fill="${TINTA}"/><rect x="145" y="34" width="9" height="6" rx="1" fill="${TINTA}"/>
  <rect x="155" y="-23" width="3" height="8" fill="#fdfbf7" stroke="${TINTA}" stroke-width="1"/>
  <rect x="155" y="15" width="3" height="8" fill="#fdfbf7" stroke="${TINTA}" stroke-width="1"/>
  <circle cx="110" cy="-25" r="3.5" fill="${TINTA}"/>
  <circle class="vq-humo" cx="104" cy="-31" r="6" fill="#45433d" opacity="0"/>
  <g transform="translate(129 0)">
    <g class="vq-baliza"><path d="M0 0L26 -9A27 27 0 0 1 26 9Z" fill="#ffb000" opacity=".4"/></g>
    <circle r="5" fill="#ff8a00" stroke="${TINTA}" stroke-width="2"/>
  </g>`;
}

// Piedras que caen de la compuerta: forma, sitio y giro fijos por semilla.
export function terrones(color, cuantos = 16) {
  const rnd = azar('terrones'), col = hexValido(color);
  return Array.from({ length: cuantos }, (_, i) => {
    const n = 5, s = 2.5 + rnd() * 3;
    const ps = Array.from({ length: n }, (_, j) => {
      const b = (j / n) * Math.PI * 2 + rnd();
      return [Math.cos(b) * s * (.7 + rnd() * .5), Math.sin(b) * s * (.7 + rnd() * .5)];
    });
    // kx: qué tan lejos rueda, como fracción del ancho del lote
    return { d: recto(ps), y: (rnd() - .5) * 44, kx: rnd(), dy: (rnd() - .5) * 30,
             relleno: tono(col, (i % 3 - 1) * .15) };
  });
}
