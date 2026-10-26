// =====================================================================
//  gps.js · dónde está el celular, puesto sobre el plano del patio
//
//  El plano no es un mapa: son unidades inventadas (1000 × 700) sobre un
//  dibujo del patio. Para pintar encima una coordenada de verdad hay que
//  saber dónde cae ese dibujo en el mundo, y eso es la CALIBRACIÓN: puntos
//  del plano con su latitud y longitud. Con dos basta para sacar la
//  escala, el giro y el desplazamiento; con más, la cuenta reparte el
//  error y dice cuánto se equivoca en cada uno.
//
//  Aquí no hay red ni pantalla: solo la cuenta y el reloj del GPS. Así se
//  prueba en Node sin navegador.
// =====================================================================

// Radio de la Tierra (WGS84, el de los GPS), en metros.
const RADIO = 6378137;
const RAD = Math.PI / 180;

// Puntos de calibración que no se separan más que esto no sirven: un GPS
// de celular se equivoca de 3 a 10 metros, y con los puntos a diez metros
// ese error es la mitad de la distancia entre ellos. El plano saldría
// girado y a otra escala. A veinte metros el error ya se reparte.
export const DISTANCIA_MINIMA_M = 20;

// Desde cuántos puntos se corrige también un plano estirado. Ver `ajustar`.
export const PUNTOS_PARA_ESTIRAR = 4;

// Un punto que se aparta más que esto de lo que dicen los demás está,
// casi seguro, mal marcado. Se avisa; no se descarta solo.
export const ERROR_SOSPECHOSO_M = 8;

// Con los puntos apartándose esto en promedio, el punto azul caería en
// cualquier lado: no se deja guardar.
export const ERROR_INSERVIBLE_M = 30;

// Una lectura con más error que esto no se usa para calibrar: es la que
// da el teléfono cuando todavía está buscando satélites, o bajo techo.
export const PRECISION_CALIBRAR_M = 25;

// Metros al este y al norte de `origen`. Proyección plana alrededor del
// origen: en un patio de cientos de metros el error es de milímetros, y
// no hace falta nada más fino.
export function aMetros(origen, p) {
  return {
    e: (p.lon - origen.lon) * RAD * RADIO * Math.cos(origen.lat * RAD),
    n: (p.lat - origen.lat) * RAD * RADIO
  };
}

export const distanciaM = (a, b) => {
  const m = aMetros(a, b);
  return Math.hypot(m.e, m.n);
};

const numero = (v) => typeof v === 'number' && Number.isFinite(v);
const puntoValido = (p) => !!p && numero(p.x) && numero(p.y) && numero(p.lat) && numero(p.lon)
  && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

// Los puntos de una calibración. La primera versión guardaba exactamente
// dos, como `a` y `b`; las de ahora guardan una lista. Las dos se leen.
export const puntosDe = (geo) => (Array.isArray(geo?.puntos) ? geo.puntos
  : geo?.a && geo?.b ? [geo.a, geo.b] : []);

// La cuenta, ya hecha, de cada calibración. Se pregunta en cada lectura
// del GPS y por cada plataforma; rehacer los mínimos cuadrados cada vez
// sería gastar por gastar. La calibración nunca se modifica en sitio:
// cambiarla es guardar un objeto nuevo, así que la llave no miente.
const hechas = new WeakMap();

