/* ¿El token de instancia puede ENVIAR mensajes?
   ─────────────────────────────────────────────────────────────
   La documentación dice que hay una clave global que entra a todas las
   instancias, y una por instancia. Y la prueba anterior mostró que el
   token de una instancia NO ve las demás.

   Lo que no dice es si ese token alcanza para mandar un WhatsApp, que es
   lo único que el bot hace con él.

   ── POR QUÉ NO SE SUPONE ──

   Porque si el token aísla pero no puede enviar, cambiar el código deja
   el bot mudo. Y sin dar ningún error: el webhook responde 200,
   Evolution acepta la llamada, y el cliente no recibe nunca nada.

   Ese es el peor resultado posible, y se descubre cuando ya está
   desplegado. Mejor descubrirlo acá.

   ── ESTA SÍ MANDA UN WHATSAPP DE VERDAD ──

   Al segundo teléfono, que es el número de prueba. Es un mensaje más de
   los que ya se mandaron en esta sesión. */
require("../../lib/env").load();

const db = require("../../lib/supabase").getAdmin();

const NUMERO = process.env.TEST_NUMERO || "5492996733077";

(async () => {
  const { data: srv } = await db
    .from("evolution_servers")
    .select("url, api_key")
    .limit(1)
    .single();

  const { data: bot } = await db.from("bots").select("instance_name, name").limit(1).single();

  const lista = await (
    await fetch(srv.url + "/instance/fetchInstances", {
      headers: { apikey: srv.api_key },
      signal: AbortSignal.timeout(30000),
    })
  ).json();

  const yo = (Array.isArray(lista) ? lista : []).find((i) => i.name === bot.instance_name);

  if (!yo || !yo.token) {
    console.log("\n  No se encontró el token de la instancia.\n");
    process.exit(1);
  }

  const texto = "Prueba de envío con el token de instancia. Si leés esto, funciona.";

  console.log("\n═══ ¿El token de instancia puede enviar? ═══\n");
  console.log("  instancia: " + yo.name);
  console.log("  destino:   " + NUMERO);
  console.log("  texto:     " + texto + "\n");

  /* Con el token de la INSTANCIA, no con la del servidor. */
  const r = await fetch(srv.url + "/message/sendText/" + encodeURIComponent(yo.name), {
    method: "POST",
    headers: { apikey: yo.token, "Content-Type": "application/json" },
    body: JSON.stringify({ number: NUMERO, text: texto }),
    signal: AbortSignal.timeout(40000),
  });

  const cuerpo = await r.text();
  console.log("  HTTP " + r.status);
  console.log("  " + cuerpo.slice(0, 320));
  console.log("");

  let j = null;
  try { j = JSON.parse(cuerpo); } catch (e) { j = null; }

  if (r.ok && j && !j.error) {
    console.log("  ✓ EL TOKEN DE INSTANCIA SÍ PUEDE ENVIAR.\n");
    console.log("    Entonces se puede usar para todo lo del bot, y no solo para");
    console.log("    leer. El bot deja de depender de una clave que ve toda la caja.\n");
    console.log("    Si te llegó el mensaje, el cambio es seguro.\n");
    process.exit(0);
  }

  console.log("  × NO PUEDE ENVIAR (o la llamada falló por otra razón).\n");
  console.log("    Un 403 aquí significa que el token aísla para LEER pero no para");
  console.log("    escribir. En ese caso NO se puede poner en el código: el bot");
  console.log("    leería bien y no contestaría nunca.\n");
  console.log("    Habría que seguir usando la clave del servidor para enviar, y el");
  console.log("    aislamiento quedaría por resolver de otra forma.\n");
  process.exit(1);
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});