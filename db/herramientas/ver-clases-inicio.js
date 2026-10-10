const fs = require("fs");

/* ═══════════════════════════════════════════════════════════════
   LAS CLASES DE `index.ejs`

   ── POR QUÉ ESTO ANTES DE TOCAR NADA ──

   Porque la escala de planos solo funciona si se aplica a un
   conjunto pequeño y Cohenente de clases. Si la pantalla usa treinta
   clases distintas y cada una tiene su sombra escrita a mano,
   cambiar los tokens no cambia nada: los tokens no los usa nadie.

   Lo que sale aquí es la lista real de clases, con cuántas veces
   aparece cada una, para ver quéAgrupa de verdad.

   ── POR QUÉ CUENTO DESPUÉS DE QUITAR COMENTARIOS ──

   Porque en el HTML hay comentarios que nombran clases, y una clase
   que solo existe dentro de un comentario no se pinta en pantalla.
   ═══════════════════════════════════════════════════════════════ */

const RUTA = "D:/webs/empresa/views/panel/index.ejs";

const crudo = fs.readFileSync(RUTA, "utf8");
const t = crudo
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/<%[\s\S]*?%>/g, "");

const clases = new Map();

for (const m of t.matchAll(/class="([^"]+)"/g)) {
  for (const c of m[1].split(/\s+/)) {
    if (!c) continue;
    clases.set(c, (clases.get(c) || 0) + 1);
  }
}

const lista = [...clases.entries()].sort((a, b) => b[1] - a[1]);

console.log("\n═══ Las clases de index.ejs ═══\n");
console.log("  (con " + crudo.split("\n").length + " líneas en total)\n");
console.log("  " + String(lista.length).padStart(4) + " clases distintas\n");

for (const [c, n] of lista.slice(0, 34)) {
  console.log("  " + String(n).padStart(4) + "×  ." + c);
}

/* ── LAS QUE SON CAJAS ──

   Son las que hay que unificar. Se distinguen por el nombre: las que
   llevan `card`, `caja`, `panel-` o `metrica` son superficies, y el
   resto son cosas que van dentro. */

const superficies = lista.filter(([c]) =>
  /card|caja|panel-|metrica|metric|tarjeta|bloque/i.test(c)
);

console.log("\n═══ Las superficies ═══\n");
for (const [c, n] of superficies) console.log("  " + String(n).padStart(4) + "×  ." + c);
console.log("\n  superficies: " + superficies.length + "\n");