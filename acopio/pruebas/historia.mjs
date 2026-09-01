// =====================================================================
//  Rehacer el patio de un día cualquiera a partir de los eventos.
//  Si esto se equivoca, alguien mira el pasado y ve algo que no pasó.
// =====================================================================
import { readFile } from 'node:fs/promises';
import { ok, titulo, cerrar } from './ayudas/decir.mjs';
import { planoEn, desde, indexar } from '../web/js/historia.js';

// Aquí no hay navegador, así que unas cuantas cosas se comprueban
// LEYENDO el código de la app. Se lee una vez, al principio.
const fuente = await readFile(new URL('../web/js/app.js', import.meta.url), 'utf8');
const fuenteStore = await readFile(new URL('../web/js/store.js', import.meta.url), 'utf8');

const T = (d) => `2026-07-${String(d).padStart(2, '0')}T12:00:00.000Z`;

// Un lote que entra el 10, se muestrea el 12, se mete en una pila el 14
// y sale el 16; además se mueve el 13.
const lote = {
  id: 'l1', codigo: 'PG1', estado: 'facturado', pila_id: null,
  forma: 'elipse', x: 900, y: 900, rx: 40, ry: 40, rot: 0,
  fecha_recogida: null, creado_en: T(10), fecha_recepcion: '2026-07-10'
};
const pila = { id: 'p1', codigo: '1', tipo: 'otro', estado: 'consumida',
               forma: 'elipse', x: 500, y: 500, rx: 90, ry: 60, rot: 0, creado_en: T(14) };
const eventos = [
  { lote_id: 'l1', tipo: 'recepcion', ocurrido_en: T(10) },
  { lote_id: 'l1', tipo: 'cambio_estado', estado_nuevo: 'muestreado', ocurrido_en: T(12) },
  // un traslado se apunta como dos: de dónde salió y a dónde llegó
  { lote_id: 'l1', tipo: 'movimiento', x: 100, y: 100, ocurrido_en: T(13) },
  { lote_id: 'l1', tipo: 'movimiento', x: 400, y: 300, ocurrido_en: `${T(13)}1` },
  { lote_id: 'l1', tipo: 'ingreso_pila', pila_id: 'p1', ocurrido_en: T(14) },
  { lote_id: 'l1', tipo: 'salida_pila', ocurrido_en: T(16) },
  { lote_id: 'l1', tipo: 'cambio_estado', estado_nuevo: 'facturado', ocurrido_en: T(18) }
];
// Otro lote del patio, de los que llevan meses ahí sin que les pase
// nada: no tiene ni un evento guardado.
const viejoQuieto = {
  id: 'l9', codigo: 'PG9', estado: 'facturado', pila_id: null,
  forma: 'elipse', x: 250, y: 640, rx: 40, ry: 40, rot: 0,
  fecha_recogida: null, creado_en: T(3), fecha_recepcion: '2026-07-03'
};
const en = (d) => planoEn(T(d), { lotes: [lote], pilas: [pila], eventos });

// ---------------------------------------------------------------------
titulo('El patio se rehace tal como estaba, no como está hoy.');

ok(en(9).lotes.length === 0, 'el día antes de llegar, el lote no está en el plano');
ok(en(11).lotes.length === 1, 'el día después sí');

ok(en(11).lotes[0].estado === 'por_muestrear', 'el día 11 estaba por muestrear');
ok(en(13).lotes[0].estado === 'muestreado', 'el 13 ya estaba muestreado');
ok(en(19).lotes[0].estado === 'facturado', 'y el 19, facturado');
ok(lote.estado === 'facturado', 'el lote de verdad no se toca: sigue facturado');

ok(en(13).lotes[0].pila_id === null, 'el 13 todavía no estaba en ninguna pila');
ok(en(15).lotes[0].pila_id === 'p1', 'el 15 estaba dentro de la pila');
ok(en(17).lotes[0].pila_id === null, 'y el 17 ya había salido');

