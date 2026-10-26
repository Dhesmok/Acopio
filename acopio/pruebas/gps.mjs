// =====================================================================
//  El GPS sobre el plano.
//
//  El plano son unidades inventadas sobre un dibujo; el GPS da latitud y
//  longitud. Lo que se prueba aquí es que la cuenta que une las dos cosas
//  ponga a cada uno donde está —y no en el espejo de donde está—, que la
//  capa del mapa no se pueda romper con un nombre raro, y que en la base
//  cada uno escriba solo su propia ubicación.
// =====================================================================
import { readFile } from 'node:fs/promises';
import { ok, titulo, cerrar } from './ayudas/decir.mjs';
import { baseNueva } from './ayudas/base.mjs';

const Gps = await import('../web/js/gps.js');
const app = await readFile(new URL('../web/js/app.js', import.meta.url), 'utf8');
const store = await readFile(new URL('../web/js/store.js', import.meta.url), 'utf8');
const calibrar = await readFile(new URL('../web/js/calibrar.js', import.meta.url), 'utf8');
const config = await readFile(new URL('../web/js/config.js', import.meta.url), 'utf8');
const sw = await readFile(new URL('../web/sw.js', import.meta.url), 'utf8');
const esquema = await readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8');
const migracion = await readFile(new URL('../sql/migracion.sql', import.meta.url), 'utf8');

// Un patio inventado, construido AL REVÉS de como lo hace gps.js: aquí se
// parte del plano y se llega a la coordenada con trigonometría a pelo.
// Si las dos cuentas coinciden, no es porque se copien entre sí.
//
// El plano está girado 30° respecto al norte y cada unidad mide medio
// metro. El origen del plano cae en un punto de Antioquia.
const ORIGEN = { lat: 6.95, lon: -75.05 };
const GIRO = 30 * Math.PI / 180;
const M_POR_UNIDAD = 0.5;
const R = 6378137;
function aCoordenada(x, y) {
  // en el plano la y crece hacia ABAJO: hacia el sur, si no hay giro
  const e0 = x * M_POR_UNIDAD, n0 = -y * M_POR_UNIDAD;
  const e = e0 * Math.cos(GIRO) - n0 * Math.sin(GIRO);
  const n = e0 * Math.sin(GIRO) + n0 * Math.cos(GIRO);
  return {
    lat: ORIGEN.lat + (n / R) * 180 / Math.PI,
    lon: ORIGEN.lon + (e / (R * Math.cos(ORIGEN.lat * Math.PI / 180))) * 180 / Math.PI
  };
}
const punto = (x, y) => ({ x, y, ...aCoordenada(x, y) });

// ---------------------------------------------------------------------
titulo('Dos puntos bastan para poner cualquier otro en su sitio.');

const geo = { a: punto(100, 100), b: punto(900, 600) };
const t = Gps.transformacion(geo);
ok(!!t, 'la calibración se acepta');
ok(Math.abs(t.escala - 1 / M_POR_UNIDAD) < 0.01,
   `la escala sale de la calibración: 2 unidades por metro (dio ${t?.escala.toFixed(3)})`);

let peor = 0;
for (const [x, y] of [[0, 0], [1000, 0], [0, 700], [1000, 700], [500, 350], [730, 120]]) {
  const c = aCoordenada(x, y);
  const p = t.aPlano(c.lat, c.lon);
  peor = Math.max(peor, Math.hypot(p.x - x, p.y - y));
}
ok(peor < 0.5, `las cuatro esquinas, el centro y un punto cualquiera caen a menos de un cuarto de metro (peor: ${peor.toFixed(3)} unidades)`);

// El error que de verdad se cometería: olvidar que en el plano la y crece
// hacia abajo. Todo cuadra en los dos puntos marcados y el resto del
// patio sale reflejado. Por eso se prueba con un punto FUERA de la línea
// que une los dos de la calibración.
const fuera = aCoordenada(900, 100);
const pf = t.aPlano(fuera.lat, fuera.lon);
ok(Math.hypot(pf.x - 900, pf.y - 100) < 0.5,
   'un punto fuera de la línea de calibración no sale reflejado como en un espejo');

