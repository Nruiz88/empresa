/* ¿El mensaje del segundo número llegó a WhatsApp?
   ─────────────────────────────────────────────────────────────
   POR QUÉ ESTE NIVEL Y NO OTRO

   Hay tres capas, y quedarse en la primera hace creer que el bot está roto:

     1. ¿El mensaje llegó a WhatsApp?        (no lo controla nadie acá)
     2. ¿Evolution mandó el webhook?          (configuración)
     3. ¿El bot lo entendió y contestó?      (el bot)

   Acaba de pasar: escribiste desde el segundo número, no llegó nada,
   y en `bots_webhook_logs` NO HAY ninguna entrada de ese número.

   Eso ya descarta la capa 3: si el bot hubiera recibido el mensaje,
   estaría anotado, aunque fuera para decir «no sé qué hacer con esto».
   El log anota TODO lo que entra, incluidas las_basura.

   Así que el problema está arriba: o el mensaje no llegó a WhatsApp, o
   Evolution no avisó. Esta es una comprobación de la capa 1.

   ── POR QUÉ IMPORTABA NO ADIVINAR ──

   La respuesta fácil es «el webhook está mal» o «el bot está roto», y
   las dos son fáciles de decir y difíciles de comprobar. La que de
   verdad se necesita es saber cuál de las dos es, porque una se arregla
   en el bot y la otra ni toca el bot.

   ── EL NÚMERO DEL BOT ──

   Es 5492994382147, el mismo de siempre. Si el mensaje se mandó a otro
   número, no aparece en ninguna parte de esto. */

require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

const API = "https://bot.shopcito.com.ar";

async function api(srv, ruta, metodo = "GET", cuerpo = null) {
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
  try { return { status: r.status, ok: r.ok, json: JSON.parse(t) }; }
  catch { return { status: r.status, ok: r.ok, json: null, texto: t }; }
}

(async () => {
  const { data: srv } = await db
    .from("evolution_servers")
    .select("url, api_key")
    .limit(1)
    .single();

  const { data: bot } = await db.from("bots").select("instance_name").limit(1).single();
  const inst = encodeURIComponent(bot.instance_name);

  console.log("\n═══ ¿Llegó el mensaje a WhatsApp? ═══\n");

  /* ---- 1. La instancia ---- */
  const lista = await api(srv, "/instance/fetchInstances");
  const yo = (Array.isArray(lista.json) ? lista.json : []).find((i) => i.name === bot.instance_name);

  console.log("  instancia: " + bot.instance_name);
  console.log("  número:    " + String(yo?.ownerJid || "").replace("@s.whatsapp.net", ""));
  console.log("  estado:    " + yo?.connectionStatus);
  console.log("  fuera:     " + (yo?.settings?.reconnect?.now === false ? "no" : "sí"));
  console.log("");

  /* ---- 2. Los chats ---- */
  /* Si el segundo número le escribió al bot, hay un chat con él. Si el
     chat no existe, el mensaje no llegó a WhatsApp con ese número, y el
     bot no tiene la culpa de nada: nadie le avisó. */
  const chats = await api(srv, "/chat/fetchAllChats/" + inst);

  console.log("  ──────────────────────────────────────────────");

  if (!chats.ok) {
    console.log("  · No se pudo listar los chats (HTTP " + chats.status + ").");
    console.log("    Sin eso no se puede saber si el mensaje llegó a WhatsApp.\n");
    process.exit(1);
  }

  const lista_chats = Array.isArray(chats.json) ? chats.json : [];

  console.log("  · la instancia tiene " + lista_chats.length + " chat(s)\n");

  const phone = String(yo?.ownerJid || "").replace("@s.whatsapp.net", "");
  const relevantes = lista_chats.filter((c) => {
    const jid = String(c.id?.remoteJid || c.jid || "");
    return jid.includes("2996733077") || jid.includes(phone);
  });

  if (!relevantes.length) {
    console.log("  · NO hay ningún chat con el 2996733077 ni con " + phone + ".\n");
    console.log("    O sea: el mensaje no llegó a WhatsApp con ese número.\n");
  }

  for (const c of relevantes) {
    const jid = String(c.id?.remoteJid || c.jid || "");
    console.log("  chat con " + jid);
    console.log("    mensajes:     " + (c.messageCount ?? c._count?.messages ?? "?"));
    console.log("    sin leer:     " + (c.unreadCount ?? c._count?.unread ?? "?"));
    console.log("    actualizado:  " + c.timestamp?.["$date"] || c.timestamp || "?");
    console.log("");
  }

  /* ---- 3. El webhook, una vez más, por si acaso ---- */
  console.log("  ──────────────────────────────────────────────");
  console.log("  Y para descartar: el webhook sigue puesto.\n");

  const hook = await api(srv, "/webhook/fetch/" + inst);
  console.log("    HTTP " + hook.status);
  if (hook.ok && hook.json) {
    const listaHook = Array.isArray(hook.json) ? hook.json : [hook.json];
    for (const h of listaHook) {
      if (!h) continue;
      console.log("    url:      " + (h.url || "(ninguna)"));
      console.log("    enabled:  " + h.enabled);
      console.log("    eventos:  " + (h.events || []).join(", "));
    }
  } else {
    console.log("    " + String(hook.texto || "").slice(0, 200));
  }

  console.log("\n  ──────────────────────────────────────────────");
  console.log("\n  Si el chat con el 2996733077 NO existe, lo que hay que\n" +
              "  comprobar es que el mensaje se haya mandado AL NÚMERO DEL\n" +
              "  BOT (" + phone + "), y no a otro chat.\n");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});