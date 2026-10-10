/* Reparte los planos de superficie para que se distingan todos.
   Uso: node db/repartir-planos.js  (solo lee y calcula) */

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

/* ── POR QUÉ NO SIRVE PONER CUATRO PLANOS ──

   Con la fórmula de WCAG, la luminancia va de 0 a 1 pero la parte
   baja está comprimida: pasar de un gris muy oscuro al siguiente
   duplica la luminancia, mientras que en la parte alta hay que
   multiplicar por mucho para notar el cambio.

   En el rango en el que vive un panel oscuro —luminancia entre 0.008
   y 0.10— caben bien dos planos con separación clara, y tres si se
   aprieta. Cuatro ya no: alguno queda con menos de 1.2 y el ojo lo
   lee igual que el de al lado.

   ── LA SALIDA ──

   Quedan TRES planos, y el que se elimina es `--bg-soft`, que
   resulta ser casi siempre el mismo que el fondo. Menos planos bien
   separados se leen mejor que más planos mal separados.

     --bg          el fondo de la página, casi negro
     --surface     las tarjetas, claramente más claro
     --surface-2   la cabecera de tabla y los estados, más claro aún

   Y se sube la separación exigida a 1.35, que es donde una diferencia
   deja de necesitar un borde para notarse. */

console.log("\n═══ Reparto de planos ═══\n");

/* ── POR QUÉ LOS TRES VALORES ESTÁN FIJOS Y NO SE BUSCAN ──

   La primera versión de este script recorría el gris buscando el
   primer tono que llegara a 1.5 con el fondo, y salió con #313131:
   un gris tan claro que las tarjetas de panel_store vibran y se leen
   más que el texto. Después el tercer plano salía #000000, porque al
   buscar «1.35 por encima» en la dirección de la luminancia se
   encuentra el negro antes que un gris intermedio.

   El cálculo sirve para VERIFICAR, no para decidir. Los valores se
   eligen a mano —por qué un plano y no otro es una decisión de
   gusto— y el script comprueba que dan la separación que se busca.
   Es al revés de como estaba, que es más lento pero no mete un gris
   claro donde tocaba un plano oscuro. */

const PLANOS = {
  "--bg": "#0a0a0b",        /* la página */
  "--surface": "#1a1a1d",  /* una tarjeta */
  "--surface-2": "#242428", /* la cabecera de tabla, un estado */
};

const OBJETIVO = 1.35;

console.log("  ── Separación entre planos ──\n");
const pares = [
  ["fondo ↔ superficie", PLANOS["--bg"], PLANOS["--surface"]],
  ["fondo ↔ superficie-2", PLANOS["--bg"], PLANOS["--surface-2"]],
  ["superficie ↔ superficie-2", PLANOS["--surface"], PLANOS["--surface-2"]],
];

let peor = Infinity;
for (const [n, a, b] of pares) {
  const r = ratio(a, b);
  peor = Math.min(peor, r);
  console.log(
    "    " + n.padEnd(28) + r.toFixed(3).padStart(7) + (r < OBJETIVO ? "  bajo" : "  ok")
  );
}

console.log("\n  ── Texto encima ──\n");
for (const texto of ["#f1f5f9", "#a8b3cc", "#8b9ab5"]) {
  console.log("    " + texto + "  (el cuerpo, el apagado y el tenue)");
  for (const [n, f] of Object.entries(PLANOS)) {
    const r = ratio(texto, f);
    console.log("      sobre " + n.padEnd(14) + r.toFixed(2).padStart(6) + (r >= 4.5 ? "  ok" : "  BAJO"));
  }
}

console.log("\n  ── Acento y estados encima ──\n");
for (const [nombre, c] of [
  ["acento", "#34d399"],
  ["peligro", "#f87171"],
  ["aviso", "#fbbf24"],
]) {
  console.log("    " + nombre.padEnd(10) + c);
  for (const [n, f] of Object.entries(PLANOS)) {
    const r = ratio(c, f);
    console.log("      sobre " + n.padEnd(14) + r.toFixed(2).padStart(6) + (r >= 4.5 ? "  ok" : "  BAJO"));
  }
}

console.log("\n  ──────────────────────────────────────────────");
console.log("  peor separación: " + peor.toFixed(3) + (peor >= OBJETIVO ? "  ok" : "  INSUFICIENTE"));
console.log("");