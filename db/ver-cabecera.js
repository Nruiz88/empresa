require("../lib/env").load();

const { createRequire } = require("module");
const req = createRequire("file:///D:/webs/empresa/db/ver-cabecera.js");
const { chromium } = req("D:/webs/wweb/node_modules/playwright");

const BASE = process.env.TEST_PANEL || "http://127.0.0.1:3000";
const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

/* ─────────────────────────────────────────────────────────────
   LA BARRA DE ARRIBA, ¿TAPA ALGUNO?

   En la foto de «Clientes» en escritorio el título sale cortado por
   arriba: la barra de la cabecera está encima en lugar de empujar.

   ── LA COMPROBACIÓN ──

     · la barra mide su caja;
     · se mira si es fija o pegajosa: `position: fixed`, `sticky`, o
       un ancestro que lo sea. Si no lo es, no puede tapar nada y la
       comprobación no dice nada;
     · con la barra pegajosa se compara su fondo contra el del primer
       contenido de la página.

   ── POR QUÉ MIRAR EL FONDO Y NO LA POSICIÓN ──

   Porque el síntoma no es que la barra se mueva: es que se sees
   ENCIMA. Una barra que ocupa sitio empuja el título hacia abajo; una
   que flota lo deja donde estaba, y el título se queda debajo.

   Y hay un caso peor: una barra pegajosa que además es opaca y está
   en `top: 0` sobre un contenido que no tiene `padding-top`. El
   resultado es exactamente el de la foto.
   ───────────────────────────────────────────────────────────── */

const RUTAS = [
  "/panel",
  "/panel/clientes",
  "/panel/servicios",
  "/panel/cobros",
  "/panel/bots",
  "/panel/tickets",
  "/panel/consultas",
  "/panel/aplicaciones",
  "/panel/aplicaciones/catalogo",
  "/panel/aplicaciones/nuevo",
  "/panel/planes",
  "/panel/catalogo",
  "/panel/salud",
  "/panel/accesos",
  "/panel/servidores",
  "/panel/clientes/nuevo",
  "/panel/servicios/nuevo",
  "/panel/mi-cuenta",
];

