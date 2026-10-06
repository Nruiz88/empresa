-- =====================================================================
-- Nexo Studio — Registro de microservicios (migración 016)
-- =====================================================================
-- POR QUÉ
-- -------
-- `modules` dice QUÉ se vende. No dice dónde vive el software que lo
-- sirve, y esa información sí es necesaria: la tiene el despliegue, no
-- el catálogo.
--
-- El caso que la hizo necesaria: el módulo `bot_whatsapp` estaba "a la
-- venta" con la url `https://proveedor-externo.example`, que es un
-- dominio de ejemplo de la documentación y no existe. Nadie se dio
-- cuenta, porque la url es un dato y el catálogo no la valida. Un
-- cliente que lo contrata Pulsaba "Abrir" y llegaba a la nada.
--
-- Lo mismo pasó con `reservas_web`, sin url. Y en la otra dirección:
-- un módulo desplegado y funcionando (`inventario`) seguía sin
-- ninguna forma de que el panel se enterara de que estaba vivo.
--
-- `microservicios` es el inventario de ese software: qué hay
-- desplegado, dónde, y con qué url se habla con él. Es lo que permite
-- preguntar "¿esto responde?" sin ir a Coolify.
--
-- QUÉ HAY AQUÍ
-- ------------
--   microservicios  Un servicio desplegado. Su `modulo` lo enlaza con
--                   el catálogo: dice qué producto es, para que un
--                   módulo a la venta sin microservicio detrás salte
--                   como aviso.
--
-- POR QUÉ NO ESTÁ EN `modules`
-- ---------------------------
-- Porque no son lo mismo. Un módulo puede estar retirado y seguir
-- teniendo el software desplegado (lo necesitas para los clientes que
-- lo tienen contratado), y se puede desplegar algo antes de que se
-- ponga a la venta. Meter una en la otra obliga a guardar campos que
-- no aplican a la otra, que es como se llega a que un campo valga
-- para unas filas y no para otras.
--
-- SOBRE EL SECRETO COMPARTIDO
-- ---------------------------
-- NO se guarda aquí el SERVICE_SECRET ni nada derivado de él. Se
-- guarda en el entorno de cada despliegue, y la pantalla de salud lo
-- compara preguntando a cada servicio. Guardar el secreto en la base
-- sería meterlo en un sitio donde antes no estaba, y un md5 en una
-- tabla es un(hash) que alguien acabaría intentando romper.
-- =====================================================================

create table if not exists microservicios (
  id          uuid primary key default gen_random_uuid(),

  -- Qué módulo del catálogo sirve. Sin esto la fila no se puede
  -- enlazar con lo que se vende.
  modulo      text not null references modules(id) on delete cascade,

  -- Cómo se llama en los logs y en la pantalla de salud.
  nombre      text not null,

  -- La base del sitio: sin https://, sin ruta. La pantalla le añade
  -- `/api/salud` para preguntarle cómo está.
  url_base    text not null,

  -- Si está activo, se le pregunta en la pantalla de salud. Un
  -- servicio que se apaga a propósito se marca aquí en vez de
  -- borrarse, para no perder la fila ni su historia.
  activo      boolean not null default true,

  -- Una línea de qué es esto, para que la pantalla no obligue a
  -- acordarse de memoria.
  nota        text,

  creado_en   timestamp with time zone not null default now(),
  actualizado_en timestamp with time zone not null default now()
);

-- Un servicio por módulo: el catálogo no puede tener dos software
-- distintos sirviendo el mismo producto sin que sea un error de
-- verdad, y el índice lo hace imposible en vez de confiar.
create unique index if not exists microservicios_modulo_unico
  on microservicios (modulo);

-- La pantalla de salud ordena por los que están activos primero.
create index if not exists microservicios_activo
  on microservicios (activo);

