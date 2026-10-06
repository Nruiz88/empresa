-- =====================================================================
-- Nexo Studio — RLS de los tickets de soporte (migración 019)
-- =====================================================================
--
-- POR QUÉ ESTA MIGRACIÓN VA SEPARADA DE LA 018
-- ---------------------------------------------
-- Porque la 018 ya se aplicó, y al aplicarla dejó las dos tablas
-- SIN RLS. `node db/rls.js` lo dice sin rodeos:
--
--     soporte_mensajes    NO    0    <-- expuesta
--     soporte_tickets     NO    0    <-- expuesta
--
-- Con RLS apagado, la tabla se lee y se escribe desde fuera con la
-- clave publicable, que va en el cliente. Es decir: cualquier persona
-- que abra el código del navegador podía leer los tickets de todos
-- los clientes y escribir en ellos.
--
-- Se separa porque queda el rastro: la 018 creó, la 019 asegura. Si
-- alguien repite la 018 en una base nueva y se olvida de la 019, el
-- `db/rls.js` lo dice. Lo que no se puede es que quede una tabla
-- expuesta porque alguien Pepis corrió la 018 y se paró ahí.
--
-- ── POR QUÉ EL CLIENTE PUEDE INSERTAR PERO NO ACTUALIZAR ──
--
-- Abrir un ticket es suyo: puede escribir lo que le pasa.
-- Marcarlo como resuelto NO es suyo: decidir que algo está hecho es
-- del equipo. Si el cliente pudiera actualizar, podría cerrar su
-- propio ticket con "resuelto" y se acabaría el seguimiento sin que
-- nadie lo haya hecho.
--
-- Por eso hay política de `insert` y NO de `update`. Sin política de
-- `update`, el permiso no está concedido: no hace falta decir que
-- no.
--
-- ── POR QUÉ `not interno` ESTÁ EN EL POLICY Y NO SOLO EN EL CHECK ──
--
-- El `check` de la 018 no alcanza. Un `check` mira la fila, y no
-- quién la escribió: si un cliente pudiera mandar `interno: true`, la
-- fila lo cumpliría perfectamente y entraría.
--
-- El `with check` de una política sí sabe quién escribe, porque es
-- `to authenticated`. Por eso `not interno` va aquí y es la defensa
-- real: la base rechaza la nota interna del cliente aunque la ruta se
-- equivocara y la leyera del cuerpo.
--
-- ── POR QUÉ SE COMPRUEBA EL SERVICIO ──
--
-- Porque `servicio_id` apunta a un servicio, y los servicios tienen
-- dueño. Sin comprobarlo, un cliente podría abrir un ticket diciendo
-- "es sobre este servicio" apuntando al servicio de OTRO cliente. La
-- fila sería suya y parecería suya, pero en el detalle se vería el
-- nombre de un servicio que no es de su empresa.
--
-- Es un theft de información pequeño pero real: con esto se puede
-- descubrir que existe una empresa concreta y cómo se llama su
-- servicio, porque el ticket se lo devuelve al que lo abrió.
-- =====================================================================

alter table soporte_tickets enable row level security;
alter table soporte_mensajes enable row level security;


-- ---------------------------------------------------------------------
-- soporte_tickets
-- ---------------------------------------------------------------------

drop policy if exists "leer tickets" on soporte_tickets;
create policy "leer tickets"
  on soporte_tickets for select to authenticated
  using (
    es_staff()
    or cliente_id = (select client_id from profiles where id = auth.uid())
  );

drop policy if exists "abrir tickets" on soporte_tickets;
create policy "abrir tickets"
  on soporte_tickets for insert to authenticated
  with check (
    cliente_id = (select client_id from profiles where id = auth.uid())
    -- El servicio, si se indica, tiene que ser del mismo cliente.
    and (
      servicio_id is null
      or exists (
        select 1 from services s
        where s.id = soporte_tickets.servicio_id
          and s.client_id = (select client_id from profiles where id = auth.uid())
      )
    )
  );

-- Sin política de `update` ni de `delete`: el cliente no los tiene.
-- Eso es intencionado y está en la cabecera.


-- ---------------------------------------------------------------------
-- soporte_mensajes
-- ---------------------------------------------------------------------

drop policy if exists "leer mensajes" on soporte_mensajes;
create policy "leer mensajes"
  on soporte_mensajes for select to authenticated
  using (
    es_staff()
    or (
      -- La defensa de que el cliente no lea notas internas. Está en el
      -- SELECT, no solo en el INSERT: un mensaje interno podría existir
      -- por un INSERT del equipo, y lo que hay que impedir es
      -- LEERLO, que es distinto de insertarlo.
      not interno
      and exists (
        select 1 from soporte_tickets t
        where t.id = soporte_mensajes.ticket_id
          and t.cliente_id = (select client_id from profiles where id = auth.uid())
      )
    )
  );

drop policy if exists "escribir mensajes" on soporte_mensajes;
create policy "escribir mensajes"
  on soporte_mensajes for insert to authenticated
  with check (
    not interno
    and autor_rol = 'cliente'
    and autor_id = auth.uid()
    and exists (
      select 1 from soporte_tickets t
      where t.id = soporte_mensajes.ticket_id
        and t.cliente_id = (select client_id from profiles where id = auth.uid())
    )
  );

-- Sin `update` ni `delete`: un cliente no edita ni borra lo escrito.
-- Ni siquiera lo suyo. Un hilo de soporte que se puede reescribir no
-- es un hilo de soporte, es una conversación que se puede falsear.

comment on table soporte_tickets is
  'Avisos de soporte del cliente. RLS: el cliente solo ve los suyos y solo puede abrirlos.';
comment on table soporte_mensajes is
  'Hilo del ticket. RLS: el cliente no lee ni escribe notas internas.';