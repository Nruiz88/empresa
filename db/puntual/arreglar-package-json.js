const fs = require("fs");
const path = require("path");

/* ═══════════════════════════════════════════════════════════════
   CORREGIR LAS RUTAS DE `package.json`

   ── EL PROBLEMA ──

   Los scripts de `db/` se movieron a `db/herramientas/`,
   `db/diagnostico/` y `db/puntual/`, y `package.json` seguía
   diciendo `node db/ver-vistas.js`. Un `npm run` así falla con «no
   se encontró el módulo», que es el peor sitio para enterarse de
   que alguien mudó un archivo.

   ── POR QUÉ BUSCA EL NOMBRE Y NO LA RUTA ──

   Porque el nombre es lo único que no cambió. La ruta sí. Y
   buscarlo por nombre en el subárbol de `db/` encuentra el archivo
   esté donde esté, y no depende de que la carpeta sea la que yo
   credo.

   ── POR QUÉ NO REESCRIBE EL ARCHIVO ──

   La primera vez que se hizo, `JSON.parse` más `JSON.stringify`
   cambiaron la indentación y las comillas de las 83 líneas del
   archivo. El commitolidó un diff de 85 líneas añadidas y 82
   borradas para cambiar una sola cosa, y el ruido esconde el
   cambio real.

   Aquí se edita el texto línea a línea, tocando solo las rutas que
   cambiaron.
   ═══════════════════════════════════════════════════════════════ */

const RAIZ = "D:/webs/empresa";
const DB = path.join(RAIZ, "db");

/* ── DÓNDE ESTÁ CADA SCRIPT ── */

const donde = new Map();

function recorrer(dir, prefijo) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const rel = prefijo ? prefijo + "/" + e.name : e.name;
    if (e.isDirectory()) recorrer(p, rel);
    else if (e.name.endsWith(".js") || e.name.endsWith(".mjs")) {
      donde.set(e.name, "db/" + rel);
    }
  }
}

recorrer(DB, "");

/* ── CORREGIR ── */

const ARCHIVO = path.join(RAIZ, "package.json");
const lineas = fs.readFileSync(ARCHIVO, "utf8").split("\n");

const cambios = [];
const rotas = [];

for (let i = 0; i < lineas.length; i++) {
  const antes = lineas[i];
  if (!antes.includes("db/")) continue;

  /* Se busca `db/<archivo>` y se pregunta dónde está ese archivo. */
  lineas[i] = antes.replace(/db\/([\w.-]+\.(?:js|mjs))/g, (m, nombre) => {
    if (!donde.has(nombre)) return m;

    const bueno = donde.get(nombre);
    if (bueno === m) return m;

    cambios.push({ linea: i + 1, de: m, a: bueno });
    return bueno;
  });
}

/* ── COMPROBAR QUE NO QUEDA NADA ROTO ── */

for (const l of lineas) {
  for (const m of l.matchAll(/db\/([\w./-]+\.(?:js|mjs))/g)) {
    if (!fs.existsSync(path.join(DB, m[1]))) rotas.push(m[1]);
  }
}

/* ── ESCRIBIR ── */

if (cambios.length) {
  fs.writeFileSync(ARCHIVO, lineas.join("\n"), "utf8");
}

console.log("\n═══ Las rutas de package.json ═══\n");
console.log("  corregidas: " + cambios.length + "\n");

for (const c of cambios.slice(0, 12)) {
  console.log("  L" + c.linea + "  " + c.de.padEnd(34) + "→ " + c.a);
}
if (cambios.length > 12) {
  console.log("  … y " + (cambios.length - 12) + " más");
}

console.log("\n  ── rotas ──");
console.log("    " + (rotas.length ? rotas.join(", ") : "ninguna"));
console.log("");