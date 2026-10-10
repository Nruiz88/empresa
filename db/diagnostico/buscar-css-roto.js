// Dice DÓNDE se rompe el CSS, línea a línea.
//
// ── POR QUÉ NO BASTA CON CONTAR ──
//
// Contar aperturas y cierres de comentario dice que hay uno de más, pero
// no dónde. Y en un archivo de 5.800 líneas, "buscar el que sobra" es
// una tarde de trabajo.
//
// Aquí se recorre el archivo de arriba abajo llevando la cuenta de
// cuántos comentarios están abiertos. Cuando la cuenta baja de cero, el
// problema está en ese punto: un cierre sobrante.
//
// Y cuando la cuenta es distinta de cero al final, hay una apertura sin
// cerrar, que es el caso que se reconoce: desde ahí hasta el final
// del archivo es un comentario, y por eso el navegador deja de leer
// reglas a partir de ahí.

const fs = require("fs");

const f = process.argv[2] || "D:/webs/empresa/public/css/styles.css";
const texto = fs.readFileSync(f, "utf8");

const APERTURA = "/*";
const CIERRE = String.fromCharCode(42) + "/";

let profundidad = 0;
let linea = 1;
let enCadena = null;
const avisos = [];
let reglaViva = false;

for (let i = 0; i < texto.length; ) {
  const c = texto[i];
  const c2 = texto.slice(i, i + 2);

  if (c === "\n") {
    linea++;
    i++;
    continue;
  }

  // Cadena: se salta entera, porque un "/*" dentro de una cadena no es
  // un comentario. Sin esto, un url(...) con un asterisco daría un falso
  // positivo.
  if (enCadena) {
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === enCadena) enCadena = null;
    i++;
    continue;
  }

  if (c === '"' || c === "'") {
    enCadena = c;
    i++;
    continue;
  }

  // Fuera de un comentario, una barra al inicio de línea es una
  // etiqueta at-rule: se salta hasta el punto y coma para no contar
  // llaves que no son reglas.
  if (profundidad === 0 && c === "/" && texto[i + 1] !== "*" && texto[i + 1] !== "/") {
    // Puede ser un cierre de bloque suelto. Se anota.
    if (c === "}") {
      reglaViva = false;
    }
    i++;
    continue;
  }

  if (c2 === APERTURA) {
    // Apertura duplicada: el segundo "/*" dentro de un comentario NO
    // anida en CSS, es texto, y el comentario sigue abierto. No es un
    // error en sí mismo, pero es la forma más común de alargar un
    // comentario sin querer.
    if (profundidad > 0) {
      avisos.push({
        linea,
        tipo: "apertura dentro de un comentario",
        detalle: "en CSS los comentarios no se anidan: esta marca es texto y el comentario sigue abierto",
      });
    }
    profundidad++;
    i += 2;
    continue;
  }

  if (c2 === CIERRE) {
    profundidad--;
    if (profundidad < 0) {
      avisos.push({
        linea,
        tipo: "cierre de comentario de mas",
        detalle:
          "a partir de aqui el archivo se lee como codigo donde no lo es, y el navegador " +
          "descarta todo hasta el siguiente inicio o cierre de bloque",
      });
      profundidad = 0;
    }
    i += 2;
    continue;
  }

  i++;
}

console.log("fichero: " + f);
console.log("lineas: " + linea);
console.log("comentarios sin cerrar al final: " + profundidad);
console.log("");

if (!avisos.length) {
  if (profundidad === 0) {
    console.log("Los comentarios cuadran.");
  } else {
    console.log("x Hay " + profundidad + " comentario(s) sin cerrar.");
    console.log("");
    console.log("  Desde la linea de apertura, TODO lo que viene despues esta");
    console.log("  dentro del comentario. El navegador deja de aplicar reglas");
    console.log("  a partir de ahi, sin avisar.");
  }
} else {
  console.log("Avisos:");
  avisos.forEach((a) => {
    console.log("  linea " + a.linea + ": " + a.tipo);
    console.log("      " + a.detalle);
  });
}

process.exit(avisos.length || profundidad ? 1 : 0);