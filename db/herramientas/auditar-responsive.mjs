/* Barrido responsive de la web pública.
 *
 *   node db/auditar-responsive.mjs [--url http://127.0.0.1:3000]
 *
 * ── POR QUÉ ESTE Y NO `buscar-desborde.mjs` ──
 *
 * `buscar-desborde.mjs` mide UNA página (la portada) a UN ancho (1440).
 * Eso contesta «¿se sale algo?» en el caso fácil, y deja fuera los dos
 * sitios donde de verdad se rompe una maqueta: los anchos pequeños —el
 * móvil de 320, que es el que menos sitio tiene— y las páginas
 * interiores, que no comparten la maqueta de la portada.
 *
 * Este barre los dos ejes: anchos de 320 a 1920 y todas las rutas
 * públicas.
 *
 * ── QUÉ CUENTA COMO FALLO, Y QUÉ NO ──
 *
 * Un elemento que sobresale NO siempre es un fallo: los aros decorativos
 * (`.aurora`) y la rejilla de fondo del hero se salen A PROPÓSITO y los
 * recorta un `overflow: hidden` del padre. Si se cuentan todos, el
 * informe sale con tres «fallos» que no hay que tocar y el cuarto —el
 * de verdad— se pierde entre ellos.
 *
 * Así que se distinguen:
 *
 *   · SCROLL   la página tiene scroll horizontal. ESTE es el fallo que
 *              hay que arreglar siempre.
 *   · recortado el elemento se sale pero un antepasado lo recorta: se
 *              informa y no se marca como fallo.
 *
 * Lo que no se puede ver desde aquí: que el texto se corte dentro de un
 * contenedor con `overflow: hidden` sin scroll. Eso se mira con el
 * navegador, o se ve en una captura.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("D:/webs/wweb/node_modules/playwright");

const arg = (n, pordefecto) => {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : pordefecto;
};

const URL_BASE = arg("--url", "http://127.0.0.1:3000");
const ANCHOS = [320, 360, 390, 414, 480, 640, 768, 1024, 1280, 1440, 1920];

/* Las rutas que existen de verdad.

   Se escriben a mano y no se leen del router porque este script no
   levanta la app: habla con la que ya está corriendo. Si cambian, hay
   que cambiarlas aquí.

   `/servicios`, `/proyectos` y `/blog` NO van: los tres redirigen a
   `/`, así que medirían la portada tres veces con otro nombre. */
const RUTAS = [
  "/",
  "/precios",
  "/contacto",
  "/privacidad",
  "/aviso-legal",
  "/cookies",
  "/condiciones",
];

const navegador = await chromium.launch();
let fallos = 0;

try {
  for (const ruta of RUTAS) {
    console.log("");
    console.log("══ " + ruta + " " + "═".repeat(Math.max(0, 58 - ruta.length)));

    for (const ancho of ANCHOS) {
      const pagina = await navegador.newPage({
        viewport: { width: ancho, height: 900 },
        deviceScaleFactor: 1,
        isMobile: ancho <= 480,
        hasTouch: ancho <= 480,
      });

      try {
        const res = await pagina.goto(URL_BASE + ruta, {
          waitUntil: "networkidle",
          timeout: 30000,
        });

        const status = res ? res.status() : 0;

        /* Los bloques con animación de entrada arrancan desplazados y
           con `opacity: 0`. Sin esperar, se miden en mitad del
           movimiento y salen desbordes que no existen en reposo. */
        await pagina.waitForTimeout(500);

        const r = await pagina.evaluate(() => {
          const limite = document.documentElement.clientWidth;
          const scroll = document.documentElement.scrollWidth;

          const recorta = (el) => {
            let p = el.parentElement;
            while (p && p !== document.documentElement) {
              const o = getComputedStyle(p);
              if (/hidden|clip|auto|scroll/.test(o.overflowX)) return true;
              p = p.parentElement;
            }
            return false;
          };

          const culpables = [];
          for (const el of document.querySelectorAll("body *")) {
            const caja = el.getBoundingClientRect();
            if (caja.width === 0 && caja.height === 0) continue;
            if (caja.right <= limite + 1) continue;
            const estilo = getComputedStyle(el);
            /* Lo invisible no molesta a nadie. */
            if (estilo.visibility === "hidden" || estilo.display === "none") continue;
            culpables.push({
              etiqueta:
                el.tagName.toLowerCase() +
                (typeof el.className === "string" && el.className.trim()
                  ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
                  : ""),
              sobra: Math.round(caja.right - limite),
              ancho: Math.round(caja.width),
              recortado: recorta(el),
            });
          }

          culpables.sort((a, b) => b.sobra - a.sobra);

          /* El ancho del objetivo táctil solo tiene sentido en táctil. */
          const pequenos = [];
          for (const el of document.querySelectorAll("a, button, input, select, textarea, [role='button']")) {
            const caja = el.getBoundingClientRect();
            if (caja.width === 0 || caja.height === 0) continue;
            const estilo = getComputedStyle(el);
            if (estilo.visibility === "hidden" || estilo.display === "none") continue;
            if (caja.height < 24 || caja.width < 24) {
              pequenos.push({
                etiqueta:
                  el.tagName.toLowerCase() +
                  (typeof el.className === "string" && el.className.trim()
                    ? "." + el.className.trim().split(/\s+/)[0]
                    : ""),
                texto: (el.textContent || "").trim().slice(0, 22),
                w: Math.round(caja.width),
                h: Math.round(caja.height),
              });
            }
          }

          return {
            limite,
            scroll,
            culpables: culpables.slice(0, 6),
            totalCulpables: culpables.length,
            pequenos: pequenos.slice(0, 4),
            totalPequenos: pequenos.length,
          };
        });

        const scrollH = r.scroll > r.limite + 1;
        const noRecortados = r.culpables.filter((c) => !c.recortado);

        let linea = "  " + String(ancho).padStart(4) + "px  ";
        linea += status === 200 ? "200 " : "HTTP " + status + " ";

        if (scrollH) {
          fallos++;
          linea += "SCROLL HORIZONTAL  (+" + (r.scroll - r.limite) + "px)";
        } else {
          linea += "sin scroll";
          if (r.totalCulpables) {
            linea += "  ·  " + r.totalCulpables + " se salen, recortados";
          }
          if (noRecortados.length) linea += "  ·  ⚠ " + noRecortados.length + " SIN recortar";
        }
        console.log(linea);

        for (const c of r.culpables) {
          console.log(
            "          " +
              (c.recortado ? "·" : "⚠") +
              " " +
              c.etiqueta.padEnd(40) +
              "sobra " +
              String(c.sobra).padStart(4) +
              " px"
          );
        }

        if (ancho <= 480 && r.totalPequenos) {
          console.log("          objetivos por debajo de 24px: " + r.totalPequenos);
          for (const p of r.pequenos) {
            console.log("          · " + p.etiqueta.padEnd(30) + p.w + "x" + p.h + '  "' + p.texto + '"');
          }
        }
      } catch (err) {
        fallos++;
        console.log("  " + String(ancho).padStart(4) + "px  ERROR: " + err.message);
      } finally {
        await pagina.close();
      }
    }
  }
} finally {
  await navegador.close();
}

console.log("");
console.log("═".repeat(62));
console.log(fallos === 0 ? "✓ Ningún ancho provoca scroll horizontal." : "⚠ " + fallos + " anchos con scroll horizontal.");
console.log("");
process.exit(fallos === 0 ? 0 : 1);
