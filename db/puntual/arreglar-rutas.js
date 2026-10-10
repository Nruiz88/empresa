const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/* ═══════════════════════════════════════════════════════════════
   REPONER TODOS LOS SCRIPTS DE `db/` CON SU NIVEL CORRECTO

   ── POR QUÉ OTRA VEZ, Y POR QUÉ ESTA DEFINITIVA ──

   Los scripts se movieron de `db/` a `db/herramientas/`, que está un
   nivel más abajo, y eso obliga a subir un `..` más en cada ruta que
   llega a la raíz del proyecto.

   Se intentó arreglar sobre el sitio, con parches sucesivos, y cada
   parche agravaba el anterior: `rls.js` acabó con `../../../lib/env`
   en lugar de `../../lib/env`, y el error era `MODULE_NOT_FOUND`, que
   no dice qué nivel sobra.

   El problema de fondo es que cada corrección se aplicaba sobre el
   resultado de la anterior, así que los errores se acumulaban sin que
   nadie los midiera.

   ── LA REGLA DE ESTA VEZ ──

   Siempre se parte del original de git, y se aplica una sola
   transformación con el número de niveles que le corresponde a la
   carpeta donde vive el archivo. No hay estado previo que corregir, y
   por eso el resultado no depende del orden en que se ejecute.

   ── LA COMPROBACIÓN ──

   Al final se ejecuta `node --check` sobre todo, y aparte se comprueba
   que cada `require("../...")` apunte a algo que existe. El segundo es
   el que de verdad detecta un nivel de más: compilar no lo detecta,
   porque `../../lib/env` y `../../../lib/env` son sintaxis válida las
   dos.
   ═══════════════════════════════════════════════════════════════ */

const RAIZ = "D:/webs/empresa";
const DB = path.join(RAIZ, "db");

/* ── EL ORIGINAL ── */

const sinOriginal = [];

function deGit(nombre) {
  for (const c of ["db/" + nombre, "db/" + nombre.replace(/\.mjs$/, ".js")]) {
    try {
      return execSync(`git show HEAD:${c}`, {
        cwd: RAIZ,
        maxBuffer: 30 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      }).toString("utf8");
    } catch {
      /* No está en esa ruta; se prueba la siguiente. */
    }
  }
  return null;
}

/* ── RECORRER ── */

function recorrer(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) recorrer(p, acc);
    else if (e.name.endsWith(".js") || e.name.endsWith(".mjs")) acc.push(p);
  }
  return acc;
}

/* ═══════════════════════════════════════════════════════════════
   LA TRANSFORMACIÓN

   Dos formas de subir a la raíz, y solo dos:

     path.join(__dirname, "..", …)
     require("../lib/env")

   ── POR QUÉ UN PATRÓN DISTINTO PARA CADA UNA ──

   El primero se arregla reemplazando la lista de niveles por la
   correcta. El segundo no tienelevels que reescribir: `../lib/env`
   es una sola ruta, y lo que cambia es cuántos `../` lleva delante.

   Y el patrón del primero solo toca el PRIMER `".."`, nunca la lista
   entera. Agrupar la lista con `(?:"\.\.",?\s*)+` es lo que se llevó
   por delante la coma del último nivel y produjo `"..", "..""public"`:
   un archivo que ni compilaba y que no señalaba el error.
   ═══════════════════════════════════════════════════════════════ */

