-- =====================================================================
--  Proveedores reales · ejecutar suelto si el esquema ya está corriendo.
--  Vuelve a correrse las veces que quieras: actualiza el nombre si
--  la abreviatura ya existe, no duplica.
-- =====================================================================
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
