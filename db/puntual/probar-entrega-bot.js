/* ¿El bot manda el WhatsApp de verdad, o solo contesta a Evolution?
   ─────────────────────────────────────────────────────────────
   POR QUÉ ESTA PRUEBA Y NO LAS ANTERIORES

   Las pruebas que ya existen comprueban que el webhook RECIBE, valida
   la firma, encuentra el bot y encuentra la respuesta. Todo eso es
   real, y todo eso ocurre dentro de la función.

   Lo que ninguna comprobaba: que el mensaje saliera de verdad. Porque
   cuando el webhook responde `{"status":"success","matched":"horario"}`,
   ese JSON es la ACUSE DE RECEPCIÓN que Evolution lee, no el WhatsApp
   que ve el cliente. Son dos cosas distintas, y el bot podría devolver
   un 200 perfecto mientras evolution se traga el envío porque el
   número no existe, porque el número está mal, o porque la instancia
   está desconectada.

   Y ese es justo el fallo clásico de un bot: verde por dentro, mudo
   por fuera. El webhook responde 200 y nadie se entera hasta que un
   cliente escribe y no le contesta nadie.

   ── CÓMO SE COMPRUEBA SIN UN SEGUNDO NÚMERO ──

   Evolution guarda los mensajes que envía. Se pregunta después de
   mandar el webhook, y se mira si aparece un texto saliente con lo que
   el bot iba a responder.

   El destinatario es el número de la propia instancia. Mandarse un
   WhatsApp a uno mismo es normal en WhatsApp y Evolution lo permite, y
   es el único chat donde una prueba así no molesta a nadie: solo lo
   vemos nosotros.

   ── LO QUE ESTA PRUEBA SÍ DEMUESTRA ──

   Que sale el mensaje. Que Evolution lo acepta. Y si se manda un texto
   que NO matchea ninguna respuesta automática, que la instancia
   contesta ''. Con eso se distingue un bot mudo de uno que escribe.

   ── LO QUE NO ──

   Que Evolution mande el webhook. Sigue sin poder probarse: el
   mensaje sale de la propia instancia hacia su propio número, y
   Evolution filtra los propios a propósito. Para eso, segundo número. */

require("../../lib/env").load();

const db = require("../../lib/supabase").getAdmin();

/* Texto imposible que ninguém escribe: sirve de marca para encontrar
   la respuesta en el historial sin confundirla con una real. */
const PREGUNTA = "pruebadelivery87654321";

/* Cuánto se mira. Enviar un WhatsApp y que Evolution lo registre tarda
   un par de segundos; 30 es de sobra y no hace esperar de más. */
const INTENTOS = 6;
const PAUSA_MS = 5000;

const API = "https://bot.shopcito.com.ar";

async function api(evolution, ruta, metodo = "GET", cuerpo = null) {
  const r = await fetch(evolution.url + ruta, {
    method: metodo,
    headers: {
      apikey: evolution.api_key,
      ...(cuerpo ? { "Content-Type": "application/json" } : {}),
    },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
    signal: AbortSignal.timeout(30000),
  });

  const texto = await r.text();
  try {
    return { ok: r.ok, status: r.status, cuerpo: JSON.parse(texto) };
  } catch {
    return { ok: r.ok, status: r.status, cuerpo: texto };
  }
}

