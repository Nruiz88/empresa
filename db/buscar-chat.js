/* ¿Existe el chat con el 2996733077, según la propia caja?
   ─────────────────────────────────────────────────────────────
   En el panel de Evolution ese chat no aparece. Si tampoco existe
   para la API, el mensaje no llegó a la cuenta de WhatsApp de la
   instancia — y entonces no hay nada que el bot pueda hacer, porque no
   hay nada que entregar.

   ── POR QUÉ NO ME FIÉ DEL PRIMER RESULTADO ──

   Consulté la lista de chats dos veces con el mismo cuerpo y me dio
   respuestas distintas: una vez encontró el chat y otra no. Eso no es
   que el chat exista y no exista: es que la API sin filtro devuelve una
   parte y no se sabe cuál.

   Así que no se lista y se busca: se le pasa el número y se pregunta
   por ese. Un "sí" y un "no" así sí significan algo.

   ── Y SI NO ESTÁ EL CHAT ──

   El mensaje no llegó a la cuenta. Las razones pueden ser tres, y van
   de la más tonta a la más grave:

     · se mandó a otro número, y no al de la instancia;
     · la instancia está conectada con una sesión que no es la de
       5492994382147, y por eso su chat tampoco aparece;
     · la sesión está caída y no le llega nada de nadie.

   La segunda es la que más importa, porque significaría que se tomó mal
   un número: se estarías mandando mensajes a una cuenta y el bot
   estaría mirando otra. */
require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

const NUMERO = process.argv[2] || "2996733077";

(async () => {
  const { data: srv } = await db
    .from("evolution_servers")
    .select("url, api_key")
    .limit(1)
    .single();

  /* ───────────────────────────────────────────────────────────────
     CON QUÉ CREDENCIAL SE HABLA CON LA CAJA
     ───────────────────────────────────────────────────────────────

     El token de la INSTANCIA, no la clave global del servidor.

     Este script mira conversaciones. La clave global entra a todas las
     instancias: con un solo cliente da igual, y con el segundo leería
     los chats de un negocio que no es este. No por mala intención, sino
     por usar la credencial que había a mano — que es exactamente como se
     cruzan los datos sin que nadie lo decida.

     Si el bot no tiene token, se para. Caer a la clave global sería el
     fallo que se quiere evitar, y peor: parecería funcionar. */
  const { data: paraElToken } = await db
    .from("bots")
    .select("name, instance_token")
    .limit(1)
    .single();

  const tokenInstancia = (paraElToken?.instance_token || "").trim();

  if (!tokenInstancia) {
    console.log("\n  × este bot no tiene token de instancia.");
    console.log("    Se para: seguir con la clave global leería las");
    console.log("    conversaciones de todos los clientes de la caja.\n");
    process.exit(1);
  }

  const { data: bot } = await db.from("bots").select("instance_name").limit(1).single();
  const inst = encodeURIComponent(bot.instance_name);

  console.log("\n═══ ¿Existe ese chat? ═══\n");
  console.log("  buscando el " + NUMERO + " en la caja\n");

  const buscar = async (cuerpo) => {
    const r = await fetch(srv.url + "/chat/findChats/" + inst, {
      method: "POST",
      headers: { apikey: tokenInstancia, "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) return { error: r.status, lista: [] };
    const j = await r.json();
    return { error: null, lista: Array.isArray(j) ? j : j ? [j] : [] };
  };

  /* Varias formas de preguntar, porque la API no siempre acepta el
     mismo parámetro y no se sabe de antemano cuál usa. */
  const intentos = [
    ["sin filtro", {}],
    ["por jid", { jid: NUMERO }],
    ["por jid con @s.whatsapp.net", { jid: NUMERO + "@s.whatsapp.net" }],
    ["por nombre", { name: NUMERO }],
  ];

  let encontrado = null;
  let forma = null;

  for (const [desc, cuerpo] of intentos) {
    const r = await buscar(cuerpo);

    if (r.error) {
      console.log("  · " + desc.padEnd(28) + "HTTP " + r.error);
      continue;
    }

    console.log("  · " + desc.padEnd(28) + r.lista.length + " chat(s) devueltos");

    /* Busca el número exacto dentro de lo devuelto. Con filtro o sin
       filtro, la respuesta tiene que contenerlo si existe. */
    const choque = r.lista.find((c) =>
      String(c.id?.remoteJid || c.remoteJid || "").includes(NUMERO)
    );

    if (choque && !encontrado) {
      encontrado = choque;
      forma = desc;
    }
  }

  console.log("");

  if (encontrado) {
    console.log("  ✓ EL CHAT EXISTE.\n");
    console.log("    jid:        " + (encontrado.id?.remoteJid || encontrado.remoteJid));
    console.log("    pushName:   " + (encontrado.pushName || "(ninguno)"));
    console.log("    sin leer:   " + (encontrado.unreadCount ?? "no está"));
    console.log("    timestamp:  " + (encontrado.timestamp?.["$date"] || encontrado.timestamp || "no está"));
    console.log("    (encontrado con: " + forma + ")");
    console.log("");
    console.log("    Entonces el mensaje SÍ llegó a la cuenta, y el que falta");
    console.log("    es el webhook: el bot no lo vio. Eso es entre Evolution y");
    console.log("    el servidor del bot.\n");
  } else {
    console.log("  · EL CHAT NO EXISTE.\n");
    console.log("    Y no es que la búsqueda no haya funcionado: se probó sin");
    console.log("    filtro y filtrando, y ninguna de las dos formas lo trae.\n");
    console.log("    O sea que el mensaje del " + NUMERO + " NO LLEGÓ a la cuenta");
    console.log("    de la instancia. Salió de tu teléfono —los dos ticks lo");
    console.log("    confirman— pero no apareció en el otro lado.\n");
  }

  /* Lo que sí se puede afirmar sin depender de la búsqueda. */
  console.log("  ──────────────────────────────────────────────");
  console.log("\n  Ahora, lo que hay que mirar primero, que es lo más tonto y\n" +
              "  lo más probable:\n");
  console.log("    ¿Le escribiste a 5492994382147?\n");
  console.log("    Es el número que dice la propia caja como dueño de la");
  console.log("    instancia. Si el mensaje fue a otro número, no hay nada");
  console.log("    raro: no llegó porque no iba allí.\n");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});