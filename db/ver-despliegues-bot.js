/* ¿Se reinició el bot entre las 19:58:44 y las 19:59:01?
   ─────────────────────────────────────────────────────────────
   El usuario escribió «turno» (19:58:44), el bot le mostró el menú, y
   al escribir «1» (19:59:01) no pasó nada: `matched = -`.

   El mismo par de mensajes, seguidos, funciona. La diferencia entre que
   funcione y no son diecisiete segundos.

   Y el estado del menú se guarda así:

       const agendaActiveFallback = new Map<string, boolean>();

   Un Map en memoria del proceso. Se borra en cada reinicio. Si el bot
   se reinició entre los dos mensajes, el menú dejó de existir y el «1»
   no tenía a qué referirse.

   Esto mira los despliegues del bot para ver si hubo uno en ese hueco.
   ───────────────────────────────────────────────────────────── */
const fs = require("fs");
const path = require("path");

/* Las credenciales de Coolify están en un fichero aparte, no en .env */
const envTxt = fs.readFileSync(
  path.join(__dirname, "..", ".env.coolify"),
  "utf8"
);

const leer = (clave) => {
  const m = envTxt.match(new RegExp("^" + clave + "\\s*=\\s*(.+)$", "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
};

const BASE = leer("COOLIFY_URL") || leer("COOLIFY_BASE");
const TOKEN = leer("COOLIFY_TOKEN");

const APP = process.argv[2];

if (!BASE || !TOKEN) {
  console.log("\n  No se pudo leer .env.coolify\n");
  process.exit(1);
}

const api = async (ruta) => {
  const r = await fetch(BASE.replace(/\/$/, "") + ruta, {
    headers: { Authorization: "Bearer " + TOKEN },
    signal: AbortSignal.timeout(30000),
  });
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t) }; }
  catch { return { status: r.status, texto: t }; }
};

(async () => {
  if (!APP) {
    /* Sin uuid a mano, se busca el bot por nombre. */
    const todas = await api("/api/v1/applications");
    const lista = Array.isArray(todas.json) ? todas.json : [];
    const bot = lista.find((a) => /boot|whatsapp|bot/i.test(a.name || ""));

    if (!bot) {
      console.log("\n  No se encontró la aplicación del bot.\n");
      process.exit(1);
    }

    console.log("\n═══ Despliegues del bot ═══\n");
    console.log("  " + bot.name + "  (" + bot.uuid + ")\n");

    const dep = await api("/api/v1/applications/" + bot.uuid + "/deployments");

    if (!Array.isArray(dep.json)) {
      console.log("  No se pudieron leer: HTTP " + dep.status + "\n");
      process.exit(1);
    }

    const lista2 = dep.json.slice(0, 10);

    if (!lista2.length) {
      console.log("  (sin despliegues registrados)\n");
    }

    lista2.forEach((d) => {
      const f = String(d.created_at || "").slice(11, 19);
      console.log(
        "  " + f + "  " + String(d.status || "?").padEnd(10) +
        "  " + (d.application_name || "")
      );
    });

    console.log("");
    console.log("  ──────────────────────────────────────────────");
    console.log("\n  El turno se escribió a las 19:58:44 y el «1» a las 19:59:01.");
    console.log("  Si hay un despliegue en ese minuto, el estado en memoria se");
    console.log("  borró en medio y el «1» llegó sin menú detrás.\n");
    console.log("  Y si es lo que pasó, no es un fallo puntual: es que CADA");
    console.log("  despliegue rompe los flujos a medias. Con Redis no.\n");
  }
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});