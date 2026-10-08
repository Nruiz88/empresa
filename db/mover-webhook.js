/* Cambia la URL del webhook de una caja y reconfigura sus bots.

   node db/mover-webhook.js https://bot.shopcito.com.ar/api/webhook

   Hace tres cosas, en este orden y parando en la primera que falle:

     1. Guarda la URL en la caja (`webhook_url`).
     2. Comprueba que la caja responde y que la Evolution tiene esa
        URL configurada en el bot.
     3. Vuelve a guardarla, que es lo que mueve los números que ya
        estuvieran apuntando a otro sitio.

   El paso 3 es el que importa: la URL vive DENTRO de cada instancia de
   Evolution, así que guardar en la base no cambia nada por sí solo. */

require("../lib/env").load();

const supabase = require("../lib/supabase");
const bots = require("../lib/bots");
const evolution = require("../lib/evolution");

const nuevaUrl = process.argv[2];

if (!nuevaUrl) {
  console.log("\n  falta la URL de destino\n");
  process.exit(1);
}

const problema = bots.problemaDeUrlWebhook(nuevaUrl);
if (problema) {
  console.log("\n  x " + problema + "\n");
  process.exit(1);
}

(async () => {
  const db = supabase.getAdmin();

  const { data: cajas, error } = await db
    .from("evolution_servers")
    .select("id,name,url,api_key,webhook_secret,webhook_url");

  if (error) {
    console.log("\n  x " + error.message + "\n");
    process.exit(1);
  }

  console.log("\n═══ Mover el webhook ═══\n");
  console.log("  destino: " + nuevaUrl + "\n");

  for (const caja of cajas) {
    if (!caja.webhook_secret) {
      console.log("  x " + caja.name + ": sin secreto del webhook. No se toca.\n");
      process.exit(1);
    }

    const antes = caja.webhook_url || "(la deducida del dominio)";
    console.log("  " + caja.name);
    console.log("    antes:  " + antes);
    console.log("    ahora:  " + nuevaUrl);

    /* ── 1. Guardar ── */
    const { error: eUpd } = await db
      .from("evolution_servers")
      .update({ webhook_url: nuevaUrl })
      .eq("id", caja.id);

    if (eUpd) {
      console.log("    x no se pudo guardar: " + eUpd.message);
      process.exit(1);
    }
    console.log("    guardado en la base");

    /* ── 2. Lo que tiene la Evolution AHORA, antes de tocar nada ──
       Se pregunta primero para poder comparar. Sin esto, si el
       reconfigurado va mal no hay forma de saber si es que la Evolution
       no acepta el cambio o si nunca se llegó a leer. */
    const { data: lista } = await db
      .from("bots")
      .select("id,name,instance_name,status")
      .eq("server_id", caja.id);

    if (!lista || !lista.length) {
      console.log("    no hay bots en esta caja: no hay nada que reconfigurar\n");
      continue;
    }

    const antesDeCambiar = [];

    for (const b of lista) {
      const leido = await evolution.leerWebhook(caja.url, caja.api_key, b.instance_name);
      const cfg = leido.ok ? leido.data || {} : {};
      const eventos = Array.isArray(cfg.events) ? cfg.events : [];
      antesDeCambiar.push({
        nombre: b.name,
        instancia: b.instance_name,
        url: cfg.url || "(sin url)",
        eventos: eventos.length,
        tieneUrl: cfg.webhook === true,
      });
      console.log(
        "    " + b.name.padEnd(28) +
          "apunta a " + String(cfg.url || "(sin url)").padEnd(46) +
          "eventos: " + eventos.length
      );
    }

    /* ── 3. Reconfigurar ── */
    const cabeceras = bots.cabecerasDeWebhook(caja);
    let hechos = 0;
    const fallos = [];

    for (const b of lista) {
      const r = await evolution.engancharWebhook(
        caja.url,
        caja.api_key,
        b.instance_name,
        nuevaUrl,
        cabeceras
      );
      if (r.ok) {
        hechos++;
      } else {
        fallos.push(b.name + ": " + r.mensaje);
      }
    }

    console.log("    reconfigurados: " + hechos + "/" + lista.length);
    for (const f of fallos) console.log("    x " + f);

    /* ── 4. Releer para confirmar ──
       Que el POST haya devuelto 200 no prueba que esté. Se vuelve a
       preguntar a la Evolution, que es la única que sabe la verdad. */
    console.log("\n    comprobacion (lo que tiene la Evolution ahora):");
    let bien = 0;
    for (const b of lista) {
      const leido = await evolution.leerWebhook(caja.url, caja.api_key, b.instance_name);
      const cfg = leido.ok ? leido.data || {} : {};
      const eventos = Array.isArray(cfg.events) ? cfg.events.map((e) => String(e).toUpperCase()) : [];
      const ok =
        cfg.webhook === true &&
        (cfg.url || "") === nuevaUrl &&
        cfg.byEvents === true &&
        eventos.includes("MESSAGES_UPSERT");

      if (ok) bien++;
      console.log(
        "      " + (ok ? "✓" : "x") + " " + b.name.padEnd(28) +
          (cfg.url || "(sin url)") +
          (eventos.includes("MESSAGES_UPSERT") ? "  MESSAGES_UPSERT" : "  SIN MESSAGES_UPSERT")
      );
    }

    console.log("\n    " + bien + "/" + lista.length + " con el webhook correcto\n");

    if (fallos.length || bien !== lista.length) {
      console.log("  ATENCIÓN: hay bots que no quedaron bien. Avisa antes de dar por hecho que el bot funciona.\n");
      process.exitCode = 1;
    }
  }
})().catch((err) => {
  console.error("\n  x " + (err && err.message ? err.message : err) + "\n");
  process.exitCode = 1;
});