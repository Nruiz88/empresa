require("../lib/env").load();

const { createRequire } = require("module");
const req = createRequire("file:///D:/webs/empresa/db/capturar.js");
const { chromium } = req("D:/webs/wweb/node_modules/playwright");

const BASE = process.env.TEST_PANEL || "http://127.0.0.1:3000";
const SALIDA = process.env.TEMP + "/opencode";

/* ─────────────────────────────────────────────────────────────
   UNA FOTO DE LA HOME, PARA MIRARLA

   Las comprobaciones automáticas dicen que los iconos están bien
   colocados. La persona que mira la pantalla dice que no. Cuando eso
   pasa, la comprobación está mal: no sirve de nada seguir afinando un
   número que da cero si lo que falla es otra cosa.

   Así que se saca la foto y se mira.

   ── POR QUÉ VARIAS ──

   Porque el mismo fallo se ve distinto en un ancho y en otro: en
   escritorio algo que se sale dos píxeles no se nota, y en móvil se
   sale de la pantalla. Y porque una foto de la página entera no deja
   ver un icono descolocado: hay que subir a la zona donde está.

   Se hace una por franja, para que el detalle se vea de verdad.
   ───────────────────────────────────────────────────────────── */

const RUTAS = ["/"];

const VISTAS = [
  { nombre: "home-escritorio", ancho: 1440, alto: 900, completa: true },
  { nombre: "home-movil", ancho: 390, alto: 844, completa: true },
];

(async () => {
  const navegador = await chromium.launch();

  console.log("\n═══ Capturas ═══\n");

  for (const ruta of RUTAS) {
    for (const v of VISTAS) {
      const ctx = await navegador.newContext({
        viewport: { width: v.ancho, height: v.alto },
        deviceScaleFactor: 2,
      });

      const p = await ctx.newPage();
      await p.goto(BASE + ruta, { waitUntil: "domcontentloaded" });
      await p.waitForTimeout(900);

      /* Se baja la página entera para que se dispare todo lo que se
         anima al aparecer, y para que no se queden fotos a medio
         cargar. */
      /* ─────────────────────────────────────────────────────
         EL SCROLL, SIN SUAVIZADO Y CON TIEMPO

         La primera versión hacía `window.scrollTo(0, y)` en pasos de
         600px con 120ms de espera. Con `scroll-behavior: smooth` en
         la página, cada `scrollTo` retargeta el que estaba en marcha:
         no se llega al final y las secciones de abajo nunca entran en
         pantalla. La foto sale con huecos que NO existen, y parece un
         fallo de la página.

         Se pisa `scroll-behavior` con `auto` antes de empezar, y cada
         paso espera más de lo que tarda la animación de entrada
         (0.6 s).
         ───────────────────────────────────────────────────── */
      await p.evaluate(async () => {
        const previo = document.documentElement.style.scrollBehavior;
        document.documentElement.style.scrollBehavior = "auto";

        const alto = document.body.scrollHeight;
        const paso = Math.round(window.innerHeight * 0.6);

        for (let y = 0; y <= alto; y += paso) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 350));
        }

        window.scrollTo(0, alto);
        await new Promise((r) => setTimeout(r, 800));
        window.scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 500));

        document.documentElement.style.scrollBehavior = previo;
      });

      /* ── Y SE DICE SI QUEDÓ ALGO INVISIBLE ──

         Una foto no avisa de lo que no se ve. Antes de darla por
         buena se cuenta cuántos bloques con `.reveal` hay sin
         `is-visible`: si son cero, la foto es de la página entera; si
         no, la foto es una captura a medio camino y no vale. */
      const sinRevelar = await p.evaluate(
        () =>
          document.querySelectorAll(".reveal:not(.is-visible)").length
      );
      const totalRevelar = await p.evaluate(
        () => document.querySelectorAll(".reveal").length
      );

      if (sinRevelar) {
        console.log(
          "  ⚠ " + v.nombre + ": " + sinRevelar + " de " + totalRevelar +
          " bloques sin revelar. La foto no es de la página entera."
        );
      }

      const archivo = SALIDA + "/" + v.nombre + ".png";
      await p.screenshot({ path: archivo, fullPage: v.completa });

      const alto = await p.evaluate(() => document.body.scrollHeight);
      console.log(
        "  " + v.nombre.padEnd(20) + "  " + v.ancho + "px  alto " + String(alto).padStart(5) +
        "  bloques " + (totalRevelar - sinRevelar) + "/" + totalRevelar +
        "  ->  " + archivo
      );

      await ctx.close();
    }
  }

  await navegador.close();
  console.log("");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});
