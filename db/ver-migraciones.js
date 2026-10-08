/* ¿Qué migraciones cree el panel que faltan?
   ─────────────────────────────────────────────────────────────
   POR QUÉ HAY QUE MIRAR LAS DOS LISTAS

   El panel compara los ficheros de `db/migrations` con lo que hay
   anotado en `schema_migrations`. Si no coinciden, avisa.

   Y el aviso tiene razón en este caso: las tres migraciones SE
   aplicaron —el resultado fue «8 de 8» y la tabla existe con sus tres
   planes— pero se aplicaron con `db/aplicar-migracion.js`, que ejecuta
   el SQL y no anota nada en `schema_migrations`.

   Ese script se escribió para esta sesión, y tiene una ausencia:
   es cómodo, pero deja la base y el registro de migraciones
   discrepantes. El panel no se equivoca; está mirando el registro, y
   el registro está incompleto.

   ── LO QUE HACE ESTE SCRIPT ──

   Mostrar las dos listas para que se vea exactamente cuál es cuál,
   antes de tocar nada. Anotar a mano lo que ya se aplicó es correcto
   solo si se sabe qué se aplicó: por eso primero se pregunta. */

require("../lib/env").load();

const fs = require("fs");
const path = require("path");

const db = require("../lib/supabase").getAdmin();

const DIR = path.join(__dirname, "migrations");

(async () => {
  console.log("\n═══ Migraciones ═══\n");

  const ficheros = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const { data, error } = await db.rpc("ejecutar_sql", {
    consulta: "select nombre from schema_migrations order by nombre",
    args: [],
  });

  if (error) {
    console.log("  x no se pudo leer schema_migrations: " + error.message + "\n");
    process.exit(1);
  }

  const anotadas = new Set((data || []).map((r) => r.nombre));

  console.log("  ficheros: " + ficheros.length + "   anotadas: " + anotadas.size + "\n");

  const faltan = [];

  for (const f of ficheros) {
    const ok = anotadas.has(f);
    if (!ok) faltan.push(f);
    console.log("  " + (ok ? "·" : "!") + " " + f);
  }

  /* Y al revés: ficheros que ya no están pero siguen anotados.
     Pasa cuando alguien renombra una migración, y es el caso que más
     confunde: el panel dice que está al día y la base no lo está. */
  const huerfanas = [...anotadas].filter((n) => !ficheros.includes(n));

  if (huerfanas.length) {
    console.log("\n  anotadas pero el fichero no existe:");
    huerfanas.forEach((h) => console.log("  ! " + h));
  }

  console.log("");
  if (faltan.length) {
    console.log("  " + faltan.length + " sin anotar: " + faltan.join(", "));
    console.log("");
    console.log("  Ojo: que no estén anotadas no significa que no se");
    console.log("  aplicaran. Hay que comprobarlo una por una antes de");
    console.log("  anotarlas a mano, porque anotar lo que no se aplicó deja");
    console.log("  el panel mintiendo en la dirección contraria.");
  } else {
    console.log("  ✓ están todas anotadas");
  }
  console.log("");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});