require("../lib/env").load();

const { createRequire } = require("module");
const req = createRequire("file:///D:/webs/empresa/db/medir-marcas.js");
const { chromium } = req("D:/webs/wweb/node_modules/playwright");

const BASE = process.env.TEST_PANEL || "http://127.0.0.1:3000";

/* ─────────────────────────────────────────────────────────────
   LAS MARCAS DE LAS DOS COLUMNAS DEL DUELO

   «EL PROBLEMA DE HOY» y «LA SOLUCIÓN» son la misma lista puesta en
   dos columnas: tres puntos cada una, título en negrita y debajo el
   texto. Son espejo, y su Marca debería mirar igual.

   Una pone `.duelo-icon` de 38×38 y la otra `.paso-num` de 32×32.
   La diferencia no es un detalle: con el texto de la portada en
   `--fs-body`, la caja de 38 queda con casi el doble de alto que la
   línea del título, y por arriba sobresale y por abajo cuelga. Es lo
   que hace que una columna se lea más pesada que la otra aunque
   Weigh lo mismo.

   ── LO QUE SE MIDE ──

   Para cada una: el tamaño de la caja, el alto de la línea de texto
   que tiene al lado, y cuánto se sale la caja por arriba y por abajo
   respecto de esa línea. Un icono bien puesto tiene la caja dentro o
   apenas más alta, y su CENTRO cerca del centro de la línea.
   ───────────────────────────────────────────────────────────── */

(async () => {
  const navegador = await chromium.launch();
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();

  await p.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(500);
  await p.evaluate(async () => {
    document.documentElement.style.scrollBehavior = "auto";
    for (let y = 0; y <= document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 280));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 400));
  });

  const d = await p.evaluate(() => {
    const leer = (selCaja, selLinea) => {
      const cajas = [...document.querySelectorAll(selCaja)];
      const items = [...document.querySelectorAll(selCaja.replace(selCaja, "x"))];

      return cajas.map((caja, i) => {
        const rc = caja.getBoundingClientRect();

        /* La línea es el <strong> del mismo <li>. */
        const li = caja.closest("li");
        const strong = li ? li.querySelector("strong") : null;
        const rs = strong ? strong.getBoundingClientRect() : null;

        /* La primera caja de línea, que es la que hay que alinear:
           <strong> tiene dos líneas si el título parte. */
        const cs = strong ? getComputedStyle(strong) : null;
        const altoLinea = cs ? parseFloat(cs.lineHeight) || rs.height / Math.max(1, Math.round(rs.height / (parseFloat(cs.lineHeight) || rs.height))) : null;

        const svg = caja.querySelector("svg");
        const rs2 = svg ? svg.getBoundingClientRect() : null;

        return {
          caja: Math.round(rc.width) + "x" + Math.round(rc.height),
          tituloTop: rs ? Math.round(rs.top) : null,
          cajaTop: Math.round(rc.top),
          /* Cuánto sube la caja por encima del texto. */
          sube: rs ? Math.round(rs.top - rc.top) : null,
          /* La diferencia entre el centro de la caja y el de la
             primera línea de texto. */
          desvio: rs ? Math.round((rc.top + rc.height / 2) - (rs.top + altoLinea / 2)) : null,
          svg: rs2 ? Math.round(rs2.width) + "x" + Math.round(rs2.height) : null,

          /* ── EL GLIFO DENTRO DE LA CAJA ──
             El `svg` tiene el tamaño que le pone el CSS, pero lo que
             se ve es lo que hay DENTRO de él. Si el `viewBox` no está
             centrado sobre el dibujo, el svg mide 19 y el glifo
             aparece en un rincón.

             Se mide la caja real de los trazos, que es la del primer
             hijo del svg, y no la del svg. */
          glifo: (() => {
            if (!svg) return null;
            const hijos = svg.children;
            if (!hijos.length) return null;

            let x1 = Infinity;
            let y1 = Infinity;
            let x2 = -Infinity;
            let y2 = -Infinity;

            for (const h of hijos) {
              const rh = h.getBoundingClientRect();
              if (!rh.width && !rh.height) continue;
              x1 = Math.min(x1, rh.left);
              y1 = Math.min(y1, rh.top);
              x2 = Math.max(x2, rh.right);
              y2 = Math.max(y2, rh.bottom);
            }

            if (!isFinite(x1)) return null;

            return {
              /* Lo que sobra a la izquierda, arriba, derecha y abajo,
                 respecto de la caja. Si un lado sobra mucho, el
                 dibujo no está centrado en su viewBox. */
              izq: Math.round(x1 - rc.left),
              arr: Math.round(y1 - rc.top),
              der: Math.round(rc.right - x2),
              aba: Math.round(rc.bottom - y2),
              ancho: Math.round(x2 - x1),
              alto: Math.round(y2 - y1),
            };
          })(),

          radio: getComputedStyle(caja).borderRadius,
        };
      });
    };

    return {
      problema: leer(".duelo-icon"),
      solucion: leer(".paso-num"),
      fsBody: getComputedStyle(document.documentElement).getPropertyValue("--fs-body").trim(),
    };
  });

  await navegador.close();

  console.log("\n═══ Las dos marcas del duelo ═══\n");
  console.log("  --fs-body: " + d.fsBody + "\n");

  console.log("  EL PROBLEMA (.duelo-icon)");
  for (const x of d.problema) {
    console.log(
      "    caja " + x.caja.padEnd(8) +
      " svg " + String(x.svg).padEnd(7) +
      " sobresale " + String(x.sube).padStart(3) + "px arriba" +
      "   centro descentrado " + String(x.desvio).padStart(3) + "px"
    );

    if (x.glifo) {
      console.log(
        "             glifo " + (x.glifo.ancho + "x" + x.glifo.alto).padEnd(9) +
        "sobra  izq " + String(x.glifo.izq).padStart(3) +
        "  arr " + String(x.glifo.arr).padStart(3) +
        "  der " + String(x.glifo.der).padStart(3) +
        "  aba " + String(x.glifo.aba).padStart(3)
      );
    }
  }

  console.log("");
  console.log("  LA SOLUCIÓN (.paso-num)");
  for (const x of d.solucion) {
    console.log(
      "    caja " + x.caja.padEnd(8) +
      " svg " + String(x.svg).padEnd(7) +
      " radio " + String(x.radio).padEnd(8) +
      " sobresale " + String(x.sube).padStart(3) + "px arriba" +
      "   centro descentrado " + String(x.desvio).padStart(3) + "px"
    );
  }

  const altoProblema = d.problema[0] ? d.problema[0].caja.split("x")[1] : "?";
  const altoSolucion = d.solucion[0] ? d.solucion[0].caja.split("x")[1] : "?";

  console.log("");
  console.log("  ──────────────────────────────────────────────");
  console.log(
    "  diferencia de tamaño entre las dos columnas: " +
    (parseInt(altoProblema) - parseInt(altoSolucion)) + "px"
  );
  console.log("");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});
