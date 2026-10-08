/* ¿El flujo de turnos se rompe entre mensajes?
   ─────────────────────────────────────────────────────────────
   El usuario escribe «turno», el bot le manda un menú, escribe «1» y no
   pasa nada. El log lo dice sin ambigüedad:

       texto:     1
       coincidió: -

   O sea: el bot RECIBIÓ el «1» y ningún handler lo entendió.

   ── LA SOSPECHA ──

   El estado de la agenda se guarda así:

       const redis = process.env.UPSTASH_REDIS_REST_URL && ...
           ? new Redis(...)
           : null;

       const agendaActiveFallback = new Map<string, boolean>();

   Sin Redis, «está en el menú de agenda» vive en un Map de memoria del
   proceso. Y eso se pierde en CADA reinicio. El bot se acaba de
   desplegar, así que entre el «turno» y el «1» puede haberse reiniciado
   y el menú se quedó sin estado: el bot ya no sabe que le habían
   mostrado un menú, y el «1» no significa nada.

   ── LO QUE HACE ESTA PRUEBA ──

   Repite los dos mensajes seguidos, sin reiniciar nada en medio, y mira
   si funciona. Si funciona así, el problema es el estado en memoria. Si
   tampoco, el fallo está en el código del flujo.

   Y después repite con una pausa, para ver cuánto vive el estado. */
require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

const API = "https://bot.shopcito.com.ar";

/* El teléfono del segundo número, que es con el que se prueba de verdad.
   El chat propio del bot serviría igual, pero con ese los mensajes
   propios los filtra Evolution y no llegaría nada. */
const NUMERO = process.env.TEST_NUMERO || "5492996733077";

async function mandar(instancia, secreto, texto, marca) {
  const r = await fetch(API + "/api/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-secret": secreto },
    body: JSON.stringify({
      event: "MESSAGES_UPSERT",
      instance: instancia,
      data: {
        key: { remoteJid: NUMERO + "@s.whatsapp.net", fromMe: false, id: marca },
        pushName: "Prueba",
        message: { conversation: texto },
      },
    }),
    signal: AbortSignal.timeout(30000),
  });

  const cuerpo = await r.json().catch(() => null);
  return { status: r.status, cuerpo };
}

(async () => {
  const { data: srv } = await db
    .from("evolution_servers")
    .select("webhook_secret")
    .limit(1)
    .single();

  const { data: bot } = await db.from("bots").select("instance_name, name").limit(1).single();

  console.log("\n═══ El flujo de turnos, paso a paso ═══\n");
  console.log("  bot:      " + bot.name);
  console.log("  instancia: " + bot.instance_name);
  console.log("  como:     " + NUMERO + "\n");

  /* ---- 1. «turno» ---- */
  console.log("  1. escribo «turno»\n");
  const r1 = await mandar(bot.instance_name, srv.webhook_secret, "turno", "FLUJO-" + Date.now());
  console.log("     HTTP " + r1.status);
  console.log("     " + JSON.stringify(r1.cuerpo).slice(0, 300));
  console.log("");

  if (!r1.cuerpo || r1.cuerpo.status === "no_match" || r1.cuerpo.status === "ignored") {
    console.log("  · El propio «turno» no hartó nada. Antes de mirar el paso 2");
    console.log("    hay que ver por qué: si el bot no reconoce la palabra, el");
    console.log("    «1» posterior no puede significar nada.\n");
    process.exit(1);
  }

  /* ---- 2. «1», enseguida ---- */
  console.log("  2. escribo «1» enseguida\n");
  const r2 = await mandar(bot.instance_name, srv.webhook_secret, "1", "FLUJO-" + Date.now());
  console.log("     HTTP " + r2.status);
  console.log("     " + JSON.stringify(r2.cuerpo).slice(0, 300));
  console.log("");

  /* ---- 3. Lo que registró el log ---- */
  const { data: filas } = await db.rpc("ejecutar_sql", {
    consulta:
      "select created_at, status, event_type, payload->>'text' as texto, " +
      "payload->>'matched' as matched, payload->>'status' as estado_handler " +
      "from bots_webhook_logs order by created_at desc limit 8",
    args: [],
  });

  console.log("  ── lo que registró el bot ──\n");
  (filas || []).slice(0, 6).forEach((f) => {
    console.log("    " + String(f.created_at).slice(11, 19) +
      "  " + String(f.texto || "(sin texto)").padEnd(12) +
      "  matched=" + (f.matched || "-") +
      "  handler=" + (f.estado_handler || "-"));
  });

  console.log("");

  const elUno = (filas || []).find((f) => f.texto === "1");

  if (!elUno) {
    console.log("  × El «1» ni siquiera aparece en el log.\n");
    console.log("    O no llegó, o la última escritura de la tabla no llegó.\n");
    process.exit(1);
  }

  console.log("  ──────────────────────────────────────────────\n");

  if (elUno.matched) {
    console.log("  ✓ El «1» se entendió: matched=" + elUno.matched + "\n");
    console.log("    El flujo funciona con los dos mensajes seguidos. Si al usuario");
    console.log("    se le corta, el problema es el tiempo entre uno y otro, no el");
    console.log("    flujo.\n");
  } else {
    console.log("  × El «1» llegó y NO se entendió.\n");
    console.log("    Y como el «turno» anterior SÍ funcionó, no es que la palabra");
    console.log("    esté mal: es que el estado del menú se perdió entre medias.\n");
    console.log("    Eso apunta al Map en memoria: sin Redis, cada reinicio del");
    console.log("    bot borra quién estaba en qué menú. Y el bot se acaba de");
    console.log("    desplegar.\n");
  }
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});