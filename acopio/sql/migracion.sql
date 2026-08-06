-- =====================================================================
--  MIGRACIÓN · pone la base al día SIN borrar nada.
--
--  Se puede ejecutar sobre cualquier versión anterior del esquema, y
--  cuantas veces se quiera: cada paso comprueba antes si hace falta.
--  Los lotes, pilas y eventos existentes se conservan.
--
--  De aquí en adelante, las actualizaciones se hacen con este archivo.
--  reset.sql queda solo para empezar de cero a propósito.
-- =====================================================================

-- ------------------------------------------------------------- tipos
do $$ begin
  if not exists (select 1 from pg_type where typname = 'tipo_material') then
    create type tipo_material as enum ('granel', 'bigbag');
  end if;
  if not exists (select 1 from pg_type where typname = 'forma_figura') then
    create type forma_figura as enum ('elipse', 'rectangulo', 'poligono');
  end if;
end $$;

alter type estado_lote  add value if not exists 'remuestreo';
alter type estado_lote  add value if not exists 'plataforma';
alter type forma_figura add value if not exists 'poligono';
alter type tipo_evento  add value if not exists 'programar_recogida';
alter type tipo_evento  add value if not exists 'movimiento';
alter type tipo_evento  add value if not exists 'renombrado';

-- -------------------------------------------------------------- lotes
alter table lotes add column if not exists placa          text;
alter table lotes add column if not exists material       tipo_material not null default 'granel';
alter table lotes add column if not exists forma          forma_figura  not null default 'elipse';
alter table lotes add column if not exists puntos         jsonb;
alter table lotes add column if not exists fecha_recogida date;
alter table lotes add column if not exists x              numeric not null default 500;
alter table lotes add column if not exists y              numeric not null default 350;
alter table lotes add column if not exists rx             numeric not null default 46;
alter table lotes add column if not exists ry             numeric not null default 34;
alter table lotes add column if not exists rot            numeric not null default 0;

update lotes set placa = 'SIN REGISTRO' where placa is null;
alter table lotes alter column placa set not null;

-- El servidor corre en UTC, así que `current_date` cambia de día a las
-- 7 de la noche hora de Colombia: un lote recibido de noche quedaba
-- fechado al día siguiente. La app manda la fecha explícita; esto arregla
-- el valor por defecto para cualquier inserción hecha a mano.
alter table lotes alter column fecha_recepcion
  set default (now() at time zone 'America/Bogota')::date;

alter table lotes drop column if exists peso_ton;
alter table lotes drop column if exists tiquete_ref;

-- -------------------------------------------------------------- pilas
alter table pilas add column if not exists forma  forma_figura not null default 'elipse';
alter table pilas add column if not exists puntos jsonb;
alter table pilas add column if not exists x      numeric not null default 500;
alter table pilas add column if not exists y      numeric not null default 350;
alter table pilas add column if not exists rx     numeric not null default 100;
alter table pilas add column if not exists ry     numeric not null default 70;
alter table pilas add column if not exists rot    numeric not null default 0;

-- ------------------------------------ para bajar solo lo que cambió
--  La app bajaba TODO cada veinte segundos. Para pedir solo lo nuevo hace
--  falta saber cuándo cambió cada fila, y que lo ponga el SERVIDOR: un
--  celular con el reloj corrido no puede decidir qué se sincroniza.
alter table lotes add column if not exists actualizado_en timestamptz not null default now();
alter table pilas add column if not exists actualizado_en timestamptz not null default now();

create or replace function fn_marcar_actualizado()
returns trigger language plpgsql as $$
begin
  new.actualizado_en := now();
  return new;
end; $$;

--  Se llama así para que corra ANTES que trg_proteger_derivados (los
--  disparadores de un mismo momento van en orden alfabético). El de
--  protección no toca esta columna, así que la marca sobrevive.
drop trigger if exists trg_marcar_actualizado on lotes;
create trigger trg_marcar_actualizado before insert or update on lotes
  for each row execute function fn_marcar_actualizado();
drop trigger if exists trg_marcar_actualizado on pilas;
create trigger trg_marcar_actualizado before insert or update on pilas
  for each row execute function fn_marcar_actualizado();

create index if not exists idx_lotes_actualizado   on lotes (actualizado_en);
create index if not exists idx_pilas_actualizado   on pilas (actualizado_en);
create index if not exists idx_eventos_registrado  on eventos (registrado_en);

-- ------------------------------------------------------------ eventos
alter table eventos add column if not exists fecha_recogida date;
alter table eventos add column if not exists x numeric;
alter table eventos add column if not exists y numeric;
create index if not exists idx_eventos_pila on eventos (pila_id, ocurrido_en desc);
create index if not exists idx_lotes_placa  on lotes (placa);

