/* ¿El token de instancia sirve para lo que hace el bot, o solo para leer?
   ─────────────────────────────────────────────────────────────
   Antes de meter el token por instancia en el código hay que
   confirmar que sirve para ENVIAR. Es distinto: si el token aísla pero
   no puede mandar mensajes, cambiar el código deja el bot mudo y sin
   dar ningún error, que es el peor resultado posible.

   Se comprueba con las rutas que el bot usa de verdad, y se evita
   mandar un WhatsApp de verdad hasta saber cómo responde el resto.
   ───────────────────────────────────────────────────────────── */
require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

(async () => {
  const { data: srv } = await db
    .from("evolution_servers")
    .select("url, api_key")
    .limit(1)
    .single();

  const lista = await (
    await fetch(srv.url + "/instance/fetchInstances", {
      headers: { apikey: srv.api_key },
      signal: AbortSignal.timeout(30000),
    })
  ).json();

  const yo = (Array.isArray(lista) ? lista : [])[0];
  const inst = encodeURIComponent(yo.name);

  console.log("\n═══ ¿El token de instancia puede hacer lo que hace el bot? ═══\n");

  /* Se llama con el token de la INSTANCIA. Si alguna de estas rutas
     cambia de comportamiento, el token no sirve para reemplazar a la
     clave del servidor en el camino del bot. */
  const RUTAS = [
    ["leer el webhook", "GET", "/webhook/find/" + inst],
    ["leer los chats", "POST", "/chat/findChats/" + inst],
    ["leer los números", "GET", "/instance/fetchInstances"],
  ];

  for (const [desc, metodo, ruta] of RUTAS) {
    let status;
    let detalle = "";

    try {
      const r = await fetch(srv.url + ruta, {
        method: metodo,
        headers: {
          apikey: yo.token,
          ...(metodo === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        ...(metodo === "POST" ? { body: JSON.stringify({}) } : {}),
        signal: AbortSignal.timeout(30000),
      });

      status = r.status;
      const t = await r.text();
      let j = null;
      try { j = JSON.parse(t); } catch (e) { j = null; }

      if (Array.isArray(j)) detalle = j.length + " resultado(s)";
      else if (j && j.status && Number(j.status) >= 400) {
        detalle = "el cuerpo dice error";
        status = 0;
      }
    } catch (e) {
      status = 0;
      detalle = e.message.split("\n")[0];
    }

    console.log("  " + (status >= 200 && status < 300 ? "✓" : "×") + " " +
      desc.padEnd(22) + "HTTP " + status + (detalle ? "  ·  " + detalle : ""));
  }

  /* ── EL ENVÍO ──
     Es la única que importa y la única que manda un WhatsApp de verdad.
     Se pide confirmación en pantalla antes de hacerla, porque manda un
     mensaje real al número del segundo teléfono. */
  console.log("");
  console.log("  ──────────────────────────────────────────────");
  console.log("");
  console.log("  Falta la prueba que de verdad importa: ENVIAR.");
  console.log("  Es la única forma de saber si el token alcanza para mandar");
  console.log("  mensajes, y manda un WhatsApp real al segundo teléfono.\n");
  console.log("    node db/probar-aislamiento.js --enviar\n");
  console.log("  Sin eso, se puede guardar el token pero no usarlo para enviar:");
  console.log("  el bot leería bien y no contestaría nunca, sin ningún error.\n");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});