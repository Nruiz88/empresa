/* ¿El bot manda el menú de horarios, o dice que sí y no lo manda?
   ─────────────────────────────────────────────────────────────
   El log del webhook dice `[turno hoy]`, y ese texto SOLO se devuelve
   cuando `slots.length > 0`. O sea que el bot encontró horarios y
   llamó a `sendSlotMenu`.

   Y `sendSlotMenu` intenta botones; si Evolution dice que no, cae a
   texto. En los dos casos manda algo.

   ── LO QUE NO SE COMPRUEBA ──

   Que ese «algo» llegara. `sendTextMessage` devuelve un resultado y el
   código no lo mira en este camino: si el envío falla, el handler
   devuelve `success` igual. O sea: el webhook puede decir `success`
   y el cliente no haber recibido nada.

   Es el mismo patrón del principio —verde por dentro, mudo por
   fuera— y ya sabemos lo caro que sale.

   ── CÓMO SE COMPRUEBA ──

   Mirando la conversación desde la caja. Si el bot mandó algo, el chat
   con ese número tiene una hora de última actividad de hace un momento.
   Si el chat está quieto, el bot no mandó nada aunque diga que sí. */
require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

const NUMERO = process.env.TEST_NUMERO || "5492996733077";

(async () => {
  const { data: srv } = await db
    .from("evolution_servers")
    .select("url, api_key")
    .limit(1)
    .single();

  const { data: bot } = await db.from("bots").select("instance_name").limit(1).single();
  const inst = encodeURIComponent(bot.instance_name);

  const r = await fetch(srv.url + "/chat/findChats/" + inst, {
    method: "POST",
    headers: { apikey: srv.api_key, "Content-Type": "application/json" },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(30000),
  });

  const chats = await r.json();
  const lista = Array.isArray(chats) ? chats : [];

  console.log("\n═══ ¿Se mandó algo de verdad? ═══\n");

  const chat = lista.find((c) =>
    String(c.id?.remoteJid || c.remoteJid || "").includes(NUMERO)
  );

  if (!chat) {
    console.log("  · No hay conversación con " + NUMERO + ".\n");
    console.log("    O los mensajes no están llegando a la caja, o el número");
    console.log("    no es este.\n");
    process.exit(1);
  }

  const ts = chat.timestamp?.["$date"] || chat.timestamp;
  console.log("  conversación con: " + chat.id.remoteJid);
  console.log("  última actividad: " + ts);
  console.log("  sin leer:        " + chat.unreadCount);
  console.log("");

  /* La hora es la prueba. Si el chat se movió hace un momento, algo
     salió. Si lleva horas quieto, el bot dijo `success` y no mandó
     nada. */
  const fecha = ts ? new Date(ts) : null;

  if (!fecha) {
    console.log("  · El chat no trae fecha. Sin eso no se puede concluir nada,\n" +
      "    y no se deduce: sería adivinar.\n");
    process.exit(1);
  }

  const mins = Math.round((Date.now() - fecha.getTime()) / 60000);
  console.log("  hace " + mins + " minutos\n");

  if (mins <= 3) {
    console.log("  ✓ La conversación se movió hace poco: algo SÍ salió.\n");
    console.log("    Si el cliente no ve la lista, el problema es de lo que se");
    console.log("    mandó, no de que no se mande nada.\n");
  } else if (mins <= 60) {
    console.log("  · Se movió hace " + mins + " minutos, pero no hace nada.\n");
    console.log("    Vale para las pruebas de ahora, pero no demuestra nada");
    console.log("    sobre lo que pasó hace un momento.\n");
  } else {
    console.log("  × La conversación lleva " + mins + " minutos sin moverse.\n");
    console.log("    El bot dijo `success` y no mandó nada.\n");
    console.log("    O no llegó a mandar porque `sendSlotMenu` falló y el error");
    console.log("    se lo tragó, o el número al que mandó no es el correcto.\n");
  }
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});