// Sin giro y con la y hacia abajo, caminar hacia el norte es subir.
const recto = {
  a: { x: 0, y: 0, ...ORIGEN },
  b: { x: 100, y: 0, lat: ORIGEN.lat, lon: ORIGEN.lon + 0.0005 }
};
const tr = Gps.transformacion(recto);
const alNorte = tr.aPlano(ORIGEN.lat + 0.0002, ORIGEN.lon);
ok(alNorte.y < 0 && Math.abs(alNorte.x) < 0.01, 'en un plano con el norte arriba, ir al norte es subir en el plano');

// ---------------------------------------------------------------------
titulo('Una calibración mala se rechaza en vez de dibujar a la gente en otro sitio.');

ok(Gps.problemaCalibracion(null), 'sin puntos no hay calibración');
ok(Gps.problemaCalibracion({ a: punto(0, 0) }), 'con un solo punto tampoco');
ok(/20 m/.test(Gps.problemaCalibracion({ a: punto(0, 0), b: punto(10, 10) }) || ''),
   'dos puntos a 7 m no sirven, y el motivo dice cuánto hace falta');
ok(Gps.problemaCalibracion({ a: punto(0, 0), b: { ...punto(300, 0), x: 0, y: 0 } }),
   'dos coordenadas distintas marcadas en el mismo sitio del plano tampoco');
ok(Gps.problemaCalibracion({ a: punto(0, 0), b: { ...punto(300, 0), lat: 123 } }),
   'ni una latitud imposible');
ok(Gps.transformacion({ a: punto(0, 0), b: punto(10, 10) }) === null,
   'y con una calibración mala no hay transformación que usar');

// ---------------------------------------------------------------------
titulo('Con más puntos se corrige un plano estirado y se delata al mal marcado.');

// El mismo patio, pero dibujado un 15 % más ancho de lo que es: el admin
// le puso 1000 de ancho a un patio que pedía 870. Pasa en la vida real.
const ESTIRA = 1.15;
function aCoordEstirado(x, y) { return aCoordenada(x / ESTIRA, y); }
const estirado = (x, y, desvioM = 0) => {
  const c = aCoordEstirado(x, y);
  return { x, y, lat: c.lat, lon: c.lon + (desvioM / (R * Math.cos(ORIGEN.lat * Math.PI / 180))) * 180 / Math.PI };
};
const peorEn = (t, pts) => Math.max(...pts.map(([x, y]) => {
  const c = aCoordEstirado(x, y); const q = t.aPlano(c.lat, c.lon); return Math.hypot(q.x - x, q.y - y);
}));
const muestra = [[0, 0], [1000, 0], [0, 700], [1000, 700], [500, 350], [820, 90]];

const tres = Gps.transformacion({ puntos: [estirado(100, 100), estirado(900, 120), estirado(500, 600)] });
ok(tres?.tipo === 'semejanza', 'con tres puntos el plano no se deforma');
ok(Math.min(...tres.errores) > 2, `y el estiramiento se ve como error en cada punto, no se esconde (${tres.errores.map((e) => e.toFixed(1)).join(', ')} m)`);

const esquinas = [estirado(100, 100), estirado(900, 100), estirado(900, 600), estirado(100, 600)];
const cuatro = Gps.transformacion({ puntos: esquinas });
ok(cuatro?.tipo === 'afin', 'con cuatro en las esquinas se deja estirar');
ok(peorEn(cuatro, muestra) < 0.5, `y todo el patio cae en su sitio, esquinas incluidas (peor: ${peorEn(cuatro, muestra).toFixed(2)} unidades)`);
ok(Math.max(...cuatro.errores) < 0.1, 'con los cuatro bien marcados, ninguno se aparta');

