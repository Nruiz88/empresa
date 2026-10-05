-- =====================================================================
-- Sesiones del bot (013)
-- =====================================================================
-- POR QUÉ UNA TABLA PROPIA Y NO REUSAR `sessions` DE EMPRESA
-- -----------------------------------------------------------
-- `sessions` (migración 002) es el almacén del panel, y funciona. Pero
-- el bot va en otro subdominio y el proyecto tiene una regla ya escrita
-- en lib/acceso-servicio.js: cada servicio mantiene SU sesión y SU
-- cookie host-only, porque una cookie compartida con
-- Domain=.midominio.com convierte cualquier XSS de cualquier
-- subdominio en un robo de sesión de todos.
--
-- Reusar `sessions` rompería esa regla por la puerta de atrás: el token
-- del bot sería una fila de la tabla que el panel también lee. Si
-- mañana el panel acepta cualquier fila válida (por ejemplo para
-- "cerrar sesión en todos lados"), el bot también queda dentro, y al
-- revés.
--
-- Con `bot_sesiones` cada dominio tiene su almacén, su cookie y su
-- vida útil, y el panel no puede tocar las del bot ni al revés.
--
-- La diferencia con la sesión del panel, además: aquí el
-- `access_token` NO se renueva. El bot no guarda `refresh_token`, así
-- que cuando el token de Supabase caduca (una hora) el usuario vuelve
-- a pasar por el panel. Para un servicio de uso corto es lo simple y
-- suficiente, y evita guardar un refresh_token en un segundo sitio.
--
--
-- ⚠️  RLS
-- -----
-- Sin políticas a propósito: con RLS activo y sin políticas, la tabla
-- queda inaccesible para `authenticated`. Solo la alcanza el servidor
-- con la secret key, igual que `sessions` y `login_attempts`.
-- (lo verifica db/test-bot.js)
-- =====================================================================

create table if not exists bot_sesiones (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients on delete cascade,

  /* Solo el hash. El token en claro existe en la cookie del cliente y
     no se guarda nunca: si alguien lee esta tabla no puede suplantar
     una sesión, solo invalidarla. */
  token_hash  text not null unique,

  user_id     uuid not null references auth.users on delete cascade,
  rol         text not null check (rol in ('staff','client')),

  /* Para reconstruir la sesión de Supabase y que RLS decida, en vez de
     filtrar por client_id a mano en el código. */
  access_token text,

  csrf_token  text not null,

  expira_en   timestamptz not null,
  revocado_en timestamptz,
  creado_en   timestamptz not null default now(),

  /* Se comprueba al crear, pero también en el sitio: un UPDATE que
     pusiera una caducidad lejana no debe poder saltarse el límite. */
  check (expira_en > creado_en)
);

comment on table bot_sesiones is
  'Sesiones del bot en bot.midominio.com. Tabla propia, separada de sessions del panel a propósito: cada servicio mantiene su almacén para que una cookie de un subdominio no sirva en otro.';

comment on column bot_sesiones.token_hash is
  'SHA-256 del token de la cookie. El token en claro no se guarda: leer esta tabla permite invalidar una sesión, no suplantarla.';

create index if not exists ix_bot_sesiones_token on bot_sesiones (token_hash);
create index if not exists ix_bot_sesiones_user on bot_sesiones (user_id);
create index if not exists ix_bot_sesiones_client on bot_sesiones (client_id);
create index if not exists ix_bot_sesiones_expira on bot_sesiones (expira_en)
  where revocado_en is null;

alter table bot_sesiones enable row level security;

-- ---------------------------------------------------------------------
-- Permisos
--
-- El rol `bot_servidor` (creado en 011) ya existe. Se le da escritura
-- aquí; el SELECT también, porque es lo mismo que cualquier escritura
-- (crear sesión = insertar y luego leer para devolverla).
-- ---------------------------------------------------------------------
grant select, insert, update on bot_sesiones to bot_servidor;

-- El rol `bot_servidor` todavía no tenía SELECT sobre `profiles`, y lo
-- necesita para resolver el client_id del usuario en cada petición
-- (la comprobación de suscripción, que se repite en cada llamada, no
-- solo al entrar: si una suscripción se cancela con el navegador ya
-- abierto, debe dejar de funcionar en la siguiente petición).
grant select on profiles to bot_servidor;
grant select on clients to bot_servidor;

-- `tiene_modulo()` es SECURITY DEFINER. Ojo con la firma: tiene TRES
-- parámetros (el tercero es `hoy`, con default), así que el grant
-- tiene que declararlos todos o Postgres avisa de que no existe esa
-- firma.
grant execute on function tiene_modulo(uuid, text, date) to bot_servidor;