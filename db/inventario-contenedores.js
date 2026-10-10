/* Inventario de contenedores: qué se usa, cuántas veces se declara.
   Uso: node db/inventario-contenedores.js  (solo lee) */

const fs = require("fs");
const path = require("path");

const RAIZ = "D:/webs/empresa";

/* ── POR QUÉ ESTE INVENTARIO ──

   `.panel-stat` está declarado DOS veces en panel.css (línea 983 y
   5163), y `--alerta` otras dos. Dos declaraciones del mismo nombre
   en la misma hoja: la segunda pisa a la primera, y la que gana
   depende del orden, no de cuál está bien.

   Eso convierte cualquier ajuste en un misterio: se cambia una regla,
   no se ve nada, y el motivo está a cuatrocientas líneas.

   Este script lista las clases de contenedor y dice cuántas veces
   aparecen como declaración, para que la repetición se vea antes de
   arreglar nada. */

const hojas = ["panel.css", "portal.css", "aplicaciones.css", "aplicacion-form.css", "plan-apps.css"];

/* Las que son contenedores: cajas, tarjetas, bloques con fondo. */
const FAMILIA = /^(panel-card|panel-panel|panel-tarjeta|panel-stat|panel-box|panel-alert|panel-note|panel-empty|panel-resumen|panel-agenda|panel-summary|panel-bloque)/;

const decl = {};
const usos = {};

for (const f of hojas) {
  const ruta = path.join(RAIZ, "public", "css", f);
  if (!fs.existsSync(ruta)) continue;
  const t = fs.readFileSync(ruta, "utf8");

  for (const m of t.matchAll(/^\.([a-z][\w-]*)\s*(?:,|\{)/gm)) {
    const c = m[1];
    if (!FAMILIA.test(c)) continue;
    (decl[c] = decl[c] || []).push(f + " L" + t.slice(0, m.index).split("\n").length);
  }
}

/* Cuántas veces se usa cada clase en las vistas, para distinguir las
   que están duplicadas pero se usan de las que son aprovechadas. */
const vistas = path.join(RAIZ, "views");
const todasVistas = [];

function juntar(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) juntar(p);
    else if (e.name.endsWith(".ejs")) todasVistas.push(fs.readFileSync(p, "utf8"));
  }
}
juntar(vistas);

const html = todasVistas.join("\n");

for (const c of Object.keys(decl)) {
  usos[c] = (html.match(new RegExp('class="[^"]*\\b' + c + "\\b", "g")) || []).length;
}

console.log("\n═══ Contedores declarados más de una vez ═══\n");

const repetidas = Object.entries(decl).filter(([, v]) => v.length > 1);

if (!repetidas.length) {
  console.log("  ninguno.");
} else {
  for (const [c, donde] of repetidas.sort((a, b) => b[1].length - a[1].length)) {
    console.log(
      "  ." + c.padEnd(22) +
      "declarada " + donde.length + " veces  " +
      (usos[c] ? "(se usa " + usos[c] + ")" : "(NO se usa)") +
      "  " + donde.join("  ")
    );
  }
}

console.log("\n═══ Todos los contenedores ═══\n");

for (const [c, donde] of Object.entries(decl).sort()) {
  console.log(
    "  ." + c.padEnd(22) +
    (donde.length > 1 ? "x" + donde.length + "  " : "     ") +
    String(usos[c]).padStart(3) + " usos"
  );
}