/* Buscar donde se rompe el anidamiento de panel.css.

   La pista: los chips --mantenimiento, --proyecto y --presupuesto SI
   tienen color, y los --estado-* y --acceso-* no. Los primeros estan
   mas arriba en el archivo. Eso encaja con una llave descompensada a
   partir de cierto punto: todo lo que viene despues queda dentro de
   una regla y no se aplica.

   El conteo global de llaves puede dar cuadrado y aun asi estar mal:
   una llave de cierre que sobra antes compensa con una de apertura que
   falta despues, y el total cuadra. Lo que hay que mirar es la
   PROFUNDIDAD en cada punto, que deberia volver a cero entre reglas. */
const fs = require("fs");

const f = process.argv[2] || "public/css/panel.css";
const lineas = fs.readFileSync(f, "utf8").split(/\r?\n/);

let profundidad = 0;
const vuelcos = [];
const sospechosos = [];

for (let i = 0; i < lineas.length; i++) {
  /* Se quitan los comentarios y los textos entre comillas, que
     contienen llaves y no cuentan. */
  let l = lineas[i]
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");

  const abre = (l.match(/\{/g) || []).length;
  const cierra = (l.match(/\}/g) || []).length;

  const antes = profundidad;
  profundidad += abre - cierra;

  if (profundidad < 0) {
    sospechosos.push({ linea: i + 1, tipo: "sobra un cierre", profundidad: antes, texto: lineas[i].trim().slice(0, 70) });
  }

  /* Una linea que abre una regla de primer nivel: la profundidad
     deberia ser 1 justo despues. Si no, estamos dentro de otra cosa. */
  if (abre > 0 && antes === 0 && profundidad !== 1) {
    sospechosos.push({ linea: i + 1, tipo: "abre a profundidad " + profundidad, profundidad: antes, texto: lineas[i].trim().slice(0, 70) });
  }
}

console.log("=== " + f + " ===");
console.log("  lineas: " + lineas.length + "   profundidad final: " + profundidad);
if (profundidad !== 0) {
  console.log("  *** la profundidad NO vuelve a cero: el archivo esta mal cerrado ***");
}
console.log("  puntos sospechosos: " + sospechosos.length);
sospechosos.slice(0, 12).forEach((s) => {
  console.log("    L" + s.linea + "  " + s.tipo + "  | " + s.texto);
});

/* Donde estan los chips, para ver si caen dentro o fuera. */
const lineaChip = lineas.findIndex((l) => l.trim() === ".panel-chip {") + 1;
let profEnChip = 0;
for (let i = 0; i < lineaChip - 1; i++) {
  const l = lineas[i].replace(/\/\*[\s\S]*?\*\//g, "").replace(/"(?:[^"\\]|\\.)*"/g, '""');
  profEnChip += (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length;
}
console.log("  profundidad justo antes de .panel-chip (L" + lineaChip + "): " + profEnChip + (profEnChip === 0 ? "  (correcto)" : "  *** deberia ser 0 ***"));

const lineaAcceso = lineas.findIndex((l) => l.includes(".panel-chip--acceso-activo")) + 1;
let profEnAcceso = 0;
for (let i = 0; i < lineaAcceso - 1; i++) {
  const l = lineas[i].replace(/\/\*[\s\S]*?\*\//g, "").replace(/"(?:[^"\\]|\\.)*"/g, '""');
  profEnAcceso += (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length;
}
console.log("  profundidad antes de .panel-chip--acceso-activo (L" + lineaAcceso + "): " + profEnAcceso + (profEnAcceso === 0 ? "  (correcto)" : "  *** deberia ser 0 ***"));