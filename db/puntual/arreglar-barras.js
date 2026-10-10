const fs = require("fs");

/* ═══════════════════════════════════════════════════════════════
   LAS BARRAS DE MÁS

   ── EL HALLAZGO ──

   El error no lo causó el movimiento de los scripts: el original en
   git ya tenía

       path.resolve(__dirname, "..//public/css")

   con dos barras. Estuvo ahí desde antes y no se había ejecutado,
   porque estos dos scripts no están en la cadena de `npm test`.

   ── POR QUÉ FALLA ──

   `path.resolve` no limpia barras dobles: `"..//public/css"` se
   resuelve como si fuera `..//public/css`, y el resultado es un
   caminho que no existe. En Windows la barra duplicada no se
   normaliza, así que el `readdir` falla con `ENOENT`.

   ── EL ARREGLO ──

   Una barra por nivel, con comas y espacios, que es como se escribe
   el resto del proyecto:

       path.resolve(__dirname, "..", "..", "public", "css")

   ═══════════════════════════════════════════════════════════════ */

const ARCHIVOS = [
  "db/herramientas/ver-css-entero.js",
  "db/ver-css-duplicados.js",
];

console.log("\n═══ Las barras de más ═══\n");

for (const f of ARCHIVOS) {
  if (!fs.existsSync(f)) continue;

  const antes = fs.readFileSync(f, "utf8");

  /* El patrón empieza en la comilla y termina en la barra, pero el
     reemplazo devuelve la lista CON su comilla de cierre. Por eso
     esta vez la cadena no puede quedar abierta: el cierre viene
     escrito en la lista, no se conserva del original. */
  const despues = antes.replace(
    /("(?:[^"]*?))\/\//g,
    (m, hasta) => {
      const niveles = (hasta.match(/\.\.\//g) || []).length;
      if (!niveles) return m;
      return (
        hasta.replace(/\.\.\//g, "").trimEnd() +
        ", " +
        Array(niveles).fill('".."').join(", ") +
        ', "'
      );
    }
  );

  /* El `"/public/css"` sin separador también hay que partirlo. */
  const final = despues.replace(/, public\/css"/g, ', "public", "css"');

  if (final !== antes) {
    fs.writeFileSync(f, final, "utf8");
    const linea = final.split("\n").find((l) => /public.*css/.test(l));
    console.log("  " + f);
    console.log("    " + (linea ? linea.trim().slice(0, 76) : ""));
  }
}

console.log("");