// ---------------------------------------------------------------------
titulo('La posición es la de entonces, no la de ahora.');

// Antes de moverse estaba donde dice el PRIMER evento de movimiento: ese
// evento guarda de dónde salió, no a dónde llegó.
const antes = en(11).lotes[0];
ok(antes.x === 100 && antes.y === 100, `antes del traslado estaba en (${antes.x}, ${antes.y})`);
ok(lote.x === 900, 'y el lote de verdad no se toca: sigue donde está hoy');

// ---------------------------------------------------------------------
titulo('Sin traslados posteriores, el lote se dibuja DONDE ESTÁ.');

// Esto se vio en el patio: al entrar a mirar otro día, medio plano se
// descuadraba y salían lotes montados unos encima de otros.
//
// La razón es que un acomodo pequeño NO se apunta —solo cuenta como
// traslado si la figura deja de traslaparse con donde estaba, ver
// `movimientoReal`—, así que la última posición apuntada se va quedando
// atrás de la de verdad. Clavar el lote en esa posición vieja movía el
// patio entero, incluso mirando "ahora mismo".
//
// El criterio es el mismo que para el estado: si nadie lo movió después
// del momento pedido, donde está hoy es donde estaba.
const despues = en(15).lotes[0];
ok(despues.x === 900 && despues.y === 900,
   `el 15 ya no hay traslados por delante, así que va donde está hoy (${despues.x}, ${despues.y})`);

// Y mirar "ahora mismo" tiene que dar el plano de verdad, clavado: es lo
// primero que se ve al pulsar el botón, y cualquier diferencia ahí hace
// pensar que la app se inventa cosas.
const ahora = planoEn(T(28), { lotes: [lote, viejoQuieto], pilas: [pila], eventos }).lotes;
ok(ahora.length === 2, 'están los dos lotes');
for (const l of ahora) {
  const real = [lote, viejoQuieto].find((o) => o.id === l.id);
  ok(l.x === real.x && l.y === real.y, `${l.codigo} sale en su sitio de verdad (${l.x}, ${l.y})`);
  ok(l.estado === real.estado, `${l.codigo} sale con su estado de verdad (${l.estado})`);
  ok(l.pila_id === real.pila_id, `${l.codigo} sale con su pila de verdad`);
}

// ---------------------------------------------------------------------
titulo('Una pila se ve solo mientras tuvo algo dentro.');

ok(en(13).pilas.length === 0, 'antes de que entrara el lote, la pila no se dibuja');
ok(en(15).pilas.length === 1, 'mientras lo tuvo, sí');
ok(en(15).pilas[0].estado === 'abierta', 'y se dibuja abierta, aunque hoy esté archivada');
ok(en(17).pilas.length === 0, 'cuando se queda vacía, deja de verse');

// ---------------------------------------------------------------------
titulo('La fecha de recogida también se rehace.');

const conRecogida = [
  ...eventos.filter((e) => e.ocurrido_en <= T(12)),
  { lote_id: 'l1', tipo: 'cambio_estado', estado_nuevo: 'devolucion',
    fecha_recogida: '2026-07-20', ocurrido_en: T(14) },
  { lote_id: 'l1', tipo: 'cambio_estado', estado_nuevo: 'muestreado', ocurrido_en: T(16) }
];
const conR = (d) => planoEn(T(d), { lotes: [lote], pilas: [], eventos: conRecogida }).lotes[0];
ok(conR(15).fecha_recogida === '2026-07-20', 'mientras fue devolución llevaba su fecha');
ok(conR(17).fecha_recogida === null, 'y al dejar de serlo, la fecha se va, como en el presente');

// ---------------------------------------------------------------------
titulo('Lo que no se puede saber no se inventa.');

