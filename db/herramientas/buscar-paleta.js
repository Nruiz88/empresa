/* Prueba paletas de superficie hasta que las separaciones den.
   Uso: node db/buscar-paleta.js  (solo lee y calcula) */

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

/* ── LA IDEA ──

   Hoy el fondo es #0f172a, un azul marino ya muy oscuro (luminancia
   0.0115). Subir la tarjeta de ahí exige aclararla bastante, y a
   partir de cierto punto el texto blanco deja de destacar.

   La salida de Stripe es la contraria: bajar el fondo casi a negro
   neutro y dejar la tarjeta un gris claramente más claro. Así la
   separación la da la distancia entre «casi negro» y «gris», que es
   donde el ojo distingue bien, sin tener que subir la tarjeta hasta
   un azul que compita con el texto.

   ── LOS TRES PASOS QUE HAY QUE PODER DISTINGUIR ──

     fondo      la página
     superficie una tarjeta
     superficie-2  un estado dentro de la tarjeta, o la cabecera de tabla

   Con solo dos, todo se aplana; con cuatro, todo se ensucia. Tres es
   el número que aguanta un panel con tablas, tarjetas y estados. */

const paletas = [
  {
    nombre: "gris neutro, fondo casi negro",
    bg: "#0a0a0b",
    bgSoft: "#141416",
    surface: "#1c1c1f",
    surface2: "#26262a",
  },
  {
    nombre: "gris neutro, fondo negro",
    bg: "#08080a",
    bgSoft: "#121214",
    surface: "#1a1a1d",
    surface2: "#242428",
  },
  {
    nombre: "azul muy oscuro, superficie clara",
    bg: "#0b1020",
    bgSoft: "#141b30",
    surface: "#1e2740",
    surface2: "#2a3450",
  },
  {
    nombre: "gris cálido",
    bg: "#0c0c0d",
    bgSoft: "#161617",
    surface: "#1f1f21",
    surface2: "#2a2a2d",
  },
];

console.log("\n═══ Paletas candidatas ═══\n");

for (const p of paletas) {
  const pares = [
    ["fondo ↔ superficie", p.bg, p.surface],
    ["fondo ↔ superficie-2", p.bg, p.surface2],
    ["superficie ↔ superficie-2", p.surface, p.surface2],
    ["fondo blando ↔ superficie", p.bgSoft, p.surface],
  ];

  const min = Math.min(...pares.map(([, a, b]) => ratio(a, b)));
  const textoSobreSuperficie = ratio("#f1f5f9", p.surface);
  const textoSobreFondo = ratio("#f1f5f9", p.bg);

  const sepOK = min >= 1.3;
  const txtOK = textoSobreSuperficie >= 4.5 && textoSobreFondo >= 4.5;

  console.log("  " + p.nombre);
  for (const [n, a, b] of pares) {
    const r = ratio(a, b);
    console.log(
      "    " + n.padEnd(26) + r.toFixed(3).padStart(7) + (r < 1.3 ? "  bajo" : "")
    );
  }
  console.log(
    "    texto #f1f5f9 sobre superficie: " +
      textoSobreSuperficie.toFixed(2) +
      (textoSobreSuperficie >= 4.5 ? "  ok" : "  BAJO")
  );
  console.log(
    "    texto #f1f5f9 sobre fondo:      " +
      textoSobreFondo.toFixed(2) +
      (textoSobreFondo >= 4.5 ? "  ok" : "  BAJO")
  );
  console.log(
    "    ── separación mínima " + min.toFixed(3) + (sepOK ? "  ok" : "  INSUFICIENTE") +
      ",  texto " + (txtOK ? "ok" : "BAJO") + "\n"
  );
}