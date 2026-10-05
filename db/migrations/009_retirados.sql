-- =====================================================================
-- Nexo Studio — Un módulo no a la venta sigue siendo suyo (009)
-- =====================================================================
-- EL PROBLEMA
-- -----------
-- La función modulos_del_cliente() (007) filtraba por
-- `modules.disponible = true`:
--
--     and m.disponible
--
-- Pero tiene_modulo() —la función que decide si el cliente PUEDE
-- entrar al servicio— NO filtra por eso.
--
-- El resultado era una contradicción:
--
--   · El cliente tiene una suscripción activa → puede entrar al bot
--     (tiene_modulo() devuelve true, el ticket se acepta)
--   · Pero el módulo ya no está 'disponible' → el portal no le
--     muestra nada, ni el botón de abrir
--
-- O sea: el cliente tenía acceso a algo que no veía, y la página de
-- "mis servicios" le decía que no tenía nada. Con el tiempo alguien
-- reportaría "no me aparece mi bot" y la causa no estaría en el bot.
--
-- QUÉ ESTABA MAL DE FONDO
-- -----------------------
-- `disponible` significa "está a la venta": es una decisión de
-- marketing, para el catálogo. No significa "está en servicio".
--
-- Mezclarlas hace que dejar de anunciar algo revoca lo que ya
-- está pago. Y justo eso es lo que no debe pasar: si un cliente te
-- ha pagado el mes, el producto tiene que seguir ahí hasta que se
-- le acabe el periodo.
--
-- EL ARREGLO
-- ----------
-- La función devuelve los módulos que el cliente tiene, ESTE O NO A LA
-- VENTA. El filtro de "a la venta" se queda donde pertenece: en el
-- catálogo (routes/panel-portal.js, que ya hace
-- `.eq('disponible', true)`).
--
-- Un campo nuevo, `retirado`, marca los que se dejan de dar. Un
-- cliente con uno retirado lo sigue viendo en su portal, con una
-- etiqueta, pero ya no aparece en la tienda para nadie nuevo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. El campo nuevo
--
-- Va PRIMERO, antes que la función: la función lo usa en su cuerpo, y
-- como es security definer Postgres valida las columnas al crearla.
-- Si la columna no existe todavía, falla con
-- 'column m.retirado does not exist'.
-- ---------------------------------------------------------------------
alter table modules
  add column if not exists retirado boolean not null default false;

comment on column modules.retirado is
  'true = ya no se ofrece a nuevos clientes, pero los que lo tienen siguen usándolo. NO confundas con disponible: disponible es si aparece en la tienda.';

-- ---------------------------------------------------------------------
-- 2. La función, ya sin el filtro de 'disponible'
-- ---------------------------------------------------------------------

-- OJO: hay que dropearla antes. `create or replace function` NO puede
-- cambiar el tipo de retorno de una función que ya existe, y aquí
-- cambia (se añaden dos columnas). Sin el drop falla con
-- 'cannot change return type of existing function'.
drop function if exists modulos_del_cliente(uuid, date);

create function modulos_del_cliente(cliente_uuid uuid, hoy date default current_date)
  returns table (module_id text, nombre text, descripcion text, url text,
                 componentes text[], estado suscripcion_estado,
                 termina_en date, precio numeric, retirado boolean)
  language sql stable security definer
  set search_path = public
  as $$
    select m.id, m.nombre, m.descripcion, m.url, m.componentes,
           s.estado, s.termina_en, coalesce(s.precio, m.precio),
           m.retirado
    from suscripciones s
    join modules m on m.id = s.module_id
    where s.client_id = cliente_uuid
      and s.estado in ('activo', 'prueba')
      and s.inicia_en <= hoy
      and (s.termina_en is null or s.termina_en >= hoy)
    order by m.retirado, m.nombre;
  $$;

comment on function modulos_del_cliente is
  'Módulos que TIENE el cliente. No filtra por disponible: eso es de la tienda, no del acceso. Un cliente con un módulo retirado lo sigue viendo hasta que caduque su suscripción.';

-- Campo nuevo, para lo que ya no se vende pero sigue funcionando.
-- (la columna y su comentario están arriba, antes de la función)

-- Los que ya estaban a false (en desarrollo) también están retirados:
-- no se venden y no funcionan para nadie todavía.
update modules set retirado = true where disponible = false and retirado = false;
