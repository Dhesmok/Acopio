-- =====================================================================
--  DIAGNÓSTICO · qué hay y qué falta en la base. No cambia nada.
--  Ejecutar completo y mirar los tres bloques del resultado.
-- =====================================================================

-- 1. ¿Están las tablas?
select 'tablas' as bloque, t.nombre,
       case when to_regclass('public.' || t.nombre) is null
            then 'FALTA' else 'ok' end as estado
  from (values ('perfiles'), ('proveedores'), ('lotes'), ('pilas'),
               ('eventos'), ('mapa_figuras'), ('mapa_config')) as t(nombre);

-- 2. ¿Están las columnas nuevas de lotes?
select 'columnas de lotes' as bloque, c.nombre,
       case when exists (
         select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'lotes' and column_name = c.nombre
       ) then 'ok' else 'FALTA' end as estado
  from (values ('placa'), ('material'), ('forma'), ('puntos'),
               ('x'), ('y'), ('rx'), ('ry'), ('rot'), ('fecha_recogida')) as c(nombre);

-- 3. ¿Quién tiene cuenta y quién tiene perfil?
select 'usuarios' as bloque, u.email,
       coalesce(p.rol, 'SIN PERFIL') as rol,
       coalesce(p.activo::text, '—') as activo
  from auth.users u
  left join perfiles p on p.id = u.id
 order by u.email;
