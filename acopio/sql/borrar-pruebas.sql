-- =====================================================================
--  LIMPIEZA · borrar un lote o una pila de pruebas.
--
--  La app NUNCA borra lotes ni pilas: quitar una pila la archiva, y un
--  lote despachado se queda con su historial. Eso es a propósito, porque
--  el historial es el libro de cuentas del patio. Así que borrar de
--  verdad se hace desde aquí, a mano, y sabiendo lo que se pierde.
--
--  POR QUÉ FALLA BORRAR "A LO BRUTO"
--
--  Cada movimiento de un lote queda apuntado en `eventos`, y esa tabla
--  apunta a `lotes` y a `pilas`. La base de datos no deja borrar una
--  fila mientras algo la señale — de ahí el error:
--
--     Key (id)=(...) is still referenced from table eventos
--
--  Fíjate en el NOMBRE de la clave que sale en el error, que dice cuál
--  de los dos casos es:
--     eventos_lote_id_fkey  →  estás borrando un LOTE
--     eventos_pila_id_fkey  →  estás borrando una PILA
--
--  LEER ANTES DE EJECUTAR. Lo que borra está comentado a propósito:
--  primero se mira, después se borra.
-- =====================================================================

-- Pon aquí los ids que quieres quitar y no los cambies más abajo.
-- (En Supabase: Table editor → la fila → columna id.)
create temporary table a_borrar (id uuid);
insert into a_borrar (id) values
  ('00000000-0000-0000-0000-000000000000'),   -- ← cámbialo
  ('00000000-0000-0000-0000-000000000000');   -- ← cámbialo


-- ---------------------------------------------------------------- mirar
-- 1. ¿Qué son? Si no sale nada, el id está mal copiado.
select 'lote' as que, l.id, l.codigo, l.estado, l.fecha_recepcion, l.placa
  from lotes l join a_borrar b on b.id = l.id
union all
select 'pila', p.id, p.codigo, p.estado, null, null
  from pilas p join a_borrar b on b.id = p.id;

-- 2. Cuántos apuntes cuelgan de cada uno. Esto es lo que hay que quitar
--    antes, y es también lo que se pierde para siempre.
select 'apuntes del lote' as caso, e.lote_id as de, count(*)
  from eventos e join a_borrar b on b.id = e.lote_id group by e.lote_id
union all
select 'apuntes de la pila', e.pila_id, count(*)
  from eventos e join a_borrar b on b.id = e.pila_id group by e.pila_id;

-- 3. AVISO IMPORTANTE, solo si estás borrando una PILA.
--    Los apuntes de entrada y salida de una pila pertenecen a LOTES, y
--    esos lotes pueden ser de verdad. Si aquí sale algún lote que no
--    estés borrando, párate: borrar la pila le arrancaría un trozo de
--    historial a un lote real. Para ese caso NO borres la pila; quítala
--    desde la app, que la archiva y conserva el historial.
select distinct l.id, l.codigo, l.estado
  from eventos e
  join a_borrar b on b.id = e.pila_id
  join lotes l on l.id = e.lote_id
 where l.id not in (select id from a_borrar);

-- 4. Y los lotes que ahora mismo están DENTRO de esa pila.
select l.id, l.codigo, l.estado
  from lotes l join a_borrar b on b.id = l.pila_id;


-- --------------------------------------------------------------- borrar
-- Todo junto y en este orden. Si algo falla, no se hace nada: `begin` y
-- `commit` lo dejan en un bloque de todo o nada.
--
-- Quita los guiones del principio de las líneas para ejecutarlo.

-- begin;
--
-- -- Los lotes que estén dentro de una pila que se va, salen de ella.
-- --
-- -- El `set_config` NO es opcional: hay un disparador que impide cambiar
-- -- la pila de un lote desde fuera de la app, para que mover un lote por
-- -- el plano no le cambie el estado sin querer. Sin esta línea el UPDATE
-- -- parece funcionar y no cambia nada.
-- select set_config('app.desde_evento', 'on', true);
-- update lotes set pila_id = null
--  where pila_id in (select id from a_borrar);
--
-- -- 1º los apuntes, que son los que estorban
-- delete from eventos where lote_id in (select id from a_borrar);
-- delete from eventos where pila_id in (select id from a_borrar);
--
-- -- 2º los lotes
-- delete from lotes where id in (select id from a_borrar);
--
-- -- 3º las pilas
-- delete from pilas where id in (select id from a_borrar);
--
-- commit;


-- ------------------------------------------------------ en los celulares
-- No hay que hacer nada. Un borrado no deja rastro que se pueda
-- consultar —la fila simplemente ya no está—, así que la app se entera
-- cuando "pasa lista": trae la lista de lo que existe y quita lo que le
-- sobre. Cada hora, y también al abrir la app si hacía más de una hora
-- que no pasaba lista.
--
-- Si tienes prisa, en el celular: cerrar la app y volver a abrirla.
