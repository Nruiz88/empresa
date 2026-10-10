/* Sacar variables duplicadas de una aplicación de Coolify.
   ─────────────────────────────────────────────────────────────
   Pasaron 17 variables y había 17, con dos `UPSTASH_REDIS_REST_URL`.

   ── POR QUÉ PASÓ ──

   El script que las puso comprueba antes si ya existen, para no
   duplicarlas. Pero esa comprobación leía las variables de un sitio
   que no las devolvía, así que veía cero, creía que no estaban, y las
   volvía a escribir. Correrlo dos veces = duplicado.

   ── POR QUÉ ES PEOR DE LO QUE PARECE ──

   Coolify no avisa de que hay dos variables con el mismo nombre. Las
   lee en orden y gana la última. Entonces:

     · ahora no pasa nada, porque las dos tienen el mismo valor;
     · el día que una se cambie desde el panel, la de arriba y la de
       abajo dejan de coincidir, y cuál gana depende de un orden que
       nadie recuerda.

   Y un despliegue con esto dentro es una lotería: puede agarrar la
   vieja o la nueva, y no hay forma de saber de antemano.

   ── POR QUÉ NO SE BORRA A LO BRUTO ──

   Porque se borra UN duplicado, no la variable. Si se borran las dos, o
   si se borra la que quedó y no la otra, el resultado es el mismo
   desastre con más pasos. Se comparan antes y después y se verifica
   que queda una y solo una. */
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

const api = async (ruta, metodo, cuerpo) => {
  const r = await fetch(BASE.replace(/\/$/, "") + ruta, {
    method: metodo,
    headers: {
      Authorization: "Bearer " + TOKEN,
      ...(cuerpo ? { "Content-Type": "application/json" } : {}),
    },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  const t = await r.text();
  try { return { status: r.status, ok: r.ok, json: JSON.parse(t) }; }
  catch { return { status: r.status, ok: r.ok, texto: t }; }
};

(async () => {
  if (!BASE || !TOKEN || !APP) {
    console.log("\n  Faltan datos de Coolify o el identificador de la app.\n");
    process.exit(1);
  }

  const listar = async () => {
    const r = await api("/api/v1/applications/" + APP + "/envs", "GET");
    const lista = Array.isArray(r.json) ? r.json : (r.json && Array.isArray(r.json.data) ? r.json.data : []);
    return lista;
  };

  let vars = await listar();

  /* Si esta ruta no devuelve la lista, se usa la del listado completo,
     que es la que ya se sabe que funciona. */
  if (!vars.length) {
    const app = await api("/api/v1/applications/" + APP, "GET");
    vars = (app.json && app.json.envs) || [];
  }

  console.log("\n═══ Variables duplicadas ═══\n");
  console.log("  total: " + vars.length + "\n");

  /* Se agrupa por nombre. */
  const porNombre = new Map();
  for (const v of vars) {
    const n = v.name || v.key || "?";
    if (!porNombre.has(n)) porNombre.set(n, []);
    porNombre.get(n).push(v);
  }

  let encontrados = 0;

  for (const [nombre, lista] of porNombre) {
    if (lista.length < 2) continue;
    encontrados++;

    console.log("  ! " + nombre + "  aparece " + lista.length + " veces:");

    /* Si los valores son distintos, esto ya no es un desatino: es un
       conflicto, y hay que decirlo con todas las letras. */
    const valores = [...new Set(lista.map((v) => v.value))];
    if (valores.length > 1) {
      console.log("    Y TIENEN VALORES DISTINTOS. Gana la última, y cuál es");
      console.log("    la última depende del orden. Eso no se arregla solo: hay");
      console.log("    que decidir cuál se quiere conservar.");
      lista.forEach((v, i) => {
        console.log("      " + (i + 1) + ") " + v.uuid + "  (" + String(v.value).length + " caracteres)");
      });
      console.log("");
      continue;
    }

    lista.forEach((v, i) => {
      console.log("      " + (i + 1) + ") " + v.uuid + "  (" + String(v.value).length + " caracteres)");
    });

    /* Se borran todas menos la primera. */
    for (const sobra of lista.slice(1)) {
      const r = await api(
        "/api/v1/applications/" + APP + "/envs/" + sobra.uuid,
        "DELETE"
      );
      console.log("      borrada " + sobra.uuid + "  HTTP " + r.status);
    }
  }

  if (!encontrados) {
    console.log("  ✓ No hay duplicadas.\n");
    return;
  }

  /* ---- Verificar ---- */
  console.log("");
  console.log("  ──────────────────────────────────────────────\n");

  let despues = await listar();
  if (!despues.length) {
    const app = await api("/api/v1/applications/" + APP, "GET");
    despues = (app.json && app.json.envs) || [];
  }

  const nombres = despues.map((v) => v.name || v.key);
  const repetidos = [...new Set(nombres.filter((n, i) => nombres.indexOf(n) !== i))];

  console.log("  ahora hay " + despues.length + " variables");

  if (repetidos.length) {
    console.log("  × siguen los duplicados: " + repetidos.join(", ") + "\n");
    process.exit(1);
  }

  console.log("  ✓ no hay ninguna repetida");
  console.log("  ✓ sigue estando " + nombres.filter((n) => n.startsWith("UPSTASH")).length +
    " variable(s) de Upstash\n");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});