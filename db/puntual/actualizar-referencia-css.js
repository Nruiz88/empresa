const fs = require("fs");
const path = require("path");

/* ═══════════════════════════════════════════════════════════════
   ACTUALIZAR LA REFERENCIA DEL CSS DEL PANEL

   ── QUÉ ES ESTE ARCHIVO ──

   `panel.antes-de-dividir.css` es la copia del CSS de antes de
   partirlo en doce módulos. Sirve para una sola cosa: que
   `db/herramientas/ver-modulos-css.js` compruebe que la concatenación
   de los módulos da exactamente lo mismo que el archivo único.

   ── POR QUÉ HAY QUE ACTUALIZARLA ──

   Porque cambié los tokens a propósito: la escala de planos y de
   sombras. El comparador no distingue un cambio intencionado de uno
   accidental, así que avisa igual. Y avisa bien.

   ── POR QUÉ NO SE PUEDE HACER A MANO ──

   Porque el comparador no compara los archivos enteros: quita la
   cabecera de cada módulo y luego los une. Si la referencia se
   escribe de otra manera —concatenando con `""`, quitando líneas de
   más— el resultado no coincide nunca y el fallo parece del CSS
   cuando en realidad es del guion de actualización. Ya pasó dos
   veces: 231.937 contra 221.906, y luego 231.216 contra 221.845.

   ── LA REGLA ──

   Este guion copia exactamente lo que hace el comparador: quitar el
   primer bloque de comentario de cada módulo, quitar los saltos que
   quedan justo después, quitar solo los espacios del final de línea
   (nunca los saltos), y unir con dos saltos.

   Copiar el criterio es lo que hace que la comparación signifique
   algo. Dos implementaciones parecidas daría dos veredictos, y si
   difieren no se sabe cuál dice la verdad.
   ═══════════════════════════════════════════════════════════════ */

const CSS = "D:/webs/empresa/public/css";
const MANIFIESTO = path.join(CSS, "panel.orden.json");
const REFERENCIA = path.join(CSS, "panel.antes-de-dividir.css");

const orden = JSON.parse(fs.readFileSync(MANIFIESTO, "utf8"));
const nombres = orden.modulos || orden;

/* Se lee ANTES de escribir, porque de ahí sale la cabecera. */

/* El mismo criterio que el comparador, línea por línea. */
const sinCR = (t) => t.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

/* La referencia se lee ANTES de escribir, porque de ahí sale la
   cabecera que se pone delante del primer módulo. */
const refOriginal = sinCR(fs.readFileSync(REFERENCIA, "utf8"));

const cuerpos = nombres.map((nombre) => {
  const t = sinCR(fs.readFileSync(path.join(CSS, nombre), "utf8"));
  const fin = t.indexOf("*/");

  return (fin < 0 ? t : t.slice(fin + 2))
    .replace(/^\n+/, "")
    .replace(/[ \t]+$/, "");
});

/* ── LA CABECERA DEL ARCHIVO ANTIGUO ──

   El primer módulo no empieza en la línea 1 del `panel.css` viejo:
   empieza en su primer encabezado. Lo que hay por delante —el título
   del archivo y la nota de las 7000 líneas— no lo carga ningún módulo.

   Se lee de la propia referencia, que es donde está, en vez de
   reconstruirlo: si el título cambia, sale de ella. */

const linea = refOriginal.split("\n");
const corte = linea.findIndex((l) => l.trim() === "1. BASE Y MEDIDAS");

const CABECERA =
  corte > 0 ? linea.slice(0, corte - 1).join("\n").replace(/\s+$/, "") : "";

const referencia = cuerpos
  .map((cuerpo, i) => (i === 0 ? CABECERA + "\n\n" + cuerpo : cuerpo))
  .join("\n")
  .replace(/\n+$/, "") + "\n";

fs.writeFileSync(REFERENCIA, referencia, "utf8");

console.log("\n═══ La referencia, al día ═══\n");
console.log("  módulos: " + nombres.length);
console.log("  escrito: " + referencia.length.toLocaleString("es-AR") + " caracteres");
console.log("");