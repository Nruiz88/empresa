require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

/* Limpia las filas de prueba que dejan las pruebas del alta.

   Se identifican por la marca en las notas, no por fecha ni por
   cualquier otra cosa: una fila real tiene notas escritas por alguien,
   y una de prueba tiene un prefijo que solo ponen los scripts. */
(async () => {
  console.log("\n═══ Filas de prueba ═══\n");

  const { data, error } = await db.rpc("ejecutar_sql", {
    consulta:
      "select id, kind, microservicio_clave, plan_id, notas from services " +
      "where notas like 'PRUEBA%'",
    args: [],
  });

  if (error) {
    console.log("  x " + error.message + "\n");
    process.exit(1);
  }

  console.log("  a borrar: " + ((data || []).length));

  for (const s of data || []) {
    console.log("    " + s.id.slice(0, 8) + "  " + s.kind +
      "  " + (s.microservicio_clave || s.plan_id || "—") +
      "  " + JSON.stringify(s.notas).slice(0, 34));
  }

  if (!(data || []).length) {
    console.log("\n  (no hay ninguna)\n");
    return;
  }

  /* Por el cliente de servicio: el RPC `ejecutar_sql` solo admite
     SELECT, y eso es lo que debe. */
  const { error: eB } = await db
    .from("services")
    .delete()
    .in("id", (data || []).map((s) => s.id));

  console.log("");
  console.log(eB ? "  x no se pudo borrar: " + eB.message : "  borradas");

  const { data: quedan } = await db.rpc("ejecutar_sql", {
    consulta: "select count(*) as c from services where notas like 'PRUEBA%'",
    args: [],
  });

  console.log("  quedan: " + (quedan && quedan[0] ? quedan[0].c : 0));
  console.log("");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});