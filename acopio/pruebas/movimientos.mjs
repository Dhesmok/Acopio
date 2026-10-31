// =====================================================================
//  Corregir el último movimiento de un lote (sql/schema.sql,
//  fn_corregir_movimiento).
//
//  Un acomodo chico no anota un movimiento nuevo: corrige x/y del último.
//  Es la única puerta para reescribir un evento, así que hay que probar
//  que no se abre más de la cuenta. Corre contra PostgreSQL de verdad.
// =====================================================================
import { ok, titulo, cerrar } from './ayudas/decir.mjs';
import { baseNueva } from './ayudas/base.mjs';

const base = baseNueva(`acopio_movimientos_${process.pid}`);
if (!base) {
  console.log('\n  (no hay PostgreSQL a mano: corregir movimientos no se probó)');
  cerrar();
}
base.cargar('./ayudas/patio-falso.sql');
process.on('exit', () => base.tirar());
const { sql } = base;

const BETO = '22222222-2222-4222-8222-222222222222';
const PG2 = 'dddddddd-0000-4000-8000-000000000002';
const M1 = 'eeeeeeee-0000-4000-8000-000000000001';
const M2 = 'eeeeeeee-0000-4000-8000-000000000002';
sql(`grant usage on schema auth to authenticated;
  grant select on perfiles, eventos to authenticated;
  insert into eventos (id, lote_id, tipo, x, y, usuario_id, ocurrido_en) values
  ('${M1}', '${PG2}', 'movimiento', 10, 10, '${BETO}', now() + interval '1 min'),
  ('${M2}', '${PG2}', 'movimiento', 50, 50, '${BETO}', now() + interval '2 min')`);

// Como la app: con su rol y la identidad del token, para que la RLS y
// los permisos por columna se apliquen de verdad.
const como = (q) => `select set_config('request.jwt.claim.sub','${BETO}',false);
  set role authenticated;
  ${q}`;
const xy = (id) => sql(`select x || ',' || y from eventos where id = '${id}'`);

titulo('Un acomodo chico corrige el último movimiento, y nada más.');

const antes = sql(`select registrado_en from eventos where id = '${M2}'`);
ok(!base.rechaza(como(`update eventos set x = 53, y = 48 where id = '${M2}'`)),
   'el último movimiento de un lote se puede corregir');
ok(xy(M2) === '53,48', `y queda donde se dejó (${xy(M2)})`);
ok(sql(`select registrado_en > '${antes}'::timestamptz from eventos where id = '${M2}'`) === 't',
   'la corrección se marca como nueva, para que los demás celulares la bajen');

ok(base.rechaza(como(`update eventos set x = 0, y = 0 where id = '${M1}'`)) && xy(M1) === '10,10',
   'uno que no es el último no se toca: el recorrido viejo no se reescribe');
ok(base.rechaza(como(`update eventos set usuario_id = '${BETO}', ocurrido_en = now() where id = '${M2}'`)),
   'solo x/y: ni el autor ni la hora');
sql(como(`update eventos set x = 1 where lote_id = '${PG2}' and tipo = 'recepcion'`));
ok(sql(`select count(*) from eventos where lote_id = '${PG2}' and tipo = 'recepcion' and x = 1`) === '0',
   'ni un evento que no sea un movimiento');
ok(base.rechaza(como(`delete from eventos where id = '${M2}'`)), 'y borrar sigue sin poderse');

cerrar();
