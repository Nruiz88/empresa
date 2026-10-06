-- =====================================================================
-- Nexo Studio — Tickets de soporte (migración 018)
-- =====================================================================
--
-- ⚠️  POR QUÉ SE LLAMA `soporte_tickets` Y NO `tickets`
-- ------------------------------------------------------
--
-- Porque YA EXISTE otra cosa que en este proyecto se llama "ticket".
--
-- `lib/tickets.js` es el "ticket de acceso entre servicios": un token
-- firmado que permite que quien entró en panel.midominio.com llegue a
-- bot.midominio.com sin volver a autenticarse, y sin compartir
-- cookies entre subdominios. Es un token criptográfico, no un aviso.
--
-- Y tiene su propio test: `db/test-tickets.js`, que va en `npm test`.
--
-- Si esta tabla se llamara `tickets`, quien abriera el proyecto
-- encontraría dos cosas distintas con el mismo nombre, y el código
-- nuevo parecería el viejo. Eso se paga caro: no el día que se escribe,
-- sino el día que alguien busca "tickets" para depurar y encuentra el
-- equivocado.
--
-- Por eso las tablas llevan el prefijo `soporte_`.
--
-- En la INTERFAZ se sigue diciendo "ticket", porque es la palabra que
-- entiende un cliente y la que usa el equipo de palabra. El prefijo
-- es del código, no del texto que ve la gente.
--
--
-- POR QUÉ
-- -------
-- Un ticket es la unidad de trabajo de una empresa de servicios: algo
-- que el cliente avisa, que alguien atiende, y que queda escrito por
-- si hay que recordar qué se prometió.
--
-- Antes el soporte vivía en dos sitios que no hablan entre sí: el
-- WhatsApp del cliente y la memoria del equipo. Un mensaje por
-- teléfono no deja rastro, y lo prometido a un cliente se olvida
-- justo cuando el equipo se renueva.
--
-- Esto no viene de cambiar de herramienta. Viene de que el aviso
-- tiene que poder volver a leerse seis meses después: qué se pidió,
-- qué se respondió y qué quedó sin hacer.
--
-- ── POR QUÉ DOS TABLAS Y NO UNA ──
--
-- Un ticket con sus mensajes dentro, en la misma fila, obligaría a
-- reescribir la fila entera cada vez que alguien responde. Con dos
-- tablas, escribir un mensaje es un INSERT y nada más: no se toca lo
-- que ya estaba escrito ni se corre el riesgo de pisarlo.
--
-- ── POR QUÉ `interno` Y NO SOLO "QUIÉN ESCRIBE" ──
--
-- Porque la mitad del valor de un ticket es lo que NO ve el cliente.
--
-- "Estamos mirando si es la plantilla de Evolution" sirve de mucho al
-- equipo y de nada al cliente, que solo quiere saber cuándo lo tendrá.
-- Mezclar las dos cosas en el mismo hilo obliga al equipo a tener
-- cuidado con cada frase, y en la práctica acaba pasando: o se
-- escribe de menos, o se filtra algo interno.
--
-- Con una columna, la nota interna se marca como interna y el cliente
-- no la ve nunca. El equipo escribe sin pensarlo.
--
-- ── POR QUÉ EL ASUNTO ES OBLIGATORIO ──
--
-- Porque es lo que se lee en la lista de tickets del equipo. Si el
-- asunto fuera opcional, la mitad se llamaría "consulta" o "ayuda" y
-- la lista dejaría de servir para saber qué hay que atender primero.
--
-- ── POR QUÉ `servicio_id` PUEDE SER NULO ──
--
-- Porque no todos los avisos son sobre un servicio concreto. "Me
-- parece que me han cobrado dos veces" es del cliente, no del bot de
-- WhatsApp. Obligar a elegir un servicio para poder escribir dejaría
-- fuera justamente los avisos que más urgen, porque no encajan en
-- ninguna casilla.
--
-- ── LOS ESTADOS, Y POR QUÉ TRES Y NO SEIS ──
--
--   abierto     hay algo que hacer y nadie lo ha cogido
--   en_curso    alguien lo está atendiendo
--   resuelto     está hecho; si el cliente responde, vuelve a abierto
--
-- Falta "cerrado", y es a propósito. En un negocio de este tamaño,
-- "resuelto" y "cerrado" son la misma cosa, y tener los dos obliga a
-- decidir cuál de los dos es, cada vez, sin que cambie nada. Cuando
-- haga falta de verdad, se añade la columna.
--
-- El paso de `resuelto` a `abierto` lo hace el código, no un CHECK:
-- es una regla de negocio con una condición —el cliente escribió en
-- uno resuelto— y un CHECK no puede mirar otra tabla ni el momento.
-- =====================================================================