-- =====================================================================
-- RLS
-- =====================================================================
-- Misma regla que el resto del panel: esto lo lee y lo escribe el
-- servidor, con la secret key, que salta RLS. El personal entra por
-- el panel y no necesita tocar la tabla directamente.
--
-- Con RLS encendido y sin políticas, `authenticated` no llega. Es lo
-- que hizo `sessions` en su día, y esta vez a propósito desde el
-- primer momento en vez de por accidente.
alter table microservicios enable row level security;

-- =====================================================================
-- DATOS
-- =====================================================================
-- Lo que hay desplegado ahora mismo. `inventario` responde desde
-- hoy; los otros dos están en el catálogo pero no tienen software
-- detrás, y por eso se dejan como filas con `activo = false`: así la
-- pantalla puede decir "el catálogo lo vende y no hay nada detrás" en
-- vez de no decir nada.
-- =====================================================================
-- =====================================================================
-- POR QUÉ ESTO ES `do nothing` Y NO `do update`
-- -------------------------------------------------------------------
-- Aquí hubo un `on conflict (modulo) do update set url_base =
-- excluded.url_base`. Parecía lo correcto para una migración
-- idempotente, y lo era: repetirla no fallaba.
--
-- El problema es que una migración repara la FORMA y los DATOS de
-- arranque, y los datos de arranque envejecen. Esta fila se corrigió
-- a mano cuando el bot pasó a servirse desde el SaaS real, y la fila
-- volvía al dominio del despliegue borrado cada vez que se lanzaba
-- `npm test`, porque alguna prueba replaya las migraciones contra la
-- base de producción.
--
-- Es decir: `do update` hacía que una operación de mantenimiento
-- revirtiese un arreglo. Una migración no debe decidir el valor
-- actual de un dato que ya se ha corregido en producción.
--
-- Lo que cambia un dato, desde que existe el esquema, es otra
-- migración nueva. Por eso aquí solo se crea si no existe.
-- =====================================================================
-- =====================================================================
-- POR QUÉ ESTE INSERT SE CRUZA CON `modules` EN VEZ DE IR A SECO
-- -------------------------------------------------------------------
-- `microservicios.modulo` es una clave ajena a `modules`, y estas
-- filas son datos del CATÁLOGO: inventario y bot solo pueden existir
-- si esos módulos están en la tabla.
--
-- Con el insert plano, en una base recién creada —que es lo que hace
-- el test de idempotencia, que replaya todo el directorio— fallaba:
--
--   insert or update on table "microservicios" violates foreign key
--   constraint "microservicios_modulo_fkey"
--
-- Y venía de más atrás: no es que esta migración estuviera mal, es
-- que dependía de que el catálogo ya tuviera filas.
--
-- El `join` hace que se inserten solo las que corresponden a módulos
-- que existen. En producción, donde el catálogo está sembrado, se
-- insertan todas. En una base vacía, no se inserta ninguna y no hay
-- error.
--
-- Que no haya fila no es un problema invisible: la pantalla de salud
-- avisa de un módulo "a la venta" sin microservicio detrás, que es
-- justo el estado de una base donde no se ha sembrado el catálogo.
-- =====================================================================
insert into microservicios (modulo, nombre, url_base, activo, nota)
select c.modulo, c.nombre, c.url_base, c.activo, c.nota
  from (
    values
      ('inventario', 'Gestión de inventario',
       'https://inventario.panel-niconqn.duckdns.org', true,
       'Next.js 16 standalone. Entrada por /entrar, canje de ticket.'),

      ('bot_whatsapp', 'Bot de WhatsApp',
       'https://bot.empresa.panel-niconqn.duckdns.org', false,
       'Desplegado, pero la url del catálogo apunta a un dominio de ejemplo. '
       || 'Hay que corregir modules.url antes de venderlo.'),

      ('reservas_web', 'Reservas web',
       '', false,
       'En el catálogo sin url y sin software detrás todavía.')
  ) as c(modulo, nombre, url_base, activo, nota)
  join modules m on m.id = c.modulo
on conflict (modulo) do nothing;