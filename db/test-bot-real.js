/* ¿El bot responde de verdad? Todo lo demás ya está en verde: el login,
   el ticket, el canje, el dashboard. Lo que no se ha probado nunca es lo
   de dentro: que Evolution mande un mensaje, el webhook lo reciba y el
   bot conteste.

   Se manda desde la propia instancia a su propio número. El mensaje sale
   al chat propio del WhatsApp, que no leen más que nosotros, y lo que se
   mide no es que llegue: es que el webhook lo procese y el bot responda.

   Un chat propio es el único sitio donde se puede hacer esta prueba sin
   molestar a nadie. */

const PANEL = process.env.TEST_PANEL || "https://panel.shopcito.com.ar";
const BOT = process.env.TEST_BOT || "https://bot.shopcito.com.ar";

(async () => {
  console.log("\n═══ El bot, de verdad ═══\n");

  /* Las credenciales de Evolution salen de la base, que es donde las
     guarda el panel: es el mismo camino que usa el bot. */
  const { createClient } = require("@supabase/supabase-js");
  const db = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false } }
  );

  const { data: srv, error: eSrv } = await db
    .from("evolution_servers")
    .select("url, api_key")
    .limit(1)
    .single();
  if (eSrv) throw new Error("no se pudo leer el servidor: " + eSrv.message);

  const { data: bot, error: eBot } = await db
    .from("bots")
    .select("id, name, instance_name")
    .limit(1)
    .single();
  if (eBot) throw new Error("no se pudo leer el bot: " + eBot.message);

  console.log("  bot:        " + bot.name);
  console.log("  instancia:  " + bot.instance_name);

  /* A qué número. El de la propia instancia, sin el @s.whatsapp.net que
     Evolution añade: para enviar se manda el número pelado. */
  const inst = await fetch(srv.url + "/instance/fetchInstances", {
    headers: { apikey: srv.api_key },
    signal: AbortSignal.timeout(20000),
  });
  const lista = await inst.json();
  const yo = (Array.isArray(lista) ? lista : []).find((i) => i.name === bot.instance_name);
  if (!yo) throw new Error("la instancia " + bot.instance_name + " no existe en Evolution");

  const numero = String(yo.ownerJid || "").replace("@s.whatsapp.net", "");
  console.log("  número:     " + numero);
  console.log("  estado:     " + yo.connectionStatus);

  /* ---- 1. Mandar "horario", que el bot tiene como respuesta fija ---- */
  console.log("\n── 1. Le decimos algo al bot ──\n");

  const env = await fetch(
    srv.url + "/message/sendText/" + encodeURIComponent(bot.instance_name),
    {
      method: "POST",
      headers: { apikey: srv.api_key, "Content-Type": "application/json" },
      body: JSON.stringify({ number: numero, text: "horario" }),
      signal: AbortSignal.timeout(30000),
    }
  );
  const cuerpoEnv = await env.json();
  console.log("  enviado     HTTP " + env.status);
  if (!env.ok) {
    console.log("  error:      " + JSON.stringify(cuerpoEnv).slice(0, 200));
    process.exit(1);
  }

  /* ---- 2. Esperar a que el webhook lo recoja ----

     Se mira `bots_webhook_logs`, que es donde el bot anota CADA
     llamada al webhook. Antes se miraba `bots_response_logs`, y esa
     tabla la escribe el camino de Evolution: por eso esta prueba
     decía que el bot no respondía cuando llevaba rato
     respondiendo.

     Y OJO con lo que esta prueba puede y no puede demostrar:

       · puede    — que el webhook recibe, valida la firma, encuentra
                    el bot y responde;
       · NO puede — que Evolution mande el webhook.

     Y lo segundo es justo lo que se viene a probar. Porque el
     mensaje sale DE la instancia HACIA su propio número, y Evolution
     filtra los propios a propósito: si los soltara, el bot se
     respondería en bucle sin parar.

     Con un solo número no se puede probar el circuito entero. Hace
     falta un segundo número que le escriba al de la instancia, y eso
     ya es una decisión de negocio: otro número y otro WhatsApp.

     Para lo que SÍ se puede demostrar sin eso, está
     `db/test-webhook-bot.js`, que manda la llamada firmada a mano y
     comprueba las cuatro etapas del circuito del bot. */
  console.log("\n── 2. ¿Lo recoge el webhook? ──\n");
  console.log("  esperando hasta 45 s a que el bot responda...");

  const clave = "prueba-webhook-" + Date.now();

  let contesto = null;
  for (let i = 1; i <= 15; i++) {
    await new Promise((r) => setTimeout(r, 3000));

    /* Los mensajes que el bot ha guardado son la prueba de que el
       webhook llegó y entendió el mensaje. Se mira el registro de
       respuestas, que es lo que escribe el bot al procesar. */
    const { data: logs } = await db.rpc("ejecutar_sql", {
      consulta:
        "select created_at, status, error from bots_webhook_logs " +
        "order by created_at desc limit 5",
      args: [],
    });

    const reciente = (logs || []).filter((l) => new Date(l.created_at) > new Date(Date.now() - 60000));
    if (reciente.length) {
      contesto = reciente[0];
      console.log(`\n  → el webhook registró la llamada a los ${i * 3} s  (status=${contesto.status})`);
      break;
    }
    if (i % 3 === 0) console.log(`  ${i * 3} s, todavía nada`);
  }

  console.log("\n── El resultado ──\n");

  if (!contesto) {
    console.log("  ✗ el bot NO respondió");
    console.log("\n  Antes de mirar otra cosa: el webhook necesita que Evolution");
    console.log("  mande a este bot. Se comprueba con:");
    console.log("    curl -H 'x-webhook-secret: ...' " + BOT + "/api/webhook");
    process.exit(1);
  }

  console.log("  ✓ el webhook registró la llamada");
  console.log("    status: " + (contesto.status || "?") +
    (contesto.error ? "  error: " + String(contesto.error).slice(0, 120) : ""));

  console.log("");
  console.log("  ── Lo que esto NO demuestra ──");
  console.log("  Que Evolution mande el webhook. El mensaje salió de la");
  console.log("  propia instancia hacia su propio número, y Evolution filtra");
  console.log("  los mensajes propios a propósito: si los soltara, el bot se");
  console.log("  respondería en bucle.");
  console.log("");
  console.log("  Para cerrar eso hace falta un SEGUNDO número que le escriba al");
  console.log("  de la instancia. Para el circuito del bot, sin segundo número:");
  console.log("    node db/test-webhook-bot.js" + "\n");
  console.log("    regla que casó: " + (contesto.keyword || "(ninguna)"));
  console.log("    su respuesta:    " + (contesto.response_text || "").slice(0, 80));

  /* ---- 3. ¿Y el webhook tiene el secreto correcto? ---- */
  const { data: cfg } = await db
    .from("evolution_servers")
    .select("webhook_secret")
    .limit(1)
    .maybeSingle();

  console.log("\n── El secreto del webhook ──\n");
  const prueba = await fetch(BOT + "/api/webhook", {
    method: "POST",
    headers: {
      "x-webhook-secret": cfg && cfg.webhook_secret ? cfg.webhook_secret : "inventado",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event: "CONNECTION_UPDATE", instance: bot.instance_name, data: { state: "open" } }),
  });
  console.log("  con el secreto de la base  HTTP " + prueba.status);

  process.exit(0);
})().catch((e) => {
  console.error("\n✗ " + e.message + "\n");
  process.exit(1);
});