// De coordenadas a plano, con todos los puntos a la vez.
//
// Se trabaja en metros al este y al SUR de los puntos: en el plano la `y`
// crece hacia abajo, como en cualquier pantalla, y en el mundo el norte
// crece hacia arriba. Sin ese cambio el patio salía como visto en un
// espejo, que es un error que no se arregla girando: todo cuadraba en los
// puntos marcados y en cualquier otro sitio el punto azul se iba al lado
// opuesto.
//
// Con dos o tres puntos el plano solo se escala, se gira y se mueve, sin
// deformarse. Con cuatro o más también se deja estirar en un sentido más
// que en el otro (afín), que es lo que pasa cuando el dibujo no guarda
// del todo las proporciones del patio. Con tres se podría estirar igual,
// pero quedaría justo, sin un punto de sobra que delate al mal marcado:
// el error de cada uno saldría siempre cero, y eso es mentir.
//
// En los dos casos es un ajuste por mínimos cuadrados: si sobran puntos,
// el error se reparte, y cada punto sabe cuánto se aparta de los demás.
//
// `tipo` lo fija quien mide el error de cada punto (ver `errores` abajo):
// rehace la cuenta sin un punto y tiene que hacerla del mismo tipo que la
// de todos, aunque le quede un punto menos.
function ajustar(ps, { tipo: fijo = null, medir = true } = {}) {
  const n = ps.length;
  const origen = { lat: ps.reduce((s, p) => s + p.lat, 0) / n,
                   lon: ps.reduce((s, p) => s + p.lon, 0) / n };
  const z = ps.map((p) => { const m = aMetros(origen, p); return { e: m.e, s: -m.n }; });
  const me = z.reduce((s, q) => s + q.e, 0) / n, ms = z.reduce((s, q) => s + q.s, 0) / n;
  const mx = ps.reduce((s, p) => s + p.x, 0) / n, my = ps.reduce((s, p) => s + p.y, 0) / n;
  let see = 0, sss = 0, ses = 0, sxe = 0, sxs = 0, sye = 0, sys = 0;
  ps.forEach((p, i) => {
    const de = z[i].e - me, ds = z[i].s - ms, dx = p.x - mx, dy = p.y - my;
    see += de * de; sss += ds * ds; ses += de * ds;
    sxe += dx * de; sxs += dx * ds; sye += dy * de; sys += dy * ds;
  });
  if (see + sss === 0) return null;

  // la matriz M lleva (este, sur) en metros a (x, y) del plano
  let m11, m12, m21, m22, tipo = 'semejanza';
  const det = see * sss - ses * ses;
  // Puntos casi en fila no dicen nada del ancho: estirar con ellos sería
  // inventárselo. Ahí se queda en semejanza aunque haya muchos.
  const enFila = det < 1e-3 * ((see + sss) / 2) ** 2;
  if ((fijo ? fijo === 'afin' : n >= PUNTOS_PARA_ESTIRAR) && !enFila) {
    tipo = 'afin';
    m11 = (sxe * sss - sxs * ses) / det; m12 = (sxs * see - sxe * ses) / det;
    m21 = (sye * sss - sys * ses) / det; m22 = (sys * see - sye * ses) / det;
  } else {
    // α = Σ w·conj(z) / Σ |z|², con z = este + i·sur y w = x + i·y
    const ar = (sxe + sys) / (see + sss), ai = (sye - sxs) / (see + sss);
    m11 = ar; m12 = -ai; m21 = ai; m22 = ar;
  }
  const dm = m11 * m22 - m12 * m21;
  if (!numero(dm) || dm === 0) return null;

  const aPlano = (lat, lon) => {
    const m = aMetros(origen, { lat, lon });
    const de = m.e - me, ds = -m.n - ms;
    return { x: mx + m11 * de + m12 * ds, y: my + m21 * de + m22 * ds };
  };
  const aGeo = (x, y) => {
    const dx = x - mx, dy = y - my;
    const e = me + (m22 * dx - m12 * dy) / dm;
    const s = ms + (-m21 * dx + m11 * dy) / dm;
    return { lat: origen.lat - (s / RADIO) / RAD,
             lon: origen.lon + (e / (RADIO * Math.cos(origen.lat * RAD))) / RAD };
  };
  // lo que no cuadra dentro de esta misma cuenta, en metros
  const rms = Math.sqrt(ps.reduce((acc, p) => acc + distanciaM(aGeo(p.x, p.y), p) ** 2, 0) / n);
  const sinCadaUno = medir && n > 2
    ? ps.map((_, i) => ajustar(ps.filter((__, j) => j !== i), { tipo, medir: false }))
    : ps.map(() => null);
  return {
    tipo,
    // Un plano con el determinante negativo está al revés: solo pasa si
    // algún punto se marcó en el sitio que no era.
    espejo: dm < 0,
    // unidades del plano que mide un metro de verdad (la media, si el
    // plano está más estirado en un sentido)
    escala: Math.sqrt(Math.abs(dm)),
    aPlano,
    aGeo,
    // Cuánto se aparta cada punto, en metros, de donde lo ponen LOS
    // DEMÁS: se rehace la cuenta sin él y se mira adónde cae su sitio del
    // plano. Medirlo contra la cuenta hecha con él dentro escondía al
    // mal marcado: él mismo tira del ajuste hacia su lado, y su error
    // salía repartido entre todos, ninguno lo bastante grande para verse.
    // Con dos puntos no hay "los demás", y el error es cero.
    errores: sinCadaUno.map((o, i) => (o ? distanciaM(o.aGeo(ps[i].x, ps[i].y), ps[i]) : 0)),
    // y adónde lo ponen, para dibujar la raya del desvío
    predichos: sinCadaUno.map((o, i) => (o ? o.aGeo(ps[i].x, ps[i].y) : null)),
    // Y cuánto se separan entre sí los demás cuando falta él. Quitar el
    // mal marcado deja a los otros de acuerdo; quitar uno bueno, no.
    restos: sinCadaUno.map((o) => (o ? o.rms : 0)),
    rms
  };
}

