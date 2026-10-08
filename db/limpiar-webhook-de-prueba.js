/* Borrar las filas de prueba de bots_webhook_logs.
   ─────────────────────────────────────────────────────────────
   Son las que dejaron las pruebas de esta sesión: mensajes con marca
   «PRUEBA-» o «prueba-webhook-» en el cuerpo.

   ── POR QUÉ SE MUESTRA ANTES DE BORRAR ──

   Porque borrar filas de un log es de las pocas cosas que no tiene
   vuelta atrás, y porque la búsqueda tiene que ser la misma que se usó
   para decir que eran 30. Si se borra por un criterio más amplio del
   que se usó para contarlas, se lleva por delante algo que no era de
   prueba.

   Por eso el script:

     1. cuenta y muestra lo que va a borrar;
     2. no borra nada hasta que se lo dice con `--borrar`;
     3. vuelve a contar después, para que se vea que se fueron y no
        otras.

   ── QUÉ NO SE BORRA ──

   Los `messages.update` sin remitente y los `invalid_signature` que
   llegaron solos. Son tráfico real de Evolution, feo pero real: si se
   borran, se borra la prueba de que el webhook estaba mal.
   ================================================================= */

// Las marcas que solo pueden poner las pruebas.
const MARCAS = ["PRUEBA-", "prueba-webhook-", "PRUEBADERIVERY", "REDIS-", "DELIVERY", "calib", "FLUJO-"];

const BORRAR = process.argv.includes("--borrar");

require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

(async () => {
  const donde = MARCAS.map((m) => "payload::text ilike '%" + m + "%'").join(" or ");

  console.log("\n═══ Filas de prueba ═══\n");

  /* ---- 1. Cuántas hay y de qué tipo ---- */
  const { data: antes, error } = await db.rpc("ejecutar_sql", {
    consulta:
      "select status, count(*) as c from bots_webhook_logs " +
      "where " + donde + " group by status order by c desc",
    args: [],
  });

  if (error) {
    console.log("  x no se pudo consultar: " + error.message + "\n");
    process.exit(1);
  }

  const total = (antes || []).reduce((s, r) => s + Number(r.c), 0);

  console.log("  a borrar, por estado:");
  (antes || []).forEach((r) => console.log("    " + String(r.status).padEnd(12) + r.c));

  const { data: todas } = await db.rpc("ejecutar_sql", {
    consulta: "select count(*) as c from bots_webhook_logs",
    args: [],
  });
  const totalTabla = todas && todas[0] ? Number(todas[0].c) : 0;

  console.log("");
  console.log("  total en la tabla: " + totalTabla);
  console.log("  de prueba:        " + total);
  console.log("  se quedan:        " + (totalTabla - total));
  console.log("");

  if (!total) {
    console.log("  No hay nada de prueba. No se borra nada.\n");
    return;
  }

  if (!BORRAR) {
    console.log("  Esto es lo que se borra. Para hacerlo de verdad:");
    console.log("    node db/limpiar-webhook-de-prueba.js --borrar\n");
    return;
  }

  /* ---- 2. Los identificadores, y el borrado ----

     El RPC `ejecutar_sql` solo admite SELECT, a propósito: es lo que
     impide que un script con una consulta mal escrita acabe vaciando
     una tabla. Por eso no se puede borrar con un DELETE.

     Se listan los ids y se borran uno por uno con el cliente de
     servicio. Más lento, pero el criterio queda a la vista: se borra
     exactamente lo que seEnumeró, y no «todo lo que cumpla una
     condición que cambia entre el listado y el borrado». */
  const { data: ids } = await db.rpc("ejecutar_sql", {
    consulta: "select id from bots_webhook_logs where " + donde,
    args: [],
  });

  if (!ids || !ids.length) {
    console.log("  No hay nada que borrar.\n");
    return;
  }

  console.log("  a borrar: " + ids.length + " filas, una a una\n");

  const idEnClaves = ids.map((r) => r.id);

  const { error: eBorrar } = await db
    .from("bots_webhook_logs")
    .delete()
    .in("id", idEnClaves);

  if (eBorrar) {
    console.log("  x no se pudo borrar: " + eBorrar.message + "\n");
    console.log("    No se dio por hecho que se borró. Quedan " + ids.length +
      " filas de prueba.\n");
    process.exit(1);
  }

  console.log("  borradas: " + ids.length + "\n");

  /* ---- 3. Verificar ---- */
  const { data: despues } = await db.rpc("ejecutar_sql", {
    consulta: "select count(*) as c from bots_webhook_logs",
    args: [],
  });

  const quedan = despues && despues[0] ? Number(despues[0].c) : "?";

  console.log("  ahora la tabla tiene: " + quedan + " filas");

  const { data: quedanPrueba } = await db.rpc("ejecutar_sql", {
    consulta:
      "select count(*) as c from bots_webhook_logs where " + donde,
    args: [],
  });

  console.log("  de prueba todavía:   " + (quedanPrueba && quedanPrueba[0] ? quedanPrueba[0].c : 0));
  console.log("");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});