-- ------------------------------------------------------- fondo del mapa
create table if not exists mapa_figuras (
  id       uuid primary key,
  forma    forma_figura not null default 'rectangulo',
  puntos   jsonb,
  etiqueta text,
  x        numeric not null,
  y        numeric not null,
  rx       numeric not null default 80,
  ry       numeric not null default 50,
  rot      numeric not null default 0,
  color    text not null default '#c7cdc5',
  orden    int not null default 0
);
alter table mapa_figuras add column if not exists puntos jsonb;

create table if not exists mapa_config (
  id              text primary key default 'unico' check (id = 'unico'),
  ancho           numeric not null default 1000,
  alto            numeric not null default 700,
  color_fondo     text not null default '#e4e7e2',
  imagen_url      text,
  imagen_x        numeric not null default 0,
  imagen_y        numeric not null default 0,
  imagen_ancho    numeric not null default 1000,
  imagen_alto     numeric not null default 700,
  imagen_opacidad numeric not null default 1
);

alter table mapa_config add column if not exists colores jsonb not null default '{
  "por_muestrear": "#d99a06", "muestreado": "#e8b48a", "remuestreo": "#8a5cd6",
  "facturado": "#2b5ca8", "devolucion": "#b8352a", "plataforma": "#0f6d78",
  "despachado": "#5f6863", "pila_alimentacion": "#1f7a54",
  "pila_devolucion": "#b8352a", "pila_espera": "#d99a06", "pila_otro": "#14171a"
}'::jsonb;

insert into mapa_config (id) values ('unico') on conflict (id) do nothing;

-- ------------------------------------------------------------- lógica
create or replace function fn_mi_rol()
returns text language sql stable security definer set search_path = public as $$
  select rol from perfiles where id = auth.uid() and activo;
$$;

create or replace function fn_aplicar_evento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.desde_evento', 'on', true);
  if new.tipo = 'cambio_estado' then
    update lotes set estado = new.estado_nuevo, estado_desde = new.ocurrido_en,
                     fecha_recogida = new.fecha_recogida,
                     ultimo_evento_en = greatest(ultimo_evento_en, new.ocurrido_en)
     where id = new.lote_id;
  elsif new.tipo = 'programar_recogida' then
    update lotes set fecha_recogida = new.fecha_recogida,
                     ultimo_evento_en = greatest(ultimo_evento_en, new.ocurrido_en)
     where id = new.lote_id;
  elsif new.tipo = 'ingreso_pila' then
    update lotes set pila_id = new.pila_id,
                     ultimo_evento_en = greatest(ultimo_evento_en, new.ocurrido_en)
     where id = new.lote_id;
  elsif new.tipo = 'salida_pila' then
    update lotes set pila_id = null,
                     ultimo_evento_en = greatest(ultimo_evento_en, new.ocurrido_en)
     where id = new.lote_id;
  else
    update lotes set ultimo_evento_en = greatest(ultimo_evento_en, new.ocurrido_en)
     where id = new.lote_id;
  end if;
  perform set_config('app.desde_evento', 'off', true);
  return new;
end; $$;

create or replace function fn_proteger_derivados()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.desde_evento', true), 'off') <> 'on' then
    if fn_mi_rol() is distinct from 'admin' then
      new.codigo       := old.codigo;
      new.proveedor_id := old.proveedor_id;
    end if;
    new.estado         := old.estado;
    new.estado_desde   := old.estado_desde;
    new.fecha_recogida := old.fecha_recogida;
    new.pila_id        := old.pila_id;
    new.creado_en      := old.creado_en;
    new.creado_por     := old.creado_por;
  end if;
  return new;
end; $$;

drop trigger if exists trg_proteger_derivados on lotes;
create trigger trg_proteger_derivados
  before update on lotes for each row execute function fn_proteger_derivados();

-- ---------------------------------------------------------- seguridad
alter table perfiles     enable row level security;
alter table proveedores  enable row level security;
alter table pilas        enable row level security;
alter table lotes        enable row level security;
alter table eventos      enable row level security;
alter table mapa_figuras enable row level security;
alter table mapa_config  enable row level security;

do $$
declare
  p record;