// Un lote cuya historia es más vieja que lo guardado: sin evento de
// recepción, manda la fecha en que se creó la fila.
const viejo = { id: 'l2', codigo: 'PG2', estado: 'muestreado', pila_id: null,
                forma: 'elipse', x: 10, y: 10, rx: 40, ry: 40, rot: 0, creado_en: T(5) };
const soloUno = [{ lote_id: 'l2', tipo: 'cambio_estado', estado_nuevo: 'muestreado', ocurrido_en: T(15) }];
const v = (d) => planoEn(T(d), { lotes: [viejo], pilas: [], eventos: soloUno }).lotes;
ok(v(4).length === 0, 'antes de crearse no aparece');
ok(v(6).length === 1, 'después sí, aunque no tengamos su evento de recepción');
ok(v(6)[0].estado === 'por_muestrear',
   'antes de su único cambio de estado se vuelve al de nacimiento: hoy es muestreado, y eso lo cambió ese evento');
ok(v(6)[0]._aprox === true, 'y queda marcado como aproximado, que es lo que es');
ok(v(6).length === planoEn(T(6), { lotes: [viejo], pilas: [], eventos: soloUno }).aproximados,
   'planoEn cuenta cuántos van aproximados, para poder decirlo en pantalla');
ok(v(16)[0]._aprox === undefined,
   'pasado ese evento ya manda él, y la reconstrucción vuelve a ser exacta');

// ---------------------------------------------------------------------
titulo('Un lote del que no queda ningún evento sale como está, no recién llegado.');

// ESTE era el fallo gordo. La sincronización solo guarda una ventana de
// los eventos más recientes, así que de la mayoría de los lotes no queda
// ni uno. Dar por hecho que acababan de llegar pintaba medio patio de
// ámbar y vaciaba las pilas: mirar "ayer" no se parecía en nada a ayer.
//
// Si de un lote no hay NINGÚN evento posterior al momento que se pide,
// nada le ha pasado desde entonces y lo de hoy es exactamente lo de
// entonces. Eso no es una suposición, es lo que dicen los eventos.
const sinRastro = { id: 'l3', codigo: 'PG3', estado: 'facturado', pila_id: 'p1',
                    forma: 'elipse', x: 700, y: 200, rx: 40, ry: 40, rot: 0,
                    fecha_recogida: null, creado_en: T(2) };
const quieto = planoEn(T(15), { lotes: [sinRastro], pilas: [pila], eventos: [] }).lotes[0];
ok(quieto.estado === 'facturado', 'sigue facturado, no "por muestrear"');
ok(quieto.pila_id === 'p1', 'y sigue dentro de su pila, que es donde estaba');
ok(quieto._aprox === undefined, 'y no va marcado: esto se sabe con certeza');

// Pero en cuanto SÍ hay un evento posterior, lo de hoy deja de valer
const conCambio = [{ lote_id: 'l3', tipo: 'cambio_estado', estado_nuevo: 'facturado',
                     ocurrido_en: T(20) }];
const antesDelCambio = planoEn(T(15), { lotes: [sinRastro], pilas: [pila], eventos: conCambio }).lotes[0];
ok(antesDelCambio.estado !== 'facturado', 'el 15 todavía no era facturado: eso pasó el 20');
ok(antesDelCambio.pila_id === 'p1', 'pero de la pila no se sabe nada nuevo, así que se queda');
ok(antesDelCambio._aprox === true, 'y el lote va marcado, porque el estado es un supuesto');

// ---------------------------------------------------------------------
titulo('Los que hoy están en una pila no salen montados unos sobre otros.');

// ESTO es lo que se veía en el patio. Meter un lote a una pila se hace
// arrastrándolo encima, y eso PISA su posición con la del punto donde se
// soltó el dedo. Como el lote pasa a dibujarse dentro de la pila, esa
// posición ya no se ve nunca... hasta que se mira un día en que todavía
// andaba suelto: entonces salen todos los de la pila en el mismo punto,
// unos encima de otros, ilegibles.
//
// Dónde estaba de verdad no se sabe —no hay apunte de traslado—, pero sí
// se sabe que estaba por ahí: una pila se arma con lo que ya está junto.
// Así que se reparten alrededor de la pila y se marcan como aproximados.
const enPila = (id, x, y) => ({ id, codigo: id, estado: 'muestreado', pila_id: 'p9',
  forma: 'elipse', x, y, rx: 40, ry: 40, rot: 0, fecha_recogida: null, creado_en: T(2) });
