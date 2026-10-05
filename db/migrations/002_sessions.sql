-- =====================================================================
-- Nexo Studio — Sesiones, CSRF y límite de intentos (migración 002)
-- =====================================================================
-- Por qué esto cambia lo que ya había:
--
-- La versión anterior usaba un token firmado (HMAC) SIN estado. Eso
-- tenía dos problemas:
--   1. Al hacer logout el token seguía siendo válido hasta 8 horas.
--      Si alguien copiaba la cookie, la usaba aunque cerraras sesión.
--   2. La cookie contenía el id de usuario y el rol, en texto legible
--      (base64). No es un secreto, pero no hace falta que viaje.
--
-- Aquí la cookie pasa a ser un token opaco aleatorio. El servidor
-- guarda solo su HASH: si alguien lee esta tabla no puede robar
-- sesiones. Y como la sesión vive en la tabla, se puede revocar.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Sesiones
-- ---------------------------------------------------------------------
create table if not exists sessions (
  id            uuid primary key default gen_random_uuid(),
  -- Nunca el token en claro: solo su SHA-256. Si alguien lee la
  -- tabla, no puede suplantar a nadie.
  token_hash    text not null unique,
  user_id       uuid not null references auth.users on delete cascade,
  rol           user_role not null,
  -- Token CSRF de esta sesión. También aleatorio.
  csrf_token    text not null,
  ip            text,
  user_agent    text,
  creada_en     timestamptz not null default now(),
  ultimo_acceso timestamptz not null default now(),
  expira_en     timestamptz not null,
  revocada_en   timestamptz
);

create index if not exists ix_sessions_user_id on sessions (user_id);
create index if not exists ix_sessions_expira_en on sessions (expira_en);
-- Para el login: "cuántas sesiones activas tiene este usuario"
create index if not exists ix_sessions_user_id on sessions (user_id) where revocada_en is null;

-- Una sesión no puede expirar antes de crearse.
-- El drop va delante porque ADD CONSTRAINT no admite IF NOT EXISTS:
-- sin él, aplicar la migración dos veces falla con
-- 'constraint "expiry_valido" already exists'.
alter table sessions
  drop constraint if exists expiry_valido;
alter table sessions
  add constraint expiry_valido check (expira_en > creada_en);

-- ---------------------------------------------------------------------
-- Intentos de acceso
-- ---------------------------------------------------------------------
-- Se cuentan los fallos por email+IP. Guardar los ACIERTOS también
-- tiene sentido: si alguien entra 20 veces bien, igual alguien más
-- está robando la contraseña.
create table if not exists login_attempts (
  id         bigint generated always as identity primary key,
  email      text not null,
  ip         text,
  exito      boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists ix_login_attempts_email_created_at_desc on login_attempts (email, created_at desc);
create index if not exists ix_login_attempts_created_at on login_attempts (created_at);

-- =====================================================================
-- Row Level Security
-- =====================================================================
-- Estas tablas las maneja SOLO el servidor (con la secret key, vía
-- el panel). No hay política de lectura para el usuario: por diseño.
-- =====================================================================
alter table sessions       enable row level security;
alter table login_attempts enable row level security;

do $$
begin
  raise notice 'Migración 002 aplicada.';
  raise notice 'Tablas nuevas: sessions, login_attempts';
  raise notice 'Ambas sin políticas: solo el servidor las toca.';
end $$;
