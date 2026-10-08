-- =====================================================================
-- La palabra que abre la agenda (020)
-- =====================================================================
-- EL PEDIDO
-- ---------
-- "En la parte de calendario, un campo para que el usuario configure la
--  palabra que activa la respuesta del calendario o turnos."
--
-- Antes esa lista estaba metida en el código del bot:
--
--     const bookingKeywords = ["turno", "agendar", "reservar", "cita",
--                               "appointment", "agenda"];
--
-- Es decir que era la MISMA para todos los clientes. Un negocio que
-- trabaja con "reservar" y nunca dice "turno" se ve obligado a adivinar
-- cuál de las seis palabras escribe su cliente, y no hay forma de
-- ajustarlo.
--
--
-- LA DECISIÓN: SE SUMA, NO REEMPLAZA
-- -----------------------------------
-- Esta columna es una palabra ADICIONAL, no un reemplazo.
--
-- La tentación es hacer que el campo definiera la única palabra válida, que
-- es lo que suena más limpio. Pero el que escribe es el cliente final del
-- comercio, no el dueño del bot: nadie le va a decir a la gente que
-- escriba "reservá". Si el dueño del bot pone "mesa" y desactiva "turno",
-- la próxima persona que escriba "turno" —que es lo más natural que hay—
-- deja de obtener respuesta, y va a pensar que el bot está roto.
--
-- Con esta decisión, poner la palabra nueva no puede romper ninguna de las
-- que ya funcionaban. Se pueden añadir tantas como haga falta.
--
-- NULL (el caso de todos los bots de hoy) = solo las palabras de siempre.
--
--
-- POR QUÉ EN `bots` Y NO EN UNA TABLA DE AJUSTES
-- ----------------------------------------------
-- Porque es una propiedad del bot, como `welcome_message` y
-- `outside_hours_message`, que ya viven ahí y se editan por
-- `/api/instance-settings`. Una tabla de key/value para una sola
-- preference sería más ceremony que ayuda.
--
-- OJO con el UPDATE de RLS de `bots` (migración 014): su WITH CHECK exige
-- que `client_id` y `server_id` no cambien, y deja pasar el resto de las
-- columnas. Por eso esta se puede escribir sin tocar ninguna política.
-- =====================================================================


alter table bots
  add column if not exists booking_keyword text;

comment on column bots.booking_keyword is
  'Palabra ADICIONAL que abre la agenda de turnos, del cliente (ej: "mesa", "sala"). NULL = solo las de siempre (turno, agendar, reservar, cita, appointment, agenda). Se compara como subcadena, sin distinguir mayúsculas y sin tildes.';


/* Límite de longitud y de "una sola palabra".

   El bot compara el mensaje con `includes()`, así que una frase entera
   ("quiero sacar un turno por favor") nunca va a matchear y sería un
   campo que el cliente llena creyendo que funciona. Un aviso de 40
   caracteres y un solo token es lo que hace falta. */
/* El CHECK va dentro de un DO porque `add constraint` no es idempotente como
   `add column if not exists`: si el archivo se vuelve a correr, un
   `alter table ... add constraint` a secas aborta con "ya existe" y la
   migración queda a medio aplicar. */
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'booking_keyword_forma'
  ) then
    alter table bots
      add constraint booking_keyword_forma check (
        booking_keyword is null
        or (char_length(booking_keyword) between 2 and 40
            and booking_keyword !~ '\s')
      );
  end if;
end;
$$;