-- =====================================================================
-- Nexo Studio — Cupos de los servidores de bots (migración 021)
-- =====================================================================
--
-- QUÉ AÑADE
-- --------
--   evolution_servers.max_instances  cuántos números caben en la caja
--   evolution_servers.activo         si se puede asignar bots a ella
--   evolution_servers.notas          nota interna del equipo
--
-- POR QUÉ HACE FALTA UNA MIGRACIÓN Y NO UNA CONSTANTE EN EL CÓDIGO
-- ------------------------------------------------------------------
-- El reparto de bots a servidores estaba implícito: no existía, y se
-- hacía a mano con la terminal. Ahora la asignación es automática
-- (lib/bots.js) y la pregunta es "¿en qué caja entra este?".
--
-- Con un tope fijo en el código (10) la respuesta sería siempre la
-- misma, y además mentiría: el tope depende de CADA Evolution. Una caja
-- de pago aguanta más números que una gratis, y una caja que responde a
-- medias no aguanta ninguno. Si el número no está en la fila, nadie lo
-- puede cambiar sin tocar código y desplegar.
--
--
-- ?? LA MIGRACIÓN 011 DECÍA OTRA COSA, Y ERA FALSA
-- ---------------------------------------------------
-- El comentario de `bots.server_id` (migración 015) decía, textual:
-- "UNA CAJA POR CLIENTE". Con un cliente por caja, `max_instances`
-- sobraría: siempre valdría 1.
--
-- Eso no es lo que hay. `evolution_servers` es una CAJA COMPARTIDA:
-- dentro viven varios números, uno por cliente, y lo que decide si cabe
-- uno más es el plan y el estado de esa caja. Por eso los cupos van en
-- la fila y no en el código.
--
-- Se corrige el comentario porque un comentario que dice lo contrario
-- de lo que hace el código es peor que no tener comentario: quien lo lea
-- se lleva la decisión equivocada, y con estos dos datos (la caja y el
-- número) equivocarse significa apuntar el bot de un cliente al
-- servidor de otro.
--
--
-- POR QUÉ `activo` Y NO BORRAR EL SERVIDOR
-- -----------------------------------------
-- `bots.server_id` es `on delete restrict`: no se puede borrar una caja
-- que tiene bots. Desactivarla es la operación real: deja de repartir,
-- pero los bots que ya viven ahí siguen hablando con ella, que es lo que
-- quiere el equipo cuando una caja se cae y hay que esperar a que la
-- repare. Borrarla dejaría bots apuntando al vacío.
--
--
-- LO QUE NO SE TOCA
-- ------------------
-- La clave (`api_key`) sigue sin cifrar y sin políticas RLS, igual que
-- en la 011. Añadir columnas no cambia quién lee la tabla: sigue siendo
-- solo el servidor con la secret key. Ver db/test-bot.js.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Los cupos
-- ---------------------------------------------------------------------
alter table evolution_servers
  add column if not exists max_instances integer;

-- Las cajas que ya existen son cajas en uso: ponerles 0 cupos
-- significaría "llena", y el reparto automático se negaría a usarlas
-- aunque tuvieran sitio de sobra. El valor por defecto es el mismo que
-- usaba el bot antes de que esto existiera (10), para no cambiar el
-- comportamiento de golpe al aplicar la migración.
update evolution_servers set max_instances = 10 where max_instances is null;

alter table evolution_servers
  alter column max_instances set not null;

alter table evolution_servers
  alter column max_instances set default 10;

-- Un tope de 0 (o negativo) es un error de escritura, no una caja
-- cerrada: una caja cerrada se marca con `activo = false`. Con 0
-- permitidos, cualquier reparto posterior elegiría esa caja y no podría
-- meter nada, y el error aparecería en el bot del cliente, no en el
-- panel.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'evolution_servers_cupos'
  ) then
    alter table evolution_servers
      add constraint evolution_servers_cupos
      check (max_instances > 0);
  end if;
end $$;

comment on column evolution_servers.max_instances is
  'Cuántos números de WhatsApp caben en esta caja. Lo decide el plan de la Evolution que hay detrás, no el código: por eso es una columna y no una constante.';

-- ---------------------------------------------------------------------
-- Si se puede asignar
-- ---------------------------------------------------------------------
alter table evolution_servers
  add column if not exists activo boolean;

