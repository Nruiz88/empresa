-- =====================================================================
-- Shopcito — Separar "está encendido" de "se está vendiendo" (031)
-- =====================================================================
--
-- QUÉ ESTÁ PASANDO
--
-- Hay tres cosas que se confundían en un solo campo:
--
--   1. Si el microservicio responde.        infraestructura
--   2. Si lo queremos comercializar.        negocio
--   3. Si el cliente lo tiene contratado.    otro sitio, `services`
--
-- El campo `activo` nació para la primera, que es lo que muestra la
-- pantalla de salud: "¿este servicio está levantado?". Cuando se
-- añadió la venta, ese mismo campo empezó a decidir la segunda, y
-- quedó con las dos respuestas.
--
-- El síntoma era que las tres aplicaciones tenían precio y stock
-- puestos, y Planes decía "no se está vendiendo" al lado. No era un
-- problema de datos mal cargados: `activo` valía falso porque los
-- microservicios no están levantados en ningún servidor, que es un
-- dato de infraestructura.
--
-- POR QUÉ NO SE REAPROVECHA EL CAMPO
--
-- Porque las dos preguntas tienen respuestas opuestas a veces:
--
--   vendible y apagado    se anuncia, todavía no se instala
--   encendido sin vender  está en pruebas, no se anuncia
--
-- Con un solo campo no se puede expresar ninguno de los dos casos, y
-- obligar a levantar un servidor para poder poner un precio es al
-- revés de cómo funciona un negocio: primero se anuncia, después se
-- instala.
--
-- QUÉ HACE ESTA MIGRACIÓN
--
-- Agrega `vendible`, que es lo que responde a la pregunta de negocio.
-- `activo` se queda como estaba y sigue siendo lo que lee la pantalla
-- de salud. No se toca ningún otro sitio.
--
-- EL VALOR DE PARTIDA
--
-- `vendible` nace en `true` para todo lo que ya tenía precio, porque
-- si alguien le puso un precio es que lo quiere vender. Y en `false`
-- para lo que no tiene precio, porque no se vende lo que no tiene
-- precio. Así el catálogo no cambia de un día para otro y nadie
-- pierde una venta por un campo nuevo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- El campo nuevo
-- ---------------------------------------------------------------------
alter table microservicios
  add column if not exists vendible boolean;

comment on column microservicios.vendible is
  'Si esta aplicación se ofrece a los clientes. Es una decisión de negocio y no tiene nada que ver con que el microservicio esté encendido: `activo` es para la pantalla de salud. Se puede vender algo que todavía no está levantado, y al revés.';

-- ---------------------------------------------------------------------
-- El valor de partida
-- ---------------------------------------------------------------------
-- Con precio = se está vendiendo. Es lo que alguien hizo al cargar el
-- catálogo, y no hay razón para ignorar ese dato.
--
-- Sin precio = no se vende. No se vende lo que no tiene precio, y el
-- panel ya lo trata como "a consultar" en los planes.
update microservicios
   set vendible = (precio is not null and precio > 0)
 where vendible is null;

-- ---------------------------------------------------------------------
-- Que no vuelva a quedar sin decidir
-- ---------------------------------------------------------------------
-- Sin esto, una fila nueva nace en `null`, que en el `if` de la vista
-- es falso: se trataría como no vendible sin que nadie lo hubiera
-- elegido. Un valor que significa "nadie lo ha decidido" no debe
-- existir, porque el panel no puede distinguirlo de un "no".
--
-- El default es `false` y no `true` a propósito: una aplicación nueva
-- no se anuncia sola. Hay que decidir que se vende.
alter table microservicios
  alter column vendible set default false;

alter table microservicios
  alter column vendible set not null;

-- ---------------------------------------------------------------------
-- Que no se pueda vender sin precio
-- ---------------------------------------------------------------------
-- `numeric` con esa condición es un CHECK, y no un trigger: si algún
-- día alguien escribe por la consola, la base lo rechaza igual.
--
-- Con esta regla, "está vendiendo y no tiene precio" no es un estado
-- que exista. Un precio de 0 sí se permite, porque un plan gratis es
-- una decisión válida; lo que no tiene sentido es nada.
alter table microservicios
  drop constraint if exists microservicios_vendible_con_precio;

alter table microservicios
  add constraint microservicios_vendible_con_precio
  check (not vendible or (precio is not null and precio > 0));

-- =====================================================================
-- LO QUE NO SE TOCA
-- =====================================================================
--
-- `activo` sigue igual, y la pantalla de salud sigue leyéndolo. El
-- cambio es solo que la venta lee otra columna.
--
-- Los planes no se tocan: `plans.aplicaciones` sigue guardando las
-- claves de los microservicios incluidos, y `services.kind` sigue
-- distinguiendo una aplicación suelta de un plan.
-- =====================================================================