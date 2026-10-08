/* ¿Qué nombre de instancia espera el bot, y cuál existe ahora? */
require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

(async () => {
  const { data: srv } = await db.from("evolution_servers").select("url, api_key").limit(1).single();

  /* Lo que existe ahora en la caja. */
  const r = await fetch(srv.url + "/instance/fetchInstances", {
    headers: { apikey: srv.api_key },
    signal: AbortSignal.timeout(30000),
  });
  const existentes = (await r.json()) || [];

  /* Lo que el bot cree que existe. El bot busca por este nombre: lo
     compara con el campo `instance` de cada webhook, y si no coincide
     contesta 404 sin procesar nada.

     OJO con el error: se comprueba. La primera versión pedía una
     columna que no existe, el cliente devolvió `data: []` sin lanzar,
     y el script imprimió «lo que espera el bot:» seguido de nada. Se
     leía como «el bot no espera ninguna instancia», que es una
     conclusión equivocada y bastante grave: el bot sí tiene una. */
  const { data: bots, error: eBots } = await db
    .from("bots")
    .select("instance_name, name");

  if (eBots) {
    console.log("  EN LA BASE, lo que espera el bot:");
    console.log("    × no se pudo leer: " + eBots.message);
    console.log("    Un error que no se mira se lee igual que una lista vacía,");
    console.log("    y aquí la lista vacía significa «no hay bots», que es");
    console.log("    justo lo contrario de lo cierto.\n");
  } else {

  console.log("\n═══ Los nombres de instancia ═══\n");

  console.log("  EN LA CAJA:");
  for (const i of existentes) {
    console.log("    " + i.name.padEnd(16) + i.connectionStatus.padEnd(10) +
      String(i.ownerJid || "").replace("@s.whatsapp.net", ""));
  }
  if (!existentes.length) console.log("    (ninguna)");

  console.log("\n  EN LA BASE, lo que espera el bot:");
  for (const b of bots || []) {
    const existe = existentes.some((i) => i.name === b.instance_name);
    console.log("    " + b.instance_name.padEnd(16) + (b.name || "").padEnd(28) +
      (existe ? "✓ coincide" : "× NO EXISTE en la caja"));
  }

  /* El webhook es lo que decide el problema: si está puesto sobre una
     instancia que ya no existe, está apuntando al vacío. */
  console.log("\n  ── webhook de cada una ──\n");

  for (const i of existentes) {
    const h = await fetch(srv.url + "/webhook/find/" + encodeURIComponent(i.name), {
      headers: { apikey: srv.api_key },
      signal: AbortSignal.timeout(25000),
    });

    const t = await h.text();
    let j = null;
    try { j = JSON.parse(t); } catch (e) { j = null; }
    const w = Array.isArray(j) ? j[0] : j;

    if (!w || !w.url) {
      console.log("  · " + i.name.padEnd(16) + "sin webhook  (HTTP " + h.status + ")");
    } else {
      console.log("  ✓ " + i.name.padEnd(16) + w.url);
      console.log("      enabled:          " + w.enabled);
      console.log("      events:           " + JSON.stringify(w.events));
      console.log("      webhookByEvents:  " + w.webhookByEvents);
      console.log("      secreto:          " + (w.headers?.["x-webhook-secret"] ? "puesto" : "FALTA"));
    }
  }

  const sinCoincidir = (bots || []).filter(
    (b) => !existentes.some((i) => i.name === b.instance_name)
  );

  console.log("\n  ──────────────────────────────────────────────\n");

  if (sinCoincidir.length) {
    console.log("  El bot busca un nombre que no existe. Cuando llegue un webhook,");
    console.log("  Evolution enviará «" + existentes.map((i) => i.name).join("» o «") +
      "» y el bot lo rechazará con 404.\n");
    console.log("  Hay dos formas de arreglarlo, y son distintas:\n");
    console.log("    1. Renombrar la instancia en Evolution para que se llame");
    console.log("       «" + sinCoincidir[0].instance_name + "». Menos cambios acá.");
    console.log("    2. Cambiar el nombre guardado en la base al que existe ahora.");
    console.log("       Ojo: el nombre es con el que Evolution manda el `instance`,");
    console.log("       así que tiene que coincidir EXACTAMENTE, con las");
    console.log("       mayúsculas y el espacio.\n");
  }

  const desconectadas = existentes.filter((i) => i.connectionStatus !== "open");
  if (desconectadas.length) {
    console.log("  Y además:");
    for (const d of desconectadas) {
      console.log("    «" + d.name + "» está en " + d.connectionStatus + ", sin número enlazado.");
    }
    console.log("\n  Sin número no entra nada, por mucho que el webhook esté bien.");
    console.log("  Hay que escanear el QR con el WhatsApp de la panadería.\n");
  }
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});