-- =====================================================================
-- Shopcito — Pagos con MercadoPago (migración 033)
-- =====================================================================
--
-- QUÉ MODELO ESTO
--
-- Cobrar la suscripción de un cliente (el bot, o un plan) con
-- MercadoPago, sin que nadie tenga que marcar el cobro a mano.
--
-- La pieza de negocio ya está: cuando un cobro se confirma,
-- `confirmarPago()` (lib/pagos.js) activa el servicio y da de alta el
-- bot. Lo que faltaba era que el pago llegara SOLO.
--
-- ── POR QUÉ SUSCRIPCIÓN (preapproval) Y NO UN LINK SUELTO ──
--
-- Porque el producto se cobra todos los meses. Con un link, el cliente
-- paga cuando se acuerda, y el mes que se olvida hay que perseguirlo.
-- Con una suscripción, autoriza la tarjeta UNA vez y MercadoPago le
-- cobra solo. Es lo que el negocio pidió.
--
-- ── TRES TABLAS, Y POR QUÉ CADA UNA ──
--
--   integraciones     Las credenciales de MercadoPago (Access Token,
--                     Public Key, clave del webhook). Solo las lee el
--                     servidor. Se editan desde /panel/configuracion.
--
--   suscripciones_mp  Qué suscripción de MercadoPago corresponde a qué
--                     servicio. Es el puente `preapproval_id` <->
--                     `services.id`, y permite cancelar o consultar.
--
--   pagos_mp          Un registro por pago que llega del webhook, con
--                     el `mp_id` ÚNICO. Sin esta tabla, una notificación
--                     repetida (MercadoPago reintenta hasta 3 veces)
--                     marcaría el mismo cobro como pagado dos veces y
--                     alargaría el servicio de más.
--
-- ── LO QUE NO SE HACE AQUÍ ──
--
-- No se guarda la tarjeta de nadie: eso vive en MercadoPago. Aquí solo
-- hay ids y montos. Y las credenciales van en claro como `api_key` de
-- Evolution (migración 011): las usa el servidor tal cual, y las tablas
-- no tienen RLS a propósito para que el navegador no llegue.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Las credenciales
-- ---------------------------------------------------------------------
create table if not exists integraciones (
  clave          text primary key,
  activo         boolean not null default false,

  -- test = credenciales de prueba; prod = las de producción. Un campo
  -- y no dos juegos de claves: se cambia de uno a otro guardando el
  -- token que toca, y así no hay duda de cuál está en uso.
  modo           text not null default 'test' check (modo in ('test', 'prod')),

  -- Access Token (privado, backend) y Public Key (público, frontend).
  access_token   text,
  public_key     text,

  -- Clave secreta del webhook: con ella se valida el `x-signature`.
  webhook_secret text,

  actualizado_en timestamptz not null default now()
);

comment on table integraciones is
  'Credenciales de servicios externos (MercadoPago...). Solo las lee el servidor; el navegador no las alcanza. El access_token va en claro porque hace falta tal cual para firmar las llamadas a la API, igual que la api_key de evolution_servers.';

comment on column integraciones.webhook_secret is
  'Clave secreta del webhook de MercadoPago. Se usa para validar el HMAC del header x-signature. Sin esto, cualquiera que descubra la URL podría mandar notificaciones falsas de pago.';

alter table integraciones enable row level security;
-- Sin políticas a propósito (como evolution_servers): el rol del
-- navegador no llega, solo la secret key del servidor.

-- ---------------------------------------------------------------------
-- 2. La suscripción de MercadoPago de un servicio
-- ---------------------------------------------------------------------
create table if not exists suscripciones_mp (
  id             uuid primary key default gen_random_uuid(),

  -- A qué servicio y a qué cliente corresponde. on delete cascade: si
  -- se borra el servicio, su suscripción no tiene a qué apuntar.
  service_id     uuid references services on delete cascade,
  client_id      uuid not null references clients on delete cascade,

  -- El id del preapproval en MercadoPago. Único: una suscripción de MP
  -- no puede apuntar a dos servicios.
  preapproval_id text not null unique,

  -- pending | authorized | paused | cancelled (lo que diga MercadoPago).
  estado         text not null default 'pending',

  monto          numeric(12,2),
  moneda         text,

  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create unique index if not exists suscripciones_mp_service_unico
  on suscripciones_mp (service_id) where service_id is not null;
create index if not exists suscripciones_mp_client on suscripciones_mp (client_id);

comment on table suscripciones_mp is
  'El puente entre una suscripción de MercadoPago (preapproval) y el servicio que paga. external_reference del preapproval lleva el service_id, y esto lo guarda para poder consultar o cancelar.';

alter table suscripciones_mp enable row level security;

-- ---------------------------------------------------------------------
-- 3. Los pagos que confirma el webhook
-- ---------------------------------------------------------------------
create table if not exists pagos_mp (
  id             uuid primary key default gen_random_uuid(),

  -- `mp_id` es el id del pago en MercadoPago. ÚNICO: es lo que hace
  -- que reintentar una notificación no cobre dos veces.
  mp_id          text not null unique,
  preapproval_id text,

  service_id     uuid references services on delete set null,
  client_id      uuid references clients on delete set null,

  monto          numeric(12,2),
  moneda         text,
  estado         text,
  pagado_en      timestamptz,

  -- El cuerpo tal cual llegó de MercadoPago, por si hay que explicar un
  -- cobro. Sin datos de tarjeta: eso nunca llega hasta aquí.
  bruto          jsonb,

  creado_en      timestamptz not null default now()
);

create index if not exists pagos_mp_preapproval on pagos_mp (preapproval_id);
create index if not exists pagos_mp_service on pagos_mp (service_id);

comment on table pagos_mp is
  'Un registro por pago confirmado por el webhook de MercadoPago. El mp_id único evita que una notificación repetida (MercadoPago reintenta) marque el mismo cobro dos veces.';

alter table pagos_mp enable row level security;

-- ---------------------------------------------------------------------
-- 4. Arranque
-- ---------------------------------------------------------------------
-- La fila de MercadoPago nace vacía y desactivada. Se rellena desde
-- /panel/configuracion. Tenerla creada evita ramas de "no existe" en el
-- código: siempre hay una fila que leer.
insert into integraciones (clave) values ('mercadopago')
on conflict (clave) do nothing;
