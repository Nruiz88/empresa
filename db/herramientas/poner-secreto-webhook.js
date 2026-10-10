/* Poner el secreto del webhook y la URL en una caja.
 *
 * Lee WEBHOOK_SECRET del .env.local del bot (wweb) y lo guarda en
 * `evolution_servers.webhook_secret` para la caja cuya url coincida con
 * EVOLUTION_API_URL.
 *
 * Y también la URL del webhook: sale de APP_URL de wweb, que es la
 * dirección pública del Next.js, y ahí está /api/webhook. Si esa caja no
 * tiene `webhook_url` propia, se le pone, para que no dependa de que
 * SITE_URL del panel acierte con el subdominio del bot. Con la URL escrita
 * en la caja, el destino del webhook queda a la vista en el panel y se
 * puede cambiar con un campo, sin tocar variables de entorno.
 *
 * Por qué hace falta: el panel es quien le dice a la Evolution qué
 * cabecera mandar y a qué dirección llamar. El primero es el mismo valor
 * que el bot comprueba en cada mensaje, y no estaba en la base. Sin él,
 * el alta de un bot se para con un motivo en vez de dejar un bot mudo.
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

  /* APP_URL es la dirección pública del Next.js del bot. Puede venir
     como marcador (`tu-dominio.vercel.app`), y en ese caso NO se usa:
     sería escribir un dominio inventado en la caja, que es
     precisamente el fallo que esta columna evita. */
  const appUrl = (env.APP_URL || "").trim();
  const urlMarcador = !appUrl || appUrl.includes("tu-dominio") || appUrl.includes("example");

  const webhook = urlMarcador
    ? ""
    : appUrl.replace(/\/+$/, "") + "/api/webhook";

  console.log("\n═══ Secreto y URL del webhook ═══\n");

  if (!url || !secreto) {
    console.log("  ✗ en " + BOT_ENV + " no está EVOLUTION_API_URL o WEBHOOK_SECRET\n");
    process.exitCode = 1;
    return;
  }

  console.log("  url de la caja: " + url);
  console.log("  secreto:       " + secreto.length + " caracteres (no se imprime)");
  console.log("  url del bot:    " + (appUrl || "(APP_URL no está)"));
  console.log("  webhook:        " + (webhook || "NO SE PUEDE SACAR DE APP_URL"));

  if (urlMarcador) {
    console.log("\n  ⚠  APP_URL sigue siendo un marcador de ejemplo.");
    console.log("     No se va a guardar ninguna URL: una caja que apunte a");
    console.log("     un dominio inventado recibe los mensajes y los tira.");
    console.log("     Pon la URL real del bot en APP_URL (wweb/.env.local) y");
    console.log("     vuelve a ejecutar esto, o ponla a mano en el panel:");
    console.log("     /panel/servidores → Editar → URL del webhook.\n");
  }
  console.log("");

  require("../../lib/env").load();
  const db = require("../../lib/supabase").getAdmin();

  const { data: cajas, error } = await db
    .from("evolution_servers")
    .select("id,name,url,webhook_secret,webhook_url");
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
    const urlYaEsta = c.webhook_url === webhook || (!webhook && !c.webhook_url);

    console.log("  " + c.name);
    console.log(
      "    " +
        (c.webhook_secret
          ? yaEsta
            ? "secreto: ya es el del bot."
            : "secreto: tiene UNO DISTINTO al del bot."
          : "secreto: sin secreto.")
    );
    console.log(
      "    " +
        (c.webhook_url
          ? urlYaEsta
            ? "url: ya es la del bot."
            : "url: " + c.webhook_url + "  (distinta de la del bot)"
          : webhook
            ? "url: sin url propia, usaría la deducida."
            : "url: sin url propia.")
    );

    if (yaEsta && urlYaEsta) continue;

    if (c.webhook_secret && !yaEsta && !APLICAR) {
      console.log("\n      Sobrescribir un secreto que ya existe deja mudos los bots de la caja");
      console.log("      hasta que se vuelva a configurar el webhook. Con --aplicar se hace igual.");
    }

    if (!APLICAR) continue;

    /* Solo se toca lo que cambia. Escribir el secreto otra vez sin
       necesidad lo haría distinto si alguien hubiera escrito un espacio
       al final, sin querer. */
    const cambios = {};
    if (!yaEsta) cambios.webhook_secret = secreto;
    if (!urlYaEsta && webhook) cambios.webhook_url = webhook;

    const { error: eUpd } = await db
      .from("evolution_servers")
      .update(cambios)
      .eq("id", c.id);

    if (eUpd) {
      console.log("    ✗ no se pudo guardar: " + eUpd.message);
      process.exitCode = 1;
      return;
    }

    console.log(
      "    ✓ guardado" +
        (cambios.webhook_url
          ? "  (la url cambió: usa «Reconfigurar los bots» en /panel/servidores para mover los números)"
          : "")
    );
  }

  if (!APLICAR) {
    console.log("\n  Para aplicarlo:\n    node db/poner-secreto-webhook.js --aplicar\n");
  } else {
    console.log("\n  Los bots que ya viven en la caja siguen con el webhook que tienen");
    console.log("  dentro de la Evolution. Si cambió la URL, hay que moverlos:");
    console.log("  /panel/servidores → «Reconfigurar los bots».\n");
  }
})().catch((e) => {
  console.error("\n  ✗ " + (e && e.message ? e.message : String(e)) + "\n");
  process.exitCode = 1;
});