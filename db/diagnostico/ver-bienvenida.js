require("../../lib/env").load();

const db = require("../../lib/supabase").getAdmin();

/* ¿El bot está configurado para mandar DOS mensajes en el primero?

   `handleWelcome` manda la bienvenida y devuelve `null` con el
   comentario "Welcome never blocks the chain". O sea, no corta: el
   flujo sigue y, si la palabra del mensaje case con una respuesta
   automática, `handleAutoReply` manda OTRO mensaje.

   Que eso esté bien o mal depende de una cosa: si este bot tiene
   mensaje de bienvenida puesto. Sin él no hay doble nada.

   Y depende también de si quien escribió primero ya tiene historial,
   porque la bienvenida solo se manda a los que no lo tienen. */

(async () => {
  console.log("\n═══ ¿Primer mensaje, uno o dos? ═══\n");

  const { data: bots, error } = await db.rpc("ejecutar_sql", {
    consulta:
      "select instance_name, " +
      "coalesce(welcome_message, '(sin mensaje de bienvenida)') as bienvenida, " +
      "coalesce(outside_hours_message, '(sin mensaje de horario)') as fuera_de_horario, " +
      "(select count(*) from bots_responses r where r.bot_id = b.id and r.is_active) as respuestas, " +
      "(select count(*) from bots_response_logs l where l.bot_id = b.id) as conversations " +
      "from bots b",
    args: [],
  });

  if (error) {
    console.log("  x " + error.message + "\n");
    process.exit(1);
  }

  for (const b of bots || []) {
    console.log("  instancia: " + b.instance_name);
    console.log("  bienvenida: " + b.bienvenida.slice(0, 70));
    console.log("  fuera de horario: " + b.fuera_de_horario.slice(0, 50));
    console.log("  respuestas activas: " + b.respuestas);
    console.log("  conversaciones ya registradas: " + b.conversations);
    console.log("");

    if (b.bienvenida.startsWith("(sin")) {
      console.log("  · No hay mensaje de bienvenida. No hay doble respuesta.");
      console.log("    La línea `return null` no hace daño, porque antes de ella");
      console.log("    ya se sale por `if (!instance.welcome_message) return null`.\n");
    } else {
      console.log("  · SÍ hay mensaje de bienvenida.");
      console.log("    Con este bot, un cliente NUEVO que escriba «horario» recibe:");
      console.log("      1. la bienvenida");
      console.log("      2. el horario");
      console.log("    Dos mensajes. Puede ser justo lo que se quiere, y también");
      console.log("    puede ser ruido. Es una decisión de producto, no un bug.\n");
      console.log("    Lo que SÍ sería un bug: que la bienvenida saliera cada vez.\n");
    }

    /* El caso que sí importaría: ¿se repite? La bienvenida salta si ya
       hay un log para ese teléfono. */
    const { data: porPhone } = await db.rpc("ejecutar_sql", {
      consulta:
        "select incoming_phone, count(*) as n, min(created_at) as primera, max(created_at) as ultima " +
        "from bots_response_logs group by incoming_phone order by n desc limit 5",
      args: [],
    });

    console.log(" Teléfonos con más conversaciones:");
    (porPhone || []).forEach((p) => {
      console.log("    " + String(p.n).padStart(4) + " mensajes   " + String(p.incoming_phone).slice(0, 28));
    });
  }
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});