begin
  for p in
    select * from (values
      ('mapa_figuras', 'p_leer_figuras',      'select', 'fn_mi_rol() is not null'),
      ('mapa_config',  'p_leer_config',       'select', 'fn_mi_rol() is not null'),
      ('lotes',        'p_mover_lotes',       'update', 'fn_mi_rol() in (''contratista'',''admin'')'),
      ('pilas',        'p_mover_pilas',       'update', 'fn_mi_rol() in (''contratista'',''admin'')')
    ) as t(tabla, nombre, accion, regla)
  loop
    if not exists (select 1 from pg_policies
                    where schemaname = 'public' and tablename = p.tabla and policyname = p.nombre) then
      if p.accion = 'select' then
        execute format('create policy %I on %I for select to authenticated using (%s)',
                       p.nombre, p.tabla, p.regla);
      else
        execute format('create policy %I on %I for update to authenticated using (%s) with check (%s)',
                       p.nombre, p.tabla, p.regla, p.regla);
      end if;
    end if;
  end loop;

  -- Escribir en el patio: contratista y admin. Estas tres FALTABAN en la
  -- migración, así que una base que venía de una versión vieja se quedaba
  -- sin ellas: el contratista veía el mapa (las de lectura sí estaban)
  -- pero cada lote que registraba lo rechazaba el servidor en silencio, y
  -- después sus eventos fallaban por llave foránea contra un lote que
  -- nunca llegó.
  if not exists (select 1 from pg_policies where tablename = 'lotes' and policyname = 'p_crear_lotes') then
    create policy p_crear_lotes on lotes for insert to authenticated
      with check (fn_mi_rol() in ('contratista', 'admin'));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'pilas' and policyname = 'p_crear_pilas') then
    create policy p_crear_pilas on pilas for insert to authenticated
      with check (fn_mi_rol() in ('contratista', 'admin'));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'eventos' and policyname = 'p_crear_eventos') then
    create policy p_crear_eventos on eventos for insert to authenticated
      with check (fn_mi_rol() in ('contratista', 'admin') and usuario_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'lotes' and policyname = 'p_leer_lotes') then
    create policy p_leer_lotes on lotes for select to authenticated using (fn_mi_rol() is not null);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'pilas' and policyname = 'p_leer_pilas') then
    create policy p_leer_pilas on pilas for select to authenticated using (fn_mi_rol() is not null);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'eventos' and policyname = 'p_leer_eventos') then
    create policy p_leer_eventos on eventos for select to authenticated using (fn_mi_rol() is not null);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'perfiles' and policyname = 'p_leer_perfiles') then
    create policy p_leer_perfiles on perfiles for select to authenticated using (fn_mi_rol() is not null);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'proveedores' and policyname = 'p_leer_proveedores') then
    create policy p_leer_proveedores on proveedores for select to authenticated using (fn_mi_rol() is not null);
  end if;

  -- el fondo del mapa: solo admin
  if not exists (select 1 from pg_policies where tablename = 'mapa_figuras' and policyname = 'p_admin_figuras') then
    create policy p_admin_figuras on mapa_figuras for all to authenticated
      using (fn_mi_rol() = 'admin') with check (fn_mi_rol() = 'admin');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'mapa_config' and policyname = 'p_admin_config') then
    create policy p_admin_config on mapa_config for update to authenticated
      using (fn_mi_rol() = 'admin') with check (fn_mi_rol() = 'admin');
  end if;
  -- ESTA es la que faltaba: guardar con upsert es un INSERT
  if not exists (select 1 from pg_policies where tablename = 'mapa_config' and policyname = 'p_admin_config_ins') then
    create policy p_admin_config_ins on mapa_config for insert to authenticated
      with check (fn_mi_rol() = 'admin');
  end if;
end $$;

-- ------------------------------------------- imagen de fondo (Storage)
insert into storage.buckets (id, name, public) values ('mapa', 'mapa', true)
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'objects' and policyname = 'p_mapa_ver') then
    create policy p_mapa_ver on storage.objects for select using (bucket_id = 'mapa');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'objects' and policyname = 'p_mapa_subir') then
    create policy p_mapa_subir on storage.objects for insert to authenticated
      with check (bucket_id = 'mapa' and fn_mi_rol() = 'admin');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'objects' and policyname = 'p_mapa_reemplazar') then
    create policy p_mapa_reemplazar on storage.objects for update to authenticated
      using (bucket_id = 'mapa' and fn_mi_rol() = 'admin');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'objects' and policyname = 'p_mapa_borrar') then
    create policy p_mapa_borrar on storage.objects for delete to authenticated
      using (bucket_id = 'mapa' and fn_mi_rol() = 'admin');
  end if;
end $$;

-- ------------------------------- el nombre de una pila se puede reusar
--  El nombre era único PARA SIEMPRE, así que una pila archivada seguía
--  reservando el suyo y la numeración no paraba de subir: con tres pilas
--  en el patio ya se iba por la 4, y en un año por la 40.
--
--  Ahora es único solo entre las pilas ABIERTAS, que es donde importa:
--  en el plano nunca hay dos con el mismo nombre. Las archivadas lo
--  sueltan, y el número se puede volver a usar.
--
--  El historial no se enreda: cada apunte guarda el id de la pila, no su
--  nombre, y en la ficha del lote cada línea va con su fecha. Que dos
--  pilas distintas se hayan llamado "1" en marzo y en septiembre se lee
--  igual de bien.
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'pilas_codigo_key') then
    alter table pilas drop constraint pilas_codigo_key;
  end if;
end $$;
create unique index if not exists ux_pilas_codigo_abierta
  on pilas (codigo) where estado = 'abierta';

-- PostgREST guarda en caché la forma de las tablas: hay que avisarle
notify pgrst, 'reload schema';

select 'Migración aplicada. Los datos existentes se conservaron.' as resultado;
