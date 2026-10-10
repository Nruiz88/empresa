require("../../lib/env").load();

const db = require("../../lib/supabase").getAdmin();

/* ─────────────────────────────────────────────────────────────
   TODAS LAS CLAVES FORÁNEAS QUE APUNTAN A UNO

   Un borrado mal montado no avisa: borra lo que puede y deja lo
   demás, y se descubre meses después que falta una factura.

   ── POR QUÉ LAS PREGUNTA A POSTGRES Y NO AL CÓDIGO ──

   Porque el código usa Supabase sin joins anidados casi nunca: cada
   vista lee una tabla y ya está. Nadie tiene la lista completa de
   qué cuelga de qué, y esa lista es exactamente la que hace falta
   para borrar sin dejar flecos.

   Postgres sí la tiene, en `information_schema`, y dice también qué
   hace al borrar: `CASCADE` se lleva los hijos, `RESTRICT` se niega.
   ───────────────────────────────────────────────────────────── */

(async () => {
  console.log("\n═══ Qué cuelga de clients ═══\n");

  const { data, error } = await db.rpc("ejecutar_sql", {
    consulta:
      "select tc.table_name as tabla, kcu.column_name as columna, " +
      "       rc.delete_rule as al_borrar, " +
      "       ccu.table_name as apunta_a " +
      "from information_schema.table_constraints tc " +
      "join information_schema.key_column_usage kcu " +
      "  on tc.constraint_name = kcu.constraint_name " +
      "join information_schema.referential_constraints rc " +
      "  on tc.constraint_name = rc.constraint_name " +
      "join information_schema.constraint_column_usage ccu " +
      "  on tc.constraint_name = ccu.constraint_name " +
      "where tc.constraint_type = 'FOREIGN KEY' " +
      "  and ccu.table_name = 'clients' " +
      "order by tc.table_name",
    args: [],
  });

  if (error) {
    console.log("  x " + error.message + "\n");
    process.exit(1);
  }

  console.log("  tabla                  columna         al borrar   apunta a");
  for (const f of data || []) {
    console.log(
      "  " + String(f.tabla).padEnd(22) +
      String(f.columna).padEnd(15) +
      String(f.al_borrar).padEnd(11) +
      f.apunta_a
    );
  }

  /* Lo que cuelga de services, que es el segundo nivel. */
  const { data: data2 } = await db.rpc("ejecutar_sql", {
    consulta:
      "select tc.table_name as tabla, kcu.column_name as columna, rc.delete_rule as al_borrar " +
      "from information_schema.table_constraints tc " +
      "join information_schema.key_column_usage kcu on tc.constraint_name = kcu.constraint_name " +
      "join information_schema.referential_constraints rc on tc.constraint_name = rc.constraint_name " +
      "join information_schema.constraint_column_usage ccu on tc.constraint_name = ccu.constraint_name " +
      "where tc.constraint_type = 'FOREIGN KEY' and ccu.table_name = 'services' " +
      "order by tc.table_name",
    args: [],
  });

  console.log("");
  console.log("  y de services:");
  for (const f of data2 || []) {
    console.log(
      "  " + String(f.tabla).padEnd(22) +
      String(f.columna).padEnd(15) +
      f.al_borrar
    );
  }

  console.log("");
  console.log("  ──────────────────────────────────────────────");
  console.log("  `cascade` se lleva los hijos solo. `restrict` se niega,");
  console.log("  y ahí el borrado hay que hacerlo de dentro hacia fuera.");
  console.log("");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});
