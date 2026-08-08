-- =====================================================================
--  MAPA DE ACOPIO  ·  esquema (Postgres / Supabase)
--
--  El mapa es la vista principal: cada lote y cada pila son una figura
--  con posición y forma propias sobre el plano del patio.
--
--  Los EVENTOS siguen siendo la única verdad para estado, pila y
--  observaciones. La posición y la forma se guardan directo en la fila
--  (se mueven muchas veces al día y no aportan al historial legal),
--  pero un trigger impide que un movimiento toque los datos derivados.
--
--  Ejecutar completo en Supabase → SQL Editor.
--  Si ya corriste una versión anterior, primero ejecuta reset.sql.
-- =====================================================================

-- ---------------------------------------------------------------- tipos
create type estado_lote as enum
  ('por_muestrear', 'muestreado', 'remuestreo', 'facturado',
   'devolucion', 'plataforma', 'despachado');

--  granel = material suelto;  bigbag = sacos
create type tipo_material as enum ('granel', 'bigbag');

create type tipo_pila as enum ('alimentacion', 'devolucion', 'espera', 'otro');

create type estado_pila as enum ('abierta', 'cerrada', 'consumida');

create type tipo_evento as enum
  ('recepcion', 'cambio_estado', 'ingreso_pila', 'salida_pila',
   'observacion', 'programar_recogida', 'movimiento', 'renombrado', 'anulacion');

create type forma_figura as enum ('elipse', 'rectangulo', 'poligono');

-- ---------------------------------------------------------------- gente
create table perfiles (
  id        uuid primary key references auth.users (id) on delete cascade,
  nombre    text not null,
  rol       text not null default 'contratista'
            check (rol in ('contratista', 'empresa', 'admin')),
  activo    boolean not null default false,
  creado_en timestamptz not null default now()
);

create or replace function fn_nuevo_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into perfiles (id, nombre, activo)
  values (new.id,
          coalesce(new.raw_user_meta_data ->> 'nombre', split_part(new.email, '@', 1)),
          false);
  return new;
end; $$;

create trigger trg_nuevo_usuario
  after insert on auth.users for each row execute function fn_nuevo_usuario();

create or replace function fn_mi_rol()
returns text language sql stable security definer set search_path = public as $$
  select rol from perfiles where id = auth.uid() and activo;
$$;

-- ------------------------------------------------------------ catálogos
create table proveedores (
  id          uuid primary key default gen_random_uuid(),
  abreviatura text not null unique,
  nombre      text not null,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);

