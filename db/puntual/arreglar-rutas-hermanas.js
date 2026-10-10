const fs = require("fs");

/* ═══════════════════════════════════════════════════════════════
   LAS DOS ÚLTIMAS RUTAS QUE NO SUBEN A LA RAÍZ

   ── EL PROBLEMA ──

   Los scripts se movieron de `db/` a `db/herramientas/`. Casi todas
   sus rutas subían a la raíz del proyecto y hubo que añadirles un
   `..`. Pero quedaban dos clases que no son de ese tipo:

     1. Rutas a carpetas HERMANAS. `db/migrations` es hermana de
        `db/herramientas/`, no ancestro suyo, así que la ruta correcta
        es `__dirname, "..", "migrations"`. El error era
        `ENOENT: db\herramientas\migrations`.

     2. Una barra de más: `"..//public/css"`. Con dos barras,
        `path.join` las deja y el resultado apunta a un sitio que no
        existe. Se ve como `..//`, que es fácil de no ver al pasar
        por delante.

   ── POR QUÉ UN ARCHIVO Y NO EL COMANDO ──

   Porque en PowerShell el código con comillas y barras se desarma
   antes de llegar a Node, y ya se perdiendo tiempo en eso dos veces.
   ═══════════════════════════════════════════════════════════════ */

/* ── 1. CARPETAS HERMANAS ── */

const HERMANAS = [
  "db/herramientas/migrate.js",
  "db/diagnostico/ver-migraciones.js",
  "db/herramientas/test-idempotencia.js",
];

/* ── 2. LA BARRA DE MÁS ── */

const BARRAS = [
  "db/herramientas/ver-css-entero.js",
  "db/ver-css-duplicados.js",
];

console.log("\n═══ Las rutas que no suben a la raíz ═══\n");

let hechos = 0;

for (const f of HERMANAS) {
  if (!fs.existsSync(f)) continue;

  const antes = fs.readFileSync(f, "utf8");
  const despues = antes.split('__dirname, "migrations"').join('__dirname, "..", "migrations"');

  if (despues !== antes) {
    fs.writeFileSync(f, despues, "utf8");
    console.log("  " + f.padEnd(40) + "migrations → .. /migrations");
    hechos++;
  }
}

for (const f of BARRAS) {
  if (!fs.existsSync(f)) continue;

  const antes = fs.readFileSync(f, "utf8");

  /* Se repite el `../` que hay, separado por comas, en vez de piling
     barras: `"..//"` pasa a `"..", ".."`. El patrón cuenta las barras
     seguidas para no tener que escribir un caso por cada cantidad. */
  const despues = antes.replace(/"(\.\.\/)+\//g, (m) => {
    const niveles = (m.match(/\.\.\//g) || []).length;
    return Array(niveles).fill('".."').join(", ") + ", ";
  });

  if (despues !== antes) {
    fs.writeFileSync(f, despues, "utf8");
    console.log("  " + f.padEnd(40) + "barras de más corregidas");
    hechos++;
  }
}

console.log("\n  corregidos: " + hechos + "\n");