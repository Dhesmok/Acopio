-- =====================================================================
--  DIAGNÓSTICO · qué hay y qué falta en la base. No cambia nada.
--  Ejecutar completo y mirar los bloques del resultado.
--
--  Los bloques 3, 4 y 5 son los que explican el caso clásico:
--  "toco Poner en el mapa y no pasa nada, y después salen lotes repetidos".
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

-- 3. ¿Quién tiene cuenta, quién tiene perfil y quién está ACTIVO?
--    Un perfil inactivo no lee ni escribe nada: fn_mi_rol() devuelve null
--    y todas las políticas quedan en falso. El servidor no da error, solo
--    devuelve cero filas y rechaza cada inserción. Desde la app se ve como
--    "no pasa nada". Todo perfil nace inactivo: hay que habilitarlo.
select 'usuarios' as bloque, u.email,
       coalesce(p.rol, 'SIN PERFIL') as rol,
       coalesce(p.activo::text, '—') as activo,
       case when p.id is null then 'REVISAR · no tiene perfil'
            when not p.activo then 'REVISAR · no puede leer ni escribir nada'
            else 'ok' end as estado
  from auth.users u
  left join perfiles p on p.id = u.id
 order by (p.id is null or not p.activo) desc, u.email;

-- 4. ¿Están todas las políticas que la app necesita?
--    Sin la de INSERT en lotes, el contratista ve el mapa pero no puede
--    crear: el lote se queda en el celular y sus eventos fallan después
--    con eventos_lote_id_fkey, apuntando a un lote que nunca llegó.
select 'politicas' as bloque, p.tabla, p.nombre, p.para,
       case when exists (
         select 1 from pg_policies
          where schemaname = 'public' and tablename = p.tabla and policyname = p.nombre
       ) then 'ok' else 'FALTA' end as estado
  from (values
      ('perfiles',    'p_leer_perfiles',     'leer'),
      ('proveedores', 'p_leer_proveedores',  'leer'),
      ('lotes',       'p_leer_lotes',        'leer'),
      ('pilas',       'p_leer_pilas',        'leer'),
      ('eventos',     'p_leer_eventos',      'leer'),
      ('mapa_figuras','p_leer_figuras',      'leer'),
      ('mapa_config', 'p_leer_config',       'leer'),
      ('lotes',       'p_crear_lotes',       'crear lotes'),
      ('lotes',       'p_mover_lotes',       'mover lotes'),
      ('pilas',       'p_crear_pilas',       'crear pilas'),
      ('pilas',       'p_mover_pilas',       'mover pilas'),
      ('eventos',     'p_crear_eventos',     'registrar eventos'),
      ('mapa_figuras','p_admin_figuras',     'fondo (admin)'),
      ('mapa_config', 'p_admin_config',      'fondo (admin)'),
      ('mapa_config', 'p_admin_config_ins',  'fondo (admin)')
    ) as p(tabla, nombre, para)
 order by estado, p.tabla;

-- 5. Lotes repetidos y eventos huérfanos.
--    El código de lote es único, así que en el SERVIDOR no puede haber
--    duplicados: si la app los muestra, están atrapados en la cola del
--    celular. Aquí se ve lo que sí llegó.
select 'lotes por codigo' as bloque, codigo, count(*) as veces,
       min(creado_en) as primero, max(creado_en) as ultimo
  from lotes group by codigo having count(*) > 1 order by count(*) desc;

select 'eventos sin lote' as bloque, count(*) as cuantos
  from eventos e left join lotes l on l.id = e.lote_id where l.id is null;

-- 6. Lotes sin proveedor válido (se registraron cuando la app no había
--    bajado todavía la lista de proveedores).
select 'lotes sin proveedor' as bloque, l.codigo, l.creado_en
  from lotes l left join proveedores p on p.id = l.proveedor_id
 where p.id is null order by l.creado_en;
