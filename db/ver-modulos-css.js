const fs = require("fs");
const path = require("path");

const CSS = path.join("D:/webs/empresa", "public", "css");

/* ═══════════════════════════════════════════════════════════════
   COMPARAR EL CSS DE HOY CON EL DE LOS MÓDULOS

   ── POR QUÉ ESTA COMPROBACIÓN ──

   En CSS el orden de las reglas importa. Hay 28 selectores
   declarados más de una vez en `panel.css`, y algunos hasta tres, y
   el que gana es el último. Si al dividir en módulos las hojas se
   cargan en otro orden, esos 28 cambian de valor sin que ninguna
   herramienta lo diga: no hay error de sintaxis, no hay aviso, y la
   pantalla se ve distinta.

   Es la forma exacta de romper el CSS, y ya pasó cuatro veces.

   ── LO QUE COMPARA ──

   El `panel.css` de antes, contra la concatenación de los módulos
   en el orden del manifiesto. Si dan el MISMO texto, no puede haber
   ningún cambio de aspecto. Y si difieren, dice DÓNDE, para que se
   vea qué módulo se movió.

   ── POR QUÉ TEXTO Y NO UNA COMPARACIÓN DE ESTILO ──

     Porque comparar estilos calculados necesita un navegador y
     tarda. Y porque lo que hay que garantizar aquí es que el
     contenido no se movió, no que se vea igual: si el texto es
     idéntico, lo que se ve es idéntico por definición.
   ═══════════════════════════════════════════════════════════════ */

const MANIFIESTO = path.join(CSS, "panel.orden.json");

if (!fs.existsSync(MANIFIESTO)) {
  console.log("\n  Todavía no hay manifiesto. Nada que comparar todavía.\n");
  process.exit(0);
}

const orden = JSON.parse(fs.readFileSync(MANIFIESTO, "utf8"));

/* ── El CSS de antes, guardado en el momento de dividir ── */
const REFERENCIA = path.join(CSS, "panel.antes-de-dividir.css");

if (!fs.existsSync(REFERENCIA)) {
  console.log("\n  No hay copia de referencia. Se hace ahora.\n");
  fs.writeFileSync(REFERENCIA, fs.readFileSync(path.join(CSS, "panel.css"), "utf8"));
  process.exit(0);
}

/* ── NORMALIZAR LOS FINALES DE LÍNEA ──

   La referencia se guardó desde Windows con `Out-File`, que escribe
   CRLF, y los módulos se escriben con `writeFileSync`, que escribe
   LF. Son el mismo texto con los finales de línea distintos, y sin
   normalizar la comparación daría 7.322 diferencias de un carácter
   cada una.

   En CSS un `\r` no cambia nada: el analizador lo trata como
   espacio en blanco. Por eso se quitan de los dos lados antes de
   comparar, y no es una tolerancia: es que no son texto distinto. */
const sinCR = (t) => t.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

const original = sinCR(fs.readFileSync(REFERENCIA, "utf8"));

/* Lo que va antes del primer corte: la cabecera del archivo, que
   explica de qué va y lista el orden.

   Se busca por la LÍNEA del encabezado y no por un bloque de texto
   con `\n`, porque el archivo tiene finales de línea CRLF y la
   búsqueda con `\n` no lo encontraba: el resultado era 0 y la
   comparación salía siempre descuadrada en treinta y una líneas. */
const LINEAS_ORIGEN = original.split("\n");
const indicePrimerCorte = LINEAS_ORIGEN.findIndex((l) => l.trim() === "1. BASE Y MEDIDAS");

const CABECERA_ORIGINAL =
  indicePrimerCorte > 0
    ? LINEAS_ORIGEN.slice(0, indicePrimerCorte - 1).join("\n").replace(/\s+$/, "")
    : "";

/* ── Lo que dicen los módulos, en el orden del manifiesto ── */

const concatenado = orden
  .map((nombre) => {
    const p = path.join(CSS, nombre);
    if (!fs.existsSync(p)) {
      console.log("\n  ✗ falta el módulo: " + nombre + "\n");
      process.exit(1);
    }
    return fs.readFileSync(p, "utf8").replace(/\s+$/, "");
  })
  .join("\n\n");

