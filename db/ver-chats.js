/* ¿Hay un chat con el 2996733077?
   ─────────────────────────────────────────────────────────────
   La ruta buena es `POST /chat/findChats/{inst}` (las otras que existen
   son `/instance/fetchInstances` y `/webhook/find/{inst}`).

   ── LO QUE HAY QUE MIRAR CON CUIDADO ──

   Los chats que devuelve NO vienen con números de teléfono. El primero
   que se vio fue:

       "remoteJid": "55843265462454@lid"

   Un `@lid` NO es un teléfono: es el identificador nuevo de WhatsApp.
   Y el bot tiene esta línea:

       remoteJid.replace("@s.whatsapp.net", "").replace("@lid", "")

   Si un mensaje llega con el JID en esa forma, lo que queda es un
   identificador de cuenta, y Evolution lo envía como si fuera un
   número de teléfono. O no llega a nadie, o llega a otra persona.

   Esta es la primera vez que se ven LIDs de verdad en esta caja, y no
   son inventados: salen de la propia API. */
require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

const BUSCADO = process.argv[2] || "2996733077";

(async () => {
  const { data: srv } = await db
    .from("evolution_servers")
    .select("url, api_key")
    .limit(1)
    .single();

  const { data: bot } = await db.from("bots").select("instance_name").limit(1).single();
  const inst = encodeURIComponent(bot.instance_name);

  console.log("\n═══ Los chats de la instancia ═══\n");
  console.log("  buscando: " + BUSCADO + "\n");

  const r = await fetch(srv.url + "/chat/findChats/" + inst, {
    method: "POST",
    headers: { apikey: srv.api_key, "Content-Type": "application/json" },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(30000),
  });

  if (!r.ok) {
    console.log("  x HTTP " + r.status);
    process.exit(1);
  }

  const chats = await r.json();
  const lista = Array.isArray(chats) ? chats : [];

  console.log("  la instancia tiene " + lista.length + " chat(s)\n");

  let conLid = 0;
  let conTelefono = 0;

  for (const c of lista) {
    const jid = String(c.id?.remoteJid || c.remoteJid || c.jid || "");
    if (!jid) continue;

    const esLid = jid.endsWith("@lid");
    if (esLid) conLid++;
    else conTelefono++;

    const ts = c.timestamp?.["$date"] || c.timestamp || "";
    const fecha = ts ? new Date(ts) : null;
    const mins = fecha ? Math.round((Date.now() - fecha.getTime()) / 60000) : null;

    console.log("    " + (esLid ? "[lid] " : "[tel] ") + jid);
    console.log("        mensajes:    " + (c.messageCount ?? c._count?.messages ?? "?"));
    console.log("        sin leer:    " + (c.unreadCount ?? c._count?.unread ?? "?"));
    if (mins !== null) {
      console.log("        hace:        " + mins + " min");
      if (mins < 1) console.log("        ↑ ESTE ES DE HACE UN MINUTO");
    }
    console.log("");
  }

  console.log("  ──────────────────────────────────────────────");
  console.log("  chats con @lid:    " + conLid);
  console.log("  chats con número:  " + conTelefono);
  console.log("");

  const alguien = lista.find((c) =>
    String(c.id?.remoteJid || c.remoteJid || "").includes(BUSCADO)
  );

  if (alguien) {
    console.log("  ✓ hay un chat con " + BUSCADO);
    console.log("    El mensaje SÍ llegó a WhatsApp con ese número.");
    console.log("    Si el bot no contestó, el problema está después de acá.\n");
  } else {
    console.log("  · no hay ningún chat con " + BUSCADO + ".");
    console.log("    Con los chats que hay, ese número no le escribió al bot.\n");
    console.log("    Puede ser que:\n");
    console.log("      · el mensaje se mandó a otro número o a otro chat;");
    console.log("      · o el número de WhatsApp no es " + BUSCADO + ", porque los");
    console.log("        chats nuevos llegan por @lid y no incluyen el teléfono.\n");
    console.log("    Un chat nuevo sin número de teléfono es lo que se ve cuando");
    console.log("    el contacto no figura guardado: WhatsApp manda el @lid y el");
    console.log("    teléfono a un lado.\n");
  }

  /* Lo que de verdad importa del hallazgo: cuántos LIDs hay. */
  if (conLid > 0 && conTelefono === 0) {
    console.log("  ! TODOS los chats son @lid. Ninguno tiene número de teléfono.");
    console.log("    Eso hace probable que el próximo mensaje que llegue al bot");
    console.log("    venga como @lid, y entonces la línea");
    console.log("      remoteJid.replace(\"@lid\", \"\")");
    console.log("    mandaría la respuesta a un identificador, no a un teléfono.\n");
  }
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});