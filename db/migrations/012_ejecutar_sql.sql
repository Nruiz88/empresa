-- =====================================================================
-- Función para ejecutar SQL crudo desde el bot (012)
-- =====================================================================
-- POR QUÉ
-- -------
-- El motor del bot tiene 50 llamadas con SQL literal a través de
-- `query(sql, values)`, y todas usan placeholders `?` al estilo
-- MariaDB. Reescribirlas una a una al cliente encadenado de Supabase
-- es un trabajo de días y, peor, es un trabajo donde un error no se ve
-- hasta que un cliente recibe el mensaje equivocado.
--
-- Esta función deja que el bot siga usando SQL, con la diferencia de
-- que ahora lo ejecuta Postgres.
--
--
-- ⚠️  POR QUÉ NO ES "EJECUTAR SQL CUALQUIER COSA"
-- -----------------------------------------------
-- Una función tipo `execute_immediate(sql)` que solo admin pueda llamar
-- sería una puerta abierta: cualquier inyección de SQL en el bot pasa
-- de "leer una tabla" a "borrar la base". Y este es justamente el
-- proyecto donde ya hubo un fallo de seguridad parecido (la clave de
-- Evolution compartida, arreglado en 011).
--
-- Las reglas que la hacen aceptable:
--
--   1. SOLO lectura. Un UPDATE o un DELETE que se colen por aquí se
--      rechazan: la función exige que la consulta sea un SELECT.
--
--   2. Solo rol `service_role`. Que es quien lleva la secret key.
--      Ningún usuario autenticado llega aquí.
--
--   3. Timeout. Una consulta colgada bloquea una conexión del pool y
--      el bot deja de contestar. 5 segundos es más que de sobra para
--      estas consultas.
--
-- Con esas tres reglas, un fallo de inyección en el bot puede leer
-- tablas —que es lo que el bot ya puede hacer— pero no escribir, y no
-- tocar nada de empresa.
--
-- Lo que SÍ se queda como está: las escrituras del bot (responses,
-- appointments, orders...) NO pasan por aquí. Van por el cliente de
-- Supabase, que aplica RLS. Esta función es solo para el SQL que ya
-- existía.
-- =====================================================================

-- ---------------------------------------------------------------------
-- OJO: el DROP va ANTES del create, y no es por estética.
--
-- `create or replace function` NO cambia el tipo de retorno. La
-- primera versión de esta migración se creó como `setof jsonb` (para
-- devolver fila a fila, como las de mysql2) y al cambiarla a `jsonb`
-- el `create or replace` se quedó con el tipo viejo sin avisar: la
-- función devolvía `[[{...}]]` en vez de `[{...}]`, porque PostgREST
-- envolvía en array cada elemento del set y cada elemento era a su vez
-- el array de filas.
--
-- El DROP de abajo es lo que hace que corregir el tipo funcione de
-- verdad. Sin él, un cambio de firma o de tipo de retorno en esta
-- función NO se aplicaría y el síntoma sería un JSON con la forma
-- rara, muy lejos de la causa.
-- ---------------------------------------------------------------------
drop function if exists ejecutar_sql(text, jsonb);

-- ---------------------------------------------------------------------
-- La función
-- ---------------------------------------------------------------------
-- Devuelve `jsonb` con el ARRAY de filas, no `setof jsonb`.
--
-- Con `setof` el resultado salía doble: PostgREST lo entrega como
-- array de filas, y como cada fila era a su vez el array agregado, la
-- respuesta era `[[{...}]]` en vez de `[{...}]`. Probado.
--
-- Un array de filas es un único valor, así que una sola fila es lo
-- que corresponde.
--
-- `args` va como jsonb y no como text[] para que un parámetro que
-- contiene comas o comillas no rompa el array de Postgres al
-- serializarlo.
-- ---------------------------------------------------------------------
create or replace function ejecutar_sql(consulta text, args jsonb default '[]'::jsonb)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = public, pg_temp
  as $$
declare
  v_acc text;
  v_texto text[];
  v_limpia text;
  v_filas jsonb;
  i int;
