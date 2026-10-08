/* Poner el secreto del webhook en una caja.
 *
 * Lee WEBHOOK_SECRET del .env.local del bot (wweb) y lo guarda en
 * `evolution_servers.webhook_secret` para la caja cuya url coincida con
 * EVOLUTION_API_URL.
 *
 * Por qué hace falta: el panel es quien le dice a la Evolution qué
 * cabecera mandar. Ese valor es el mismo que el bot comprueba en cada
 * mensaje, y no estaba en la base. Sin él, el alta de un bot se para con
 * un motivo en vez de dejar un bot mudo.
 *
 *   node db/poner-secreto-webhook.js            informe
 *   node db/poner-secreto-webhook.js --aplicar  lo guarda
 *
 * NO imprime el secreto, ni al aplicarlo.
 */

const fs = require("fs");

function leerEnv(ruta) {
  const out = {};
  if (!fs.existsSync(ruta)) return out;
  for (const l of fs.readFileSync(ruta, "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const APLICAR = process.argv.includes("--aplicar");
const BOT_ENV = process.env.BOT_ENV || "D:/webs/wweb/.env.local";

(async function () {
  const env = leerEnv(BOT_ENV);
  const url = (env.EVOLUTION_API_URL || "").replace(/\/+$/, "");
  const secreto = env.WEBHOOK_SECRET || "";

  console.log("\n═══ Secreto del webhook ═══\n");

  if (!url || !secreto) {
    console.log("  ✗ en " + BOT_ENV + " no está EVOLUTION_API_URL o WEBHOOK_SECRET\n");
    process.exitCode = 1;
    return;
  }

  console.log("  url del bot:  " + url);
  console.log("  url de la caja: " + url);
  console.log("  secreto:      " + secreto.length + " caracteres (no se imprime)\n");

  require("../lib/env").load();
  const db = require("../lib/supabase").getAdmin();

  const { data: cajas, error } = await db.from("evolution_servers").select("id,name,url,webhook_secret");
  if (error) {
    console.log("  ✗ no se pudieron leer las cajas: " + error.message + "\n");
    process.exitCode = 1;
    return;
  }

  const misma = (cajas || []).filter(
    (c) => String(c.url).replace(/\/+$/, "") === url
  );

  if (!misma.length) {
    console.log("  ✗ ninguna caja tiene esa url. Revisa la url del bot.\n");
    console.log("    Las que hay:");
    for (const c of cajas || []) console.log("      " + c.name + "  " + c.url);
    console.log("");
    process.exitCode = 1;
    return;
  }

  for (const c of misma) {
    const yaEsta = c.webhook_secret === secreto;
    console.log(
      "  " + c.name +
        "  " +
        (c.webhook_secret
          ? yaEsta
            ? "ya tiene ese secreto. No se toca."
            : "tiene UN secreto distinto al del bot."
          : "sin secreto.")
    );
    if (yaEsta) continue;

    if (c.webhook_secret && !APLICAR) {
      console.log("      Sobrescribir un secreto que ya existe deja mudos los bots de la caja");
      console.log("      hasta que se vuelva a configurar el webhook. Con --aplicar se hace igual.");
    }

    if (!APLICAR) continue;

    const { error: eUpd } = await db
      .from("evolution_servers")
      .update({ webhook_secret: secreto })
      .eq("id", c.id);

    if (eUpd) {
      console.log("      ✗ no se pudo guardar: " + eUpd.message);
      process.exitCode = 1;
      return;
    }
    console.log("      ✓ guardado");
  }

  if (!APLICAR) {
    console.log("\n  Para aplicarlo:\n    node db/poner-secreto-webhook.js --aplicar\n");
  } else {
    console.log("\n  Los bots que ya viven en la caja tienen el webhook configurado en la");
    console.log("  Evolution con el valor de siempre. Si este secreto es el mismo, no hay");
    console.log("  que volver a tocar nada.\n");
  }
})().catch((e) => {
  console.error("\n  ✗ " + (e && e.message ? e.message : String(e)) + "\n");
  process.exitCode = 1;
});