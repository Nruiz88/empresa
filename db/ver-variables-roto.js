/* Busca variables CSS que se USAN pero no están DECLARADAS.
   Uso: node db/ver-variables-roto.js

   ── POR QUÉ ESTA COMPROBACIÓN ──

   Una variable que se usa y no existe no da ningún error. El
   navegador descarta la declaración entera y sigue, como si la
   regla no estuviera.

   Se encontró así: `--btn-glow` se usaba en cinco sitios de dos
   hojas y no estaba en ninguna, y el botón principal llevaba
   tiempo sin sombra sin que nada lo dijera.

   Es la clase de fallo más silenciosa que hay en CSS, porque la
   regla se ve escrita, el archivo se abre, el valor se lee bien
   y aun así no está pasando nada. */

const fs = require("fs");
const path = require("path");

const CSS = path.join("D:/webs/empresa", "public", "css");

const hojas = fs.readdirSync(CSS).filter((f) => f.endsWith(".css"));
const textos = hojas.map((f) => ({ f, t: fs.readFileSync(path.join(CSS, f), "utf8") }));

/* ── Lo declarado ──

   Se buscan en TODO el CSS, no solo en `:root`, porque un token
   puede declararse en un bloque temático y vale para todo lo que
   cuelgue de él.

   Y se excluyen las custom properties que de declare en una
   interpolación: no es lo mismo `--x:` que `--x-foo:`. */
const declaradas = new Set();

for (const { t } of textos) {
  for (const m of t.matchAll(/(--[\w-]+)\s*:/g)) declaradas.add(m[1]);

  /* Los `var(--x, otro)` traen un valor de reserva, así que la
     variable principal puede faltar y aun así funcionar. Se
     distinguen abajo. */
}

/* ── Lo usado ── */

const usos = new Map();

for (const { f, t } of textos) {
  for (const m of t.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
    const nombre = m[1];
    const conRespaldo = m[2] === ",";

    if (!usos.has(nombre)) usos.set(nombre, { sitios: [], conRespaldo: false });
    const u = usos.get(nombre);
    u.sitios.push(f + " L" + t.slice(0, m.index).split("\n").length);
    if (conRespaldo) u.conRespaldo = true;
  }
}

const rotas = [...usos.entries()]
  .filter(([nombre]) => !declaradas.has(nombre))
  .filter(([, u]) => !u.conRespaldo);

console.log("\n═══ Variables que se usan y no existen ═══\n");

if (!rotas.length) {
  console.log("  ninguna. Todas las que se usan están declaradas.");
} else {
  for (const [nombre, u] of rotas) {
    console.log("  " + nombre.padEnd(20) + String(u.sitios.length).padStart(3) + " usos");
    for (const s of u.sitios.slice(0, 4)) console.log("      " + s);
  }
}

console.log("\n  ──────────────────────────────────────────────");
console.log("  declaradas: " + declaradas.size);
console.log("  usadas:     " + usos.size);
console.log("  rotas:      " + rotas.length);
console.log("\n  ── Solo se miran las hojas de public/css. Una");
console.log("     variable declarada en un .ejs o un .js sale aquí");
console.log("     como rota aunque no lo sea.\n");

process.exit(rotas.length ? 1 : 0);
