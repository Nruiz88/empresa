-- =====================================================================
-- Nexo Studio — Panel de gestión (esquema inicial)
-- =====================================================================
-- Pegar en: Supabase > SQL Editor > New query > Run
--
-- El panel tiene dos tipos de usuario:
--   staff  -> el equipo (ve todo)
--   client -> el cliente (solo lo suyo, aplicado en la base de datos)
--
-- El aislamiento NO se hace en el código: se hace con Row Level Security.
-- Si un cliente manipula una URL para ver datos de otro, la base de
-- datos le dice que no. Esa es toda la gracia de hacerlo aquí.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tipos enumerados
--    Añadir un valor después exige ALTER TYPE; por eso son ENUM y no TEXT.
-- ---------------------------------------------------------------------
-- Con guarda, como ya hacía 004_cobros.sql. Sin ella, aplicar esta
-- migración dos veces falla con 'type service_kind already exists',
-- y eso rompía `npm run migrate --reset` sobre una base ya creada.
-- Comprobado por db/test-idempotencia.js.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'service_kind') then
    create type service_kind as enum ('mantenimiento', 'proyecto', 'presupuesto');
  end if;
  if not exists (select 1 from pg_type where typname = 'service_status') then
    create type service_status as enum ('activo', 'pendiente', 'en_curso', 'pausado', 'finalizado', 'cancelado');
  end if;
  if not exists (select 1 from pg_type where typname = 'lead_estado') then
    create type lead_estado as enum ('nuevo', 'contactado', 'presupuestado', 'ganado', 'descartado');
  end if;
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type user_role as enum ('staff', 'client');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Clientes
-- ---------------------------------------------------------------------
create table if not exists clients (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  empresa     text,
  email       text,
  telefono    text,
  notas       text,
  creado_en   timestamptz not null default now(),
  archivado   boolean not null default false
);

create index if not exists ix_clients_empresa on clients (empresa);

-- ---------------------------------------------------------------------
-- 3. Perfiles: extiende a los usuarios de Supabase Auth
--    auth.users guarda email y contraseña. Aquí va el ROL y de qué
--    cliente es cada persona.
--
--    Un usuario "staff" tiene client_id = null.
--    Un usuario "client" SIEMPRE tiene client_id (regla que compruebo
--    abajo con un trigger).
-- ---------------------------------------------------------------------
create table if not exists profiles (
  id          uuid primary key references auth.users on delete cascade,
  rol         user_role not null default 'client',
  client_id   uuid references clients on delete set null,
  nombre      text,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now(),
  ultimo_acceso timestamptz
);

create index if not exists ix_profiles_client_id on profiles (client_id);

-- Un cliente siempre debe pertenecer a un cliente. Si no, no sabría
-- qué puede ver. Esto impide crear usuarios "cliente" sueltos.
create or replace function check_client_rol() returns trigger as $$
begin
  if new.rol = 'client' and new.client_id is null then
    raise exception 'Un usuario con rol "client" necesita client_id';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_client_rol on profiles;
create trigger trg_client_rol
  before insert or update on profiles
  for each row execute function check_client_rol();

-- ---------------------------------------------------------------------
-- 4. Servicios
--    Un solo tipo para los tres: mantenimiento, proyecto y presupuesto.
--    Se distinguen por "kind". Menos tablas que mantener y los informes
--    son más sencillos.
-- ---------------------------------------------------------------------
create table if not exists services (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients on delete cascade,
  kind         service_kind not null,
  estado       service_status not null default 'pendiente',
  titulo       text not null,
  descripcion  text,
  importe      numeric(12,2),
  moneda       text not null default 'EUR',
  -- Periodicidad: solo tiene sentido en mantenimiento (cuota mensual/anual)
  periodicidad text check (periodicidad in ('mensual', 'trimestral', 'anual', 'unica')),
  inicia_en    date,
  termina_en   date,
  notas        text,
  creado_en    timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  -- No puede terminar antes de empezar
  constraint termino_antes check (termina_en is null or inicia_en is null or termina_en >= inicia_en)
);

create index if not exists ix_services_client_id on services (client_id);
create index if not exists ix_services_kind_estado on services (kind, estado);

-- Mantener actualizado_en automáticamente
create or replace function touch_actualizado() returns trigger as $$
begin
  new.actualizado_en = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_touch on services;
create trigger trg_touch
  before update on services
  for each row execute function touch_actualizado();

-- ---------------------------------------------------------------------
-- 5. Consultas del formulario de contacto
--    El formulario sigue escribiendo también en el archivo local, por
--    si Supabase está pausado o caído. Esta tabla es la copia operativa.
-- ---------------------------------------------------------------------
create table if not exists leads (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  email       text not null,
  empresa     text,
  telefono    text,
  tipo        text,
  presupuesto text,
  mensaje     text not null,
  estado      lead_estado not null default 'nuevo',
  ip          text,
  notas       text,
  recibido_en timestamptz not null default now()
);

create index if not exists ix_leads_estado_recibido_en on leads (estado, recibido_en);
create index if not exists ix_leads_email on leads (email);