(async () => {
  const navegador = await chromium.launch();
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 } });

  const login = await ctx.newPage();
  await login.goto(BASE + "/panel/login");
  await login.fill('input[name="email"]', EMAIL);
  await login.fill('input[name="password"]', PASSWORD);
  await login.click('button[type="submit"]');
  await login.waitForLoadState("domcontentloaded");

  const p = await ctx.newPage();

  console.log("\n═══ La barra de arriba tapa al contenido? ═══\n");

  let malas = 0;

  for (const ruta of RUTAS) {
    try {
      await p.goto(BASE + ruta, { waitUntil: "domcontentloaded", timeout: 25000 });
      await p.waitForTimeout(250);

      const d = await p.evaluate(() => {
        /* ─────────────────────────────────────────────────────
           LA BARRA: LA DE ARRIBA, NO LA DEL MENÚ

           La primera versión cogía el elemento fijo más alto, que es
           el `aside` del menú lateral: mide 900px de alto y está a la
           izquierda. Su caja se solapa en VERTICAL con todo el
           contenido, y salía con «el título cortado 782px» en
           dieciocho pantallas. Falso positivo puro: el menú está al
           lado del contenido, no encima.

           ── POR QUÉ HAY QUE MIRAR LOS DOS EJES ──

           Un elemento está tapado cuando se solapa en horizontal Y
           en vertical. Solo en vertical, dos cajas pueden ocupar el
           mismo sitio sin tocarse, que es justo lo que pasa con una
           barra lateral y su contenido.

           La barra de arriba es la que cruza el ancho entero, y la que
           de verdad puede caer encima.
           ───────────────────────────────────────────────────── */
        let barra = null;

        for (const el of document.querySelectorAll("body *")) {
          const c = getComputedStyle(el);
          if (c.position !== "fixed" && c.position !== "sticky") continue;
          if (c.display === "none") continue;

          const r = el.getBoundingClientRect();
          if (r.height === 0 || r.width === 0) continue;
          if (r.top > 200) continue;

          /* La que cruza más ancho de la pantalla. Una barra lateral
             no cuenta: es una columna, no una tapa. */
          if (!barra || r.width > barra.getBoundingClientRect().width) barra = el;
        }

        if (!barra) return { sinBarra: true };

        const rb = barra.getBoundingClientRect();

        /* Se solapan en los dos ejes. */
        const encima = (a, b) =>
          a.top < b.bottom - 1 &&
          a.bottom > b.top + 1 &&
          a.left < b.right - 1 &&
          a.right > b.left + 1;

        /* Cuánto se ve tapado de verdad: la intersección de las dos
           cajas, no la diferencia de arriba. */
        const tapadoDe = (a, b) => {
          const alto = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          const ancho = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          if (alto <= 0 || ancho <= 0) return 0;
          return Math.round(ancho * alto);
        };

        const candidatos = [...document.querySelectorAll("h1, h2, .panel-page-head, main > *")];
        const tapados = [];

        for (const el of candidatos) {
          const c = getComputedStyle(el);
          if (c.display === "none" || c.visibility === "hidden") continue;

          const r = el.getBoundingClientRect();
          if (r.height === 0 || r.width === 0) continue;

          if (encima(r, rb)) {
            tapados.push({
              etiqueta: el.tagName.toLowerCase() + "." + (el.className || "(sin clase)"),
              area: tapadoDe(r, rb),
              texto: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40),
            });
          }
        }

        /* Y el título de la página, que es lo que se ve cortado. */
        const h1 = document.querySelector("h1");

        return {
          barra: {
            pos: getComputedStyle(barra).position,
            clase: barra.tagName.toLowerCase() + "." + (barra.className || "(sin clase)"),
            alto: Math.round(rb.height),
            ancho: Math.round(rb.width),
            fondo: getComputedStyle(barra).backgroundColor,
            opaco: getComputedStyle(barra).backgroundColor !== "rgba(0, 0, 0, 0)",
          },
          tapados,
          h1: h1
            ? {
                top: Math.round(h1.getBoundingClientRect().top),
                area: tapadoDe(h1.getBoundingClientRect(), rb),
                texto: (h1.textContent || "").trim().slice(0, 30),
              }
            : null,
        };
      });

      if (d.sinBarra) {
        console.log("  " + ruta.padEnd(32) + "  no hay barra fija ni pegajosa");
        continue;
      }

      const problemas = [];
      if (d.tapados.length) problemas.push(d.tapados.length + " bloques tapados");
      if (d.h1 && d.h1.area > 0) problemas.push("el título tapado (" + d.h1.area + "px²)");

      if (problemas.length) malas++;

      console.log(
        "  " + (problemas.length ? "FALLA" : "OK   ") + " " + ruta.padEnd(32) +
        d.barra.pos.padEnd(8) + d.barra.clase.slice(0, 26).padEnd(26) +
        "alto " + String(d.barra.alto).padStart(3) +
        " ancho " + String(d.barra.ancho).padStart(5) +
        (problemas.length ? "   " + problemas.join(", ") : "")
      );

      for (const t of d.tapados.slice(0, 2)) {
        console.log("          " + t.etiqueta.slice(0, 30).padEnd(30) + "tapado " + String(t.area).padStart(6) + "px²  «" + t.texto + "»");
      }
    } catch (e) {
      console.log("  " + ruta.padEnd(32) + "  ERROR " + e.message.split("\n")[0]);
    }
  }

  await navegador.close();

  console.log("");
  console.log("  ──────────────────────────────────────────────");
  console.log("  pantallas con la barra encima: " + malas + " de " + RUTAS.length);
  console.log("");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});