const ida = cuatro.aGeo(733, 211), vuelta = cuatro.aPlano(ida.lat, ida.lon);
ok(Math.hypot(vuelta.x - 733, vuelta.y - 211) < 1e-6, 'del plano al mundo y de vuelta se llega al mismo sitio');

// Un punto marcado 18 m al lado de donde era. Con cinco puntos repartidos,
// quitarlo deja a los otros cuatro de acuerdo, y eso lo delata.
const conMalo = [...esquinas, estirado(620, 270, 18)];
const r = Gps.revisarPuntos(conMalo);
ok(r.malos.size === 1 && r.malos.has(4), 'el punto mal marcado sale señalado, y solo él');
ok(/el punto 5 parece mal marcado/.test(r.resumen), 'y el resumen dice cuál');
ok(r.t.errores[4] > 15, `su error es el que de verdad tiene, no uno repartido entre todos (${r.t.errores[4].toFixed(1)} m)`);
const bien = Gps.revisarPuntos([...esquinas, estirado(620, 270)]);
ok(bien.malos.size === 0 && Math.max(...bien.t.errores) < 0.1, 'bien marcado, no se señala a nadie');

// Si dos explicaciones cuadran igual, no se acusa a nadie: lo que sigue
// a una acusación es borrar el punto, y borrar uno bueno es peor.
const ambiguo = Gps.revisarPuntos([estirado(440, 280), estirado(540, 280), estirado(540, 390),
                                   estirado(490, 335), estirado(440, 390, 18)]);
ok(ambiguo.malos.size === 0 && /no concuerdan/.test(ambiguo.resumen),
   'con un punto del medio en la diagonal la culpa no se puede asignar, y se dice que no concuerdan');

const disparatado = Gps.revisarPuntos([...esquinas, estirado(620, 270, 400)]);
ok(!disparatado.listo && /demasiado para guardar/.test(disparatado.resumen),
   'con los puntos apartándose decenas de metros no se deja guardar');
ok(r.listo && bien.listo, 'con uno solo un poco corrido, sí: se ve en rojo y se decide');

// Puntos cruzados: el plano saldría reflejado. Con cuatro, la afín podría
// hacerlo; se rechaza en vez de dibujar a la gente en el espejo.
const cruzados = esquinas.map((p, i) => ({ ...p, ...(i < 2 ? { lat: esquinas[1 - i].lat, lon: esquinas[1 - i].lon } : {}) }));
const cruzados2 = cruzados.map((p, i) => (i >= 2 ? { ...p, lat: esquinas[5 - i].lat, lon: esquinas[5 - i].lon } : p));
ok(/espejo/.test(Gps.problemaCalibracion({ puntos: cruzados2 }) || ''),
   'si los puntos quedan cruzados, se avisa que el plano saldría al revés');
ok(Gps.transformacion({ puntos: cruzados2 }) === null, 'y no hay transformación que usar');

// Lo que ya estaba guardado con la primera versión, `a` y `b`, sigue valiendo.
ok(Gps.transformacion({ a: punto(100, 100), b: punto(900, 600) })?.tipo === 'semejanza',
   'una calibración vieja de dos puntos sigue funcionando');

// ---------------------------------------------------------------------
titulo('Calibrar promedia, y no se fía de una lectura mala.');

const p = Gps.promediar([
  { lat: 6.0, lon: -75.0, precision: 4 },
  { lat: 6.0001, lon: -75.0001, precision: 4 },
  { lat: 7.0, lon: -76.0, precision: 900 }      // las antenas, no el GPS
]);
ok(p && p.n === 2, 'la lectura de 900 m de error no entra en el promedio');
ok(p && Math.abs(p.lat - 6.00005) < 1e-9, 'dos lecturas iguales de buenas pesan lo mismo');
ok(p && p.precision < 4, 'y el promedio queda más preciso que cada lectura');
const sesgo = Gps.promediar([{ lat: 6, lon: -75, precision: 2 }, { lat: 6.001, lon: -75, precision: 20 }]);
ok(sesgo && sesgo.lat - 6 < 0.0001, 'una lectura de ±2 m pesa mucho más que una de ±20 m');
ok(Gps.promediar([{ lat: 6, lon: -75, precision: 80 }]) === null, 'si todas son malas no hay punto');

