-- =====================================================================
--  redondear.sql  ·  vuelve círculos los lotes a granel que ya existen.
--
--  Los lotes nuevos ya nacen redondos. Los que se registraron antes se
--  quedaron ovalados, así que el patio se ve mezclado hasta que roten.
--  Esto los empareja de una.
--
--  Se corre UNA vez en Supabase → SQL Editor. Se puede volver a correr
--  sin miedo: la segunda vez no encuentra nada que cambiar.
--
--  Qué toca y qué no:
--    · SOLO los de forma 'elipse', que son los de granel.
--    · Los bigbags (rectángulo) NO se tocan.
--    · Los dibujados a mano (polígono) NO se tocan: esa forma la puso
--      alguien vértice por vértice y no es nuestra para cambiarla.
--    · El tamaño se CONSERVA: el radio sale de la raíz de rx·ry, así que
--      un lote que alguien agrandó a mano sigue igual de grande, solo
--      que redondo. Nadie ve encoger su lote.
--
--  Los celulares lo reciben solos: el disparador de `actualizado_en`
--  marca las filas y la sincronización incremental se las lleva.
-- =====================================================================

-- 1 · ¿Cuántos hay por redondear? (mirar antes, por tranquilidad)
select count(*) filter (where forma = 'elipse' and rx <> ry) as por_redondear,
       count(*) filter (where forma = 'elipse' and rx =  ry) as ya_redondos,
       count(*) filter (where forma = 'rectangulo')          as bigbags_intactos,
       count(*) filter (where forma = 'poligono')            as a_mano_intactos
from lotes;

-- 2 · Redondear, conservando la superficie de cada uno
update lotes
   set rx = greatest(round(sqrt(rx * ry)), 12),
       ry = greatest(round(sqrt(rx * ry)), 12)
 where forma = 'elipse'
   and rx <> ry;

-- 3 · Que un lote insertado a mano, sin figura, tampoco salga ovalado
alter table lotes alter column rx set default 40;
alter table lotes alter column ry set default 40;

-- 4 · Comprobar: `ovalados_restantes` tiene que dar 0
select count(*) filter (where forma = 'elipse' and rx <> ry) as ovalados_restantes,
       count(*) filter (where forma = 'elipse')              as granel_total,
       min(rx) as radio_menor, max(rx) as radio_mayor
from lotes
where forma = 'elipse';
