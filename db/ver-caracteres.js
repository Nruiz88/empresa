/* Ver que caracteres se escapan del rango CJK, con los codigos a la
   vista.

   ── EL ERROR QUE HACE FALLA ESTA PROPIA HERRAMIENTA ──

   El rango se escribia con los caracteres puestos a mano, y el
   primer extremo se tecleo como U+0100 en vez de U+2E80. El rango
   quedaba `0100-9FFF`, o sea "cualquier letra acentuada, el guion
   largo, la raya de caja": falso positivo en casi todo el
   repositorio. Y en el fichero que_WORD_perdida estaba justo al
   principio de la linea, hacia que el patron `^...` no casara
   aunque la linea empezase de largo por un caracter chino.

   Dos cosas rotas a la vez y ninguna avisa: el falso positivo y el
   falso negativo. Por eso el rango va con escapes de unicode, que
   no se pueden teclear mal. */
const fs = require("fs");

const CJK = new RegExp("[\\u2e80-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef]", "g");

for (const f of process.argv.slice(2)) {
  const lineas = fs.readFileSync(f, "utf8").split(/\r?\n/);
  const sucias = lineas.filter((x) => {
    CJK.lastIndex = 0;
    return CJK.test(x);
  });

  if (!sucias.length) {
    console.log("  " + f.padEnd(30) + " limpio");
    continue;
  }
  console.log("  " + f);
  lineas.forEach((x, i) => {
    CJK.lastIndex = 0;
    if (!CJK.test(x)) return;
    const puntos = [...x]
      .map((c) => (c.charCodeAt(0) > 126 ? "<" + c.charCodeAt(0).toString(16) + ">" : c))
      .join("");
    const solo = (x.match(CJK) || [""])[0];
    console.log("    L" + (i + 1) + "  " + puntos.trim());
    console.log("         chino: " + [...solo].map((c) => "U+" + c.charCodeAt(0).toString(16).toUpperCase()).join(" "));
  });
}