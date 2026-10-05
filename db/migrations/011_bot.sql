-- =====================================================================
-- Nexo Studio — El bot de WhatsApp como módulo (011)
-- =====================================================================
-- QUÉ ES ESTO
-- -----------
-- El bot de D:\webs\wweb pasa a vivir en la misma base de datos que el
-- panel. Pasa a ser un módulo más, como el inventario o el de reservas.
--
-- Lo que desaparece con este cambio (porque ya no tiene sentido):
--
--   · profiles propio con role admin/user  → los usuarios son los
--     clientes de Nexo Studio (profiles.role = 'client' + client_id).
--   · subscriptions / plan_config / payments / mercado_pago_config  →
--     el cobro lo hace Nexo Studio, no el bot.
--   · instance_addons / user_instances → un cliente, un bot. Los bots
--     extra se montan más adelante, cuando haya un panel para ellos.
--   · invitations → no hay autoservicio, el alta la hace el panel.
--
-- Lo que se queda: el motor (webhook de Evolution, auto-respuestas,
-- menús, catálogo, pedidos, horarios y reservas).
--
--
-- ⚠️  POR QUÉ ESTAS TABLAS ESTÁN EN INGLÉS Y LAS DE ARRIBA EN ESPAÑOL
-- ---------------------------------------------------------------------
-- `clients`, `profiles`, `modules`, `suscripciones`... están en español.
-- Las del bot, en inglés. No es descuido, es deliberado, y el motivo es
-- concreto:
--
-- El motor del bot tiene un vocabulario técnico propio (`status`,
-- `type`, `active`, `label`) que son 1037, 233, 114 y 244 apariciones
-- en el código. Renombrarlas en la base obligaría a distinguirlas a
-- mano en el código, porque `status` en el bot es tanto la columna
-- como el status de la respuesta HTTP: 553 de las 1037 apariciones son
-- `NextResponse.json({ status: "error" })`, NO la columna. Un renombrado
-- automático habría roto los 40 endpoints de la API de una vez.
--
-- Traducir solo la base crearía dos idiomas en la misma tabla. Traducir
-- ambos no vale el riesgo. Así que el esquema del bot habla inglés, que
-- es como habla su código, y la traducción ocurre en el panel de Nexo
-- Studio, que es donde el usuario la ve.
--
-- Lo que sí se renombró aquí, porque NO colisiona con nada:
--
--   instances        → bots
--   auto_responses   → bots_responses
--   appointments     → bots_appointments
--   catalog_items    → bots_catalog_items
--   orders           → bots_orders
--
-- Las columnas conservan su nombre inglés de siempre (instance_name,
-- day_of_week, start_time...) EXCEPTO instance_id → bot_id, porque "la
-- instancia" ahora es el bot y sigue siendo una instancia de Evolution.
--
--
-- ⚠️  EL FALLO DE SEGURIDAD QUE ESTA MIGRACIÓN ARREGLA
-- -----------------------------------------------------
-- En MariaDB, `instances` tenía `evolution_api_url` y
-- `evolution_api_key` JUNTAS, y el usuario dueño de la instancia
-- podía leer su fila entera. Como varias instancias comparten servidor
-- de Evolution (misma url, misma clave), eso significa que el cliente A
-- podía leer la clave del servidor y, con ella, manejar la instancia
-- del cliente B. No hacía falta ser admin: bastaba con ver su propia
-- fila.
--
-- Aquí se separa:
--
--   bots               → lo que ve el CLIENTE (su bot: nombre, slug,
--                        estado, mensajes). SIN claves.
--   evolution_servers  → las url y claves. Sin ninguna política RLS:
--                        solo la alcanza el servidor con la secret key,
--                        igual que sessions y login_attempts.
--
-- Un cliente no puede leer una clave. Ni la suya. Que tampoco la
-- necesita.
--
-- Nota sobre el idioma en esta capa: las FUNCIONES y las POLÍTICAS
-- siguen en español, como las de empresa (tiene_modulo, es_cliente_de,
-- "leer sus citas"). Viven en la capa de RLS de empresa y comparten
-- convención con ella; lo que habla inglés es el esquema que consume el
-- bot, no el que consume el panel.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. btree_gist y la función de touched
--
-- btree_gist lo necesita el EXCLUDE de más abajo, que es lo que
-- impide que dos citas se pisen en el mismo hueco. Supabase lo trae
-- activo en el esquema public; si no lo estuviera, esto falla y hay
-- que pedirlo en el panel.
-- ---------------------------------------------------------------------
create extension if not exists btree_gist;

