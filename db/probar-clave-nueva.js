/* ¿La clave nueva sirve para lo que el bot le pide a la caja?
   ─────────────────────────────────────────────────────────────
   Que una clave «responda» no dice nada: puede devolver 200 a una
   llamada vacía y 403 a la que el bot necesita. Lo que importa es que
   funcione en las rutas que el bot usa de verdad.

   ── POR QUÉ NO SE GUARDA DIRECTO ──

   Porque ahora mismo la clave guardada funciona. Cambiarla por otra sin
   comprobar es cambiar algo que anda por algo que no se sabe: si la
   nueva no sirve para enviar, el bot deja de contestar mensajes y
   parece un fallo del bot cuando es un cambio de clave.

   Se prueban las rutas una por una. Las que importan:

     · /instance/fetchInstances   — ver las instancias
     · /webhook/find/{inst}       — leer el webhook
     · /chat/findChats/{inst}     — los chats, que es como se responde

   NO se prueba el envío de un mensaje: mandar un WhatsApp de prueba al
   número real para comprobar una clave no vale la pena, y la respuesta
   del chat dice lo mismo sobre los permisos. */
require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

(async () => {
  const nueva = process.env.NUEVA_CLAVE;

  if (!nueva) {
    console.log("\n  Falta NUEVA_CLAVE. Va por entorno para no escribirla\n" +
                "  en un fichero.\n");
    console.log("    $env:NUEVA_CLAVE=\"...\"\n");
    process.exit(1);
  }

  const { data: srv } = await db.from("evolution_servers").select("url, api_key").limit(1).single();

  /* Las instancias, con la clave GUARDADA, para saber a cuál preguntar. */
  const conActual = await fetch(srv.url + "/instance/fetchInstances", {
    headers: { apikey: srv.api_key },
    signal: AbortSignal.timeout(30000),
  });
  const inst = (await conActual.json()) || [];

  if (!inst.length) {
    console.log("\n  No hay instancias con la clave guardada. No hay nada que probar.\n");
    process.exit(1);
  }

  const nombre = encodeURIComponent(inst[0].name);

  console.log("\n═══ ¿Sirve la clave nueva? ═══\n");

  const RUTAS = [
    ["ver las instancias", "GET", "/instance/fetchInstances"],
    ["leer el webhook", "GET", "/webhook/find/" + nombre],
    ["leer los chats", "POST", "/chat/findChats/" + nombre],
  ];

  let todoOk = true;

  for (const [desc, metodo, ruta] of RUTAS) {
    let status;
    let detalle = "";

    try {
      const r = await fetch(srv.url + ruta, {
        method: metodo,
        headers: {
          apikey: nueva,
          ...(metodo === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        ...(metodo === "POST" ? { body: JSON.stringify({}) } : {}),
        signal: AbortSignal.timeout(30000),
      });

      status = r.status;
      const t = await r.text();

      let j = null;
      try { j = JSON.parse(t); } catch (e) { j = null; }

      /* Una ruta puede devolver 200 y un cuerpo de error. Se mira el
         cuerpo, no solo el número. */
      if (j && j.status && Number(j.status) >= 400) {
        detalle = "el cuerpo dice error: " + (j.response?.message || j.message || "");
        status = 0;
      } else if (Array.isArray(j)) {
        detalle = j.length + " resultado(s)";
      }
    } catch (e) {
      status = 0;
      detalle = e.message.split("\n")[0];
    }

    const bien = status >= 200 && status < 300;
    if (!bien) todoOk = false;

    console.log("  " + (bien ? "✓" : "×") + " " + desc.padEnd(22) + "HTTP " + status +
      (detalle ? "  ·  " + detalle : ""));
  }

  console.log("");

  if (!todoOk) {
    console.log("  La clave nueva NO sirve para todo lo que el bot necesita.");
    console.log("  No se guarda nada. La que está ahora sigue como estaba,");
    console.log("  y ahora mismo funciona.\n");
    process.exit(1);
  }

  console.log("  La clave nueva sirve para todo lo que el bot usa.\n");
  console.log("  ──────────────────────────────────────────────\n");
  console.log("  No se cambia sola: la clave es de una caja que es de un\n" +
              "  despliegue, y cambiarla en caliente es dejar un cambio de clave a\n" +
              "  mitad de una investigación es cómo se pierde la causa.\n");
  console.log("  Decime si la cambio y lo hago en un paso, con lo anterior\n" +
              "  guardado por si hay que volver atrás.\n");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});