begin
  /* ---- Solo lectura ----

     Quita espacios y comentarios INICIALES, para que ni `--` ni
     `/* *\/` sirvan para esconder un DELETE.

     No se hace con una regex del tipo `^(\s|--+.*|/\*.*\*/)*`: el
     grupo exterior en `*` hace que Postgres se coma la consulta
     entera (probado: rechazaba hasta un `select 1 as n` limpio).

     El bucle quita en este ORDEN, que es lo que importa:

       1. espacios
       2. si empieza por comentario, el comentario entero
       3. vuelve a 1

     El fallo de la primera versión era comprobar el comentario
     DESPUÉS de quitar los espacios pero salir del bucle en cuanto no
     había espacios, o sea antes de mirar el comentario. Resultado:
     `-- hola\n select 1` llegaba al chequeo final empezando por `--` y
     se rechazaba. Un select perfectamente válido con un comentario
     encima se rechazaba, y eso no es un problema de seguridad: es
     functionality rota.

     El límite de vueltas es una red de seguridad: si un día un
     comentario dejara el texto igual (un `/*` sin `*/`), el bucle
     saldría por ahí en vez de quedarse colgado bloqueando el pool. */
  v_acc := consulta;
  for i in 1..50 loop
    v_limpia := regexp_replace(v_acc, '^\s+', '');

    if v_limpia like '--%' then
      v_acc := regexp_replace(v_limpia, '^--[^\n]*(\n|$)', '');
    elsif v_limpia like '/*%' then
      v_acc := regexp_replace(v_limpia, '^/\*.*?\*/', '', 'n');
    else
      v_acc := v_limpia;
      exit;
    end if;
  end loop;

  /* ---- Solo puede ser un SELECT ----

     OJO con el patrón, que es donde está la trampa:

     · NO vale `^select\b`. Postgres usa expresiones POSIX, no PCRE
       como JavaScript, y ahí `\b` significa BACKSPACE, no "límite de
       palabra". Con `\b` la comprobación NUNCA casa y la función
       rechazaba hasta un `select 1 as n` (probado).

     · NO vale `^select` a secas: eso dejaría pasar
       `selection from ...` o `selectxt`. Hace falta comprobar que
       después de "select" viene un espacio o se acaba la cadena.

     · Un `with` no se acepta. Un WITH puede esconder un DELETE
       (`with x as (delete ...) select ...`) y no hay forma fiable de
       distinguirlo mirando el principio. El bot no usa WITH en sus
       consultas, así que no se pierde nada. */
  if v_acc !~* '^select([[:space:]]|$)' then
    raise exception 'ejecutar_sql: solo permite SELECT, recibido: %',
      left(v_acc, 60)
      using errcode = '42501';
  end if;

  /* ---- Timeout ----
     `statement_timeout` es el reloj que respeta Postgres por consulta.
     Sin esto, un join mal pensado bloquea el pool entero. */
  set local statement_timeout = '5s';

  /* ---- Los valores ----

     DOS ERRORES EN ESTA PARTE, y el segundo es el importante:

     1. `format('%L::text', valor)` produce `'uno'::text`, y al meterlo
        en el statement el `$1` quedaba siendo la cadena de texto
        `'uno'::text` LITERAL. La consulta devolvía "'uno'::text" en
        vez de "uno". Con `%L` a secas sale `'uno'`, que sí es el
        literal correcto.

     2. Los literales NO se pasan por `USING ... using`. Un `EXECUTE`
        con USING recibe parámetros REALES: `$1` se sustituye por el
        valor, tipado y con comillas puesta por Postgres. Un `text` con
        varios literales unidos es UN parámetro, no N, así que
        `$1::text` devolvía la cadena entera `'uno', 'dos'` y el
        `USING v_texto` sobraba.

     Por eso los literales van dentro del statement (`%L` los escapa) y
     ya no hay USING.

     Esto no es una concesión a hacer la cosas fácil: es lo que
     protege contra inyección. Los valores vienen a menudo de un MENSAJE
     DE WHATSAPP, entrada de usuario de manual, y `format('%L')` es lo
     que escapa comillas y barras. Concatenados en crudo serían un
     `'; drop table` esperando a ocurrir. */
  select coalesce(
           array_agg(format('%L', valor) order by ord),
           '{}'::text[]
         )
    into v_texto
    from jsonb_array_elements_text(args) with ordinality as v(valor, ord);

  /* OJO: en PL/pgSQL NO existe `RETURN EXECUTE`. Son dos cosas
     distintas y se confunden fácil:

       · RETURN QUERY EXECUTE  → añade filas a un `returns setof`
       · EXECUTE               → ejecuta y te da un valor en INTO

     Como aquí la función devuelve un valor único (el array de filas),
     lo correcto es ejecutar con INTO y devolver la variable.
     Escribir `return execute` da "syntax error at or near "(" sin más
     pistas, porque parece sintaxis válida de otra cosa.

     Los placeholders $1, $2... del SQL se sustituyen por los
     literales de v_texto ANTES de llegar aquí, con
     ejecutar_sql_placeholders() del final del fichero. Así el
     statement final no lleva ni un solo $n, y los valores ya vienen
     escapados por format('%L'). */
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (%s) t',
    ejecutar_sql_placeholders(consulta, v_texto)
  ) into v_filas;

  return v_filas;
