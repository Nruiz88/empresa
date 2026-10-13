-- =====================================================================
-- Shopcito — El acceso también sale de `services` (migración 032)
-- =====================================================================
--
-- QUÉ PASA
-- --------
-- Hay dos maneras de darle a un cliente acceso a un microservicio:
--
--   · `suscripciones` (migración 007), que es el modelo viejo: un
--     módulo por cliente, con estado y fecha de fin;
--   · `services` (migraciones 029/030), que es el modelo nuevo: una
--     aplicación suelta o un plan, que da acceso a sus aplicaciones.
--
-- La REGLA ÚNICA de acceso (`tiene_modulo`) y la lista que ve el
-- cliente en su portal (`modulos_del_cliente`) solo miraban
-- `suscripciones`. Consecuencia: asignar el bot de WhatsApp desde
-- /panel/aplicaciones guardaba el `services` y el bot quedaba sin
-- crear y sin aparecer en el portal. El cliente tenía el producto
-- contratado y no podía entrar, y la culpa no estaba ni en el bot ni
-- en el ticket: estaba en que la regla de acceso no conocía la mitad
-- nueva del sistema.
--
-- QUÉ HACE
-- --------
-- Suma `services` a las dos funciones. La regla sigue viviendo en un
-- solo sitio (aquí), que es lo que evita que el panel, el bot y el
-- portal decidan cosas distintas.
--
-- POR QUÉ NO SE COPIA `services` A `suscripciones`
-- -------------------------------------------------
-- Porque sería una copia. Un servicio por plan da acceso a las
-- aplicaciones QUE DIGA EL PLAN, y si se copiaran, cambiar el plan
-- obligaría a recorrer a todos los clientes y alguno se quedaría atrás
-- sin que nadie lo notara. Ya lo dice la migración 030: se guarda el
-- acceso y se CALCULA lo que incluye.
--
-- LOS 15 DÍAS DE MARGEN
-- ---------------------
-- `lib/aplicaciones.js` da 15 días de gracia después de `termina_en`:
-- si cortara en seco, un cliente que se olvidó de pagar un mes perdía
-- el número de golpe, y el que pierde el número no vuelve. El acceso
-- de `services` respeta el mismo margen. En `suscripciones` se deja
-- como estaba (`termina_en >= hoy`) para no cambiar de golpe un
-- derecho que ya estaba dado; el número 15 está repetido a propósito
-- y apunta a `DIAS_DE_MARGEN`, que es donde vive.
--
-- LO QUE NO SE TOCA
-- -----------------
-- `suscripciones` sigue dando acceso igual que antes. Esto solo SUMA.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. tiene_modulo(): la regla de acceso, ahora con los dos modelos
-- ---------------------------------------------------------------------
-- `create or replace` conserva la firma y los GRANT, así que el rol
-- `bot_servidor` (migración 013) sigue pudiendo ejecutarla sin que
-- haya que volver a conceder nada.
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
    )
    or exists (
      select 1
      from services s
      where s.client_id = cliente_uuid
        /* `activo` y `en_curso`: es lo que `lib/acceso.js` considera
           "en marcha". Un servicio pausado, finalizado o cancelado no
           da acceso, y un presupuesto pendiente tampoco: es una
           oferta, no un contrato. */
        and s.estado in ('activo', 'en_curso')
        /* Sin fecha de inicio se cuenta como vigente ya: un servicio
           dado de alta sin fecha y activo está en marcha. */
        and (s.inicia_en is null or s.inicia_en <= hoy)
        /* El margen de `lib/aplicaciones.js`. */
        and (s.termina_en is null or s.termina_en >= hoy - 15)
        and (
          /* Aplicación suelta. */
          s.microservicio_clave = modulo
          /* O un plan que incluya ese módulo. */
          or exists (
            select 1 from plans p
            where p.id = s.plan_id
              and modulo = any (p.aplicaciones)
          )
        )
    );
  $$;

comment on function tiene_modulo is
  'Regla ÚNICA de acceso a un módulo. Mira `suscripciones` (modelo viejo) y `services` + `plans.aplicaciones` (modelo nuevo). Los services usan 15 días de margen (ver DIAS_DE_MARGEN en lib/aplicaciones.js). La usan el panel, el bot y el inventario. Si algo necesita otro criterio, se cambia AQUÍ.';

-- ---------------------------------------------------------------------
-- 2. modulos_del_cliente(): lo mismo, para que el portal lo enseñe
-- ---------------------------------------------------------------------
-- Sin esto, `tiene_modulo` diría que el cliente SÍ puede entrar pero el
-- portal no le pintaría la tarjeta del bot: seguiría diciendo "no
-- tienes nada". Es la misma contradicción que arregló la migración 009,
-- y por eso las dos funciones se cambian juntas.
--
-- Tres fuentes, en este orden de preferencia:
--   1. suscripciones       (lo viejo, manda)
--   2. services sueltos    (aplicación)
--   3. aplicaciones de un plan
-- Se unen con UNION y se queda UNA fila por módulo con DISTINCT ON. Se
-- prefiere la suscripción y, entre varias, la que vence más tarde (o la
-- que no vence), que es la que da más derecho.
create or replace function modulos_del_cliente(cliente_uuid uuid, hoy date default current_date)
  returns table (module_id text, nombre text, descripcion text, url text,
                 componentes text[], estado suscripcion_estado,
                 termina_en date, precio numeric, retirado boolean)
  language sql stable security definer
  set search_path = public
  as $$
    with accesos as (
      select s.module_id as mid,
             s.estado,
             s.termina_en,
             coalesce(s.precio, m.precio) as precio,
             0 as prioridad
      from suscripciones s
      join modules m on m.id = s.module_id
      where s.client_id = cliente_uuid
        and s.estado in ('activo', 'prueba')
        and s.inicia_en <= hoy
        and (s.termina_en is null or s.termina_en >= hoy)

      union all

      select s.microservicio_clave,
             'activo'::suscripcion_estado,
             s.termina_en,
             s.importe,
             1
      from services s
      join modules m on m.id = s.microservicio_clave
      where s.client_id = cliente_uuid
        and s.estado in ('activo', 'en_curso')
        and s.microservicio_clave is not null
        and (s.inicia_en is null or s.inicia_en <= hoy)
        and (s.termina_en is null or s.termina_en >= hoy - 15)

      union all

      select app.key,
             'activo'::suscripcion_estado,
             s.termina_en,
             s.importe,
             1
      from services s
      join plans p on p.id = s.plan_id
      cross join lateral unnest(p.aplicaciones) as app(key)
      join modules m on m.id = app.key
      where s.client_id = cliente_uuid
        and s.estado in ('activo', 'en_curso')
        and (s.inicia_en is null or s.inicia_en <= hoy)
        and (s.termina_en is null or s.termina_en >= hoy - 15)
    ),
    uno as (
      select distinct on (a.mid)
             a.mid, a.estado, a.termina_en, a.precio
      from accesos a
      order by a.mid, a.prioridad, a.termina_en desc nulls first
    )
    select u.mid, m.nombre, m.descripcion, m.url, m.componentes,
           u.estado, u.termina_en, u.precio, m.retirado
    from uno u
    join modules m on m.id = u.mid
    order by m.retirado, m.nombre;
  $$;

comment on function modulos_del_cliente is
  'Módulos que TIENE el cliente, por suscripción o por servicio (aplicación suelta o plan). No filtra por disponible: eso es de la tienda, no del acceso.';
