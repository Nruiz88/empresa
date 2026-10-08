/* Registrar el webhook en la instancia que existe ahora.
   ─────────────────────────────────────────────────────────────
   POR QUÉ HAY QUE HACERLO A MANO Y NO DEJA FUNCIONAR

   La instancia se recreó: la que estaba (`Boti 1`) ya no existe, y la
   nueva (`Server 1`) no tiene webhook. Un webhook que no está
   registrado en la instancia no llama a nadie, por muy bien que esté
   el bot escuchando.

   ── EL NOMBRE DEL CAMPO ──

   La caja responde `webhookByEvents`. La documentación escribe
   `webhook_by_events`. Y el código del bot mandaba `byEvents`, que no
   es ninguna de las dos.

   Se mandan las tres. Es redundante y parece chapuza, pero el coste de
   mandarlas es cero y el de acertar solo una es que no llegue ningún
   evento otra vez, sin ningún error que lo indique.

   ── NO SE TOCA LA SESIÓN ──

   Esto solo dice «cuando pase algo, llamá a esta dirección». No
   desconecta, no pide QR y no borra mensajes. */

require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

const WEBHOOK = "https://bot.shopcito.com.ar/api/webhook";

const EVENTOS = [
  "QRCODE_UPDATED",
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "CONNECTION_UPDATE",
];

(async () => {
  const { data: srv } = await db
    .from("evolution_servers")
    .select("url, api_key, webhook_secret")
    .limit(1)
    .single();

  const { data: bots } = await db.from("bots").select("instance_name, name");

  /* La instancia que hay de verdad, no la que la base dice. */
  const r = await fetch(srv.url + "/instance/fetchInstances", {
    headers: { apikey: srv.api_key },
    signal: AbortSignal.timeout(30000),
  });
  const existentes = (await r.json()) || [];

  if (!existentes.length) {
    console.log("\n  No hay ninguna instancia en la caja. No hay a qué\n" +
                "  registrarle un webhook.\n");
    process.exit(1);
  }

  console.log("\n═══ Registrar el webhook ═══\n");

  console.log("  instancias en la caja:");
  existentes.forEach((i) =>
    console.log("    " + i.name.padEnd(16) + i.connectionStatus)
  );

  console.log("\n  lo que el bot busca:");
  (bots || []).forEach((b) => console.log("    " + b.instance_name.padEnd(16) + b.name));
  console.log("");

  for (const inst of existentes) {
    const nombre = encodeURIComponent(inst.name);

    console.log("  ── " + inst.name + " ──");

    const cuerpo = {
      webhook: {
        enabled: true,
        url: WEBHOOK,
        events: EVENTOS,
        headers: { "x-webhook-secret": srv.webhook_secret },
        base64: false,
        /* Las tres formas del mismo campo. Ver la nota de arriba. */
        byEvents: true,
        webhook_by_events: true,
        webhookByEvents: true,
      },
    };

    const puesto = await fetch(srv.url + "/webhook/set/" + nombre, {
      method: "POST",
      headers: {
        apikey: srv.api_key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(30000),
    });

    const texto = await puesto.text();
    console.log("    webhook/set   HTTP " + puesto.status);

    if (!puesto.ok) {
      console.log("    " + texto.slice(0, 200) + "\n");
      continue;
    }

    /* Se relee. El `set` devuelve un espejo de lo que mandaste: que
       responda bien no prueba que quedara bien. */
    const relido = await fetch(srv.url + "/webhook/find/" + nombre, {
      headers: { apikey: srv.api_key },
      signal: AbortSignal.timeout(25000),
    });
    const t = await relido.text();
    let j = null;
    try { j = JSON.parse(t); } catch (e) { j = null; }
    const w = Array.isArray(j) ? j[0] : j;

    const byEvents = w?.webhookByEvents ?? w?.byEvents ?? w?.webhook_by_events;

    console.log("    url:              " + (w?.url || "(no quedó)"));
    console.log("    enabled:          " + w?.enabled);
    console.log("    events:           " + JSON.stringify(w?.events));
    console.log("    webhookByEvents:  " + byEvents);
    console.log("    base64:           " + w?.webhookBase64);
    console.log("    secreto:          " + (w?.headers?.["x-webhook-secret"] ? "puesto" : "FALTA"));

    const bien = w?.url === WEBHOOK && w?.enabled === true &&
      Array.isArray(w?.events) && w.events.includes("MESSAGES_UPSERT") &&
      byEvents === true;

    console.log("    → " + (bien ? "✓ listo" : "× quedó incompleto"));
    console.log("");
  }

  /* Lo que falta y no se puede arreglar desde acá. */
  const sinAbrir = existentes.filter((i) => i.connectionStatus !== "open");

  if (sinAbrir.length) {
    console.log("  ──────────────────────────────────────────────");
    console.log("\n  El webhook ya está. Falta lo otro, y eso no lo puedo hacer yo:\n");
    for (const s of sinAbrir) {
      console.log("    «" + s.name + "» está en " + s.connectionStatus + ".");
    }
    console.log("\n  Hay que escanear el QR con el WhatsApp de la panadería");
    console.log("  (5492994382147). Sin número enlazado no entra nada, por muy");
    console.log("  bien que esté el webhook.\n");
  }

  /* Y el nombre, que es la otra mitad del problema. */
  const falta = (bots || []).filter(
    (b) => !existentes.some((i) => i.name === b.instance_name)
  );

  if (falta.length) {
    console.log("  ──────────────────────────────────────────────");
    console.log("\n  Y el nombre no coincide. El bot busca «" + falta[0].instance_name +
      "»,");
    console.log("  y en la caja está «" + existentes.map((i) => i.name).join("», «") + "».\n");
    console.log("    · o se renombra la instancia en Evolution para que se llame");
    console.log("      «" + falta[0].instance_name + "», o");
    console.log("    · o se cambia el nombre guardado en la base al que existe ahora.\n");
    console.log("  Mientras no coincidan, cada webhook entra con un nombre que el");
    console.log("  bot no reconoce y se responde 404 sin procesar nada.\n");
  }
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});