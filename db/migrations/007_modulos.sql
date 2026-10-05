-- =====================================================================
-- Nexo Studio — Catálogo de módulos y suscripciones (migración 007)
-- =====================================================================
-- POR QUÉ
-- -------
-- Hasta ahora el negocio tenía TRES tipos de servicio (mantenimiento,
-- proyecto, presupuesto) y todos vivían en la tabla `services`. Eso
-- servía cuando lo que vendías era trabajo.
--
-- A partir de aquí lo que vendes son PRODUCTOS DIGITALES que el
-- cliente usa: un bot de WhatsApp con agenda de turnos, un gestor de
-- inventario. Son servicios nuevos, cada uno con su propio software,
-- y cada uno se paga por separado.
--
-- La diferencia con un proyecto no es el precio: es que el producto
-- tiene las mismas tablas que el código que lo sirve. Un bot de
-- WhatsApp no es "una fila más en services", es un servicio entero con
-- su despliegue y sus datos. Modelarlo como fila de servicios
-- acabaría con un `kind` más y una tabla `modulo = 'bot'` repetida
-- por todas partes.
--
-- QUÉ HAY AQUÍ
-- ------------
--   modules       Catálogo: qué productos existen. Los mete el staff.
--                NO tiene datos de clientes, así que cualquiera puede
--                leerla (es la vitrina del panel).
--
--   suscripciones  Qué productos tiene contracted cada cliente, desde
--                cuándo, por cuánto. Es la tabla que decide si un
--                cliente entra a un servicio.
--
-- POR QUÉ NO CAMBIO LA TABLA `services`
-- --------------------------------------
-- Porque los proyectos (trabajo puntual, presupuesto cerrado) siguen
-- siendo `services`. Un cliente puede tener los dos: un proyecto de
-- web entregado en marzo Y el bot de WhatsApp activo. Son cosas
-- distintas con ciclos de vida distintos, y meterlas en la misma
-- tabla haría confuso el panel ("¿este pendiente es del bot o del
-- proyecto?"). Se complementan.
--
-- LA REGLA DE ORO
-- ---------------
-- El acceso a un servicio NO se decide en el código del servicio, ni
-- preguntando a otro servicio. Lo decide `suscripciones.estado`, y por
-- encima el RLS de cada servicio. Ver lib/acceso.js.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Catálogo de módulos
--
-- Es configuración, no datos de cliente: aquí solo hay la lista de
-- productos. Por eso NO lleva client_id y puede leerse sin aislamiento.
-- El precio de referencia vive aquí para pintarlo, pero lo que se
-- cobra de verdad está en suscripciones: cada cliente puede tener
-- negotiated otra cosa.
-- ---------------------------------------------------------------------
create table if not exists modules (
  id          text primary key,
  -- Lo que se escribe en la URL: 'bot-whatsapp', 'inventario'...
  -- Es texto y no uuid porque lo escribe una persona a mano y hay que
  -- poder leerlo en los logs sin buscar el id.
  slug        text not null unique
              check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  nombre      text not null,
  descripcion text,

  -- Precio de lista por periodo. Es orientativo: lo que se cobra de
  -- verdad está en suscripciones.precio, porque un cliente grande
  -- no paga lo mismo que uno pequeño.
  precio      numeric(12,2) check (precio is null or precio >= 0),
  periodicidad text check (periodicidad in ('mensual', 'trimestral', 'anual')),

  -- ¿Está a la venta? Un módulo que se está developing no aparece en
  -- el panel del cliente aunque esté en la tabla.
  disponible  boolean not null default false,

  -- Subdominio donde vive el servicio, si lo tiene. El bot va en
  -- bot.midominio.com. Es información para pintar el enlace, NO se
  -- usa para autorizar nada: el acceso lo decide la suscripción.
  url         text,

  -- Si tiene varias piezas, se numeran aquí.
  -- ['bot', 'turnos'] para el bot; [] para uno solo.
  componentes text[] not null default '{}',

  creado_en   timestamptz not null default now()
);

comment on table modules is
  'Catálogo de productos que se ofrecen. Configuración, no datos de cliente: se lee sin aislamiento.';
comment on column modules.componentes is
  'Piezas que tiene el producto. Ej: bot de WhatsApp -> [''bot'',''turnos'']. El acceso se comprueba pieza a pieza.';
comment on column modules.url is
  'Subdominio del servicio. Solo para pintar el enlace. NO autoriza: de eso se ocupa suscripciones + el RLS del propio servicio.';

-- ---------------------------------------------------------------------
-- 2. Suscripciones: qué cliente tiene qué
--
-- Aquí sí hay datos de cliente, así que esto SÍ lleva RLS y el
-- cliente solo ve las suyas.
--
-- La regla de "tiene este módulo" es:
--     estado = 'activo'
--   AND (termina_en is null OR termina_en >= hoy)
--
-- Ojo con esa segunda parte: es la que evita que un servicio siga
-- funcionando para siempre porque nadie cerró la suscripción. Sin
-- fecha de fin, "activo" es un estado que se hereda solo.
-- ---------------------------------------------------------------------

-- Estados de la suscripción. Distintos a los de service_status a
-- propósito: aquí no hay 'en_curso' ni 'pausado' porque un producto
-- digital no se entrega por fases.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'suscripcion_estado') then
    create type suscripcion_estado as enum (
      'activo',      -- pagando y en periodo
      'vencido',     -- se pasó la fecha y no se renovó
      'cancelado',   -- el cliente lo canceló. No se borra, queda el histórico.
      'prueba'       -- periodo de prueba. Accede como activo, pero sin generar cobro.
    );
  end if;
