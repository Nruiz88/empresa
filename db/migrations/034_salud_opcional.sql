-- =====================================================================
-- Shopcito — Un servicio sin /api/salud no está caído (migración 034)
-- =====================================================================
--
-- QUÉ PASA
-- --------
-- La pantalla de Salud pregunta a cada microservicio `GET
-- <url_base>/api/salud` y compara el `secret_md5` que devuelve. Eso
-- vale para los que entran por el ticket del panel (bot, inventario).
--
-- El Mini Shop es otra cosa: es un Next.js con su PROPIO login (/entrar)
-- y su propia tabla de sesiones (shop_sesiones). No expone /api/salud
-- ni tiene por qué: no comparte el SERVICE_SECRET del panel.
--
-- Resultado: la Salud lo pintaba en rojo «No responde: 404», que es
-- falso —el servicio contesta; lo que no tiene es esa ruta— y manda a
-- buscar una caída que no existe.
--
-- QUÉ HACE
-- --------
-- Agrega `microservicios.tiene_salud`. En false, la pantalla de Salud no
-- le pregunta y dice por qué, en vez de marcarlo como caído. Nace en
-- true para no cambiar el comportamiento de los que sí la exponen.
-- =====================================================================

alter table microservicios
  add column if not exists tiene_salud boolean not null default true;

comment on column microservicios.tiene_salud is
  'false = el servicio no expone /api/salud (tiene su propio acceso, como el shop). La pantalla de Salud no le pregunta y lo dice, en vez de marcarlo como caido.';

-- El shop: propio login, sin /api/salud.
update microservicios set tiene_salud = false where modulo = 'mini-shop';
