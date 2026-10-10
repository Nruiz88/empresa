/* ¿Entran mensajes con el JID en forma @lid?
   ─────────────────────────────────────────────────────────────
   POR QUÉ

   En el webhook hay esto:

       const phoneNumber = remoteJid.replace("@s.whatsapp.net", "")
                                    .replace("@lid", "");

   Si el mensaje entra como `123456@lid`, esa línea deja `123456`, y
   Evolution lo toma por un TELÉFONO. O sea: el bot le contesta a
   otra persona, o a nadie.

   El código lo sabe: el comentario de arriba dice que se deja un log
   para confirmarlo en producción. Esta es esa confirmación.

   ── CÓMO ──

   `reply()` guarda `isLid` en cada entrada de `bots_webhook_logs`, así
   que no hay que adivinar: se cuenta.

   Y si hay alguno, se mira el número que salió. Porque el daño no es
   teórico: si el bot contesta al número equivocado, el error es
   invisible — el cliente recibe una respuesta que no pidió, de un
   número que no es el suyo, y nadie sabe de dónde salió. */

require("../../lib/env").load();

const db = require("../../lib/supabase").getAdmin();

(async () => {
  console.log("\n═══ ¿Llegan mensajes con @lid? ═══\n");

  const { data: total, error: eTotal } = await db.rpc("ejecutar_sql", {
    consulta:
      "select count(*) as c from bots_webhook_logs " +
      "where payload->>'isLid' = 'true'",
    args: [],
  });

  if (eTotal) {
    console.log("  x no se pudo consultar: " + eTotal.message + "\n");
    process.exit(1);
  }

  const n = total && total[0] ? Number(total[0].c) : 0;

  console.log("  entradas con isLid = true: " + n + "\n");

  if (n === 0) {
    console.log("  No ha pasado. La línea `replace(\"@lid\", \"\")` no está siendo\n" +
      " tocada por ningún caso real.\n");
    console.log("  Eso NO quiere decir que el código esté bien. Quiere decir que\n" +
      "  hoy no hay problema. Sigue siendo una trampa: el día que WhatsApp\n" +
      "  empiece a mandar LID —y es lo que está haciendo desde 2024— el bot\n" +
      "  contestará al número equivocado sin avisar.\n");
  } else {
    console.log("  SÍ ha pasado. Estos son los mensajes afectados:\n");

    const { data: filas } = await db.rpc("ejecutar_sql", {
      consulta:
        "select created_at, payload->>'from' as remitente, payload->>'text' as texto, " +
        "payload->>'status' as estado " +
        "from bots_webhook_logs where payload->>'isLid' = 'true' " +
        "order by created_at desc limit 10",
      args: [],
    });

    (filas || []).forEach((f) => {
      console.log("    " + f.created_at);
      console.log("      de:   " + f.remitente);
      console.log("      texto: " + String(f.texto || "").slice(0, 60));
      console.log("");
    });

    console.log("  El bot mandó la respuesta a " +
      "la parte del JID que queda al quitar «@lid», que es un identificador");
    console.log("  de cuenta, NO un teléfono. O no llegó, o llegó a otra");
    console.log("  persona. Y en los dos casos el webhook respondió 200.\n");
  }
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});