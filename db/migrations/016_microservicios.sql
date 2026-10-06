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
insert into microservicios (modulo, nombre, url_base, activo, nota)
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
on conflict (modulo) do update
   set nombre = excluded.nombre,
       url_base = excluded.url_base,
       activo = excluded.activo,
       nota = excluded.nota;