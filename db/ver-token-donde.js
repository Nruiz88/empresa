require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

/* ¿El token quedó donde no lo lee nadie?
   Se comprueba lo que importa: que la tabla nueva está protegida, que
   `bots` ya no tiene credenciales, y que el token está dentro. */
(async () => {
  console.log("\n═══ ¿Dónde quedó el token? ═══\n");

  const { data: inst } = await db.rpc("ejecutar_sql", {
    consulta:
      "select instance_name, length(token) as largo from evolution_instancias order by 1",
    args: [],
  });

  console.log("  evolution_instancias:");
  if (!inst || !inst.length) console.log("    (vacía — el bot usará la clave global)");
  (inst || []).forEach((r) =>
    console.log("    " + r.instance_name + "   token de " + r.largo + " caracteres")
  );

  const { data: cols } = await db.rpc("ejecutar_sql", {
    consulta:
      "select column_name from information_schema.columns " +
      "where table_name = 'bots' and (column_name like '%token%' or column_name like '%key%' " +
      "or column_name like '%secret%')",
    args: [],
  });

  console.log("");
  console.log("  columnas de credencial en bots: " + (cols || []).length);
  (cols || []).forEach((c) => console.log("    " + c.column_name));

  const { data: rls } = await db.rpc("ejecutar_sql", {
    consulta:
      "select c.relrowsecurity, (select count(*)::int from pg_policies p " +
      "where p.tablename = c.relname) as politicas " +
      "from pg_class c where c.relname = 'evolution_instancias'",
    args: [],
  });

  console.log("");
  if (rls && rls[0]) {
    console.log("  evolution_instancias: RLS=" + rls[0].relrowsecurity +
      "  políticas=" + rls[0].politicas);
    console.log(
      rls[0].relrowsecurity && rls[0].politicas === 0
        ? "    ✓ RLS activo y sin políticas: el navegador no lee nada."
        : "    ! falta protección"
    );
  }

  console.log("");
  console.log("  ──────────────────────────────────────────────\n");

  /* Y la comprobación que de verdad importa: el token sirve. */
  if (!inst || !inst.length) {
    console.log("  No hay token guardado. El bot usa la clave global, que es\n" +
      "  el comportamiento de antes del cambio. Funciona, pero no aísla.\n");
  } else {
    console.log("  El bot usa este token para hablar con la caja. Que funcione se\n" +
      "  comprueba mandando un mensaje de verdad, no leyendo la base.\n");
  }
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});