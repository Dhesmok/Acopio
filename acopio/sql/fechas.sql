-- =====================================================================
--  FECHAS · corregir lotes fechados un día adelante.
--
--  El servidor corre en UTC. Colombia va cinco horas atrás, así que todo
--  lo registrado después de las 7 de la noche caía en el día siguiente:
--  un lote recibido el lunes a las 8 p. m. quedaba con fecha del martes.
--
--  `creado_en` es timestamptz y siempre estuvo bien: guarda el instante
--  exacto. El que se torcía es `fecha_recepcion`, que es un `date`.
--  Por eso se puede reconstruir la fecha correcta desde `creado_en`.
--
--  Mirar primero, corregir después.
-- =====================================================================

-- 1. ¿Cuántos y cuáles están torcidos?
select l.codigo, l.fecha_recepcion as fecha_guardada,
       (l.creado_en at time zone 'America/Bogota')::date as fecha_real,
       to_char(l.creado_en at time zone 'America/Bogota', 'HH24:MI') as hora_local
  from lotes l
 where l.fecha_recepcion <> (l.creado_en at time zone 'America/Bogota')::date
 order by l.creado_en;

-- 2. Corregir. `fecha_recepcion` no está protegida por el trigger de
--    derivados, así que un update normal basta.
--
--    OJO: esto asume que el lote se registró el mismo día en que llegó el
--    material, que es como se usa la app. Si alguien registró lotes
--    atrasados a mano, revisa el listado de arriba antes de correr esto.
--
-- begin;
--   update lotes
--      set fecha_recepcion = (creado_en at time zone 'America/Bogota')::date
--    where fecha_recepcion <> (creado_en at time zone 'America/Bogota')::date;
--   select count(*) as corregidos from lotes
--    where fecha_recepcion = (creado_en at time zone 'America/Bogota')::date;
-- commit;   -- o rollback;

-- 3. Que no se repita: el valor por defecto de la columna en hora local.
--    Ya viene en migracion.sql; esto solo lo confirma.
select column_default as defecto_actual
  from information_schema.columns
 where table_schema = 'public' and table_name = 'lotes'
   and column_name = 'fecha_recepcion';
