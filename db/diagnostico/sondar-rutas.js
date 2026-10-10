/* ¿Qué rutas existen de verdad? Se prueban una por una.
   ─────────────────────────────────────────────────────────────
   La caja es Evolution 2.3.7. Dos rutas que parecían existir dan 404:
   /message/findMessages y /chat/fetchAllChats.

   Adivinar el nombre de una ruta en la API de otro es la forma más
   lenta de perder una tarde: hay diez formas parecidas y solo una es
   la buena. Se prueban todas y se ve qué responde qué. */
require("../../lib/env").load();

const db = require("../../lib/supabase").getAdmin();

const CANDIDATAS = [
  ["GET", "/message/fetchMessages/{i}"],
  ["POST", "/message/fetchMessages/{i}"],
  ["GET", "/message/findMessages/{i}"],
  ["POST", "/message/findMessages/{i}"],
  ["GET", "/message/fetchBase64/{i}"],
  ["POST", "/message/fetchBase64/{i}"],
  ["GET", "/chat/fetchAllChats/{i}"],
  ["POST", "/chat/fetchAllChats/{i}"],
  ["GET", "/chat/findChats/{i}"],
  ["POST", "/chat/findChats/{i}"],
  ["GET", "/chat/search/{i}"],
  ["POST", "/chat/search/{i}"],
  ["GET", "/instance/fetchInstances"],
  ["GET", "/webhook/fetch/{i}"],
  ["GET", "/webhook/find/{i}"],
  ["POST", "/webhook/find/{i}"],
  ["GET", "/whatsapp/fetchNumbers/{i}"],
  ["POST", "/whatsapp/fetchNumbers/{i}"],
];

(async () => {
  const { data: srv } = await db
    .from("evolution_servers")
    .select("url, api_key")
    .limit(1)
    .single();

  const { data: bot } = await db.from("bots").select("instance_name").limit(1).single();
  const inst = encodeURIComponent(bot.instance_name);

  console.log("\n═══ Qué rutas existen en esta caja ═══\n");
  console.log("  Evolution 2.3.7 · instancia «" + bot.instance_name + "»\n");

  const vivas = [];

  for (const [metodo, ruta] of CANDIDATAS) {
    const real = ruta.replace("{i}", inst);

    try {
      const r = await fetch(srv.url + real, {
        method: metodo,
        headers: {
          apikey: srv.api_key,
          ...(metodo === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        ...(metodo === "POST" ? { body: JSON.stringify({ limit: 5 }) } : {}),
        signal: AbortSignal.timeout(25000),
      });

      const texto = await r.text();
      const ok = r.status !== 404;
      const marca = ok ? "✓" : "·";

      console.log("  " + marca + " " + metodo.padEnd(5) + ruta.padEnd(34) + "HTTP " + r.status);

      if (ok) {
        vivas.push({ metodo, ruta, status: r.status, muestra: texto.slice(0, 220) });
      }
    } catch (e) {
      console.log("  ! " + metodo.padEnd(5) + ruta.padEnd(34) + e.message.split("\n")[0]);
    }
  }

  console.log("\n  ──────────────────────────────────────────────");
  console.log("\n  Las que EXISTEN (" + vivas.length + "):\n");

  for (const v of vivas) {
    console.log("  " + v.metodo + " " + v.ruta);
    console.log("    " + v.muestra.replace(/\s+/g, " ").slice(0, 200));
    console.log("");
  }

  if (!vivas.length) {
    console.log("  ninguna. O el servidor va por otro prefijo, o hay que mirar");
    console.log("  la documentación de la versión 2.3.7.\n");
  }
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});