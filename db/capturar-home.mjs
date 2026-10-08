// Captura la portada y el panel con el único tema que queda.
//
// ── POR QUÉ AHORA NO HAY VARIANTES DE TEMA ──
//
// Antes había cuatro capturas (tres temas por escritorio y móvil) y el
// conmutador estaba en la barra. Ya no hay conmutador, así que no hay
// tema que recorrer: se captura lo que hay, que es una sola cosa.
//
// La comprobación que queda es la que importa: que el sitio se vea
// BIEN en claro. Todo el diseño sepounds sobre tokens que pasaron de
// oscuro a claro de golpe, y eso rompe cosas sin avisar — sombras que
// se pierden sobre blanco, textos que bajan de contraste, bordes que
// desaparecen.
//
// Por eso se mide el contraste del texto sobre el fondo de verdad, con
// los valores calculados, y no "a ojo en la captura".

import { createRequire } from "node:module";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("D:/webs/wweb/node_modules/playwright");

const URL_BASE = (() => {
  const i = process.argv.indexOf("--url");
  return i > -1 ? process.argv[i + 1] : "http://127.0.0.1:3000";
})();

const SALIDA = "C:/Users/chin0/AppData/Local/Temp/opencode/home";
fs.mkdirSync(SALIDA, { recursive: true });

const capturas = [
  { nombre: "escritorio", ancho: 1440, alto: 900, url: "/" },
  { nombre: "escritorio-completa", ancho: 1440, alto: 900, url: "/", completa: true },
  { nombre: "movil", ancho: 390, alto: 844, url: "/", completa: true },
  { nombre: "precios", ancho: 1440, alto: 900, url: "/precios", completa: true },
  { nombre: "panel-login", ancho: 1440, alto: 900, url: "/panel/login" },
];

/* Contraste WCAG. Se calcula en el navegador con los colores que el
   navegador está usando de verdad, no con los del CSS: si algo se
   sobreescribe por tema o por `color-mix`, el token dice una cosa y
   la pantalla otra.

   ── DOS COSAS QUE LA PRIMERA VERSIÓN HACÍA MAL ──

   1. Medía `.promise span`, que es el ICONO (el primer `span` dentro
      de `.promise`), no la línea de detalle. Daba 1,88:1 y seemed un
      problema de color que era un problema de selector. Con la clase
      buena (`--promise-detalle`) se mide lo que se quiere medir.

   2. Tomaba el primer fondo no transparente SIN mezclarlo. Con un
      fondo translúcido —una chapa de color al 12 % sobre otra cosa—
      leía "rgba(16,185,129,0.12)" como si fuera un verde sólido y lo
      comparaba con el texto. Eso da un número, pero no es el número
      que se ve.

   Por eso aquí los RGBA se componen sobre el fondo de verdad antes de
   comparar. */
const CONTRASTE = `
  (function () {
    const lum = (r, g, b) => {
      const f = (c) => {
        c /= 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const partes = (c) => (c.match(/[\\d.]+/g) || []).map(Number);

    // Compone un color con alfa sobre un fondo opaco.
    // "abajo" puede ser un string de color o un array ya compuesto,
    // porque al componer hacia abajo se va encadenando y lo que se
    // devuelve del nivel anterior es un array, no un "rgb(...)".
    const sobre = (arriba, abajo) => {
      const a = partes(arriba);
      const f = Array.isArray(abajo) ? abajo : partes(abajo);
      if (a.length < 4 || a[3] >= 1) return a;
      return [
        a[0] * a[3] + f[0] * (1 - a[3]),
        a[1] * a[3] + f[1] * (1 - a[3]),
        a[2] * a[3] + f[2] * (1 - a[3]),
      ];
    };

    // El fondo REAL: se sube hasta un color opaco y se compone todo lo
    // que se encuentra por el camino.
    const fondoReal = (el) => {
      const pila = [];
      let p = el;
      while (p) {
        const c = getComputedStyle(p).backgroundColor;
        const a = partes(c);
        if (a.length === 3 || (a.length === 4 && a[3] > 0)) {
          pila.push(c);
          if (a.length === 3 || a[3] >= 1) {
            // Se busca el color opaco y se compone hacia abajo.
            let fondo = partes(c);
            for (let i = pila.length - 2; i >= 0; i--) fondo = sobre(pila[i], fondo);
            return fondo;
          }
        }
        p = p.parentElement;
      }
      return [255, 255, 255];
    };

    const ratio = (t, f) => {
      const la = lum(t[0], t[1], t[2]);
      const lb = lum(f[0], f[1], f[2]);
      const hi = Math.max(la, lb);
      const lo = Math.min(la, lb);
      return (hi + 0.05) / (lo + 0.05);
    };

    const sel = [
      "h1",
      ".lead",
      ".hero-note",
      ".promise strong",
      ".promise-detalle",
      ".eyebrow",
      ".btn-primary",
      ".plan-desc",
      ".price-features li",
      ".duelo-col > p",
      ".trust-row li",
    ];

    const out = [];
    for (const s of sel) {
      const el = document.querySelector(s);
      if (!el) continue;
      const cs = getComputedStyle(el);
      const texto = partes(cs.color);
      const comp = texto.length === 4 ? sobre(cs.color, fondoReal(el)) : texto;
      const fondo = fondoReal(el);
      out.push({
        sel: s,
        px: parseFloat(cs.fontSize),
        peso: cs.fontWeight,
        ratio: Math.round(ratio(comp, fondo) * 100) / 100,
      });
    }
    return out;
  })()
`;

const navegador = await chromium.launch();

try {
  for (const c of capturas) {
    const pagina = await navegador.newPage({
      viewport: { width: c.ancho, height: c.alto },
    });

    await pagina.goto(URL_BASE + c.url, { waitUntil: "networkidle" });
    await pagina.waitForTimeout(900);

    const archivo = SALIDA + "/" + c.nombre + ".png";
    await pagina.screenshot({ path: archivo, fullPage: !!c.completa });

    const ancho = await pagina.evaluate(() => ({
      cliente: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));

    // El contraste solo tiene sentido en la portada.
    let contrastes = [];
    if (c.url === "/") contrastes = await pagina.evaluate(CONTRASTE);

    console.log(
      "  " + c.nombre.padEnd(22) +
        (c.ancho + "px").padEnd(9) +
        "ancho " + ancho.cliente + "/" + ancho.scroll +
        (ancho.scroll - ancho.cliente > 1 ? "  DESBORDA" : "")
    );

    contrastes.forEach((k) => {
      // El mínimo de WCAG AA es 4,5:1 para texto normal y 3:1 para texto
      // grande (18,66 px en negrita o 24 px normal).
      const grande = k.peso >= 700 && k.px >= 18.66 ? true : k.px >= 24;
      const minimo = grande ? 3 : 4.5;
      const ok = k.ratio >= minimo;
      console.log(
        "      " + (ok ? "ok  " : "MAL ") + k.sel.padEnd(18) +
          String(k.ratio).padStart(6) + ":1  (min " + minimo + ")  " +
          k.px + "px/" + k.peso
      );
    });

    await pagina.close();
  }
} finally {
  await navegador.close();
}

console.log("");
console.log("capturas en " + SALIDA);