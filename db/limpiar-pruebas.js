/* Borra los usuarios y clientes que dejan los tests al fallar.
   Los tests crean datos reales; si uno peta a mitad, se quedan ahí y
   la siguiente ejecución falla con "already registered". */
const supabase = require("../lib/supabase");
require("../lib/env").load();
const db = supabase.getAdmin();

const MARCAS = [
  "-test-modulos-",
  "-test-aisla",
  "-test-generar",
  "-test-mi-cuenta",
  "-test-perfil-",
  "-test-acceso-servicio-",
  "-test-tickets-",
  "-test-bot-",
];

/* Prefijos de los slugs de prueba de los bots.

   Van aparte de MARCAS porque NO comparten forma: MARCA empieza por
   guion (para no colisionar con emails reales) y el patrón de
   bots.slug exige que el primer carácter sea alfanumérico, así que el
   slug usa "tbot". Por eso buscar MARCAS en los slugs no encuentra
   nada. */
const SLUGS = ["tbot"];

(async () => {
  let n = 0;

  /* Bots por slug. Se borran ANTES que los clientes: bots.client_id va
     con ON DELETE CASCADE, pero conviene no depender de la cascada
     para limpiar, porque si un borrado falla a medias la cascada se
     lleva por delante datos que no son del test. Cada borrado reporta
     su error en vez de tragárselo. */
  for (const prefijo of SLUGS) {
    const { data: bots } = await db.from("bots").select("id").like("slug", prefijo + "%");
    for (const b of bots || []) {
      for (const t of ["bots_appointments", "bots_responses", "bots_business_hours", "bots_catalog_items", "bots_response_logs", "bots_orders"]) {
        const { error } = await db.from(t).delete().eq("bot_id", b.id);
        if (error) console.error("  (aviso: " + t + " -> " + error.message + ")");
      }
      const { error } = await db.from("bots").delete().eq("id", b.id);
      if (error) console.error("  (aviso: bot " + b.id.slice(0, 8) + " -> " + error.message + ")");
      else {
        console.log("  bot borrado: " + b.id.slice(0, 8));
        n++;
      }
    }
  }

  /* Servidores de Evolution de prueba: nombre con la marca. */
  {
    const { data: servidores } = await db.from("evolution_servers").select("id").ilike("name", "%test-bot%");
    for (const s of servidores || []) {
      const { error } = await db.from("evolution_servers").delete().eq("id", s.id);
      if (error) console.error("  (aviso: servidor -> " + error.message + ")");
      else {
        console.log("  servidor de Evolution borrado: " + s.id.slice(0, 8));
        n++;
      }
    }
  }

  /* Usuarios de Auth */
  for (let p = 1; p <= 10; p++) {
    const { data, error } = await db.auth.admin.listUsers({ page: p, perPage: 200 });
    if (error) break;
    for (const u of data.users || []) {
      const email = String(u.email || "").toLowerCase();
      if (MARCAS.some((m) => email.includes(m))) {
        await db.auth.admin.deleteUser(u.id);
        console.log("  usuario borrado: " + email);
        n++;
      }
    }
    if (!(data.users || []).length) break;
  }

  /* Clientes y suscripciones */
  for (const m of MARCAS) {
    const { data: clientes } = await db.from("clients").select("id").ilike("empresa", "%" + m + "%");
    for (const c of clientes || []) {
      for (const t of ["suscripciones", "services"]) {
        const { error } = await db.from(t).delete().eq("client_id", c.id);
        if (error) console.error("  (aviso: " + t + " del cliente " + c.id.slice(0, 8) + " -> " + error.message + ")");
      }
      const { error } = await db.from("clients").delete().eq("id", c.id);
      if (error) {
        console.error("  (aviso: cliente " + c.id.slice(0, 8) + " -> " + error.message + ")");
      } else {
        console.log("  cliente borrado: " + m);
        n++;
      }
    }
  }

  console.log(n ? "\n✓ " + n + " cosa(s) borrada(s)\n" : "\nNo había nada que limpiar\n");
  process.exit(0);
})().catch((e) => {
  console.error("✗ " + e.message);
  process.exit(1);
});
