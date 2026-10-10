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

  /* ═══════════════════════════════════════════════════════════
     POR LÍNEAS, NO POR POSICIONES

     La primera versión quitaba rangos de texto con `slice`, y salió
     mal tres veces seguidas:

       · con la longitud del selector recortado, el recorte se
         corría y partía la línea siguiente: `}sual {`;
       · sin el salto de detrás, la llave se pegaba al selector
         siguiente: `}.panel-btn,`;
       · con la sangría entre selectores en vez de delante, cuatro
         líneas en blanco entre cada uno.

     Todas las veces el archivo quedó con las llaves cuadradas y
     siendo válido, que es la peor forma de romperse: no hay error,
     solo un panel raro.

     ── POR QUÉ POR LÍNEAS ──

     Un archivo de CSS escrito a mano tiene cada regla en sus propias
     líneas: el selector arriba, las propiedades en medio, la llave de
     cierre en su línea. Se borran esas líneas enteras y no hay
     aritmética de posiciones que pueda correr.

     Y si una regla NO está en líneas propias, no se toca: se avisa y
     se deja para que la mire una persona. Es peor no borrar una regla
     sobrante que partir un archivo por la mitad.
     ─────────────────────────────────────────────────────────── */

  const lineas = css.split("\n");
  const fueraDeLinea = [];

  const aQuitar = [];

  for (const r of reglas(css)) {
    const clases = [...r.selector.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]);
    const dentro = clases.filter((c) => set.has(c));

    if (!dentro.length) continue;

    const lineaDesde = r.linea;
    const lineaHasta = css.slice(0, r.fin).split("\n").length;

    /* La llave de cierre tiene que estar en su propia línea. */
    const cierre = lineas[lineaHasta - 1] || "";

    if (!/^\s*\}\s*$/.test(cierre)) {
      fueraDeLinea.push({
        selector: r.selector.slice(0, 40),
        linea: lineaDesde,
        cierre: cierre.trim().slice(0, 40),
      });
      continue;
    }

    aQuitar.push({
      desde: lineaDesde,
      hasta: lineaHasta,
      dentro,
      enteras: dentro.length === clases.length,
      r,
    });
  }

  /* De atrás hacia delante, para que los números de línea de las que
     quedan no cambien mientras se corta. */
  aQuitar.sort((a, b) => b.desde - a.desde);

  const quite = new Set();
  let fuera = 0;

  for (const q of aQuitar) {
    if (q.enteras) {
      for (let i = q.desde; i <= q.hasta; i++) quite.add(i);
      fuera += q.dentro.length;
      continue;
    }

    /* Agrupada: se reescribe la línea del selector con las clases
       vivas. Solo la primera, y solo si el resto del selector está
       en la misma línea. */
    const primera = lineas[q.desde - 1];

    const sigueEnLaMismaLinea = !/\.[\w-]+[^{]*,\s*$/.test(primera)
      ? false
      : true;

    if (!sigueEnLaMismaLinea) {
      /* El selector ocupa varias líneas. Se quitan todas y se
         escribe el nuevo al principio. */
      const queda = q.r.selector
        .split(",")
        .map((s) => s.trim())
        .filter((s) => {
          const c = [...s.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]);
          return !c.some((x) => set.has(x));
        })
        .join(",\n");

      if (!queda) {
        for (let i = q.desde; i <= q.hasta; i++) quite.add(i);
      } else {
        quite.add(q.desde + 1);
        for (let i = q.hasta; i >= q.desde; i--) quite.delete(i);
        lineas[q.desde - 1] = queda;
      }
      fuera += q.dentro.length;
      continue;
    }

    const queda = primera
      .replace(q.r.selector.trim(), q.r.selector
        .split(",")
        .map((s) => s.trim())
        .filter((s) => {
          const c = [...s.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]);
          return !c.some((x) => set.has(x));
        })
        .join(","));

    lineas[q.desde - 1] = queda;
    fuera += q.dentro.length;
  }

  return {
    texto: lineas.filter((_, i) => !quite.has(i + 1)).join("\n"),
    fuera,
    fueraDeLinea,
  };
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

  const { texto, fuera, fueraDeLinea } = quitar(h.limpio, h.muertas);

  for (const x of fueraDeLinea) {
    console.log(
      "  ⚠ " + f + ":" + x.linea + "  no se toca " + x.selector +
      "  (la llave de cierre no está en su línea)"
    );
  }

  fs.writeFileSync(path.join(RAIZ, "public", "css", f), texto, "utf8");

  console.log("  " + f + ": fuera " + fuera + " clases");
  escritas += fuera;
}

console.log("");
console.log("  escritas: " + escritas + " clases menos");
console.log("");
