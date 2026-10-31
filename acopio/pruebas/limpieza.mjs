// =====================================================================
//  Un lote alimentado se queda sin el historial que sobra
//  (sql/limpiar-alimentados.sql).
//
//  Lo que importa probar es lo que NO se borra: las monedas se calculan
//  desde los eventos, y una limpieza que se las quitara a la gente sería
//  peor que no limpiar. Corre contra PostgreSQL de verdad si lo hay.
// =====================================================================
import { ok, titulo, cerrar } from './ayudas/decir.mjs';
import { baseNueva } from './ayudas/base.mjs';

const base = baseNueva(`acopio_limpieza_${process.pid}`);
if (!base) {
  console.log('\n  (no hay PostgreSQL a mano: la limpieza de alimentados no se probó)');
  cerrar();
}
base.cargar('./ayudas/patio-falso.sql');
process.on('exit', () => base.tirar());
const { sql } = base;

const BETO = '22222222-2222-4222-8222-222222222222';
const CARLA = '33333333-3333-4333-8333-333333333333';
const PG1 = 'dddddddd-0000-4000-8000-000000000001';
const PG2 = 'dddddddd-0000-4000-8000-000000000002';
const PILA1 = 'cccccccc-0000-4000-8000-000000000001';
const saldo = (id) => Number(sql(`select monedas from v_saldos where usuario_id = '${id}'`) || 0);
const eventos = (id) => sql(`select tipo || coalesce(':' || estado_nuevo, '') from eventos
  where lote_id = '${id}' order by ocurrido_en`).split('\n').filter(Boolean);
const alimentar = (id, cuando) => sql(`select set_config('request.jwt.claim.sub','${CARLA}',false);
  insert into eventos (id, lote_id, tipo, estado_nuevo, usuario_id, ocurrido_en)
  values (gen_random_uuid(), '${id}', 'cambio_estado', 'alimentado', '${CARLA}', ${cuando})`);

// PG1 ya tiene de todo: muestreado dos veces, metido y sacado de la pila,
// tres traslados. Se le agregan movimientos y una observación, y se
// alimenta ANTES de instalar la limpieza: es lo que ya había en la base.
sql(`insert into eventos (id, lote_id, tipo, x, y, usuario_id, ocurrido_en) values
  (gen_random_uuid(), '${PG1}', 'movimiento', 10, 10, '${BETO}', now() + interval '9 min'),
  (gen_random_uuid(), '${PG1}', 'movimiento', 20, 20, '${BETO}', now() + interval '10 min')`);
sql(`insert into eventos (id, lote_id, tipo, nota, usuario_id, ocurrido_en)
  values (gen_random_uuid(), '${PG1}', 'observacion', 'húmedo', '${BETO}', now() + interval '11 min')`);
alimentar(PG1, "now() + interval '5 days'");

const saldoBeto = saldo(BETO), saldoCarla = saldo(CARLA);
const antesPg2 = eventos(PG2);

titulo('Limpiar lo que ya estaba alimentado.');
base.cargar('../sql/limpiar-alimentados.sql');

const quedan = eventos(PG1);
ok(!quedan.some((t) => t === 'movimiento'), 'se borran sus movimientos por el patio');
ok(!quedan.some((t) => t === 'salida_pila' || t === 'observacion'), 'y las salidas de pila y observaciones');
ok(quedan.filter((t) => t === 'traslado').length === 1 && quedan.filter((t) => t === 'ingreso_pila').length === 1,
   'los pasos repetidos quedan en uno solo');
ok(quedan.some((t) => t.startsWith('recepcion')) && quedan.includes('cambio_estado:muestreado') && quedan.includes('cambio_estado:alimentado'),
   `se conserva la recepción, el muestreo y la alimentación (${quedan.join(', ')})`);
ok(sql(`select count(*) from eventos where lote_id = '${PG1}' and pila_id is not null`) === '0',
   'ningún evento que queda apunta a una pila');
ok(sql(`select coalesce(pila_id::text, 'ninguna') from lotes where id = '${PG1}'`) === 'ninguna',
   'el lote ya no figura en ninguna pila');
ok(sql(`select count(*) from pilas where id = '${PILA1}'`) === '0', 'y la pila en que estuvo, que quedó vacía, se borra');
ok(saldo(BETO) === saldoBeto && saldo(CARLA) === saldoCarla,
   `nadie pierde monedas (Beto ${saldo(BETO)}, Carla ${saldo(CARLA)})`);
ok(sql(`select count(*) from v_lotes_dudosos where id = '${PG1}'`) === '0',
   'y el lote no pasa a "dudoso": su muestreo sigue apuntado');
ok(eventos(PG2).join() === antesPg2.join(), 'un lote que no está alimentado no se toca');

titulo('Desde ahora, alimentar limpia solo.');
// PG2 entra a una pila nueva, se mueve y después se alimenta.
const PILA2 = 'cccccccc-0000-4000-8000-000000000002';
sql(`insert into pilas (id, codigo, tipo, plataforma_id) values ('${PILA2}', '2', 'otro', 'bbbbbbbb-0000-4000-8000-000000000001')`);
sql(`insert into eventos (id, lote_id, tipo, pila_id, usuario_id, ocurrido_en) values
  (gen_random_uuid(), '${PG2}', 'ingreso_pila', '${PILA2}', '${BETO}', now() + interval '4 days')`);
sql(`insert into eventos (id, lote_id, tipo, x, y, usuario_id, ocurrido_en) values
  (gen_random_uuid(), '${PG2}', 'movimiento', 5, 5, '${BETO}', now() + interval '4 days 1 hour')`);
const antes2 = saldo(BETO);
alimentar(PG2, "now() + interval '6 days'");
ok(sql(`select estado from lotes where id = '${PG2}'`) === 'alimentado', 'el lote queda alimentado');
ok(!eventos(PG2).includes('movimiento'), 'su movimiento se borró solo, al alimentarlo');
ok(eventos(PG2).includes('cambio_estado:alimentado'), 'y el evento de alimentarlo se queda');
ok(sql(`select count(*) from pilas where id = '${PILA2}'`) === '0', 'su pila, vacía, se borró');
ok(saldo(BETO) === antes2, 'apilarlo le sigue pagando a quien lo apiló');

titulo('Registrar una entrada a pila sin decir a cuál sigue sin poderse.');
ok(base.rechaza(`insert into eventos (id, lote_id, tipo, usuario_id, ocurrido_en)
  values (gen_random_uuid(), '${PG2}', 'ingreso_pila', '${BETO}', now())`),
   'el servidor la rechaza, como antes');

cerrar();
