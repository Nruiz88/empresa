require("../lib/env").load();

const { createRequire } = require("module");
const req = createRequire("file:///D:/webs/empresa/db/ver-desborde.js");
const { chromium } = req("D:/webs/wweb/node_modules/playwright");

const BASE = process.env.TEST_PANEL || "http://127.0.0.1:3000";
const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

/* ─────────────────────────────────────────────────────────────
   TEXTO QUE SE SALE DE SU CAJA

   `db/ver-css.js` mira si la PÁGINA desborda a lo ancho. Es una
   pregunta distinta de la que se hace aquí: una celda de tabla puede
   tener el texto más ancho que la celda sin que la página desborde,
   porque la tabla está dentro de un contenedor con scroll.

   ── POR QU NO BASTA EL QUE YA EXISTE ──

   El catálogo de aplicaciones tiene siete columnas y dos inputs en la
   primera, y una celda con dos nombres de plan y una lista de precios
   contratados. Donde eso no entra bien, el texto no empuja la página:
   se sale de su celda y queda encima de la de al lado, o se corta a
   media palabra.

   ── LA COMPROBACIÓN ──

   Para cada elemento con texto propio se compara `scrollWidth` con
   `clientWidth`. Si el contenido es más ancho que la caja, el texto se
   sale o se recorta.

   Se miran tres anchos porque el problema suele aparecer solo en uno:
   una tabla de siete columnas entra en un portátil de 1440 y se sale
   en una tablet, y al revés.
   ───────────────────────────────────────────────────────────── */

const ANCHOS = [
  { nombre: "escritorio 1440", ancho: 1440 },
  { nombre: "portátil 1280", ancho: 1280 },
  { nombre: "tablet 900", ancho: 900 },
  { nombre: "móvil 390", ancho: 390 },
];

const RUTAS = ["/panel/aplicaciones/catalogo", "/panel/aplicaciones", "/panel/planes"];

(async () => {
  const navegador = await chromium.launch();

  console.log("\n═══ Texto fuera de su caja ═══\n");

  let total = 0;

  for (const ruta of RUTAS) {
    console.log("  ── " + ruta + " ──");

    for (const v of ANCHOS) {
      const ctx = await navegador.newContext({ viewport: { width: v.ancho, height: 900 } });

      const login = await ctx.newPage();
      await login.goto(BASE + "/panel/login");
      await login.fill('input[name="email"]', EMAIL);
      await login.fill('input[name="password"]', PASSWORD);
      await login.click('button[type="submit"]');
      await login.waitForLoadState("domcontentloaded");

      const p = await ctx.newPage();
      await p.goto(BASE + ruta, { waitUntil: "domcontentloaded" });
      await p.waitForTimeout(350);

      const d = await p.evaluate(() => {
        /* ───────────────────────────────────────────────────
           QUÉ ES «EL ELEMENTO»

           Uno que tiene texto DIRECTO. Los contenedores no se
           miran: un `<td>` con un input dentro no desborda por el
           texto, desborda el input. Y los `input` se miran aparte,
           porque su contenido no es texto del DOM.
           ─────────────────────────────────────────────────── */
        const nodos = document.evaluate(
          "//text()[normalize-space(.) != '']",
          document,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
        );

        const salida = [];

        for (let i = 0; i < nodos.snapshotLength; i++) {
          const nodo = nodos.snapshotItem(i);
          const padre = nodo.parentElement;

          if (!padre) continue;

          const c = getComputedStyle(padre);

          /* Lo que no se ve, o lo que corta a propósito. */
          if (c.display === "none" || c.visibility === "hidden") continue;
          if (c.overflow === "hidden" || c.overflowY === "hidden") continue;
          if (c.textOverflow === "ellipsis") continue;
          if (c.whiteSpace === "nowrap") continue;

          /* Los que CNBCRAN a propósito: la tabla tiene scroll. */
          let enScroll = false;
          for (let a = padre; a; a = a.parentElement) {
            const ca = getComputedStyle(a);
            if (ca.overflowX === "auto" || ca.overflowX === "scroll" || ca.overflow === "auto") {
              enScroll = true;
              break;
            }
          }

          const desborde = padre.scrollWidth - padre.clientWidth;

          if (desborde > 1) {
            salida.push({
              clase: padre.tagName.toLowerCase() + "." + (padre.className || "(sin clase)"),
              ancho: padre.clientWidth,
              necesita: padre.scrollWidth,
              sobra: desborde,
              texto: nodo.textContent.trim().slice(0, 46),
              enScroll,
            });
          }
        }

        return {
          salida,
          paginaDesborda: document.documentElement.scrollWidth > window.innerWidth + 1,
        };
      });

      const sinScroll = d.salida.filter((x) => !x.enScroll);

      console.log(
        "    " + v.nombre.padEnd(18) +
        " " +
        (d.paginaDesborda ? "página desborda  " : "página ok        ") +
        "fuera de caja: " +
        (sinScroll.length ? String(sinScroll.length).padStart(3) : "  0")
      );

      total += sinScroll.length;

      /* Solo se detalle el primero: si son veinte elementos por la
         misma regla de CSS, veinte líneas no explican nada que no
         explique una. */
      for (const x of sinScroll.slice(0, 4)) {
        console.log(
          "        " + x.clase.slice(0, 40).padEnd(40) +
          "caja " + String(x.ancho).padStart(4) +
          " necesita " + String(x.necesita).padStart(4) +
          "  «" + x.texto + "»"
        );
      }

      await ctx.close();
    }

    console.log("");
  }

  await navegador.close();

  console.log("  ──────────────────────────────────────────────");
  console.log(
    "  total de textos fuera de su caja: " + total +
    (total === 0 ? "   ✓" : "   ← hay que mirar")
  );
  console.log("");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});