create table if not exists soporte_tickets (
  id uuid primary key default gen_random_uuid(),

  -- El cliente es obligatorio: un ticket sin dueño no es de nadie y no
  -- se puede contestar. El borrado del cliente se lleva sus tickets,
  -- porque un ticket sin cliente es ruido.
  cliente_id uuid not null references clients(id) on delete cascade,

  -- A propósito sin `not null`: ver arriba.
  servicio_id uuid references services(id) on delete set null,

  asunto text not null,
  estado text not null default 'abierto',
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  resuelto_en timestamptz
);

-- El índice que usan TODAS las listas. Sin esto, la lista del equipo
-- ordena por `creado_en` sobre la tabla entera, y con dos años de
-- tickets eso es un recorrido que no termina nunca.
create index if not exists soporte_tickets_cliente_idx
  on soporte_tickets (cliente_id);

create index if not exists soporte_tickets_estado_idx
  on soporte_tickets (estado);

create index if not exists soporte_tickets_actualizado_idx
  on soporte_tickets (actualizado_en desc);

-- `servicio_id` casi siempre se busca o no se busca nunca, así que el
-- índice no compensa. En 42 clientes no lo compensa.

-- Un `unique` sobre (cliente_id, asunto) sería demasiado: un cliente
-- puede legítimamente preguntar lo mismo dos veces en meses
-- distintos, con la solución de la primera vez olvidada. Lo que se
-- busca es que no se repita EN EL MISMO MOMENTO, y para eso hay que
-- mirar el estado, que lo hace la ruta.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'soporte_tickets_estado_valido'
  ) then
    alter table soporte_tickets
      add constraint soporte_tickets_estado_valido
      check (estado in ('abierto', 'en_curso', 'resuelto'));
  end if;
end $$;

comment on table soporte_tickets is
  'Avisos de soporte del cliente. Los mensajes viven en soporte_mensajes.';
comment on column soporte_tickets.asunto is
  'Obligatorio: es lo que se lee en la lista del equipo para saber qué atender.';
comment on column soporte_tickets.estado is
  'abierto | en_curso | resuelto. Sin "cerrado" a propósito: ver la cabecera.';
comment on column soporte_tickets.servicio_id is
  'Opcional: no todos los avisos son sobre un servicio concreto.';


-- ---------------------------------------------------------------------
-- Los mensajes
-- ---------------------------------------------------------------------

create table if not exists soporte_mensajes (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references soporte_tickets(id) on delete cascade,

  -- Nulo cuando quien escribe ya no existe: un cliente borrado, un
  -- empleado que se fue. El mensaje se conserva, porque es el
  -- historial de lo que se pidió y lo que se respondió, y no debe
  -- desaparecer porque alguien dejó de trabajar aquí.
  autor_id uuid references profiles(id) on delete set null,

  -- Se guarda el ROL en el momento de escribir, no se deduce del perfil
  -- actual.
  --
  -- Porque el rol puede cambiar: el mismo usuario que hoy es `staff`
  -- puede dejar de serlo, y un mensaje escrito por el equipo se
  -- convertiría en "escrito por el cliente" si se dedujera al leer.
  autor_rol text not null,

  cuerpo text not null,
  interno boolean not null default false,
  creado_en timestamptz not null default now()
);

-- Las listas de un ticket leen SIEMPRE por ticket_id y por fecha, en
-- ese orden. Es el único patrón de lectura de esta tabla, y sin el
-- índice es un recorrido por todos los mensajes de todos los tickets.
create index if not exists soporte_mensajes_ticket_idx
  on soporte_mensajes (ticket_id, creado_en);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'soporte_mensajes_rol_valido'
  ) then
    alter table soporte_mensajes
      add constraint soporte_mensajes_rol_valido
      check (autor_rol in ('cliente', 'staff'));
  end if;
end $$;

-- Un cliente no puede escribir una nota interna.
--
-- El `check` está porque es barato, pero NO es la defensa: si un
-- cliente pudiera mandar `interno: true` al servidor, el `check` lo
-- admitiría, porque solo mira la fila y no quién la escribió. La
-- defensa real es que la ruta de cliente NUNCA lee ese campo del
-- cuerpo. El CHECK está para que un descuido al INSERTar desde dentro
-- del código no deje una nota interna colgada en el hilo de un
-- cliente.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'soporte_mensajes_cliente_no_interno'
  ) then
    alter table soporte_mensajes
      add constraint soporte_mensajes_cliente_no_interno
      check (not (autor_rol = 'cliente' and interno));
  end if;
end $$;

comment on table soporte_mensajes is
  'Hilo del ticket. Los internos no los ve el cliente.';
comment on column soporte_mensajes.autor_rol is
  'cliente | staff. Se guarda el rol del momento, no el actual.';
comment on column soporte_mensajes.interno is
  'Nota interna: la ve el equipo, el cliente no. La ruta de cliente no lee este campo.';