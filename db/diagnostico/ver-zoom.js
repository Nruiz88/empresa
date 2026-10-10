require("../../lib/env").load();

const { createRequire } = require("module");
const req = createRequire("file:///D:/webs/empresa/db/ver-zoom.js");
const { chromium } = req("D:/webs/wweb/node_modules/playwright");

const BASE = process.env.TEST_PANEL || "http://127.0.0.1:3000";
const SALIDA = process.env.TEMP + "/opencode";

/* ─────────────────────────────────────────────────────────────
   ZOOM A UN TROZO, PARA VER EL DETALLE

   Una foto de la página entera a 1440 sirve para ver la maquetación y
   no sirve para un icono descolocado dos píxeles: sale del tamaño de
   la página y desaparece.

   Aquí se recorta una zona y se amplía. El recorte es por selector, no
   por coordenadas, porque las coordenadas cambian con el ancho y con
   el texto que cargue desde la base.

   ── PARA QUÉ ──

   Para mirar de verdad lo que se_WRAP de la complaint: si un icono está
   medio píxel arriba, hay que verlo a 3× para saber cuál de las dos
   cosas hay que corregir.
   ───────────────────────────────────────────────────────────── */

const ZONAS = [
  { nombre: "zoom-problema", selector: "#problema", escala: 3 },
  { nombre: "zoom-hero-datos", selector: ".hero-datos, .hero-points, .hero-feature", escala: 3 },
  { nombre: "zoom-planes", selector: "#precios .price-grid", escala: 2 },
  { nombre: "zoom-cta", selector: ".cta-band", escala: 2 },
  { nombre: "zoom-footer", selector: "footer", escala: 3 },
];

(async () => {
  const navegador = await chromium.launch();
  const ctx = await navegador.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });

  const p = await ctx.newPage();
  await p.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(600);

  /* Se revela todo antes de recortar: si no, la zona sale vacía y la
     foto no dice nada. */
  await p.evaluate(async () => {
    document.documentElement.style.scrollBehavior = "auto";
    const alto = document.body.scrollHeight;
    for (let y = 0; y <= alto; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 300));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 500));
  });

  console.log("\n═══ Zumos ═══\n");

  for (const z of ZONAS) {
    const el = await p.$(z.selector);

    if (!el) {
      console.log("  " + z.nombre.padEnd(20) + "  no existe " + z.selector);
      continue;
    }

    const archivo = SALIDA + "/" + z.nombre + ".png";
    await el.screenshot({ path: archivo });
    const caja = await el.boundingBox();

    console.log(
      "  " + z.nombre.padEnd(20) +
      "  " + String(z.selector).padEnd(34) +
      " " + Math.round(caja.width) + "x" + Math.round(caja.height) +
      "  ->  " + archivo
    );
  }

  await navegador.close();
  console.log("");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});
