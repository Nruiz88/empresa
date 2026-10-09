-- =====================================================================
-- Shopcito — Tipos de servicio: aplicación y plan (029)
-- =====================================================================
--
-- QUÉ ES ESTO
--
-- `services` guardaba tres tipos de cosa: un mantenimiento, un proyecto y
-- un presupuesto. Los tres del estudio digital que ya no existe, y los
-- tres términos que no significan nada en un negocio que vende
-- suscripciones de un bot.
--
-- Se agregan dos, que son los que existen ahora:
--
--   · aplicacion  una sola, comprada suelta;
--   · plan        un plan, que da acceso a varias de golpe.
--
-- ── POR QUÉ ESTA MIGRACIÓN ESTÁ SOLA ──
--
-- Porque en Postgres no se puede usar un valor de ENUM en la misma
-- transacción en que se agrega. La 029 original agregaba los valores Y
-- una restricción que los comparaba, y el resultado fue:
--
--     unsafe use of new value "aplicacion" of enum type service_kind
--
-- Que no es un error tipográfico: es una limitación real. La restricción
-- va en la 030, que corre en su propia transacción, donde el valor ya
-- existe y sí se puede usar.
--
-- ── POR QUÉ NO SE REUSA UN TIPO VIEJO ──
--
-- Porque "mantenimiento" describe una relación sin fin, algo que se
-- mantiene mientras dure el contrato. Una aplicación es una suscripción
-- con fecha de corte, y un plan es un paquete. No se comportan igual, y
-- meterlos en el mismo tipo haría que una lista con veinte servicios
-- fuera ilegible.
-- =====================================================================

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'service_kind' and e.enumlabel = 'aplicacion'
  ) then
    alter type service_kind add value 'aplicacion';
  end if;

  if not exists (
    select 1 from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'service_kind' and e.enumlabel = 'plan'
  ) then
    alter type service_kind add value 'plan';
  end if;
end
$$;