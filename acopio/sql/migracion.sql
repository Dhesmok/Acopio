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
--  'alimentado': el lote se consumió en planta y deja de verse en el
--  plano. 'traslado': se pasó a otra plataforma.
alter type estado_lote add value if not exists 'alimentado';
alter type tipo_evento add value if not exists 'traslado';

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
    -- Alimentar es el final del camino: se apunta POR DÓNDE entró y
    -- CUÁNDO, que es lo que se consulta después. Si el estado cambia a
    -- otra cosa, esos dos datos se limpian: el lote ya no está
    -- alimentado y dejarlos puestos mentiría en el informe.
    update lotes set estado = new.estado_nuevo,
                     estado_desde = new.ocurrido_en,
                     fecha_recogida = new.fecha_recogida,
                     punto_id = case when new.estado_nuevo = 'alimentado'
                                     then new.punto_id else null end,
                     alimentado_en = case when new.estado_nuevo = 'alimentado'
                                          then new.ocurrido_en else null end,
                     ultimo_evento_en = greatest(ultimo_evento_en, new.ocurrido_en)
     where id = new.lote_id;
  elsif new.tipo = 'traslado' then
    -- Cambiar de plataforma NO cambia el estado ni saca de la pila: un
    -- lote facturado que se pasa a Ye sigue facturado. Si iba dentro de
    -- una pila, la pila entera se mueve y él va con ella.
    update lotes set plataforma_id = new.plataforma_id,
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

drop trigger if exists trg_aplicar_evento on eventos;
create trigger trg_aplicar_evento
  after insert on eventos for each row execute function fn_aplicar_evento();

create or replace function fn_proteger_derivados()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.desde_evento', true), 'off') <> 'on' then
    -- solo el admin puede corregir el código y el proveedor de un lote
    if fn_mi_rol() is distinct from 'admin' then
      new.codigo       := old.codigo;
      new.proveedor_id := old.proveedor_id;
    end if;
    new.estado         := old.estado;
    new.estado_desde   := old.estado_desde;
    new.fecha_recogida := old.fecha_recogida;
    new.pila_id        := old.pila_id;
    -- La plataforma se cambia con un evento 'traslado', no escribiendo
    -- la columna: si no, mover un lote por el plano podría teletransportarlo
    -- de patio sin dejar rastro de quién lo hizo.
    new.plataforma_id  := old.plataforma_id;
    new.punto_id       := old.punto_id;
    new.alimentado_en  := old.alimentado_en;
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

-- --------------------------------------------------------------- tareas
--  Encargos del admin a los contratistas. Ver schema.sql para el porqué
--  de cada decisión; aquí solo se crea lo que falte.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'prioridad_tarea') then
    create type prioridad_tarea as enum ('urgente', 'alta', 'media', 'baja');
  end if;
end $$;

create table if not exists tareas (
  id             uuid primary key,
  titulo         text not null,
  detalle        text,
  prioridad      prioridad_tarea not null default 'media',
  asignado_a     uuid references perfiles (id),
  lotes_ids      uuid[] not null default '{}',
  pilas_ids      uuid[] not null default '{}',
  creado_por     uuid references perfiles (id),
  creado_en      timestamptz not null default now(),
  completado_en  timestamptz,
  completado_por uuid references perfiles (id),
  nota_cierre    text,
  actualizado_en timestamptz not null default now()
);

-- `create table if not exists` no toca una tabla que YA existe, así que
-- a quien creó las tareas con la versión anterior —una tarea señalaba un
-- solo lote y una sola pila— no le llegaban las columnas nuevas, y la app
-- fallaba con "Could not find the 'lotes_ids' column of 'tareas'".
alter table tareas add column if not exists lotes_ids uuid[] not null default '{}';
alter table tareas add column if not exists pilas_ids uuid[] not null default '{}';

