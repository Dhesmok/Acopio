// =====================================================================
//  Rehacer el patio de un día cualquiera a partir de los eventos.
//  Si esto se equivoca, alguien mira el pasado y ve algo que no pasó.
// =====================================================================
import { ok, titulo, cerrar } from './ayudas/decir.mjs';
import { planoEn, desde } from '../web/js/historia.js';

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
ok(v(6)[0].estado === 'por_muestrear', 'y arranca por muestrear, que es como nace todo lote');

// Sin eventos no hay historia que rehacer, pero tampoco se cae
const pelado = planoEn(T(15), { lotes: [viejo], pilas: [], eventos: [] });
ok(pelado.lotes.length === 1 && pelado.lotes[0].x === 10,
   'sin ningún evento, el lote se dibuja donde está hoy');
ok(planoEn(T(15), {}).lotes.length === 0, 'y sin nada de nada, no revienta');

ok(desde(eventos) === T(10), 'desde() dice hasta dónde se puede retroceder');
ok(desde([]) === null, 'y sin eventos, que no se puede');

cerrar();
