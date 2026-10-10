// Reescribe la imagen de Open Graph con la marca nueva.
//
// ── POR QUÉ NO SE TOCA A MANO ──
//
// El logo es un JPEG: para meterlo en el SVG hay que embeberlo como
// data URI en base64. Ese base64 son unos 10.000 caracteres en una
// linea, y si se escribiera dentro del .svg a mano, la primera vez que
// alguien regenerara el logo habria que rehacer esa linea entera. Con
// este script, cambiar el logo es cambiar el archivo y volver a correr.
//
// ── POR QUÉ NO SE USA UNA PLANTILLA DE TEXTO ──
//
// La primera version de este script construia el SVG con una plantilla
// entre acentos graves. Al escribir el bloque del logo, los `${...}`
// quedaron escapados y salieron EN EL ARCHIVO como texto literal: el
// SVG era XML valido, se veia en cualquier visor y no llevaba ni una
// letra del logo.
//
// Un error asi no falla: se publica. Por eso el archivo se compone con
// concatenacion normal y los numeros se calculan antes.
//
// ── POR QUÉ VA EN UN SVG Y NO EN UN PNG ──
//
// El SVG son 2 KB de texto. Un PNG de 1200x630 son entre 30 y 80 KB.
// La imagen de Open Graph se pide una vez por cada compartido, desde
// un movil con datos, y muchas veces antes de que la persona entre en
// la web.
//
// ── EL FONDO DEL LOGO ──
//
// El logo es un JPEG con fondo casi blanco y el fondo de esta imagen
// es azul noche. Tal cual, el logo sale como un rectangulo blanco.
//
// Se pone sobre una chapa blanca, igual que en la cabecera, para que
// el fondo sea parte del diseno y no parezca un error. Cuando llegue
// el PNG con transparencia, la chapa sobra en los dos sitios.

import fs from "node:fs";
import crypto from "node:crypto";

const RUTA_LOGO = "D:/webs/empresa/public/assets/shopcito-logo.jpg";
const RUTA_SALIDA = "D:/webs/empresa/public/assets/og-image.svg";

const logo = fs.readFileSync(RUTA_LOGO);
const b64 = logo.toString("base64");
const hash = crypto.createHash("sha256").update(logo).digest("hex");

/* ── EL BLANCO DE LA CHAPA ──
   El fondo del logo NO es blanco: medido sobre sus cuatro esquinas y
   los bordes, va de #EFF4ED a #F2F7F1, y el valor de en medio es
   #F0F5EE. Un blanco con un punto de verde.

   Con la chapa en #ffffff se ve un borde alrededor del logo: es el
   unico detalle que delata que el logo es un recorte sobre otra cosa.
   Por eso la chapa lleva el MISMO tono que el fondo del logo, medido
   y no inventado.

   El hash está para avisar. Si alguien cambia el logo y el fondo ya
   no es ese, la chapa se queda desfasada y el borde vuelve a
   aparecer; este aviso dice que hay que volver a medir. */
const FONDO_LOGO = "#f0f5ee";
const HASH_MEDIDO = "281e692";

if (!hash.startsWith(HASH_MEDIDO)) {
  console.log(
    "!  el logo ha cambiado desde que se midio el fondo (#" + FONDO_LOGO + ").\n" +
      "   Vuelve a medir las esquinas y actualiza FONDO_LOGO y HASH_MEDIDO,\n" +
      "   o la chapa va a delatar el recorte con un borde.\n"
  );
}

// El logo recortado mide 240x170. La chapa lleva 18 de margen por
// lado: menos y el verde queda pegado al borde, y con la esquina
// redondeada se ve el recorte del JPEG en la esquina.
const ANCHO_LOGO = 240;
const ALTO_LOGO = 170;
const MARGEN = 18;
const ANCHO_CHAPA = ANCHO_LOGO + MARGEN * 2; // 276
const ALTO_CHAPA = ALTO_LOGO + MARGEN * 2; // 206

