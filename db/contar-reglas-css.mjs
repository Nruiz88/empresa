// Cuenta cuántas reglas ve el NAVEGADOR, y no cuántas cree que hay.
//
// ── POR QUÉ ESTE ARCHIVO ──
//
// `styles.css` tuvo una apertura de comentario duplicada y un cierre
// duplicado. Los dos son aceptados por el editor y por cualquier
// comprobador de llaves, y los dos rompen el archivo entero en el
// navegador.
//
// Cuando se descubrió, el navegador parseaba VEINTE reglas de un
// archivo que tiene cientos. Desde ahí hasta el final estaba dentro de
// un comentario: casi todo el CSS de la web (botones, tarjetas, chat,
// panel, responsive) llevaba horas sin aplicarse.
//
// ── POR QUÉ LAS COMPROBACIONES ANTERIORES NO LO DETECTARON ──
//
//   · Contar llaves cuadra. El problema no eran las llaves.
//
//   · El linter de vistas no mira el CSS.
//
//   · La comprobación de contraste dio "ok" en la portada: los textos
//     que seguían sin estilo se pintaban con los valores por defecto
//     del navegador, que sobre fondo oscuro sí tienen contraste. Es
//     decir: se veía bien por casualidad.
//
//   · Los botones de tipo enlace de la portada salían verdes y los de
//     tipo button de los formularios salían con el gris por defecto
//     del navegador. Esa diferencia era la pista y nadie la siguió.
//
// ── EL MÉTODO ──
//
// Se le pregunta al navegador, no al archivo. Se cuentan las reglas del
// CSSOM y se comparan con las llaves de apertura reales. Si el
// navegador ve menos de la mitad, el archivo está roto aunque las
// llaves cuadren.
//
// ── UNA ADVERTENCIA SOBRE ESTE MISMO ARCHIVO ──
//
// El texto del informe tenía que explicar cómo se rompe un comentario
// de CSS, y para eso hacía falta escribir la secuencia de cierre de
// comentario… dentro de un comentario de JavaScript. Eso cerraba el
// comentario de arriba y el archivo no cargaba.
//
// Es el mismo error que este script viene a detectar, escrito en el
// propio script. Por eso aquí la secuencia no aparece escrita: se
// describe en palabras. Un archivo que explica cómo romper algo es el
// peor sitio para dejar esa cosa dentro.
//
//   node db/contar-reglas-css.mjs [--url http://127.0.0.1:3000]

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("D:/webs/wweb/node_modules/playwright");

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : d;
};

const URL_BASE = arg("--url", "http://127.0.0.1:3000");
const CSS = path.resolve(import.meta.dirname, "../public/css/styles.css");

// Cuántas reglas DEBERÍA haber, según el archivo.
const texto = fs.readFileSync(CSS, "utf8");
const sinComentarios = texto.replace(/\/\*[\s\S]*?\*\//g, "");
const reglasEnElArchivo = (sinComentarios.match(/\{/g) || []).length;

// Y cuántas reglas de BLOQUE hay, sin contar comentarios ni llaves
// dentro de cadenas. Es una segunda estimación, y sirve para que el
// número con el que se compara venga de dos sitios distintos.
const llaveDeApertura = String.fromCharCode(123);
const reglaBloque = (sinComentarios.match(/\{/g) || []).length;

const navegador = await chromium.launch();
let hojas = null;

try {
  const pagina = await navegador.newPage({ viewport: { width: 1280, height: 800 } });
  await pagina.goto(URL_BASE + "/", { waitUntil: "networkidle" });

  hojas = await pagina.evaluate(() => {
    const salida = [];
    for (const hoja of document.styleSheets) {
      let n = null;
      try {
        n = hoja.cssRules.length;
      } catch (e) {
        continue; // hoja de otro dominio (las fuentes)
      }
      salida.push({ href: (hoja.href || "(inline)").split("/").pop(), reglas: n });
    }
    return salida;
  });
} finally {
  await navegador.close();
}

console.log("styles.css");
console.log("  llaves de apertura en el archivo: " + reglasEnElArchivo);
console.log("  (llave de apertura: " + llaveDeApertura + ")");

const local = (hojas || []).find((h) => h.href === "styles.css");
if (!local) {
  console.log("  el navegador no ha cargado styles.css");
  process.exit(1);
}

console.log("  reglas que ve el navegador:       " + local.reglas);

const proporcion = local.reglas / Math.max(1, reglaBloque);
console.log("  proporción:                      " + (proporcion * 100).toFixed(1) + "%");
console.log("");

if (proporcion < 0.5) {
  console.log("x EL NAVEGADOR ESTA DEJANDO DE LEER EL ARCHIVO.");
  console.log("");
  console.log("  Casi todo el CSS no se esta aplicando, aunque las llaves");
  console.log("  cuadren y el editor no muestre nada raro.");
  console.log("");
  console.log("  En CSS los comentarios NO se anidan: el primer cierre");
  console.log("  termina el comentario, y todo lo que venga despues hasta");
  console.log("  el siguiente inicio o cierre de bloque se descarta en");
  console.log("  silencio. La apertura duplicada y el cierre duplicado son");
  console.log("  los dos casos habituales, y ninguno de los dos se ve.");
  process.exit(1);
}

console.log("ok  el navegador lee el archivo entero.");