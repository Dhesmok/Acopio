-- =====================================================================
--  LIMPIEZA · lotes repetidos y eventos huérfanos.
--
--  Contexto: si el botón "Poner en el mapa" no daba señal de vida, la
--  persona lo tocaba varias veces y cada toque creaba un lote distinto en
--  el celular. El código de lote es UNIQUE, así que al servidor llega uno
--  solo y los demás quedan represados en la cola del teléfono.
--
--  Por eso hay dos limpiezas distintas y en este orden:
--    A. En el celular  (no se hace desde aquí, ver el final del archivo)
--    B. En el servidor (este archivo)
--
--  LEER ANTES DE EJECUTAR. Los bloques que borran están comentados a
--  propósito: primero se mira, después se borra.
-- =====================================================================

-- ---------------------------------------------------------------- mirar
-- 1. Repetidos exactos por código. No debería salir ninguno: `codigo` es
--    unique. Si sale algo, la restricción no está puesta.
select 'codigo repetido' as caso, codigo, count(*) as veces
  from lotes group by codigo having count(*) > 1;

-- 2. Repetidos "de hecho": el mismo material, del mismo proveedor, en la
--    misma volqueta y el mismo día. Es la firma de los toques repetidos
--    cuando el número de lote se escribió distinto (ABG12 / ABG012).
select 'posible repetido' as caso,
       l.proveedor_id, p.abreviatura, l.placa, l.fecha_recepcion,
       count(*) as cuantos,
       array_agg(l.codigo order by l.creado_en) as codigos,
       array_agg(l.id     order by l.creado_en) as ids
  from lotes l join proveedores p on p.id = l.proveedor_id
 group by l.proveedor_id, p.abreviatura, l.placa, l.fecha_recepcion
having count(*) > 1
 order by count(*) desc, l.fecha_recepcion desc;

-- 3. Qué historia tiene cada candidato. Un lote que solo tiene su evento
--    de recepción no le importa a nadie: se puede borrar sin perder nada.
--    Uno con movimientos, cambios de estado u observaciones, NO.
select 'historia' as caso, l.codigo, l.estado, l.pila_id,
       count(e.id) as eventos,
       count(*) filter (where e.tipo <> 'recepcion') as eventos_reales
  from lotes l left join eventos e on e.lote_id = l.id
 group by l.id, l.codigo, l.estado, l.pila_id
having count(*) filter (where e.tipo <> 'recepcion') = 0
 order by l.creado_en desc;

-- 4. Eventos que apuntan a un lote inexistente. Con la llave foránea
--    puesta esto siempre da cero; si da más, la llave no está.
select 'evento huerfano' as caso, count(*) as cuantos
  from eventos e left join lotes l on l.id = e.lote_id where l.id is null;

-- --------------------------------------------------------------- borrar
--  Descomentar SOLO después de mirar los bloques de arriba, y poner a
--  mano los códigos que se van a eliminar. Nunca un delete a ciegas.
--
--  `eventos.lote_id` es "on delete restrict": hay que borrar primero los
--  eventos del lote. Por eso van las dos sentencias juntas, en una
--  transacción: o se van los dos, o no se va ninguno.
--
-- begin;
--   -- los códigos sobrantes, NO el que se queda
--   create temp table a_borrar (codigo text primary key);
--   insert into a_borrar (codigo) values ('ABG012'), ('ABG0012');
--
--   -- red de seguridad: no se borra nada que esté en una pila ni que
--   -- tenga historia propia más allá de su recepción
--   delete from a_borrar b
--    using lotes l
--    where l.codigo = b.codigo
--      and (l.pila_id is not null
--           or exists (select 1 from eventos e
--                       where e.lote_id = l.id and e.tipo <> 'recepcion'));
--
--   select 'se van a borrar' as caso, codigo from a_borrar;
--
--   delete from eventos where lote_id in (select id from lotes where codigo in (select codigo from a_borrar));
--   delete from lotes   where codigo in (select codigo from a_borrar);
-- commit;   -- o rollback; si el listado no era el esperado

-- =====================================================================
--  A. La limpieza del celular NO se hace desde aquí
--
--  Los lotes repetidos que se ven en la app y no están en estas consultas
--  nunca salieron del teléfono. Están en la cola local, marcados
--  "rechazado". Para soltarlos:
--
--    1. Arreglar primero la causa (bloques 3 y 4 de diagnostico.sql:
--       perfil activo y políticas de INSERT en su sitio).
--    2. En la app, tocar la franja roja → "Reintentar". Lo que era un
--       problema de permisos sube solo, y en el orden correcto: primero
--       el lote, después sus eventos.
--    3. Lo que siga rechazado por código repetido: "Descartar". Eso
--       vacía la cola local, y en la siguiente sincronización la app se
--       vuelve a llenar con lo que sí está en el servidor. Los duplicados
--       fantasma desaparecen de la pantalla solos.
-- =====================================================================
