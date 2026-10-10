require("../../lib/env").load();

const db = require("../../lib/supabase").getAdmin();

/* ¿El campo `isLid` existe siquiera en los logs?

   Esto importa porque `db/ver-lid.js` contó 0 entradas con `isLid` en
   true, y un 0 así tiene dos explicaciones que no se distinguen:

     · no ha llegado ningún mensaje con @lid   (bien)
     · la columna no está en los payloads      (no sabemos nada)

   Y el segundo caso se lee igual que el primero. Por eso se cuenta
   cuántas filas TIENEN el campo, no cuántas lo tienen en true. */
(async () => {
  const consulta =
    "select count(*) as c, " +
    "count(*) filter (where payload ? 'isLid') as con_islid, " +
    "count(*) filter (where payload ? 'from') as con_from, " +
    "count(*) filter (where payload ? 'matched') as con_matched " +
    "from bots_webhook_logs";

  const { data, error } = await db.rpc("ejecutar_sql", { consulta, args: [] });

  if (error) {
    console.log("  x " + error.message);
    process.exit(1);
  }

  const r = data[0];

  console.log("\n  filas totales en bots_webhook_logs: " + r.c);
  console.log("  de ellas, con payload.isLid:  " + r.con_islid);
  console.log("  con payload.from:             " + r.con_from);
  console.log("  con payload.matched:          " + r.con_matched);
  console.log("");

  if (Number(r.c) === 0) {
    console.log("  · la tabla está vacía: no hay nada que mirar.");
  } else if (Number(r.con_islid) === 0) {
    console.log("  ! NINGUNA fila tiene isLid. El 0 de ver-lid.js no dice nada.");
  } else if (Number(r.con_islid) < Number(r.con_from)) {
    console.log("  · isLid está en " + r.con_islid + " de " + r.con_from + " filas con remitente.");
    console.log("    Las que faltan son las que se cortaron antes de llegar a reply().");
  } else {
    console.log("  ✓ isLid está en todas las filas con remitente. El 0 es de verdad.");
  }
  console.log("");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});