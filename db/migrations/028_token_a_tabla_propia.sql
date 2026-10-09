-- =====================================================================
-- Shopcito — El token de instancia va a su propia tabla (028)
-- =====================================================================
--
-- POR QUÉ ESTA MIGRACIÓN EXISTE
--
-- Porque la 027 no sirvió, y está bueno dejar escrito por qué.
--
-- La 027 revocaba el SELECT de la columna `bots.instance_token` a
-- `authenticated`. Suena a que funciona. No funciona: en Postgres, si
-- hay un permiso de TABLA completo, concede todas las columnas, y
-- quitar una columna no lo reduce.
--
-- Comprobado en esta base:
--
--   tabla `bots`, permisos de authenticated: SELECT sobre la TABLA
--   tabla `bots`, permisos de columna sobre instance_token: SELECT
--
-- Con el permiso de tabla, la columna sale igual. Un cliente
-- autenticado lee su fila entera, token incluido.
--
-- ── POR QUÉ ESO IMPORTA ──
--
-- El token de una instancia sirve para hablar con Evolution de ESA
-- instancia: leer sus conversaciones, mandar mensajes en su nombre,
-- cambiarle su webhook.
--
-- Con el token en la fila, un cliente puede manejar su bot sin pasar
-- por el panel. Y si el panel va a ser el único camino, deja de serlo.
--
-- Peor aún: ese token no caduca. La clave global por lo menos se puede
-- rotar; un token filtrado —en un log, en una captura, en un backup—
-- sirve para siempre y no hay forma de saber que se filtró.
--
-- ── EL PATRÓN QUE SÍ FUNCIONA ──
--
-- Ya existe en el proyecto: `evolution_servers` tiene RLS activado y
-- CERO políticas. Con RLS activo y ninguna política que conceda nada,
-- todas las filas quedan ocultas para `anon` y `authenticated`. Solo
-- llega el service key, que se salta el RLS.
--
-- Se copia tal cual. Y es mejor que revocar permisos por columnas
-- porque:
--
--   · no hay que acordarse de qué columnas hay;
--   · añadir una columna nueva después no abre nada por accidente;
--   · no hay que volver a conceder permisos si alguien toca los default.
--
-- ── POR QUÉ NO SE QUITA `evolution_servers` DE AQUÍ ──
--
-- Porque su clave es de la CAJA: se lee una vez y sirve para hablar de
-- todo lo de esa caja. El token es de una INSTANCIA, que es una fila
-- distinta. Confundir las dos es lo que lleva a guardar la clave de un
-- cliente junto a sus datos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- La tabla
-- ---------------------------------------------------------------------

create table if not exists evolution_instancias (
  instance_name text primary key,
  token         text,
  nota          text,
  actualizado   timestamptz not null default now()
);

comment on table evolution_instancias is
  'Token de cada instancia de Evolution. Es de la INSTANCIA, no de la caja: por eso va en su propia tabla y no en bots, que el cliente sí lee. RLS sin políticas: solo el service key la ve.';
comment on column evolution_instancias.token is
  'Token de la instancia. Nulo significa «no se sabe»: el bot usa entonces la clave global del servidor.';

-- ---------------------------------------------------------------------
-- Que nadie del navegador la lea
-- ---------------------------------------------------------------------

alter table evolution_instancias enable row level security;

-- SIN políticas, a propósito. No es un olvido: una política de SELECT
-- para el service key tampoco hace falta, porque el service key se
-- salta el RLS. Cualquier política que se añada aquí tiene que
-- justificarse en un comentario, porque abrir esta tabla es abrir los
-- chats de los clientes.

-- ---------------------------------------------------------------------
-- Mudar lo que haya
-- ---------------------------------------------------------------------

insert into evolution_instancias (instance_name, token)
select instance_name, instance_token
  from bots
 where instance_token is not null
on conflict (instance_name) do update
  set token = excluded.token,
      actualizado = now();

-- ---------------------------------------------------------------------
-- Y `bots` se queda sin credenciales
-- ---------------------------------------------------------------------

alter table bots drop column if exists instance_token;