-- --------------------------------------------------------------- pilas
--  x, y = centro sobre el plano;  rx, ry = semiejes;  rot = grados
create table pilas (
  id             uuid primary key,
  -- único solo entre las ABIERTAS, ver el índice más abajo: una pila
  -- archivada suelta su nombre para que se pueda volver a usar
  codigo         text not null,
  tipo           tipo_pila not null default 'otro',
  estado         estado_pila not null default 'abierta',
  nota           text,
  forma          forma_figura not null default 'elipse',
  puntos         jsonb,                       -- vértices si forma = 'poligono'
  x              numeric not null default 500,
  y              numeric not null default 350,
  rx             numeric not null default 90,
  ry             numeric not null default 60,
  rot            numeric not null default 0,
  creado_por     uuid references perfiles (id),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- El nombre no puede repetirse ENTRE LAS ABIERTAS, que es donde importa:
-- en el plano nunca hay dos pilas que se llamen igual. Una pila
-- archivada suelta el suyo y el número se vuelve a usar; si no, la
-- numeración sube para siempre y con tres pilas en el patio ya se va por
-- la 4. El historial no se enreda porque cada apunte guarda el id, no el
-- nombre, y en la ficha del lote cada línea va con su fecha.
create unique index ux_pilas_codigo_abierta on pilas (codigo) where estado = 'abierta';

-- --------------------------------------------------------------- lotes
create table lotes (
  id               uuid primary key,
  codigo           text not null unique,
  proveedor_id     uuid not null references proveedores (id),
  fecha_recepcion  date not null default current_date,
  placa            text not null,             -- placa de la volqueta que lo trajo
  material         tipo_material not null default 'granel',
  -- figura sobre el mapa
  forma            forma_figura not null default 'elipse',
  puntos           jsonb,
  x                numeric not null default 500,
  y                numeric not null default 350,
  -- el granel es redondo; el bigbag lo estira la app al crearlo
  rx               numeric not null default 40,
  ry               numeric not null default 40,
  rot              numeric not null default 0,
  -- derivados del log de eventos (protegidos por trigger)
  estado           estado_lote not null default 'por_muestrear',
  estado_desde     timestamptz not null default now(),
  fecha_recogida   date,
  pila_id          uuid references pilas (id),
  ultimo_evento_en timestamptz not null default now(),
  creado_por       uuid references perfiles (id),
  creado_en        timestamptz not null default now(),
  -- para que la app baje solo lo que cambió; lo pone el servidor
  actualizado_en   timestamptz not null default now()
);

create index idx_lotes_estado      on lotes (estado);
create index idx_lotes_pila        on lotes (pila_id);
create index idx_lotes_placa       on lotes (placa);
create index idx_lotes_actualizado on lotes (actualizado_en);
create index idx_pilas_actualizado on pilas (actualizado_en);

-- La marca la escribe el servidor, no el cliente. Se llama así para que
-- corra ANTES que trg_proteger_derivados: los disparadores de un mismo
-- momento van en orden alfabético, y el de protección no toca esta
-- columna, así que la marca sobrevive.
create or replace function fn_marcar_actualizado()
returns trigger language plpgsql as $$
begin
  new.actualizado_en := now();
  return new;
end; $$;

create trigger trg_marcar_actualizado before insert or update on lotes
  for each row execute function fn_marcar_actualizado();
create trigger trg_marcar_actualizado before insert or update on pilas
  for each row execute function fn_marcar_actualizado();

-- -------------------------------------------------------------- eventos
create table eventos (
  id             uuid primary key,
  lote_id        uuid not null references lotes (id) on delete restrict,
  tipo           tipo_evento not null,
  estado_nuevo   estado_lote,
  pila_id        uuid references pilas (id),
  fecha_recogida date,
  x              numeric,
  y              numeric,
  nota           text,
  usuario_id     uuid references perfiles (id),
  ocurrido_en    timestamptz not null,
  registrado_en  timestamptz not null default now(),
  constraint ck_estado_requerido
    check (tipo <> 'cambio_estado' or estado_nuevo is not null),
  constraint ck_pila_requerida
    check (tipo <> 'ingreso_pila' or pila_id is not null),
  constraint ck_recogida_requerida
    check (tipo <> 'programar_recogida' or fecha_recogida is not null)
);

create index idx_eventos_lote on eventos (lote_id, ocurrido_en desc);
create index idx_eventos_pila on eventos (pila_id, ocurrido_en desc);

-- Aplica el evento sobre el lote. Marca la sesión para que el trigger
-- protector permita escribir las columnas derivadas.
create or replace function fn_aplicar_evento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.desde_evento', 'on', true);

  if new.tipo = 'cambio_estado' then
    update lotes set estado = new.estado_nuevo,
                     estado_desde = new.ocurrido_en,
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

create trigger trg_aplicar_evento
  after insert on eventos for each row execute function fn_aplicar_evento();

-- Mover o reformar un lote NUNCA puede alterar su estado ni su pila.
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
    new.creado_en      := old.creado_en;
    new.creado_por     := old.creado_por;
  end if;
  return new;
end; $$;

create trigger trg_proteger_derivados
  before update on lotes for each row execute function fn_proteger_derivados();

create or replace function fn_evento_recepcion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into eventos (id, lote_id, tipo, estado_nuevo, usuario_id, ocurrido_en)
  values (gen_random_uuid(), new.id, 'recepcion', new.estado, new.creado_por, new.creado_en);
  return new;
end; $$;

create trigger trg_evento_recepcion
  after insert on lotes for each row execute function fn_evento_recepcion();

-- -------------------------------------------------------------- tareas
--  Encargos del admin a los contratistas.
--
--  Las ven TODOS los contratistas aunque el admin diga a quién va
--  dirigida: en el patio se cubren entre ellos, y esconderle un encargo a
--  quien está al lado no ayuda a nadie. `asignado_a` es una etiqueta de
--  "esto le toca a fulano", no un permiso.
--
--  Una tarea no se borra al completarla: se marca. Es lo que da la
--  trazabilidad de quién la hizo y cuándo.
create type prioridad_tarea as enum ('urgente', 'alta', 'media', 'baja');

create table tareas (
  id             uuid primary key,
  titulo         text not null,
  detalle        text,
  prioridad      prioridad_tarea not null default 'media',
  asignado_a     uuid references perfiles (id),          -- null = cualquiera
  -- el encargo puede apuntar a un lote o a una pila, para poder saltar
  -- ahí desde la tarea. Si el lote se borra, la tarea se queda sin él
  -- pero no desaparece.
  lote_id        uuid references lotes (id) on delete set null,
  pila_id        uuid references pilas (id) on delete set null,
  creado_por     uuid references perfiles (id),
  creado_en      timestamptz not null default now(),
  completado_en  timestamptz,
  completado_por uuid references perfiles (id),
  nota_cierre    text,
  actualizado_en timestamptz not null default now()
);

create index idx_tareas_pendientes on tareas (completado_en, prioridad);

create trigger trg_marcar_actualizado before insert or update on tareas
  for each row execute function fn_marcar_actualizado();

--  Un contratista SOLO puede cerrar una tarea abierta. No puede cambiarle
--  el texto, ni la prioridad, ni a quién va, ni reabrirla.
create or replace function fn_proteger_tarea()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if fn_mi_rol() is distinct from 'admin' then
    -- Ya la cerró alguien: se deja como está y no se falla. Dos personas
    -- pueden darle a "completado" a la vez, o sin señal, y la segunda
    -- subida no puede quedarse trabada en la cola para siempre.
    if old.completado_en is not null then return old; end if;
    new.titulo     := old.titulo;      new.detalle    := old.detalle;
    new.prioridad  := old.prioridad;   new.asignado_a := old.asignado_a;
    new.lote_id    := old.lote_id;     new.pila_id    := old.pila_id;
    new.creado_por := old.creado_por;  new.creado_en  := old.creado_en;
    new.completado_por := auth.uid();
    if new.completado_en is null then new.completado_en := now(); end if;
  end if;
  return new;
end; $$;

create trigger trg_proteger_tarea before update on tareas
  for each row execute function fn_proteger_tarea();

-- ------------------------------------------------------- fondo del mapa
--  Solo el admin lo edita. Figuras para dibujar caseta, vías, límites.
create table mapa_figuras (
  id        uuid primary key,
  forma     forma_figura not null default 'rectangulo',
  puntos    jsonb,
  etiqueta  text,
  x         numeric not null,
  y         numeric not null,
  rx        numeric not null default 80,
  ry        numeric not null default 50,
  rot       numeric not null default 0,
  color     text not null default '#c7cdc5',
  orden     int not null default 0
);

--  Una sola fila, id = 'unico'
create table mapa_config (
  id           text primary key default 'unico' check (id = 'unico'),
  ancho        numeric not null default 1000,
  alto         numeric not null default 700,
  color_fondo  text not null default '#e4e7e2',
  imagen_url   text,
  imagen_x     numeric not null default 0,
  imagen_y     numeric not null default 0,
  imagen_ancho numeric not null default 1000,
  imagen_alto  numeric not null default 700,
  imagen_opacidad numeric not null default 1,
  -- colores editables desde la app, sin tocar el código
  colores      jsonb not null default '{
    "por_muestrear": "#d99a06",
    "muestreado":    "#e8b48a",
    "remuestreo":    "#8a5cd6",
    "facturado":     "#2b5ca8",
    "devolucion":    "#b8352a",
    "plataforma":    "#0f6d78",
    "despachado":    "#5f6863",
    "pila_alimentacion": "#1f7a54",
    "pila_devolucion":   "#b8352a",
    "pila_espera":       "#d99a06",
    "pila_otro":         "#14171a"
  }'::jsonb
);

