/* La prueba del bot con un segundo número de verdad.
   ─────────────────────────────────────────────────────────────
   POR QUÉ ESTA PRUEBA ES DISTINTA A TODAS LAS ANTERIORES

   Con un solo número, la mitad de la pregunta no tiene respuesta. Se
   mandó el mensaje de la propia instancia hacia su propio número, y
   Evolution filtra eso a propósito: si lo soltara, el bot se respondería
   a sí mismo en bucle sin parar.

   Por eso hasta ahora solo se había comprobado una mitad: que el
   webhook recibe, valida la firma, encuentra el bot y encuentra la
   respuesta correcta. Todo eso pasa dentro de la función. Que el
   WhatsApp LLEGUE es otra cosa, y es la que ve el cliente.

   Con un segundo número desaparece el filtro, porque el mensaje ya no
   es propio. Y ahí se cierra el circuito entero.

   ── LO QUE COMPRUEBA EL SCRIPT, Y LO QUE NO ──

   El script comprueba lo que se puede mirar desde fuera:

     · que Evolution mandó el webhook (aparece en bots_webhook_logs)
     · que el bot identificó la respuesta
     · qué es exactamente lo que iba a contestar

   Y eso último es lo interesante: lo imprime, para que puedas
   COMPARARLO con lo que te llegó al teléfono.

   Lo que el script NO puede comprobar es si el mensaje llegó. Eso lo
   ves vos. Y es la parte que importa: un bot puede escribir la
   respuesta perfecta en el log y no mandarla, si Evolution acepta el
   envío y luego no lo entrega. Eso no se ve desde ningún log.

   ── CÓMO SE USA ──

     node db/probar-con-segundo-numero.js --numero 549XXXXXXXXX

   El script no manda nada. Espera a que vos escribas. */

require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

const API = "https://bot.shopcito.com.ar";

/* Las palabras que el bot tiene respondidas. Se prueban todas porque
   cada una va por un camino distinto del código: el menú, el catálogo,
   las reservas y las respuestas fijas. Con una sola palabra se
   comprobaría un camino y se daría por buena la entrega de los otros. */
const PALABRAS = ["horario", "1"];

const argNumero = process.argv.indexOf("--numero");
const numero = argNumero > -1 ? process.argv[argNumero + 1] : null;

/* ─────────────────────────────────────────────────────────────
   EL NÚMERO QUE SE ESCRIBE, Y EL QUE SE BUSCA

   No son lo mismo, y por eso se.normalize antes de buscar.

   Si escribís «2996733077», el JID que Evolution manda es
   «5492996733077@s.whatsapp.net»: código de país, el 9 del móvil
   internacional, y después el número.

   Buscando el que se escribió, la búsqueda no encuentra NADA y el
   script dice «el bot no registró nada» — cuando en realidad sí lo
   registró, con el otro prefijo. Y esa conclusión está al revés: te
   dice que el bot está mudo justo cuando está funcionando.

   Por eso se limpian los signos y se comparan los últimos dígitos, que
   es la parte que no cambia. Con eso da igual cómo lo escribas.

   ── POR QUÉ NO NORMALIZAJO SOLO A «549…» ──

   Porque los prefijos varían por país y esa regla es de Argentina. Si
   mañana se prueba con otro país, el scriptPicker inventaría un
   prefijo equivocado y dejaría de encontrar. Buscando por los últimos
   dígitos funciona en todos los casos sin adivinar nada.
   ───────────────────────────────────────────────────────────── */

/** El prefijo que se busca en los logs: los últimos 8 dígitos, sin ceros
    de más. Ocho es lo bastante largo para que no choque con otro número. */
function prefijoDe(num) {
  const limpio = String(num).replace(/\D/g, "");
  return limpio.length > 8 ? limpio.slice(-8) : limpio;
}

function explicar(num) {
  const limpio = String(num).replace(/\D/g, "");
  const pais = limpio.length === 10 ? "54" : "";
  return pais ? limpio.slice(0, 3) + " " + limpio.slice(3, 5) + " " + limpio.slice(5) : limpio;
}

function instructions() {
  console.log("\n═══ El bot, con un número de verdad ═══\n");
  console.log("  Falta el número desde el que vas a escribir.\n");
  console.log("    node db/probar-con-segundo-numero.js --numero 549XXXXXXXXX\n");
  console.log("  Solo los dígitos del país y el número. Sin +, sin espacios.\n");
  console.log("  Y acordate de dónde lo sacaste: es el número que le va a");
  console.log("  escribir AL BOT, no el del bot.\n");
  process.exit(1);
}

