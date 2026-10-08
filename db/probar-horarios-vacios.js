/* ¿Qué devuelve el bot cuando le piden los horarios?
   ─────────────────────────────────────────────────────────────
   El usuario escribe «turno», recibe el menú, escribe «1», y la
   respuesta llega pero SIN horarios. O sea: el flujo funciona y la
   consulta no encuentra nada.

   Eso son dos problemas separados, y conviene no mezclarlos:

     · el estado sobrevivió al reinicio  → Redis funciona;
     · la lista de huecos sale vacía     → la consulta no encuentra
       franjas, o las encuentra y no las transforma en huecos.

   ── LO QUE SE COMPRUEBA ──

   Se pide el paso a paso y se imprime el CUERPO COMPLETO de la
   respuesta. No el `matched`: el texto que se manda.

   Porque «matched: [turno hoy]» y «matched: [turno hoy]» con una lista
   de horarios son el mismo resultado para un script que solo mira el
   matched, y son dos Outcomes muy distintos para quien escribe.

   ── Y DESPUÉS, LA CONSULTA DIRECTA ──

   Se pregunta a la base lo mismo que debería preguntar el bot, con las
   mismas reglas: franjas de hoy, activas, y turnos ya reservados. Si la
   base devuelve franjas y el bot no las enseña, el fallo es del
   código. Si la base no devuelve nada, el fallo es de configuración. */
require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

const API = "https://bot.shopcito.com.ar";
const NUMERO = process.env.TEST_NUMERO || "5492996733077";

async function escribir(instancia, secreto, texto) {
  const r = await fetch(API + "/api/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-secret": secreto },
    body: JSON.stringify({
      event: "MESSAGES_UPSERT",
      instance: instancia,
      data: {
        key: {
          remoteJid: NUMERO + "@s.whatsapp.net",
          fromMe: false,
          id: "SLOTS-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
        },
        pushName: "Prueba Slots",
        message: { conversation: texto },
      },
    }),
    signal: AbortSignal.timeout(30000),
  });

  const texto2 = await r.text();
  let cuerpo = null;
  try { cuerpo = JSON.parse(texto2); } catch (e) { cuerpo = null; }
  return { status: r.status, cuerpo, texto: texto2 };
}

(async () => {
  const { data: srv } = await db
    .from("evolution_servers")
    .select("webhook_secret")
    .limit(1)
    .single();

  const { data: bot } = await db.from("bots").select("instance_name, name, id").limit(1).single();

  console.log("\n═══ Los horarios, paso a paso ═══\n");

  /* ---- 1. «turno» ---- */
  console.log("  1. «turno»\n");
  const r1 = await escribir(bot.instance_name, srv.webhook_secret, "turno");
  console.log("     HTTP " + r1.status);
  console.log("     " + JSON.stringify(r1.cuerpo).slice(0, 400));
  console.log("");

  /* ---- 2. «1» ---- */
  console.log("  2. «1»\n");
  const r2 = await escribir(bot.instance_name, srv.webhook_secret, "1");
  console.log("     HTTP " + r2.status);
  console.log("     CUERPO COMPLETO:");
  console.log("     " + JSON.stringify(r2.cuerpo, null, 1).slice(0, 900));
  console.log("");

  /* ---- 3. Qué contiene el texto ---- */
  const salida = r2.cuerpo;
  const textoRespuesta = (salida && (salida.response || salida.text)) || "";

  console.log("  ── lo que se leería en el teléfono ──\n");
  console.log("    largo: " + textoRespuesta.length + " caracteres");
  console.log("    " + JSON.stringify(textoRespuesta.slice(0, 300)));
  console.log("");

  /* Un horario tiene forma reconocible: dos puntos entre números. */
  const tieneHoras = /\b\d{1,2}:\d{2}\b/.test(textoRespuesta);
  const tienePalabras = /no hay|sin turnos|disponible|libre|agenda|horario/i.test(textoRespuesta);

  console.log("  ¿menciona alguna hora (como 09:00)?   " + (tieneHoras ? "sí" : "NO"));
  console.log("  ¿ Dice algo sobre no haber horarios? " + (tienePalabras ? "sí" : "no dice nada"));
  console.log("");

  /* ---- 4. Lo que hay en la base, con las reglas del bot ---- */
  console.log("  ──────────────────────────────────────────────");
  console.log("  La base, lo que el bot debería estar leyendo:\n");

  const { data: horas } = await db.rpc("ejecutar_sql", {
    consulta:
      "select day_of_week, start_time, end_time, slot_duration_min, is_active " +
      "from bots_business_hours where bot_id = '" + bot.id + "' order by day_of_week",
    args: [],
  });

  if (!horas || !horas.length) {
    console.log("    × NO HAY FRANJAS para este bot.");
    console.log("      Con cero franjas no hay huecos que ofrecer. El bot está");
    console.log("      bien y no hay nada que mostrar.\n");
  } else {
    console.log("    franjas: " + horas.length);
    horas.forEach((h) => {
      console.log("      día " + h.day_of_week + "  " +
        String(h.start_time).slice(0, 5) + "–" + String(h.end_time).slice(0, 5) +
        "  cada " + h.slot_duration_min + "m  " +
        (h.is_active ? "activa" : "INACTIVA"));
    });
    console.log("");
  }

  /* ¿Y para hoy, en el día de la semana que corresponde? */
  const hoy = new Date();
  const diaHoy = hoy.getDay();

  console.log("    hoy es día " + diaHoy + " de la semana.");
  const deHoy = (horas || []).filter((h) => Number(h.day_of_week) === diaHoy);
  console.log("    franjas para hoy: " + deHoy.length);
  console.log("");

  const { data: turnos } = await db.rpc("ejecutar_sql", {
    consulta:
      "select fecha, hora, estado from bots_appointments " +
      "where bot_id = '" + bot.id + "'",
    args: [],
  });
  console.log("    turnos reservados: " + ((turnos || []).length));

  console.log("");
  console.log("  ──────────────────────────────────────────────\n");

  if ((horas || []).length && deHoy.length && !tieneHoras) {
    console.log("  · La base TIENE franjas para hoy y el bot NO las enseña.\n");
    console.log("    El fallo está en el código: lee, y no transforma en huecos,\n");
    console.log("    o filtra por algo que deja la lista vacía.\n");
    console.log("    Con esto, el `db/ver-horarios.js` dice que hay franjas y el\n");
    console.log("    bot dice que no hay. Uno de los dos está mintiendo.\n");
  } else if (!(horas || []).length || !deHoy.length) {
    console.log("  · No hay franjas configuradas para hoy.\n");
    console.log("    El bot no está mintiendo: no hay nada que ofrecer. Y esa es\n");
    console.log("    una decisión de configuración, no un fallo.\n");
    console.log("    Pero el bot debería DECIRLO. Un cliente que escribe «turno»,\n");
    console.log("    ve un menú, contesta «1» y recibe una lista vacía, no vuelve.\n");
  }
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});