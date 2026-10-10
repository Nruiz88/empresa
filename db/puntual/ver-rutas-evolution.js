/* ¿Qué endpoints tiene esta versión de Evolution?
   ─────────────────────────────────────────────────────────────
   POR QUQUE HACE FALTA

   Dos comprobaciones seguidas han dado 404:
     · /message/findMessages/{inst}    (buscar envíos)
     · /chat/fetchAllChats/{inst}     (ver si llegó el mensaje)

   Ninguna de las dos existe aquí. Y eso no es un detalle: son las dos
   herramientas con las que se comprobaba si el bot entrega de verdad,
   y sin ellas esa pregunta no tiene respuesta.

   Adivinar rutas a ojo es perder tiempo: esta caja es Evolution v2 y su
   API cambió de forma respecto a lo que estas rutas asumían. Mejor
   preguntarle a la propia caja qué rutas tiene.

   ── LO QUE SE HACE ──

   Se le pide la especificación OpenAPI, que Evolution publica si está
   habilitada, y se listan las rutas que tienen que ver con mensajes.
   Con eso se sabe qué se puede comprobar y qué no. */
require("../../lib/env").load();

const db = require("../../lib/supabase").getAdmin();

const A_VER = ["/openapi.json", "/docs", "/swagger.json", "/api-docs", "/"];

(async () => {
  const { data: srv } = await db
    .from("evolution_servers")
    .select("url, api_key")
    .limit(1)
    .single();

  console.log("\n═══ Las rutas de esta caja ═══\n");
  console.log("  caja: " + srv.url + "\n");

  let spec = null;

  for (const ruta of A_VER) {
    let r;
    try {
      r = await fetch(srv.url + ruta, { headers: { apikey: srv.api_key }, signal: AbortSignal.timeout(20000) });
    } catch (e) {
      console.log("  " + ruta.padEnd(16) + "no responde");
      continue;
    }

    console.log("  " + ruta.padEnd(16) + "HTTP " + r.status);

    if (r.status !== 200) continue;

    const texto = await r.text();
    try {
      const j = JSON.parse(texto);
      if (j && j.paths) { spec = j; break; }
    } catch (e) {
      /* no es json */
    }
  }

  if (!spec) {
    console.log("\n  × Esta caja no publica la especificación.");
    console.log("    Sin ella no se puede saber qué rutas existen.\n");
    console.log("    Y eso deja una pregunta sin responder: no hay forma de");
    console.log("    comprobar desde acá si el bot entrega el WhatsApp.\n");
    process.exit(1);
  }

  const rutas = Object.keys(spec.paths || {});

  console.log("\n  la caja declara " + rutas.length + " rutas.\n");
  console.log("  Las que tienen que ver con mensajes:\n");

  rutas
    .filter((p) => /message|chat|status|webhook/i.test(p))
    .sort()
    .forEach((p) => {
      const metodos = Object.keys(spec.paths[p]).join(", ").toUpperCase();
      console.log("    " + metodos.padEnd(18) + p);
    });

  console.log("\n  ──────────────────────────────────────────────");
  console.log("\n  Con esto se puede rehacer la prueba de entrega usando una ruta");
  console.log("  que exista de verdad, en vez de suponer que la hay.\n");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});