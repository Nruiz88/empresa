/* Prueba directa del webhook del bot.
   ─────────────────────────────────────────────────────────────
   POR QUÉ HAY QUE SEPARAR ESTO DE LA PRUEBA ANTERIOR

   `db/test-bot-real.js` manda un WhatsApp de verdad y espera a que el
   bot responda. Es la prueba buena, y por eso es la que se hizo
   primero.

   Y mide dos cosas a la vez: que Evolution mande el webhook, y que el
   bot lo procese. Si el bot no responde, no se sabe cuál de las dos
   falló, y el mensaje que deja el script ("el webhook necesita que
   Evolution mande a este bot") es una hipótesis, no un
   diagnóstico.

   Esto manda un MESSAGES_UPSERT firmado directamente al webhook, sin
   pasar por Evolution. Si el bot responde, el webhook funciona y el
   problema está en que Evolution no lo manda. Si no responde, el
   problema está en el bot.

   ── UNA SOSPECHA QUE ESTE SCRIPT CONFIRMA O DESCARTA ──

   La prueba anterior mandó el mensaje DESDE la propia instancia HACIA
   su propio número. Evolution no suelta un MESSAGES_UPSERT de eso:
   lo filtra, y con razón, porque si no el bot se respondería a sí
   mismo en bucle y no pararía nunca.

   O sea que la prueba podría estar bien hecha y no servir para nada,
   y eso no se ve leyendo el script. Se ve pensando en qué hace
   Evolution con un mensaje propio.

   ── EL CUERPO ──

   El que Evolution manda en MESSAGES_UPSERT: el evento, la instancia,
   y `data` con la clave del mensaje, quién lo manda y el texto. Con
   `fromMe: false` porque esto simula a un cliente, que es el caso que
   de verdad importa. */

require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

const URL_WEBHOOK = process.env.TEST_WEBHOOK || "https://bot.shopcito.com.ar/api/webhook";

(async () => {
  const { data: srv, error: eSrv } = await db
    .from("evolution_servers")
    .select("webhook_secret")
    .limit(1)
    .single();

  if (eSrv) throw new Error("no se pudo leer la caja: " + eSrv.message);

  const { data: bot } = await db.from("bots").select("instance_name").limit(1).single();
  const marca = "PRUEBA-" + Date.now();

  const cuerpo = {
    event: "MESSAGES_UPSERT",
    instance: bot.instance_name,
    data: {
      key: {
        remoteJid: "5492994382147@s.whatsapp.net",
        fromMe: false,
        id: marca,
      },
      pushName: "Prueba",
      message: { conversation: "horario" },
    },
  };

  console.log("\n═══ El webhook del bot, directamente ═══\n");
  console.log("  destino:  " + URL_WEBHOOK);
  console.log("  instancia: " + bot.instance_name);
  console.log("  marca:     " + marca + "\n");

  /* Lo que había ANTES, para poder distinguir lo nuevo de lo viejo.
     Sin esto, si ya había una respuesta de hace una hora, el script
     podría contarla como si fuera esta. */
  const { data: antes } = await db.rpc("ejecutar_sql", {
    consulta:
      "select l.created_at from bots_response_logs l order by l.created_at desc limit 1",
    args: [],
  });
  const ultimaAntes = antes && antes[0] ? new Date(antes[0].created_at) : null;

  const r = await fetch(URL_WEBHOOK, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-webhook-secret": srv.webhook_secret,
    },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(30000),
  });

  const texto = await r.text();
  console.log("  HTTP " + r.status);
  console.log("  " + texto.slice(0, 300) + "\n");

  /* Se espera y se mira SOLO lo posterior a lo que había. */
  console.log("  esperando hasta 20 s a que el bot lo procese...");

  let nuevo = null;
  for (let i = 1; i <= 7; i++) {
    await new Promise((r2) => setTimeout(r2, 3000));

    const { data: logs } = await db.rpc("ejecutar_sql", {
      consulta:
        "select l.message, r.keyword, r.response_text, l.created_at " +
        "from bots_response_logs l join bots_responses r on r.id = l.response_id " +
        "order by l.created_at desc limit 5",
      args: [],
    });

    const recientes = (logs || []).filter((l) => {
      const t = new Date(l.created_at);
      if (!ultimaAntes) return true;
      return t > ultimaAntes;
    });

    if (recientes.length) {
      nuevo = recientes[0];
      console.log("  contestado a los " + i * 3 + " s");
      break;
    }
    if (i % 2 === 0) console.log("  " + i * 3 + " s, todavía nada");
  }

  console.log("");
  if (!nuevo) {
    console.log("  x el webhook NO procesó el mensaje");
    console.log("");
    console.log("  El bot recibió la llamada y no hizo nada. El problema está");
    console.log("    en el bot, no en que Evolution no lo mande.");
  } else {
    console.log("  ✓ el webhook funciona");
    console.log("    lo que escribió: \"" + String(nuevo.message).slice(0, 60) + "\"");
    console.log("    lo que/createkeyword ".replace("/createkeyword ", ""));
    console.log("    palabra clave: " + (nuevo.keyword || "(ninguna, texto libre)"));
    console.log("    respuesta:    \"" + String(nuevo.response_text).slice(0, 100) + "\"");
    console.log("");
    console.log("  Es decir: el bot funciona. Lo que falló en la prueba anterior es");
    console.log("  que Evolution no suelta webhook de un mensaje que se manda a sí");
    console.log("  mismo, que es lo que hace por diseño.");
  }
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});