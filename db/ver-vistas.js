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
const idioma = require("./ver-idioma");

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
    continue;
  }

  /* ── Comentarios HTML sin cerrar ──

     Esto no lo ve ni EJS ni el servidor, y por eso se comprueba
     aparte.

     Un `<!--` que no cierra no da error: el navegador se lo come
     todo hasta el siguiente `-->`, que puede estar a cien líneas
     más allá, o no estar nunca. Lo que pasa es que el HTML es
     válido, la vista compila, el servidor contesta 200 y un bloque
     entero no aparece.

     Pasó con la portada: el comentario de las cifras de gente
     terminaba con la secuencia de cierre de un comentario de
     bloque de JavaScript en vez de la de un comentario de HTML. Las
     cuatro tarjetas de cifras estaban escritas, correctas, y no se
     veían. Un fallo que no se puede ver en un error porque no hay
     error.

     Cuenta aperturas y cierres y avisa si no cuadran. No repara: no
     sabe cuál de los dos está mal, solo que hay uno de más. */
  const abiertas = (fuente.match(/<!--/g) || []).length;
  const cerradas = (fuente.match(/-->/g) || []).length;

  if (abiertas !== cerradas) {
    rotos.push({
      relativo,
      mensaje:
        "comentario HTML sin cerrar: " + abiertas + " aperturas y " +
        cerradas + " cierres. El HTML a partir de ahi se lo come el " +
        "navegador en silencio.",
    });
  }
}

console.log("");
console.log("=== Vistas EJS ===");
console.log("");

if (!rotos.length) {
  console.log("  ✓ Las " + archivos.length + " vistas compilan y no tienen comentarios sin cerrar.");
  console.log("");
} else {
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
}

/* ── Texto en otro idioma ──

   Va después de la compilación y no antes, y el orden importa: si una
   vista no compila, el aviso que interesa es el de compilación, y dos
   listas de fallos una detrás de otra lo que hacen es que se lea la
   segunda y se pase de la primera.

   Se comprueba aquí porque este archivo ya es la puerta de entrada a
   `npm test`, y una comprobación que hay que acordarse de lanzar es
   una comprobación que no se lanza.

   Y hay una razón de fondo: un U+FFFD o un trozo de cirílico en un
   comentario no rompe la página. El fichero compila, el servidor
   contesta 200, las pruebas pasan. Solo se ve leyendo, y solo si la
   frase resulta rara. Con 27 caracteres perdidos en el artículo
   público de precios y dos comentarios de migración en ruso, se ha
   visto que "raro" no es un filtro fiable. */
const sospechosos = [];

for (const archivo of idioma.recorrer(path.join(__dirname, ".."))) {
  const relativo = path.relative(path.join(__dirname, ".."), archivo);
  for (const f of idioma.revisar(archivo)) {
    sospechosos.push({ relativo, ...f });
  }
}

if (sospechosos.length) {
  console.log("=== Texto que no es castellano ===");
  console.log("");
  for (const s of sospechosos) {
    console.log("  ✗ " + s.relativo + " L" + s.linea + "  [" + s.alfabeto + "] " + s.codes);
    console.log("      " + s.texto);
  }
  console.log("");
  console.log(
    "  " + sospechosos.length + " lineas. El fichero compila y la pagina responde 200: " +
    "esto solo se ve leyendo."
  );
  console.log("");
  process.exit(1);
}

console.log("  ✓ Ningún fichero tiene texto de otro alfabeto.");
console.log("");

process.exit(0);