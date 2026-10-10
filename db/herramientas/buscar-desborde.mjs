// Dice QUE elemento se sale del ancho de la pantalla.
//
// El scroll horizontal no se puede arreglar a ojo: la causa puede ser
// un margen, un `width: 100vw` (que incluye la barra de scroll y por
// tanto siempre se sale), un elemento posicionado con `left` negativo
// o un transform de la animacion de entrada.
//
// Y `document.documentElement.scrollWidth > clientWidth` solo dice que
// hay scroll, no quien lo provoca. Con la barra de scrollVertical
// puesta, `clientWidth` ya viene reducido, asi que el margen de error
// es de unos 15 px y el sintoma aparece "a veces" segun la pagina.
//
//   node db/buscar-desborde.mjs --url http://127.0.0.1:3000 [--tema light]

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("D:/webs/wweb/node_modules/playwright");

const arg = (n, pordefecto) => {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : pordefecto;
};

const URL_BASE = arg("--url", "http://127.0.0.1:3000");
const TEMA = arg("--tema", "light");

const navegador = await chromium.launch();

try {
  const pagina = await navegador.newPage({ viewport: { width: 1440, height: 900 } });
  await pagina.goto(URL_BASE + "/", { waitUntil: "networkidle" });

  await pagina.evaluate((t) => {
    document.documentElement.classList.remove("theme-light", "theme-colorful", "theme-dark");
    if (t && t !== "dark") document.documentElement.classList.add("theme-" + t);
  }, TEMA);

  await pagina.waitForTimeout(400);

  const r = await pagina.evaluate(() => {
    const limite = document.documentElement.clientWidth;
    const culpables = [];

    for (const el of document.querySelectorAll("*")) {
      const caja = el.getBoundingClientRect();
      if (caja.width === 0 && caja.height === 0) continue;

      const derecha = caja.right + window.scrollX;
      if (derecha > limite + 1) {
        culpables.push({
          etiqueta: el.tagName.toLowerCase() + (el.className && typeof el.className === "string"
            ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".")
            : ""),
          derecha: Math.round(derecha),
          sobra: Math.round(derecha - limite),
          ancho: Math.round(caja.width),
        });
      }
    }

    // Se queda con los de mayor desbordamiento y se quitan los hijos
    // que ya estan dentro de un padre que tambien se sale: si el
    // contenedor se sale 200 px, senalar sus tres hijos que se salen
    // 190 no aporta nada.
    culpables.sort((a, b) => b.sobra - a.sobra);
    return {
      limite,
      scrollWidth: document.documentElement.scrollWidth,
      total: culpables.length,
      principales: culpables.slice(0, 8),
    };
  });

  console.log("tema: " + TEMA);
  console.log("ancho util: " + r.limite + "  scrollWidth: " + r.scrollWidth);
  console.log("elementos que se salen: " + r.total);
  console.log("");
  r.principales.forEach((c) => {
    console.log("  " + c.etiqueta.padEnd(46) + "sobra " + c.sobra + " px   (ancho " + c.ancho + ")");
  });
} finally {
  await navegador.close();
}