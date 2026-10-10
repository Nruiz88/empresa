/* ¿El findMessages de Evolution sirve para medir, o no devuelve nada?
   ─────────────────────────────────────────────────────────────
   POR QUÉ ESTO ANTES DE CONCLUIR NADA SOBRE EL BOT

   `db/probar-entrega-bot.js` usa `findMessages` para ver si el WhatsApp sale
   de verdad. Y ese script respondió que el bot no enviaba nada.

   Pero el mismo script-guapo dice, ANTES de mandar nada:

       mensajes que ya tenía la instancia: 0

   Cero. Con una instancia que lleva días funcionando. Si el historial
   de una instancia en marcha está vacío, hay dos posibilidades y se
   parecen muchísimo:

     · el bot no envía nada   (grave)
     · findMessages no sirve  (mi herramienta está rota)

   Y distinguirlas es lo único que importa antes de decir nada. Un
   script que mide mal y dice "el bot está mudo" hace pasar un rato
   de miedo por una avería que no existe, y lo hace en la dirección
   equivocada: luego cuando el bot falle de verdad, nadie le creerá.

   ── CÓMO SE CALIBRA ──

   Se manda un WhatsApp POR LA VÍA QUE YA SE SABE QUE FUNCIONA — el
   sendText de Evolution, que devolvió 201 en pruebas anteriores — y se
   mira si findMessages lo enseña.

   Si después de un envío que sabemos que ocurrió, findMessages sigue
   vacío, la herramienta no sirve y no se puede concluir nada sobre el
   bot con ella.

   ── EL DESTINATARIO ──

   El número de la propia instancia. Mandarse un WhatsApp a uno mismo
   no molesta a nadie: ese chat solo lo vemos nosotros. */
require("../../lib/env").load();

const db = require("../../lib/supabase").getAdmin();

(async () => {
  console.log("\n═══ ¿Sirve findMessages para medir? ═══\n");

  const { data: srv } = await db
    .from("evolution_servers")
    .select("url, api_key")
    .limit(1)
    .single();

  const { data: bot } = await db.from("bots").select("instance_name").limit(1).single();
  const instancia = encodeURIComponent(bot.instance_name);

  const call = async (ruta, metodo, cuerpo) => {
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
    let j = null;
    try { j = JSON.parse(t); } catch { j = null; }
    return { status: r.status, ok: r.ok, json: j, texto: t };
  };

  /* ---- 1. Antes ---- */
  const antes = await call("/message/findMessages/" + instancia, "POST", { limit: 20 });
  console.log("  findMessages antes   HTTP " + antes.status);
  console.log("    respuesta cruda: " + antes.texto.slice(0, 180));
  console.log("    es un array: " + Array.isArray(antes.json));

  /* ---- 2. Un envío que SABEMOS que funciona ---- */
  const lista = await call("/instance/fetchInstances", "GET", null);
  const yo = (Array.isArray(lista.json) ? lista.json : []).find(
    (i) => i.name === bot.instance_name
  );
  const numero = String(yo?.ownerJid || "").replace("@s.whatsapp.net", "");

  const marca = "calib" + Date.now();
  const envio = await call(
    "/message/sendText/" + instancia,
    "POST",
    { number: numero, text: marca }
  );

  console.log("\n  sendText            HTTP " + envio.status);
  console.log("    respuesta: " + envio.texto.slice(0, 180));

  if (!envio.ok) {
    console.log("\n  · El envío directo tampoco funcionó. Sin eso no hay");
    console.log("    calibración posible: no sabemos si es la herramienta o");
    console.log("    el servidor de WhatsApp.\n");
    process.exit(1);
  }

  /* ---- 3. Mirar si aparece ---- */
  console.log("\n  esperando a que aparezca...");
  let salio = false;

  for (let i = 1; i <= 6; i++) {
    await new Promise((x) => setTimeout(x, 4000));

    const despues = await call("/message/findMessages/" + instancia, "POST", { limit: 20 });
    const tiene = despues.texto.includes(marca);

    if (tiene) {
      console.log("  ✓ aparece en findMessages a los " + i * 4 + " s");
      console.log("    la herramienta sirve. Lo que devuelve probar-entrega-bot.js");
      console.log("    es real.\n");
      salio = true;
      break;
    }
    if (i === 3) console.log("  " + i * 4 + " s, todavía no");
  }

  if (!salio) {
    console.log("  × NO aparece, y sabemos que el envío ocurrió (HTTP " + envio.status + ").\n");
    console.log("  Conclusión: findMessages NO sirve para medir. No devuelve el");
    console.log("  historial, o devuelve otra cosa.\n");
    console.log("  Esto significa que db/probar-entrega-bot.js NO puede decir si");
    console.log("  el bot envía o no. Su veredicto de «el bot está mudo» es");
    console.log("  sobre la herramienta, no sobre el bot.\n");

    /* Lo que sí sabemos, y no es poco:
       el webhook devuelve 200 y Evolution acepta los envíos (201). */
    console.log("  Lo que sí está comprobado, por otros caminos:");
    console.log("    · el webhook recibe, valida la firma y encuentra la respuesta");
    console.log("    · Evolution acepta envíos con 201 (este script, ahora mismo)");
    console.log("    · la instancia está open\n");
    console.log("  Lo que NO está comprobado: que el mensaje llegue al teléfono.\n");
    console.log("  Para eso, un segundo número que escriba al de la instancia.\n");

    const ultimo = await call("/message/findMessages/" + instancia, "POST", { limit: 20 });
    console.log("  (findMessages devolvió HTTP " + ultimo.status + ", " +
      ultimo.texto.length + " bytes: " + ultimo.texto.slice(0, 120) + ")");
  }

  process.exit(salio ? 0 : 1);
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});