insert into mapa_config (id) values ('unico');

-- --------------------------------------------------------------- vistas
create view v_pila_composicion with (security_invoker = true) as
select pi.id as pila_id, pi.codigo as pila, pi.tipo, pi.estado as pila_estado,
       count(l.id) as lotes,
       array_agg(l.codigo order by l.codigo) filter (where l.id is not null) as lotes_codigos
  from pilas pi
  left join lotes l on l.pila_id = pi.id
 group by pi.id, pi.codigo, pi.tipo, pi.estado;

create view v_lote_historial with (security_invoker = true) as
select e.lote_id, l.codigo as lote, e.ocurrido_en, e.tipo, e.estado_nuevo,
       pi.codigo as pila, e.fecha_recogida, e.nota, pe.nombre as usuario, e.registrado_en
  from eventos e
  join lotes l on l.id = e.lote_id
  left join pilas pi on pi.id = e.pila_id
  left join perfiles pe on pe.id = e.usuario_id;

-- ------------------------------------------------------------ seguridad
alter table perfiles     enable row level security;
alter table proveedores  enable row level security;
alter table pilas        enable row level security;
alter table lotes        enable row level security;
alter table eventos      enable row level security;
alter table mapa_figuras enable row level security;
alter table mapa_config  enable row level security;
alter table tareas       enable row level security;

