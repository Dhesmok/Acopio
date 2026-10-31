-- =====================================================================
--  limpiar-alimentados.sql · borra lo que sobra de los lotes ALIMENTADOS
--
--  Un lote alimentado ya entró a planta: su recorrido por el patio, las
--  pilas en que estuvo y lo que se le fue apuntando no le sirven a nadie.
--  Este script:
--
--  1. Deja instalada una regla en la base: desde ahora, al pasar un lote
--     a 'alimentado', se borra solo lo que sobra (ver abajo).
--  2. Hace la misma limpieza, UNA vez, con los lotes que ya estaban
--     alimentados.
--
--  Qué se BORRA de cada lote alimentado:
--    - sus movimientos por el patio, salidas de pila, observaciones,
--      recogidas programadas, entregas al laboratorio, renombres,
--      anulaciones y los pasos repetidos de cualquier cosa
--    - su marca de pila (deja de pertenecer a ninguna) y, en los pocos
--      eventos que se conservan, el enlace a la pila
--    - las PILAS en que estuvo, si ya no les queda ningún lote ni
--      historial de otro lote
--    - si iba en bigbags, lo que tuviera montado encima queda en el piso
--
--  Qué se CONSERVA, y por qué:
--    - el lote mismo (código, proveedor, placa, fechas, por dónde y
--      cuándo se alimentó): es lo que sale en el informe de Excel
--    - un solo evento de cada cosa que PAGA MONEDAS (recibirlo,
--      muestrearlo, apilarlo, trasladarlo, despacharlo): las monedas se
--      calculan desde los eventos, y borrarlos le quitaría a la gente
--      monedas ya ganadas y hasta podría dejar saldos en negativo
--    - el muestreo, además, es lo que dice que el material pasó por el
--      laboratorio: sin él, el lote saldría como "dudoso"
--    - el último paso a alimentado (quién, cuándo, por dónde)
--  Las columnas «Movido en el patio» y «Observaciones» del informe quedan
--  vacías para los alimentados.
--
--  NO SE PUEDE DESHACER. Antes de correrlo:
--    - corre sql/migracion.sql (este script usa la columna sobre_lote)
--    - si quieres respaldo, Supabase → Database → Backups
--  Mira primero el bloque 0: dice cuánto se va a borrar, sin tocar nada.
--  Se puede correr las veces que haga falta.
-- =====================================================================

-- 0. VISTA PREVIA (no cambia nada) ------------------------------------
with ev as (
  select e.*, row_number() over (
           partition by e.lote_id, e.tipo,
             case when e.tipo = 'cambio_estado' then e.estado_nuevo::text end
           order by e.ocurrido_en, e.id) as n,
         row_number() over (
           partition by e.lote_id, e.tipo,
             case when e.tipo = 'cambio_estado' then e.estado_nuevo::text end
           order by e.ocurrido_en desc, e.id desc) as ultimo
    from eventos e join lotes l on l.id = e.lote_id
   where l.estado = 'alimentado'
)
select 'lotes alimentados' as que, (select count(*) from lotes where estado = 'alimentado') as cuantos
union all
select 'eventos que se borran', count(*) from ev
 where not (
   (tipo = 'recepcion' and n = 1)
   or (tipo = 'cambio_estado' and estado_nuevo in ('muestreado', 'despachado') and n = 1)
   or (tipo = 'cambio_estado' and estado_nuevo = 'alimentado' and ultimo = 1)
   or (tipo in ('ingreso_pila', 'traslado') and n = 1))
union all
select 'alimentados que aún figuran en una pila', count(*)
  from lotes where estado = 'alimentado' and pila_id is not null;

-- 1. LA REGLA ----------------------------------------------------------
-- Un evento de entrada a pila siempre dice a qué pila entró, pero el de
-- un lote ya alimentado tiene que poder perder ese enlace para que la
-- pila se pueda borrar. La exigencia pasa de la tabla (que la aplicaba
-- también al editar) a un disparador que solo mira lo que se REGISTRA.
alter table eventos drop constraint if exists ck_pila_requerida;
create or replace function fn_pila_requerida()
returns trigger language plpgsql as $$
begin
  if new.tipo = 'ingreso_pila' and new.pila_id is null then
    raise exception 'Un ingreso a pila tiene que decir a qué pila' using errcode = '23514';
  end if;
  return new;
end; $$;
drop trigger if exists trg_pila_requerida on eventos;
create trigger trg_pila_requerida before insert on eventos
  for each row execute function fn_pila_requerida();

create or replace function fn_borrar_historial_alimentado(p_lote uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_pilas uuid[];
begin
  -- las pilas en que estuvo, antes de borrar el rastro
  select array_agg(distinct x) into v_pilas from (
    select pila_id as x from eventos where lote_id = p_lote and pila_id is not null
    union select pila_id from lotes where id = p_lote and pila_id is not null) t;

  delete from eventos e using (
    select id,
           row_number() over (
             partition by tipo, case when tipo = 'cambio_estado' then estado_nuevo::text end
             order by ocurrido_en, id) as n,
           row_number() over (
             partition by tipo, case when tipo = 'cambio_estado' then estado_nuevo::text end
             order by ocurrido_en desc, id desc) as ultimo,
           tipo, estado_nuevo
      from eventos where lote_id = p_lote) k
   where e.id = k.id
     and not (
       (k.tipo = 'recepcion' and k.n = 1)
       or (k.tipo = 'cambio_estado' and k.estado_nuevo in ('muestreado', 'despachado') and k.n = 1)
       or (k.tipo = 'cambio_estado' and k.estado_nuevo = 'alimentado' and k.ultimo = 1)
       or (k.tipo in ('ingreso_pila', 'traslado') and k.n = 1));

  -- lo que queda ya no apunta a ninguna pila
  update eventos set pila_id = null where lote_id = p_lote and pila_id is not null;

  -- pila_id del lote es un dato protegido: solo se escribe "desde un evento"
  perform set_config('app.desde_evento', 'on', true);
  update lotes set pila_id = null where id = p_lote and pila_id is not null;
  perform set_config('app.desde_evento', 'off', true);
  -- lo que iba montado encima de este lote queda en el piso
  update lotes set sobre_lote = null where sobre_lote = p_lote;

  -- la pila se va si ya no tiene ni lotes ni historial de nadie más
  delete from pilas p
   where p.id = any(coalesce(v_pilas, '{}'))
     and not exists (select 1 from lotes l where l.pila_id = p.id)
     and not exists (select 1 from eventos e where e.pila_id = p.id);
end; $$;

create or replace function fn_limpiar_alimentado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'alimentado' and old.estado is distinct from 'alimentado' then
    perform fn_borrar_historial_alimentado(new.id);
  end if;
  return null;
end; $$;

drop trigger if exists trg_limpiar_alimentado on lotes;
create trigger trg_limpiar_alimentado
  after update of estado on lotes for each row execute function fn_limpiar_alimentado();

-- 2. LIMPIEZA DE LO QUE YA ESTABA ALIMENTADO ---------------------------
do $$
declare r record;
begin
  for r in select id from lotes where estado = 'alimentado' loop
    perform fn_borrar_historial_alimentado(r.id);
  end loop;
end $$;

-- La app se entera sola: lo borrado deja de estar en el servidor y cada
-- celular lo quita al pasar lista con él (como mucho en una hora).
notify pgrst, 'reload schema';

select 'Listo: historial de alimentados limpio y la regla quedó instalada.' as resultado;