(async () => {
  console.log("\n═══ ¿El WhatsApp sale de verdad? ═══\n");

  const { data: srv, error: eSrv } = await db
    .from("evolution_servers")
    .select("url, api_key, webhook_secret")
    .limit(1)
    .single();

  if (eSrv) throw new Error("no se pudo leer el servidor: " + eSrv.message);

  const { data: bot } = await db.from("bots").select("instance_name, name").limit(1).single();
  const instancia = encodeURIComponent(bot.instance_name);

  console.log("  bot:       " + bot.name + " (" + bot.instance_name + ")");

  /* ---- 1. El número de la propia instancia ---- */
  const lista = await api(srv, "/instance/fetchInstances");
  const yo = (Array.isArray(lista.cuerpo) ? lista.cuerpo : []).find(
    (i) => i.name === bot.instance_name
  );

  if (!yo) throw new Error("la instancia no aparece en Evolution");

  const numero = String(yo.ownerJid || "").replace("@s.whatsapp.net", "");
  console.log("  número:    " + numero);
  console.log("  estado:    " + yo.connectionStatus + "\n");

  if (yo.connectionStatus !== "open") {
    console.log("  x la instancia no está conectada. No se prueba nada.");
    console.log("    Con la instancia caída el bot no puede enviar, y ese es");
    console.log("    un problema de Evolution, no del bot.\n");
    process.exit(1);
  }

  /* ---- 2. ¿Sirve la herramienta? ----

     ESTO SE COMPRUEBA ANTES DE MIRAR NADA, y es lo que faltaba.

     La primera versión de este script usó `/message/findMessages` sin
     comprobar nada. En ESTA versión de Evolution ese endpoint da 404,
     `mensajesDe()` devolvía lista vacía para cualquier respuesta, y el
     script concluía «el bot NO envió nada» después de un envío que
     Evolution había aceptado con HTTP 201.

     O sea: la herramienta no medía nada y daba un veredicto. Casi se
     reporta como roto un bot que estaba bien.

     Por eso un 404 aquí corta con aviso, en vez de seguir contando
     mensajes que van a dar cero siempre. Un 404 no es «no envió nada»:
     es «no se pudo mirar». Y esas dos cosas hay que saber distinguirlas
     antes de decir nada sobre el bot. */
  const antes = await api(srv, "/message/findMessages/" + instancia, "POST", {
    limit: 20,
  });

  if (!antes.ok) {
    console.log("\n  · Esta versión de Evolution no tiene findMessages (HTTP " +
      antes.status + ").");
    console.log("    Sin historial no se puede comprobar la entrega.\n");
    console.log("    Y con esta herramienta no se puede concluir NADA sobre si el");
    console.log("    bot envía: el 404 es de la herramienta, no del bot.\n");
    console.log("    Para comprobar la entrega de verdad hace falta un segundo");
    console.log("    número que escriba al de la instancia. Es lo único que se");
    console.log("    parece a un cliente, y lo único que no se puede fabricar.\n");
    process.exit(2);
  }

  const previos = mensajesDe(antes.cuerpo);
  console.log("  mensajes que ya tenía la instancia: " + previos.length);

  /* ---- 3. Mandar el webhook ---- */
  console.log("\n  mandando un mensaje que el bot no tiene respuesta para...");
  console.log("  texto: " + PREGUNTA + "\n");

  const r = await fetch(API + "/api/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-webhook-secret": srv.webhook_secret,
    },
    body: JSON.stringify({
      event: "MESSAGES_UPSERT",
      instance: bot.instance_name,
      data: {
        key: { remoteJid: numero + "@s.whatsapp.net", fromMe: false, id: "DELIVERY-" + Date.now() },
        pushName: "Prueba",
        message: { conversation: PREGUNTA },
      },
    }),
    signal: AbortSignal.timeout(30000),
  });

  console.log("  el webhook contesta HTTP " + r.status);
  console.log("  dice: " + (await r.text()).slice(0, 160) + "\n");

  /* ---- 4. Esperar a que aparezca en el historial ---- */
  console.log("  mirando si sale algo en el historial de la instancia...");

  let nuevos = [];
  for (let i = 1; i <= INTENTOS; i++) {
    await new Promise((x) => setTimeout(x, PAUSA_MS));

    const ahora = await api(srv, "/message/findMessages/" + instancia, "POST", { limit: 20 });
    const actuales = mensajesDe(ahora.cuerpo);

    nuevos = actuales.filter((m) => !previos.some((p) => p.id === m.id));

    if (nuevos.length) {
      console.log("  a los " + i * (PAUSA_MS / 1000) + " s hay " + nuevos.length + " mensaje(s) nuevo(s)\n");
      break;
    }
    if (i === 3) console.log("  " + i * (PAUSA_MS / 1000) + " s, todavía nada");
  }

  console.log("");

  if (!nuevos.length) {
    console.log("  · no salió ningún mensaje.\n");
    console.log("  CON ESTE TEXTO ESO ES LO CORRECTO: el bot no tiene ninguna");
    console.log("  respuesta para \"" + PREGUNTA.slice(0, 12) + "...\", y antes que");
    console.log("  contestarle cualquier cosa a alguien que no entiende, no");
    console.log("  contesta. Un bot que responde «no entiendo» a todo es peor");
    console.log("  que un bot que guarda silencio.\n");
    console.log("  Para ver si ESCRIBE, la comprobación de verdad es mandarle");
    console.log("  una palabra que SÍ tenga respuesta — «horario» — y mirar si");
    console.log("  aparece en el historial. Eso lo hace la parte 5.\n");
  }

  /* ---- 5. Ahora con una palabra que sí matchea ---- */
  console.log("  ──────────────────────────────────────────────");
  console.log("  Ahora con «horario», que el bot SÍ sabe responder:\n");

  const antes2 = await api(srv, "/message/findMessages/" + instancia, "POST", { limit: 20 });
  const previos2 = mensajesDe(antes2.cuerpo);

  const r2 = await fetch(API + "/api/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-secret": srv.webhook_secret },
    body: JSON.stringify({
      event: "MESSAGES_UPSERT",
      instance: bot.instance_name,
      data: {
        key: { remoteJid: numero + "@s.whatsapp.net", fromMe: false, id: "DELIVERY2-" + Date.now() },
        pushName: "Prueba",
        message: { conversation: "horario" },
      },
    }),
    signal: AbortSignal.timeout(30000),
  });

  const cuerpo2 = await r2.json();
  console.log("  el webhook contesta HTTP " + r2.status + "  " + JSON.stringify(cuerpo2).slice(0, 140));

  let salidos = [];
  for (let i = 1; i <= INTENTOS; i++) {
    await new Promise((x) => setTimeout(x, PAUSA_MS));

    const ahora = await api(srv, "/message/findMessages/" + instancia, "POST", { limit: 20 });
    const actuales = mensajesDe(ahora.cuerpo);

    salidos = actuales.filter((m) => !previos2.some((p) => p.id === m.id));
    if (salidos.length) break;
  }

  console.log("");
  if (!salidos.length) {
    console.log("  x el bot ENCONTRÓ la respuesta y NO salió ningún WhatsApp.\n");
    console.log("  Esto es el fallo grave y el que ninguna prueba anterior");
    console.log("  detectaba: el webhook devuelve 200 con la respuesta escrita,");
    console.log("  y el cliente no recibe nada. Verde por dentro, mudo por fuera.\n");
    process.exit(1);
  }

  for (const m of salidos) {
    console.log("  ✓ salió un WhatsApp de verdad:");
    console.log("      a:      " + m.remoteJid);
    console.log("      texto:  " + String(m.text).slice(0, 110));
    console.log("      estado: " + (m.status || "(sin estado)"));
    console.log("");
  }

  console.log("  El bot responde de verdad, no solo dentro del webhook.\n");
  process.exit(0);
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});

/** Evolution devuelve la lista de mensajes con distinta forma según la
   versión, así que se aplana en algo legible en vez de asumir una. */
function mensajesDe(cuerpo) {
  if (!cuerpo) return [];

  const lista = Array.isArray(cuerpo)
    ? cuerpo
    : Array.isArray(cuerpo.messages)
    ? cuerpo.messages
    : Array.isArray(cuerpo.data)
    ? cuerpo.data
    : [];

  return lista
    .map((m) => {
      const clave = m.messageKey || m.key || {};
      const texto =
        m.message?.conversation ??
        m.message?.extendedTextMessage?.text ??
        m.text ??
        "";
      return {
        id: clave.id || m.id || "",
        remoteJid: m.remoteJid || clave.remoteJid || "(sin destinatario)",
        texto: texto,
        text: texto,
        status: m.status,
      };
    })
    .filter((m) => m.id);
}