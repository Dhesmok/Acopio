-- =====================================================================
--  placas.sql  ·  quita el guion de las placas que se escribieron
--                 "SZJ-562" en vez de "SZJ562".
--
--  Desde la versión que restringe el campo, la app ya no deja meter
--  guiones, espacios ni símbolos: solo letras y números. Pero eso vale
--  de aquí en adelante. Las que se escribieron antes se quedaron como
--  estaban, y la misma volqueta aparece de dos maneras según el día.
--
--  Se corre UNA vez en Supabase → SQL Editor. Se puede volver a correr
--  sin miedo: la segunda vez no encuentra nada que cambiar.
--
--  No hace falta el `set_config` de otros scripts: el disparador que
--  protege un lote cuida el estado, la pila y el código, pero la placa
--  no es un dato derivado y se puede corregir de frente.
--
--  Los celulares lo reciben solos: al cambiar la fila, el disparador de
--  `actualizado_en` la marca y entra en la siguiente sincronización.
--
--  LEER ANTES DE EJECUTAR. Lo que cambia está comentado a propósito:
--  primero se mira, después se corrige.
-- =====================================================================

-- ---------------------------------------------------------------- mirar
-- 1. Todas las placas que llevan algo que no sea letra o número, con
--    cuántos lotes tiene cada una y cómo quedaría. Mira la columna
--    `quedaria` antes de nada: es exactamente lo que se va a guardar.
select placa                                       as ahora,
       regexp_replace(placa, '[^A-Za-z0-9]', '', 'g') as quedaria,
       count(*)                                    as lotes,
       min(fecha_recepcion)                        as desde,
       max(fecha_recepcion)                        as hasta
  from lotes
 where placa ~ '[^A-Za-z0-9]'
 group by placa
 order by placa;

-- 2. Después de limpiarlas, ¿alguna se va a juntar con otra que ya
--    existía bien escrita? Eso NO es un problema —una volqueta trae
--    muchos lotes y la placa no es única—, pero conviene verlo: es la
--    prueba de que "SZJ-562" y "SZJ562" eran la misma volqueta.
select regexp_replace(placa, '[^A-Za-z0-9]', '', 'g') as placa_limpia,
       count(*) filter (where placa ~ '[^A-Za-z0-9]') as venian_con_simbolo,
       count(*) filter (where placa !~ '[^A-Za-z0-9]') as ya_estaban_bien,
       array_agg(distinct placa)                       as como_se_escribio
  from lotes
 group by 1
having count(distinct placa) > 1
 order by 1;

-- 3. Y de paso, las que quedaron en minúscula. La app las guarda en
--    mayúscula desde siempre, así que esto no debería sacar nada.
select placa, count(*) as lotes
  from lotes
 where placa <> upper(placa)
 group by placa;


-- ------------------------------------------------------------ corregir
-- Quita los guiones del principio de las líneas para ejecutarlo.

-- begin;
--
-- -- Quita TODO lo que no sea letra o número: el guion de "SZJ-562", y
-- -- también los espacios y los puntos si alguno se coló. Es la misma
-- -- regla que aplica la app al escribir, así que después de esto las
-- -- viejas y las nuevas se escriben igual.
-- update lotes
--    set placa = regexp_replace(placa, '[^A-Za-z0-9]', '', 'g')
--  where placa ~ '[^A-Za-z0-9]';
--
-- -- Y a mayúscula, que es como las guarda la app.
-- update lotes set placa = upper(placa) where placa <> upper(placa);
--
-- commit;


-- ------------------------------------------------------------ comprobar
-- Después de corregir, esto tiene que salir en cero.
select count(*) as placas_con_simbolos_o_minusculas
  from lotes
 where placa ~ '[^A-Za-z0-9]' or placa <> upper(placa);