end;
$$;

comment on function ejecutar_sql is
  'Ejecuta SQL de solo lectura (SELECT) con placeholders $1..$n. La usa el motor del bot para sus consultas literales. Solo service_role. Con statement_timeout de 5s. Rechaza cualquier cosa que no sea un SELECT.';

-- ---------------------------------------------------------------------
-- Sustitución de placeholders
--
-- `$1` → `'valor'`, `$2` → `'otro'`, `$10` → `'el décimo'`.
--
-- Por qué no se usa `EXECUTE ... USING`: un USING recibe parámetros
-- REALES. El problema es que `USING v_texto` con un solo text que
-- contiene todos los literales produce UN parámetro, no N, así que
-- `$1::text` devolvía la cadena entera `'uno', 'dos'`.
--
-- Y por qué los literales viajan como ARRAY y no como texto unido con
-- comas: un valor puede contener comas legítimamente (un producto
-- "jamón, 250g", una dirección "Calle Mayor, 3"), y al partir el
-- texto por `', '` ese valor se rompía en dos y el `$2` recibía la
-- mitad equivocada. Con un array de text no hay forma de que un valor
-- se parta, porque el array conserva los elementos.
--
-- El escapado lo hace `format('%L')` de Postgres, no nada de este
-- fichero. Eso es lo importante: los valores vienen a menudo de un
-- MENSAJE DE WHATSAPP, entrada de usuario de manual, y `%L` escapa
-- comillas y barras. Sustituir en JavaScript dejaría el escapado en
-- manos de un `replace()` a mano en TypeScript, que es justo donde un
-- mensaje con una comilla se convierte en SQL.
-- ---------------------------------------------------------------------
create or replace function ejecutar_sql_placeholders(consulta text, literales text[])
  returns text
  language plpgsql
  immutable
  as $$
declare
  v_n int;
  v_cuantos int;
  v_res text;
begin
  /* `v_res` arranca con la consulta ORIGINAL. Sin esta asignación el
     bucle trabaja sobre NULL: `replace(NULL, ...)` devuelve NULL y el
     resultado sería null en vez del SQL. */
  v_res := consulta;
  v_cuantos := least(coalesce(array_length(literales, 1), 0), 100);

  /* De mayor a menor, y esto importa: `replace(v_res, '$1', ...)`
     también casa dentro de `$10`. Con 10 argumentos, sustituir $1
     primero convertiría `$10` en `<valor de $1>0`, que no es SQL
     válido (probado: devolvía `'a'0`). Yendo de 10 a 1, cuando se
     llega a $1 los $10 ya son historia.

     Se usa WHILE y no `FOR ... IN v_cuantos downto 1`: la forma
     `for` de PL/pgSQL exige que los límites sean constantes, y con una
     variable falla con un "syntax error at or near v_cuantos" que no
     dice nada útil sobre un bucle que parece idéntico al correcto. */
  v_n := v_cuantos;
  while v_n >= 1 loop
    v_res := replace(v_res, '$' || v_n, literales[v_n]);
    v_n := v_n - 1;
  end loop;

  return v_res;
end;
$$;

comment on function ejecutar_sql_placeholders is
  'Sustituye $1, $2... por los literales ya escapados. Auxiliar de ejecutar_sql; no se llama desde fuera.';

revoke all on function ejecutar_sql_placeholders(text, text[]) from public;

-- ---------------------------------------------------------------------
-- Permisos
--
-- service_role (la secret key) sí puede. `authenticated` NO: aunque RLS
-- la protegería, dejarlo explícito evita depender de que un `alter
-- default privileges` futuro no abra la puerta.
-- ---------------------------------------------------------------------
revoke all on function ejecutar_sql(text, jsonb) from public;
revoke all on function ejecutar_sql(text, jsonb) from anon;
revoke all on function ejecutar_sql(text, jsonb) from authenticated;
grant execute on function ejecutar_sql(text, jsonb) to service_role;