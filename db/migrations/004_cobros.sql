-- =====================================================================
-- Nexo Studio — Facturación y cobros (migración 004)
-- =====================================================================
-- POR QUÉ
-- -------
-- `services.importe` dice CUÁNTO vale un servicio. No dice si ya se
-- cobró, ni cuándo. Con eso no se puede responder a la única pregunta
-- que importa al cierre de mes: ¿cuánto he facturado y cuánto me
-- deben?
--
-- MODELO
-- ------
-- Un cobro apunta a un servicio y guarda un periodo (mes/año) más lo
-- que se emitió y lo que se pagó. Un mantenimiento de 120 €/mes
-- genera un cobro al mes, cada uno con su fecha. Los proyectos y
-- presupuestos tienen un cobro único.
--
-- DECISIÓN: NO es una tabla de facturas con líneas
-- ----------------------------------------------
-- Una factura real agrupa varios servicios en un PDF con un número de
-- factura y un IVA. Eso es lo correcto para un negocio real, pero son
-- dos tablas más (facturas + líneas) y una pantalla de emission.
--
-- Aquí se empieza por algo más pequeño a propósito: un registro de
-- cobros por servicio y periodo. Cuando llegue el momento de emitir
-- facturas de verdad, esta tabla se conserva (es el detalle) y se le
-- añade `facturas` encima apuntando al cobro. Nada de lo hecho ahora
-- se tira.
--
-- TODO(facturas): sigue pendiente. No hay tabla `facturas`, ni
-- numeracion, ni IVA, ni PDF (no hay ninguna libreria de PDF en
-- package.json). Cuando se monte: migracion nueva con `facturas` y
-- `factura_lineas` encima de esta tabla, que hace de detalle, mas una
-- serie de numeracion y el reparto de IVA. Ver PENDIENTES.md.
--
-- POR QUÉ `periodo` Y NO SOLO `emitido_en`
-- ---------------------------------------
-- Porque dos cobros del mismo servicio pueden caer el 1 y el 20. Con
-- la fecha sola no sabes a qué mes pertenece cada uno al cerrar el
-- ejercicio. '2026-10' responde a eso de un vistazo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Estados del cobro.
--
-- 'pendiente' -> emitido, el cliente aún no lo ha pagado
-- 'pagado'    -> cobrado (guarda cuándo)
-- 'impagado'  -> se paso la fecha de pago y no llego. Es deuda: NO se borra.
-- 'anulado'   -> duplicado, o emitido por error. No se borra: queda el rastro.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'cobro_estado') then
    create type cobro_estado as enum ('pendiente', 'pagado', 'impagado', 'anulado');
  end if;
end $$;

create table if not exists cobros (
  id          uuid primary key default gen_random_uuid(),

  -- A qué servicio corresponde. on delete cascade: si se borra el
  -- servicio, sus cobros tampoco tienen sentido.
  service_id  uuid not null references services on delete cascade,

  -- Periodo al que pertenece ('2026-10'). Null para cobros sueltos.
  periodo     text check (periodo is null or periodo ~ '^\d{4}-\d{2}$'),

  -- Qué se emitió. Se copia del servicio al crear el cobro para que,
  -- si luego suben el precio del servicio, el histórico no cambie.
  -- Un recibo de 120 € sigue diciendo 120 € aunque el servicio hoy
  -- cueste 150.
  concepto    text not null,
  importe     numeric(12,2) not null check (importe >= 0),
  moneda      text not null default 'EUR',

  -- Para abonos y descuentos: 120 € menos 20 = 100.
  descuento   numeric(12,2) not null default 0 check (descuento >= 0),

  estado      cobro_estado not null default 'pendiente',

  emitido_en  date,
  vence_en    date,          -- cuándo se supone que lo pagan
  pagado_en   date,          -- cuándo llegó de verdad
  pagado_importe numeric(12,2) check (pagado_importe is null or pagado_importe >= 0),

  -- Nº de factura del banco, para cuadrar con la contabilidad.
  referencia   text,

  notas       text,
  creado_en   timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  -- No se puede marcar pagado sin decir cuándo se pagó.
  constraint pagado_con_fecha check (
    estado <> 'pagado' or pagado_en is not null
  ),

  -- Un solo cobro por servicio y periodo: es lo que evita que al
  -- pulsar "generar cobros del mes" dos veces se duplique la factura
  -- del cliente. 'unica' es el periodo para los pagos no mensuales.
  unique (service_id, periodo)
);

create index if not exists cobros_service  on cobros (service_id);
create index if not exists cobros_estado   on cobros (estado);
create index if not exists cobros_periodo  on cobros (periodo);
create index if not exists cobros_vence    on cobros (vence_en);

-- Mantener actualizado_en (misma función que usa services)
drop trigger if exists trg_cobros_touch on cobros;
create trigger trg_cobros_touch
  before update on cobros
  for each row execute function touch_actualizado();

-- ---------------------------------------------------------------------
-- Cuánto se ha facturado y cuánto está pendiente.
--
-- Es una vista y no una tabla porque es SIEMPRE derivable: si alguien
-- marca un cobro pagado y la vista no lo refleja, es que hay un bug.
-- Guardar el total en una tabla es la forma habitual de que se
-- desincronice sin que nadie se entere.
-- ---------------------------------------------------------------------
create or replace view v_cobros_resumen as
select
  c.service_id,
  count(*)::int                                        as total_cobros,
  count(*) filter (where c.estado = 'pendiente')::int  as pendientes,
  count(*) filter (where c.estado = 'impagado')::int   as impagados,
  count(*) filter (where c.estado = 'pagado')::int     as pagados,
  coalesce(sum(c.importe - c.descuento)
             filter (where c.estado in ('pendiente','impagado')), 0) as por_cobrar,
  coalesce(sum(c.importe - c.descuento)
             filter (where c.estado = 'pagado'), 0)                  as cobrado
from cobros c
where c.estado <> 'anulado'
group by c.service_id;

-- ---------------------------------------------------------------------
-- Cuánto entra cada mes, para el resumen del panel.
-- Por periodo, que es como se piensa al cerrar.
-- ---------------------------------------------------------------------
create or replace view v_cobros_mensual as
select
  c.periodo,
  count(*)::int as cobros,
  coalesce(sum(c.importe - c.descuento)
             filter (where c.estado = 'pagado'), 0)     as cobrado,
  coalesce(sum(c.importe - c.descuento)
             filter (where c.estado in ('pendiente','impagado')), 0) as pendiente
from cobros c
where c.estado <> 'anulado' and c.periodo is not null
group by c.periodo
order by c.periodo desc;
