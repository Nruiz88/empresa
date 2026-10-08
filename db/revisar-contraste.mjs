// Revisa el contraste de texto en TODAS las páginas, no solo en la
// portada.
//
// ── POR QUÉ NO BASTA CON MIRAR LA PORTADA ──
//
// El problema que acabamos de arreglar —el ámbar a 3,04:1— salía en la
// etiqueta de sección y en el enlace del pie. Pero `--accent-2` está en
// treinta reglas repartidas por el CSS, y muchas son de páginas que
// todavía no se han reescrito: /servicios, /proyectos, /blog, /contacto,
// /precios, el alta de cuenta.
//
// La portada no las toca, así que una comprobación de la portada da
// verde con el resto del sitio roto.
//
// ── CÓMO SE MIDE ──
//
// Con el navegador y los colores COMPUTADOS, no con los tokens: si una
// regla usa `color-mix` o hereda, el token dice una cosa y lo que se ve
// es otra. Y componiendo los fondos translúcidos sobre los opacos,
// porque comparar texto contra un `rgba(...)` al 14 % da un número que
// no es el de la pantalla.
//
// ── EL LISTAJO ──
//
// No se recorren todos los elementos (miles, y muchos son iconos sin
// texto). Se revisan los que llevan texto de verdad, se saltan los que
// están ocultos, y se agrupa por "archivo + selector" para que el
// informe diga qué arreglar y no 400 líneas repetidas.

import { createRequire } from "node:module";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("D:/webs/wweb/node_modules/playwright");

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : d;
};

const URL_BASE = arg("--url", "http://127.0.0.1:3000");

const PAGINAS = [
  "/",
  "/precios",
  "/servicios",
  "/proyectos",
  "/blog",
  "/contacto",
  "/cuenta/crear",
  "/cuenta/entrar",
  "/panel/login",
];

const MEDIR = `
  (function () {
    const lum = (r, g, b) => {
      const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const nums = (c) => (c.match(/[\\d.]+/g) || []).map(Number);
    const rgba = (c) => {
      const n = nums(c);
      return n.length >= 4 && n[3] < 1;
    };
    const sobre = (a, f) => {
      const x = nums(a), y = Array.isArray(f) ? f : nums(f);
      if (x.length < 4 || x[3] >= 1) return x.slice(0, 3);
      return [x[0]*x[3]+y[0]*(1-x[3]), x[1]*x[3]+y[1]*(1-x[3]), x[2]*x[3]+y[2]*(1-x[3])];
    };
    const fondoDe = (el) => {
      const pila = [];
      let p = el;
      while (p) {
        const c = getComputedStyle(p).backgroundColor;
        if (!rgba(c)) { pila.push(c); break; }
        pila.push(c);
        p = p.parentElement;
      }
      let fondo = nums(pila[pila.length - 1]).slice(0, 3);
      for (let i = pila.length - 2; i >= 0; i--) fondo = sobre(pila[i], fondo);
      return fondo;
    };
    const ratio = (a, b) => {
      const la = lum(a[0], a[1], a[2]), lb = lum(b[0], b[1], b[2]);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };

    const salida = [];
    for (const el of document.querySelectorAll("body *")) {
      // Solo elementos con texto propio, no contenedores que lo tienen
      // dentro: si no, cada linea cuenta tantas veces como sus
      // contenedores y el informe se llena de ruido.
      const propios = [...el.childNodes]
        .filter((n) => n.nodeType === 3 && n.textContent.trim().length > 1)
        .map((n) => n.textContent.trim()).join(" ");
      if (!propios) continue;

      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      if (parseFloat(cs.opacity) < 0.15) continue;

      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;

      const px = parseFloat(cs.fontSize);
      const peso = parseInt(cs.fontWeight, 10) || 400;
      const grande = px >= 24 || (px >= 18.66 && peso >= 700);
      const minimo = grande ? 3 : 4.5;

      // El texto con degradado tiene el color en "transparent" y se
      // pinta con "background-clip: text". Sin esta salvedad sale como
      // 1:1 y parece un fallo de color donde lo que hay es un degradado
      // que se ve bien: el informe enseñaba un problema falso y eso
      // hace que deje de mirarse.
      const conDegradado = (cs.webkitBackgroundClip || cs.backgroundClip || "") === "text";
      if (conDegradado || cs.color === "rgba(0, 0, 0, 0)") continue;

      const texto = rgba(cs.color) ? sobre(cs.color, fondoDe(el)) : nums(cs.color).slice(0, 3);
      const r_ = ratio(texto, fondoDe(el));

      if (r_ < minimo) {
        salida.push({
          sel: el.tagName.toLowerCase() + "." + String(el.className || "").trim().split(/\\s+/).slice(0, 2).join("."),
          texto: propios.slice(0, 40),
          ratio: Math.round(r_ * 100) / 100,
          minimo,
          px,
          color: cs.color,
        });
      }
    }
    return salida;
  })()
`;

const navegador = await chromium.launch();
const resumen = new Map();

try {
  for (const ruta of PAGINAS) {
    const pagina = await navegador.newPage({ viewport: { width: 1440, height: 900 } });
    let estado = "ok";

    try {
      await pagina.goto(URL_BASE + ruta, { waitUntil: "domcontentloaded" });
      await pagina.waitForTimeout(700);

      const malos = await pagina.evaluate(MEDIR);

      if (malos.length) {
        estado = malos.length + " sin legibilidad";
        for (const m of malos) {
          const clave = ruta + "  " + m.sel + "  (" + m.ratio + ":1, min " + m.minimo + ", " + m.color + ")";
          if (!resumen.has(clave)) resumen.set(clave, { ruta, ...m });
        }
      }
    } catch (e) {
      estado = "no se pudo abrir";
    }

    console.log("  " + ruta.padEnd(20) + estado);
    await pagina.close();
  }
} finally {
  await navegador.close();
}

console.log("");
if (!resumen.size) {
  console.log("Ningun texto por debajo del minimo de WCAG AA.");
} else {
  console.log("Texto por debajo del minimo (" + resumen.size + " casos distintos):");
  console.log("");
  [...resumen.values()].forEach((m) => {
    console.log(
      "  " + (m.ratio + ":1").padStart(8) + " (min " + m.minimo + ")  " +
      m.color.padEnd(22) + m.px + "px  " + m.ruta
    );
    console.log("            " + m.sel + "   «" + m.texto + "»");
  });
}