-- =====================================================================
-- Shopcito — Token de Evolution por instancia (migración 026)
-- =====================================================================
--
-- POR QUÉ
--
-- Hoy `evolution_servers.api_key` guarda la clave GLOBAL de la caja de
-- Evolution: la que entra a todas las instancias. La tabla `bots` pide
-- la URL y la clave del servidor con un JOIN, y con eso el bot de un
-- cliente puede leer los chats, el número y el webhook del otro.
--
-- Con una sola instancia no se nota: la clave global ve una cosa y no hay
-- nada que cruzar. El problema aparece con el SEGUNDO cliente, que es
-- exactamente cuando ya hay datos de los dos.
--
-- Comprobado en esta caja:
--
--   · con la clave global, /instance/fetchInstances devuelve TODAS;
--   · con el token de la instancia, devuelve solo la suya.
--
-- Evolution llama a esa clave `AUTHENTICATION_API_KEY` y al otro
-- `token` de la instancia. Los dos sirven para enviar: se comprobó con
-- un envío real, HTTP 201.
--
-- ── POR QUÉ UNA COLUMNA Y NO UNA TABLA NUEVA ──
--
-- Porque el token pertenece a la instancia, y `bots` YA es la tabla que
-- dice qué instancia es cuál. Una tabla aparte obligaría a unir dos
-- veces para algo que ya está unido, y a mantener sincronizadas dos
-- fuentes de la misma verdad.
--
-- ── POR QUÉ ES NULLABLE ──
--
-- Porque hay que poder volver atrás. Con NULL, el código usa la clave
-- del servidor, que es lo que hace hoy. Un despliegue con la columna
-- vacía no rompe el bot: degrada al comportamiento anterior. Eso es
-- importante en una migración de esto, porque si algo va mal se
-- deshace vaciando una columna y no hay que tocar código.
--
-- ── LO QUE NO SE HACE AQUÍ ──
--
-- No se copia ningún token en la migración. La caja puede rotarlos, y un
-- valor viejo en la base es peor que ninguno: el bot usaría un token
-- revocado y fallaría sin explicación. Los copia un script que los lee
-- de la caja en el momento.
--
-- ── EL ROL DE ESTA TABLA, POR SI SE LEE ──
--
-- RLS: es del servidor, no del cliente. Nadie la lee desde el navegador
-- y los tokens no se devuelven en ninguna respuesta.
-- =====================================================================

alter table bots
  add column if not exists instance_token text;

comment on column bots.instance_token is
  'Token de ESTA instancia en Evolution. Con NULL se usa la clave global del servidor, que ve todas las instancias. Con dos clientes, usar siempre el token: la clave global permite que el bot de uno lea los chats del otro.';