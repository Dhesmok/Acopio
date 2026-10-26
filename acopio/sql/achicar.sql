-- =====================================================================
--  achicar.sql  ·  deja todos los lotes que ya existen un 10 % más chicos.
--
--  Con la foto del patio de fondo los lotes se veían demasiado grandes.
--  Los nuevos ya nacen un 10 % más chicos (la app lo hace al crearlos);
--  esto empareja los que ya estaban.
--
--  Se corre UNA vez en Supabase → SQL Editor. Se puede volver a correr
--  sin miedo: queda anotado en `ajustes_hechos` y la segunda vez no toca
--  nada (achicar dos veces dejaría los lotes un 19 % más chicos).
--
--  Qué toca:
--    · TODOS los lotes, de cualquier forma y estado.
--    · Granel y bigbag: rx y ry por 0,9.
--    · Los dibujados a mano (polígono): cada vértice por 0,9, que están
--      medidos desde el centro del lote, así que el lote se encoge sin
--      moverse de su sitio.
--    · El centro (x, y) y el giro NO cambian. Las pilas NO se tocan.
--
--  Los celulares lo reciben solos: el disparador de `actualizado_en`
--  marca las filas y la sincronización incremental se las lleva.
-- =====================================================================

-- 1 · Dónde queda anotado que ya se hizo
create table if not exists ajustes_hechos (
  nombre     text primary key,
  hecho_en   timestamptz not null default now()
);
alter table ajustes_hechos enable row level security;

-- 2 · Achicar, solo si no se hizo antes
do $$
begin
  if exists (select 1 from ajustes_hechos where nombre = 'lotes_10_por_ciento') then
    raise notice 'Ya estaba hecho: no se cambió nada.';
    return;
  end if;

  update lotes
     set rx = greatest(round(rx * 0.9, 1), 10),
         ry = greatest(round(ry * 0.9, 1), 10),
         puntos = case
           when jsonb_typeof(puntos) = 'array' then coalesce((
             select jsonb_agg(
                      p || jsonb_build_object('x', round((p->>'x')::numeric * 0.9, 1),
                                              'y', round((p->>'y')::numeric * 0.9, 1))
                      order by i)
               from jsonb_array_elements(puntos) with ordinality as v(p, i)), puntos)
           else puntos
         end;

  insert into ajustes_hechos (nombre) values ('lotes_10_por_ciento');
  raise notice 'Lotes achicados un 10 %%.';
end $$;

-- 3 · Que un lote insertado a mano, sin figura, también salga del tamaño nuevo
alter table lotes alter column rx set default 36;
alter table lotes alter column ry set default 36;

-- 4 · Comprobar
select forma, count(*) as lotes, min(rx) as rx_menor, max(rx) as rx_mayor
from lotes group by forma order by forma;