const cuenta = (geo) => {
  if (!geo || typeof geo !== 'object') return null;
  if (!hechas.has(geo)) {
    const ps = puntosDe(geo);
    hechas.set(geo, ps.length >= 2 && ps.every(puntoValido) ? ajustar(ps) : null);
  }
  return hechas.get(geo);
};

// Qué le falta a una calibración para servir. null = sirve.
export function problemaCalibracion(geo) {
  const ps = puntosDe(geo);
  if (ps.length < 2) return 'hacen falta al menos dos puntos';
  if (!ps.every(puntoValido)) return 'un punto tiene coordenadas inválidas';
  let lejos = 0;
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      if (Math.hypot(ps[j].x - ps[i].x, ps[j].y - ps[i].y) < 1)
        return `los puntos ${i + 1} y ${j + 1} están marcados en el mismo sitio del plano`;
      lejos = Math.max(lejos, distanciaM(ps[i], ps[j]));
    }
  }
  if (lejos < DISTANCIA_MINIMA_M)
    return `los puntos están a ${Math.round(lejos)} m como mucho; tienen que separarse al menos ${DISTANCIA_MINIMA_M} m`;
  const t = cuenta(geo);
  if (!t) return 'con estos puntos no se puede ubicar el plano';
  if (t.espejo) return 'el plano saldría al revés, como en un espejo: algún punto quedó marcado en el sitio equivocado';
  return null;
}

export function transformacion(geo) {
  return problemaCalibracion(geo) ? null : cuenta(geo);
}

// "2,4 m": así se lee en Colombia, con coma, y con un decimal solo
// mientras el decimal diga algo.
export const metros = (v) => `${v < 10 ? v.toFixed(1).replace('.', ',') : Math.round(v)} m`;

// Cuál es el punto mal marcado, si se puede saber. -1 si no.
//
// Se señala UNO solo, y solo cuando está claro: un punto mal marcado
// tuerce también la cuenta de los demás, y acusar a uno bueno es peor
// que no acusar a nadie, porque lo que sigue es borrarlo.
//
// Con puntos de sobra se mira a quién hay que quitar para que los demás
// queden de acuerdo entre sí. Con los justos para la cuenta —dos para no
// deformar, tres para estirar— quitar cualquiera deja una cuenta exacta
// y eso no dice nada; ahí solo se señala si uno se aparta bastante más
// que todos los otros.
function sospechoso(t, n) {
  const justos = t.tipo === 'afin' ? 3 : 2;
  if (n - 1 > justos) {
    const i = t.restos.indexOf(Math.min(...t.restos));
    const otros = t.restos.filter((_, j) => j !== i);
    return t.errores[i] > ERROR_SOSPECHOSO_M && t.restos[i] * 2 < Math.min(...otros) ? i : -1;
  }
  const orden = t.errores.map((_, j) => j).sort((a, b) => t.errores[b] - t.errores[a]);
  const [a, b] = orden;
  return t.errores[a] > ERROR_SOSPECHOSO_M && t.errores[a] > 1.5 * t.errores[b] ? a : -1;
}

// Cómo va una lista de puntos mientras se calibra, en palabras. Lo usan
// las dos pantallas —el mapa, caminando, y la ventana de la oficina— para
// que digan exactamente lo mismo.
//
// Con dos puntos el error siempre da cero: no hay ningún punto de sobra
// con qué comparar. Ahí no se enseña, porque un cero no dice nada.
export function revisarPuntos(puntos) {
  const geo = { puntos };
  const n = puntos.length;
  const problema = n >= 2 ? problemaCalibracion(geo) : null;
  const t = transformacion(geo);
  const conError = !!t && n >= 3;
  const peor = conError ? sospechoso(t, n) : -1;
  const malos = new Set(peor >= 0 ? [peor] : []);
  const medio = conError ? t.errores.reduce((s, e) => s + e, 0) / n : 0;
  const inservible = conError && medio > ERROR_INSERVIBLE_M;
  const resumen = problema ? `No sirve todavía: ${problema}.`
    : conError ? `Error medio ${metros(medio)}${inservible ? ', demasiado para guardar' : ''}`
      + (peor >= 0 ? ` · el punto ${peor + 1} parece mal marcado`
        : medio > ERROR_SOSPECHOSO_M ? ' · los puntos no concuerdan: revisa que cada uno esté en el mismo sitio en el plano y en la foto'
        : '')
      + (t.tipo === 'afin' ? ' · corrige el estiramiento' : '')
    : '';
  return { t, problema, conError, malos, resumen, listo: n >= 2 && !problema && !inservible };
}

