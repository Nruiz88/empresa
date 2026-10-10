/* Borra el usuario de las pruebas y deja la tabla de planes como estaba. */

require("../../lib/env").load();

const db = require("../../lib/supabase").getAdmin();
const { staffOParar } = require("../../lib/staff");

(async () => {
  console.log("\n═══ Limpieza ═══\n");

  /* Se resuelve DENTRO, no arriba del todo.

     Un `await` en el nivel de módulo no vale en CommonJS: el archivo
     ni siquiera carga. Por eso va aquí, que ya estamos dentro de una
     función async. */
  const USUARIO = (await staffOParar()).email;

  /* El borrado va por el cliente admin, no por el RPC `ejecutar_sql`.
     Ese RPC solo acepta SELECT, a propósito: es lo que impide que un
     script con una consulta escrita mal acabe vaciando una tabla. Y por
     eso no se puede usar ni para esta limpieza. */
  /* Dos tablas, no una. El usuario de Supabase (`clients`) es la cuenta
     que puede entrar; el perfil (`profiles`) es su ficha. Si se borrara
     solo una, quedaría una cuenta sin perfil o un perfil sin cuenta, y
     las dos cosas dan errores más adelante, no ahora. */
  const { data: borrados, error } = await db
    .from("clients")
    .delete()
    .eq("email", USUARIO)
    .select("email");

  await db.from("profiles").delete().eq("email", USUARIO);

  if (error) {
    console.log("  x no se pudo borrar el usuario: " + error.message);
  } else {
    console.log(
      "  " + (borrados && borrados.length ? "✓" : "·") +
        " usuario de prueba: " + (borrados && borrados.length ? "borrado" : "no existía")
    );
  }

  /* Y el estado final de los planes, para que quede a la vista que
     ninguna prueba dejó un precio puesto. */
  const { data: planes } = await db.rpc("ejecutar_sql", {
    consulta: "select id, nombre, precio, cta_texto, cta_href from plans order by orden",
    args: [],
  });

  console.log("\n  planes ahora:\n");
  (planes || []).forEach((p) => {
    console.log(
      "    " + String(p.id).padEnd(10) + String(p.nombre).padEnd(13) +
      "precio=" + (p.precio === null ? "(a consultar)" : p.precio)
    );
    console.log("      " + String(p.cta_texto).padEnd(10) + "→ " + p.cta_href);
  });
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});