// =====================================================================
//  gps.js · dónde está el celular, puesto sobre el plano del patio
//
//  El plano no es un mapa: son unidades inventadas (1000 × 700) sobre un
//  dibujo del patio. Para pintar encima una coordenada de verdad hay que
//  saber dónde cae ese dibujo en el mundo, y eso es la CALIBRACIÓN: dos
//  puntos del plano con su latitud y longitud. Con dos basta para sacar
//  la escala, el giro y el desplazamiento.
//
//  Aquí no hay red ni pantalla: solo la cuenta y el reloj del GPS. Así se
//  prueba en Node sin navegador.
// =====================================================================

// Radio de la Tierra (WGS84, el de los GPS), en metros.
const RADIO = 6378137;
const RAD = Math.PI / 180;

// Dos puntos de calibración a menos de esto no sirven: un GPS de celular
// se equivoca de 3 a 10 metros, y con los puntos a diez metros ese error
// es la mitad de la distancia entre ellos. El plano saldría girado y a
// otra escala. A veinte metros el error ya se reparte.
export const DISTANCIA_MINIMA_M = 20;

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

// Qué le falta a una calibración para servir. null = sirve.
export function problemaCalibracion(geo) {
  if (!geo?.a || !geo?.b) return 'faltan los dos puntos';
  if (!puntoValido(geo.a) || !puntoValido(geo.b)) return 'un punto tiene coordenadas inválidas';
  const metros = distanciaM(geo.a, geo.b);
  if (metros < DISTANCIA_MINIMA_M)
    return `los dos puntos están a ${Math.round(metros)} m; tienen que estar al menos a ${DISTANCIA_MINIMA_M} m`;
  if (Math.hypot(geo.b.x - geo.a.x, geo.b.y - geo.a.y) < 1)
    return 'los dos puntos son el mismo sitio del plano';
  return null;
}

// De coordenadas a plano.
//
// Se cuenta con números complejos porque una semejanza —escalar, girar y
// desplazar— es justo multiplicar y sumar uno: w = α·z + β. Con dos
// pares (z, w) se despeja α y se acabó.
//
// El norte se pone NEGATIVO: en el plano la `y` crece hacia abajo, como
// en cualquier pantalla, y en el mundo el norte crece hacia arriba. Sin
// ese cambio el patio salía como visto en un espejo, que es un error que
// no se arregla girando: el admin calibraba, todo cuadraba en los dos
// puntos y en cualquier otro sitio el punto azul se iba al lado opuesto.
export function transformacion(geo) {
  if (problemaCalibracion(geo)) return null;
  const { a, b } = geo;
  const m = aMetros(a, b);
  const zr = m.e, zi = -m.n;
  const wr = b.x - a.x, wi = b.y - a.y;
  const d = zr * zr + zi * zi;
  // α = w / z
  const ar = (wr * zr + wi * zi) / d;
  const ai = (wi * zr - wr * zi) / d;
  return {
    // unidades del plano que mide un metro de verdad
    escala: Math.hypot(ar, ai),
    aPlano(lat, lon) {
      const p = aMetros(a, { lat, lon });
      const qr = p.e, qi = -p.n;
      return { x: a.x + ar * qr - ai * qi, y: a.y + ar * qi + ai * qr };
    }
  };
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
// También acepta punto y coma o espacios.
export function leerCoordenadas(texto) {
  const m = String(texto ?? '').trim().match(/^(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)$/);
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
