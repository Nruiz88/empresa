/* ¿El estado de un flujo sobrevive a un reinicio?
   ─────────────────────────────────────────────────────────────
   La prueba que importa, y la única que importa.

   El fallo original: escribís «turno», el bot te muestra el menú, se
   reinicia, escribís «1», y no pasa nada. Porque el estado del menú
   vivía en un Map de memoria del proceso.

   Con Redis el estado está afuera del proceso. Un reinicio lo mata y no
   lo toca.

   ── POR QUÉ NO BASTA CON VER QUE HAY REDIS ──

   Porque tener Redis y usarlo son dos cosas. `upstash_redis: true`
   dice que la variable está en el entorno. No dice que el código la
   use, ni que la use en el camino correcto.

   Y hay un modo de fallo muy silencioso: que el Map siga siendo el
   que manda y Redis esté de adorno. En ese caso `upstash_redis` dice
   `true`, los flujos se siguen cortando, y nadie se entera.

   ── LA PRUEBA ──

     1. Escribir «turno»      → el bot marca el menú activo
     2. Reiniciar el bot      → el proceso muere y vuelve
     3. Escribir «1»          → tiene que traer los horarios igual

   El paso 2 es el que importa. Sin él, el flujo entero funciona con
   una instancia sola y no se prueba nada.

   ── POR QUÉ ESCRIBE A SU NÚMERO Y NO AL PROPIO ──

   Porque Evolution filtra los mensajes que la instancia se manda a sí
   misma. El número de esta prueba es el segundo teléfono, que es como
   un cliente de verdad. */
require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

const API = "https://bot.shopcito.com.ar";
const NUMERO = process.env.TEST_NUMERO || "5492996733077";

/** Escribe un mensaje al bot como si fuera el cliente. */
async function escribir(instancia, secreto, texto) {
  const r = await fetch(API + "/api/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-secret": secreto },
    body: JSON.stringify({
      event: "MESSAGES_UPSERT",
      instance: instancia,
      data: {
        key: { remoteJid: NUMERO + "@s.whatsapp.net", fromMe: false, id: "REDIS-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7) },
        pushName: "Prueba Redis",
        message: { conversation: texto },
      },
    }),
    signal: AbortSignal.timeout(30000),
  });

  return { status: r.status, cuerpo: await r.json().catch(() => null) };
}

const args = process.argv.slice(2);
const paso = args[0];

(async () => {
  const { data: srv } = await db
    .from("evolution_servers")
    .select("webhook_secret")
    .limit(1)
    .single();

  const { data: bot } = await db.from("bots").select("instance_name, name").limit(1).single();

  if (paso === "turno") {
    console.log("\n═══ Paso 1: «turno» ═══\n");
    const r = await escribir(bot.instance_name, srv.webhook_secret, "turno");
    console.log("  HTTP " + r.status);
    console.log("  " + JSON.stringify(r.cuerpo).slice(0, 300));
    console.log("\n  El menú quedó marcado. Ahora hay que REINICIAR el bot:");
    console.log("    node db/coolify.js redesplegar qdzppwwo50bs7bx3fnvfbvst\n");
    console.log("  Y cuando termine, el paso 2:\n");
    console.log("    node db/probar-estado-tras-reinicio.js uno\n");
    return;
  }

  if (paso === "uno") {
    console.log("\n═══ Paso 3: «1», después del reinicio ═══\n");

    const { data: filas } = await db.rpc("ejecutar_sql", {
      consulta:
        "select created_at, status, event_type, payload->>'text' as texto, " +
        "payload->>'matched' as matched, payload->>'status' as estado " +
        "from bots_webhook_logs order by created_at desc limit 6",
      args: [],
    });

    console.log("  ── lo que registró el bot ──\n");
    (filas || []).forEach((f) => {
      console.log("    " + String(f.created_at).slice(11, 19) + "  " +
        String(f.texto || "(sin texto)").padEnd(10) +
        "matched=" + (f.matched || "-"));
    });
    console.log("");

    const r = await escribir(bot.instance_name, srv.webhook_secret, "1");
    console.log("  HTTP " + r.status);
    console.log("  " + JSON.stringify(r.cuerpo).slice(0, 300));
    console.log("");

    const ok = r.cuerpo && r.cuerpo.status === "success" && r.cuerpo.matched;

    console.log("  ──────────────────────────────────────────────\n");
    if (ok) {
      console.log("  ✓ EL FLUJO SOBREVIVIÓ AL REINICIO.\n");
      console.log("    El estado estaba en Redis, no en la memoria del proceso.\n");
      console.log("    El «1» trajo los horarios después de que el bot se apagara");
      console.log("    y volviera. Eso era exactamente lo que fallaba.\n");
    } else {
      console.log("  × EL FLUJO SE ROMPIÓ.\n");
      console.log("    Con `upstash_redis: true` y el flujo roto, la causa NO es que");
      console.log("    falte Redis: es que el código no lo está usando, o lo usa");
      console.log("    para una cosa y el menú se guarda en otro sitio.\n");
      console.log("    Un Map de memoria al lado de un Redis configurado es la");
      console.log("    forma más difícil de detectar: el panel dice que todo está");
      console.log("    bien y los flujos se siguen cortando.\n");
    }
    return;
  }

  console.log("\n  Uso:\n");
  console.log("    node db/probar-estado-tras-reinicio.js turno   → antes de reiniciar");
  console.log("    node db/probar-estado-tras-reinicio.js uno     → después de reiniciar\n");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});