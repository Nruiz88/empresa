-- =====================================================================
-- Shopcito — Aplicaciones y planes (migración 030)
-- =====================================================================
--
-- QUÉ MODELA ESTO
--
-- Hay dos maneras de darle acceso a un cliente a un microservicio, y son
-- distintas:
--
--   · suelta   compra una aplicación concreta y la paga por separado;
--   · por plan compra un plan, que le da acceso a varias de golpe.
--
-- La diferencia importa, porque el precio es otro: una aplicación suelta
-- se paga sola, y un plan se paga una vez aunque dé acceso a tres. Por
-- eso `services` distingue de dónde viene cada acceso: si viene de un
-- plan, no se factura por aplicación, porque ya se pagó el plan.
--
-- ── POR QUÉ NO SE GUARDA "QUÉ APLICACIONES TIENE" ──
--
-- Porque sería una copia. El plan es el que dice qué incluye, y si se
-- copiara a cada cliente, cambiar el plan obligaría a recorrer todos los
-- servicios para actualizarlos, y alguno se quedaría atrás sin que nadie
-- lo notara.
--
-- Acá se guarda el acceso y se CALCULA lo que incluye el plan. La fuente
-- es una.
--
-- ── LOS 15 DÍAS DE MARGEN ──
--
-- Al vencer, el bot sigue andando quince días. No es un detalle: si al
-- vencer cortara en seco, un cliente que se olvidó de pagar un mes
-- perdía el número de golpe, y un cliente que perdió el número no
-- vuelve.
--
-- Se calculan en la consulta, no se guardan en la fila. Guardar la fecha
-- de corte sería guardar algo que depende de la fecha de vencimiento, y
-- eso se desactualiza solo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Los tipos de servicio
-- ---------------------------------------------------------------------

-- Los valores del ENUM (`aplicacion` y `plan`) se agregan en la 029.
--
-- No se pueden declarar aquí: en Postgres un valor de ENUM no se puede
-- usar en la misma transacción en que se agrega, y el CHECK de más abajo
-- los compara. Con las dos cosas juntas la migración falla con:
--
--     unsafe use of new value "aplicacion" of enum type service_kind

-- ---------------------------------------------------------------------
-- Qué es una aplicación y cuánto vale
-- ---------------------------------------------------------------------

alter table microservicios
  add column if not exists descripcion text not null default '',
  add column if not exists precio numeric,
  add column if not exists moneda text not null default 'ARS',
  add column if not exists periodo text not null default 'mes';

comment on column microservicios.precio is
  'Precio mensual de la aplicación comprada suelta. Nulo significa que no se vende suelta: solo por plan.';

-- ---------------------------------------------------------------------
-- Qué aplicaciones da cada plan
-- ---------------------------------------------------------------------

alter table plans
  add column if not exists aplicaciones text[] not null default '{}';

comment on column plans.aplicaciones is
  'Claves de microservicios.modulo que da este plan. Vacío significa que el plan no da acceso a ninguna aplicación.';

-- ---------------------------------------------------------------------
-- El acceso: de dónde viene
-- ---------------------------------------------------------------------

alter table services
  add column if not exists microservicio_clave text
    references microservicios(modulo) on delete set null,
  add column if not exists plan_id text
    references plans(id) on delete set null;

comment on column services.microservicio_clave is
  'Acceso a UNA aplicación. Se llena si el servicio se contrató suelto.';
comment on column services.plan_id is
  'Acceso por PLAN. Se llena si el servicio es un plan, y entonces las aplicaciones las da el plan, no esta fila.';

-- ---------------------------------------------------------------------
-- Que cada tipo de servicio diga de dónde viene
-- ---------------------------------------------------------------------
--
-- La comprobación va ACÁ y no solo en el formulario, porque el
-- formulario es una de las formas de escribir y no la única: hay scripts,
-- hay importaciones, y un día alguien hace un UPDATE desde una consola.
--
-- Y aquí ya se pueden usar los valores del ENUM, porque los agregó la
-- 029 en otra transacción.
--
-- Y es `not valid` a propósito: hay servicios viejos de los tipos
-- anteriores que no cumplirían, y una migración que falla deja la base a
-- medias. Con `not valid` la restricción queda puesta y avisa de lo viejo
-- sin bloquear. Las viejas no tienen microservicio porque no son
-- aplicaciones.

alter table services
  add constraint servicios_dicen_de_donde_vene
  check (
    -- los tipos viejos no dicen nada de dónde vienen
    (kind in ('mantenimiento', 'proyecto', 'presupuesto'))
    -- una aplicación viene de una aplicación, y solo de una
    or (kind = 'aplicacion' and microservicio_clave is not null and plan_id is null)
    -- un plan viene de un plan, y solo de un plan
    or (kind = 'plan' and plan_id is not null and microservicio_clave is null)
  ) not valid;

-- ---------------------------------------------------------------------
-- Que un plan de verdad dé acceso a algo
-- ---------------------------------------------------------------------
--
-- Un plan sin aplicaciones no da acceso a nada, y eso no es un plan: es
-- una promesa que no se cumple. Se comprueba en el formulario, que es
-- donde se elige, y no con una restricción de tabla, porque un plan
-- puede existir vacío mientras se está armando.

comment on table services is
  'Lo que un cliente tiene contratado. kind = aplicacion es una aplicación comprada suelta; kind = plan da acceso a todas las del plan. El precio se factura UNA vez: el del plan, no el de cada aplicación.';