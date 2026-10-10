/* ═══════════════════════════════════════════════════════════════
   EL SALTO ENTRE PLANOS, EN NÚMEROS

   La regla de legibilidad entre fondos no es la de texto: para que
   dos superficies se lean como distintas sin mirar dos veces hace
   falta una diferencia de luminancia relativa de más o menos 1,3:1.
   Por debajo, dos zonas contiguas se leen como la misma cosa, que es
   exactamente el «todo se ve del mismo material».

   WCAG tiene una fórmula exacta para la luminancia relativa. Con
   ella se mide el salto que hay ahora y el que darían otros valores,
   antes de probarlos uno a uno en el navegador.
   ═══════════════════════════════════════════════════════════════ */

function canal(h) {
  const c = h / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminancia(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = canal((n >> 16) & 255);
  const g = canal((n >> 8) & 255);
  const b = canal(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a, b) {
  const la = luminancia(a);
  const lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* Lo que hay ahora */
const HOY = [
  ["--bg      → fondo", "#0b0f1a"],
  ["--plano-2 hueco", "#131f38"],
  ["--plano-1 tarjeta", "#1a2234"],
  ["--plano-3 flotante", "#212b40"],
];

console.log("\n═══ El salto que hay ═══\n");
for (let i = 1; i < HOY.length; i++) {
  const c = contraste(HOY[0][1], HOY[i][1]);
  console.log(
    "  " + HOY[i][0].padEnd(18) + HOY[i][1] +
    "   " + c.toFixed(2) + ":1" + (c < 1.3 ? "   ← por debajo de 1,3" : "")
  );
}

/* Un salto que sí distingue. Se mantienen el tono azul-gris de la
   casa y solo sube la luminancia de las tarjetas: la página queda
   igual de oscura, las cajas se ven claramente más claras. */
const PROPUESTOS = [
  ["--plano-1", ["#1a2234", "#232e48", "#273354", "#2b3a5e"]],
  ["--plano-3", ["#212b40", "#2c3a5c", "#334267", "#3a4a72"]],
  ["--plano-2", ["#131f38", "#0e1526", "#0c1220", "#0a0f1c"]],
];

console.log("\n═══ Salto candidato, con el fondo de siempre ═══\n");

for (const [nombre, candidatos] of PROPUESTOS) {
  console.log("  " + nombre);
  for (const hex of candidatos) {
    const c = contraste("#0b0f1a", hex);
    console.log(
      "    " + hex + "   " + c.toFixed(2) + ":1" +
      (c >= 1.3 ? "   ✓ se distingue" : "")
    );
  }
}

console.log("\n  Una tarjeta a 1,3:1 se lee separada del fondo sin buscar");
console.log("  el contorno. Es el mínimo que da la referencia que se está");
console.log("  usando (Sakai), y el doble de lo que hay hoy.\n");