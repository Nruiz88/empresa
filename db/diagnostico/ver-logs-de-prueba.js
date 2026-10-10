/* Las 30 filas de `bots_webhook_logs` que el verificador marca como de
   prueba: qué son antes de borrarlas. */

require("../../lib/env").load();

const db = require("../../lib/supabase").getAdmin();

(async () => {
  const { data } = await db.rpc("ejecutar_sql", {
    consulta:
      "select status, count(*) as c, min(created_at) as primero, max(created_at) as ultimo " +
      "from bots_webhook_logs " +
      "where payload::text ilike '%PRUEBA-%' or payload::text ilike '%prueba-webhook-%' " +
      "group by status order by c desc",
    args: [],
  });

  console.log("\n═══ Filas de prueba en bots_webhook_logs ═══\n");
  (data || []).forEach((r) => {
    console.log("  " + String(r.status).padEnd(12) + r.c + "   de " + r.primero + "  a  " + r.ultimo);
  });

  const { data: total } = await db.rpc("ejecutar_sql", {
    consulta: "select count(*) as c from bots_webhook_logs",
    args: [],
  });

  const { data: ajenas } = await db.rpc("ejecutar_sql", {
    consulta:
      "select count(*) as c from bots_webhook_logs " +
      "where payload::text not ilike '%PRUEBA-%' and payload::text not ilike '%prueba-webhook-%'",
    args: [],
  });

  console.log("\n  total en la tabla: " + (total && total[0] ? total[0].c : "?"));
  console.log("  que NO son de prueba: " + (ajenas && ajenas[0] ? ajenas[0].c : "?"));
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});