/* Función GEMELA de touch_actualizado() de la migración 001, pero
   escribiendo en `updated_at`.

   Por qué no se reutiliza la de empresa: touch_actualizado() hace
   `new.actualizado_en = now()` y las tablas de empresa llaman a esa
   columna `actualizado_en`. Las del bot la llaman `updated_at` (para
   no colisionar con el vocabulario inglés del resto de sus columnas).
   Reusar la función de empresa hacía que TODO update de una cita
   fallara con:

     ERROR: record "new" has no field "actualizado_en"

   que además salía como error de violación de columna y seemed un
   problema de datos, no de esquema. Por eso hay dos funciones y cada
   una toca la columna de su idioma. */
create or replace function bot_touch_updated_at() returns trigger as $$
  begin
    new.updated_at = now();
    return new;
  end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- 1. Servidores de Evolution (SOLO SERVIDOR)
--
-- Varias instancias (bots de distintos clientes) pueden vivir en el
-- mismo servidor de Evolution, con la misma url y la misma clave.
--
-- Por eso la clave NO está en bots: si estuviera, un cliente leería
-- en su propia fila la clave que le permite tocar los bots de otros.
-- ---------------------------------------------------------------------
create table if not exists evolution_servers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  url         text not null,
  -- Sin cifrar a propósito: el servidor tiene que usarla tal cual para
  -- llamar a Evolution. La protección es que NADIE más que el servidor
  -- puede leerla (ver RLS más abajo).
  api_key     text not null,
  -- Cuota pago, para saber si esa url tiene que devolver 'open'.
  plan        text check (plan is null or plan in ('subscription','free')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table evolution_servers is
  'Servidores de Evolution API. Solo el servidor los lee: aquí están las claves y una clave compartida da acceso a los bots de todos los clientes de ese servidor.';

alter table evolution_servers enable row level security;

-- Sin políticas a propósito: con RLS activo y sin políticas, la tabla
-- queda inaccesible para el rol 'authenticated'. Solo la secret key
-- (service_role) la salta. Es el mismo truco que sessions.
-- (lo verifica db/test-bot.js)

-- ---------------------------------------------------------------------
-- 2. bots  (lo que era `instances`)
--
-- 1:1 con clients por ahora. Cuando haya bots extra, se rompe el 1:1
-- y la suscripción deja de ser binaria.
-- ---------------------------------------------------------------------
create table if not exists bots (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients on delete cascade,

  -- Servidor de Evolution donde vive este bot. Los datos de conexión
  -- (url y clave) están en esa tabla, NO aquí.
  server_id   uuid not null references evolution_servers on delete restrict,

  name        text not null,
  -- El nombre del bot dentro de Evolution. Lo genera la API al crear
  -- la instancia, así que se guarda tal cual.
  instance_name text not null,

  -- La URL pública de reservas: /agendar/<slug>
  -- Es lo que se pone en la web del cliente. Unique a nivel de base
  -- porque es una dirección pública: dos clientes con el mismo slug
  -- sería una colisión que nadie vería hasta que un cliente reservara
  -- en el bot de otro.
  slug        text not null unique
              check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),

  -- Estado según Evolution. OJO: Evolution devuelve valores que no
  -- están en InstanceStatus (markdown una vez devolvió 'unknown'), y en
  -- MariaDB un CHECK violado salía como ER 3819 que el catch se comía
  -- y la UI decía "Error inesperado". Aquí se acepta texto libre y se
  -- guarda el valor tal cual, para no perder el diagnóstico.
  -- Los valores de siempre ('open','close','connecting','qrcode') son
  -- los de InstanceStatus en src/lib/db/types.ts de wweb.
  status          text not null default 'close',
  status_checked_at timestamptz,

  welcome_message     text,
  outside_hours_message text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Un cliente no puede tener dos bots todavía. Cuando haya bots
  -- extra, esta restricción se quita; por eso está en la tabla y no
  -- es una regla de negocio escondida en el código.
  constraint un_bot_por_cliente unique (client_id)
);