-- Lo que hubiera apuntado a la manera vieja se pasa a la lista antes de
-- quitar las columnas, para no perderlo.
do $$ begin
  if exists (select 1 from information_schema.columns
              where table_name = 'tareas' and column_name = 'lote_id') then
    execute $q$ update tareas set lotes_ids = array[lote_id]
                 where lote_id is not null and cardinality(lotes_ids) = 0 $q$;
    execute 'alter table tareas drop column lote_id';
  end if;
  if exists (select 1 from information_schema.columns
              where table_name = 'tareas' and column_name = 'pila_id') then
    execute $q$ update tareas set pilas_ids = array[pila_id]
                 where pila_id is not null and cardinality(pilas_ids) = 0 $q$;
    execute 'alter table tareas drop column pila_id';
  end if;
end $$;

create index if not exists idx_tareas_pendientes on tareas (completado_en, prioridad);

drop trigger if exists trg_marcar_actualizado on tareas;
create trigger trg_marcar_actualizado before insert or update on tareas
  for each row execute function fn_marcar_actualizado();

create or replace function fn_proteger_tarea()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if fn_mi_rol() is distinct from 'admin' then
    if old.completado_en is not null then return old; end if;
    -- Si la tarea tiene dueño, solo la cierra su dueño. Se ignora en vez
    -- de fallar, por lo mismo: un error dejaría la cola de ese celular
    -- atascada, y en la vuelta siguiente la tarea vuelve a bajar abierta,
    -- que es la verdad. La pantalla ya no enseña el botón a los demás;
    -- esto es el cerrojo de abajo, el que no se puede saltar.
    if old.asignado_a is not null and old.asignado_a <> auth.uid() then
      return old;
    end if;
    new.titulo     := old.titulo;      new.detalle    := old.detalle;
    new.prioridad  := old.prioridad;   new.asignado_a := old.asignado_a;
    new.lotes_ids  := old.lotes_ids;   new.pilas_ids  := old.pilas_ids;
    new.creado_por := old.creado_por;  new.creado_en  := old.creado_en;
    new.completado_por := auth.uid();
    if new.completado_en is null then new.completado_en := now(); end if;
  end if;
  return new;
end; $$;

drop trigger if exists trg_proteger_tarea on tareas;
create trigger trg_proteger_tarea before update on tareas
  for each row execute function fn_proteger_tarea();

alter table tareas enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'tareas' and policyname = 'p_leer_tareas') then
    create policy p_leer_tareas on tareas for select to authenticated
      using (fn_mi_rol() is not null);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'tareas' and policyname = 'p_crear_tareas') then
    create policy p_crear_tareas on tareas for insert to authenticated
      with check (fn_mi_rol() = 'admin');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'tareas' and policyname = 'p_cerrar_tareas') then
    create policy p_cerrar_tareas on tareas for update to authenticated
      using (fn_mi_rol() is not null) with check (fn_mi_rol() is not null);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'tareas' and policyname = 'p_borrar_tareas') then
    create policy p_borrar_tareas on tareas for delete to authenticated
      using (fn_mi_rol() = 'admin');
  end if;
end $$;


-- ===================================================================
--  PLATAFORMAS  ·  el patio deja de ser uno y pasa a ser cinco.
--
--  Lo que hace, en orden y sin perder nada:
--    1. crea las tablas y columnas nuevas
--    2. crea las cinco plataformas y los puntos de alimentación
--    3. mete TODO lo que existe hoy en Topsoil
--    4. los lotes que estaban en estado 'plataforma' se mudan a
--       Plataforma 5 y quedan como 'facturado'
--    5. el tamaño y el fondo del plano de hoy pasan a ser los de Topsoil
--    6. recién entonces se ponen las columnas como obligatorias
--
--  Se puede correr las veces que se quiera.
-- ===================================================================

create table if not exists plataformas (
  id              uuid primary key,
  nombre          text not null unique,
  orden           int not null default 0,
  activa          boolean not null default true,
  ancho           numeric not null default 1000,
  alto            numeric not null default 700,
  color_fondo     text not null default '#e4e7e2',
  imagen_url      text,
  imagen_x        numeric not null default 0,
  imagen_y        numeric not null default 0,
  imagen_ancho    numeric not null default 1000,
  imagen_alto     numeric not null default 700,
  imagen_opacidad numeric not null default 1,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);

