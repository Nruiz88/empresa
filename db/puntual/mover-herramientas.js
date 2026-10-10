const fs = require("fs");
const path = require("path");

/* ═══════════════════════════════════════════════════════════════
   LO QUE SE LLAMA DESDE `package.json` A `db/herramientas/`

   ── POR QUÉ ESTOS Y NO OTROS ──

   Un `npm run` es una puerta de entrada: alguien lo escribe sin
   saber qué hay dentro. Los 89 scripts que tienen puerta se
   mueven a `herramientas/`, que es la carpeta de las cosas que se
   usan y se vuelven a usar.

   ── POR QUÉ EN LA RAÍZ NO ──

   Porque la raíz de `db/` es donde se busca cuando algo falla, y
   con 129 archivos ahí no se encuentra nada. Un archivo que está
   en la raíz y además tiene puerta de entrada no dice para qué
   sirve; el mismo archivo en `herramientas/` sí.

   ── LA RUTA ──

   Se mueve el archivo y se reescribe la referencia en el
   `package.json` y en los documentos, en el mismo paso. Un archivo
   movido con la referencia vieja es un `npm run` que falla con «no
   se encontró el módulo», que es el peor sitio para aprender que
   alguien mudó un archivo.
   ═══════════════════════════════════════════════════════════════ */

const RAIZ = "D:/webs/empresa";
const DB = path.join(RAIZ, "db");
const DESTINO = path.join(DB, "herramientas");

/* ── QUIÉN HABLA ── */

const HABLAN = [path.join(RAIZ, "package.json")];

for (const carpeta of ["docs"]) {
  const d = path.join(RAIZ, carpeta);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".md"))) {
    HABLAN.push(path.join(d, f));
  }
}
for (const f of fs.readdirSync(RAIZ).filter((x) => x.endsWith(".md"))) {
  HABLAN.push(path.join(RAIZ, f));
}

/* ── LAS RUTAS QUE HAY QUE MANTENER VIVAS ── */

const rutas = new Set();

for (const f of HABLAN) {
  const t = fs.readFileSync(f, "utf8");
  for (const m of t.matchAll(/db\/([\w./-]+\.(?:js|mjs))/g)) rutas.add(m[1]);
}

console.log("\n═══ Los que se mueven ═══\n");
console.log("  referred: " + rutas.size);

/* ── MOVER ── */

if (!fs.existsSync(DESTINO)) fs.mkdirSync(DESTINO, { recursive: true });

const movidos = new Map();
const fueraDeOrigen = [];

for (const r of rutas) {
  /* Solo los que están directamente en `db/`. Los que ya están en
     una subcarpeta se quedan donde están. */
  if (r.includes("/")) {
    fueraDeOrigen.push(r);
    continue;
  }

  const origen = path.join(DB, r);
  if (!fs.existsSync(origen)) continue;

  fs.renameSync(origen, path.join(DESTINO, r));
  movidos.set(r, "herramientas/" + r);
}

console.log("  movidos a herramientas/: " + movidos.size);
console.log("  ya estaban en subcarpeta: " + fueraDeOrigen.length);

/* ── REESCRIBIR QUIEN LOS LLAMA ── */

let corregidos = 0;

for (const f of HABLAN) {
  let t = fs.readFileSync(f, "utf8");
  const antes = t;

  for (const [viejo, nuevo] of movidos) {
    t = t.split("db/" + viejo).join("db/" + nuevo);
  }

  if (t !== antes) {
    fs.writeFileSync(f, t, "utf8");
    corregidos++;
  }
}

console.log("  archivos corregidos: " + corregidos);

/* ── COMPROBAR QUE NO QUEDA NADA ROTO ── */

const rotas = [];
for (const f of HABLAN) {
  const t = fs.readFileSync(f, "utf8");
  for (const m of t.matchAll(/db\/([\w./-]+\.(?:js|mjs))/g)) {
    if (!fs.existsSync(path.join(DB, m[1]))) rotas.push(f + " -> db/" + m[1]);
  }
}

console.log("\n  ── referencias rotas ──");
console.log("    " + (rotas.length ? rotas.join("\n    ") : "ninguna"));
console.log("");