comment on table bots is
  'Un bot de WhatsApp por cliente. La conexión a Evolution vive en evolution_servers, no aquí, para que el cliente no pueda leer la clave.';

comment on column bots.slug is
  'Aparece en la URL pública de reservas: /agendar/<slug>. Único en base de datos porque es una dirección pública.';

create index if not exists ix_bots_client_id on bots (client_id);
create index if not exists ix_bots_server_id on bots (server_id);
create index if not exists ix_bots_slug on bots (slug);

drop trigger if exists trg_touch_bots on bots;
create or replace trigger trg_touch_bots
  before update on bots
  for each row execute function bot_touch_updated_at();

-- ---------------------------------------------------------------------
-- 3. Función de acceso: ¿este bot es de este cliente?
--
-- TODA la política de todas las tablas de aquí abajo pasa por aquí. Una
-- sola definición, para que no haya tres sitios donde decidir quién es
-- dueño de qué.
--
-- security definer + search_path fijo: sin esto, la función se podría
-- usar para leer tablas de las que el usuario no tiene permiso. Es el
-- patrón de es_cliente_de() en la migración 001.
-- ---------------------------------------------------------------------
create or replace function es_dueno_de_bot(bot_uuid uuid)
  returns boolean
  language sql stable security definer
  set search_path = public
  as $$
    select exists (
      select 1
      from bots b
      join profiles p on p.client_id = b.client_id
      where b.id = bot_uuid
        and p.id = auth.uid()
        and p.rol = 'client'
        and p.activo
    );
  $$;

comment on function es_dueno_de_bot is
  'Regla ÚNICA de acceso a los datos del bot. La usan todas las políticas de esta migración. security definer para poder leer profiles y bots desde la política sin recursión.';

-- ---------------------------------------------------------------------
-- 4. Lo que el cliente configura  (auto_responses)
-- ---------------------------------------------------------------------
create table if not exists bots_responses (
  id          uuid primary key default gen_random_uuid(),
  bot_id      uuid not null references bots on delete cascade,

  -- Una de las dos cosas: palabra clave o expresión regular. El CHECK
  -- de MariaDB (keyword OR regex_pattern) provocaba el mismo error
  -- 3819 que el catch se comía; aquí es igual de obligatorio, pero el
  -- mensaje de error es el de Postgres y no se esconde.
  keyword         text,
  regex_pattern   text,
  response_text   text not null,
  response_media_url text,
  -- 'text' | 'menu', igual que ResponseType en wweb.
  response_type   text not null default 'text'
                  check (response_type in ('text','menu')),
  menu_config     jsonb,
  is_active       boolean not null default true,
  priority        integer not null default 0,
  -- Reglas de disponibilidad: {dias:[1,2,3], desde:"09:00", hasta:"18:00"}
  schedule        jsonb,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  check (keyword is not null or regex_pattern is not null)
);

create index if not exists ix_bots_responses_bot on bots_responses (bot_id);
create index if not exists ix_bots_responses_activa on bots_responses (bot_id, is_active, priority);

drop trigger if exists trg_touch_bots_responses on bots_responses;
create or replace trigger trg_touch_bots_responses
  before update on bots_responses
  for each row execute function bot_touch_updated_at();

-- ---------------------------------------------------------------------
-- 5. Registro de lo que contesta el bot  (response_logs)
--
-- Sin `user_id`: el "quién" es el teléfono que escribe, no el cliente.
-- ---------------------------------------------------------------------
create table if not exists bots_response_logs (
  id          uuid primary key default gen_random_uuid(),
  bot_id      uuid not null references bots on delete cascade,
  auto_response_id uuid references bots_responses on delete set null,
  incoming_phone text not null,
  incoming_message text not null,
  matched_keyword text,
  sent_at     timestamptz not null default now()
);

