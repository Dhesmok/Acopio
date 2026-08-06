// =====================================================================
//  Rehacer el patio de un día cualquiera a partir de los eventos.
//  Si esto se equivoca, alguien mira el pasado y ve algo que no pasó.
// =====================================================================
import { readFile } from 'node:fs/promises';
import { ok, titulo, cerrar } from './ayudas/decir.mjs';
import { planoEn, desde, indexar } from '../web/js/historia.js';

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
const despues = en(15).lotes[0];
ok(despues.x === 400 && despues.y === 300, `después, en (${despues.x}, ${despues.y})`);
ok(lote.x === 900, 'y hoy está en otro sitio, que es el que no se toca');

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

// Aquí no hay navegador, así que esto se mira en el código. Y merece
// una prueba porque fue el fallo: cada tirón del deslizador volvía a
// escribir la barra entera, y con ella el propio <input> que el dedo
// tenía cogido. El navegador perdía el elemento a mitad del gesto y el
// arrastre se cortaba solo, así que mover el deslizador era pelearse
// con él. Ahora al moverlo solo cambian dos textos y el plano.
const fuente = await readFile(new URL('../web/js/app.js', import.meta.url), 'utf8');
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

cerrar();