// ¿El punto cae dentro del plano, con un margen en metros alrededor?
// El margen está para no perder a alguien que va por la vía de acceso,
// justo al borde del dibujo.
export function dentroDelPlano(plat, t, pt, margenM = 15) {
  const m = margenM * t.escala;
  const ancho = Number(plat.ancho) || 1000, alto = Number(plat.alto) || 700;
  return pt.x >= -m && pt.y >= -m && pt.x <= ancho + m && pt.y <= alto + m;
}

// En qué plataforma calibrada está una coordenada, y en qué punto de su
// plano. La primera que la contenga: las plataformas no se pisan.
export function dondeCae(plataformas, lat, lon, margenM) {
  for (const plat of plataformas || []) {
    const t = transformacion(plat.geo);
    if (!t) continue;
    const pt = t.aPlano(lat, lon);
    if (dentroDelPlano(plat, t, pt, margenM)) return { plat, t, pt };
  }
  return null;
}

// Promedio de varias lecturas, pesando cada una por lo buena que es: una
// de ±3 m cuenta diez veces más que una de ±10 m. Es lo que se usa para
// calibrar, que es donde un error se arrastra para siempre.
export function promediar(lecturas) {
  const buenas = (lecturas || []).filter((l) => numero(l.lat) && numero(l.lon)
    && numero(l.precision) && l.precision > 0 && l.precision <= PRECISION_CALIBRAR_M);
  if (!buenas.length) return null;
  let sp = 0, la = 0, lo = 0;
  for (const l of buenas) {
    const p = 1 / (l.precision * l.precision);
    sp += p; la += l.lat * p; lo += l.lon * p;
  }
  // el error del promedio baja con la raíz de cuántas lecturas entraron
  return { lat: la / sp, lon: lo / sp, precision: Math.sqrt(1 / sp), n: buenas.length };
}

// "6.2442, -75.5812" tal como lo copia Google Maps al tocar un punto.
// También acepta punto y coma o espacios, y el enlace entero de Google
// Maps, que lleva la coordenada después de una arroba ("…/@6.2442,-75.5812,17z")
// o en la búsqueda ("…?q=6.2442,-75.5812"): desde la oficina es lo que
// se copia de la barra del navegador.
export function leerCoordenadas(texto) {
  const t = String(texto ?? '').trim();
  const m = t.match(/^(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)$/)
    || t.match(/[@=](-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

// --------------------------------------------------------------- el GPS
// Una sola vigilancia a la vez: si se pidiera dos veces, el teléfono
// tendría dos GPS prendidos gastando batería por lo mismo.
let vigia = null;

export const hayGps = () => typeof navigator !== 'undefined' && 'geolocation' in navigator;

export function seguir(alLeer, alFallar) {
  detener();
  if (!hayGps()) { alFallar?.({ code: 0 }); return; }
  vigia = navigator.geolocation.watchPosition(
    (p) => alLeer({
      lat: p.coords.latitude, lon: p.coords.longitude,
      precision: p.coords.accuracy, cuando: Date.now()
    }),
    (e) => alFallar?.(e),
    // `maximumAge` corto: una posición de hace un minuto es la de otro
    // sitio del patio. Alta precisión es lo que prende el GPS de verdad;
    // sin ella el teléfono se conforma con las antenas, que en una mina
    // es un error de cientos de metros.
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
}

export function detener() {
  if (vigia !== null && hayGps()) navigator.geolocation.clearWatch(vigia);
  vigia = null;
}

export const siguiendo = () => vigia !== null;

// Lo que se le dice a la persona. El código 1 es el único que no se
// arregla esperando: hay que ir a los permisos del teléfono.
export function motivoFallo(e) {
  if (!hayGps() || e?.code === 0) return 'Este teléfono no tiene GPS disponible para la app.';
  if (e?.code === 1) return 'La app no tiene permiso de ubicación. Actívalo en los ajustes del navegador para este sitio.';
  if (e?.code === 2) return 'El teléfono no logra ubicarse. Prende la ubicación del teléfono o sal a cielo abierto.';
  return 'El GPS está tardando en responder. Sigue intentando.';
}