-- Lectura: solo perfiles activos
create policy p_leer_perfiles    on perfiles     for select to authenticated using (fn_mi_rol() is not null);
create policy p_leer_proveedores on proveedores  for select to authenticated using (fn_mi_rol() is not null);
create policy p_leer_pilas       on pilas        for select to authenticated using (fn_mi_rol() is not null);
create policy p_leer_lotes       on lotes        for select to authenticated using (fn_mi_rol() is not null);
create policy p_leer_eventos     on eventos      for select to authenticated using (fn_mi_rol() is not null);
create policy p_leer_figuras     on mapa_figuras for select to authenticated using (fn_mi_rol() is not null);
create policy p_leer_config      on mapa_config  for select to authenticated using (fn_mi_rol() is not null);
create policy p_leer_tareas      on tareas       for select to authenticated using (fn_mi_rol() is not null);

-- Escritura de operación
create policy p_crear_lotes on lotes for insert to authenticated
  with check (fn_mi_rol() in ('contratista', 'admin'));
create policy p_mover_lotes on lotes for update to authenticated
  using (fn_mi_rol() in ('contratista', 'admin'))
  with check (fn_mi_rol() in ('contratista', 'admin'));

create policy p_crear_pilas on pilas for insert to authenticated
  with check (fn_mi_rol() in ('contratista', 'admin'));
create policy p_mover_pilas on pilas for update to authenticated
  using (fn_mi_rol() in ('contratista', 'admin'))
  with check (fn_mi_rol() in ('contratista', 'admin'));

create policy p_crear_eventos on eventos for insert to authenticated
  with check (fn_mi_rol() in ('contratista', 'admin') and usuario_id = auth.uid());

-- Las tareas las escribe el admin. El contratista puede tocar la fila
-- —para completarla— y el disparador de arriba decide qué le deja cambiar.
create policy p_crear_tareas on tareas for insert to authenticated
  with check (fn_mi_rol() = 'admin');
create policy p_cerrar_tareas on tareas for update to authenticated
  using (fn_mi_rol() is not null) with check (fn_mi_rol() is not null);
create policy p_borrar_tareas on tareas for delete to authenticated
  using (fn_mi_rol() = 'admin');

-- El fondo del mapa y los proveedores: solo admin
create policy p_admin_figuras on mapa_figuras for all to authenticated
  using (fn_mi_rol() = 'admin') with check (fn_mi_rol() = 'admin');
create policy p_admin_config on mapa_config for update to authenticated
  using (fn_mi_rol() = 'admin') with check (fn_mi_rol() = 'admin');
--  la app guarda con upsert, que es un INSERT: sin esta política el
--  servidor rechaza los colores y el fondo
create policy p_admin_config_ins on mapa_config for insert to authenticated
  with check (fn_mi_rol() = 'admin');
create policy p_admin_proveedores on proveedores for all to authenticated
  using (fn_mi_rol() = 'admin') with check (fn_mi_rol() = 'admin');

revoke update, delete on eventos from authenticated, anon;
revoke delete on lotes from authenticated, anon;

-- ------------------------------------------- imagen de fondo (Storage)
insert into storage.buckets (id, name, public)
values ('mapa', 'mapa', true)
on conflict (id) do nothing;

create policy p_mapa_ver on storage.objects for select
  using (bucket_id = 'mapa');
create policy p_mapa_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'mapa' and fn_mi_rol() = 'admin');
create policy p_mapa_reemplazar on storage.objects for update to authenticated
  using (bucket_id = 'mapa' and fn_mi_rol() = 'admin');
create policy p_mapa_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'mapa' and fn_mi_rol() = 'admin');

-- ------------------------------------------------------------ arranque
insert into proveedores (abreviatura, nombre) values
  ('ABG', 'Abigail'),
  ('AND', 'Minerales Andinos'),
  ('ARC', 'Arcoiris'),
  ('CM',  'El Caimo'),
  ('MLA', 'Malasia'),
  ('PG',  'Palladium'),
  ('PL',  'Polanco'),
  ('SJ',  'San Judas'),
  ('SM',  'San Miguel'),
  ('SRG', 'San Roque Gold'),
  ('STM', 'Santa María')
on conflict (abreviatura) do update set nombre = excluded.nombre;
