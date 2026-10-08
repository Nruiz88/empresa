/* ¿Qué escribe realmente el bot cuando procesa un webhook?
   ─────────────────────────────────────────────────────────────
   POR QUÉ ESTE SCRIPT

   La prueba del webhook directo DEVUELVE la respuesta del bot en el
   propio cuerpo del HTTP:

       {"status":"success","matched":"horario","response":"Abrimos de
        lunes a viernes de 7:00 a 20:00..."}

   Es decir, el bot funcionó. Pero la comprobación anterior miraba
   `bots_response_logs` y no encontró nada, y se concluyó que el
   webhook no procesó el mensaje.

   Conclusión falsa, por una razón concreta: `bots_response_logs` se
   escribe en el camino de Evolution (cuando el mensaje viene por
   webhook con el cuerpo que manda Evolution), y el mensaje de prueba
   quizá no pase por ese mismo camino, o se descarte antes de llegar
   ahí.

   Este script mira TODAS las tablas donde el bot podría haber
   anotado algo, y dice cuál tiene filas recientes. Así se sabe dónde
   mirar, en vez de asumir.

   ── POR QUÉ ES IMPORTANTE ──

   Porque un script que dice "el bot no respondió" cuando el bot
   acaba de responder es peor que no tener script: entrena a no
   fiarse de la comprobación. Y el cuerpo de la respuesta ya lo decía:
   el bot estaba ahí, contestando. */

require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

(async () => {
  /* Cuándo empieza a mirarse. Diez minutos atrás, para no contar
     como fresco lo que es de antes. */
  const desde = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  console.log("\n═══ Dónde anotó algo el bot ═══\n");
  console.log("  buscando registros de los últimos 10 minutos...\n");

  const tablas = [
    ["bots_response_logs", "select count(*) as c from bots_response_logs where created_at > $1"],
    ["bot_messages", "select count(*) as c from bot_messages where created_at > $1"],
    ["bots_sesiones", "select count(*) as c from bots_sesiones where created_at > $1"],
    ["messages", "select count(*) as c from messages where created_at > $1"],
  ];

  for (const [nombre, consulta] of tablas) {
    try {
      const { data, error } = await db.rpc("ejecutar_sql", { consulta, args: [desde] });

      if (error) {
        console.log("  " + nombre.padEnd(20) + "no existe o no se puede leer");
        continue;
      }

      const c = data && data[0] ? data[0].c : 0;
      console.log("  " + nombre.padEnd(20) + (Number(c) > 0 ? c + " filas recientes" : "0"));
    } catch (e) {
      console.log("  " + nombre.padEnd(20) + "error: " + e.message.split("\n")[0]);
    }
  }

  /* Y las últimas filas de la tabla de logs, que es la que la prueba
     miraba. Con la fecha, para ver si hay algo reciente o si la tabla
     está simplemente quieta. */
  console.log("");
  const { data: ultimos } = await db.rpc("ejecutar_sql", {
    consulta:
      "select created_at, message from bots_response_logs order by created_at desc limit 3",
    args: [],
  });

  console.log("  últimas filas de bots_response_logs:");
  if (!ultimos || !ultimos.length) {
    console.log("    (la tabla está vacía)");
  } else {
    for (const u of ultimos) {
      const fecha = new Date(u.created_at);
      const mins = Math.round((Date.now() - fecha) / 60000);
      console.log("    " + u.created_at + "  (" + mins + " min)  \"" + String(u.message).slice(0, 40) + "\"");
    }
  }

  console.log("");
  console.log("  ─────────────────────────────────────────────────");
  console.log("  Si la tabla de logs está quieta pero el webhook devuelve");
  console.log("  la respuesta en el cuerpo del HTTP, el bot está bien y lo");
  console.log("  que no se escribe el log es una cosa aparte.");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});