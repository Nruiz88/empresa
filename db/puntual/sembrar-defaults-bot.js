/* Sembrar respuestas y horarios por defecto en los bots que ya existen.
   ─────────────────────────────────────────────────────────────────
   Los bots creados desde el panel quedaron con 0 respuestas y sin
   horarios, así que no contestaban nada y "turno" respondía "todavía no
   hay horarios cargados". Esto corre la MISMA función que ahora usa el
   alta (`lib/bots.sembrarDefaultsDelBot`), que agrega solo lo que falta:
   repetirlo no duplica ni pisa lo que el cliente haya editado. */
require("../../lib/env").load();
const db = require("../../lib/supabase").getAdmin();
const botsLib = require("../../lib/bots");

(async () => {
  console.log("\n═══ Sembrar defaults por defecto ═══\n");

  const { data: bots } = await db
    .from("bots")
    .select("id,name,clients(empresa,nombre)");

  for (const b of bots || []) {
    const cl = Array.isArray(b.clients) ? b.clients[0] : b.clients;
    const negocio = (cl && (cl.empresa || cl.nombre)) || b.name;
    const r = await botsLib.sembrarDefaultsDelBot(db, b.id, { negocio });
    console.log(
      "  " + String(b.name).padEnd(18) + " +" + r.respuestas + " respuestas, +" + r.horarios + " horarios"
    );
  }

  console.log("");
})().catch((e) => {
  console.error("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});
