/* ¿Cuánto usa el bot, y alcanza con el plan gratuito de Redis?
   ─────────────────────────────────────────────────────────────
   La pregunta era si Upstash costaba algo. Se mide en vez de suponer:
   el plan gratuito da 10.000 peticiones al día, y si el bot no llega a
   unas decenas, la pregunta del costo desaparece sola.

   ── LO QUE CUENTA ──

   Cada mensaje que entra NO es una petición a Redis. Un flujo de turnos
   hace unas pocas: marcar el menú activo, guardar la fecha pendiente,
   leerlas al elegir. Un mensaje suelto que no abre ningún flujo no toca
   Redis en absoluto.

   Se cuentan los webhooks de un día, que es lo de arriba por lo menos:
   el gasto real es una fracción de eso. */
require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

const GRATIS = 10000;

(async () => {
  console.log("\n═══ ¿Cuánto usa el bot? ═══\n");

  const { data: dia, error } = await db.rpc("ejecutar_sql", {
    consulta:
      "select count(*) as c from bots_webhook_logs " +
      "where created_at > now() - interval '1 day'",
    args: [],
  });

  if (error) {
    console.log("  x no se pudo contar: " + error.message + "\n");
    process.exit(1);
  }

  const webhooks = Number(dia && dia[0] ? dia[0].c : 0);

  /* De los webhooks, cuántos fueron de verdad mensajes (los que pueden
     abrir un flujo) y cuántos son solo actualizaciones de estado. */
  const { data: porTipo } = await db.rpc("ejecutar_sql", {
    consulta:
      "select event_type, count(*) as c from bots_webhook_logs " +
      "where created_at > now() - interval '1 day' group by event_type",
    args: [],
  });

  console.log("  llamadas al webhook en 24 h: " + webhooks);
  (porTipo || []).forEach((t) => {
    console.log("    " + String(t.event_type || "(sin nombre)").padEnd(24) + t.c);
  });

  /* Estimación al revés: se cuenta como máximo una petición de Redis por
     webhook, aunque los updates de estado no tocan Redis. Es una
    estimate deliberadamente alta. */
  console.log("");
  console.log("  ──────────────────────────────────────────────────");
  console.log("");
  console.log("  Peor caso: una petición de Redis por webhook.");
  console.log("    " + webhooks + " / día, con un tope de " + GRATIS + " gratis.");
  console.log("");
  console.log("  Real: mucho menos. Un update de estado no toca Redis, y un");
  console.log("  mensaje suelto que no abre flujo tampoco. Solo lo que abre");
  console.log("  agenda: marcar el menú, guardar la fecha, leerlas al elegir.");
  console.log("");

  const margen = Math.floor(GRATIS / Math.max(webhooks, 1));

  if (webhooks === 0) {
    console.log("  Ahora mismo no hay tráfico. El plan gratuito alcanza de sobra.");
  } else if (margen >= 20) {
    console.log("  Margen: " + margen + "×. Aguantaría hasta " +
      webhooks * 20 + " mensajes al día con lo que hay, gratis.");
  } else {
    console.log("  Margen: " + margen + "×. Aguantaría unos " +
      webhooks * 20 + " mensajes al día. Con un panadero es de sobra;");
    console.log("  si mañana hay veinte clientes, se revisa.");
  }
  console.log("");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});