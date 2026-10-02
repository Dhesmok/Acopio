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
--  'plataforma' ya no se usa: Plataforma 5 dejó de ser un estado y pasó
--  a ser un sitio más, con su propio plano. Se deja en la lista porque
--  los lotes viejos lo tienen escrito en su historial y los eventos no
--  se tocan nunca.
--
--  'alimentado' es el final del camino en planta: el lote se consumió y
--  deja de verse en el plano, pero no se borra. Por dónde entró —Batch,
--  Tolva Naranja, Reempaque…— va aparte, en `puntos_alimentacion`,
--  porque esa lista la maneja el administrador y va a crecer.
create type estado_lote as enum
  ('por_muestrear', 'muestreado', 'remuestreo', 'facturado',
   'devolucion', 'plataforma', 'despachado', 'alimentado');

--  granel = material suelto;  bigbag = sacos
create type tipo_material as enum ('granel', 'bigbag');

create type tipo_pila as enum ('alimentacion', 'devolucion', 'espera', 'otro');

create type estado_pila as enum ('abierta', 'cerrada', 'consumida');

--  'entrega_laboratorio': la muestra de ese lote salió para el
--  laboratorio. No cambia el estado del lote ni nada suyo —el lote sigue
--  donde estaba, haciendo lo que hacía—, solo tacha ese muestreo de la
--  lista del administrador. Va como evento y no como columna porque
--  puede pasar varias veces: si un lote se remuestrea, hay otra muestra
--  que llevar, y las dos entregas tienen que quedar apuntadas con su
--  fecha y su nombre.
create type tipo_evento as enum
  ('recepcion', 'cambio_estado', 'ingreso_pila', 'salida_pila',
   'observacion', 'programar_recogida', 'movimiento', 'renombrado', 'anulacion',
   'traslado', 'entrega_laboratorio');

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

