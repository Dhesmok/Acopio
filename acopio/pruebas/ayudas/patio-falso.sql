-- Un patio pequeño donde cada uno intenta una trampa distinta.
--
-- Ana registra dos lotes y completa una tarea. Beto hace bien su trabajo
-- una vez y luego repite lo mismo a propósito, a ver si cobra doble.
-- Carla es admin: despacha un lote y se crea una tarea sin dueño para
-- cerrársela ella misma.
insert into auth.users (id, email) values
 ('11111111-1111-4111-8111-111111111111','ana@x.com'),
 ('22222222-2222-4222-8222-222222222222','beto@x.com'),
 ('33333333-3333-4333-8333-333333333333','carla@x.com');
update perfiles set nombre='Ana',   rol='contratista', activo=true where id='11111111-1111-4111-8111-111111111111';
update perfiles set nombre='Beto',  rol='contratista', activo=true where id='22222222-2222-4222-8222-222222222222';
update perfiles set nombre='Carla', rol='admin',       activo=true where id='33333333-3333-4333-8333-333333333333';

-- El esquema ya siembra los proveedores de verdad al final. Se usa uno
-- de esos en vez de inventar otro, que chocaría con su abreviatura.
insert into proveedores (id, abreviatura, nombre)
values ('aaaaaaaa-0000-4000-8000-000000000001','ZZ','Prueba');
insert into plataformas (id, nombre, orden) values
 ('bbbbbbbb-0000-4000-8000-000000000001','Topsoil',1),
 ('bbbbbbbb-0000-4000-8000-000000000002','Ye',2);
insert into pilas (id, codigo, tipo, plataforma_id)
values ('cccccccc-0000-4000-8000-000000000001','1','otro','bbbbbbbb-0000-4000-8000-000000000001');

-- Ana registra dos lotes. La recepción la escribe el disparador sola.
insert into lotes (id, codigo, proveedor_id, placa, plataforma_id, creado_por) values
 ('dddddddd-0000-4000-8000-000000000001','PG1','aaaaaaaa-0000-4000-8000-000000000001','AAA111','bbbbbbbb-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111'),
 ('dddddddd-0000-4000-8000-000000000002','PG2','aaaaaaaa-0000-4000-8000-000000000001','AAA111','bbbbbbbb-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111');

-- Beto muestrea, se devuelve y vuelve a muestrear: una sola moneda.
insert into eventos (id, lote_id, tipo, estado_nuevo, usuario_id, ocurrido_en) values
 (gen_random_uuid(),'dddddddd-0000-4000-8000-000000000001','cambio_estado','muestreado',   '22222222-2222-4222-8222-222222222222', now()),
 (gen_random_uuid(),'dddddddd-0000-4000-8000-000000000001','cambio_estado','por_muestrear','22222222-2222-4222-8222-222222222222', now()+interval '1 min'),
 (gen_random_uuid(),'dddddddd-0000-4000-8000-000000000001','cambio_estado','muestreado',   '22222222-2222-4222-8222-222222222222', now()+interval '2 min');

-- Apila, saca y vuelve a apilar: una sola moneda.
insert into eventos (id, lote_id, tipo, pila_id, usuario_id, ocurrido_en) values
 (gen_random_uuid(),'dddddddd-0000-4000-8000-000000000001','ingreso_pila','cccccccc-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222', now()+interval '3 min'),
 (gen_random_uuid(),'dddddddd-0000-4000-8000-000000000001','salida_pila',  null,                                 '22222222-2222-4222-8222-222222222222', now()+interval '4 min'),
 (gen_random_uuid(),'dddddddd-0000-4000-8000-000000000001','ingreso_pila','cccccccc-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222', now()+interval '5 min');

-- Lo manda de ida y vuelta entre plataformas tres veces: una sola moneda.
insert into eventos (id, lote_id, tipo, plataforma_id, usuario_id, ocurrido_en) values
 (gen_random_uuid(),'dddddddd-0000-4000-8000-000000000001','traslado','bbbbbbbb-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222', now()+interval '6 min'),
 (gen_random_uuid(),'dddddddd-0000-4000-8000-000000000001','traslado','bbbbbbbb-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222', now()+interval '7 min'),
 (gen_random_uuid(),'dddddddd-0000-4000-8000-000000000001','traslado','bbbbbbbb-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222', now()+interval '8 min');

-- Carla despacha el otro lote.
insert into eventos (id, lote_id, tipo, estado_nuevo, usuario_id, ocurrido_en)
values (gen_random_uuid(),'dddddddd-0000-4000-8000-000000000002','cambio_estado','despachado','33333333-3333-4333-8333-333333333333', now());

-- Carla le manda una tarea de 10 a Ana, y Ana la cierra: paga.
insert into tareas (id, titulo, monedas, creado_por, asignado_a, completado_en, completado_por)
values (gen_random_uuid(),'Acomodar el patio',10,'33333333-3333-4333-8333-333333333333',
        '11111111-1111-4111-8111-111111111111', now(),'11111111-1111-4111-8111-111111111111');

-- Carla crea otra de 15 sin dueño y se la cierra ELLA: no paga nada.
insert into tareas (id, titulo, monedas, creado_por, asignado_a, completado_en, completado_por)
values (gen_random_uuid(),'La que se cierra sola',15,'33333333-3333-4333-8333-333333333333',
        null, now(),'33333333-3333-4333-8333-333333333333');
