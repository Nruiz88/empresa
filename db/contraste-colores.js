/* Analiza contraste WCAG de los pares de color del panel.
   Uso: node db/contraste-colores.js  (solo lectura) */

const fs = require("fs");
const path = require("path");

const RAIZ = "D:/webs/empresa";

/* ── Contraste WCAG ──
   La fórmula es la de la especificación: se lleva el color al espacio
   sRGB lineal, se le aplica una curva, y de ahí sale la razón entre la
   luminancia más clara y la más oscura.

   El error clásico aquí es hacer la cuenta sobre los valores 0-255 sin
   la curva, y sale un númerooptimista que hace que un texto mal
   contrastado pase la prueba. Por eso la curva está. */
const lin = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

const lum = (hex) => {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

const ratio = (a, b) => {
  const l1 = lum(a);
  const l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

/* ── Los tokens tal como están ── */
const styles = fs.readFileSync(path.join(RAIZ, "public", "css", "styles.css"), "utf8");

const tokens = {};
for (const m of styles.matchAll(/^\s*(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/gm)) {
  tokens[m[1]] = m[2].toLowerCase();
}

console.log("\n═══ Contraste de los pares del panel ═══\n");

const pares = [
  ["texto normal",        "--text",       "--bg"],
  ["texto normal",        "--text",       "--surface"],
  ["texto normal",        "--text",       "--surface-2"],
  ["texto apagado",       "--text-muted", "--surface"],
  ["texto tenue",         "--text-dim",   "--surface"],
  ["acento",              "--accent",     "--bg"],
  ["acento",              "--accent-2",   "--bg"],
  ["peligro",             "--danger",     "--bg"],
  ["aviso",               "--warning",    "--bg"],
  ["texto de aviso",      "--warning-text", "--warning-bg"],
];

/* El mínimo de WCAG AA para texto normal es 4.5. Para texto grande
   (18.66px o más en negrita) baja a 3.0. */
const MIN = 4.5;

let fallos = 0;

for (const [nombre, fg, bg] of pares) {
  if (!tokens[fg] || !tokens[bg]) {
    console.log("  " + nombre.padEnd(16) + "falta el token");
    continue;
  }
  const r = ratio(tokens[fg], tokens[bg]);
  const ok = r >= MIN;
  if (!ok) fallos++;
  console.log(
    "  " + (ok ? "ok  " : "BAJO") + " " +
    nombre.padEnd(16) +
    r.toFixed(2).padStart(6) + "  " +
    fg.padEnd(14) + tokens[fg] + "  sobre  " + tokens[bg]
  );
}

console.log("\n  ──────────────────────────────────────────────");
console.log("  por debajo de " + MIN + ":1 →  " + fallos);
console.log("  (WCAG AA pide 4.5:1 para texto normal)\n");