const fs = require("fs");
const path = require("path");

const RAIZ = "D:/webs/empresa";
const CSS = path.join(RAIZ, "public", "css");

const SEGURO = process.argv.includes("--si");

/* ═══════════════════════════════════════════════════════════════
   QUÉ HOJAS SE TOCAN, Y CUÁLES NO

   ── POR QUÉ `styles.css` QUEDA FUERA ──

   Porque la carga la web pública Y el panel:

       views/partials/head.ejs       → styles.css
       views/partials/panel-head.ejs → styles.css, panel.css, portal.css…

   Y los `--fs-*` de `styles.css` son los de la web: `--fs-body`,
   `--fs-h1`, `--fs-hero`. Los de este trabajo son otros, y están
   declarados dentro de `html[data-panel]`, que la portada no tiene.

   Sustituir ahí dejaría `font-size: var(--fs-cuerpo)` en la home con
   la variable sin definir: el navegador la ignora en silencio y el
   texto se queda sin tamaño. Es decir, se rompe la portada entera y
   no da ningún error.

   ── LAS QUE SÍ ──

   Solo las que carga `panel-head.ejs` y que no usa nadie más. Todas
   están bajo `html[data-panel]`, así que las variables existen.
   ───────────────────────────────────────────────────────────── */
const HOJAS_DEL_PANEL = [
  "panel.css",
  "portal.css",
  "aplicaciones.css",
  "aplicacion-form.css",
  "plan-apps.css",
];

/* =========================================================
   MAPA DE LA ESCALA VIEJA A LA NUEVA

   ── CADA GRUPO, Y POR QUÉ ──

   --fs-label   Lo que va en versalitas con `letter-spacing`: las
                etiquetas de columna, el «hoy», los estados. 11px es
                donde se leen bien; a 12 son casi del tamaño del texto
                y dejan de parecer una etiqueta.

   --fs-xs      Notas y pies. 12px.

   --fs-sm      Tablas y listas. 13px: es lo que permite ver veinte
                filas sin desplazar y leerlas.

   --fs-cuerpo  El texto normal. 14px. Este es el que cambia de
                verdad: el panel estaba en 16, que es tamaño de
                página de contenido, no de herramienta.

   --fs-md      Lo que ya era 16 y querían seguir siendo 16: el
                subtítulo de una tarjeta, el texto de un formulario
                con holgura.

   --fs-lg      Subtítulos y títulos de bloque. 18px.

   --fs-xl      El título de la página. 22px con `letter-spacing`
                cerrado: un título grande con el interletraje abierto
                se lee más grande de lo que es.

   --fs-numero  Las cifras grandes de las tarjetas.
   ========================================================= */

const MAPA = [
  { de: ["0.62rem", "0.65rem", "0.66rem", "0.68rem", "0.7rem", "0.72rem"], a: "var(--fs-label)" },
  { de: ["0.78rem", "0.8rem", "0.82rem"], a: "var(--fs-xs)" },
  { de: ["0.875rem", "0.9rem", "0.95rem", "0.98rem"], a: "var(--fs-cuerpo)" },
  { de: ["1rem", "1.05rem"], a: "var(--fs-cuerpo)" },
  { de: ["1.1rem"], a: "var(--fs-lg)" },
  { de: ["1.3rem", "1.4rem", "1.5rem"], a: "var(--fs-xl)" },
  { de: ["1.6rem", "1.9rem"], a: "var(--fs-numero)" },
  { de: ["2.4rem"], a: "var(--fs-numero)" },
];

/** De un tamaño a su paso en la escala. */
function pasoDe(valor) {
  for (const g of MAPA) {
    if (g.de.includes(valor)) return g.a;
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════════
   SUSTITUIR

   ── SOLO DENTRO DE `font-size` ──

   Porque `1rem` aparece en hundredos de `padding`, `margin` y
   `gap`. Cambiarlos todos sería cambiar el espaciado entero sin
   haberlo medido.

   El patrón es `font-size` seguido de dos puntos y el valor. Es lo
   único que se toca, y por eso el cambio es reversible leyendo el
   diff: no se borra nada, se cambian valores.
   ═══════════════════════════════════════════════════════════════ */

const resultados = [];

for (const f of HOJAS_DEL_PANEL) {
  if (!fs.existsSync(path.join(CSS, f))) continue;

  const ruta = path.join(CSS, f);
  const texto = fs.readFileSync(ruta, "utf8");

  const cuenta = {};
  let cambios = 0;

  /* Se recorre con la expresión regular, que devuelve la propiedad
     entera, para poder comprobar que es `font-size` y no otra. */
  const nuevo = texto.replace(
    /font-size\s*:\s*([\d.]+)(rem|px)/g,
    (todo, numero, unidad) => {
      if (unidad !== "rem") return todo;

      const paso = pasoDe(numero + "rem");
      if (!paso) return todo;

      cuenta[numero + "rem"] = (cuenta[numero + "rem"] || 0) + 1;
      cambios++;

      return "font-size: " + paso;
    }
  );

  if (cambios) {
    resultados.push({ f, ruta, nuevo, cuenta, cambios });
  }
}

/* ═══════════════════════════════════════════════════════════════
   DECIRLO
   ═══════════════════════════════════════════════════════════════ */

console.log("\n═══ Mapa de la escala ═══\n");

let total = 0;

for (const r of resultados) {
  console.log("  " + r.f + ": " + r.cambios + " declaraciones");

  const porPaso = {};
  for (const [de, n] of Object.entries(r.cuenta)) {
    const a = pasoDe(de);
    if (!porPaso[a]) porPaso[a] = [];
    porPaso[a].push(de.replace("rem", "") + "×" + n);
  }

  for (const [a, desde] of Object.entries(porPaso)) {
    console.log("    " + a.padEnd(18) + " ← " + desde.join("  "));
  }

  console.log("");
  total += r.cambios;
}

console.log("  ──────────────────────────────────────────────");
console.log("  declaraciones cambiadas: " + total);
console.log("");

if (!SEGURO) {
  console.log("  SIMULACRO. No se ha tocado nada.");
  console.log("");
  process.exit(0);
}

for (const r of resultados) {
  fs.writeFileSync(r.ruta, r.nuevo, "utf8");
}

console.log("  escrito.");
console.log("");
