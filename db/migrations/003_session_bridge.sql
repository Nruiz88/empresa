-- =====================================================================
-- Nexo Studio — Puente de sesión con Supabase Auth (migración 003)
-- =====================================================================
-- POR QUÉ
-- --------
-- El login se hace en el SERVIDOR con signInWithPassword, así que el
-- access_token de Supabase nunca sale del servidor: la cookie propia
-- solo lleva id y rol.
--
-- Para que el portal del cliente funcione con RLS de verdad (que lo
-- decida la base de datos y no el código), hace falta poder crear un
-- cliente de Supabase que actúe COMO ese usuario. Y para eso
-- necesitamos su access_token.
--
-- Se guarda en la tabla sessions, que solo toca el servidor (no tiene
-- políticas RLS para usuarios). Es el patrón habitual de "session
-- bridging" y es la razón por la que esa tabla existe en el servidor.
--
-- Alternativa descartada: leer los servicios del cliente con la secret
-- key filtrando por client_id en el código. Funciona, pero тогда el
-- aislamiento lo pone Express y no Postgres, que es donde queremos
-- que esté.
-- =====================================================================

alter table sessions
  add column if not exists access_token text;

comment on column sessions.access_token is
  'Access token de Supabase Auth del usuario, para reconstruir su sesión en RLS. Solo servidor.';

-- Ayuda a limpiar: cuando un usuario cierra sesión, sus sesiones
-- antiguas con token se pueden purgar por expiración.
create index if not exists sessions_expira on sessions (expira_en);

do $$
begin
  raise notice 'Migración 003 aplicada: sessions.access_token añadido.';
end $$;
