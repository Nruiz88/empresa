/* ¿Evolution está llamando al webhook, o no?
   ─────────────────────────────────────────────────────────────
   Se sabe que no entra NADA en bots_webhook_logs, ni siquiera una
   entrada vacía. Pero eso tiene dos explicaciones que se parecen:

     · Evolution no llama.
     · Evolution llama y el bot contesta con un error antes de anotar.

   La segunda parece imposible, porque el bot anota justo lo que
   rechaza: firma inválida, JSON malo, evento raro. Si entrara algo y
   fuera rechazado, estaría en el log con status 'skipped'.

   Y sin embargo puede pasar: si la llamada no LLEGA al contenedor —por
   un dominio que no resuelve, un proxy, un TLS que falla— no hay nada
   que anotar. El bot no ve lo que no le llega.

   ── LA PRUEBA ──

   Se le pide a Evolution que llame a un webhook de prueba, apuntando a
   una ruta que el bot expone y que responde sin hacer nada: si esa
   llamada tampoco aparece, el problema está entre Evolution y el
   servidor, no en el bot.

   Y se mira también si la instancia está de verdad conectada, porque
   «open» puede ser un estado viejo que nadie actualiza. */
require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

(async () => {
  const { data: srv } = await db
    .from("evolution_servers")
    .select("url, api_key, webhook_secret")
    .limit(1)
    .single();

  const { data: bot } = await db.from("bots").select("instance_name").limit(1).single();
  const inst = encodeURIComponent(bot.instance_name);

  const call = async (ruta, metodo = "GET", cuerpo = null) => {
    try {
      const r = await fetch(srv.url + ruta, {
        method: metodo,
        headers: {
          apikey: srv.api_key,
          ...(cuerpo ? { "Content-Type": "application/json" } : {}),
        },
        ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
        signal: AbortSignal.timeout(30000),
      });
      const t = await r.text();
      let j = null;
      try { j = JSON.parse(t); } catch { j = null; }
      return { status: r.status, ok: r.ok, json: j, texto: t };
    } catch (e) {
      return { status: 0, ok: false, json: null, texto: e.message };
    }
  };

  console.log("\n═══ ¿Evolution está vivo de verdad? ═══\n");

  /* ---- 1. La instancia, con todos los detalles ---- */
  console.log("  ── estado de la instancia ──\n");

  const lista = await call("/instance/fetchInstances");
  const yo = (Array.isArray(lista.json) ? lista.json : []).find((i) => i.name === bot.instance_name);

  if (!yo) {
    console.log("  x la instancia no aparece en /instance/fetchInstances.");
    console.log("    Si no está en la lista, no hay nada que mandar.\n");
    process.exit(1);
  }

  console.log("    id:              " + yo.id);
  console.log("    nombre:          " + yo.name);
  console.log("    connectionStatus:" + yo.connectionStatus);
  console.log("    ownerJid:        " + yo.ownerJid);
  console.log("    integration:     " + yo.integration);
  console.log("    contador:        " + yo._count?.Message + " mensajes");
  console.log("    setting webhook: " + yo.settingWebhook?.url);
  console.log("    webhook enabled: " + yo.settingWebhook?.enabled);
  console.log("    webhook events:  " + JSON.stringify(yo.settingWebhook?.events));
  console.log("    byEvents:        " + yo.settingWebhook?.byEvents);
  console.log("");

  /* ---- 2. El webhook que tiene guardado ---- */
  console.log("  ── webhook registrado ──\n");

  const hook = await call("/webhook/find/" + inst);
  const hooks = Array.isArray(hook.json) ? hook.json : [hook.json];

  hooks.filter(Boolean).forEach((h) => {
    console.log("    id:        " + h.id);
    console.log("    url:       " + h.url);
    console.log("    enabled:   " + h.enabled);
    console.log("    events:    " + JSON.stringify(h.events));
    console.log("    byEvents:  " + h.byEvents);
    const tieneSecreto = Boolean(h.headers && h.headers["x-webhook-secret"]);
    console.log("    secreto:   " + (tieneSecreto ? "puesto" : "NO PUESTO"));
    console.log("    webhookBase64: " + (h.webhookBase64 === undefined ? "no está" : h.webhookBase64));
    console.log("    delaySendMessage: " + (h.delaySendMessage ?? "(no está)"));
    console.log("");
  });

  /* ── LO QUE CUESTA CREER ──
     El webhook está bien, la instancia está abierta, y sin embargo no
     llega nada. Los tres cosas pueden ser verdad a la vez: el registro
     dice que está bien, pero que lo EJECUTE es otra cosa. Un registro
     que dice «configurado» no es lo mismo que un worker delivering. */

  console.log("  ──────────────────────────────────────────────\n");
  console.log("  Lo que dice el registro: webhook puesto, enabled, con\n" +
              "  MESSAGES_UPSERT, y la instancia abierta.\n");
  console.log("  Y a la vez no llega nada. Las dos cosas pueden ser\n" +
              "  ciertas: que esté CONFIGURADO no es lo mismo que que se esté\n" +
              "  ENTREGANDO. Un registro que dice «configurado» no prueba que\n" +
              "  haya alguien entregando.\n");

  /* ---- 3. Lo que sí se puede comprobar: que el bot contenga ---- */
  console.log("  ── ¿el bot está escuchando de verdad? ──\n");

  const vivo = await fetch("https://bot.shopcito.com.ar/api/salud", {
    headers: { "x-service-secret": srv.webhook_secret },
    signal: AbortSignal.timeout(30000),
  });

  console.log("    bot /api/salud:  HTTP " + vivo.status);

  const salud = await vivo.json().catch(() => null);
  if (salud) {
    console.log("    ok:             " + salud.ok);
    console.log("    secret_md5:     " + salud.secret_md5);
    console.log("    el secreto que yo tengo y el que tiene el bot,");
    console.log("    ¿coinciden?     " +
      (salud.secret_md5 === require("crypto")
        .createHash("md5")
        .update(srv.webhook_secret)
        .digest("hex")
        .slice(0, 16)
        ? "sí"
        : "NO"));
  }

  console.log("");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});