create index if not exists ix_bots_response_logs_bot on bots_response_logs (bot_id);
create index if not exists ix_bots_response_logs_fecha on bots_response_logs (sent_at desc);

-- ---------------------------------------------------------------------
-- 6. Horario de atención  (business_hours)
-- ---------------------------------------------------------------------
create table if not exists bots_business_hours (
  id          uuid primary key default gen_random_uuid(),
  bot_id      uuid not null references bots on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time  time not null default '09:00',
  end_time    time not null default '18:00',
  -- Un hueco de 5 minutos es un error de reserva inútil.
  slot_duration_min integer not null default 30 check (slot_duration_min between 10 and 120),
  is_active   boolean not null default true,
  updated_at  timestamptz not null default now(),

  constraint un_dia_por_bot unique (bot_id, day_of_week),
  constraint hora_coherente check (end_time > start_time)
);

create index if not exists ix_bots_business_hours_bot on bots_business_hours (bot_id);

-- ---------------------------------------------------------------------
-- 7. Citas  (appointments)
--
-- LO IMPORTANTE: el EXCLUDE de abajo. En MariaDB esto se protegía en
-- el código, con una consulta antes de insertar, y dos peticiones
-- simultáneas se colaban las dos. Aquí lo resuelve la base de datos:
-- es imposible que dos citas ocupen el mismo hueco, se inserten en
-- paralelo o no.
-- ---------------------------------------------------------------------
create table if not exists bots_appointments (
  id          uuid primary key default gen_random_uuid(),
  bot_id      uuid not null references bots on delete cascade,
  customer_phone text not null,
  customer_name  text,
  appointment_date date not null,
  appointment_time time not null,
  duration_min integer not null default 30 check (duration_min between 5 and 480),
  -- 'pending' | 'confirmed' | 'canceled' | 'completed', igual que
  -- AppointmentStatus en wweb.
  status      text not null default 'pending'
              check (status in ('pending','confirmed','canceled','completed')),
  notes       text,
  reminder_24h_sent boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  /* El hueco, como rango.

     TRES detalles que costaron un rato, y que conviene no volver a
     tocar sin necesidad (probado en db/_probar-exclude.js):

     1. `make_interval(mins => duration_min)`, NO
        `(duration_min || ' minutes')::interval`. Las dos dicen lo
        mismo, pero la segunda no es IMMUTABLE (convierte texto) y el
        índice EXCLUDE la rechaza con
        'functions in index expression must be marked IMMUTABLE'.

     2. `tsrange`, NO `tstzrange`. El hueco de una cita es hora local
        del negocio, no un instante absoluto: las 10:00 de un lunes
        son las 10:00 en Madrid y en Buenos Aires. Con timestamptz el
        servidor (que corre en UTC) desplazaría las citas. Y además
        `tstzrange` sobre un timestamp sin zona tampoco es inmutable,
        por el mismo motivo.

     3. `appointment_date + appointment_time` da un timestamp sin zona,
        y eso SÍ es inmutable.

     `where (status in (...))` hace que cancelar una cita libere el
     hueco: una cita cancelada ya no bloquea. */
  constraint no_doble_reserva exclude using gist (
    bot_id with =,
    tsrange(
      appointment_date + appointment_time,
      appointment_date + appointment_time + make_interval(mins => duration_min)
    ) with &&
  ) where (status in ('pending','confirmed'))
);

comment on constraint no_doble_reserva on bots_appointments is
  'Dos citas no pueden ocupar el mismo hueco. Lo resuelve la base, no el código: en MariaDB se protegía con una consulta previa y dos peticiones simultáneas se colaban. Cancelar una cita libera el hueco porque el filtro where solo mira las pendientes y confirmadas.';

create index if not exists ix_bots_appointments_bot on bots_appointments (bot_id);
create index if not exists ix_bots_appointments_fecha on bots_appointments (bot_id, appointment_date);
create index if not exists ix_bots_appointments_status on bots_appointments (status);
create index if not exists ix_bots_appointments_recordatorio on bots_appointments (status, appointment_date, reminder_24h_sent);

