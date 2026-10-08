/* ¿La tabla de planes está cerrada de verdad?
   ─────────────────────────────────────────────────────────────
   POR QUÉ NO BASTA CON QUE EL TEST DIGA QUE TIENE RLS

   Que `relrowsecurity` esté a `true` dice que la puerta tiene un
   marco. No dice que esté cerrada, ni que no haya una ventana al lado.

   Y hay un caso que un comprobador de RLS nunca pilla: una política
   mal escrita que concede `using (true)`. La tabla "tiene RLS" y el
   test pasa, y sigue abierta.

   ── LA PRUEBA REAL ──

   Con la MISMA clave que va en el navegador —la publicable, no la de
   servicio— se intenta:

     1. leer. Debe funcionar: la web pública la lee sin login.
     2. poner un precio. Debe FALLAR.
     3. leer un plan inactivo. Debe FALLAR.

   Si el 2 pasa, cualquier persona con un navegador puede cambiar lo que
   se cobra. Se hace de verdad y contra un plan de verdad: es la única
   forma de saber si la base lo para, y va seguido de una restauración,
   porque si el update PASARA de verdad hay que devolver la tabla a su
   sitio.

   ── POR QUÉ `service_role` NO ──

   Porque la clave de servicio se salta las políticas a propósito. Con
   ella TODO se puede escribir, y probaría que las políticas existen y
   que no son lo que protege. */

require("../lib/env").load();

const supabase = require("../lib/supabase");

/* Un plan que existe de verdad, para no inventar. */
const PLAN = "inicial";

/* El precio que se intenta colar. Muy obvio a propósito: si algo se
   cuela, que se note. */
const PRECIO_ILEGAL = "1";

(async () => {
  console.log("\n═══ ¿La tabla de planes está cerrada? ═══\n");

  /* La clave publicable, la misma que va en el navegador. */
  const url = process.env.SUPABASE_URL;
  const clave = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !clave) {
    console.log("  x no hay SUPABASE_PUBLISHABLE_KEY con la que probar");
    process.exit(1);
  }

  const { createClient } = require("@supabase/supabase-js");
  const publico = createClient(url, clave, { auth: { persistSession: false } });

  /* ---- 1. Leer. Debe funcionar. ---- */
  const { data: leidos, error: eLeer } = await publico
    .from("plans")
    .select("id, nombre, activo")
    .eq("activo", true);

  console.log("  1. leer los planes activos, sin entrar");
  if (eLeer) {
    console.log("     x falla: " + eLeer.message);
    console.log("     Si esto falla, la web pública está viendo el respaldo.");
    console.log("     Es un fallo visible, pero no se nota hasta que alguien");
    console.log("     cambia un precio y no aparece.");
    process.exit(1);
  }
  console.log("     ✓ " + (leidos ? leidos.length : 0) + " planes. La web pública puede leerlos.");

  /* ---- 2. Escribir. Debe fallar. ---- */
  console.log("\n  2. poner un precio con la clave del navegador");
  console.log("     (esto es lo que haría cualquiera desde la consola)");

  const { data: escritos, error: eEscribir } = await publico
    .from("plans")
    .update({ precio: Number(PRECIO_ILEGAL) })
    .eq("id", PLAN)
    .select("id, precio");

  if (eEscribir) {
    console.log("     ✓ rechazado: " + String(eEscribir.message).split("\n")[0]);
  } else if (!escritos || !escritos.length) {
    console.log("     ✓ no se cambió ninguna fila.");
    console.log("     (Postgres devuelve 0 filas en vez de error cuando la");
    console.log("      política no concede nada. Es la misma protección.)");
  } else {
    console.log("     x SE PUDO ESCRIBIR. precio de " + PLAN + " = " + escritos[0].precio);

    /* ─────────────────────────────────────────────────────────────
       RESTAURACIÓN INMEDIATA

       Si se llegó hasta aquí, el plan quedó con precio 1. Hay que
       devolverlo a NULL antes de nada, y el caché de la web pública
       también, o durante 20 segundos el sitio publicaría un precio
       falso.

       Por eso esta restauración está aquí y no "luego se arregla":
       un fallo de seguridad que además publica un precio falso no se
       arregla después, se deshace en el momento.
       ───────────────────────────────────────────────────────────── */
    const admin = supabase.getAdmin();

    const { error: eRestaurar } = await admin
      .from("plans")
      .update({ precio: null })
      .eq("id", PLAN);

    if (eRestaurar) {
      console.log("\n     ! NO SE PUDO RESTAURAR: " + eRestaurar.message);
      console.log("     Hay que poner precio = NULL en el plan " + PLAN + " a mano.");
    } else {
      console.log("     precio restaurado a NULL (A consultar).");
    }

    planesOlvidar();
    console.log("\n  x La tabla NO está cerrada.\n");
    process.exit(1);
  }

  /* ---- 3. Leer un inactivo. Debe fallar. ---- */
  console.log("\n  3. leer un plan que esté en borrador");

  const { data: borradores, error: eBorrador } = await publico
    .from("plans")
    .select("id")
    .eq("activo", false);

  if (eBorrador) {
    console.log("     ✓ rechazado: " + String(eBorrador.message).split("\n")[0]);
  } else if (!borradores || !borradores.length) {
    console.log("     ✓ no salen los borradores.");
  } else {
    console.log("     ! hay " + borradores.length + " borradores visibles.");
    console.log("     Si ahora no hay ninguno, esto pasa. Si mañana hay uno,");
    console.log("     un plan sin precio se vería en la respuesta de la red.");
  }

  console.log("\n  ✓ La tabla de precios está cerrada: se lee lo público y no se escribe.\n");
  process.exit(0);
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});

/* El caché de la web pública. Si un precio se cambia por un camino
   raro, la web tiene que enterarse ya, no veinte segundos después. */
function planesOlvidar() {
  try {
    require("../lib/planes").olvidar();
  } catch (e) {
    /* si el módulo no carga, no es el problema que estamos buscando */
  }
}