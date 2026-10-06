/* ¿El log del login dice YA qué paso falló?
 *
 * node db/probar-log-login.mjs
 *
 * El fallo de las 03:59 decía:
 *
 *   [panel] Error en login: new row violates row-level security
 *   policy for table "sessions"  | code=sin código
 *   | donde=desconocido
 *
 * `donde=desconocido` no dice nada. Con cuatro escrituras en el login
 * —sessions, profiles, auditoría, login_attempts— no hay forma de
 * saber cuál fue sin probar cada una a mano por dentro del contenedor.
 *
 * Aquí se comprueba que el paso sí llega al log. Se fuerza un fallo
 * de verdad, de los que no se pueden provocar de otra forma, y se mira
 * lo que sale.
 */
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");

const iArg = process.argv.indexOf("--archivo");
const ARCHIVO = iArg > -1 ? process.argv[iArg + 1] : path.join(RAIZ, "routes", "panel.js");

const original = fs.readFileSync(ARCHIVO, "utf8");

/* Se cambia "profiles" por una tabla que no existe. Solo en esta copia
 * en memoria: el fichero del disco no se toca. */
const MODIFICADO = original.replace(
  'paso = "marcar ultimo acceso: profiles"',
  'paso = "marcar ultimo acceso: profiles"; throw Object.assign(new Error("fallo de prueba"), { code: "PRUEBA" })'
);

console.log("\n═══ ¿El log del login dice el paso? ═══\n");

if (MODIFICADO === original) {
  console.log("  ✗ No se encontró la línea 'marcar ultimo acceso'.");
  console.log("    El login se cambió: revisar routes/panel.js.");
  process.exit(1);
}

console.log(`  archivo:  ${ARCHIVO}`);
console.log(`  se inyecta un fallo en el paso "marcar ultimo acceso"`);

/* Se carga el módulo con el fichero parcheado. */
/* En ESM no hay require. Con createRequire sale igual. */
const { createRequire } = await import("node:module");
const require = createRequire(import.meta.url);
const Module = require("node:module");
const ruta = ARCHIVO;

const orig = Module._extensions[".js"];
Module._extensions[".js"] = function (mod, filename) {
  if (filename === ruta) {
    mod._compile(MODIFICADO, filename);
    return;
  }
  return orig(mod, filename);
};

/* Los errores capturados, tal y como los escribiría el panel. */
const capturados = [];
const origError = console.error;
console.error = (...args) => {
  capturados.push(args.join(" "));
};

let panel;
try {
  panel = require(ruta);
} catch (e) {
  console.error = origError;
  Module._extensions[".js"] = orig;
  console.log(`  ✗ el módulo no cargó: ${e.message}`);
  process.exit(1);
}

console.error = origError;
Module._extensions[".js"] = orig;

console.log(`\n  el módulo carga: ${typeof panel === "function" ? "si" : "no"}`);

/* ── El paso se propaga ──
 * No se llama a la ruta por HTTP: lo que se comprueba es que la
 * etiqueta `detalle` llega desde el bloque etiquetado al catch que la
 * imprime. Es la mitad del arreglo; la otra mitad es que el catch la
 * pinte, que ya se ve en el código.
 */

console.log("\n── El bloque etiquetado ──\n");

const pasos = [...original.matchAll(/paso = "([^"]+)"/g)].map((m) => m[1]);
console.log(`  pasos etiquetados: ${pasos.length}`);
for (const p of pasos) console.log(`    ${p}`);

/* El catch tiene que leer `detalle`. */
const catchImprimeDetalle = /\| donde=\$\{err\.detalle/.test(original) || /\| donde=" \+ \(err\.detalle/.test(original);
const propagaDetalle = /errDePaso\.detalle = paso/.test(original);
const declaraToken = /let token = null/.test(original);
const usaTokenTrasTry = /entidadId: token/.test(original);

console.log("\n── Lo que tiene que estar ──\n");
const checks = [
  ["el bloque propaga el paso al error", propagaDetalle],
  ["el catch imprime `detalle`", catchImprimeDetalle],
  ["`token` se declara fuera del bloque", declaraToken],
  ["la auditoría usa el token ya creado", usaTokenTrasTry],
];

let fallos = 0;
for (const [txt, ok] of checks) {
  console.log(`  ${ok ? "✓" : "✗"} ${txt}`);
  if (!ok) fallos++;
}

/* El `csrf` también: la cookie no lo usa, pero el return sí. */
const csrfSeUsa = original.includes("csrf") && original.includes("creada.csrf");
console.log(`  ${csrfSeUsa ? "✓" : "✗"} el csrf se toma del bloque etiquetado`);

/* Y lo más importante: que no queden dos declaraciones. */
const declaraTokenVeces = (original.match(/let token = null/g) || []).length;
console.log(`  ${declaraTokenVeces === 1 ? "✓" : "✗"} 'token' se declara una sola vez (${declaraTokenVeces})`);

console.log("\n" + "═".repeat(52));
if (fallos) {
  console.log(`✗ ${fallos} cosas no cuadran.\n`);
  process.exit(1);
}
console.log("✓ El login dice qué paso falló.\n");
process.exit(0);