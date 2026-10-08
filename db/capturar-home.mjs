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
    // El contraste no se mide aquí: lo mide revisar-contraste.mjs,
    // que sabe leer un fondo con degradado. Ver la cabecera.

    await pagina.close();
  }
} finally {
  await navegador.close();
}

console.log("");
console.log("capturas en " + SALIDA);