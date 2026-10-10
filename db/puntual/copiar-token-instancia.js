/* Copiar el token de cada instancia de Evolution a la fila del bot.
   ─────────────────────────────────────────────────────────────
   El token NO se pone en la migración, y hay una razón concreta: la
   caja puede rotarlo. Un token viejo guardado en la base es peor que
   ninguno — el bot usaría uno revocado y fallaría sin explicación
   alguna, y el error aparecería en el envío, lejos de su causa.

   Así que se lee de la caja en el momento y se guarda.

   ── POR QUÉ ESCRIBE ──

   Porque mientras no se escriba, la columna está en NULL y el bot usa la
   clave global: el comportamiento de hoy, sin aislamiento. Con esto, el
   bot empieza a usar el token de su instancia.

   ── EL NÚMERO DE BOTONES, NO DE INSTANCIAS ──

   Un bot tiene una instancia, pero una instancia puede atender a más de
   un bot. Se copia por BOT, no por instancia, que es quien lo usa. */
require("../../lib/env").load();

const db = require("../../lib/supabase").getAdmin();

(async () => {
  const { data: srv, error: eSrv } = await db
    .from("evolution_servers")
    .select("url, api_key")
    .limit(1)
    .single();

  if (eSrv) {
    console.log("\n  x no se pudo leer la caja: " + eSrv.message + "\n");
    process.exit(1);
  }

  const r = await fetch(srv.url + "/instance/fetchInstances", {
    headers: { apikey: srv.api_key },
    signal: AbortSignal.timeout(30000),
  });

  const instancias = await r.json();
  const lista = Array.isArray(instancias) ? instancias : [];

  if (!lista.length) {
    console.log("\n  × la caja no devolvió ninguna instancia. No se copia nada,\n" +
      "    porque una lista vacía y un fallo se parecen y significan\n" +
      "    cosas distintas.\n");
    process.exit(1);
  }

  console.log("\n═══ Copiar el token de cada instancia ═══\n");
  console.log("  instancias en la caja: " + lista.length + "\n");

  const { data: bots, error: eBots } = await db
    .from("bots")
    .select("id, name, instance_name, instance_token");

  if (eBots) {
    console.log("  x no se pudieron leer los bots: " + eBots.message + "\n");
    process.exit(1);
  }

  let copiados = 0;
  let iguales = 0;
  let sinCoincidir = 0;

  for (const b of bots || []) {
    const inst = lista.find((i) => i.name === b.instance_name);

    if (!inst) {
      console.log("  · " + b.name);
      console.log("      no hay ninguna instancia llamada «" + b.instance_name + "»");
      console.log("      Se deja como está: con NULL usa la clave global, que es");
      console.log("      lo que hace hoy. No se adivina a cuál corresponde.\n");
      sinCoincidir++;
      continue;
    }

    if (!inst.token) {
      console.log("  · " + b.name + ": la instancia no trae token\n");
      continue;
    }

    if (b.instance_token === inst.token) {
      console.log("  · " + b.name + ": ya tiene el token correcto");
      iguales++;
      continue;
    }

    const { error: e } = await db
      .from("bots")
      .update({ instance_token: inst.token })
      .eq("id", b.id);

    if (e) {
      console.log("  x " + b.name + ": " + e.message);
      continue;
    }

    console.log("  ✓ " + b.name + ": token copiado (" + inst.token.length + " caracteres)");
    copiados++;
  }

  console.log("");
  console.log("  ──────────────────────────────────────────────");
  console.log("  copiados: " + copiados + "   ya estaban: " + iguales +
    "   sin instancia: " + sinCoincidir);
  console.log("");

  /* ---- Verificar releyendo ---- */
  const { data: finales } = await db.from("bots").select("name, instance_name, instance_token");

  console.log("  estado final:");
  (finales || []).forEach((b) => {
    console.log("    " + String(b.name).padEnd(28) +
      (b.instance_token
        ? "token propio (" + b.instance_token.length + " chars)"
        : "SIN token → usa la clave global"));
  });

  const conToken = (finales || []).filter((b) => b.instance_token).length;

  console.log("");
  console.log(conToken === (finales || []).length
    ? "  ✓ Todos los bots usan el token de su instancia.\n"
    : "  · Hay bots sin token: siguen con la clave global, que funciona pero\n" +
      "    no aísla. No es un error, es el estado anterior.\n");

  console.log("  ──────────────────────────────────────────────");
  console.log("\n  Guardar el token NO cambia el comportamiento todavía: eso lo hace\n" +
    "  el código del bot, que tiene que preferirlo. Con la columna escrita y\n" +
    "  el código viejo, el bot sigue usando la clave global.\n");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});