ok(JSON.stringify(Gps.leerCoordenadas('6.2442, -75.5812')) === '{"lat":6.2442,"lon":-75.5812}',
   'se lee la coordenada tal como la copia Google Maps');
ok(!!Gps.leerCoordenadas('6.2442;-75.5812') && !!Gps.leerCoordenadas(' 6.2442 -75.5812 '),
   'también con punto y coma o con espacios');
ok(JSON.stringify(Gps.leerCoordenadas('https://www.google.com/maps/@6.2442,-75.5812,17z'))
   === '{"lat":6.2442,"lon":-75.5812}', 'y el enlace de Google Maps entero, copiado de la barra del navegador');
ok(JSON.stringify(Gps.leerCoordenadas('https://maps.google.com/?q=6.2442,-75.5812'))
   === '{"lat":6.2442,"lon":-75.5812}', 'también el de búsqueda');
ok(Gps.leerCoordenadas('6,2442') === null && Gps.leerCoordenadas('95, 10') === null
   && Gps.leerCoordenadas('') === null, 'y se rechaza lo que no es una coordenada');

// ---------------------------------------------------------------------
titulo('Se sabe en qué plataforma está cada uno.');

const lejos = (x, y) => ({ x, y, ...aCoordenada(x + 5000, y) });   // 2,5 km al este
const plats = [
  { id: 'top', nombre: 'Topsoil', ancho: 1000, alto: 700, geo },
  { id: 'ye', nombre: 'Ye', ancho: 1000, alto: 700, geo: { a: lejos(100, 100), b: lejos(900, 600) } },
  { id: 'p3', nombre: 'Sin calibrar', ancho: 1000, alto: 700, geo: null }
];
const enYe = aCoordenada(5500, 300);
ok(Gps.dondeCae(plats, enYe.lat, enYe.lon)?.plat.id === 'ye', 'un punto de Ye cae en Ye, no en Topsoil');
const enTop = aCoordenada(500, 300);
ok(Gps.dondeCae(plats, enTop.lat, enTop.lon)?.plat.id === 'top', 'y uno de Topsoil, en Topsoil');
const borde = aCoordenada(1010, 300);                 // cinco metros fuera del dibujo
ok(Gps.dondeCae(plats, borde.lat, borde.lon)?.plat.id === 'top',
   'quien va por la vía, justo al borde del dibujo, sigue contando como del patio');
const casa = aCoordenada(-20000, 300);                // a diez kilómetros
ok(Gps.dondeCae(plats, casa.lat, casa.lon) === null, 'y quien está en la casa no está en ninguna');

// ---------------------------------------------------------------------
titulo('La capa del GPS no rompe el plano ni se rearma con él.');

globalThis.addEventListener = () => {};
globalThis.requestAnimationFrame = (fn) => { fn(performance.now() + 1e4); return 1; };
globalThis.cancelAnimationFrame = () => {};
globalThis.matchMedia = () => ({ matches: false });

