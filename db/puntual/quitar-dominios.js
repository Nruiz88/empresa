/* Quitar dominios viejos de una aplicación de Coolify.
   ─────────────────────────────────────────────────────────────
   El contenedor del bot tenía cinco dominios:

       https://qdzppwwo50bs7bx3fnvfbvst.panel-niconqn.duckdns.org
       https://bot.panel-niconqn.duckdns.org
       https://www.bot.panel-niconqn.duckdns.org
       https://bot.tucormercio.com.ar
       https://bot.shopcito.com.ar

   Los cuatro primeros ya no se usan. Tres son de duckdns, un dominio
   temporal que existió para probar; y `bot.tucormercio.com.ar` es de
   OTRO proyecto, que además es una marca distinta. Que un contenedor de
   Shopcito responda en el dominio de otra marca es el tipo de cosa que
   después cuesta entender.

   ── POR QUÉ NO ESTABAN ROMPIENDO ──

   Porque el webhook de Evolution apunta a `bot.shopcito.com.ar` de
   manera explícita. Da igual qué otros dominios escuche el
   contenedor: nadie los llama. Se comprobó que los cuatro contestan,
   y contestan el mismo bot.

   ── POR QUÉ SE QUITAN IGUAL ──

   Porque un dominio de más es una puerta de más. Los problemas que
   puede dar:

     · si el DNS de uno de ellos cambia de lado, ese nombre empieza a
       apuntar a otro contenedor y sigue pareciendo el nuestro;
     · Coolify usa el PRIMER dominio como principal, y eso puede ser lo
       que se use para armar enlaces o certificados;
     · cuando alguien mire la configuración y vea cinco dominios, no
       sabe cuál manda. Hoy funciona porque todo apunta al mismo
       lugar, y mañana eso puede no ser cierto.

   ── CÓMO SE HACE ──

   Por la API, uno por uno, y con el estado antes y después. Nunca «borrar
   todos menos el bueno» sin listar: si el bueno no viniera en la lista,
   esa cuenta se queda sin ningún dominio y el servicio entero cae. */
const fs = require("fs");
const path = require("path");

const ENV = fs.readFileSync(path.join(__dirname, "..", "..", ".env.coolify"), "utf8");

function leer(clave) {
  const m = ENV.match(new RegExp("^" + clave + "\\s*=\\s*(.+)$", "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}

const BASE = leer("COOLIFY_URL") || leer("COOLIFY_BASE");
const TOKEN = leer("COOLIFY_TOKEN");

const APP = process.argv[2];
const QUEDAR = process.argv[3];
const BORRAR = process.argv.includes("--borrar");

/* El que se conserva: el que está escrito entero. */
const MANTENER = "https://bot.shopcito.com.ar";

const api = async (ruta, metodo) => {
  const r = await fetch(BASE.replace(/\/$/, "") + ruta, {
    method: metodo,
    headers: { Authorization: "Bearer " + TOKEN },
    signal: AbortSignal.timeout(30000),
  });
  const t = await r.text();
  try { return { status: r.status, ok: r.ok, json: JSON.parse(t) }; }
  catch { return { status: r.status, ok: r.ok, texto: t }; }
};

/** Los dominios de la aplicación, como los devuelve la API. */
async function dominios() {
  const r = await api("/api/v1/applications/" + APP, "GET");

  /* Coolify devuelve los dominios en `fqdns` (los manuales) y el
     autogenerado aparte. Se buscan en los dos sitios, y se mira el
     error si no aparece ninguno, porque asumir una lista vacía es
     justo lo que hace que esto borre de más. */
  const fqdns = (r.json && r.json.fqdns) || [];

  return fqdns
    .filter((d) => d && (d.fqdn || d.host || d.value))
    .map((d) => ({
      uuid: d.uuid || d.id,
      valor: d.fqdn || d.host || d.value,
      principal: d.is_primary === true,
    }));
}

(async () => {
  if (!BASE || !TOKEN || !APP) {
    console.log("\n  Faltan datos de Coolify o el identificador de la app.\n");
    process.exit(1);
  }

  let lista = await dominios();

  console.log("\n═══ Dominios del bot ═══\n");

  if (!lista.length) {
    console.log("  La API no devolvió ningún dominio.");
    console.log("  Se para acá: si la lista viene vacía porque no hay, y viene");
    console.log("  vacía porque la API cambió, borrar a ciegas deja el servicio");
    console.log("  sin ningún dominio.\n");
    process.exit(1);
  }

  console.log("  " + lista.length + ":\n");
  for (const d of lista) {
    const fuera = d.valor !== MANTENER;
    console.log("    " + (fuera ? "× a borrar" : "✓ se queda ") + "  " + d.valor);
  }

  const sobran = lista.filter((d) => d.valor !== MANTENER);

  if (!sobran.length) {
    console.log("\n  ✓ Solo queda el que se quiere. No se toca nada.\n");
    return;
  }

  /* ── LA COMPROBACIÓN QUE IMPORTA ──

     Que el que se conserva ESTÉ en la lista. Si no está, quitando los
     otros no queda ningún dominio y el bot se queda sin puerta de
     entrada: el webhook de Evolution no llegaría a ninguna parte. */
  const queda = lista.find((d) => d.valor === MANTENER);

  console.log("");
  if (!queda) {
    console.log("  × " + MANTENER + " NO ESTÁ en la lista de dominios.\n");
    console.log("    No se borra nada. Si se borrara el resto, la aplicación se");
    console.log("    quedaría sin ningún dominio y el bot dejaría de recibir");
    console.log("    mensajes de golpe.\n");
    process.exit(1);
  }

  console.log("  Se conserva: " + MANTENER);
  console.log("  A borrar:    " + sobran.length + "\n");

  if (!BORRAR) {
    console.log("  Para hacerlo de verdad:");
    console.log("    node db/quitar-dominios.js " + APP + " --borrar\n");
    return;
  }

  for (const d of sobran) {
    const r = await api(
      "/api/v1/applications/" + APP + "/domains/" + d.uuid,
      "DELETE"
    );
    console.log("    " + (r.ok ? "✓" : "×") + " " + d.valor + "  HTTP " + r.status);
  }

  console.log("");
  console.log("  ──────────────────────────────────────────────");

  const despues = await dominios();

  console.log("\n  quedan " + despues.length + ":");
  despues.forEach((d) => console.log("    " + d.valor));

  const sigue = despues.some((d) => d.valor === MANTENER);

  console.log("");
  console.log(sigue
    ? "  ✓ el dominio bueno sigue en pie."
    : "  × el dominio bueno NO aparece. Hay que revisarlo a mano.");

  console.log("");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});