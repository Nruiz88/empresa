const fs = require("fs");
const path = require("path");

/* ═══════════════════════════════════════════════════════════════
   CUÁNTO CÓDIGO HAY Y CUÁNTO ES COMENTARIO

   ── POR QUÉ CUENTO COMENTARIOS Y NO PALABRAS ──

   Porque hay dos cosas que se parecen y no son lo mismo: un
   comentario que explica por qué se hizo algo, y un comentario que
   repite lo que dice la línea de debajo.

   Los dos cuentan igual aquí, y por eso el número hay que leerlo con
   la cabeza: un 40% puede ser documentación buena o puede ser ruido
   escrito con mucha Durbanés.
   ═══════════════════════════════════════════════════════════════ */

const CARPETAS = [
  ["public/css", ".css"],
  ["routes", ".js"],
  ["lib", ".js"],
  ["views", ".ejs"],
];

console.log("\n═══ Código y comentarios ═══\n");
console.log("  " + "carpeta".padEnd(12) + "lineas".padStart(8) + "coment.".padStart(10) + "  ratio");

for (const [carpeta, ext] of CARPETAS) {
  const ruta = path.join("D:/webs/empresa", carpeta);
  if (!fs.existsSync(ruta)) continue;

  let total = 0;
  let comentario = 0;
  const porArchivo = [];

  for (const f of fs.readdirSync(ruta).filter((x) => x.endsWith(ext))) {
    const t = fs.readFileSync(path.join(ruta, f), "utf8");
    const L = t.split("\n");

    let c = 0;
    let dentro = false;

    for (const l of L) {
      total++;
      const abreBloque = /\/\*/.test(l);
      const cierraBloque = /\*\//.test(l);
      const esLinea = /^\s*\/\//.test(l);

      if (dentro || abreBloque || esLinea) {
        c++;
        comentario++;
      }
      if (abreBloque && !cierraBloque) dentro = true;
      if (dentro && cierraBloque) dentro = false;
    }

    porArchivo.push({ f, c, total: L.length });
  }

  const ratio = total ? ((comentario / total) * 100).toFixed(0) : 0;
  console.log(
    "  " + carpeta.padEnd(12) + String(total).padStart(8) + String(comentario).padStart(10) + "   " + ratio + "%"
  );
}

/* ── LOS ARCHIVOS MÁS COMENTADOS ──

   No para señalarlos como malos, sino para ver dónde está el
   peso: un archivo con 60% de comentario y 400 líneas está
   probablemente mejor documentado que uno con 20% y 3.000, y son
   cosas distintas. */

console.log("\n═══ Los más comentados ═══\n");

const todos = [];
for (const [carpeta, ext] of CARPETAS) {
  const ruta = path.join("D:/webs/empresa", carpeta);
  if (!fs.existsSync(ruta)) continue;

  for (const f of fs.readdirSync(ruta).filter((x) => x.endsWith(ext))) {
    const t = fs.readFileSync(path.join(ruta, f), "utf8");
    const L = t.split("\n");
    let c = 0;
    let dentro = false;

    for (const l of L) {
      const abre = /\/\*/.test(l);
      const cierra = /\*\//.test(l);
      if (dentro || abre || /^\s*\/\//.test(l)) c++;
      if (abre && !cierra) dentro = true;
      if (dentro && cierra) dentro = false;
    }

    if (L.length > 200 && c / L.length > 0.3) {
      todos.push({ carpeta, f, c, total: L.length, ratio: c / L.length });
    }
  }
}

todos.sort((a, b) => b.ratio - a.ratio);

for (const t of todos.slice(0, 12)) {
  console.log(
    "  " + (t.carpeta + "/" + t.f).padEnd(40) +
    String(t.c).padStart(5) + " de " + String(t.total).padStart(5) + "   " +
    (t.ratio * 100).toFixed(0) + "%"
  );
}
console.log("");