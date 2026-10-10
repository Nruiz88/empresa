const fs = require("fs");
const path = require("path");

const CSS = path.join("D:/webs/empresa", "public", "css");

const hojas = fs.readdirSync(CSS).filter((f) => f.endsWith(".css"));
const todo = hojas.map((f) => fs.readFileSync(path.join(CSS, f), "utf8")).join("\n");

/* ── CÓMO SE SABE CUÁL ES UNA VARIABLE Y CUÁL UN SUFIJO DE CLASE ──

   Hay dos cosas que empiezan por `--` en un archivo de CSS:

     --control-h: 2.125rem;      esto es una variable
     .panel-tarjeta--aviso {      esto NO: `--aviso` es el sufijo
                                     de una clase con el patrón BEM

   La primera versión contaba los dos, y por eso informaba de
   `--aviso`, `--ambar`, `--error` y `--apagada` como variables sin
   usar. No lo son: son modificadores de clase, y existen en las
   hojas como `.panel-tarjeta--aviso`.

   La diferencia está en el carácter anterior a los dos guiones. En
   una declaración el nombre está solo; en un sufijo de clase va
   pegado a otro nombre. Por eso la búsqueda se ancla al principio de
   la línea y descarta lo que viene detrás de un `.` o de otro
   identificador. */
const declaradas = [...new Set([...todo.matchAll(/^[ \t]*(--[\w-]+)\s*:/gm)].map((m) => m[1]))];

const usosDe = (v) =>
  (todo.match(new RegExp("var\\(" + v.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "g")) || []).length;

/* ── LAS EXTREMOS DE UNA ESCALA NO CUENTAN COMO MUERTAS ──

   `--p-1` y `--p-7` no se usan, y aun así se quedan. Son el primer
   y el último paso de la escala de espaciado, y quitarlos deja un
   hueco en el medio de una serie que se lee paso a paso.

   Es la misma razón por la que una regla que no aparece en pantalla
   no se borra: que hoy no sirva no significa que mañana no sirva, y
   el hueco de un `--p-3` cuesta más de llevar que el hueco de un
   `--p-1`.

   Los que sí sobran son los que no pertenecen a ninguna serie:
   `--elev-0`, `--ease-in-out` y los colores de la web pública. */
const EXTREMOS = /^--p-[1-7]$/;

const sinUso = declaradas.filter((v) => usosDe(v) === 0 && !EXTREMOS.test(v));

console.log("\n═══ Variables CSS declaradas y sin uso ═══\n");

if (!sinUso.length) {
  console.log("  ninguna. Todas las que se declaran se usan.");
} else {
  /* ── POR QUÉ SALEN TODAS JUNTAS Y NO POR COLORES ──

     Hubo una versión que las separaba en un grupo de «las que parecen
     colores» y lotmlaba aparte. La idea parecía buena: que un color
     declarado y no usado deja un estado sin distinguir. Pero el
     filtrado era por nombre de variable, así que `--ambar` y
     `--error` salían en ese grupo, y al buscar su declaración se vio
     que no existían: se mencionaban en un comentario y nada más.

     Una comprobación que avisa de cosas que no existen enseña a
     ignorar sus avisos, que es peor que no tenerla. Así que aquí solo
     se cuenta, sin adivinar qué es importante.

     Para saber si una de estas es de verdad un color o un resto de
     una versión anterior, hay que buscarla: este mismo script con el
     nombre pegado, o el editor. */
  console.log("  declaradas y sin usar: " + sinUso.length);
  console.log("");

  for (const v of sinUso) {
    const esc = v.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const m = todo.match(new RegExp("^[ \\t]*" + esc + "\\s*:\\s*([^;]+);", "m"));
    console.log("    " + v.padEnd(16) + (m ? m[1].trim().slice(0, 40) : ""));
  }
}

console.log("\n  ──────────────────────────────────────────────");
console.log("  declaradas: " + declaradas.length);
console.log("  sin uso:    " + sinUso.length);
console.log("\n  ── Solo se cuentan los usos dentro de public/css.");
console.log("     Una variable usada desde un .ejs o un .js sale aquí");
console.log("     como muerta aunque no lo sea.\n");