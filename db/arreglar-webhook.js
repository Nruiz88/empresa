/* Volver a registrar el webhook de la instancia, bien.
   ─────────────────────────────────────────────────────────────
   POR QUÉ ESTO

   El bot tiene escrito, en `setWebhook`, por qué `byEvents: true` no
   es opcional:

     Con `false`, Evolution IGNORA lo que se guarda por instancia y usa
     la configuración global del servidor. El endpoint devolvía los
     valores que acabamos de guardar y todo parecía correcto, mientras
     que lo que se ejecutaba era otra cosa: los eventos nunca llegaban
     y no había ningún error visible.

   Y eso es EXACTAMENTE lo que pasa ahora:

     enabled   true
     events    MESSAGES_UPSERT, CONNECTION_UPDATE, QRCODE_UPDATED
     byEvents  undefined     ← se perdió

   Todo lo que se mira desde afuera parece bien. Y no llega nada.

   ── POR QUÉ SE PERDIÓ ──

   Porque cualquier lectura del webhook —cambiar un evento, corregir una
   URL— lo vuelve a guardar, y si quien lo hizo noIncludes `byEvents`,
   la caja lo acepta y queda en undefined. No avisa: el endpoint devuelve
   lo que le mandaste.

   O sea: el mismo endpoint que se usa para ARREGLARLO es el que lo
   rompió. Por eso este script manda siempre los campos completos, y
   por eso no basta con volver a guardarlo a mano.

   ── LO QUE NO TOCA ──

   La sesión de WhatsApp. Esto solo re-registra a dónde llamar. La
   instancia no se desconecta, no pide QR y no pierde los mensajes. */
require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

const WEBHOOK = "https://bot.shopcito.com.ar/api/webhook";

const EVENTOS = ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"];

(async () => {
  const { data: srv } = await db
    .from("evolution_servers")
    .select("url, api_key, webhook_secret")
    .limit(1)
    .single();

  const { data: bot } = await db.from("bots").select("instance_name").limit(1).single();
  const inst = encodeURIComponent(bot.instance_name);

  const call = async (ruta, metodo, cuerpo) => {
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
  };

  console.log("\n═══ Arreglando el webhook ═══\n");

  /* ---- 1. Cómo está ahora ---- */
  const antes = await call("/webhook/find/" + inst);
  const previo = Array.isArray(antes.json) ? antes.json[0] : antes.json;

  /* ── EL NOMBRE DEL CAMPO, Y POR QUÉ IMPORTA ──
     Esta caja llama al campo `webhookByEvents`, no `byEvents`. La
     primera versión de este script miraba `byEvents`, que aquí no
     existe, salía `undefined`, y concluía que el campo se había
     perdido cuando estaba puesto.

     Con eso se announce un diagnóstico inventado —«la configuración
     por instancia está perdida»— sobre un webhook que estaba bien.

     Por eso se aceptan los dos nombres: la versión de la caja puede
     cambiar el nombre, y lo que importa no es el nombre sino que la
     configuración por instancia esté activa. */
  const byEventsDe = (h) =>
    h ? (h.webhookByEvents !== undefined ? h.webhookByEvents : h.byEvents) : undefined;

  console.log("  ── antes ──");
  console.log("    url:       " + (previo?.url || "(ninguna)"));
  console.log("    enabled:   " + previo?.enabled);
  console.log("    events:    " + JSON.stringify(previo?.events));
  console.log("    webhookByEvents: " + byEventsDe(previo));
  console.log("");

  if (byEventsDe(previo) === true) {
    console.log("  · byEvents ya estaba en true. No se toca nada.");
    console.log("    Entonces el problema es otro, y este script no lo arregla.\n");
    process.exit(1);
  }

  /* ---- 2. Registrarlo completo ---- */
  console.log("  ── registrando con TODOS los campos ──\n");

  const registro = {
    enabled: true,
    url: WEBHOOK,
    events: EVENTOS,
    headers: { "x-webhook-secret": srv.webhook_secret },
    byEvents: true,
    base64: false,
  };

  const puesto = await call("/webhook/set/" + inst, "POST", { webhook: registro });

  console.log("    webhook/set    HTTP " + puesto.status);
  console.log("    respuesta:     " + puesto.texto.slice(0, 200));
  console.log("");

  if (!puesto.ok) {
    console.log("  × no se pudo registrar.");
    console.log("    Sin cambios en la caja. El webhook sigue como estaba.\n");
    process.exit(1);
  }

  /* ---- 3. Releer, porque el endpoint devuelve lo que mandaste ----
     Eso es lo que hace peligroso confiar en la respuesta: devuelve un
     espejo. Lo que importa es lo que quedó GUARDADO, leído después. */
  console.log("  ── releído de la caja ──");

  const despues = await call("/webhook/find/" + inst);
  const ahora = Array.isArray(despues.json) ? despues.json[0] : despues.json;

  const urlOk = ahora?.url === WEBHOOK;
  const byOk = byEventsDe(ahora) === true;
  const evOk = Array.isArray(ahora?.events) && ahora.events.includes("MESSAGES_UPSERT");

  console.log("    url:       " + ahora?.url + (urlOk ? "  ✓" : "  ×"));
  console.log("    enabled:   " + ahora?.enabled);
  console.log("    events:    " + JSON.stringify(ahora?.events) + (evOk ? "  ✓" : "  ×"));
  console.log("    webhookByEvents: " + byEventsDe(ahora) + (byOk ? "  ✓" : "  ×"));
  console.log("    secreto:   " + (ahora?.headers?.["x-webhook-secret"] ? "puesto  ✓" : "FALTA  ×"));
  console.log("");

  if (!byOk || !evOk || !urlOk) {
    console.log("  × quedó mal. La caja cambió lo que quiso o ignora el campo.\n");
    console.log("    Eso significaría que el `webhook/set` de esta versión no\n");
    console.log("    acepta `byEvents`, y que el problema es de la caja, no de\n");
    console.log("    cómo se guarda.\n");
    process.exit(1);
  }

  console.log("  ✓ el webhook quedó con byEvents: true y MESSAGES_UPSERT.\n");

  /* ---- 4. Y ahora, el temporal que mide si funciona ---- */
  console.log("  ──────────────────────────────────────────────\n");
  console.log("  Mandale otro mensaje al bot ahora.\n");
  console.log("  Con el registro ya reparado, esta vez Evolution debería llamar\n");
  console.log("  a https://bot.shopcito.com.ar/api/webhook, y entonces sí\n");
  console.log("  tendría que verse en bots_webhook_logs.\n");

  console.log("  Para mirar:\n");
  console.log("    node db/mirar-webhook.js\n");
  console.log("    node db/ver-ultimas-entradas.js\n");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});