/* Captura la web publica y la seccion de WhatsApp.
 *
 * node db/ver-web.mjs [--url http://127.0.0.1:3000] [--ancho 1440] [--tema light]
 *
 * ── PARA QUE ESTE ──
 *
 * db/ver-panel.mjs ya existe para el panel, y hacia falta lo mismo
 * para la web por una razón concreta: la seccion de WhatsApp es un
 * chat con JavaScript, y un chat sin ejecutar no se puede revisar.
 *
 * Una captura del HTML plano saldria con el contenedor del chat
 * vacio —los mensajes los pinta el script— y se veria perfecto
 * cuando en realidad no funciona. Aqui ademas se pulsa un boton de
 * ejemplo y se espera a la respuesta, de modo que lo que sale en la
 * foto es lo que veria alguien que llega y escribe.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(import.meta.dirname, "..");

function arg(n, d) {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : d;
}

const BASE = arg("--url", process.env.PANEL_URL || "http://127.0.0.1:3000");
const ANCHO = Number(arg("--ancho", "1440"));
const TEMA = arg("--tema", "");
const SALIDA = path.resolve(RAIZ, arg("--salida", "capturas"));

fs.mkdirSync(SALIDA, { recursive: true });

const { chromium } = require("D:/webs/wweb/node_modules/playwright");

const navegador = await chromium.launch();
const ctx = await navegador.newContext({
  viewport: { width: ANCHO, height: ANCHO < 700 ? 844 : 950 },
  deviceScaleFactor: 2,
  isMobile: ANCHO < 700,
  hasTouch: ANCHO < 700,
});

if (TEMA) {
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem("nexo-theme", t);
    } catch {}
    document.addEventListener("DOMContentLoaded", () => {
      document.documentElement.className = t === "dark" ? "" : "theme-" + t;
    });
  }, TEMA);
}

const pagina = await ctx.newPage();

const sufijo = (ANCHO < 700 ? "-movil" : "") + (TEMA ? "-" + TEMA : "");

console.log("");
console.log("=== Capturas de la web ===");
console.log("");
console.log("  sitio: " + BASE + "   ancho: " + ANCHO);
console.log("");

/* ── La home entera ── */
{
  const destino = path.join(SALIDA, `web-home${sufijo}.png`);
  const r = await pagina.goto(BASE + "/", { waitUntil: "networkidle", timeout: 25000 });
  await pagina.waitForTimeout(500);
  await pagina.screenshot({ path: destino, fullPage: true });
  console.log("  " + r.status() + "  /                     -> " + path.basename(destino));
}

/* ── La sección del bot, con el chat funcionando ──
   Se hace aparte porque la home es larga y la sección quedaría
   diminuta en una captura de página entera. */
{
  const destino = path.join(SALIDA, `web-bot${sufijo}.png`);

  await pagina.goto(BASE + "/", { waitUntil: "networkidle", timeout: 25000 });

  const seccion = await pagina.$("#whatsapp");
  if (!seccion) {
    console.log("  !!  no se encuentra la sección #whatsapp en la home");
  } else {
    /* Se escribe algo de verdad antes de sacar la foto. Es lo que
       distingue esta captura de un HTML vacío: si el script no
       funciona, aquí no habría ni un mensaje nuevo y se vería un
       contenedor con un solo texto dentro. */
    const chip = await pagina.$('.wa-chip[data-demo="cita"]');
    if (chip) await chip.click();
    await pagina.waitForTimeout(1200);

    const entrada = await pagina.$("#demo-entrada");
    if (entrada) {
      await entrada.fill("hola, esto funciona?");
      await pagina.keyboard.press("Enter");
      await pagina.waitForTimeout(1200);
    }

    await seccion.scrollIntoViewIfNeeded();
    await pagina.waitForTimeout(400);
    await seccion.screenshot({ path: destino });

    const mensajes = await pagina.$$eval(".wa-msg", (n) => n.length);
    console.log(
      "  200  /#whatsapp             -> " + path.basename(destino) +
      "   (" + mensajes + " mensajes en el chat)"
    );

    /* Si el chat no grew, el script no está corriendo, y la foto
       parecería estar bien mientras no hace nada. */
    if (mensajes < 3) {
      console.log("  !!  el chat no ha crecido: puede que demo-bot.js no cargue");
    }
  }
}

/* ── Las dos pantallas de cuenta ── */
for (const [ruta, nombre] of [["/cuenta/crear", "crear"], ["/cuenta/entrar", "entrar"]]) {
  const destino = path.join(SALIDA, `web-cuenta-${nombre}${sufijo}.png`);
  try {
    const r = await pagina.goto(BASE + ruta, { waitUntil: "networkidle", timeout: 25000 });
    await pagina.waitForTimeout(300);
    await pagina.screenshot({ path: destino, fullPage: true });
    console.log("  " + r.status() + "  " + ruta.padEnd(22) + "-> " + path.basename(destino));
  } catch (e) {
    console.log("  ERR  " + ruta + "  " + e.message.slice(0, 50));
  }
}

await navegador.close();

console.log("");
console.log("  en " + SALIDA);
console.log("");