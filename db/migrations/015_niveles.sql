-- =====================================================================
-- Los tres niveles, y quién los gestiona (015)
-- =====================================================================
-- ESTA MIGRACIÓN ES CASI TODO UN COMENTARIO
-- -----------------------------------------------------
-- Los nombres de estas tres cosas se confundían entre sí, y esa
-- confusión cuesta caro: es la razón de que dos clientes hayan podido
-- apuntar al mismo número sin que nadie se enterara.
--
-- Lo que hay:
--
--   SERVIDOR   evolution_servers
--              Una Evolution API completa. La "caja" que aloja números.
--              "Lo que se configura y se prueba como admin": URL y clave.
--              UNO POR CLIENTE. Es lo que se le asigna al cliente.
--
--   INSTANCIA  Solo existe dentro de Evolution. Es UN NÚMERO de
--              WhatsApp dentro de una caja. No está en esta base: solo
--              se guarda su NOMBRE, porque es lo único que hace falta
--              para hablar con él.
--
--   CLIENTE    clients. La empresa que contrata el bot.
--
-- LA REGLA
-- --------
--   1 caja = 1 cliente = 1 número = 1 bot
--
-- "Un servidor cada 15 clientes" quiere decir 15 CAJAS: una Evolution
-- API por cliente. No significa 15 clientes en una caja, porque dentro
-- de una caja hay 15 números y cada cliente necesita el suyo.
--
-- POR QUÉ `instance_name` NO SE VE EN NINGÚN SITIO
-- ----------------------------------------------
-- Es lo que usa el bot por dentro para hablar con Evolution:
--
--     /instance/connect/{instanceName}     ← conectar el número (el QR)
--     /message/sendText/{instanceName}      ← enviar
--     WHERE b.instance_name = ?             ← el webhook encuentra el bot
--
-- El cliente no lo ve, no lo escribe y no debería saber que existe. Se
-- queda como detalle interno. Esta migración no lo elimina: lo hace
-- único, que es lo que evita que dos clientes acaben compartiendo número.
--
-- EL BUG QUE ESTO PREVIENE
-- -------------------------
-- El webhook busca el bot así:
--
--     SELECT ... FROM bots WHERE b.instance_name = ? LIMIT 1
--
-- Sin índice único, dos bots con la misma `instance_name` son válidos en
-- la base. Cuando llegara un mensaje, el `LIMIT 1` elegiría UNO de los
-- dos sin decir cuál: los pedidos de una panadería aparecerían en el
-- panel de una ferretería, y ni un error ni un aviso. Es un fallo que no
-- se ve hasta que un cliente se queja de que ve another's pedidos, y
-- para entonces puede llevar semanas pasando.
--
-- Con el índice, la segunda panadería que intente usar `Boti 1` recibe
-- un error de la base al dar de alta el bot. Se ve en el momento, que es
-- donde se puede arreglar.
--
--
-- LO QUE NO SE HACE AQUÍ, Y POR QUÉ
-- ----------------------------------
-- No se renombra ninguna columna. `instance_name` y `server_id` se
-- quedan como están porque:
--
--   · Renombrarlas no arregla la confusión, solo la esconde en otro
--     sitio: dentro de seis meses "servidor" significará una cosa
--     distinta otra vez.
--   · `server_id` y `instance_name` son nombrestiles: describen lo que
--     son. El problema nunca fue el nombre de la columna, fue no tener
--     escrito qué nivel era cuál.
--
-- Y no se quita `instance_name` aunque el cliente no la vea, porque sin
-- ella no hay forma de encontrar el bot cuando llega un mensaje. Lo que
-- se hace es que sea único y que nadie lo escriba a mano.
-- =====================================================================


-- ---------------------------------------------------------------------
-- `instance_name` es único, y a nivel global
-- ---------------------------------------------------------------------
-- Global, no (server_id, instance_name). Se podría hacer por servidor y
-- bastaría SI el webhook фильтara por los dos, pero no lo hace: recibe
-- un nombre y busca por el nombre. Consecuencia de que sea global: dos
-- cajas distintas no pueden tener instancias del mismo nombre, y eso es
-- lo que hace que la búsqueda del webhook sea inequívoca.
--
-- Por eso hay que evitar colisiones al dar de alta: el nombre sale del
-- bot (normalmente de su slug), y si ya estuviera pillado la base avisa
-- en el momento de crearlo, que es cuando se puede arreglar.
create unique index if not exists ix_bots_instance_name on bots (instance_name);

comment on index ix_bots_instance_name is
  'instance_name identifica un número de WhatsApp y es ÚNICO en toda la base. El webhook busca por este nombre (LIMIT 1), así que si se repitiera mandaría los mensajes de un cliente al panel de otro sin avisar. Un cliente con dos números exigiría quitar esto Y cambiar el webhook para que filtrara por servidor.';

comment on column bots.server_id is
  'La caja de Evolution API donde vive el número de este bot. UNA CAJA POR CLIENTE. Es lo que el equipo configura y prueba; el cliente no lo ve.';
comment on column bots.instance_name is
  'El nombre de la instancia dentro de Evolution, es decir, el número de WhatsApp. Detalle interno: el cliente no lo ve ni lo escribe. Lo usa el webhook para encontrar el bot y el bot para enviar. Es único en toda la base.';
comment on column bots.client_id is
  'Dueño del bot. Un cliente, un bot. Un segundo bot del mismo cliente no es posible por índice único, y no es una casualidad: ver ix_bots_instance_name.';