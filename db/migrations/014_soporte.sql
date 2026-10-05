-- =====================================================================
-- Soporte: que el equipo pueda entrar en el bot de un cliente (014)
-- =====================================================================
-- EL PROBLEMA
-- -----------
-- Hoy staff NO puede entrar en el bot, y no es por una comprobación en
-- el código: es por las tres capas de la base, que sereinventaron cada
-- una por su cuenta. Quitiar el `if (!p.cid)` de la ruta de entrada NO
-- arregla nada, porque:
--
--   1. `bot_sesiones.client_id` es NOT NULL. Staff no pertenece a ningún
--      cliente, así que no cabe en la tabla.
--   2. `es_dueno_de_bot()` exige `p.rol = 'client'`. Staff queda fuera
--      aunque se le asigne un client_id.
--   3. RLS filtra por esa función en todas las tablas del bot.
--
-- Decidir esto en la base y no en el código es lo que hace que no se
-- pueda colar por un sitio que nadie revisó.
--
--
-- LA DECISIÓN: CONTEXTO, NO EXCEPCIÓN
-- -----------------------------------
-- Hay dos formas de darle acceso a staff, y solo una es defendible:
--
--   a) "El staff ve todos los bots." Es un `or es_staff()` en cada
--      política. Una línea, y para siempre. El problema es que el acceso
--      no deja rastro de nada: en seis meses no se puede responder a
--      "quién miró los pedidos de este cliente", porque la respuesta
--      sería "cualquiera del equipo, en cualquier momento".
--
--   b) "El staff entra en EL cliente que elige, y solo mientras dura esa
--      sesión." Es lo que hace esto. El acceso es un ACTO concreto,
--      con cliente, con motivo y con hora. Y caduca solo.
--
-- Se elige (b). La diferencia es que (a) es una puerta y (b) es una
-- visita.
--
--
-- POR QUÉ `soporte_de` Y NO SIMPLEMENTE `client_id`
-- -------------------------------------------------
-- Con `client_id` puesto, un staff con sesión parecería un cliente: el
-- resto del código no distinguiría uno de otro, y un cambio de
-- configuración hecho por soporte parecería del cliente. Con
-- `soporte_de` la fila dice las dos cosas a la vez: actúa sobre este
-- cliente Y no es el cliente. Se puede preguntar quién tocó qué, y se
-- puede hacer que el bot se comporte distinto (ver más abajo).
--
-- `client_id` se deja nullable porque hay un momento en que staff ya
-- tiene sesión en el bot pero todavía no ha elegido cliente: entre
-- canjear el ticket y elegir a quién atiende. En esa ventana no hay
-- nada que proteger, porque `puede_ver_bot()` no le da acceso a ningún
-- bot sin `soporte_de`.
--
--
-- ⚠️  ESTO DA ESCRITURA
-- ---------------------
-- Staff puede EDITAR la configuración del bot del cliente que atiende.
-- Es una decisión consciente: el motivo por el que soporte entra casi
-- siempre es que algo está mal funcionando, y "no puedes tocar nada"
-- convierte cada incidencia en un ida y vuelta.
--
-- El riesgo de dar escritura a un member del equipo sobre datos de un
-- cliente se contiene con tres cosas, todas en esta migración:
--
--   1. Solo sobre UN cliente a la vez, elegido explícitamente.
--   2. Solo mientras la sesión sigue viva (4 horas, y se puede cerrar).
--   3. Toda escritura pasa por `es_soporte_escritura()`, que además
--      comprueba que el motivo es una cadena de verdad, no un espacio.
--
-- Y lo que NO puede hacer, aunque tenga la sesión: cambiar `client_id`
-- ni `server_id` de un bot. Mover un bot a otra instancia de Evolution
-- le cambiaría el número de WhatsApp y sus conversaciones. Eso ni el
-- cliente lo puede hacer hoy.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. La tabla de sesiones admite un staff sin cliente
-- ---------------------------------------------------------------------

alter table bot_sesiones alter column client_id drop not null;

comment on column bot_sesiones.client_id is
  'Cliente dueño de la sesión. NULL solo para staff antes de elegir a quién atiende: en esa ventana no tiene acceso a ningún bot.';

/* El cliente al que esta sesión de staff está atendiendo.
   Es lo que abre la puerta en RLS, así que se mira en todas partes. */
alter table bot_sesiones
  add column if not exists soporte_de uuid references clients on delete cascade;

/* Por qué entra. Es obligatorio y no vacío a propósito.

   Sin esto, el registro de auditoría dice "alguien del equipo entró"
   y no dice para qué, que es justo lo que uno quiere saber al leerlo
   seis meses después. Un motivo obligatorio convierte el acceso en
   algo que hay que justificar antes de hacerlo. */
alter table bot_sesiones
  add column if not exists soporte_motivo text;

alter table bot_sesiones
  add column if not exists soporte_abierto_en timestamptz;

create index if not exists ix_bot_sesiones_soporte on bot_sesiones (user_id, soporte_de)
  where soporte_de is not null and revocado_en is null;

comment on column bot_sesiones.soporte_de is
  'Cliente que esta sesión de staff atiende. Es lo que concede acceso en RLS: sin esta columna puesta, el staff no ve NINGÚN bot, ni propio ni ajeno.';
comment on column bot_sesiones.soporte_motivo is
  'Por qué soporte entra en el bot de este cliente. Obligatorio y no vacío si soporte_de está puesto.';


-- ---------------------------------------------------------------------
-- 2. Las reglas de acceso
-- ---------------------------------------------------------------------