// la capa es el único nodo que se busca por id; lo demás, de mentira
const capa = { innerHTML: '' };
const lienzo = {
  attrs: {}, isConnected: true, oyentes: {},
  _html: '',
  // como el navegador: al reescribir el SVG, la capa vuelve a nacer con
  // lo que traiga el texto nuevo
  set innerHTML(v) { this._html = v; const m = v.match(/<g id="capa-gps"[^>]*>([\s\S]*)<\/g>$/); capa.innerHTML = m ? m[1] : ''; },
  get innerHTML() { return this._html; },
  classList: { add() {}, remove() {}, contains: () => false },
  getAttribute(k) { return this.attrs[k]; },
  setAttribute(k, v) { this.attrs[k] = v; },
  addEventListener(tipo, fn) { (this.oyentes[tipo] ||= []).push(fn); },
  querySelector: (sel) => (sel === '#capa-gps' ? capa : null),
  querySelectorAll: () => [],
  setPointerCapture() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 700 })
};
const Mapa = await import('../web/js/mapa.js');
let tocado = null;
Mapa.montar({ set innerHTML(_) {}, querySelector: () => lienzo }, { alTocar: (tipo, id) => { tocado = { tipo, id }; } });
const datos = {
  config: { ancho: 1000, alto: 700, color_fondo: '#e4e7e2' }, figuras: [], pilas: [],
  lotes: [{ id: 'l1', codigo: 'PG1', estado: 'por_muestrear', pila_id: null,
            forma: 'elipse', x: 200, y: 200, rx: 46, ry: 34, rot: 0 }]
};
Mapa.pintar(datos);
Mapa.fijarVista({ x: 0, y: 0, w: 1000, h: 700 });
ok(/<g id="capa-gps"/.test(lienzo.innerHTML), 'el plano trae su capa de GPS, al final, encima de todo');

const veneno = 'Ana<img src=x onerror=alert(1)>';
Mapa.pintarGps({ yo: { x: 500, y: 300, radio: 12 }, otros: [{ x: 600, y: 300, nombre: veneno }] });
ok(capa.innerHTML.includes('gps-yo') && capa.innerHTML.includes('gps-otro'),
   'el punto propio y el del compañero se dibujan');
ok(!capa.innerHTML.includes('<img'), 'un nombre con etiquetas entra escapado, no como marcado');
ok(capa.innerHTML.includes('Ana&lt;img'), 'y se sigue leyendo el nombre');

const antes = lienzo.innerHTML;
Mapa.pintarGps({ yo: { x: 510, y: 300, radio: 12 }, otros: [] });
ok(lienzo.innerHTML === antes, 'moverse no rearma el plano: solo cambia la capa');
ok(capa.innerHTML.includes('cx="510"'), 'y la capa sí se movió');
Mapa.pintar({ ...datos });
ok(capa.innerHTML.includes('cx="510"'), 'un repintado del plano conserva el punto donde iba');

// tocar con la calibración puesta marca el punto, no abre la ficha
const dedo = (x, y, figura) => ({ pointerId: 1, clientX: x, clientY: y,
  target: { closest: (sel) => (sel === '[data-id]' && figura ? { dataset: figura } : null) } });
const disparar = (tipo, ev) => lienzo.oyentes[tipo]?.forEach((fn) => fn(ev));
let marcado = null;
Mapa.alMarcar((pt) => { marcado = pt; });
disparar('pointerdown', dedo(200, 200, { tipo: 'lote', id: 'l1' }));
disparar('pointerup', dedo(200, 200, { tipo: 'lote', id: 'l1' }));
ok(marcado && Math.round(marcado.x) === 200 && Math.round(marcado.y) === 200,
   'calibrando, un toque sobre un lote marca ese sitio del plano');
ok(tocado === null, 'y no abre la ficha del lote');
Mapa.alMarcar(null);
disparar('pointerdown', dedo(200, 200, { tipo: 'lote', id: 'l1' }));
disparar('pointerup', dedo(200, 200, { tipo: 'lote', id: 'l1' }));
ok(tocado?.id === 'l1', 'terminada la calibración, el toque vuelve a abrir la ficha');

// ---------------------------------------------------------------------
titulo('Compartir la ubicación: solo en el patio, solo ahora, y se apaga.');

const compartir = app.slice(app.indexOf('async function compartirSiToca'),
                            app.indexOf('async function leerOtros'));