// Los tres cayeron casi en el mismo punto, que es como quedan de verdad
const montados = [enPila('A', 505, 500), enPila('B', 495, 502), enPila('C', 500, 495)];
const pila9 = { id: 'p9', codigo: '9', estado: 'abierta', forma: 'elipse',
                x: 500, y: 500, rx: 90, ry: 60, rot: 0, creado_en: T(20) };
const entradas = montados.map((l) => ({ lote_id: l.id, tipo: 'ingreso_pila',
                                        pila_id: 'p9', ocurrido_en: T(20) }));
const sueltos = planoEn(T(15), { lotes: montados, pilas: [pila9], eventos: entradas }).lotes;

ok(sueltos.length === 3, 'el día 15 los tres andaban sueltos');
ok(sueltos.every((l) => l.pila_id === null), 'la pila todavía no existía');
const lejos = sueltos.every((a) => sueltos.every((b) =>
  a.id === b.id || Math.hypot(a.x - b.x, a.y - b.y) > a.rx + b.rx));
ok(lejos, 'y ninguno se traslapa con otro: se reparten alrededor de la pila');
ok(sueltos.every((l) => l._aprox === true),
   'van marcados como aproximados, porque el sitio exacto no se sabe');
// El deslizador repinta muchas veces el mismo instante: si el reparto no
// fuera fijo, los lotes bailarían por el plano en cada tirón del dedo.
const otraVez = planoEn(T(15), { lotes: montados, pilas: [pila9], eventos: entradas }).lotes;
ok(otraVez.every((l, i) => l.x === sueltos[i].x && l.y === sueltos[i].y),
   'y el reparto es el mismo cada vez: no bailan al mover el deslizador');
ok(montados.every((l) => l.x >= 495 && l.x <= 505),
   'los lotes de verdad no se tocan: siguen con su posición guardada');

// Con un apunte de traslado NO se inventa nada: manda el apunte.
const conApunte = [...entradas,
  { lote_id: 'A', tipo: 'movimiento', x: 120, y: 340, ocurrido_en: T(10) },
  { lote_id: 'A', tipo: 'movimiento', x: 505, y: 500, ocurrido_en: T(19) }];
const sabido = planoEn(T(15), { lotes: montados, pilas: [pila9], eventos: conApunte })
  .lotes.find((l) => l.id === 'A');
ok(sabido.x === 120 && sabido.y === 340,
   `el que sí tiene apunte va donde dice el apunte (${sabido.x}, ${sabido.y})`);

// Y mirando un día en que YA estaban dentro, no se reparte nada: el lote
// no se dibuja suelto y la pila ocupa su sitio.
const dentro = planoEn(T(25), { lotes: montados, pilas: [pila9], eventos: entradas }).lotes;
ok(dentro.every((l) => l.pila_id === 'p9'), 'el 25 ya estaban los tres dentro');
ok(dentro.every((l, i) => l.x === montados[i].x && l.y === montados[i].y),
   'y a esos no se les toca la posición: no se dibujan sueltos');

// Meter un lote a una pila tiene que APUNTAR el traslado, o el arreglo de
// arriba se queda siendo un parche para siempre.
const soltar = (fuente.match(/if \(blanco\.tipo === 'pila'\)[\s\S]*?^  \}/m) || [''])[0];
ok(/anotarRecorrido\(lote, antes\)/.test(soltar),
   'al meter un lote a una pila se apunta de dónde salió');
