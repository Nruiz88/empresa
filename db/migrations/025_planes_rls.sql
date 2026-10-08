-- =====================================================================
-- Shopcito — RLS de los planes (migración 025)
-- =====================================================================
--
-- POR QUÉ ESTA MIGRACIÓN VA SEPARADA
--
-- Porque la 023 ya se aplicó, y al aplicarla dejó la tabla SIN RLS.
-- `npm test` lo dice sin rodeos:
--
--     plans    NO    0    <-- expuesta
--
-- Se separa para que quede el rastro: la 023 crea, la 025 asegura. Si
-- alguien repite la 023 en una base nueva y se olvida de la 025, el
-- `npm test` lo dice. Lo que no puede ser es que la tabla quede
-- expuesta porque alguien la aplicó y se paró ahí.
--
-- ── QUÉ PUEDE HACER CADA QUIÉN ──
--
--   - visitante (sin entrar) → LEER los planes activos. No más.
--   - cliente               → LEER los planes activos. No más.
--   - staff                 → leer todos y escribir todos.
--   - nadie                 → borrar. Ni el staff desde el panel.
--
-- ── POR QUÉ EL VISITANTE PUEDE LEER ──
--
-- Porque la web pública pinta los planes sin que nadie haya iniciado
-- sesión: la portada y /precios son la puerta, y no pueden pedir
-- contraseña. Es lo mismo que hace `modules` con el catálogo.
--
-- ── POR QUÉ SOLO LOS ACTIVOS ──
--
-- Porque `activo = false` es un borrador: un plan que se está
-- preparando todavía no, y no sale. Si el visitante pudiera leer los
-- borradores, un plan sin precio ni descripciones se vería en la web
-- si alguien mira la respuesta de la red, que es lo primero que
-- alguien hace.
--
-- ── POR QUÉ NADIE ESCRIBE CON LA CLAVE PUBLICABLE ──
--
-- El cambio de precio es lo más importante que hay en esta tabla: es lo
-- que se cobra. Y la clave publicable va en el cliente, o sea que
-- cualquiera que abra las herramientas del navegador la tiene.
--
-- Con RLS apagado, con esa clave se podía hacer:
--
--     supabase.from('plans').update({ precio: 0 }).eq('id', 'inicial')
--
-- desde la consola del navegador, sin cuenta, sin contraseña. Poner el
-- plan a 0 es ponerlo a gratis. Y no es una hipótesis: es lo que hace
-- un RLS apagado.
--
-- ── POR QUÉ NO HAY POLÍTICA DE DELETE ──
--
-- Sin política de `delete`, el permiso no está concedido: no hace
-- falta decir que no. Borrar un plan es irreversible desde el panel, y
-- no hay ninguna operación de este negocio que lo necesite.
--
-- ── EL ROL DE LA TABLA ──
--
-- El panel escribe por el cliente admin, que es una clave de servicio
-- y se salta las políticas. Por eso `for all to authenticated` con
-- `es_staff()` no es lo que protege la tabla: es una segunda barrera,
-- por si alguien dejara el cliente admin exposed en algún sitio. Las
-- dos hacen falta, pero la que de verdad sostiene esto es que el
-- visitante no puede escribir.
-- =====================================================================

alter table plans enable row level security;

-- ---------------------------------------------------------------------
-- El visitante: leer los planes que están a la vista, y nada más.
-- ---------------------------------------------------------------------

drop policy if exists "leer planes publicos" on plans;
create policy "leer planes publicos"
  on plans for select to anon, authenticated
  using (activo);

-- ---------------------------------------------------------------------
-- El staff: verlos todos, incluidos los borradores.
--
-- `for all` cubre insert, update y delete. Y aunque el panel no borra,
-- antes había un `for all` en `modules` que sí lo hacía, y nadie se
-- quejó: no es un permiso, es una puerta sin cerradura.
-- ---------------------------------------------------------------------

drop policy if exists "gestionar planes" on plans;
create policy "gestionar planes"
  on plans for all to authenticated
  using (es_staff())
  with check (es_staff());

-- Sin política de `delete` para nadie: el staff escribe, pero borrar un
-- plan no lo hace ni el panel. Está en la cabecera.

comment on table plans is
  'Los tres niveles que se venden. RLS: el visitante lee los activos; escribir es del staff.';
comment on column plans.precio is
  'NULL significa «A consultar», no cero. Un cero publicaría que el plan es gratis.';
comment on column plans.cta_href is
  'Destino del botón del plan. Solo rutas internas, y lo valida el servidor. La clase del botón sale de "destacado", no se guarda.';