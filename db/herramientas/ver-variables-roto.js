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
   y aun así no está pasando nada.

   ── DÓNDE PUEDE NACER UNA VARIABLE ──

   En tres sitios, y buscar solo en uno de ellos produce avisos
   falsos:

     1. En el CSS, con `--x:`. Es el caso normal.
     2. En la vista, en un `style="--w:62%"`. Sin mirar el HTML,
        esa variable sale como rota.
     3. En el JavaScript, con `el.style.setProperty('--x', ...)`.

   Los tres se buscan. Antes solo se buscaba en el CSS, y `--w` y
   `--h` salían como rotas cuando las declaraba la propia vista. */

const fs = require("fs");
const path = require("path");

const RAIZ = "D:/webs/empresa";
const CSS = path.join(RAIZ, "public", "css");
const VISTAS = path.join(RAIZ, "views");
const JS = path.join(RAIZ, "public", "js");

const declaradas = new Set();

/* ── 1. El CSS ── */

for (const f of fs.readdirSync(CSS).filter((x) => x.endsWith(".css"))) {
  const t = fs.readFileSync(path.join(CSS, f), "utf8");
  for (const m of t.matchAll(/(--[\w-]+)\s*:/g)) declaradas.add(m[1]);
}

/* ── 2. Las vistas, en los `style` en línea ── */

(function juntar(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) juntar(p);
    else if (e.name.endsWith(".ejs")) {
      const t = fs.readFileSync(p, "utf8");
      for (const m of t.matchAll(/style="([^"]*)"/g)) {
        for (const v of m[1].matchAll(/(--[\w-]+)\s*:/g)) declaradas.add(v[1]);
      }
    }
  }
})(VISTAS);

/* ── 3. El JavaScript ── */

if (fs.existsSync(JS)) {
  for (const f of fs.readdirSync(JS).filter((x) => x.endsWith(".js"))) {
    const t = fs.readFileSync(path.join(JS, f), "utf8");
    for (const v of t.matchAll(/(--[\w-]+)\s*:/g)) declaradas.add(v[1]);
  }
}

/* ── Los usos ── */

const usos = new Map();

for (const f of fs.readdirSync(CSS).filter((x) => x.endsWith(".css"))) {
  const t = fs.readFileSync(path.join(CSS, f), "utf8");

  for (const m of t.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
    const nombre = m[1];
    const conRespaldo = m[2] === ",";

    if (!usos.has(nombre)) usos.set(nombre, { sitios: [], conRespaldo: false });
    const u = usos.get(nombre);

    const linea = t.slice(0, m.index).split("\n").length;
    const desde = Math.max(0, m.index - 46);
    const fragmento = t.slice(desde, m.index + nombre.length + 2).replace(/\s+/g, " ").trim();

    u.sitios.push({ donde: f + " L" + linea, fragmento });
    if (conRespaldo) u.conRespaldo = true;
  }
}

const rotas = [...usos.entries()]
  .filter(([nombre]) => !declaradas.has(nombre))
  .filter(([, u]) => !u.conRespaldo);

console.log("\n═══ Variables que se usan y no existen ═══\n");

if (!rotas.length) {
  console.log("  ninguna. Todas las que se usan están declaradas en el CSS,");
  console.log("  en una vista o en el JavaScript.");
} else {
  for (const [nombre, u] of rotas) {
    console.log("  " + nombre.padEnd(20) + String(u.sitios.length).padStart(3) + " usos");
    for (const s of u.sitios.slice(0, 4)) {
      console.log("      " + s.donde);
      console.log("        … " + s.fragmento);
    }
  }
}

console.log("\n  ──────────────────────────────────────────────");
console.log("  declaradas: " + declaradas.size);
console.log("  usadas:     " + usos.size);
console.log("  rotas:      " + rotas.length);
console.log("");

process.exit(rotas.length ? 1 : 0);
