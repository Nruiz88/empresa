/* Mide la separación real entre superficies del panel.
   Dos colores que se parecen no separan, por mucho contraste que
   tengan contra el texto. Uso: node db/separacion-superficies.js */

const lin = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

const lum = (hex) => {
  const m = hex.replace("#", "");
  return (
    0.2126 * lin(parseInt(m.slice(0, 2), 16)) +
    0.7152 * lin(parseInt(m.slice(2, 4), 16)) +
    0.0722 * lin(parseInt(m.slice(4, 6), 16))
  );
};

const ratio = (a, b) => {
  const l1 = lum(a);
  const l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

const S = {
  bg: "#0b0f1a",
  bgSoft: "#121829",
  surface: "#1a2234",
  surface2: "#212b40",
};

console.log("\n═══ Separación entre superficies ═══\n");
console.log("  Para que dos superficies se distinguan, la razón de");
console.log("  luminancia tiene que ser al menos 1.3. Por debajo, el ojo");
console.log("  las lee como el mismo plano aunque el color sea distinto.");
console.log("");

const pares = [
  ["fondo  ↔  fondo blando", S.bg, S.bgSoft],
  ["fondo  ↔  superficie", S.bg, S.surface],
  ["fondo blando ↔ superficie", S.bgSoft, S.surface],
  ["superficie ↔ superficie-2", S.surface, S.surface2],
  ["superficie-2 ↔ fondo", S.surface2, S.bg],
];

for (const [n, a, b] of pares) {
  const r = ratio(a, b);
  const delta = Math.abs(lum(a) - lum(b)) * 100;
  const marca = r < 1.3 ? "  ← se leen iguales" : r < 1.6 ? "  ← justo" : "";
  console.log(
    "  " + n.padEnd(28) +
    r.toFixed(3).padStart(7) + "   salto de luz " + delta.toFixed(2).padStart(5) + marca
  );
}

console.log("\n  ──────────────────────────────────────────────");
console.log("  Resumen: hoy fondo y superficie se diferencian en");
console.log(ratio(S.bg, S.surface).toFixed(3) + ":1. Hay que subirlo a 1.5 o más,");
console.log("  y eso se consigue aclarando la superficie, no");
console.log("  oscureciendo el fondo (ya está al límite de negro).\n");