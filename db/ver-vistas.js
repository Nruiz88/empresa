/* =========================================================
   Nexo Studio - Lint de las vistas EJS
   ------------------------------------------------------------
   node db/ver-vistas.js

   ── POR QUÉ ESTE ARCHIVO ──

   Porque tres veces en una misma tarde se rompió la sintaxis de una
   vista al editarla, y las tres llegaron al servidor:

     · un comentario de EJS cerrado con el asterisco-registro en vez
       de con el cierre de etiqueta
     · otro comentario igual, en otra vista
     · un empalme por número de línea que se comió un if abierto y
       dejó un paréntesis suelto

   El síntoma en los tres casos es el mismo: HTTP 500 en una
   pantalla, y un error de compilación de EJS que no señala la
   línea. Se llega a producción, se cae la portada entera, y el
   diagnóstico cuesta veinte minutos.

   Y hay un detalle que hace este fallo más fácil de repetir de lo
   que parece: dentro de un comentario de bloque, escribir la
   secuencia de cierre asterisco-registro CIERRA el comentario. O
   sea, al intentar documentar cómo se rompe EJS, uno rompe el
   archivo. Pasó al escribir este mismo archivo, y por eso las
   cabeceras de aquí evitan esas secuencias.

   ── POR QUÉ NO BASTA CONTAR LAS ETIQUETAS ──

   Porque el tercer fallo tenía las etiquetas de apertura y cierre
   perfectamente cuadradas: 97 de cada una. El empalme había borrado
   un bloque de código y dejado un paréntesis huérfano, y contar
   etiquetas no lo ve.

   Así que no se cuenta: se COMPILA. Que es lo que hace EJS al
   renderizar, pero aquí antes de desplegar y sin necesitar una
   sesión ni una base de datos.

   ── CÓMO LO HACE ──

   Se usa la función de compilación de la misma librería que usa el
   servidor. No es un linter externo ni una dependencia nueva: es
   exactamente el compilador que va a ejecutar la página,
   ejecutándose antes. Si esto pasa, la página vale.

   El coste es el de leer los archivos: instantáneo. Y lee las 30
   vistas, no solo las que alguien acaba de tocar, que es donde
   está el valor: un archivo roto hace dos semanas que nadie ha
   abierto sigue roto.
   ========================================================= */

const fs = require("fs");
const path = require("path");
const ejs = require("ejs");

const VISTAS = path.join(__dirname, "..", "views");

/** Todas las vistas, en subcarpetas incluidas. */
function todas(dir) {
  const salida = [];

  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);

    if (entrada.isDirectory()) {
      /* Las carpetas de partials y de posts también se compilan: un
         partial roto revienta la página que lo incluye, y a veces
         tres páginas distintas, que es lo que hace más difícil
         achar el origen. */
      salida.push(...todas(completo));
    } else if (entrada.name.endsWith(".ejs")) {
      salida.push(completo);
    }
  }

  return salida;
}

const archivos = todas(VISTAS);
const rotos = [];

for (const archivo of archivos) {
  const fuente = fs.readFileSync(archivo, "utf8");
  const relativo = path.relative(path.join(__dirname, ".."), archivo);

  try {
    /* Se compila con las mismas opciones que usa el servidor. La
       La plantilla no se ejecuta: compilar solo la transforma en una
       función, que es justo donde falla un corchete que falta. */
    ejs.compile(fuente, { filename: relativo });
  } catch (e) {
    rotos.push({ relativo, mensaje: e.message.split("\n")[0] });
  }
}

console.log("");
console.log("=== Vistas EJS ===");
console.log("");

if (!rotos.length) {
  console.log("  ✓ Las " + archivos.length + " vistas compilan.");
  console.log("");
  process.exit(0);
}

for (const r of rotos) {
  console.log("  ✗ " + r.relativo);
  console.log("    " + r.mensaje);
}

console.log("");
console.log(
  "  " + rotos.length + " de " + archivos.length + " vistas no compilan. " +
  "Cada una de estas es una pantalla que devuelve HTTP 500."
);
console.log("");

process.exit(1);