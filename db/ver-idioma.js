/* Buscar texto que no está en castellano.

   ── POR QUÉ ESTA HERRAMIENTA ──

   Este repositorio es íntegramente castellano: comentarios, etiquetas,
   mensajes de error, nombres de variable. Cualquier cosa escrita en
   otro alfabeto dentro de un fichero es un error, y de los que no se
   ven: el fichero compila, la página responde 200, las pruebas pasan.
   Solo se nota leyendo, y sólo si esa frase resulta rara.

   Ya pasó dos veces y de dos maneras distintas:

     · `salud.ejs` traía "que ya no se 收了." y "之间的关系统 encaja".
       Texto traducido al chino y pegado en su sitio. Cinco ficheros.

     · Al escribir este mismo trabajo se colaron tres veces palabras
       en cirílico dentro de comentarios nuevos: "benefitа", "unCOLUMNAS",
       "cambiarOU". Tres de tres las escribió quien ya sabía que el
       problema existía.

   Lo segundo es lo que justifica la herramienta: el fallo no es de
   quien copia un fichero, es de quien escribe, y se cuela en el
   comentario "para que quede claro" que es justo donde más a mano
   queda. Ninguna prueba de compilación lo detecta, porque un
   comentario puede contener lo que quiera.

   ── QUÉ CUENTA COMO ERROR ──

   Alfabetos que no son el nuestro: cirílico, griego, hebreo, árabe,
   devanagari y los dos rangos chinos. Se listan por nombre para que
   el aviso diga de dónde viene, no solo que hay algo raro.

   NO cuentan, y es importante que no cuenten:

     · Los acentos y la eñe: son castellano.
     · La raya de caja `─`, el guion largo `—`, la flecha `→`, los
       palitos de las tablas ASCII: se usan a diario en los comentarios.
     · El símbolo de replacement `�`: indica que algo ya se leyó mal
       antes, y merece su propio aviso, pero no es otro idioma.

   ── DÓNDE SE USA ──

   `npm test` la llama antes de nada, vía `db/ver-vistas.js`. Si esto
   falla, el resto de las pruebas no dicen nada útil. */
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");

const ALFABETOS = [
  { nombre: "cirílico", re: /[Ѐ-ӿ]/g },
  { nombre: "griego", re: /[Ͱ-Ͽ]/g },
  { nombre: "hebreo", re: /[֐-׿]/g },
  { nombre: "árabe", re: /[؀-ۿ]/g },
  { nombre: "devanagari", re: /[ऀ-ॿ]/g },
  { nombre: "chino", re: new RegExp("[\\u2e80-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef]", "g") },
];

const EXT = [".ejs", ".js", ".mjs", ".css", ".json", ".sql", ".html", ".md"];

const ignorar = (dir) => {
  const fuera = new Set(["node_modules", ".git", "capturas", "tmp"]);
  return !fuera.has(path.basename(dir));
};

/* Este fichero se salta a sí mismo, y hay que decirlo en voz alta
   porque es una excepción fea.

   La lista de alfabetos son, literalmente, letras de esos alfabetos:
   el rango del cirílico está escrito con letras cirílicas, y el del
   devanagari con devanagari. Un detector que se aplica a sí mismo se
   acusa a sí mismo, y entonces hay dos salidas malas: borrar las
   letras y que la herramienta deje de detectar el cirílico, o
   dejarlas y tener que silenciar el aviso cada vez que se ejecuta.

   La segunda es la que se elige, y por eso el salto es aquí y no en
   el bucle: es una excepción consciente y está escrita. */
const YO = path.basename(__filename);

const recorrer = (dir) => {
  const salida = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ignorar(dir)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) salida.push(...recorrer(p));
    else if (EXT.includes(path.extname(e.name)) && e.name !== YO) salida.push(p);
  }
  return salida;
};

/* Pistas: el símbolo de replacement y los caracteres de reemplazo,
   que aparecen cuando un fichero se escribió con una codificación y
   se leyó con otra. No son un idioma, pero siempre son un fallo. */
const REEMPLAZO = /�/g;

function revisar(ruta) {
  const texto = fs.readFileSync(ruta, "utf8");
  const lineas = texto.split(/\r?\n/);
  const fallos = [];

  lineas.forEach((linea, i) => {
    for (const a of ALFABETOS) {
      a.re.lastIndex = 0;
      const Found = linea.match(a.re);
      if (!Found) continue;
      const codes = [...new Set(Found)]
        .map((c) => "U+" + c.charCodeAt(0).toString(16).toUpperCase())
        .join(" ");
      fallos.push({
        linea: i + 1,
        alfabeto: a.nombre,
        codes,
        texto: linea.trim().slice(0, 96),
      });
    }
    REEMPLAZO.lastIndex = 0;
    if (REEMPLAZO.test(linea)) {
      fallos.push({
        linea: i + 1,
        alfabeto: "reemplazo",
        codes: "U+FFFD",
        texto: linea.trim().slice(0, 96),
      });
    }
  });

  return fallos;
}

module.exports = { revisar, recorrer, RAIZ };

/* Desde la linea de ordenes se imprime el informe; cuando se llama
   desde otra prueba solo se exporta la funcion. */
if (require.main === module) {
  const ficheros = recorrer(RAIZ);
  let total = 0;

  for (const f of ficheros) {
    const fallos = revisar(f);
    if (!fallos.length) continue;
    total += fallos.length;
    console.log("  " + path.relative(RAIZ, f));
    for (const x of fallos) {
      console.log("    L" + x.linea + "  [" + x.alfabeto + "]  " + x.codes);
      console.log("        " + x.texto);
    }
  }

  console.log("");
  console.log("  " + ficheros.length + " ficheros revisados, " + total + " lineas con texto extranjero");
  process.exit(total ? 1 : 0);
}