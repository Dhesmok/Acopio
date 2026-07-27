-- =====================================================================
--  RESET · borra el esquema anterior para volver a correr schema.sql
--  Borra lotes, pilas, eventos y el fondo del mapa.
--  NO borra los usuarios de Authentication.
-- =====================================================================
drop trigger if exists trg_nuevo_usuario on auth.users;

drop view if exists v_tablero cascade;
drop view if exists v_pila_composicion cascade;
drop view if exists v_lote_historial cascade;

drop table if exists eventos cascade;
drop table if exists lotes cascade;
drop table if exists pilas cascade;
drop table if exists proveedores cascade;
drop table if exists mapa_figuras cascade;
drop table if exists mapa_config cascade;
drop table if exists perfiles cascade;

drop function if exists fn_aplicar_evento() cascade;
drop function if exists fn_proteger_derivados() cascade;
drop function if exists fn_evento_recepcion() cascade;
drop function if exists fn_nuevo_usuario() cascade;
drop function if exists fn_mi_rol() cascade;

drop type if exists forma_figura cascade;
drop type if exists tipo_evento cascade;
drop type if exists estado_pila cascade;
drop type if exists tipo_pila cascade;
drop type if exists estado_lote cascade;

drop policy if exists p_mapa_ver on storage.objects;
drop policy if exists p_mapa_subir on storage.objects;
drop policy if exists p_mapa_reemplazar on storage.objects;
drop policy if exists p_mapa_borrar on storage.objects;

-- =====================================================================
--  DESPUÉS de correr schema.sql: devolverles el perfil a los usuarios
--  que ya existen en Authentication. Descomentar y ejecutar.
--  Cambia el rol del tuyo a 'admin' para poder editar el fondo.
-- =====================================================================
-- insert into perfiles (id, nombre, rol, activo)
-- select id, split_part(email, '@', 1), 'contratista', true
--   from auth.users
-- on conflict (id) do nothing;