ok(soltar.indexOf('anotarRecorrido') < soltar.indexOf("tipo: 'ingreso_pila'"),
   'y se apunta ANTES del ingreso, que es el orden en que pasó');

// ---------------------------------------------------------------------
titulo('La pareja de un traslado no se lee al revés por empatar la hora.');

// Un traslado se apunta con DOS eventos seguidos, de dónde salió y a
// dónde llegó, y hasta ahora los dos llevaban la misma hora: `ahora()`
// mide en milisegundos y las dos escrituras caben en uno. Al releerlos,
// IndexedDB los devuelve en orden de CLAVE —un uuid al azar—, así que la
// pareja venía al revés la mitad de las veces y el lote salía en el sitio
// al que iba, no en el que dejaba.
const MISMO = T(13);
const viajero2 = { id: 'l7', codigo: 'PG7', estado: 'muestreado', pila_id: null,
  forma: 'elipse', x: 400, y: 300, rx: 40, ry: 40, rot: 0, creado_en: T(1) };
// `registrado_en` es la hora a la que el servidor los recibió, y la cola
// sube en orden, así que separa la pareja aunque `ocurrido_en` empate.
const salio = { id: 'zzz', lote_id: 'l7', tipo: 'movimiento', x: 100, y: 100,
                ocurrido_en: MISMO, registrado_en: `${MISMO}` };
const llego = { id: 'aaa', lote_id: 'l7', tipo: 'movimiento', x: 400, y: 300,
                ocurrido_en: MISMO, registrado_en: `${T(13)}1` };
const dondeElOnce = (evs) => {
  const p = planoEn(T(11), { lotes: [viajero2], pilas: [], eventos: evs }).lotes[0];
  return `${p.x},${p.y}`;
};
ok(dondeElOnce([salio, llego]) === '100,100', 'el 11 estaba donde dice el apunte de salida');
ok(dondeElOnce([llego, salio]) === '100,100',
   'y da igual en qué orden los devuelva IndexedDB: manda registrado_en');

// Y de aquí en adelante ni siquiera empatan: el apunte de SALIDA se
// fecha un milisegundo antes que el de llegada, que además es lo que
// pasó. El reloj general no se toca —uno que no pudiera retroceder se
// quedaría pegado si al celular le corrigen la hora hacia atrás—: se
// fecha a mano solo esta pareja, que es la única que lo necesita.
const anotar = (fuente.match(/async function anotarRecorrido[\s\S]*?\n\}/) || [''])[0];
ok(/ocurrido_en: new Date\(Date\.now\(\) - 1\)/.test(anotar),
   'el apunte de "de dónde salió" va fechado antes que el de llegada');
ok(anotar.indexOf('ocurrido_en') < anotar.indexOf('x: lote.x'),
   'y es el de salida el que se atrasa, no el de llegada');
ok(/ocurrido_en \|\| ahora\(\)/.test(fuenteStore),
   'registrarEvento acepta esa hora; los demás eventos siguen con la del reloj');

// ---------------------------------------------------------------------
titulo('El índice se hace una vez y sirve para todos los momentos.');

const idx = indexar(eventos);
const conIndice = planoEn(T(15), { lotes: [lote], pilas: [pila], indice: idx });
const conLista  = planoEn(T(15), { lotes: [lote], pilas: [pila], eventos });
ok(JSON.stringify(conIndice) === JSON.stringify(conLista),
   'pasar el índice ya hecho da exactamente lo mismo que pasar los eventos');
ok(idx.get('l1').length === eventos.length, 'el índice agrupa los eventos por lote');
ok(idx.get('l1')[0].ocurrido_en <= idx.get('l1')[1].ocurrido_en, 'y los deja en orden');

// Sin eventos no hay historia que rehacer, pero tampoco se cae
const pelado = planoEn(T(15), { lotes: [viejo], pilas: [], eventos: [] });
ok(pelado.lotes.length === 1 && pelado.lotes[0].x === 10,
   'sin ningún evento, el lote se dibuja donde está hoy');