-- 2a. La que ya existe, SIN TOCAR.
--
-- Sigue siendo la del cliente y solo la del cliente. No se le añade un
-- `or es_staff()`: si se tocara, un staff con sesión en el bot del
-- cliente A vería también el bot del cliente B, que es exactamente el
-- fallo que esto evita.
create or replace function es_dueno_de_bot(bot_uuid uuid)
  returns boolean
  language sql stable security definer
  set search_path = public
  as $$
    select exists (
      select 1
      from bots b
      join profiles p on p.client_id = b.client_id
      where b.id = bot_uuid
        and p.id = auth.uid()
        and p.rol = 'client'
        and p.activo
    );
  $$;

comment on function es_dueno_de_bot is
  'Solo el CLIENTE dueño. No incluye staff: staff entra por puede_ver_bot(), que exige una sesión de soporte abierta sobre ese cliente concreto.';


-- 2b. La nueva: cliente dueño O staff atendiendo a ese cliente.
--
-- Lo importante es la segunda mitad: `soporte_de` tiene que ser
-- EXACTAMENTE el cliente del bot que se está mirando. Con solo
-- comprobar que la sesión existe, un staff que atiende al cliente A
-- vería los bots de todos, porque su sesión sigue puesta mientras
-- trabaja en otra cosa.
create or replace function puede_ver_bot(bot_uuid uuid)
  returns boolean
  language sql stable security definer
  set search_path = public
  as $$
    select es_dueno_de_bot(bot_uuid)
       or exists (
         select 1
         from bots b
         join profiles p on p.id = auth.uid()
         join bot_sesiones s on s.soporte_de = b.client_id
         where b.id = bot_uuid
           and p.rol = 'staff'
           and p.activo
           and s.user_id = p.id
           and s.revocado_en is null
           and s.expira_en > now()
       );
  $$;

comment on function puede_ver_bot is
  'ÚNICA regla de lectura del bot. El cliente, con es_dueno_de_bot; el staff, solo si tiene una sesión de soporte VIVA sobre el MISMO cliente que el bot. Sin sesión viva, staff no ve nada.';


-- 2c. Para escribir: lo mismo, más un motivo de verdad.
--
-- Separar lectura de escritura tiene un motivo concreto: el motivo es
-- información para el que audita, no un adorno. Que sea obligatorio
-- solo al escribir hace que "mirar" siga siendo ligero y que "tocar"
-- deje un rastro que se puede exigir.
create or replace function es_soporte_escritura(bot_uuid uuid)
  returns boolean
  language sql stable security definer
  set search_path = public
  as $$
    select
      exists (
        select 1
        from bots b
        where b.id = bot_uuid and es_dueno_de_bot(b.id)
      )
      or exists (
        select 1
        from bots b
        join profiles p on p.id = auth.uid()
        join bot_sesiones s on s.soporte_de = b.client_id
        where b.id = bot_uuid
          and p.rol = 'staff'
          and p.activo
          and s.user_id = p.id
          and s.revocado_en is null
          and s.expira_en > now()
          and s.soporte_motivo is not null
          and btrim(s.soporte_motivo) <> ''
      );
  $$;

comment on function es_soporte_escritura is
  'Permiso de escritura en el bot. El cliente siempre; staff solo con sesión viva sobre ese cliente Y motivo no vacío.';


-- ---------------------------------------------------------------------
-- 3. Las políticas, cambiadas a la regla nueva
-- ---------------------------------------------------------------------
-- Solo cambian las de `bots`. Las del resto de tablas ya pasan por
-- `es_dueno_de_bot(bot_id)` y se cambian más abajo, en el mismo
-- patrón.

drop policy if exists "leer su bot" on bots;
create policy "leer su bot"
  on bots for select to authenticated
  using (puede_ver_bot(id));

/* El WITH CHECK se queda como estaba, y es lo que hace que soporte
   NO pueda mover un bot de sitio.

   Sin esto, un staff con sesión de soporte podría hacer
   `update bots set server_id = <instancia de otro cliente>` y
   quedarse con su número de WhatsApp. Con esto, el servidor y el
   cliente no se pueden cambiar por nadie: ni el cliente ni soporte.
   Que sea soporte tiene una importance que no se ve: el WITH CHECK se
   evalúa contra la fila RESULTANTE, así que sigue valiendo igual. */
drop policy if exists "editar su bot" on bots;
create policy "editar su bot"
  on bots for update to authenticated
  using (puede_ver_bot(id))
  with check (
    es_soporte_escritura(id)
    and client_id = (select client_id from bots where id = bots.id)
    and server_id = (select server_id from bots where id = bots.id)
  );

/* Ni INSERT ni DELETE, ni para el cliente ni para soporte. El alta la
   hace el panel del equipo y el borrado también. Sin esta
   restricción, soporte podría insertarse un bot apuntando al servidor
   de otro cliente. */


-- ---------------------------------------------------------------------
-- 4. El resto de tablas del bot
-- ---------------------------------------------------------------------
-- Todas pasan por la misma regla, así que staff ve y escribe lo mismo
-- que el cliente sobre el bot que atiende, y nada más.

do $$
declare
  t text;
begin
  foreach t in array array[
    'bots_responses', 'bots_business_hours', 'bots_catalog_items',
    'bots_appointments', 'bots_orders'
  ]
  loop
    execute format('drop policy if exists "gestionar sus datos" on %I', t);
    execute format(
      'create policy "gestionar sus datos" on %I for all to authenticated '
      || 'using (puede_ver_bot(bot_id)) with check (es_soporte_escritura(bot_id))',
      t
    );
  end loop;
end;
$$;

comment on policy "gestionar sus datos" on bots_responses is
  'Cliente dueño o staff atendiendo a ese cliente. Ver puede_ver_bot().';