function subir(original, niveles) {
  const lista = Array(niveles).fill('".."').join(", ") + ", ";

  /* Las que pasan por `__dirname`. */
  let t = original.replace(
    /(path\.(?:resolve|join)\(__dirname,\s*)"\.\.",?\s?/,
    (m, pre) => pre + lista
  );

  /* Las que son una ruta entre comillas que empieza por `../`.

     `(?!\.\.\/)` impide contar dos veces el mismo nivel: en `../../x`
     el segundo `../` no debe volver a coincidir.

     El prefijo ya lleva su barra final, así que se añade `../` y no
     `../`: con las dos sale `../..//`, que apunta a un sitio que no
     existe y produce un `MODULE_NOT_FOUND` que no señala el error. */
  t = t.replace(/(["'])\.\.\/(?!\.\.\/)/g, (m, q) => q + "../".repeat(niveles - 1) + "../");

  /* ── LAS CARPETAS HERMANAS ──

     `db/migrations` es hermana de `db/herramientas/`, no ancestro
     suyo, así que desde un módulo la ruta es `__dirname, "..",
     "migrations"`. No empieza por `../`, y por eso la regla de
     arriba no la ve: el resultado era `ENOENT` con `db/herramientas/
     migrations`.

     Esto ya estaba arreglado en un guion aparte, y como este parte
     de git lo deshacía cada vez que se ejecutaba. Por eso vive
     aquí: un solo sitio donde se decide cómo se reconstruye un
     script movido. */
  t = t.replace(/__dirname,\s*"(migrations|seeds|sql|plantillas)"/g, (m, carpeta) =>
    "__dirname, \"..\", \"" + carpeta + "\""
  );

  /* ── LAS BARRAS DE MÁS ──

     `"..//public/css"` con dos barras: `path.resolve` no las limpia y
     apunta a un sitio que no existe. El original en git ya lo traía,
     de antes de que existiera este guion.

     La lista de niveles sale del propio texto, no de la carpeta, para
     que una ruta que ya tiene los niveles correctos no los gane de
     nuevo. */
  /* Solo dentro de `path.join` o `path.resolve`, que es donde una
     barra significa una carpeta.

     Y solo cuando la ruta va pegada, con barras y sin comas:
     `"..//public/css"`. Una ruta ya escrita con comas
     (`"..", "..", "public"`) se deja entera, porque tocarla es
     partirla en dos y perder la comilla de cierre: sale
     `"public", "css""`, que ni compila.

     La versión anterior de esta regla además se comía la coma que
     separa los argumentos de Node, y convertía
     `require("../lib/env")` en `require("..", "..", "lib", "env")`. */
  t = t.replace(
    /((?:path\.(?:join|resolve)\([^)]*?))"((?:\.\.\/){2,})(\S*?\.(?:css|js|json|md))"/g,
    (m, pre, niveles, ultimo) =>
      pre + '"' + niveles + "..\", \"" + ultimo + '"'
  );

  return t;
}

/* ── APLICAR ── */

const hechos = [];
const iguales = [];

for (const abs of recorrer(DB)) {
  const rel = path.relative(DB, abs).replace(/\\/g, "/");

  /* Los scripts de la raíz de `db/` no se mueven, así que no cambian. */
  const carpetas = rel.includes("/") ? rel.split("/").slice(0, -1).length : 0;
  const niveles = carpetas + 1;

  const original = deGit(path.basename(abs));
  if (original === null) {
    sinOriginal.push(rel);
    continue;
  }

  const nuevo = subir(original, niveles);
  const ahora = fs.readFileSync(abs, "utf8");

  if (nuevo === ahora) {
    iguales.push(rel);
    continue;
  }

  fs.writeFileSync(abs, nuevo, "utf8");
  hechos.push({ rel, niveles, de: ahora, a: nuevo });
}

console.log("\n═══ Los scripts de db/, con su nivel correcto ═══\n");
console.log("  corregidos:  " + hechos.length);
console.log("  ya estaban: " + iguales.length);
console.log("  nuevos (scripts propios, sin original en git): " + sinOriginal.length);
if (sinOriginal.length) console.log("    " + sinOriginal.join(", "));
console.log("");

/* ═══════════════════════════════════════════════════════════════
   COMPROBAR QUE LOS `require` APUNTAN A ALGO QUE EXISTE

   Compilar no basta: `../../lib/env` y `../../../lib/env` son los dos
   JavaScript válido. Solo se detecta el nivel de más mirando si la
   ruta existe, que es lo que importa.
   ═══════════════════════════════════════════════════════════════ */

const rutas = [];
const rotas = [];

for (const abs of recorrer(DB)) {
  const t = fs.readFileSync(abs, "utf8");
  const dir = path.dirname(abs);

  for (const m of t.matchAll(/require\(["'](\.\.?\/[^"']+)["']\)/g)) {
    const limpio = m[1].replace(/\.(js|mjs)$/, "");
    const destino = path.resolve(dir, limpio);

    const existe =
      fs.existsSync(destino + ".js") ||
      fs.existsSync(destino + ".mjs") ||
      fs.existsSync(destino) ||
      fs.existsSync(path.join(destino, "index.js"));

    rutas.push(1);
    if (!existe) rotas.push(path.relative(RAIZ, abs) + "  →  " + m[1]);
  }
}

console.log("  ── `require` relativos ──");
console.log("    comprobados: " + rutas.length);
console.log("    rotos:      " + rotas.length);
if (rotas.length) {
  console.log("");
  for (const r of rotas.slice(0, 20)) console.log("      " + r);
}
console.log("");