const fs = require("fs");
const path = require("path");

/* ═══════════════════════════════════════════════════════════════
   CÓMO ESTÁ HECHO EL PLANO, HOY

   ── POR QUÉ MIRAR LOS TOKENS Y NO LAS PANTALLAS ──

   Porque el problema que describes — «no se entienden las
   separaciones» — casi nunca está en una pantalla concreta. Si dos
   superficies distintas se leen igual de separadas, el fallo está en
   que el plano no tiene suficientes niveles, y eso se ve en las
   variables, no en las páginas.

   ── LAS CUATRO PREGUNTAS ──

     1. ¿Cuántos planos de fondo hay? Si hay menos de cuatro, todo
        se va a leer como una sola masa.

     2. ¿Cuántos radios hay? Si hay uno, las cards y las cajas se
        confunden entre sí.

     3. ¿Cuántas sombras hay? Una sola sombra no da profundidad:
        todo parece o sombra o nada.

     4. ¿Hay bordes o solo superficies? Las separaciones que se
        construyen con bordes duros compiten con las que se
        construyen con sombra.
   ═══════════════════════════════════════════════════════════════ */

const CSS = "D:/webs/empresa/public/css";

/* ── 1. LOS PLANOS DE FONDO ── */

const planos = new Set();

for (const f of fs.readdirSync(CSS).filter((x) => x.endsWith(".css"))) {
  const t = fs.readFileSync(path.join(CSS, f), "utf8");
  for (const m of t.matchAll(/(--(?:plano|surface|bg)[a-z0-9-]*)\s*:\s*([^;]+);/g)) {
    planos.add(m[1] + " = " + m[2].trim());
  }
}

console.log("\n═══ 1. Los planos ═══\n");
for (const p of [...planos].sort()) console.log("  " + p);

/* ── 2. RADIOS Y SOMBRAS ── */

function valoresDe(nombre) {
  const s = new Set();
  for (const f of fs.readdirSync(CSS).filter((x) => x.endsWith(".css"))) {
    const t = fs.readFileSync(path.join(CSS, f), "utf8");
    for (const m of t.matchAll(new RegExp("(?:" + nombre + ")\\s*:\\s*([^;]+);", "g"))) {
      s.add(m[1].trim());
    }
  }
  return [...s];
}

const radios = valoresDe("--radio[a-z0-9-]*").filter((r) => r.length < 24);
const sombras = valoresDe("--sombra[a-z0-9-]*").filter((r) => r.length < 70);

console.log("\n═══ 2. Los radios ═══\n");
for (const r of [...new Set(radios)].sort()) console.log("  " + r);

console.log("\n═══ 3. Las sombras ═══\n");
for (const s of [...new Set(sombras)].sort()) console.log("  " + s);

/* ── 4. SEPARACIONES: ¿QUÉ USA CADA TARJETA? ──

   Esto es lo que decide si dos cosas que se tocan se distinguen. Si
   casi todas las tarjetas usan solo sombra, entonces la sombra es
   la única señal de separación y el ojo se cansa. Si unas usan borde
   y otras no, cada zona dice algo distinto. */

console.log("\n═══ 4. Cómo se separan las cosas ═══\n");

const REGISTROS = [
  { re: /\.card[\s,{]/g, nombre: ".card" },
  { re: /\.panel[\s,{]/g, nombre: ".panel" },
  { re: /\.tarjeta[\s,{]/g, nombre: ".tarjeta" },
  { re: /\.caja[\s{,]/g, nombre: ".caja" },
  { re: /\btable\b[^{]*\{/g, nombre: "table" },
];

for (const r of REGISTROS) {
  let conBorde = 0;
  let conSombra = 0;
  let conFondo = 0;
  let total = 0;

  for (const f of fs.readdirSync(CSS).filter((x) => x.endsWith(".css"))) {
    const t = fs.readFileSync(path.join(CSS, f), "utf8");

    for (const m of t.matchAll(new RegExp(r.re.source, "g"))) {
      const desde = m.index;
      const bloque = t.slice(desde, desde + 400);
      const abre = bloque.indexOf("{");
      const cierra = bloque.indexOf("}");
      if (abre < 0 || cierra < 0) continue;

      const cuerpo = bloque.slice(abre, cierra);
      total++;
      if (/border\s*:/.test(cuerpo)) conBorde++;
      if (/box-shadow\s*:/.test(cuerpo)) conSombra++;
      if (/background/.test(cuerpo)) conFondo++;
    }
  }

  if (total) {
    console.log(
      "  " + r.nombre.padEnd(12) +
      String(total).padStart(4) + " reglas   " +
      "borde " + String(conBorde).padStart(4) + "   " +
      "sombra " + String(conSombra).padStart(4) + "   " +
      "fondo " + String(conFondo).padStart(4)
    );
  }
}

console.log("");