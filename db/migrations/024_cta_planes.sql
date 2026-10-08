-- Botón de cada plan (migración 024)
-- =====================================================================
--
-- POR QUÉ
--
-- Las tarjetas de la portada y de /precios llevan un botón: "Empezar
-- gratis", "Probar 14 días", "Hablar con nosotros". Esos botones se
-- escribían en `content/shopcito.js` y cuando los planes pasaron a la
-- tabla se perdieron.
--
-- El síntoma fue un 500 en toda la web: la plantilla hace
-- `p.cta.href` sobre un plan que venía de la base, y ahí no había
-- `cta`. No es un error de una tarjeta: es un 500 en la portada.
--
-- ── POR QUÉ NO SE CALLA EN EL CÓDIGO ──
--
-- Porque un botón por plan es una decisión que cambia según el
-- negocio: cuando haya precio confirmado, el de "Inicial" puede
-- querer ir a /contacto en vez de a /cuenta/crear. Si el texto
-- estuviera en el código, cambiarlo sería editar un fichero y
-- desplegar, que es justo lo que esta tabla viene a evitar.
--
-- ── POR QUÉ TRES COLUMNAS Y NO UNA ──
--
-- `cta_texto`, `cta_href` y `cta_clase`. La clase NO se guarda: el plan destacado tiene que salir con el botón verde y
-- los otros con el hueco, y eso depende de la posición, no del plan.
-- Guardarla abriría la puerta a que alguien ponga una clase
-- arbitraria desde el panel y rompa el estilo de la página.
--
-- La clase se SACA del `destacado`, que es un dato que ya existe y
-- que además es el que decide el resaltado de la tarjeta: si el
-- botón fuera rojo y la tarjeta verde, se ven como dos cosas
-- distintas y el visitante no sabe cuál es la que quiere.
-- =====================================================================

alter table plans
  add column if not exists cta_texto text not null default 'Quiero este plan',
  add column if not exists cta_href  text not null default '/contacto';

update plans set cta_texto = 'Empezar gratis',   cta_href = '/cuenta/crear' where id = 'inicial';
update plans set cta_texto = 'Probar 14 días',  cta_href = '/cuenta/crear' where id = 'comercio';
update plans set cta_texto = 'Hablar con nosotros', cta_href = '/contacto' where id = 'full';

comment on column plans.cta_href is
  'A dónde lleva el botón del plan. La clase del botón se saca de "destacado", no se guarda: por una razón, para que nadie pueda poner una clase arbitraria desde el panel.';