update evolution_servers set activo = true where activo is null;

alter table evolution_servers
  alter column activo set not null;

alter table evolution_servers
  alter column activo set default true;

comment on column evolution_servers.activo is
  'false = no se asignan bots nuevos aquí, pero los que ya viven siguen funcionando. Para una caja caída o en cuarentena. No es lo mismo que borrar: bots.server_id es on delete restrict.';

-- ---------------------------------------------------------------------
-- Notas internas
-- ---------------------------------------------------------------------
-- Lo que hay que recordar de esta caja y no cabe en el nombre: con qué
-- cuenta está creada, qué plan paga, cuándo caduca la prueba.
alter table evolution_servers
  add column if not exists notas text;

comment on column evolution_servers.notas is
  'Solo el equipo. Con qué cuenta está la caja, qué plan paga, cuándo caduca.';

-- ---------------------------------------------------------------------
-- El secreto del webhook
-- ---------------------------------------------------------------------
-- POR QUÉ ESTÁ AQUÍ Y NO EN EL .ENV DEL PANEL
-- ---------------------------------------------
-- El secreto que Evolution manda en `x-webhook-secret` es el MISMO valor
-- que comprueba el servicio del bot (WEBHOOK_SECRET en wweb/.env.local,
-- ver src/lib/webhook-secret.ts). Y no estaba en ninguna parte de esta
-- base: `db/test-bot-real.js` ya lo leía desde evolution_servers, o sea
-- que el código lo daba por hecho y la columna no existía.
--
-- Guárdalo en la caja y no en el `.env` del panel por una razón concreta:
-- el panel es quien se lo dice a la Evolution. Si el secreto estuviera en
-- una variable de entorno del panel, la caja se configuraría con un valor
-- que el bot no comparte, y el resultado sería un bot mudo que NO da
-- ningún error: la Evolution devuelve 200, el POST se guarda y los
-- mensajes se rechazan al llegar.
--
-- Y al revés también: si está en la base, cambiarlo es una acción del
-- panel que se puede volver a aplicar a las instancias, en vez de editar
-- un fichero de un contenedor y acordarse de reenganchar N instancias.
--
-- OJO: es un SECRETO y va en claro, como `api_key`, por el mismo motivo
-- (el servidor tiene que usarlo tal cual para hablar con la caja). La
-- tabla no tiene RLS a propósito, así que un cliente no lo alcanza.
--
-- NULL = todavía no se ha configurado. El alta de un bot avisa en vez de
-- dejar una instancia que no va a recibir nada.
alter table evolution_servers
  add column if not exists webhook_secret text;

comment on column evolution_servers.webhook_secret is
  'Secreto que la Evolution manda en x-webhook-secret. Es el MISMO valor que comprueba el servicio del bot (WEBHOOK_SECRET). Va en claro como api_key por el mismo motivo: lo usa el servidor tal cual. NULL = caja sin webhook configurado todavía.';

-- ---------------------------------------------------------------------
-- Índice para el reparto
-- ---------------------------------------------------------------------
-- `reparto()` cuenta los bots de cada caja una sola vez, agrupando por
-- server_id. Sin índice, eso es un seq scan de `bots` en cada carga de
-- /panel/servidores y en cada alta. Con veinte clientes no se nota; con
-- doscientos, sí.
--
-- Ya existe ix_bots_server_id (migración 011), que es justo lo que
-- necesita el GROUP BY. No se crea otro: un índice duplicado con otro
-- nombre solo hace que haya que decidir cuál usar.
--
--
-- Lo que SÍ se corrige aquí: los comentarios que decían "una caja por
-- cliente". Ver la nota de arriba.
comment on column bots.server_id is
  'La caja de Evolution API donde vive el número de este bot. LAS CAJAS SE COMPARTEN entre varios clientes, y lo que decide si cabe uno más es evolution_servers.max_instances y .activo (ver migración 021). El equipo configura y prueba las cajas; el cliente no ve nada de esto.';

comment on table evolution_servers is
  'Cajas de Evolution API, compartidas entre varios clientes. Solo el servidor las lee: aquí están las claves, y una clave compartida da acceso a los bots de todos los clientes de esa caja. Los cupos por caja (max_instances) y si se reparte (activo) los usa lib/bots.js para decidir dónde va cada bot nuevo.';