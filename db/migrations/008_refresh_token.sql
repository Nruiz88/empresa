-- =====================================================================
-- Nexo Studio — Refresh token para acceso entre servicios (migración 008)
-- =====================================================================
-- POR QUÉ
-- -------
-- El portal del cliente funciona guardando el `access_token` de
-- Supabase en la tabla `sessions` (migración 003, session bridging).
-- Con eso el servidor reconstruye la sesión del usuario y deja que
-- RLS decida. Eso está bien.
--
-- El problema es que los access_tokens de Supabase caducan a la ~1
-- hora. Sin refresh_token guardado no hay forma de renovarlos: hay que
-- hacer que el usuario vuelva a entrar. El portal lo avisa y ya está.
--
-- ESO SE QUEDA BIEN CUANDO SOLO EXISTE EL PANEL, pero en cuanto haya
-- microservicios deja de valer. El flujo previsto es:
--
--   panel.midominio.com  ──firma un ticket──▶  bot.midominio.com
--                                                    │
--                                                    ▼
--                            el bot reconstruye la sesión del usuario
--                            para que RLS decida en SU base de datos
--
-- El ticket dura 60 segundos, pero el token que lleva dentro puede
-- tener 59 minutos. Si el token está caducado en el momento de canjear
-- el ticket, el usuario entra al panel, pulsa "ir a mi bot" y lo
-- rechaza. Con refresh_token guardado, el panel renueva el token antes
-- de firmar y el ticket siempre lleva algo vivo.
--
-- CÓMO SE USA
-- -----------
--   1. Al hacer login, guardar access_token Y refresh_token.
--   2. Antes de firmar un ticket, renovar el access_token si está
--      caducado (ver lib/auth.js: tokenVigente()).
--   3. El servicio que canjea el ticket usa el access_token para
--      getClientForToken() y trabaja con RLS, como ya hace el portal.
--
-- POR QUÉ NO ES MÁS SEGURO GUARDARLO
-- ------------------------------------
-- La tabla `sessions` no tiene políticas RLS: solo la alcanza el
-- servidor con la secret key (ver 002_sessions.sql y 005). El
-- refresh_token es, por definición, material sensible — con él se
-- puede obtener un access_token nuevo. Guardarlo ahí no añade un
-- riesgo nuevo: quien puede leer `sessions` ya puede hacer de todo.
-- =====================================================================

alter table sessions
  add column if not exists refresh_token text;

comment on column sessions.refresh_token is
  'Refresh token de Supabase Auth. Permite renovar el access_token (que caduca a la ~1h) sin que el usuario tenga que entrar otra vez. Solo servidor: la tabla sessions no tiene políticas RLS.';

-- Índice para poder limpiar sesiones cuyo refresh_token ya no vale.
-- No es estrictamente necesario, pero cuando se implemente la
-- renovación habrá sesiones con refresh_token y sin él (las de antes
-- de esta migración), y habrá que distinguirlas.
create index if not exists ix_sessions_refresh on sessions (refresh_token)
  where refresh_token is not null;

-- Las sesiones antiguas no tienen refresh_token. No es un error:
-- simplemente significa que esa sesión no puede renovar el token y,
-- si caduca, el usuario tendrá que entrar otra vez. Se rellenan al
-- volver a hacer login.
comment on column sessions.refresh_token is
  'Refresh token de Supabase Auth. NULL en las sesiones creadas antes de la 008: esas no pueden renovar y el usuario tendrá que reentrar cuando caduque el access_token.';