ok(planoEn(T(15), {}).lotes.length === 0, 'y sin nada de nada, no revienta');

ok(desde(eventos) === T(10), 'desde() dice hasta dónde se puede retroceder');
ok(desde([]) === null, 'y sin eventos, que no se puede');

// ---------------------------------------------------------------------
titulo('El deslizador no se rehace mientras el dedo lo arrastra.');

// Esto se mira en el código, y merece una prueba porque fue el fallo:
// cada tirón del deslizador volvía a escribir la barra entera, y con
// ella el propio <input> que el dedo tenía cogido. El navegador perdía
// el elemento a mitad del gesto y el arrastre se cortaba solo, así que
// mover el deslizador era pelearse con él. Ahora al moverlo solo cambian
// dos textos y el plano.
const alMover = (fuente.match(/campo\.oninput = .*/) || [''])[0];
ok(alMover.includes('rotularHistoria') && alMover.includes('pedirPintado'),
   'al mover se rotula y se pide un pintado');
ok(!alMover.includes('barraHistoria'),
   'y NO se vuelve a armar la barra, que es lo que se llevaba por delante el <input>');

// En minutos, medio año son 260 000 pasos en tres centímetros de
// pantalla: cada píxel saltaba medio día y no había forma de parar en el
// martes que se buscaba.
const rango = (fuente.match(/<input type="range" id="h-cuando"[^>]*/) || [''])[0];
ok(/min="0"/.test(rango) && /max="\$\{h\.dias\}"/.test(rango),
   'el deslizador va de cero al número de DÍAS, no en minutos');

// ---------------------------------------------------------------------
titulo('Un lote que cambió de plataforma sale donde estaba ENTONCES.');

// Si no, mirar el Topsoil del martes escondería justo los lotes que ese
// martes SÍ estaban ahí, por el simple hecho de que hoy están en Ye.
const viajero = { id: 'l4', codigo: 'PG4', estado: 'facturado', pila_id: null,
                  plataforma_id: 'YE', forma: 'elipse', x: 50, y: 50,
                  rx: 40, ry: 40, rot: 0, creado_en: T(8) };
const viaje = [
  { lote_id: 'l4', tipo: 'recepcion', ocurrido_en: T(8) },
  { lote_id: 'l4', tipo: 'traslado', plataforma_id: 'TOPSOIL', ocurrido_en: T(10) },
  { lote_id: 'l4', tipo: 'traslado', plataforma_id: 'YE', ocurrido_en: T(20) }
];
const donde = (d) => planoEn(T(d), { lotes: [viajero], pilas: [], eventos: viaje })
  .lotes[0]?.plataforma_id;
ok(donde(12) === 'TOPSOIL', 'el 12 estaba en Topsoil, aunque hoy esté en Ye');
ok(donde(25) === 'YE', 'y el 25 ya se había ido a Ye');
ok(viajero.plataforma_id === 'YE', 'el lote de verdad no se toca');

// Sin ningún traslado apuntado, la de hoy es la de siempre.
const quieto2 = { ...viajero, id: 'l5', codigo: 'PG5' };
ok(planoEn(T(12), { lotes: [quieto2], pilas: [], eventos: [] }).lotes[0].plataforma_id === 'YE',
   'y un lote que nunca se movió sale en la suya de hoy');

// Si lo trasladaron DESPUÉS pero no antes, no se puede saber dónde
// estaba: se deja la de hoy y se marca, como todo lo que se supone.
const soloDespues = [{ lote_id: 'l6', tipo: 'traslado', plataforma_id: 'YE', ocurrido_en: T(20) }];
const dudoso = planoEn(T(12), { lotes: [{ ...viajero, id: 'l6', codigo: 'PG6' }],
                                pilas: [], eventos: soloDespues }).lotes[0];
ok(dudoso._aprox === true, 'y si solo hay traslados posteriores, el lote va marcado');

cerrar();
