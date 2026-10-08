require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

(async () => {
  const { data } = await db.rpc("ejecutar_sql", {
    consulta:
      "select created_at, status, event_type, payload->>'from' as remitente, " +
      "payload->>'text' as texto, payload->>'matched' as matched, " +
      "payload->>'isLid' as is_lid, error " +
      "from bots_webhook_logs order by created_at desc limit 12",
    args: [],
  });

  console.log("\n═══ Últimas 12 entradas del webhook ═══\n");

  (data || []).forEach((l) => {
    console.log("  " + l.created_at + "   status=" + l.status);
    console.log("    evento:    " + (l.event_type || "(sin nombre)"));
    console.log("    de:        " + (l.remitente || "(sin remitente)"));
    console.log("    texto:     " + String(l.texto || "(ninguno)").slice(0, 70));
    console.log("    coincidió: " + (l.matched || "-"));
    console.log("    lid:       " + l.is_lid);
    if (l.error) console.log("    ERROR:     " + String(l.error).slice(0, 150));
    console.log("");
  });

  /* ¿Hay CUALQUIER entrada recentísima, de quien sea? Eso separa dos
     cosas muy distintas:
       · no entra nada        → Evolution no está mandando el webhook
       · entra y es de otro   → el bot funciona, tu número no llegó
  */
  const hace5 = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: recientes } = await db.rpc("ejecutar_sql", {
    consulta:
      "select count(*) as c from bots_webhook_logs where created_at > '" + hace5 + "'",
    args: [],
  });

  console.log("  ──────────────────────────────────────────────");
  console.log("  entradas en los últimos 5 minutos: " +
    (recientes && recientes[0] ? recientes[0].c : 0));
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});