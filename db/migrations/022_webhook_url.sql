-- =====================================================================
-- La URL del webhook, por caja (migración 022)
-- =====================================================================
--
-- EL PEDIDO
-- ---------
-- "Poder manejar solo yo, como admin, el tema de la URL del webhook del
--  bot y agregar más servidores de bots desde el panel."
--
-- Agregar servidores ya se puede (migración 021). Lo que no se podía era
-- la URL del webhook: salía DEDUCIDA del dominio del sitio, y eso quiere
-- decir que era fija para todas las cajas y no se podía cambiar desde
-- ningún sitio.
--
--
-- POR QUÉ NO BASTABA CON DEDUCIRLA
-- ---------------------------------
-- La deducción (lib/site.js, `urlDeWebhook()`) acierta cuando el bot
-- está en `bot.<dominio>`, que es lo normal. Se equivoca cuando:
--
--   · el bot se sirve en otro sitio entero (un hosting aparte, Vercel)
--   · hay dos bots en dominios distintos
--   · el dominio todavía no está elegido y hay que probar
--
-- Y cuando se equivoca, el fallo es de los que no se ven: la Evolution
-- acepta el webhook con un 200, el alta se guarda, y los mensajes
-- llegan a una dirección donde no hay nadie. El bot queda mudo y el
-- único síntoma es que "no contesta".
--
-- Por eso la URL se guarda POR CAJA, y no una sola vez para todo.
--
--
-- POR QUÉ EN LA CAJA Y NO EN UN AJUSTE GENERAL
-- --------------------------------------------
-- Porque es una propiedad de la caja, como su clave y su nombre: dice a
-- dónde tiene que llamar ESTA Evolution. Dos cajas en dominios distintos
-- es un caso real (un bot en producción y otro en pruebas), y con un
-- ajuste global solo una de las dos podría estar bien.
--
--
-- NULL = SE USA LA DEDUCIDA
-- ---------------------------
-- Es lo que quieren las cajas que están donde el panel cree, que es la
-- mayoría. Con NULL no hay nada que mantener: se cambia SITE_URL y todas
-- las cajas sin valor propio siguen a lo que toca.
--
-- Lo que NO hace es inventarse un valor por caja al aplicar la
-- migración. Ponerlo ahí copiando el dominio de hoy congelaría en cada
-- fila el dominio actual, y el día que cambie el dominio habría que ir
-- caja por caja a corregirlo, o peor: unas quedarían apuntando al
-- dominio viejo sin que nadie se entere.
--
-- OJO: la caja se guarda UNA URL COMPLETA, con el `/api/webhook` al
-- final, no solo el host. Es lo que se le manda a la Evolution tal cual,
-- y guardar solo el dominio obligaría a recomponerla en tres sitios
-- distintos, que es como se desincronizan.
-- =====================================================================

alter table evolution_servers
  add column if not exists webhook_url text;

comment on column evolution_servers.webhook_url is
  'A dónde tiene que llamar la Evolution para este bot, con /api/webhook al final. NULL = se deduce de SITE_URL/BOT_URL (lib/bots.js). Es el dato que un fallo de "el bot no contesta" necesita: si apunta a otro sitio, la Evolution devuelve 200 igual y el bot queda mudo sin ningún error.';

-- El CHECK se mete en un DO porque `add constraint` no es idempotente como
-- `add column if not exists`: reejecutar el fichero abortaría con "ya
-- existe" y la migración quedaría a medias (ver la nota al pie de la 020).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'evolution_servers_webhook_url'
  ) then
    alter table evolution_servers
      add constraint evolution_servers_webhook_url
      check (
        webhook_url is null
        or (
          char_length(webhook_url) between 12 and 300
          and webhook_url ~ '^https?://'
        )
      );
  end if;
end;
$$;

-- ── Lo que NO se toca, y por qué ──
--
-- `SITE_URL` sigue siendo una variable de entorno y no un ajuste del
-- panel, aunque los dos sean "direcciones". No es descuido: SITE_URL
-- manda en el sitemap, los correos, los enlaces del sitio entero y las
-- redirecciones. Dejar que se cambie con un clic desde el panel sería
-- una forma de que un clic dejara el SEO y los correos apuntando a otro
-- sitio sin que nadie lo decidiera conscientemente.
--
-- Lo que sí es del panel es la lista de cajas: qué servidores hay, cómo
-- se llaman, cuántos números caben en cada uno, cuál es su clave y a
-- dónde llaman. Eso es infraestructura, y la infraestructura se
-- gestiona desde el panel. El dominio de la web no.