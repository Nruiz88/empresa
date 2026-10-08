/* Poner las variables de Upstash en el bot, dentro de Coolify.
   ─────────────────────────────────────────────────────────────
   Van como variables de entorno y no en el código, por dos razones:
   el token no debe estar en un fichero versionado, y en el panel de
   Coolify se pueden ver y rotar sin tocar el repositorio.

   ── POR QUÉ NO SE IMPRIME EL VALOR ──

   Este script escribe en la configuración de Coolify y muestra lo que
   la API devuelve. La API devuelve el valor, y el valor es un secreto.
   Por eso lo que sale por pantalla es un resumen: cuántos caracteres y
   los primeros cuatro, que es lo justo para reconocerlo.

   ── POR QUÉ HACE FALTA MIRAR SI YA EXISTE ──

   Porque este script se puede volver a correr, y Meter dos veces la
   misma variable deja dos filas con el mismo nombre. Coolify no se
   queja: las lee en orden y gana la última, así que en el mejor de los
   casos es un desastre silencioso y en el peor se rompe el despliegue. */
const fs = require("fs");
const path = require("path");

const ENV = fs.readFileSync(path.join(__dirname, "..", ".env.coolify"), "utf8");

function leer(clave) {
  const m = ENV.match(new RegExp("^" + clave + "\\s*=\\s*(.+)$", "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}

const BASE = leer("COOLIFY_URL") || leer("COOLIFY_BASE");
const TOKEN = leer("COOLIFY_TOKEN");
const APP = process.argv[2];

/* Los valores vienen por entorno, no como argumentos, porque un
   argumento queda en el historial del shell y en la lista de procesos. */
const A_PONER = [
  { name: "UPSTASH_REDIS_REST_URL", value: process.env.UP_URL },
  { name: "UPSTASH_REDIS_REST_TOKEN", value: process.env.UP_TOKEN },
];

const tapar = (v) =>
  !v ? "(vacía)" : v.length + " caracteres, empieza con " + JSON.stringify(v.slice(0, 6));

(async () => {
  if (!BASE || !TOKEN || !APP) {
    console.log("\n  Faltan datos de Coolify o el identificador de la app.\n");
    process.exit(1);
  }

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

  /* ── DÓNDE SE LEEN LAS VARIABLES ──
     `GET /applications/{id}` NO devuelve la lista de variables: devuelve
     la aplicación, y el campo `envs` viene vacío. Por eso este script
     veía cero, creía que nada existía, y escribía otra vez.

     La que sí las devuelve es `GET /applications/{id}/envs`. Y si esa
     también viniera vacía, mejor decirlo que no se pudo leer: reescribir
     todo a ciegas es exactamente lo que produjo el duplicado. */

  async function leerVariables() {
    const r = await api("/api/v1/applications/" + APP + "/envs", "GET");
    if (Array.isArray(r.json)) return r.json;
    if (r.json && Array.isArray(r.json.data)) return r.json.data;
    return null;
  }

  const vars = await leerVariables();

  console.log("\n═══ Variables del bot ═══\n");

  if (!vars) {
    console.log("  × no se pudo leer la lista de variables.");
    console.log("    Se para acá: sin saber qué hay, escribir es a ciegas, y");
    console.log("    escribir a ciegas fue lo que dejó un duplicado antes.\n");
    process.exit(1);
  }

  console.log("  ahora hay " + vars.length + "\n");

  /* ---- 2. Poner las que faltan ---- */
  for (const v of A_PONER) {
    if (!v.value) {
      console.log("  · " + v.name + ": no viene el valor, se saltea");
      continue;
    }

    const yaEsta = vars.find((x) => (x.name || x.key) === v.name);

    if (yaEsta) {
      const mismo = yaEsta.value === v.value;
      console.log(
        "  · " + v.name.padEnd(26) +
        (mismo ? "ya está, con el mismo valor" : "ya está, con OTRO valor: no se toca")
      );
      if (!mismo) {
        console.log("      la que está: " + tapar(yaEsta.value));
        console.log("      la nueva:    " + tapar(v.value));
        console.log("      cambiarla a ciegas rompe el despliegue, así que se avisa");
        console.log("      y se deja. Decime si la reemplazo.");
      }
      continue;
    }

    /* `key` y no `name`, y sin `is_build_time`.

       Lo dice el error de la API, que es más útil que la documentación:

           key: ["This field is required."]
           name: ["This field is not allowed."]

       Y da igual que `coolify.js` lea `v.name || v.key`: acepta las
       dos formas al leer, y solo acepta una al escribir. Por eso el
       listado de variables funcionaba y la escritura no. */
    const r = await api("/api/v1/applications/" + APP + "/envs", "POST", {
      key: v.name,
      value: v.value,
      is_preview: false,
    });

    /* El cuerpo del error se imprime entero. Un 422 sin su cuerpo es
       un callejón: dice que no se pudo, pero no por qué, y se acabaría
       probando variantes a ciegas. */
    const detalle = r.ok
      ? "  " + tapar(v.value)
      : "  " + String(r.texto || JSON.stringify(r.json || {})).slice(0, 300);

    console.log("  " + (r.ok ? "✓" : "×") + " " + v.name.padEnd(26) + "HTTP " + r.status + detalle);
  }

  /* ---- 3. Releer ---- */
  const vars2 = (await leerVariables()) || [];

  console.log("");
  console.log("  ──────────────────────────────────────────────");
  console.log("  ahora hay " + vars2.length + " variables\n");

  for (const v of A_PONER) {
    const f = vars2.find((x) => (x.name || x.key) === v.name);
    console.log("  " + (f ? "✓" : "×") + " " + v.name.padEnd(26) +
      (f ? tapar(f.value) : "NO ESTÁ"));
  }

  /* Duplicados: dos filas con el mismo nombre. Coolify no avisa, y la
     que gana es la última. */
  const nombres = vars2.map((x) => x.name || x.key);
  const dupes = nombres.filter((n, i) => nombres.indexOf(n) !== i);

  console.log("");
  if (dupes.length) {
    console.log("  ! Hay variables repetidas: " + [...new Set(dupes)].join(", "));
    console.log("    Coolify no avisa de esto, y gana la última que se escribió.\n");
  } else {
    console.log("  ✓ No hay variables repetidas.");
  }

  console.log("");
  console.log("  Para que el contenedor las reciba hay que REDESPLEGAR: las");
  console.log("  variables se leen al arrancar, no en caliente.\n");
  console.log("    node db/coolify.js redesplegar " + APP + "\n");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});