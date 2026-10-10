// Captura la portada RECORRIÉNDOLA.
//
// ── POR QUÉ NO BASTA CON `fullPage: true` ──
//
// La captura de página entera no hace scroll: fotografía el documento
// entero de golpe. Los bloques con `.reveal` arrancan en `opacity: 0` y
// se muestran cuando un `IntersectionObserver` los ve entrar en
// pantalla, así que en la captura salen vacíos.
//
// Con un falso positivo grave: la primera versión de esta comprobación
// dio por hecho que las secciones estaban rotas y eran miles de píxeles
// de blanco en el contenido de la portada.
//
// Lo que hay que distinguir es eso de lo de verdad: que el contenido NO
// se muestre NUNCA. Eso se comprueba con JavaScript desactivado, que es
// lo que hace la segunda parte de este script.

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

const navegador = await chromium.launch();

try {
  /* ── 1. Con JavaScript, recorriendo ── */
  const pagina = await navegador.newPage({ viewport: { width: 1440, height: 900 } });
  await pagina.goto(URL_BASE + "/", { waitUntil: "networkidle" });

  const alto = await pagina.evaluate(() => document.body.scrollHeight);
  console.log("alto del documento: " + alto + " px");

  for (let y = 0; y < alto; y += 700) {
    await pagina.evaluate((yy) => window.scrollTo(0, yy), y);
    await pagina.waitForTimeout(260);
  }
  await pagina.waitForTimeout(900);

  const estado = await pagina.evaluate(() => {
    const todos = [...document.querySelectorAll(".reveal")];
    const ocultos = todos.filter((e) => parseFloat(getComputedStyle(e).opacity) < 0.9);
    return { total: todos.length, ocultos: ocultos.length, clases: ocultos.map((e) => e.className) };
  });

  console.log("  bloques .reveal: " + estado.total + ", siguen invisibles: " + estado.ocultos);
  if (estado.clases.length) console.log("  " + estado.clases.join("\n  "));

  await pagina.evaluate(() => window.scrollTo(0, 0));
  await pagina.waitForTimeout(400);
  await pagina.screenshot({ path: SALIDA + "/recorriendo.png", fullPage: true });
  console.log("  captura: " + SALIDA + "/recorriendo.png");

  await pagina.close();

  /* ── 2. SIN JavaScript ──
     Esta es la prueba que de verdad importa. Si `.reveal` se queda en
     `opacity: 0` sin JS, toda la portada menos el hero es un bloque
     blanco: el visitante ve un titular, un botón y nada más. */
  const sinJs = await navegador.newContext({ javaScriptEnabled: false });
  const p2 = await sinJs.newPage({ viewport: { width: 1440, height: 900 } });
  await p2.goto(URL_BASE + "/", { waitUntil: "domcontentloaded" });
  await p2.waitForTimeout(800);

  const sin = await p2.evaluate(() => {
    const todos = [...document.querySelectorAll(".reveal")];
    const ocultos = todos.filter((e) => parseFloat(getComputedStyle(e).opacity) < 0.9);
    return { total: todos.length, ocultos: ocultos.length };
  }).catch(() => null);

  await p2.screenshot({ path: SALIDA + "/sin-javascript.png", fullPage: true });
  console.log("");
  console.log("SIN JavaScript:");
  if (sin) {
    console.log("  bloques .reveal: " + sin.total + ", invisibles: " + sin.ocultos);
    console.log(
      sin.ocultos > 0
        ? "  x " + sin.ocultos + " bloques con contenido NO SE LEEN sin JavaScript"
        : "  ok  todo el contenido se lee sin JavaScript"
    );
  } else {
    console.log("  (no se pudo medir; mira la captura a mano)");
  }
  console.log("  captura: " + SALIDA + "/sin-javascript.png");

  await sinJs.close();
} finally {
  await navegador.close();
}