if (!numero || !/^\d{8,15}$/.test(numero)) instructions();

(async () => {
  const { data: bot } = await db.from("bots").select("instance_name, name").limit(1).single();

  const prefijo = prefijoDe(numero);

  console.log("\n═══ El bot, con un número de verdad ═══\n");
  console.log("  bot:      " + bot.name + " (" + bot.instance_name + ")");
  console.log("  escribes: " + explicar(numero) + "  ← desde este número");
  console.log("  webhook:  " + API + "/api/webhook");

  /* El aviso del código de país. Va antes de esperar tres minutos,
     porque si está mal escrito lo que se pierde son tres minutos y
     una conclusión al revés. */
  const digitos = String(numero).replace(/\D/g, "");
  if (digitos.length === 10 && /^9/.test(digitos)) {
    console.log("");
    console.log("  ! Ojo: escribiste el número sin código de país.");
    console.log("    En WhatsApp ese móvil es 549" + digitos.slice(1) + ".");
    console.log("    El script busca por los últimos " + prefijo.length +
      " dígitos, así que funciona igual.");
    console.log("    Pero si al escribirle a vos el bot no contesta, prueba con");
    console.log("    el número completo, que a veces cambia a quién le llega.");
  }

  console.log("");

  /* El JID que Evolution va a mandar. No se puede saber a priori si
     llegará como @s.whatsapp.net o como @lid, así que se buscan
     ambos y no se supone. */
  const jidNormal = numero + "@s.whatsapp.net";

  /* ---- 1. Lo que hay AHORA ----

     Sin esto, el script podría encontrar un mensaje viejo del mismo
     número y contarlo como respuesta a esta prueba. Es lo que pasó con
     las pruebas del webhook: expectant un "algo nuevo" y se conformaba
     con un registro de hace una hora. */
  const { data: antesLogs } = await db.rpc("ejecutar_sql", {
    consulta:
      "select created_at, status from bots_webhook_logs " +
      "where payload->>'from' like '%" + prefijo + "%' " +
      "order by created_at desc limit 1",
    args: [],
  });

  const { data: antesResp } = await db.rpc("ejecutar_sql", {
    consulta:
      "select created_at, incoming_message, matched_keyword, response_text " +
      "from bots_response_logs where incoming_phone like '%" + prefijo + "%' " +
      "order by created_at desc limit 1",
    args: [],
  });

  const marcaAntes = antesLogs && antesLogs[0] ? new Date(antesLogs[0].created_at) : null;
  const ultimaResp = antesResp && antesResp[0] ? new Date(antesResp[0].created_at) : null;

  console.log("  ──────────────────────────────────────────────");
  console.log("  AHORA, desde el teléfono " + numero + ":");
  console.log("");
  console.log("    1. Abrí WhatsApp en ese número.");
  console.log("    2. Escribile al bot:");
  PALABRAS.forEach((p, i) => console.log("         " + (i + 1) + ") " + p));
  console.log("    3. Esperá un par de minutos.");
  console.log("");
  console.log("  Yo voy mirando el log. Cuando lo escriba, salí y");
  console.log("  marcá la palabra que usaste.\n");

  console.log("  ──────────────────────────────────────────────");
  console.log("  espero hasta 3 minutos a que aparezca algo nuevo...\n");

  /* ---- 2. Esperar ---- */
  let entrada = null;
  let respuesta = null;

  for (let i = 1; i <= 36; i++) {
    await new Promise((x) => setTimeout(x, 5000));

    const { data: logs } = await db.rpc("ejecutar_sql", {
      consulta:
        "select created_at, status, event_type, payload->>'matched' as matched, " +
        "payload->>'text' as texto, payload->>'isLid' as is_lid " +
        "from bots_webhook_logs where payload->>'from' like '%" + prefijo + "%' " +
        "order by created_at desc limit 5",
      args: [],
    });

    const nuevos = (logs || []).filter((l) => {
      const t = new Date(l.created_at);
      return marcaAntes ? t > marcaAntes : true;
    });

    if (nuevos.length) {
      entrada = nuevos[0];
      console.log("  · " + i * 5 + " s: el webhook registró algo\n");
      break;
    }

    if (i % 4 === 0) console.log("  " + i * 5 + " s, todavía nada");
  }

  /* ---- 3. Lo que pasó ---- */
  console.log("  ──────────────────────────────────────────────");

  if (!entrada) {
    console.log("\n  × LLEGASTE, y el bot no registró nada.\n");

    console.log("  Si escribiste y no registró nada, el problema NO está en el");
    console.log("  bot: está en que Evolution no le está mandando el webhook.\n");
    console.log("  Antes de mirar el bot, comprueba que Evolution lo manda:\n");
    console.log("    1. ¿La instancia sigue conectada? Que no esté en 'connecting'");
    console.log("       o 'logout' — se cae y no avisa.");
    console.log("    2. ¿El webhook de la instancia apunta a " + API + "/api/webhook");
    console.log("       y no a un dominio viejo?");
    console.log("    3. ¿El número que escribió es el correcto? Un número equivocado");
    console.log("       no aparece en ningún log, porque no llega.\n");
    process.exit(1);
  }

  console.log("\n  EL WEBHOOK RECIBIÓ:\n");
  console.log("    cuándo:   " + entrada.created_at);
  console.log("    evento:   " + (entrada.event_type || "(sin nombre)"));
  console.log("    estado:   " + entrada.status);
  console.log("    texto:    " + String(entrada.texto || "").slice(0, 80));
  console.log("    coincidió: " + (entrada.matched || "(nada, el bot no encontró respuesta)"));
  console.log("    vino como lid: " + entrada.is_lid + (entrada.is_lid === "true" ? "  ← ¡PROBLEMA!" : ""));

  /* ---- 4. Lo que respondió ---- */
  if (ultimaResp) {
    const { data: tras } = await db.rpc("ejecutar_sql", {
      consulta:
        "select created_at, incoming_message, matched_keyword, response_text " +
        "from bots_response_logs where incoming_phone like '%" + prefijo + "%' " +
        "and created_at > '" + ultimaResp.toISOString() + "' " +
        "order by created_at desc limit 5",
      args: [],
    });

    if (tras && tras.length) {
      respuesta = tras[0];
      console.log("\n  EL BOT RESPONDIÓ CON:\n");
      console.log("    le escribiste:  " + String(respuesta.incoming_message).slice(0, 60));
      console.log("    palabra clave: " + (respuesta.matched_keyword || "(ninguna, texto libre)"));
      console.log("    te contestó:    " + String(respuesta.response_text || "").slice(0, 140));
    }
  }

  /* ---- 5. Lo que falta, y es lo importante ---- */
  console.log("\n  ──────────────────────────────────────────────");
  console.log("\n  AHORA TE TOCA A VOS:\n");
  console.log("    ¿TE LLEGÓ AL TELÉFONO?\n");

  if (respuesta) {
    console.log("    El log dice que el bot iba a mandar:");
    console.log("      \"" + String(respuesta.response_text || "").slice(0, 90) + "\"\n");
    console.log("    Si en el WhatsApp viste ESO MISMO, el circuito entero funciona:");
    console.log("    Evolution mandó, el bot entendió, Evolution envió, y a vos te llegó.");
    console.log("\n    Si no te llegó nada, el bot está bien y el problema es de envío.");
  } else {
    console.log("    El bot no dejó respuesta registrada para tu número.");
    console.log("    Puede que lo que escribiste no tenga respuestaAutomatic — el");
    console.log("    bot contesta lo que sabe y calla lo que no, que es lo correcto.");
  }

  console.log("\n    Eso no lo puede comprobar ningún script: los logs dicen lo que");
  console.log("    el bot QUISO mandar, no lo que llegó. Un bot puede escribir la");
  console.log("    respuesta perfecta en el log y no mandarla nunca.\n");

  if (entrada.is_lid === "true") {
    console.log("    Y OJO CON UN DATO: tu mensaje entró como @lid, no como número.");
    console.log("    El bot contesta a lo que queda al quitar «@lid», que es un");
    console.log("    identificador de cuenta y no un teléfono. Si no te llegó nada,");
    console.log("    puede ser por esto, y no por otra cosa.\n");
  }

  console.log("    ────────────────────────────────────────────");
  console.log("    Marcá acá qué pasó:\n");
  console.log("      LLEGÓ la respuesta       → el bot funciona entero");
  console.log("      NO LLEGÓ nada             → problema de envío, no del bot");
  console.log("      LLEGÓ otra cosa distinta → problema de número o de @lid");
  console.log("    ────────────────────────────────────────────\n");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});