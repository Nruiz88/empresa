/* El camino del webhook, de punta a punta.
   ------------------------------------------------------------
   Se manda al endpoint del bot lo mismo que mandaría Evolution con un
   mensaje de verdad: el evento, la instancia y el texto.

   NO es lo mismo que probar Evolution. Aquí se prueba todo lo que es
   código nuestro: que el secreto se compruebe, que se encuentre el bot,
   que la respuesta case con la palabra y que se conteste. Lo único que
   queda fuera es que Evolution dispare el evento, y eso no se puede
   forzar desde aquí: un mensaje enviado al propio número no genera
   webhook, porque WhatsApp no lo trata como un mensaje entrante. */

const BOT = process.env.TEST_BOT || "https://bot.panel-niconqn.duckdns.org";
const EVO = process.env.EVO_URL;
const KEY = process.env.EVO_KEY;

(async () => {
  require(process.cwd() + "/lib/env").load();
  const supabase = require(process.cwd() + "/lib/supabase");
  const db = supabase.getAdmin();

  const { data: bot } = await db.from("bots").select("id, instance_name, name").limit(1).single();
  const { data: srv } = await db.from("evolution_servers").select("*").limit(1).single();

  /* El secreto del webhook vive en el entorno del bot, no en la fila del
     servidor de Evolution. Esa fila guarda la URL y la clave de la API;
     el secreto con el que el bot valida las peticiones lo tiene el
     servicio en WEBHOOK_SECRET. */
  if (!srv) throw new Error("no hay servidor de Evolution en la base");
  const secreto = process.env.WEBHOOK_SECRET;
  if (!secreto) throw new Error("falta WEBHOOK_SECRET en el entorno");

  console.log("\n═══ El webhook, de punta a punta ═══\n");
  console.log("  bot:       " + bot.name);
  console.log("  instancia: " + bot.instance_name);

  const antes = await db
    .from("bots_webhook_logs")
    .select("id", { count: "exact", head: true });

  /* Lo que Evolution manda cuando a alguien le escribe.

     OJO con el nombre del evento: es `messages.upsert`, en minúsculas y
     con punto. La API lo nombra `MESSAGES_UPSERT` en mayúsculas, y esa
     diferencia hizo que este test pasara sin comprobar nada: el bot
     ignora todo lo que no sea `messages.upsert` (api/webhook/route.ts),
     así que un evento mal escrito devuelve 200 con {"status":"ignored"}
     y parece que todo va bien.

     El remoteJid lleva el @s.whatsapp.net porque así llega de verdad, y
     el bot tiene que quitarlo antes de responder. */
  const mensaje = (texto) => ({
    event: "messages.upsert",
    instance: bot.instance_name,
    data: {
      key: { id: "PRUEBA" + Date.now(), remoteJid: "34600111222@s.whatsapp.net", fromMe: false },
      pushName: "Cliente de prueba",
      messageTimestamp: Math.floor(Date.now() / 1000),
      message: { conversation: texto },
    },
  });

  async function mandar(texto, cabeceras) {
    return fetch(BOT + "/api/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabeceras },
      body: JSON.stringify(mensaje(texto)),
    });
  }

  console.log("\n── 1. La puerta: el secreto ──\n");

  const sinSecreto = await mandar("horario", {});
  console.log("  sin secreto          HTTP " + sinSecreto.status + "  (tiene que ser 401)");

  const claveMala = await mandar("horario", { "x-webhook-secret": "inventada" });
  console.log("  con secreto falso    HTTP " + claveMala.status + "  (tiene que ser 401)");

  const bien = await mandar("horario", { "x-webhook-secret": secreto });
  console.log("  con el secreto bueno HTTP " + bien.status + "  " + (await bien.json()).status);

  console.log("\n── 2. Que la palabra se case con una respuesta ──\n");

  /* Se mira el registro de respuestas, que es lo que escribe el bot al
     procesar. Es la prueba de que entendió el mensaje, no solo de que
     la petición entró.

     La columna que une el registro con la respuesta es
     `auto_response_id`. Con `response_id` —que no existe— el join sale
     vacío y esta comprobación da "no encontró nada" aunque el bot haya
     contestado, que es como se puede estar horas buscando un fallo que
     no está en el bot. */
  /* La columna de tiempo es `sent_at`, no `created_at`. Pedir una
     columna que no existe hace que Postgres devuelva un error y que
     `data` venga vacío, lo que desde aquí se lee igual que "el bot no
     contestó". Es una comprobación que no puede distinguir "no pasó" de "la pregunta
     estaba mal". */
  const ULTIMO =
    "select l.incoming_message, l.matched_keyword, l.sent_at, r.keyword, r.response_text, r.response_type " +
    "from bots_response_logs l join bots_responses r on r.id = l.auto_response_id " +
    "order by l.sent_at desc limit 1";

  for (const palabra of ["horario", "pedido", "humano"]) {
    await mandar(palabra, { "x-webhook-secret": secreto });
    await new Promise((res) => setTimeout(res, 1500));

    const { data } = await db.rpc("ejecutar_sql", { consulta: ULTIMO, args: [] });
    const ultima = (data || [])[0];
    const acertado = ultima && ultima.matched_keyword === palabra;
    console.log(
      "  '" + palabra.padEnd(9) + "' → " +
      (acertado ? "✓ casó con su respuesta" : "✗ no encontró nada para esa palabra")
    );
    if (acertado) {
      console.log("      leería: " + String(ultima.response_text).slice(0, 70));
      if (ultima.response_type === "menu") {
        console.log("      y es un menú, no un texto");
      }
    }
  }

  console.log("\n── 3. Una palabra que no existe ──\n");

  /* Se cuenta cuántas filas hay ANTES y DESPUÉS. Mirar "la última fila"
     no vale: la anterior sigue ahí y siempre sale la que se leyó, así
     que la comprobación daba un fallo siempre, contestara o no. */
  const { count: antesDeRuido } = await db
    .from("bots_response_logs")
    .select("id", { count: "exact", head: true });

  await mandar("qwertyuiop", { "x-webhook-secret": secreto });
  await new Promise((res) => setTimeout(res, 1500));

  const { count: despuesDeRuido } = await db
    .from("bots_response_logs")
    .select("id", { count: "exact", head: true });

  const contestoAlRuido = (despuesDeRuido || 0) > (antesDeRuido || 0);
  console.log(
    "  'qwertyuiop' → " +
    (!contestoAlRuido
      ? "✓ no contestó nada (correcto: se ignora en vez de inventarse una respuesta)"
      : "✗ añadió una respuesta a una palabra que no dijo")
  );

  console.log("\n── 4. Que se haya escrito en el registro ──\n");
  const despues = await db
    .from("bots_webhook_logs")
    .select("id", { count: "exact", head: true });
  const nuevos = (despues.count || 0) - (antes.count || 0);
  console.log("  eventos nuevos registrados: " + nuevos + (nuevos >= 5 ? "  ✓" : "  ✗"));

  console.log("\n  ⚠️  Lo que esto NO prueba: que Evolution dispare el evento.");
  console.log("      Eso se comprueba mandando un WhatsApp de verdad al número.\n");
  process.exit(0);
})().catch((e) => {
  console.error("\n✗ " + e.message + "\n");
  process.exit(1);
});