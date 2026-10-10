/* Compara un panel oscuro y uno claro en separación de planos.
   Uso: node db/claro-vs-oscuro.js  (solo lee y calcula) */

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

const P = {
  oscuro_actual: { bg: "#0f172a", s1: "#1b2942", s2: "#223252", texto: "#f1f5f9" },
  oscuro_nuevo:  { bg: "#0a0a0b", s1: "#1a1a1d", s2: "#242428", texto: "#f1f5f9" },
  claro_stripe:  { bg: "#ffffff", s1: "#f6f8fa", s2: "#eef1f5", texto: "#0f172a" },
};

console.log("\n═══ ¿Oscuro o claro? ═══\n");

for (const [nombre, p] of Object.entries(P)) {
  const pares = [
    ["fondo ↔ tarjeta", p.bg, p.s1],
    ["fondo ↔ tabla", p.bg, p.s2],
    ["tarjeta ↔ tabla", p.s1, p.s2],
  ];

  const valores = pares.map(([, a, b]) => ratio(a, b));
  const peor = Math.min(...valores);

  console.log("  " + nombre);
  for (let i = 0; i < pares.length; i++) {
    console.log("    " + pares[i][0].padEnd(20) + valores[i].toFixed(3).padStart(7) +
      (valores[i] >= 1.3 ? "  ok" : "  bajo"));
  }
  console.log("    peor: " + peor.toFixed(3) + (peor >= 1.3 ? "   ← alcanza" : "   ← no llega"));
  console.log("    texto: " + ratio(p.texto, p.s1).toFixed(2) +
    (ratio(p.texto, p.s1) >= 4.5 ? "  ok" : "  BAJO"));
  console.log("");
}

console.log("  ──────────────────────────────────────────────");
console.log("  En oscuro, la luminancia vive entre 0.003 y 0.09.");
console.log("  En ese hueco caben dos planos con holgura y tres");
console.log("  apretados. En claro, la luminancia va de 0.9 a 1.0");
console.log("  para las superficies y el juego de planos se hace");
console.log("  con el BORDE, no con el tono: por eso las tarjetas");
console.log("  claras se distinguen aunque el gris sea de 2 pasos.");
console.log("");
console.log("  El panel actual usa las dos cosas a medias: tono");
console.log("  para separar (y no alcanza) y borde fuerte (y pesa).\n");