drop trigger if exists trg_touch_bots_appointments on bots_appointments;
create or replace trigger trg_touch_bots_appointments
  before update on bots_appointments
  for each row execute function bot_touch_updated_at();

-- ---------------------------------------------------------------------
-- 8. Catálogo y pedidos
-- ---------------------------------------------------------------------
create table if not exists bots_catalog_items (
  id          uuid primary key default gen_random_uuid(),
  bot_id      uuid not null references bots on delete cascade,
  label       text not null,
  description text,
  price_cents integer not null default 0 check (price_cents >= 0),
  active      boolean not null default true,
  sort_order  integer not null default 0,
  category    text,
  -- La foto es lo que más pesa en la venta de un comercio pequeño: la
  -- descripción sin imagen no convence a nadie.
  image_url   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists ix_bots_catalog_items_bot on bots_catalog_items (bot_id, active, sort_order);

create table if not exists bots_orders (
  id          uuid primary key default gen_random_uuid(),
  bot_id      uuid not null references bots on delete cascade,
  customer_phone text not null,
  customer_name  text,
  catalog_item_id uuid references bots_catalog_items on delete set null,
  option_label text not null,
  -- Sin esto, comprar 3 unidades obliga a registrar 3 pedidos.
  quantity    integer not null default 1 check (quantity > 0),
  price_cents integer not null default 0 check (price_cents >= 0),
  status      text not null default 'pending'
              check (status in ('pending','completed','canceled')),
  notes       text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  completed_at  timestamptz
);

create index if not exists ix_bots_orders_bot on bots_orders (bot_id, created_at desc);
create index if not exists ix_bots_orders_status on bots_orders (status);

-- ---------------------------------------------------------------------
-- 9. Registro de webhooks entrantes
--
-- Se queda porque es lo único que permite depurar un mensaje que "no
-- llegó". Sin esto, cuando un cliente dice que el bot no contesta, no
-- hay forma de saber si el mensaje entró o si falló la firma.
-- ---------------------------------------------------------------------
create table if not exists bots_webhook_logs (
  id          uuid primary key default gen_random_uuid(),
  event_type  text not null,
  bot_id      uuid references bots on delete set null,
  payload     jsonb,
  -- 'processed' | 'failed' | 'skipped', igual que ResponseLogStatus.
  status      text not null default 'processed'
              check (status in ('processed','failed','skipped')),
  error       text,
  created_at  timestamptz not null default now()
);

create index if not exists ix_bots_webhook_logs_evento on bots_webhook_logs (event_type);
create index if not exists ix_bots_webhook_logs_status on bots_webhook_logs (status);
create index if not exists ix_bots_webhook_logs_fecha on bots_webhook_logs (created_at desc);

-- ---------------------------------------------------------------------
-- 10. RLS
--
-- La regla: un cliente ve y escribe lo de SU bot, y nada más.
--
-- Lectura y escritura van juntas (for all) para las tablas de
-- configuración: un bot sin respuestas automáticas no sirve de nada, y
-- obligar a que el panel los cree sería absurdo.
--
-- NO se puede borrar el bot desde aquí: eso lo hace el panel del
-- equipo (panel-accesos), no el cliente. Por eso la política de `bots`
-- NO es `for all` sino `for select` y `for update` con WITH CHECK,
-- dejando el borrado fuera. Si el cliente pudiera borrarse a sí mismo
-- el bot, se quedaría sin servicio y sin histórico.
-- ---------------------------------------------------------------------

-- ---------- bots: el cliente ve el suyo y lo configura ----------
alter table bots enable row level security;

drop policy if exists "leer su bot" on bots;
create policy "leer su bot"
  on bots for select to authenticated
  using (es_dueno_de_bot(id));

/* UPDATE con WITH CHECK: puede cambiar name, slug y mensajes, pero
   no puede cambiar de cliente ni de servidor. Sin el WITH CHECK, un
   `update ... set server_id = <otro>` le haría coger control de las
   instancias de otros clientes de ese servidor. */
drop policy if exists "editar su bot" on bots;
create policy "editar su bot"
  on bots for update to authenticated
  using (es_dueno_de_bot(id))
  with check (
    client_id = (select client_id from bots where id = bots.id)
    and server_id = (select server_id from bots where id = bots.id)
  );

/* Ni INSERT ni DELETE para el cliente. El alta la hace el panel del
   equipo y el borrado también. Deliberado: sin esta restricción, un
   cliente podría insertarse un bot apuntando al servidor de otro. */

-- ---------- el resto: todo pasa por es_dueno_de_bot ----------
alter table bots_responses        enable row level security;
alter table bots_response_logs    enable row level security;
alter table bots_business_hours   enable row level security;
alter table bots_appointments     enable row level security;
alter table bots_catalog_items    enable row level security;
alter table bots_orders           enable row level security;
alter table bots_webhook_logs     enable row level security;

-- Configuración: el cliente escribe.
drop policy if exists "gestionar sus respuestas" on bots_responses;
create policy "gestionar sus respuestas"
  on bots_responses for all to authenticated
  using (es_dueno_de_bot(bot_id))
  with check (es_dueno_de_bot(bot_id));

drop policy if exists "gestionar sus horarios" on bots_business_hours;
create policy "gestionar sus horarios"
  on bots_business_hours for all to authenticated
  using (es_dueno_de_bot(bot_id))
  with check (es_dueno_de_bot(bot_id));

drop policy if exists "gestionar su catalogo" on bots_catalog_items;
create policy "gestionar su catalogo"
  on bots_catalog_items for all to authenticated
  using (es_dueno_de_bot(bot_id))
  with check (es_dueno_de_bot(bot_id));

-- Registros y citas: el cliente LEE y CREA, pero no borra.
-- El histórico de un bot no se puede reescribir a posteriori: si un
-- cliente pudiera borrar sus citas, un problema de agenda quedaría sin
-- rastro y no se podría auditar nunca.
drop policy if exists "leer sus citas" on bots_appointments;
create policy "leer sus citas"
  on bots_appointments for select to authenticated
  using (es_dueno_de_bot(bot_id));

drop policy if exists "crear sus citas" on bots_appointments;
create policy "crear sus citas"
  on bots_appointments for insert to authenticated
  with check (es_dueno_de_bot(bot_id));

drop policy if exists "editar sus citas" on bots_appointments;
create policy "editar sus citas"
  on bots_appointments for update to authenticated
  using (es_dueno_de_bot(bot_id))
  with check (es_dueno_de_bot(bot_id));

drop policy if exists "leer su registro" on bots_response_logs;
create policy "leer su registro"
  on bots_response_logs for select to authenticated
  using (es_dueno_de_bot(bot_id));

drop policy if exists "leer sus pedidos" on bots_orders;
create policy "leer sus pedidos"
  on bots_orders for select to authenticated
  using (es_dueno_de_bot(bot_id));

drop policy if exists "crear sus pedidos" on bots_orders;
create policy "crear sus pedidos"
  on bots_orders for insert to authenticated
  with check (es_dueno_de_bot(bot_id));

/* El log de webhooks NO tiene política: es de diagnóstico del servidor,
   no del cliente. Se lee desde el panel del equipo con la secret key. */

-- ---------------------------------------------------------------------
-- 11. Permisos
--
-- El webhook de Evolution entra sin sesión de usuario: es Evolution
-- quien llama. Por eso el rol `authenticated` no le sirve y hace falta
-- uno propio para el servidor.
--
-- `service_role` (la secret key) salta RLS y lo usa el webhook para
-- escribir el registro. Este rol es para cuando el backend del bot
-- prefiere ir con la publishable key y no con la secreta.
--
-- OJO: dar SELECT con este rol PASA POR ALTA de es_dueno_de_bot.
-- Cualquier endpoint con service_role tiene que comprobar a quién
-- pertenece el bot_id, como ya hacía verifyUserAccess() en wweb.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'bot_servidor') then
    create role bot_servidor nologin;
  end if;
end $$;

grant usage on schema public to bot_servidor;

grant select, insert, update on
  bots, bots_responses, bots_response_logs, bots_business_hours,
  bots_appointments, bots_catalog_items, bots_orders, bots_webhook_logs
  to bot_servidor;