/* ── LA CABECERA DE CADA MÓDULO NO CUENTA ──

   Cada módulo empieza con un comentario que explica qué lleva y por
   qué está separado. Ese comentario no es CSS: no lo aplica
   nadie, y si se comparara el archivo entero, los módulos dados
   «distintos» siempre, por sus cabeceras y no por sus reglas.

   Así que se quita el bloque de comentario de cabecera de cada uno
   antes de comparar, y se compara solo lo que el navegador lee. */
const sinCabeceras = orden
  .map((nombre, i) => {
    const t = sinCR(fs.readFileSync(path.join(CSS, nombre), "utf8"));
    const fin = t.indexOf("*/");

    /* ── QUITAR LA CABECERA, SIN COMER LÍNEAS DE MÁS ──

       La primera versión usaba `replace(/\s+$/, "")`, que quita
       los espacios Y los saltos de línea del final. Eso borraba
       diez líneas en blanco que sí están en el archivo original, y
       la comparación fallaba por algo que no era un cambio de
       aspecto.

       Se quita la cabecera con `slice`, que corta por posición y no
       toca nada más, y solo se quitan los espacios del final de
       la línea, no los saltos. */
    const cuerpo = (fin < 0 ? t : t.slice(fin + 2))
      .replace(/^\n+/, "")            /* los saltos tras la cabecera */
      .replace(/[ \t]+$/, "");         /* el espacio del final de línea */

    /* ── LA CABECERA DEL ARCHIVO ANTIGUO ──

       El primer módulo no empieza en la línea 1 del `panel.css`
       viejo: empieza en su primer encabezado, que es donde lo corta
       `dividir-css.js`. Todo lo que hay antes —el título del
       archivo y la nota de las 7000 líneas— no lo carga ningún
       módulo, y sin esto la comparación siempre dará unos cientos
       de caracteres menos.

       Se pone delante y ya no son los mismos. */
    if (i === 0) return CABECERA_ORIGINAL + "\n\n" + cuerpo;
    return cuerpo;
  })
  .join("\n")
  /* El `join` pone un salto entre módulos, y entre el penúltimo y
     el último no debe haber ninguno: el archivo original termina
     donde termina el último bloque.

     Con uno de más, la comparación da una línea más y falla por un
     salto de línea. No cambia el aspecto, pero una comprobación que
     tolera diferencias que no afectan deja de servir para las que
     sí: o da el mismo texto exacto, o falla. */
  .replace(/\n+$/, "");

const antes = fs.readFileSync(REFERENCIA, "utf8").replace(/\s+$/, "");

console.log("\n═══ Los módulos dan lo mismo que antes ═══\n");

console.log("  antes:        " + antes.length.toLocaleString("es") + " caracteres");
console.log("  concatenado:  " + sinCabeceras.length.toLocaleString("es") + " caracteres");

if (antes === sinCabeceras) {
  console.log("\n  ✓ IDÉNTICO. El aspecto no ha cambiado.");
  console.log("\n    Módulos, en el orden que los carga el manifiesto:\n");
  orden.forEach((n, i) => {
    const k = Math.round(fs.readFileSync(path.join(CSS, n), "utf8").split("\n").length);
    console.log("      " + String(i + 1).padStart(2) + ". " + n.padEnd(30) + k + " lineas");
  });
  console.log("");
  process.exit(0);
}

/* ── Si difieren, dónde ── */

console.log("\n  ✗ NO SON IGUALES. El aspecto cambiaría.\n");

const a = antes.split("\n");
const b = sinCabeceras.split("\n");

console.log("    lineas antes:        " + a.length);
console.log("    lineas concatenado:  " + b.length);
console.log("    diferencia:          " + Math.abs(a.length - b.length) + " lineas\n");

/* La primera línea en la que se separan dice dónde empieza el
   movimiento, que suele ser justo donde empieza un módulo. */
let i = 0;
while (i < a.length && i < b.length && a[i] === b[i]) i++;

if (i < a.length || i < b.length) {
  console.log("    se separan en la línea " + (i + 1) + ":\n");
  console.log("      antes:        " + (a[i] || "(fin de archivo)").trim().slice(0, 66));
  console.log("      concatenado:  " + (b[i] || "(fin de archivo)").trim().slice(0, 66));
  console.log("");
}

process.exit(1);
