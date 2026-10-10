require("../../lib/env").load();
const db = require("../../lib/supabase").getAdmin();
const ev = require("../../lib/evolution");
const bots = require("../../lib/bots");

/* Comprueba el webhook de verdad: escribe y mira lo que la Evolution
   devuelve, que en esta versión es la única fuente (no hay ruta de
   lectura). */

(async () => {
  const { data: caja } = await db
    .from("evolution_servers")
    .select("name,url,api_key,webhook_secret,webhook_url")
    .limit(1)
    .maybeSingle();

  const { data: lista } = await db
    .from("bots")
    .select("name,instance_name,status")
    .eq("server_id", (await db.from("evolution_servers").select("id").limit(1).maybeSingle()).data.id);

  const destino = caja.webhook_url;
  console.log("\n═══ Estado real ═══\n");
  console.log("  caja:    " + caja.name);
  console.log("  destino: " + destino + "\n");

  const cabeceras = bots.cabecerasDeWebhook(caja);

  for (const b of lista) {
    const r = await ev.ponerWebhook(caja.url, caja.api_key, b.instance_name, destino, cabeceras);
    const cfg = r.data || {};
    const eventos = Array.isArray(cfg.events) ? cfg.events : [];

    const ok =
      cfg.url === destino &&
      cfg.webhookByEvents === true &&
      cfg.enabled === true &&
      eventos.includes("MESSAGES_UPSERT") &&
      (cfg.headers && cfg.headers["x-webhook-secret"] === caja.webhook_secret);

    console.log("  " + (ok ? "✓" : "x") + " " + b.name);
    console.log("      url        " + cfg.url);
    console.log("      eventos    " + eventos.join(", "));
    console.log("      byEvents   " + cfg.webhookByEvents);
    console.log("      enabled    " + cfg.enabled);
    console.log("      secreto    " + (cfg.headers && cfg.headers["x-webhook-secret"] ? "puesto y correcto" : "FALTA O NO CUADRA"));
    console.log("      numero     " + b.status + " en la base\n");
  }

  const inst = await ev.estadoConexion(caja.url, caja.api_key, lista[0].instance_name);
  console.log("  estado del numero: " + JSON.stringify(inst.data));
})();