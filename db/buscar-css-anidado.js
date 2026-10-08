// Busca llaves sin cerrar en el CSS, contando también lo que va dentro
// de bloques @media.
//
// ── POR QUÉ NO SE ENCONTRÓ MIRANDO SOLO COMENTARIOS ──
//
// La primera vez que styles.css se rompió, el comentario estaba bien
// cerrado y de todos modos el navegador solo leía 20 reglas. Se
// buscó el problema entre los comentarios y no estaba ahí: el comentario
// estaba bien cerrado.
//
// Un `@media` (o `@supports`) sin su llave de cierre mete TODO lo que
// viene detrás dentro del bloque. Las reglas existen, se aplican, y sin
// embargo `sheet.cssRules` —que devuelve las reglas de primer nivel— no
// las cuenta. Por eso el navegador "veía 20 reglas" con un archivo que
// tiene más de ochocientas llaves: no faltaban, estaban anidadas.
//
// Y esto es especialmente traicionero con las consultas de medios: si
// falta una llave, todas las reglas siguientes dejan de aplicarse en
// pantalla ancha, que es donde se mira la web primero. En móvil puede
// hasta verse bien.

const fs = require("fs");
const ruta = process.argv[2] || "D:/webs/empresa/public/css/styles.css";

const texto = fs.readFileSync(ruta, "utf8");

/* Los comentarios se borran SUSTITUYÉNDOLOS por saltos de línea, no
   por nada.

   Es lo que hace que los números de línea sean los del archivo de
   verdad. Con `replace(/\\*...\\*\\//g, "")` el texto encoge y cada
   comentario eliminado se come sus saltos: el escáner señala la línea
   212 y en el archivo real lo que hay ahí es otra cosa, y se acaba
   buscando un bloque cerrado que no existe. */
const sinComentarios = texto.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

let linea = 1;
let profundidad = 0;
let enCadena = null;
let enComentarioLinea = false;
const pila = [];
const picos = [];

for (let i = 0; i < sinComentarios.length; i++) {
  const c = sinComentarios[i];

  if (c === "\n") {
    linea++;
    enComentarioLinea = false;
    continue;
  }

  if (enComentarioLinea) continue;

  if (enCadena) {
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === enCadena) enCadena = null;
    continue;
  }

  if (c === '"' || c === "'") {
    enCadena = c;
    continue;
  }

  if (c === "/" && sinComentarios[i + 1] === "/") {
    enComentarioLinea = true;
    i++;
    continue;
  }

  const antes = sinComentarios.slice(Math.max(0, i - 80), i).replace(/\s+/g, " ").trim();

  if (c === "{") {
    pila.push({ linea, contexto: antes.slice(-70) });
    if (pila.length > picos.length) picos.push(pila.length);
    profundidad++;
    continue;
  }

  if (c === "}") {
    if (pila.length === 0) {
      console.log("  linea " + linea + ": llave de cierre SIN apertura");
      console.log("      " + antes.slice(-70));
      continue;
    }
    const abierto = pila.pop();
    if (pila.length > 0) {
      const abiertoActual = pila[pila.length - 1];
      // Un bloque @-something sigue abierto desde hace mucho: eso es
      // lo que hace que todo lo de después quede anidado.
      if (pila.length >= 1 && abiertoActual.linea < abierto.linea - 400) {
        picos.push({
          problema: true,
          abierto: abiertoActual,
          cerradoEn: linea,
        });
      }
    }
    profundidad--;
  }
}

console.log("fichero: " + ruta);
console.log("profundidad final de llaves: " + profundidad);
console.log("bloques sin cerrar: " + pila.length);
console.log("");

if (pila.length) {
  console.log("x Bloques que nunca se cierran:");
  pila.forEach((b) => {
    console.log("  abierto en la linea " + b.linea + ":");
    console.log("      ..." + b.contexto);
  });
  console.log("");
  console.log("  Todo lo que va despues de la linea " + pila[0].linea + " esta DENTRO");
  console.log("  de ese bloque. Si es un @media, se acabo el responsive.");
  process.exit(1);
}

console.log("Las llaves cuadran en todo el archivo.");