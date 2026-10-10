/* Quita el registro de una migración para poder reaplicarla.

   OJO: esto solo borra el REGISTRO, no lo que la migración creó. Por
   eso la migración usa `create table if not exists`: reaplicarla no
   toca lo que ya existe. Y por eso hay que tener cuidado al
   REESCRIBIR una migración ya aplicada (cambiar un tipo de retorno,
   por ejemplo): reaplicarla no deshace el cambio anterior.

   `-- !` fuerza la reaplicación aunque el registro esté o no: borra el
   registro y dice claramente que va a dejar cosas a medias, porque
   reaplicar una migración que crea tablas no las reconstruye.
*/
const { Client } = require("pg");
require("../../lib/env").load();

const c = new Client({ connectionString: process.env.DATABASE_URL });

(async () => {
  const argumentos = process.argv.slice(2);
  const forzar = argumentos.includes("--!");
  const nombres = argumentos.filter((a) => a !== "--!");

  if (!nombres.length) {
    console.error("uso: node db/des-aplicar.js <migracion.sql> [--!]");
    process.exit(1);
  }

  await c.connect();

  if (forzar) {
    console.log("  (modo forzado: se ignora si el registro estaba o no)");
  }

  for (const nombre of nombres) {
    const r = await c.query("delete from schema_migrations where nombre = $1", [nombre]);
    if (r.rowCount) {
      console.log("quitado   " + nombre);
    } else {
      console.log("no estaba " + nombre);
      if (forzar) {
        console.log("           (reaplicando igualmente por --!)");
      }
    }
  }

  await c.end();
})().catch((e) => {
  console.error("✗ " + e.message);
  process.exit(1);
});