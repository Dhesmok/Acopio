-- Lo mínimo de Supabase que el esquema da por hecho, para poder cargarlo
-- en un PostgreSQL pelado: los roles, el esquema `auth` con su tabla de
-- usuarios, `storage` para el bucket de imágenes, y `auth.uid()`, que en
-- Supabase devuelve quién está preguntando.
-- Los roles son de TODO el servidor, no de cada base: si ya se creó uno
-- en una corrida anterior, volver a crearlo revienta.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
end $$;
create schema auth;
create schema storage;

create table auth.users (
  id                 uuid primary key,
  email              text,
  raw_user_meta_data jsonb
);
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid default gen_random_uuid() primary key,
                              bucket_id text, name text, owner uuid);

-- Quién pregunta. Se puede fijar con set_config para actuar como cada
-- persona, igual que hace Supabase con el token.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
