/* Emparejar los bots que quedaron sin servicio.
   ─────────────────────────────────────────────
   Dar de alta un bot en /panel/bots creaba el número pero no el
   `services`, así que los clientes con bot quedaron invisibles: sin
   aparecer en Servicios/Aplicaciones y sin verlo en su portal.

   Recorre los bots y, por cada cliente, asegura el servicio con la
   MISMA función que ahora usa el alta (lib/bots.asegurarServicioDeBot),
   así que es idempotente: repetirlo no duplica y no toca a quien ya
   tiene un servicio (suelto o por plan) que da el bot. */
require("../../lib/env").load();
const db = require("../../lib/supabase").getAdmin();
const botsLib = require("../../lib/bots");

(async () => {
  console.log("\n═══ Encadenar bots sin servicio ═══\n");

  const { data: bots } = await db
    .from("bots")
    .select("client_id,instance_name,clients(empresa,nombre)");

  const porCliente = new Map();
  for (const b of bots || []) {
    if (!porCliente.has(b.client_id)) porCliente.set(b.client_id, b);
  }

  console.log("  bots: " + (bots || []).length + "  ·  clientes distintos: " + porCliente.size + "\n");

  let creados = 0;
  let yaTenia = 0;
  let fallos = 0;

  for (const [clientId, b] of porCliente) {
    const cl = Array.isArray(b.clients) ? b.clients[0] : b.clients;
    const nombre = cl ? cl.empresa || cl.nombre : clientId.slice(0, 8);

    const r = await botsLib.asegurarServicioDeBot(db, clientId);
    if (r.creado) {
      console.log("  ✓ " + nombre + ": servicio creado");
      creados++;
    } else if (r.yaTenia) {
      console.log("  · " + nombre + ": ya tenía servicio");
      yaTenia++;
    } else {
      console.log("  x " + nombre + ": " + r.motivo);
      fallos++;
    }
  }

  console.log("\n  creados: " + creados + "   ya tenían: " + yaTenia + "   fallos: " + fallos + "\n");
})().catch((e) => {
  console.error("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});
