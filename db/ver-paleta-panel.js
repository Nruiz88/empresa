/* ¿El panel comparte la paleta de la home, o tiene la suya?
   ─────────────────────────────────────────────────────────────
   La pregunta es concreta: ¿de dónde salen los COLORES del panel?

   Dos respuestas posibles, y son muy distintas:

     · usa `var(--bg)`, `var(--surface)`, `var(--brand)`  → comparte
       paleta, y cambiar la home cambia el panel;
     · tiene hexadecimales propios                          → son dos
       paletas, y aunque hoy se vean iguales, el día que se toque
       una no se toca la otra.

   ── POR QUÉ ES IMPORTANTE ──

   Porque "adaptar el panel a la estética de la home" no es hacer que
   se parezcan hoy. Es que no puedan dejar de parecerse mañana. Y una
   paleta duplicada garantiza que van a divergir. */
const fs = require("fs");
const path = require("path");

const dir = path.join(process.cwd(), "public", "css");

const variablesDe = (f) => {
  const t = fs.readFileSync(path.join(dir, f), "utf8");
  const v = {};
  const re = /^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gim;
  let m;
  while ((m = re.exec(t))) {
    if (!(m[1] in v)) v[m[1]] = m[2].trim();
  }
  return v;
};

const home = variablesDe("styles.css");

console.log("\n═══ ¿El panel usa la paleta de la home? ═══\n");

for (const archivo of ["panel.css", "portal.css"]) {
  const texto = fs.readFileSync(path.join(dir, archivo), "utf8");

  const hex = texto.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  const rgba = texto.match(/rgba?\([^)]*\)/g) || [];
  const varsUsadas = texto.match(/var\(--[a-z0-9-]+\)/g) || [];

  /* Cuáles de las que usa existen en la home, y cuáles son suyas. */
  const nombres = [...new Set(varsUsadas.map((v) => v.replace(/var\(|\)/g, "")))];
  const propias = nombres.filter((n) => !(n in home));
  deLaHome = nombres.filter((n) => n in home);

  console.log("  ── " + archivo + " ──");
  console.log("    tamaño:              " + Math.round(texto.length / 1024) + " KB");
  console.log("    colores hex sueltos: " + hex.length + " (" + new Set(hex).size + " distintos)");
  console.log("    rgba():              " + rgba.length);
  console.log("    variables usadas:    " + nombres.length);
  console.log("      de la home:        " + deLaHome.length);
  console.log("      propias:           " + propias.length);
  console.log("");

  if (hex.length) {
    console.log("    hexadecimales sueltos:");
    [...new Set(hex)].forEach((c) => {
      const n = hex.filter((x) => x === c).length;
      const enHome = Object.values(home).some((v) => v.toLowerCase().includes(c.toLowerCase()));
      console.log("      " + c.padEnd(10) + n + " veces" + (enHome ? "  (existe en la home)" : "  *** NO está en la home"));
    });
    console.log("");
  }

  if (propias.length) {
    console.log("    variables propias (las de layout, normales):");
    propias.slice(0, 10).forEach((n) => console.log("      " + n));
    if (propias.length > 10) console.log("      … y " + (propias.length - 10) + " más");
    console.log("");
  }
}

/* ── LA PREGUNTA QUE CUENTA ──

   ¿Hay colores de VERDAD (no de layout) definidos en panel.css o
   portal.css? Si sí, hay dos paletas. */

console.log("  ──────────────────────────────────────────────\n");

/* Los nombres que suenan a color. */
const deColor = /^--(bg|bg-|surface|text|brand|accent|success|warning|danger|info|icon|on-)/;

let problemas = [];

for (const archivo of ["panel.css", "portal.css"]) {
  const texto = fs.readFileSync(path.join(dir, archivo), "utf8");
  const v = variablesDe(archivo);

  for (const [nombre, valor] of Object.entries(v)) {
    if (!deColor.test(nombre)) continue;
    if (nombre in home) continue;
    problemas.push(archivo + "  " + nombre + " = " + valor);
  }
}

if (problemas.length) {
  console.log("  HAY PALETAS DEFINIDAS DENTRO DEL PANEL, que la home no tiene:\n");
  problemas.forEach((p) => console.log("    " + p));
  console.log("\n  Eso es lo que hay que arreglar: no que se vean parecidos hoy,");
  console.log("  sino que no puedan dejar de parecerse mañana.\n");
} else {
  console.log("  ✓ El panel no define colores propios.");
  console.log("    Toma todos de la home, así que no pueden divergir.\n");
}