-- ---------------------------------------------------------------------
-- 6. Registro de auditoría
--    Quién cambió qué y cuándo. Importante: aquí hay datos de contacto
--    de clientes y facturación.
-- ---------------------------------------------------------------------
create table if not exists audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references auth.users on delete set null,
  actor_email text,
  accion      text not null,
  entidad     text,
  entidad_id  text,
  detalle     jsonb,
  ip          text,
  creado_en   timestamptz not null default now()
);

create index if not exists ix_audit_log_creado_en_desc on audit_log (creado_en desc);
create index if not exists ix_audit_log_entidad_entidad_id on audit_log (entidad, entidad_id);

-- =====================================================================
-- 7. Row Level Security
-- =====================================================================
alter table clients   enable row level security;
alter table profiles  enable row level security;
alter table services  enable row level security;
alter table leads     enable row level security;
alter table audit_log enable row level security;

-- ---------------------------------------------------------------------
-- Funciones auxiliares.
--
-- SECURITY DEFINER + search_path fijo: sin esto, estas funciones se
-- pueden usar para escalar privilegios. Es el patrón que recomienda
-- Supabase para evitar la recursión infinita que aparecería al
-- consultar "profiles" desde una política de "profiles".
-- ---------------------------------------------------------------------
create or replace function es_staff() returns boolean
  language sql stable security definer
  set search_path = public
  as $$
    select exists (
      select 1 from profiles
      where id = auth.uid() and rol = 'staff' and activo
    );
  $$;

create or replace function es_cliente_de(cliente_uuid uuid) returns boolean
  language sql stable security definer
  set search_path = public
  as $$
    select exists (
      select 1 from profiles
      where id = auth.uid() and rol = 'client' and client_id = cliente_uuid and activo
    );
  $$;

-- ---------- profiles ----------
-- Cada uno lee y actualiza solo el suyo. El staff lee todos.
drop policy if exists "leer propio perfil" on profiles;
create policy "leer propio perfil"
  on profiles for select to authenticated
  using (id = auth.uid() or es_staff());

drop policy if exists "actualizar propio perfil" on profiles;
create policy "actualizar propio perfil"
  on profiles for update to authenticated
  using (id = auth.uid() or es_staff())
  with check (id = auth.uid() or es_staff());

-- ---------- clients ----------
-- El staff ve todos. El cliente ve únicamente su ficha.
drop policy if exists "leer clientes" on clients;
create policy "leer clientes"
  on clients for select to authenticated
  using (es_staff() or id = (select client_id from profiles where id = auth.uid()));

-- El cliente NO puede crear ni borrar clientes, en ningún caso.
drop policy if exists "gestionar clientes" on clients;
create policy "gestionar clientes"
  on clients for all to authenticated
  using (es_staff())
  with check (es_staff());

-- ---------- services ----------
-- El cliente ve los servicios de su empresa, nunca los de otro.
drop policy if exists "leer servicios" on services;
create policy "leer servicios"
  on services for select to authenticated
  using (es_staff() or es_cliente_de(client_id));

-- Solo el staff modifica servicios.
drop policy if exists "gestionar servicios" on services;
create policy "gestionar servicios"
  on services for all to authenticated
  using (es_staff())
  with check (es_staff());

-- ---------- leads ----------
-- Las consultas son del negocio: los clientes no las ven nunca.
drop policy if exists "gestionar consultas" on leads;
create policy "gestionar consultas"
  on leads for all to authenticated
  using (es_staff())
  with check (es_staff());

-- ---------- audit_log ----------
-- El personal escribe su propia auditoría; solo lectura para todos
-- los que son staff. No hay política de borrado a propósito: el
-- registro de auditoría debe ser inmutable.
drop policy if exists "leer auditoria" on audit_log;
create policy "leer auditoria"
  on audit_log for select to authenticated
  using (es_staff());

drop policy if exists "insertar auditoria" on audit_log;
create policy "insertar auditoria"
  on audit_log for insert to authenticated
  with check (es_staff());

-- =====================================================================
-- 8. Cómo se escribe en cada tabla
-- ---------------------------------------------------------------------
-- Esto NO es opcional y es donde se suelen crear agujeros:
--
--   · El servidor usa SUPABASE_SERVICE_ROLE_KEY, que IGNORA estas
--     políticas. Sirve para escribir leads desde el formulario público
--     y para crear clientes desde el panel.
--     -> NUNCA enviar esa clave al navegador.
--
--   · El portal del cliente usa el JWT del usuario (anon key), y ahí
--     SÍ se aplican las políticas de arriba.
--
--   · Rutas "de API" que usen la service_role deben filtrar por
--     es_cliente_de() a mano: la base de datos ya no las protege.
--
-- =====================================================================
do $$
declare
  total integer;
begin
  select count(*) into total from pg_tables where schemaname = 'public';
  raise notice 'Tablas creadas en public: %', total;
  raise notice 'RLS activo en: clients, profiles, services, leads, audit_log';
end $$;