create table if not exists puntos_alimentacion (
  id             uuid primary key,
  nombre         text not null unique,
  orden          int not null default 0,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

drop trigger if exists trg_marcar_actualizado on plataformas;
create trigger trg_marcar_actualizado before insert or update on plataformas
  for each row execute function fn_marcar_actualizado();
drop trigger if exists trg_marcar_actualizado on puntos_alimentacion;
create trigger trg_marcar_actualizado before insert or update on puntos_alimentacion
  for each row execute function fn_marcar_actualizado();

-- Las cinco. El orden es el que se ve en la app.
insert into plataformas (id, nombre, orden) values
  ('11111111-0000-4000-8000-000000000001', 'Topsoil',       1),
  ('11111111-0000-4000-8000-000000000002', 'Plataforma 2',  2),
  ('11111111-0000-4000-8000-000000000003', 'Plataforma 3',  3),
  ('11111111-0000-4000-8000-000000000004', 'Ye',            4),
  ('11111111-0000-4000-8000-000000000005', 'Plataforma 5',  5)
on conflict (nombre) do nothing;

insert into puntos_alimentacion (id, nombre, orden) values
  ('22222222-0000-4000-8000-000000000001', 'Batch',         1),
  ('22222222-0000-4000-8000-000000000002', 'Tolva Naranja', 2),
  ('22222222-0000-4000-8000-000000000003', 'Reempaque',     3)
on conflict (nombre) do nothing;

-- Columnas nuevas, todavía sin obligar: primero hay que rellenarlas.
alter table lotes        add column if not exists plataforma_id uuid references plataformas (id);
alter table lotes        add column if not exists punto_id      uuid references puntos_alimentacion (id);
alter table lotes        add column if not exists alimentado_en timestamptz;
alter table pilas        add column if not exists plataforma_id uuid references plataformas (id);
alter table mapa_figuras add column if not exists plataforma_id uuid references plataformas (id);
alter table eventos      add column if not exists plataforma_id uuid references plataformas (id);
alter table eventos      add column if not exists punto_id      uuid references puntos_alimentacion (id);

-- Rellenar lo que ya existe. Va TODO dentro de este bloque por una razón
-- que costó un error en producción:
--
--   ERROR 23502: column "plataforma_id" of relation "lotes"
--                contains null values
--
-- `lotes` tiene el disparador `trg_proteger_derivados`, que existe justo
-- para que mover un lote por el plano no pueda cambiarle el estado, la
-- pila ni —desde ahora— la plataforma: en cada UPDATE devuelve esas
-- columnas a lo que ya tenían. Un UPDATE hecho a mano no es una
-- excepción, así que el relleno de abajo se aplicaba y el disparador lo
-- deshacía en el acto: `plataforma_id` seguía en NULL, y el
-- `set not null` de más abajo reventaba. Lo mismo le pasaba al cambio de
-- estado de los que estaban en 'plataforma'.
--
-- La marca `app.desde_evento` es la que usa el disparador de eventos para
-- decir "este cambio viene por las buenas". Aquí se usa igual, y se
-- apaga al terminar. Va con `true` —solo esta transacción—, así que
-- aunque algo fallara la marca no queda encendida.
do $$
declare
  topsoil constant uuid := '11111111-0000-4000-8000-000000000001';
  plat5   constant uuid := '11111111-0000-4000-8000-000000000005';
begin
  perform set_config('app.desde_evento', 'on', true);

  -- Todo lo que hay hoy está en Topsoil: es el único patio que existía.
  update lotes        set plataforma_id = topsoil where plataforma_id is null;
  update pilas        set plataforma_id = topsoil where plataforma_id is null;
  update mapa_figuras set plataforma_id = topsoil where plataforma_id is null;

  -- Los que estaban en estado 'plataforma' querían decir "se fue a la
  -- Plataforma 5". Ahora eso es un SITIO, así que se mudan de verdad y
  -- recuperan un estado normal.
  --
  -- NO se les escribe un evento de traslado, y es a propósito: Postgres
  -- no deja USAR un valor de enumeración recién añadido —'traslado'— en
  -- la misma corrida en que se añade, y si fallara aquí se desharía la
  -- migración entera y quedaría dando vueltas. Su historial ya cuenta la
  -- historia: tienen el cambio a 'plataforma' del día que se fueron.
  --
  -- Por lo mismo se compara `estado::text` y no `estado = 'plataforma'`:
  -- si esta misma corrida es la que añade el valor —una base que venía
  -- de una versión más vieja—, nombrarlo aquí sería el mismo error.
  -- Leerlo como texto mira lo que YA tienen las filas y nunca falla.
  update lotes set plataforma_id = plat5, estado = 'facturado'
   where estado::text = 'plataforma';

  perform set_config('app.desde_evento', 'off', true);
end $$;

-- El plano de hoy pasa a ser el plano de Topsoil.
do $$ begin
  if exists (select 1 from information_schema.columns
              where table_name = 'mapa_config' and column_name = 'ancho') then
    execute $q$
      update plataformas p set
        ancho = c.ancho, alto = c.alto, color_fondo = c.color_fondo,
        imagen_url = c.imagen_url, imagen_x = c.imagen_x, imagen_y = c.imagen_y,
        imagen_ancho = c.imagen_ancho, imagen_alto = c.imagen_alto,
        imagen_opacidad = c.imagen_opacidad
      from mapa_config c
       where c.id = 'unico' and p.id = '11111111-0000-4000-8000-000000000001' $q$;
    -- El tamaño y el fondo ya viven en cada plataforma. En mapa_config
    -- se queda solo la paleta, que sí es de toda la empresa.
    execute 'alter table mapa_config drop column ancho, drop column alto,
             drop column color_fondo, drop column imagen_url, drop column imagen_x,
             drop column imagen_y, drop column imagen_ancho, drop column imagen_alto,
             drop column imagen_opacidad';
  end if;
end $$;

-- Las otras cuatro empiezan con el mismo tamaño que Topsoil, para que se
-- puedan usar desde el primer día sin configurar nada.
--
-- Solo se toca una plataforma que sigue TAL COMO NACIÓ: con el tamaño por
-- defecto y sin nada dentro. El tamaño de cada plataforma es suyo, y esta
-- migración se puede correr otra vez: sin este cerrojo, volver a correrla
-- después de que alguien ajustara una plataforma a 1000 × 700 se la
-- pisaría con la medida de Topsoil.
update plataformas p set ancho = t.ancho, alto = t.alto
  from plataformas t
 where t.nombre = 'Topsoil' and p.nombre <> 'Topsoil'
   and p.ancho = 1000 and p.alto = 700
   and not exists (select 1 from lotes        l where l.plataforma_id = p.id)
   and not exists (select 1 from mapa_figuras f where f.plataforma_id = p.id);

-- Ahora sí, obligatorias.
alter table lotes        alter column plataforma_id set not null;
alter table pilas        alter column plataforma_id set not null;
alter table mapa_figuras alter column plataforma_id set not null;

create index if not exists idx_lotes_plataforma on lotes (plataforma_id);
create index if not exists idx_pilas_plataforma on pilas (plataforma_id);

-- El nombre de una pila es único entre las abiertas DE SU PLATAFORMA:
-- puede haber una "pila 1" en Topsoil y otra en Plataforma 5.
drop index if exists ux_pilas_codigo_abierta;
create unique index if not exists ux_pilas_codigo_abierta
  on pilas (plataforma_id, codigo) where estado = 'abierta';

alter table plataformas enable row level security;
alter table puntos_alimentacion enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'plataformas' and policyname = 'p_leer_plataformas') then
    create policy p_leer_plataformas on plataformas for select to authenticated
      using (fn_mi_rol() is not null);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'plataformas' and policyname = 'p_admin_plataformas') then
    create policy p_admin_plataformas on plataformas for all to authenticated
      using (fn_mi_rol() = 'admin') with check (fn_mi_rol() = 'admin');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'puntos_alimentacion' and policyname = 'p_leer_puntos') then
    create policy p_leer_puntos on puntos_alimentacion for select to authenticated
      using (fn_mi_rol() is not null);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'puntos_alimentacion' and policyname = 'p_admin_puntos') then
    create policy p_admin_puntos on puntos_alimentacion for all to authenticated
      using (fn_mi_rol() = 'admin') with check (fn_mi_rol() = 'admin');
  end if;
end $$;

-- PostgREST guarda en caché la forma de las tablas: hay que avisarle
notify pgrst, 'reload schema';

select 'Migración aplicada. Los datos existentes se conservaron.' as resultado;
