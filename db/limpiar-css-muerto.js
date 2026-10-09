/* =========================================================
   Shopcito — Borrar las reglas CSS que no se usan
   ------------------------------------------------------------
   Uso:
     node db/limpiar-css-muerto.js          cuenta, no toca nada
     node db/limpiar-css-muerto.js --si     borra

   ── POR QUÉ ESTE SCRIPT NO BUSCA POR SU CUENTA ──

   Porque la primera versión lo hacía, y proponía borrar 130 clases de
   las que solo 54 sobraban. Las otras 76 eran las que el JavaScript
   monta a trozos, que no aparecen escritas en ninguna parte:

       class="app-estado app-estado--<%= s.estado.tono %>"

   La que manda al borrar es la herramienta, así que tiene que usar la
   misma definición de «se usa» que la auditoría. Esa definición vive
   en `lib/css-clases.js` y no aquí.

   ── LO QUE NO TOCA ──

   · las clases montadas a trozos, por lo de arriba;
   · los selectores que no son de clase;
   · las reglas agrupadas: si de `.a, .b, .c` sobra `.b`, se quita la
     `.b` y se dejan las otras dos. Borrar el bloque entero se lleva
     por delante el `padding` de `.a` y `.c`.

   ── POR QUÉ HAY QUE PASAR `--si` ──

   Porque borrar reglas de un archivo de cinco mil líneas no se
   deshace escribiendo el archivo otra vez.
   ========================================================= */

const fs = require("fs");
const path = require("path");

const { analizar, reglas } = require("../lib/css-clases");

const RAIZ = path.resolve(__dirname, "..");
const SEGURO = process.argv.includes("--si");

const { porHoja } = analizar();

console.log("\n═══ Reglas CSS sin uso ═══\n");

let totalMuertas = 0;
let totalMontadas = 0;

for (const f of Object.keys(porHoja)) {
  const h = porHoja[f];

  totalMuertas += h.muertas.length;
  totalMontadas += h.montadas.length;

  if (!h.muertas.length && !h.montadas.length) continue;

  console.log("  " + f);
  console.log("    sin uso:          " + h.muertas.length);
  console.log("    montadas a trozos: " + h.montadas.length + "   (no se tocan)");
  if (h.muertas.length) {
    console.log("      " + h.muertas.join(", "));
  }
  console.log("");
}

console.log("  ──────────────────────────────────────────────");
console.log("  borrables: " + totalMuertas + "    protegidas: " + totalMontadas);
console.log("");

if (!totalMuertas) {
  console.log("  No hay nada que borrar.");
  console.log("");
  process.exit(0);
}

/* ═══════════════════════════════════════════════════════════════
   QUITARLAS

   De atrás hacia delante, para que las posiciones de las que quedan
   no cambien mientras se corta. Recortando de mayor a menor, cada
   posición sigue siendo válida cuando llega su turno.
   ═══════════════════════════════════════════════════════════════ */

function quitar(css, muertas) {
  const set = new Set(muertas);

  const aQuitar = [];

  for (const r of reglas(css)) {
    const clases = [...r.selector.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]);
    const dentro = clases.filter((c) => set.has(c));

    if (!dentro.length) continue;

    aQuitar.push({ ...r, dentro, enteras: dentro.length === clases.length });
  }

  aQuitar.sort((a, b) => b.inicio - a.inicio);

  let texto = css;
  let fuera = 0;

  for (const r of aQuitar) {
    if (r.enteras) {
      texto = texto.slice(0, r.inicio) + texto.slice(r.fin);
      fuera += r.dentro.length;
      continue;
    }

    /* Agrupada: se quitan solo las clases muertas de la lista. */
    const queda = r.selector
      .split(",")
      .map((s) => s.trim())
      .filter((s) => {
        const clases = [...s.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]);
        return !clases.some((c) => set.has(c));
      })
      .join(",\n");

    texto = texto.slice(0, r.inicio) + queda + texto.slice(r.inicio + r.selector.length);
    fuera += r.dentro.length;
  }

  return { texto, fuera };
}

if (!SEGURO) {
  console.log("  SIMULACRO. No se ha tocado ningún fichero.");
  console.log("  Para hacerlo de verdad:");
  console.log("");
  console.log("      node db/limpiar-css-muerto.js --si");
  console.log("");
  process.exit(0);
}

let escritas = 0;

for (const f of Object.keys(porHoja)) {
  const h = porHoja[f];
  if (!h.muertas.length) continue;

  const { texto, fuera } = quitar(h.limpio, h.muertas);
  fs.writeFileSync(path.join(RAIZ, "public", "css", f), texto, "utf8");

  console.log("  " + f + ": fuera " + fuera + " clases");
  escritas += fuera;
}

console.log("");
console.log("  escritas: " + escritas + " clases menos");
console.log("");
