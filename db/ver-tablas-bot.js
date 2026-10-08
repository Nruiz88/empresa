/* Qué tablas tiene el bot, y cuál guarda lo que responde. */

require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

(async () => {
  console.log("\n═══ Tablas que empiezan por bot o contienen 'message' ═══\n");

  const { data: tablas, error } = await db.rpc("ejecutar_sql", {
    consulta:
      "select table_name from information_schema.tables " +
      "where table_schema = 'public' " +
      "and (table_name like 'bot%' or table_name like '%message%' or table_name like '%respuesta%' or table_name like '%log%') " +
      "order by table_name",
    args: [],
  });

  if (error) {
    console.log("  x no se pudo listar: " + error.message);
    process.exit(1);
  }

  (tablas || []).forEach((t) => console.log("  " + t.table_name));

  if (!tablas || !tablas.length) {
    console.log("  (ninguna)");
    return;
  }

  /* De las que existen, cuál tiene filas. La que tenga una columna de
     fecha y filas, es donde el bot anota. */
  console.log("");
  console.log("═══ Cuántas filas tiene cada una ═══\n");

  for (const t of tablas) {
    try {
      const { data, error: e } = await db.rpc("ejecutar_sql", {
        consulta: "select count(*) as c from " + t.table_name,
        args: [],
      });

      if (e) {
        console.log("  " + t.table_name.padEnd(30) + "no se pudo contar");
        continue;
      }

      console.log("  " + t.table_name.padEnd(30) + (data[0] ? data[0].c : 0) + " filas");
    } catch (e2) {
      console.log("  " + t.table_name.padEnd(30) + "error: " + String(e2.message).split("\n")[0]);
    }
  }
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});