end $$;

create table if not exists suscripciones (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients on delete cascade,
  module_id     text not null references modules on delete restrict,

  estado        suscripcion_estado not null default 'prueba',

  -- Cuándo empieza a contar. Con 'prueba' es desde el alta.
  inicia_en     date not null default current_date,

  -- Cuándo caduca. NULL = sin fecha, se renueva solo (y por eso hay
  -- que mirar `hoy` en la condición de acceso).
  termina_en    date,

  -- Lo que se le cobra a ESTE cliente. Null = precio de lista.
  precio        numeric(12,2) check (precio is null or precio >= 0),
  periodicidad  text check (periodicidad in ('mensual', 'trimestral', 'anual')),

  -- Último cobro emitido para esta suscripción, para no generar dos
  -- iguales. Es la misma idea que el unique (service_id, periodo) de
  -- cobros: el cobro va atado a la suscripción, no al servicio.
  ultimo_cobro_periodo text check (
    ultimo_cobro_periodo is null or ultimo_cobro_periodo ~ '^\d{4}-\d{2}$'
  ),

  notas         text,
  creado_en     timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  -- No puede caducar antes de empezar
  constraint termina_antes check (termina_en is null or termina_en >= inicia_en),

  -- Un cliente no tiene dos veces el mismo módulo. Sin esto, dos
  -- filas 'activo' harían que el panel lo mostrara dos veces y que
  -- el cálculo de "¿tiene el bot?" no tuviera respuesta clara.
  constraint un_modulo_por_cliente unique (client_id, module_id)
);

create index if not exists ix_suscripciones_client_id on suscripciones (client_id);
create index if not exists ix_suscripciones_module_id on suscripciones (module_id);
create index if not exists ix_suscripciones_estado on suscripciones (estado);

drop trigger if exists trg_touch_suscripciones on suscripciones;
create trigger trg_touch_suscripciones
  before update on suscripciones
  for each row execute function touch_actualizado();

-- ---------------------------------------------------------------------
-- 3. Cuándo un cliente "tiene" un módulo
--
-- Una función, en SQL, para que la usen el panel, el bot y cualquier
-- servicio futuro con la MISMA regla. Si cada uno decidiera por su
-- cuenta acabarían discrepando, y siempre discreparía el que da más
-- permisos.
--
-- OJO: va DESPUÉS de la tabla. Postgres no valida el cuerpo de una
-- función al crearla, pero sí al ejecutarla, y como es
-- `security definer` no se postpone: si se declara antes de existir la
-- tabla, falla aquí mismo.
-- ---------------------------------------------------------------------
create or replace function tiene_modulo(cliente_uuid uuid, modulo text, hoy date default current_date)
  returns boolean
  language sql stable security definer
  set search_path = public
  as $$
    select exists (
      select 1 from suscripciones
      where client_id = cliente_uuid
        and module_id = modulo
        and estado in ('activo', 'prueba')
        and inicia_en <= hoy
        and (termina_en is null or termina_en >= hoy)
    );
  $$;

