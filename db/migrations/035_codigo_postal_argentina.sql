-- =====================================================================
-- Shopcito — Código postal y país de Argentina (migración 035)
-- =====================================================================
--
-- QUÉ PASA
-- --------
-- La ficha y la facturación se escribieron con formato de España:
--
--   · `codigo_postal` pedía CINCO dígitos (`~ '^\d{5}$'`);
--   · `pais` nacía en «España».
--
-- El negocio es argentino. Un código postal argentino es de 4 dígitos
-- (1414), de 5 (12345) o el CPA (una letra + 4 dígitos + hasta 3 letras
-- del bloque: C1414ABC). Con el CHECK viejo, el cliente cargaba su CP,
-- el guardado fallaba y parecía que el formulario «no guardó»: volvía a
-- mostrar lo de antes. No era el formulario, era la restricción.
--
-- QUÉ HACE
-- --------
-- Relaja el CHECK de las dos tablas al formato argentino y pone
-- «Argentina» como país por defecto. El ALTER del default NO toca las
-- filas que ya existen: solo cambia lo que se pone cuando no se manda
-- el campo.
-- =====================================================================

alter table fichas drop constraint if exists fichas_codigo_postal_check;
alter table fichas add constraint fichas_codigo_postal_check
  check (codigo_postal is null or codigo_postal ~* '^([a-z]\d{4}[a-z]{0,3}|\d{4,5})$');

alter table facturacion drop constraint if exists facturacion_codigo_postal_check;
alter table facturacion add constraint facturacion_codigo_postal_check
  check (codigo_postal is null or codigo_postal ~* '^([a-z]\d{4}[a-z]{0,3}|\d{4,5})$');

alter table fichas alter column pais set default 'Argentina';
alter table facturacion alter column pais set default 'Argentina';

comment on column fichas.codigo_postal is
  'Código postal argentino: 4 dígitos (1414), 5 (12345) o el CPA (C1414ABC). Ver migración 035.';
comment on column facturacion.codigo_postal is
  'Código postal argentino: 4 dígitos (1414), 5 (12345) o el CPA (C1414ABC). Ver migración 035.';
