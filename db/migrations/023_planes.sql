-- =====================================================================
-- Shopcito — Planes a la venta (migración 023)
-- =====================================================================
--
-- POR QUÉ UNA TABLA Y NO `content/shopcito.js`
--
-- Los precios estaban escritos en el código, en `PLANES` de
-- `content/shopcito.js`. Eso significa que cambiar el precio de un plan
-- —lo más normal del mundo en un negocio— exige editar un fichero,
-- desplegar, y acordarse de que el cambio esté en producción.
--
-- Y ya pasó una vez: los planes salieron "A consultar" durante semanas
-- no porque fuera una decisión, sino porque nadie sabía dónde se
-- escribía el número.
--
-- ── POR QUÉ NO EN `modules` ──
--
-- Porque `modules` es lo que se le AÑADE a un cliente ya existente:
-- bot de WhatsApp, inventario, reservas. Un plan es otra cosa: es el
-- producto entero, en tres niveles, y un cliente contrata UNO.
--
-- Meter los planes en `modules` obligaría a que un plan fuera un módulo
-- que se puede añadir a un servicio, y a guardar un campo de "nivel"
-- que no significa nada para un módulo suelto. Y el catálogo del panel
-- pinta una columna de precio por módulo, que es justo la pantalla
-- donde un nivel de precios y un añadido se confundirían.
--
-- ── POR QUÉ `precio` PUEDE SER NULO ──
--
-- Porque "A consultar" es un estado de verdad, no un precio de cero.
-- Con `precio = 0` la portada publicaría "desde $0" y el negocio
-- parecería gratis. Con `precio` nulo, la vista muestra que hay que
-- preguntar.
--
-- Y ahora que el precio se pone desde el panel, nulo tiene que ser un
-- estado que el formulario pueda guardar sin que el servidor lo cambie
-- a cero. Un `not null default 0` impediría precisamente la única
-- opción honesta que hay hoy.
--
-- ── `incluye` ES UN ARRAY DE TEXTO ──
--
-- Son las líneas de la tarjeta. Un array, y no un texto con saltos de
-- línea, porque el panel las edita de una en una y la vista las pinta
-- como lista. Con un solo texto habría que partilo por saltos de línea,
-- que es volver a la situation en la que un dato depende de un formato.
--
-- ── POR QUÉ `moneda` POR FILA Y NO UNA GLOBAL ──
--
-- Igual que en `modules` (migración 017). Hoy todo es pesos, pero un
-- plan puede costar otra cosa y eso no debería obligar a tocar código.


create table if not exists plans (
  id           text primary key,
  nombre       text not null,
  descripcion  text not null default '',
  -- Nulo = "A consultar". Ver la nota de arriba.
  precio       numeric,
  moneda       text not null default 'ARS',
  periodo      text not null default 'mes',
  incluye      text[] not null default '{}',
  nota         text not null default '',
  destacado    boolean not null default false,
  orden        integer not null default 0,
  activo       boolean not null default true,
  actualizado  timestamptz not null default now(),

  constraint planes_precio_no_negativo check (precio is null or precio >= 0),
  constraint planes_moneda_conocida check (moneda in ('ARS', 'USD', 'EUR'))
);

comment on table plans is
  'Los planes que Shopcito vende al público. Distinto de modules, que son los servicios que se añaden a un cliente.';
comment on column plans.precio is
  'Nulo significa "A consultar". Un 0 publicaría que el producto es gratis.';


-- ---------------------------------------------------------------------
-- Las tres filas, con lo que ya estaba escrito en el código.
-- ---------------------------------------------------------------------
--
-- Se siembran SIN precio a propósito: no hay cifra confirmada, y
-- sembrarla con un número inventado es exactamente el problema que
-- causes esta tabla (publicar una cifra falsa en la pantalla donde el
-- cliente decide). Cuando haya cifra, se pone desde el panel.

insert into plans (id, nombre, descripcion, precio, moneda, periodo, incluye, nota, destacado, orden)
values
  (
    'inicial',
    'Inicial',
    'Para el que recién arranca y quiere dejar de responder a mano.',
    null, 'ARS', 'mes',
    array[
      'Bot de WhatsApp en tu número',
      'Respuestas automáticas 24/7',
      'Listado de preguntas frecuentes'
    ],
    'Para empezar a dejar de perder consultas.',
    false, 1
  ),
  (
    'comercio',
    'Comercio',
    'El plan que usa la mayoría: el bot, y además vender o agendar.',
    null, 'ARS', 'mes',
    array[
      'Todo lo del plan Inicial',
      'Mini shop / catálogo web con fotos y precios',
      'O Agenda de Turnos, si lo que necesitás es reservar'
    ],
    'Elegís una de las dos: vendés productos o agendás horarios.',
    true, 2
  ),
  (
    'full',
    'Full / Pro',
    'Para el que quiere las dos cosas y cobrar por los dos lados.',
    null, 'ARS', 'mes',
    array[
      'Todo lo del plan Comercio',
      'Mini shop y Agenda de Turnos juntos',
      'Links de pago de Mercado Pago',
      'Módulos ilimitados'
    ],
    'Sin comisiones por venta, ni de Mercado Pago ni de Shopcito.',
    false, 3
  )
on conflict (id) do nothing;