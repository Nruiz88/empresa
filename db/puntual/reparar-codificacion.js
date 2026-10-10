const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/* ═══════════════════════════════════════════════════════════════
   DETECTAR Y REVERTIR EL DOBLE UTF-8

   ── EL DAÑO ──

   Un paso mío reescribió archivos con PowerShell: `Get-Content -Raw`
   sin `-Encoding` lee en el modo por defecto del equipo, que no es
   UTF-8, y un archivo UTF-8 leído así se convierte en mojibake
   (`ENSEÑAR` pasa a `ENSEÃ‘AR`). Al guardarlo como UTF-8 el archivo
   queda con los bytes duplicados y no vuelve a ser legible.

   PowerShell no avisó: `git status` solo muestra «modificado», que es
   lo mismo que un cambio de rutas legítimo.

   ── POR QUÉ SE BUSCA CONTRA GIT Y NO POR PATRÓN ──

   Porque el mojibake tiene una forma fija, sí, pero escribir el patrón
   de la forma fija no demuestra que un archivo esté dañado: también
   habría que comprobar que el archivo tiene su contenido original.
   Git tiene el original. La comparación es directa.

   ── LA REVERSIÓN ──

   Los caracteres dañados son todos < 256, porque son bytes que
   individually caben en un byte. Codificarlos en latin1 devuelve los
   bytes originales, y al decodificarlos como UTF-8 sale el texto
   bueno. Solo se aplica a los archivos que, comparados con git,
   differed en más que las rutas.
   ═══════════════════════════════════════════════════════════════ */

const RAIZ = "D:/webs/empresa";

/* ── TODOS LOS ARCHIVOS JS/MJS QUE ESTRAN BAJO `db/` ── */

function recorrer(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) recorrer(p, acc);
    else if (e.name.endsWith(".js") || e.name.endsWith(".mjs")) acc.push(p);
  }
  return acc;
}

const archivos = recorrer(path.join(RAIZ, "db"));

/* ── EL ORIGINAL DE GIT ── */

/* El original se busca en la ruta actual y, si no está, en `db/`
   con el mismo nombre de archivo.

   Porque los scripts se movieron a subcarpetas y git solo conoce la
   ruta vieja: preguntar por `db/herramientas/x.js` en HEAD falla, pero
   `db/x.js` sigue ahí. */
function originalDe(relativo) {
  const base = path.basename(relativo);
  const candidatos = [
    relativo,
    "db/" + base,
    relativo.replace(/^db\/[^/]+\//, "db/"),
  ];

  for (const c of candidatos) {
    try {
      return execSync(`git show HEAD:${c}`, {
        cwd: RAIZ,
        maxBuffer: 20 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      }).toString("utf8");
    } catch {
      /* Este candidato no existe en HEAD. Se prueba el siguiente. */
    }
  }
  return null;
}

/* ── COMPARAR ── */

const danados = [];
const igual = [];
const nuevos = [];

for (const abs of archivos) {
  const rel = path.relative(RAIZ, abs).replace(/\\/g, "/");
  const ahora = fs.readFileSync(abs, "utf8");
  const antes = originalDe(rel);

  if (antes === null) {
    nuevos.push(rel);
    continue;
  }
  if (antes === ahora) {
    igual.push(rel);
    continue;
  }

  /* El candidato a reparación: reinterpretar el texto actual como
     bytes latin1, que es lo que haría deshacer el doble UTF-8. */
  const reparado = Buffer.from(ahora, "latin1").toString("utf8");

  if (reparado === antes) danados.push({ rel, antes, reparado });
  else {
    /* No es solo encoding: hay un cambio real de contenido. Se
       avisa en vez de tocar, porque puede ser una de las correcciones
       de rutas que sí queremos conservar. */
    danados.push({ rel, antes, reparado, parcial: true });
  }
}

console.log("\n═══ Estado de la codificación ═══\n");
console.log("  idénticos a git:      " + igual.length);
console.log("  solo daño de UTF-8:   " + danados.filter((d) => !d.parcial).length);
console.log("  con cambios reales:   " + danados.filter((d) => d.parcial).length);
console.log("  sin original en git:  " + nuevos.length);
console.log("");

if (danados.filter((d) => !d.parcial).length) {
  console.log("\n  ── dañados ──");
  for (const d of danados.filter((x) => !x.parcial)) console.log("    " + d.rel);
}

if (danados.filter((d) => d.parcial).length) {
  console.log("\n  ── con cambios reales (NO se tocan) ──");
  for (const d of danados.filter((x) => x.parcial)) console.log("    " + d.rel);
}

/* ── REPARAR, SI PIDES ── */

if (process.argv.includes("--si")) {
  let n = 0;
  for (const d of danados.filter((x) => !x.parcial)) {
    fs.writeFileSync(path.join(RAIZ, d.rel), d.reparado, "utf8");
    n++;
  }
  console.log("\n  reparados: " + n + "\n");
} else {
  console.log("\n  ── SIMULACRO. Con --si se repara.\n");
}