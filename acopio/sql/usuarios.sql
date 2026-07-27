-- =====================================================================
--  USUARIOS · asigna perfil y rol a las cuentas de Authentication.
--
--  Requiere que la tabla perfiles exista, es decir, haber corrido antes
--  schema.sql (base nueva) o migracion.sql (base en uso).
--
--  Regla: correo @infinita.com → admin; los demás → contratista.
--  Todos quedan activos. Se puede ejecutar cuantas veces se quiera.
-- =====================================================================

do $$
declare
  creados int;
begin
  if to_regclass('public.perfiles') is null then
    raise exception
      'La tabla perfiles no existe. Ejecuta primero schema.sql (base nueva) o migracion.sql (base en uso).';
  end if;

  insert into perfiles (id, nombre, rol, activo)
  select u.id,
         initcap(split_part(u.email, '@', 1)),
         case when split_part(u.email, '@', 2) = 'infinita.com'
              then 'admin' else 'contratista' end,
         true
    from auth.users u
  on conflict (id) do update
     set nombre = excluded.nombre,
         rol    = excluded.rol,
         activo = excluded.activo;

  get diagnostics creados = row_count;
  raise notice 'Perfiles creados o actualizados: %', creados;
end $$;

-- Comprobación: deben aparecer los cuatro con su rol
select p.nombre, u.email, p.rol, p.activo
  from perfiles p
  join auth.users u on u.id = p.id
 order by p.rol, p.nombre;
