/* ¿Queda alguna fila de prueba en la base?
   ─────────────────────────────────────────────────────────────
   Las pruebas de planes crean un usuario, guardan un precio y al final
   los dejan como estaban. Este script comprueba que de verdad lo
   hicieron.

   No es una comprobación paranoia: la primera versión de la prueba de
   precios daba un error a mitad y salía sin restaurar, y el precio se
   quedó puesto en la web pública hasta que alguien se dio cuenta. Un
   `process.exit` antes del `finally` es un olvido esperando, y esto es
   la red debajo del olvido. */

require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

/* Marcas que solo pueden poner las pruebas. */
const MARCAS = ["prueba-planes", "PRUEBA-", "prueba-webhook-"];

(async () => {
  console.log("\n═══ ¿Quedó algo de las pruebas? ═══\n");

  /* Los nombres de las columnas estánmirados a propósito: dos de estas
     tablas no tienen `email`, y una comprobación que se inventa una
     columna devuelve error, y un error que no se distingue de «no hay
     nada» se lee como «todo limpio». */
  const tablas = [
    ["clients", "email"],
    ["profiles", "nombre"],
    ["bots_response_logs", "incoming_message"],
    ["bots_webhook_logs", "payload::text"],
  ];

  let restos = 0;

  for (const [tabla, columna] of tablas) {
    const donde = MARCAS.map((m) => columna + " ilike '%" + m + "%'").join(" or ");

    const { data, error } = await db.rpc("ejecutar_sql", {
      consulta: "select count(*) as c from " + tabla + " where " + donde,
      args: [],
    });

    if (error) {
          /* Esto NO es «limpio». Una comprobación que no pudo mirar es
         distinto de una que miró y no encontró nada, y confundir las dos
         es como esta tabla podría decir que todo está bien con restos
         dentro. */
      console.log("  ! " + tabla.padEnd(22) + "no se pudo comprobar: " + error.message.split("\n")[0]);
      restos++;
      continue;
    }

    const c = data && data[0] ? Number(data[0].c) : 0;
    restos += c;

    console.log(
      "  " + (c ? "!" : "·") + " " + tabla.padEnd(22) + (c ? c + " filas de prueba" : "limpio")
    );
  }

  /* Y lo que más importa: que ningún plan tenga un precio puesto. */
  const { data: planes } = await db.rpc("ejecutar_sql", {
    consulta: "select id, nombre, precio from plans order by orden",
    args: [],
  });

  const conPrecio = (planes || []).filter((p) => p.precio !== null && p.precio !== undefined);

  console.log("");
  console.log(
    conPrecio.length
      ? "  ! " + conPrecio.length + " plan(es) con precio: " +
          conPrecio.map((p) => p.nombre + " = " + p.precio).join(", ") +
          "\n    Si no es a propósito, hay que vaciarlos."
      : "  ✓ los tres planes siguen sin precio (se publica «A consultar»)"
  );

  console.log("");
  process.exit(restos || conPrecio.length ? 1 : 0);
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});