// Posiciones. La chapa arriba y el texto debajo, con el nombre en el
// centro optical de la mitad baja: 404 es donde el ojo espera el
// titular, y no el medio exacto de los 630.
const Y_CHAPA = 118;
const X_CHAPA = Math.round((1200 - ANCHO_CHAPA) / 2);
const X_LOGO = Math.round((1200 - ANCHO_LOGO) / 2);
const Y_LOGO = Y_CHAPA + MARGEN;

const lineas = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">',

  "  <!-- Generado por db/generar-og.mjs. No editar a mano: el logo va",
  "       embebido en base64 y hay que regenerarlo desde el archivo. -->",

  "  <defs>",
  '    <linearGradient id="fondo" x1="0" y1="0" x2="1200" y2="630">',
  '      <stop offset="0%" stop-color="#0f172a" />',
  '      <stop offset="100%" stop-color="#065f46" />',
  "    </linearGradient>",
  '    <clipPath id="chapaClip">',
  '      <rect x="' + X_CHAPA + '" y="' + Y_CHAPA + '" width="' + ANCHO_CHAPA +
    '" height="' + ALTO_CHAPA + '" rx="22" />',
  "    </clipPath>",
  "  </defs>",

  '  <rect width="1200" height="630" rx="32" fill="url(#fondo)" />',

  "  <!-- La chapa del logo. El recorte evita que el blanco se escape",
  "       por las esquinas redondeadas del rectángulo. -->",
  '  <g clip-path="url(#chapaClip)">',
  '    <rect x="' + X_CHAPA + '" y="' + Y_CHAPA + '" width="' + ANCHO_CHAPA +
    '" height="' + ALTO_CHAPA + '" fill="' + FONDO_LOGO + '" />',
  '    <image href="data:image/jpeg;base64,' + b64 + '"',
  '           x="' + X_LOGO + '" y="' + Y_LOGO + '" width="' + ANCHO_LOGO +
    '" height="' + ALTO_LOGO + '" />',
  "  </g>",

  '  <text x="600" y="404" font-family="Outfit, system-ui, sans-serif" font-weight="700"',
  '        font-size="104" fill="#ffffff" text-anchor="middle">Shopcito</text>',

  '  <text x="600" y="472" font-family="Inter, system-ui, sans-serif" font-weight="400"',
  '        font-size="34" fill="#a7f3d0" text-anchor="middle">',
  "    Tu bot de WhatsApp · Mini shop · Turnos",
  "  </text>",

  '  <text x="600" y="556" font-family="Inter, system-ui, sans-serif" font-weight="400"',
  '        font-size="26" fill="rgba(255,255,255,0.7)" text-anchor="middle">shopcito.com.ar</text>',

  "</svg>",
  "",
];

const svg = lineas.join("\n");

/* ── Comprobaciones antes de escribir ──
   Un SVG con la base64 sin interpolar sigue siendo XML valido: se
   abre en cualquier visor y sale un rectángulo con un texto, sin
   logo y sin avisar. Estos son los fallos que se ven a ojo y que
   salen aquí. */
const problemas = [];

if (!svg.includes("data:image/jpeg;base64,")) problemas.push("no hay data URI del logo");
if (svg.includes("${")) problemas.push("queda un ${ sin interpolar");
if (!svg.includes(b64)) problemas.push("el base64 del logo no coincide con el archivo");
if (!svg.includes(">Shopcito<")) problemas.push("no aparece el nombre de la marca");

if (problemas.length) {
  console.log("x NO se escribe el archivo:");
  problemas.forEach((p) => console.log("    " + p));
  process.exit(1);
}

fs.writeFileSync(RUTA_SALIDA, svg, "utf8");

console.log("og-image.svg escrito: " + (Buffer.byteLength(svg) / 1024).toFixed(1) + " KB");
console.log("  logo embebido: " + b64.length + " caracteres base64");
console.log("  chapa: " + ANCHO_CHAPA + "x" + ALTO_CHAPA + " en (" + X_CHAPA + "," + Y_CHAPA + ")");
console.log("  logo:  " + ANCHO_LOGO + "x" + ALTO_LOGO + " en (" + X_LOGO + "," + Y_LOGO + ")");