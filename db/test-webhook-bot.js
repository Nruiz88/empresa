require("../lib/env").load();
const db = require("../lib/supabase").getAdmin();

/* La prueba del bot, de verdad, mirando donde el bot ANOTA.
   ─────────────────────────────────────────────────────────────
   POR QUÉ ESTE SCRIPT EXISTE Y QUÉ ESTABA MAL

   `db/test-bot-real.js` manda un WhatsApp de verdad y espera a que el
   bot responda. Es la prueba buena. Y miraba `bots_response_logs`.

   Esa tabla tiene 15 filas, pero ninguna de mi prueba: la escribió el
   camino de Evolution, no el camino de una llamada firmada a mano.

   La tabla que SÍ anota cada llamada al webhook es
   `bots_webhook_logs`, y su última entrada antes de este script era
   exactamente mi mensaje de prueba, con `status: "processed"`.

   O sea: el bot llevaba rato funcionando y el script decía que no. Un
   script que informa mal entrena a no fiarse de él.

   ── LO QUE ESTA PRUEBA SÍ PUEDE DECIR ──

   Que el webhook recibe, valida la firma, encuentra el bot, y
   procesa el mensaje. Eso es el circuito entero, menos Evolution.

   ── LO QUE NO PUEDE DECIR ──

   Que Evolution mande el webhook. Eso no se prueba mandándose un
   mensaje a sí mismo: Evolution filtra los mensajes propios a
   propósito, porque si no el bot se respondería en bucle.
   ───────────────────────────────────────────────────────────── */

const URL_WEBHOOK = process.env.TEST_WEBHOOK || "https://bot.shopcito.com.ar/api/webhook";

(async () => {
  const { data: srv, error: eSrv } = await db
    .from("evolution_servers")
    .select("webhook_secret")
    .limit(1)
    .single();

  if (eSrv) {
    console.log("\n  x no se pudo leer la caja: " + eSrv.message + "\n");
    process.exit(1);
  }

  const { data: bot } = await db.from("bots").select("instance_name, name").limit(1).single();

  /* La última entrada ANTES de mandar nada.

     Sin esto, el script podría encontrar una fila vieja y contarla como
     si fuera respuesta a este mensaje. Con eso, cualquier script que
     espere "algo nuevo" acaba satisfied con datos de hace una hora. */
  const { data: antes } = await db.rpc("ejecutar_sql", {
    consulta:
      "select created_at from bots_webhook_logs order by created_at desc limit 1",
    args: [],
  });
  const marcaAntes = antes && antes[0] ? new Date(antes[0].created_at) : null;

  const marca = "PRUEBA-" + Date.now();
  const numero = "5492994382147";

  console.log("\n═══ El webhook, de punta a punta ═══\n");
  console.log("  destino:   " + URL_WEBHOOK);
  console.log("  bot:       " + bot.name + " (" + bot.instance_name + ")");
  console.log("  marca:     " + marca + "\n");

  /* El cuerpo que Evolution manda en MESSAGES_UPSERT. Con
     `fromMe: false` porque lo que importa es el caso de un cliente,
     no el de un mensaje propio. */
  const cuerpo = {
    event: "MESSAGES_UPSERT",
    instance: bot.instance_name,
    data: {
      key: { remoteJid: numero + "@s.whatsapp.net", fromMe: false, id: marca },
      pushName: "Prueba",
      message: { conversation: "horario" },
    },
  };

  const r = await fetch(URL_WEBHOOK, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-webhook-secret": srv.webhook_secret,
    },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(30000),
  });

  let respuesta = null;
  try {
    respuesta = JSON.parse(await r.text());
  } catch (e) {
    respuesta = null;
  }

  console.log("  1. el bot contesta HTTP " + r.status);
  if (respuesta) {
    console.log("     dice: " + JSON.stringify(respuesta).slice(0, 180));
  }
  console.log("");

  /* 2. ¿Quedó anotado? */
  console.log("  2. ¿queda anotado en bots_webhook_logs?");

  let entrada = null;
  for (let i = 1; i <= 7; i++) {
    await new Promise((x) => setTimeout(x, 2000));

    const { data: filas } = await db.rpc("ejecutar_sql", {
      consulta:
        "select created_at, status, error from bots_webhook_logs " +
        "order by created_at desc limit 5",
      args: [],
    });

    const nuevas = (filas || []).filter((f) => {
      const t = new Date(f.created_at);
      return marcaAntes ? t > marcaAntes : true;
    });

    if (nuevas.length) {
      entrada = nuevas[0];
      console.log("     sí, a los " + i * 2 + " s:  status=" + entrada.status +
        (entrada.error ? "  error=" + entrada.error : ""));
      break;
    }
    if (i === 4) console.log("     " + i * 2 + " s, todavía nada");
  }

  console.log("");

  if (!entrada) {
    console.log("  x el webhook contestó pero no dejó rastro\n");
    console.log("  Eso ya no es que el bot no funcione: es que el camino que");
    console.log("  escribe el log no es el mismo por el que ha entrado este");
    console.log("  mensaje. Habría que mirar los dos caminos por separado.\n");
    process.exit(1);
  }

  const ok = entrada.status === "processed";
  console.log(ok
    ? "  ✓ el webhook recibe, valida la firma, encuentra el bot y procesa el mensaje"
    : "  ! el webhook respondió pero con status=" + entrada.status);
  console.log("");
  console.log("  Lo que NO prueba esto: que Evolution mande el webhook.");
  console.log("  Eso no se prueba mandándose un mensaje a sí mismo, porque");
  console.log("  Evolution filtra los propios a propósito: si no, el bot se");
  console.log("  respondería en bucle. Para eso hace falta un segundo número");
  console.log("  que le escriba al de la instancia.");

  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});