ok(/Gps\.dondeCae\(/.test(compartir), 'solo se sube la posición si cae dentro de una plataforma');
ok(/soltarUbicacion\(\)/.test(compartir), 'y al salir del patio se retira la que había');
const subeUbicacion = store.slice(store.indexOf('export async function compartirUbicacion'),
                                  store.indexOf('export async function salir'));
ok(subeUbicacion.length > 0 && !/encolar\(/.test(subeUbicacion),
   'la ubicación no pasa por la cola: subirla tarde pintaría a alguien donde ya no está');
ok(/v_ubicaciones/.test(subeUbicacion), 'los demás se leen de la vista, que descarta lo viejo en el servidor');
ok(/if \(document\.hidden\) pararGps\(\)/.test(app), 'con la app en el bolsillo el GPS se apaga');
ok(/await soltarUbicacion\(\);\s*await Store\.salir\(\)/.test(app),
   'al cerrar sesión se deja de compartir ANTES de perder el permiso para borrarla');
ok(/'\.\/js\/gps\.js'/.test(sw), 'gps.js se guarda para abrir sin señal');

// ---------------------------------------------------------------------
titulo('Calibrar desde la oficina: ventana aparte y solo del admin.');

ok(/if \(rol !== 'admin'\) return pararCon\(/.test(calibrar),
   'la ventana de calibrar no deja seguir a quien no es admin');
ok(calibrar.indexOf("rol !== 'admin'") < calibrar.indexOf('montarSatelite();'),
   'y lo mira antes de cargar el satélite');
const oficina = app.slice(app.indexOf('function abrirCalibracionOficina'), app.indexOf('function empezarCalibracion'));
ok(/if \(!esAdmin\(\) \|\| !plat\) return;/.test(oficina) && /window\.open\(`calibrar\.html/.test(oficina),
   'la app la abre en una ventana aparte, y solo para el admin');
ok(/function empezarCalibracion\(\) \{\s*if \(!esAdmin\(\)\) return;/.test(app),
   'calibrar caminando el patio también es solo del admin');
ok(/integrity = 'sha256-20nQCchB9co0qIjJZRGuk2\/Z9VM\+kNiyxNV1lvTlZBo='/.test(calibrar),
   'Leaflet se carga con su huella: si el CDN sirviera otra cosa, no se ejecuta');
ok(/new ResizeObserver\(\(\) => mapa\.invalidateSize/.test(calibrar),
   'el satélite se entera cuando cambia de tamaño: si no, cada toque marcaba unos metros corrido');
ok(/BroadcastChannel\('acopio'\)\.postMessage/.test(calibrar) && /BroadcastChannel\('acopio'\)\.onmessage/.test(app),
   'al guardar, la ventana del mapa se entera en el acto');
ok(/'\.\/calibrar\.html'/.test(sw) && /'\.\/js\/calibrar\.js'/.test(sw), 'la ventana nueva se guarda con el resto de la app');
ok(/destination === 'image' && url\.origin !== self\.location\.origin\) return;/.test(sw),
   'los cuadros del satélite no llenan la caché del celular');
ok(/export const ESRI_CLAVE = '';/.test(config) && /ibasemaps-api\.arcgis\.com/.test(calibrar),
   'hay dónde poner la clave de Esri para el uso de la empresa');
ok(/geo\s+jsonb/.test(esquema) && /add column if not exists geo jsonb/.test(migracion),
   'la calibración tiene su columna en el esquema y en la migración');

// ---------------------------------------------------------------------
//  Con PostgreSQL de verdad: quién puede escribir qué.
// ---------------------------------------------------------------------
const base = baseNueva();
if (!base) {
  console.log('\n  (no hay PostgreSQL a mano: los permisos de abajo no se probaron)');
  cerrar();
}
process.on('exit', () => base.tirar());

titulo('Cada uno escribe solo su ubicación, y lo viejo no sale.');

const ANA = '11111111-1111-4111-8111-111111111111';
const BETO = '22222222-2222-4222-8222-222222222222';
const DORA = '44444444-4444-4444-8444-444444444444';     // sin habilitar
base.sql(`insert into auth.users (id, email) values
  ('${ANA}','ana@x.com'), ('${BETO}','beto@x.com'), ('${DORA}','dora@x.com');
  update perfiles set nombre='Ana', activo=true where id='${ANA}';
  update perfiles set nombre='Beto', activo=true where id='${BETO}';
  -- en Supabase el rol de la app puede leer las tablas y usar auth.uid();
  -- aquí hay que dárselo a mano. Quien filtra es la RLS.
  grant usage on schema auth to authenticated;
  grant select on perfiles to authenticated;`);

// Como la app: con el rol de la app y la identidad del token. Así la RLS
// se aplica de verdad, que como superusuario no pasaría.
const como = (id, q) => `select set_config('request.jwt.claim.sub','${id}',false);
  set role authenticated;
  ${q}`;
const filas = (id, q) => base.sql(como(id, q)).split('\n').pop();

ok(!base.rechaza(como(ANA, `insert into ubicaciones (usuario_id, lat, lon, precision_m)
   values ('${ANA}', 6.95, -75.05, 4)`)), 'Ana sube su ubicación');
ok(base.rechaza(como(ANA, `insert into ubicaciones (usuario_id, lat, lon)
   values ('${BETO}', 6.95, -75.05)`)), 'pero no puede poner a Beto en ningún sitio');
ok(base.rechaza(como(DORA, `insert into ubicaciones (usuario_id, lat, lon)
   values ('${DORA}', 6.95, -75.05)`)), 'un perfil sin habilitar no comparte nada');
// upsert, como la app: si un fallo de arriba ya hubiera escrito la fila
// de Beto, la prueba sigue y cuenta los fallos en vez de reventar aquí
base.sql(como(BETO, `insert into ubicaciones (usuario_id, lat, lon) values ('${BETO}', 6.951, -75.051)
   on conflict (usuario_id) do update set lat = excluded.lat, lon = excluded.lon`));
base.sql(como(ANA, `update ubicaciones set lat = 0, lon = 0 where usuario_id = '${BETO}'`));
ok(base.sql(`select lat from ubicaciones where usuario_id = '${BETO}'`) === '6.951',
   'Ana tampoco puede mover a Beto');
base.sql(como(ANA, `delete from ubicaciones where usuario_id = '${BETO}'`));
ok(base.sql(`select count(*) from ubicaciones where usuario_id = '${BETO}'`) === '1',
   'ni esconderlo');
ok(filas(BETO, `select count(*) from v_ubicaciones`) === '2', 'Beto ve a los dos');
ok(filas(DORA, `select count(*) from v_ubicaciones`) === '0', 'y quien no está habilitado no ve a nadie');

// La hora la pone el servidor. Un celular con el reloj atrasado no puede
// hacerse pasar por viejo, ni uno adelantado quedarse pegado para siempre.
base.sql(como(ANA, `update ubicaciones set lat = 6.9501, actualizado_en = '2001-01-01'
   where usuario_id = '${ANA}'`));
ok(base.sql(`select actualizado_en > now() - interval '1 minute' from ubicaciones where usuario_id = '${ANA}'`) === 't',
   'la hora de la ubicación la pone el servidor, no el celular');

// Quien cerró la app hace un rato deja de verse solo.
base.sql(`alter table ubicaciones disable trigger trg_marcar_actualizado;
  update ubicaciones set actualizado_en = now() - interval '11 minutes' where usuario_id = '${BETO}';
  alter table ubicaciones enable trigger trg_marcar_actualizado;`);
ok(filas(ANA, `select string_agg(nombre, ',') from v_ubicaciones`) === 'Ana',
   'la ubicación de hace once minutos ya no sale en la vista');
ok(Number(filas(ANA, `select segundos from v_ubicaciones`)) < 60,
   'y la vista dice cuántos segundos tiene cada una, contados en el servidor');

cerrar();
