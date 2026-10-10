const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/* ═══════════════════════════════════════════════════════════════
   REPONER DESDE GIT Y SUBIR UN NIVEL, BIEN HECHO

   ── LOS DOS ERRORES DEL INTENTO ANTERIOR ──

   El patrón que agrupaba los niveles era `(?:"\.\.",?\s*)+`. Eso
   terminaba de agrupar con la coma y el espacio del último nivel, y
   al reemplazarlo por `"..", ".."` se perdía la coma de separación:
   quedaba `"..", "..""public"`, que ni es JavaScript válido ni dice
   nada de dónde sale el error.

   Y el número de niveles salía mal porque el mismo patrón se
   aplicaba sobre un archivo que ya había pasado por el arreglo
   anterior, así que cada nivel se contaba dos veces.

   ── EL ARREGLO ──

   Dos cambios, y ninguno de los dos es un parche:

     1. Se empieza siempre del original de git. Así no hay estado
        acumulado que corregir.

     2. El patrón solo toca el PRIMER `".."` y su separador, y lo
        reemplaza por la lista correcta de niveles. El resto de la
        llamada se queda como estaba, porque el patrón no llega a
        él.

   ── POR QUÉ EL PATRÓN ES ESTRECHO A PROPÓSITO ──

   Un patrón que agrupa toda la lista de niveles parece más elegantey
   es justo lo que rompió esto: se lleva por delante el separador
   porque forma parte de lo que captura. Un patrón que toca lo
   mínimo deja de necesitar que el separador lo treatmentre.
   ═══════════════════════════════════════════════════════════════ */

const RAIZ = "D:/webs/empresa";

const DANADOS = [
  "herramientas/captura-cliente.js",
  "herramientas/captura.js",
  "herramientas/sonda-anchura.js",
  "herramientas/test-dominios.js",
  "herramientas/test-env.js",
  "herramientas/test-panel-html.js",
  "herramientas/ver-vistas.js",
  "puntual/coolify.js",
  "puntual/poner-variables-coolify.js",
  "puntual/probar-borrar-dominio.js",
  "puntual/probar-campos-dominio.js",
  "puntual/probar-dominio.js",
  "puntual/quitar-dominios.js",
  "puntual/sacar-duplicados-coolify.js",
  "ver-despliegues-bot.js",
  "ver-auth-crudo.mjs",
];

function deGit(ruta) {
  return execSync(`git show HEAD:${ruta}`, {
    cwd: RAIZ,
    maxBuffer: 20 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  }).toString("utf8");
}

console.log("\n═══ Reponer y subir un nivel ═══\n");

let hechos = 0;
const fallos = [];
const muestras = [];

for (const rel of DANADOS) {
  const base = path.basename(rel);

  let original = null;
  for (const c of ["db/" + base, "db/" + rel]) {
    try {
      original = deGit(c);
      break;
    } catch {
      /* No está en esa ruta. */
    }
  }
  if (original === null) {
    fallos.push(rel);
    continue;
  }

  /* Cuántos niveles: uno por cada CARPETA dentro de `db/`, más el
     `db/` en sí. En la raíz son 1; en `db/herramientas/`, 2.

     El `- 1` quita el nombre del archivo, que `split("/")` también
     cuenta y que no es una carpeta. */
  const carpetas = rel.includes("/") ? rel.split("/").length - 1 : 0;
  const niveles = carpetas + 1;
  const lista = Array(niveles).fill('".."').join(", ") + ", ";

  /* Solo el primer `".."` y su coma. El patrón acaba en el espacio
     que sigue a la coma, así que el separador del último nivel queda
     en la lista y no se pierde nada. */
  let n1 = original.replace(/(path\.(?:resolve|join)\(__dirname,\s*)"\.\.",?\s?/, (m, pre) => pre + lista);

  /* Las rutas sueltas: `require("../lib/env")`. Una sola condición,
     porque `(?!\.\.\/)` impide contar dos veces el mismo nivel. */
  let n2 = n1.replace(/(["'])\.\.\/(?!\.\.\/)/g, (m, q) => q + "../".repeat(niveles) + "/");

  const destino = path.join(RAIZ, "db", rel);
  fs.writeFileSync(destino, n2, "utf8");
  hechos++;

  if (muestras.length < 6) {
    const linea = n2.split("\n").find((l) => /path\.(resolve|join)\(__dirname/.test(l));
    if (linea) muestras.push(rel + "  →  " + linea.trim().slice(0, 70));
  }
}

console.log("  repuestos: " + hechos);
if (fallos.length) {
  console.log("\n  ── no se pudieron reponer ──");
  for (const f of fallos) console.log("    " + f);
}
console.log("\n  ── muestra ──");
for (const m of muestras) console.log("    " + m);
console.log("");