-- --------------------------------------------------------- plataformas
--  El patio no es uno: son cinco sitios distintos —Topsoil, Plataforma 2,
--  Plataforma 3, Ye, Plataforma 5— y un lote se mueve entre ellos. Cada
--  uno tiene su propio plano, con su tamaño, su fondo y sus figuras.
--
--  Los proveedores, los códigos de lote y la gente son los mismos para
--  todas: es la misma empresa. Lo único que cambia es dónde está cada
--  montón.
create table plataformas (
  id              uuid primary key,
  nombre          text not null unique,
  orden           int not null default 0,       -- en qué orden se enseñan
  activa          boolean not null default true,
  -- el plano de esta plataforma
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

-- Por dónde entró el material a la planta. Es una lista que crece —de
-- Batch y Tolva Naranja salió Reempaque en la misma conversación—, así
-- que la maneja el administrador desde la app y no el código.
create table puntos_alimentacion (
  id             uuid primary key,
  nombre         text not null unique,
  orden          int not null default 0,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- --------------------------------------------------------------- pilas
--  x, y = centro sobre el plano;  rx, ry = semiejes;  rot = grados
create table pilas (
  id             uuid primary key,
  plataforma_id  uuid not null references plataformas (id),
  -- único entre las ABIERTAS DE SU PLATAFORMA, ver el índice más abajo
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

-- El nombre no puede repetirse entre las ABIERTAS DE UNA MISMA
-- PLATAFORMA, que es donde importa: en un plano nunca hay dos pilas que
-- se llamen igual. Puede haber una "pila 1" en Topsoil y otra "pila 1"
-- en Plataforma 5, que son planos distintos y nadie las confunde.
--
-- Una pila archivada suelta su nombre y el número se vuelve a usar; si
-- no, la numeración sube para siempre y con tres pilas en el patio ya se
-- va por la 4. El historial no se enreda porque cada apunte guarda el
-- id, no el nombre, y en la ficha del lote cada línea va con su fecha.
create unique index ux_pilas_codigo_abierta on pilas (plataforma_id, codigo)
  where estado = 'abierta';

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
  --
  -- La plataforma es DERIVADA, como el estado y la pila: un lote se pasa
  -- de sitio con un evento 'traslado', no escribiendo la columna. Así el
  -- historial dice cuándo se movió y quién lo movió, que es justo lo que
  -- se pide para la trazabilidad.
  plataforma_id    uuid not null references plataformas (id),
  -- por dónde se alimentó, cuando el estado es 'alimentado'
  punto_id         uuid references puntos_alimentacion (id),
  alimentado_en    timestamptz,
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
  -- a qué plataforma se llevó, en los eventos de tipo 'traslado'
  plataforma_id  uuid references plataformas (id),
  -- por dónde entró a planta, al pasar a 'alimentado'
  punto_id       uuid references puntos_alimentacion (id),
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
  constraint ck_plataforma_requerida
    check (tipo <> 'traslado' or plataforma_id is not null),
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

-- ALIMENTAR ES DEL ADMIN. La pantalla ya solo le enseña el botón a él,
-- pero eso no basta: con la clave publicable y una cuenta activa,
-- cualquiera puede llamar a la API directamente. Este es el cerrojo de
-- abajo. Cubre las dos puertas: el cambio de estado y crear un lote que
-- ya nazca alimentado.
--
-- Sin `auth.uid()` no hay usuario de la app: es el editor SQL o una
-- migración, y eso lo corre el dueño de la base. No se le cierra.
create or replace function fn_solo_admin_alimenta()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  alimenta boolean;
begin
  if auth.uid() is null or fn_mi_rol() = 'admin' then return new; end if;
  -- Separado por tabla: PL/pgSQL no deja ni nombrar `new.tipo` en lotes.
  if tg_table_name = 'eventos' then
    alimenta := new.tipo = 'cambio_estado' and new.estado_nuevo = 'alimentado';
  else
    alimenta := new.estado = 'alimentado';
  end if;
  if alimenta then
    raise exception 'Solo el administrador puede pasar lotes a alimentado'
      using errcode = '42501';
  end if;
  return new;
end; $$;

create trigger trg_solo_admin_alimenta_evento
  before insert on eventos for each row execute function fn_solo_admin_alimenta();
create trigger trg_solo_admin_alimenta_lote
  before insert on lotes for each row execute function fn_solo_admin_alimenta();

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
  -- El encargo puede apuntar a VARIOS lotes y pilas, para poder saltar a
  -- ellos desde la tarea: "acomodar estos cuatro" es un solo encargo.
  --
  -- Van como listas de ids y SIN llave foránea a propósito. Una llave no
  -- se puede poner sobre los elementos de una lista, y tampoco hace
  -- falta: si un lote se borra, su id se queda ahí colgando y la app
  -- simplemente no lo encuentra y no lo enseña. Perder el botón de
  -- "ver en el mapa" de un lote borrado no le hace daño a nadie.
  lotes_ids      uuid[] not null default '{}',
  pilas_ids      uuid[] not null default '{}',
  creado_por     uuid references perfiles (id),
  creado_en      timestamptz not null default now(),
  completado_en  timestamptz,
  completado_por uuid references perfiles (id),
  nota_cierre    text,
  -- Lo que paga completarla. Lo pone el admin al crearla, de 0 a 15: un
  -- tope, y no un número libre, porque quien fija el premio es también
  -- quien podría regalarlo. Cambiar el tope es cambiar esta línea.
  monedas        int not null default 0 check (monedas between 0 and 15),
  actualizado_en timestamptz not null default now(),
  -- Un admin no se manda tareas a sí mismo. Es la regla que se pidió, y
  -- va aquí y no en la pantalla: quien reparte el premio no puede ser el
  -- que se lo lleva.
  constraint tarea_no_autoasignada check (asignado_a is null or asignado_a <> creado_por)
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
    -- Y no puede subirse el premio al cerrarla.
    new.monedas    := old.monedas;
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
--  Lo que es igual en TODAS las plataformas. El tamaño del plano, el
--  fondo y la imagen se mudaron a `plataformas`: cada una tiene el suyo.
--  Aquí solo queda la paleta, que es de la empresa, no de un patio.
create table mapa_config (
  id           text primary key default 'unico' check (id = 'unico'),
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

-- ------------------------------------------------------------- tienda
--  En qué se gastan las monedas. El admin pone los productos con su
--  precio y su foto; los demás canjean.
--
--  El canje CONGELA el nombre y el precio del momento. Si mañana el
--  admin sube el precio o retira el producto, lo ya pedido no cambia:
--  un recibo que se reescribe solo no es un recibo.
create table productos (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null,
  detalle        text,
  precio         int not null check (precio > 0),
  imagen_url     text,
  -- null = sin límite. Un número = quedan tantas unidades.
  existencias    int check (existencias is null or existencias >= 0),
  activo         boolean not null default true,
  orden          int not null default 0,
  creado_por     uuid references perfiles (id),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table canjes (
  id           uuid primary key default gen_random_uuid(),
  producto_id  uuid not null references productos (id) on delete restrict,
  usuario_id   uuid not null references perfiles (id),
  precio       int  not null check (precio > 0),   -- congelado
  nombre       text not null,                      -- congelado
  estado       text not null default 'pedido'
               check (estado in ('pedido', 'entregado', 'anulado')),
  nota         text,
  pedido_en    timestamptz not null default now(),
  resuelto_en  timestamptz,
  resuelto_por uuid references perfiles (id)
);

create index idx_canjes_usuario on canjes (usuario_id, pedido_en desc);

create trigger trg_marcar_producto before insert or update on productos
  for each row execute function fn_marcar_actualizado();

-- Quién y cuándo resolvió un canje lo pone el servidor, no el cliente.
create or replace function fn_marcar_canje()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado is distinct from old.estado and new.estado <> 'pedido' then
    new.resuelto_en  := now();
    new.resuelto_por := auth.uid();
  end if;
  -- lo congelado no se retoca nunca
  new.producto_id := old.producto_id;  new.usuario_id := old.usuario_id;
  new.precio      := old.precio;       new.nombre     := old.nombre;
  new.pedido_en   := old.pedido_en;
  return new;
end; $$;

create trigger trg_marcar_canje before update on canjes
  for each row execute function fn_marcar_canje();

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

-- ------------------------------------------------------------- monedas
--  El saldo NO se guarda: se calcula desde los eventos que ya existen.
--
--  Es la decisión que sostiene todo lo demás. Un contador que la app
--  suma se rompe solo —dos celulares sin señal sumarían por separado y
--  darían saldos distintos— y además se puede tocar. Calculado desde los
--  eventos, cada moneda apunta a un hecho con autor, lote y hora, nadie
--  puede inventarse un saldo, y el día que se estrene todos arrancan con
--  lo que ya trabajaron en vez de con cero.
--
--  Cambiar cuánto paga cada cosa es cambiar la tabla `tarifa` de aquí
--  abajo: todos los saldos se recalculan solos, sin migrar nada.
--
--  LA REGLA: cada hecho paga UNA sola vez por lote. Eso es lo que hace
--  que no haga falta ningún castigo. Deshacer y rehacer —sacar de la
--  pila y volver a meter, mandar el lote y traerlo— no da nada, porque
--  solo cuenta la primera vez. Y da igual mover una pila de diez lotes
--  que moverlos de uno en uno: paga lo mismo, así que no hay forma de
--  ganar más trabajando peor.
--  EL CERROJO: un lote que entra y sale el mismo rato no paga NADA.
--
--  Sin esto, crear un lote y despacharlo son dos toques y cinco monedas
--  sin que entre un gramo de material al patio.
--
--  La regla sale de mirar el patio de verdad. Los lotes inventados que
--  ya hay en la base —placas "AAAA", "QQQQQ", códigos de prueba— tienen
--  todos lo mismo: entraron y salieron en el MISMO MINUTO. Los lotes de
--  verdad se quedan días: el más corto que existe estuvo 78 horas. Entre
--  los dos grupos no hay ni un caso a medias, así que un corte en dos
--  horas deja fuera todos los inventados y ni uno solo de los reales.
--
--  Se probó antes con "no paga hasta que lo muestren" y se descartó: 55
--  de los 302 lotes del patio no tienen apuntado el muestreo, y esos son
--  trabajo de verdad que se habría quedado sin pagar.
--
--  Tampoco es magia: quien esté dispuesto a mentir puede crear el lote,
--  esperar dos horas y despacharlo. Pero ya no es un descuido de dos
--  toques, y el lote se queda esas dos horas dibujado en el plano donde
--  lo ve todo el mundo. Para lo que quede, está `v_lotes_dudosos`.
create view v_monedas with (security_invoker = true) as
with fugaces as (
  select l.id as lote_id
    from lotes l
   where (select min(e.ocurrido_en) from eventos e
           where e.lote_id = l.id and e.tipo = 'cambio_estado'
             and e.estado_nuevo in ('despachado', 'alimentado'))
       - (select min(e.ocurrido_en) from eventos e
           where e.lote_id = l.id and e.tipo = 'recepcion')
         < interval '2 hours'
),
hechos as (
  select e.id, e.usuario_id, e.lote_id, e.ocurrido_en,
         case
           when e.tipo = 'recepcion'                                     then 'registrar'
           when e.tipo = 'cambio_estado' and e.estado_nuevo = 'muestreado' then 'muestrear'
           when e.tipo = 'cambio_estado' and e.estado_nuevo = 'despachado' then 'despachar'
           when e.tipo = 'ingreso_pila'                                  then 'apilar'
           when e.tipo = 'traslado'                                      then 'trasladar'
         end as clase
    from eventos e
   where e.usuario_id is not null
     -- un lote que sigue en el patio no es fugaz: la resta da nulo y
     -- `nulo < intervalo` no es cierto, así que no entra en la lista
     and not exists (select 1 from fugaces f where f.lote_id = e.lote_id)
),
-- La primera vez de cada lote para cada concepto, y solo esa.
primeros as (
  select distinct on (lote_id, clase) id, usuario_id, lote_id, ocurrido_en, clase
    from hechos
   where clase is not null
   order by lote_id, clase, ocurrido_en
),
tarifa (clase, monedas) as (values
  ('registrar', 3), ('muestrear', 1), ('apilar', 1), ('trasladar', 1), ('despachar', 2)
)
select p.id as origen, p.usuario_id, p.lote_id, null::uuid as tarea_id,
       t.monedas, p.clase as motivo, p.ocurrido_en
  from primeros p join tarifa t on t.clase = p.clase
union all
--  Las tareas pagan lo que diga el admin al crearlas.
--
--  Nunca a quien la creó, aunque la haya dejado para "cualquiera". Sin
--  esto, la regla de no auto-asignarse se saltaría sola: basta con crear
--  una tarea sin dueño y cerrarla uno mismo.
select t.id, t.completado_por, null::uuid, t.id,
       t.monedas, 'tarea', t.completado_en
  from tareas t
 where t.completado_en is not null
   and t.completado_por is not null
   and t.monedas > 0
   and t.completado_por is distinct from t.creado_por;

--  Lo que lleva cada uno: lo GANADO menos lo GASTADO en la tienda.
--
--  Los canjes los ve todo el mundo, igual que el historial de monedas:
--  en un equipo de diez, que cada uno pueda comprobar la cuenta del
--  otro vale más que cualquier candado. Si solo se vieran los propios,
--  además, el saldo ajeno saldría inflado.
create view v_saldos with (security_invoker = true) as
with ganado as (
  select usuario_id, sum(monedas) as monedas from v_monedas group by usuario_id
),
gastado as (
  select usuario_id, sum(precio) as monedas from canjes
   where estado <> 'anulado' group by usuario_id
)
select pe.id as usuario_id, pe.nombre, pe.rol,
       coalesce(g.monedas, 0) - coalesce(c.monedas, 0) as monedas,
       coalesce(g.monedas, 0) as ganado,
       coalesce(c.monedas, 0) as gastado
  from perfiles pe
  left join ganado  g on g.usuario_id = pe.id
  left join gastado c on c.usuario_id = pe.id
 where pe.activo;

--  La clasificación se reinicia cada mes: una tabla histórica se congela
--  —gana siempre el que empezó primero— y el que entra nuevo ni lo
--  intenta. El mes es el de Colombia, no el del servidor, que va en UTC
--  y cambiaría de mes a las siete de la tarde del día 31.
--  Salen TODOS los activos, también los que llevan cero.
--
--  Antes solo aparecía quien hubiera ganado algo, y eso deja fuera
--  justo a quien más falta le hace verse: el que empieza el mes en
--  blanco, o el de rol "empresa", que no trabaja el patio y solo gana
--  por tareas sueltas. Una tabla de la que desapareces cuando no has
--  hecho nada no invita a hacer nada.
--
--  El mes es el de Colombia, no el del servidor, que va en UTC y
--  cambiaría de mes a las siete de la tarde del día 31.
create view v_clasificacion with (security_invoker = true) as
with meses as (
  select distinct to_char(ocurrido_en at time zone 'America/Bogota', 'YYYY-MM') as mes
    from v_monedas
  union
  select to_char(now() at time zone 'America/Bogota', 'YYYY-MM')
)
select pe.id as usuario_id, pe.nombre, pe.rol, x.mes,
       coalesce(sum(m.monedas), 0) as monedas,
       count(m.origen) as hechos
  from perfiles pe
 cross join meses x
  left join v_monedas m
         on m.usuario_id = pe.id
        and to_char(m.ocurrido_en at time zone 'America/Bogota', 'YYYY-MM') = x.mes
 where pe.activo
 group by pe.id, pe.nombre, pe.rol, x.mes;

--  CANJEAR ES DEL SERVIDOR, no del celular.
--
--  Todo lo demás de esta app se guarda primero en el teléfono y sube
--  cuando hay señal. Esto no puede: sin señal dos canjes seguidos
--  gastarían el mismo saldo dos veces y el descubierto aparecería
--  después, cuando ya se llevaron el producto. Aquí se comprueba el
--  saldo y se descuenta en la misma transacción, o no se canjea.
--
--  El `pg_advisory_xact_lock` es por si la misma persona toca "Canjear"
--  en dos productos a la vez desde dos pestañas: sin él, las dos
--  consultas leen el mismo saldo y pasan las dos. Con él, la segunda
--  espera a que la primera termine y ya ve el saldo descontado.
create or replace function fn_canjear(p_producto uuid)
returns canjes language plpgsql security definer set search_path = public as $$
declare
  yo    uuid := auth.uid();
  pr    productos;
  saldo int;
  nuevo canjes;
begin
  if fn_mi_rol() is null then
    raise exception 'Tu cuenta no está activa.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(yo::text, 0));

  select * into pr from productos where id = p_producto for update;
  if not found or not pr.activo then
    raise exception 'Ese producto ya no está en la tienda.';
  end if;
  if pr.existencias is not null and pr.existencias <= 0 then
    raise exception 'Se agotó: no quedan unidades de %.', pr.nombre;
  end if;

  select monedas into saldo from v_saldos where usuario_id = yo;
  if coalesce(saldo, 0) < pr.precio then
    raise exception 'Te faltan % monedas para %.',
      pr.precio - coalesce(saldo, 0), pr.nombre;
  end if;

  insert into canjes (producto_id, usuario_id, precio, nombre)
       values (pr.id, yo, pr.precio, pr.nombre)
    returning * into nuevo;

  if pr.existencias is not null then
    update productos set existencias = existencias - 1 where id = pr.id;
  end if;
  return nuevo;
end; $$;

--  LOTES QUE CONVIENE MIRAR.
--
--  Ninguna cuenta sabe si un lote existió: eso solo lo sabe quien estuvo
--  en la báscula. Lo que sí se puede hacer es poner delante del admin
--  los pocos lotes cuya vida en el patio no tiene sentido, y que él
--  pregunte. Son dos casos:
--
--   · Entró y salió en menos de dos horas. Es el que ya no paga monedas
--     por el cerrojo de arriba, pero el lote sigue ahí, contando en el
--     informe como si hubiera existido, y eso hay que verlo.
--   · Salió del patio sin que nadie apuntara el muestreo. Esto no es
--     trampa —hay ocho lotes reales así, alimentados directo desde la
--     pila—, es un hueco de trazabilidad: material que se fue sin pasar
--     por el laboratorio, o que pasó y no se registró.
--
--  Solo la ve el admin.
create view v_lotes_dudosos with (security_invoker = true) as
with vida as (
  select l.id, l.codigo, l.placa, l.estado,
         (select e.usuario_id from eventos e
           where e.lote_id = l.id and e.tipo = 'recepcion'
           order by e.ocurrido_en limit 1) as registro,
         (select min(e.ocurrido_en) from eventos e
           where e.lote_id = l.id and e.tipo = 'recepcion') as entro,
         (select e.usuario_id from eventos e
           where e.lote_id = l.id and e.tipo = 'cambio_estado'
             and e.estado_nuevo in ('despachado', 'alimentado')
           order by e.ocurrido_en limit 1) as salida,
         (select min(e.ocurrido_en) from eventos e
           where e.lote_id = l.id and e.tipo = 'cambio_estado'
             and e.estado_nuevo in ('despachado', 'alimentado')) as salio,
         exists (select 1 from eventos e
                  where e.lote_id = l.id and e.tipo = 'cambio_estado'
                    and e.estado_nuevo = 'muestreado') as muestreado,
         (select count(distinct e.usuario_id) from eventos e
           where e.lote_id = l.id and e.usuario_id is not null) as manos
    from lotes l
)
select v.id, v.codigo, v.placa, v.estado, v.registro, v.salida,
       v.entro, v.salio, v.muestreado, v.manos,
       round(extract(epoch from (v.salio - v.entro)) / 3600.0, 1) as horas,
       (v.salio - v.entro < interval '2 hours') as fugaz,
       case when v.salio - v.entro < interval '2 hours'
              then 'entró y salió del patio el mismo rato'
            else 'salió sin que nadie apuntara el muestreo'
       end as motivo
  from vida v
 where v.salio is not null
   and fn_mi_rol() = 'admin'
   and (not v.muestreado or v.salio - v.entro < interval '2 hours');

-- ------------------------------------------------------------ seguridad
alter table perfiles     enable row level security;
alter table proveedores  enable row level security;
alter table pilas        enable row level security;
alter table lotes        enable row level security;
alter table eventos      enable row level security;
alter table mapa_figuras enable row level security;
alter table mapa_config  enable row level security;
alter table tareas       enable row level security;
alter table plataformas  enable row level security;
alter table puntos_alimentacion enable row level security;

-- Lectura: solo perfiles activos
create policy p_leer_perfiles    on perfiles     for select to authenticated using (fn_mi_rol() is not null);
create policy p_leer_proveedores on proveedores  for select to authenticated using (fn_mi_rol() is not null);
create policy p_leer_pilas       on pilas        for select to authenticated using (fn_mi_rol() is not null);
create policy p_leer_lotes       on lotes        for select to authenticated using (fn_mi_rol() is not null);
create policy p_leer_eventos     on eventos      for select to authenticated using (fn_mi_rol() is not null);
create policy p_leer_figuras     on mapa_figuras for select to authenticated using (fn_mi_rol() is not null);
create policy p_leer_config      on mapa_config  for select to authenticated using (fn_mi_rol() is not null);
create policy p_leer_tareas      on tareas       for select to authenticated using (fn_mi_rol() is not null);
create policy p_leer_plataformas on plataformas  for select to authenticated using (fn_mi_rol() is not null);
create policy p_leer_puntos      on puntos_alimentacion for select to authenticated using (fn_mi_rol() is not null);

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

-- Las plataformas y los puntos de alimentación los define el admin. Un
-- contratista los lee para trabajar, pero no los crea ni los cambia.
create policy p_admin_plataformas on plataformas for all to authenticated
  using (fn_mi_rol() = 'admin') with check (fn_mi_rol() = 'admin');
create policy p_admin_puntos on puntos_alimentacion for all to authenticated
  using (fn_mi_rol() = 'admin') with check (fn_mi_rol() = 'admin');

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

-- La tienda: el catálogo lo maneja el admin; los canjes los ve todo el
-- mundo —igual que el historial de monedas— y NADIE los inserta a mano.
-- La única puerta es fn_canjear(), que comprueba el saldo antes.
alter table productos enable row level security;
alter table canjes    enable row level security;

create policy p_leer_productos on productos for select to authenticated
  using (fn_mi_rol() is not null);
create policy p_admin_productos on productos for all to authenticated
  using (fn_mi_rol() = 'admin') with check (fn_mi_rol() = 'admin');
create policy p_leer_canjes on canjes for select to authenticated
  using (fn_mi_rol() is not null);
create policy p_admin_canjes on canjes for update to authenticated
  using (fn_mi_rol() = 'admin') with check (fn_mi_rol() = 'admin');

grant select on productos, canjes to authenticated;
grant insert, update, delete on productos to authenticated;   -- filtrado por RLS
grant update on canjes to authenticated;                      -- filtrado por RLS
grant execute on function fn_canjear(uuid) to authenticated;
grant select on v_monedas, v_saldos, v_clasificacion, v_lotes_dudosos to authenticated;

revoke update, delete on eventos from authenticated, anon;
revoke delete on lotes from authenticated, anon;
-- Insertar un canje a mano sería inventarse un saldo: solo fn_canjear.
revoke insert, delete on canjes from authenticated, anon;

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
