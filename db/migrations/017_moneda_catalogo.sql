-- =====================================================================
-- Nexo Studio — Moneda del catálogo (migración 017)
-- =====================================================================
--
-- POR QUÉ
-- -------
-- `modules.precio` es un número pelado, sin moneda. El catálogo lo
-- pinta el portal del cliente con `dinero(m.precio)`, y esa función
-- se llama SIN segundo argumento, así que cae en EUR.
--
-- El negocio está en Argentina. Un precio de 49 pintado como
-- "49,00 €" no es un detalle de formato: es un número equivocado en
-- la pantalla donde el cliente decide si contrata.
--
-- ── POR QUÉ UNA COLUMNA Y NO FIJARLO EN EL CÓDIGO ──
--
-- Podría escribirse 'ARS' a fuego en catalogo.ejs y ya. Pero
-- entonces cambiar de país, o vender a un cliente en otra moneda,
-- es tocar código. Con una columna, `dinero(m.precio, m.moneda)`
-- responde a lo que diga la fila, y el catálogo puede tener precios
-- en monedas distintas sin que nadie tenga que acordarse.
--
-- ── EL VALOR POR DEFECTO ES 'ARS' Y NO NULL ──
--
-- Las filas que hay ahora (49, 79, 39) son de demostración: precios
-- en euros de cuando se hizo la demo. Poner 'EUR' como valor por
-- defecto las dejaría coherentes pero mentirosas, porque no lo son:
-- el negocio cobra en pesos.
--
-- Se pone 'ARS' para que la columna diga la verdad sobre el negocio,
-- y los números en sí se corrigen a mano desde el panel, que es
-- para lo que existe la pantalla de catálogo. Un precio de 49
-- pesos se ve absurdo en la pantalla y ese absurdo es lo que obliga
-- a cambiarlo; un "49,00 €" bien presentado no se ve mal.
--
-- -- POR QUÉ UN CHECK Y NO DEJARLO SUELTO --
--
-- `dinero()` saca el código de la moneda con Intl.NumberFormat, y
-- con un código inventado la página revienta al pintarla, no al
-- guardar. Con el CHECK el error salta en el POST, con el nombre del
-- campo, y el formulario se puede volver a enviar.
--
-- NOTA sobre esto y los precios: la página pública /precios tiene sus
-- cifras ESCRITAS A MANO en content/faq.js y content/posts.js, en
-- euros, y NO salen de esta tabla. Cambiar el catálogo no cambia esa
-- página. Ver la nota de la pantalla de catálogo en el panel.
-- =====================================================================

alter table modules
  add column if not exists moneda text;

-- Las filas que ya existen se declaran en la moneda del negocio.
update modules set moneda = 'ARS' where moneda is null;

-- A partir de aquí, siempre. Sin default: un insert que olvide la
-- moneda debe fallar, porque un precio sin moneda es un número que
-- alguien va a interpretar mal en algún sitio.
alter table modules
  alter column moneda set not null;

-- Las que no existan de aquí en adelante nacen en la del negocio.
alter table modules
  alter column moneda set default 'ARS';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'modules_moneda_valida'
  ) then
    alter table modules
      add constraint modules_moneda_valida
      check (moneda ~ '^[A-Z]{3}$');
  end if;
end $$;

comment on column modules.moneda is
  'Código ISO de 3 letras (EUR, ARS, USD). La usa el portal para pintar el precio.';