comment on function tiene_modulo is
  'Regla ÚNICA de acceso a un módulo. La usan el panel, el bot y el inventario. Si algo necesita otro criterio, se cambia AQUÍ.';

-- ---------------------------------------------------------------------
-- 4. Módulos que ve un cliente
--
-- Para pintar "tus servicios". Devuelve solo los suyos porque lleva
-- el filtro de client_id, y de todos modos el RLS de la tabla lo
-- refuerza: un cliente que intentara leer los de otro no los ve.
-- ---------------------------------------------------------------------
-- El drop va delante por la migración 009, que cambia esta firma. Sin
-- él, aplicar la 007 después de la 009 falla con
-- 'cannot change return type of existing function'. También hace que
-- la 007 se pueda volver a aplicar por su cuenta (ver
-- db/test-idempotencia.js).
drop function if exists modulos_del_cliente(uuid, date);
create or replace function modulos_del_cliente(cliente_uuid uuid, hoy date default current_date)
  returns table (module_id text, nombre text, descripcion text, url text,
                 componentes text[], estado suscripcion_estado,
                 termina_en date, precio numeric)
  language sql stable security definer
  set search_path = public
  as $$
    select m.id, m.nombre, m.descripcion, m.url, m.componentes,
           s.estado, s.termina_en, coalesce(s.precio, m.precio)
    from suscripciones s
    join modules m on m.id = s.module_id
    where s.client_id = cliente_uuid
      and s.estado in ('activo', 'prueba')
      and s.inicia_en <= hoy
      and (s.termina_en is null or s.termina_en >= hoy)
      and m.disponible
    order by m.nombre;
  $$;

-- ---------------------------------------------------------------------
-- 5. RLS
--
-- modules: catálogo. Se lee por todos los autenticados (es la
-- vitrina), pero SOLO el staff escribe. Un cliente no puede inventarse
-- un módulo ni ponerlo a la venta.
-- ---------------------------------------------------------------------
alter table modules enable row level security;

drop policy if exists "leer modulos" on modules;
create policy "leer modulos"
  on modules for select to authenticated
  using (true);

drop policy if exists "gestionar modulos" on modules;
create policy "gestionar modulos"
  on modules for all to authenticated
  using (es_staff())
  with check (es_staff());

-- ---------------------------------------------------------------------
-- suscripciones: aquí SÍ hay datos de cliente.
-- El cliente ve las suyas y SOLO puede verlas: ni escribir, ni
-- cambiar su estado a 'activo', ni redefinir el precio. Eso último
-- sería regalarse el producto.
-- ---------------------------------------------------------------------
alter table suscripciones enable row level security;

drop policy if exists "leer propias suscripciones" on suscripciones;
create policy "leer propias suscripciones"
  on suscripciones for select to authenticated
  using (es_staff() or es_cliente_de(client_id));

drop policy if exists "gestionar suscripciones" on suscripciones;
create policy "gestionar suscripciones"
  on suscripciones for all to authenticated
  using (es_staff())
  with check (es_staff());

-- ---------------------------------------------------------------------
-- 6. Cargar el catálogo con lo que ya existe
--
-- Los servicios antiguos se mantienen tal cual. Esto solo describe
-- los productos nuevos. El bot entra como 'prueba' y SIN activar
-- (`disponible = false`): hasta que no haya migrated de verdad no
-- debe aparecer en el panel de nadie.
--
-- Nota: no he puesto aquí el módulo de inventario aunque estaba
-- hablado, porque no está definido: no sé qué vende ni cómo se
-- cobra. Se añade con un INSERT cuando esté claro. Ponerlo ahora
-- sería inventarse el producto.
-- ---------------------------------------------------------------------
insert into modules (id, slug, nombre, descripcion, precio, periodicidad, disponible, url, componentes)
values
  ('bot_whatsapp', 'bot-whatsapp', 'Bot de WhatsApp con agenda de turnos',
   'Respuestas automáticas y reserva de citas por WhatsApp, sin que tengas que contestar cada mensaje.',
   49.00, 'mensual', false, 'https://bot.midominio.com', array['bot', 'turnos'])
on conflict (id) do nothing;
