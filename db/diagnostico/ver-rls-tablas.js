require("../../lib/env").load();

const db = require("../../lib/supabase").getAdmin();

/* ¿Qué protege de verdad a `evolution_servers`?
   Tiene permisos para anon y authenticated, y sin embargo el test de
   aislamiento dice que el cliente A no la lee. La protección tiene que
   ser el RLS, o no hay protección. */
(async () => {
  console.log("\n═══ Qué protege cada tabla ═══\n");

  const { data: rls } = await db.rpc("ejecutar_sql", {
    consulta:
      "select c.relname, c.relrowsecurity, " +
      "(select count(*)::int from pg_policies p where p.tablename = c.relname) as politicas " +
      "from pg_class c where c.relkind = 'r' and c.relname in ('evolution_servers','bots') " +
      "order by c.relname",
    args: [],
  });

  console.log("  tabla                 RLS    políticas");
  console.log("  ─────────────────────────────────────────────");

  for (const r of rls || []) {
    console.log(
      "  " + r.relname.padEnd(22) +
      String(r.relrowsecurity ? "sí" : "no").padEnd(7) +
      r.politicas
    );
  }

  console.log("");

  const servidores = (rls || []).find((r) => r.relname === "evolution_servers");
  const bots = (rls || []).find((r) => r.relname === "bots");

  console.log("  ──────────────────────────────────────────────\n");

  if (servidores && servidores.relrowsecurity && servidores.politicas === 0) {
    console.log("  `evolution_servers`: RLS activado y SIN políticas.\n");
    console.log("    Eso es lo que la frena. Con RLS activo y ninguna política que");
    console.log("    conceda nada, todas las filas quedan ocultas para anon y");
    console.log("    authenticated. Solo el service key las ve, porque se salta todo.\n");
    console.log("    ES EL PATRÓN A COPIAR. Y es más simple que revocar permisos:\n");
    console.log("    · no hay que acordarse de qué columnas hay;\n");
    console.log("    · añadir una columna nueva después no abre nada por accidente;\n");
    console.log("    · y no hay que volver a conceder permisos.\n");
  }

  if (bots) {
    console.log("  `bots`: RLS=" + (bots.relrowsecurity ? "sí" : "no") +
      ", políticas=" + bots.politicas);
    console.log("    Tiene políticas, así que un cliente autenticado SÍ lee su fila.");
    console.log("    Ahí es donde no puede vivir un token.\n");
  }

  console.log("  EL PLAN:");
  console.log("    1. tabla `evolution_instanzas`, con RLS y sin políticas;");
  console.log("    2. mover ahí el token desde `bots`;");
  console.log("    3. el webhook lee las dos tablas en una consulta;");
  console.log("    4. quitar `bots.instance_token`.\n");
  console.log("    Y la 027, que revokea la columna, se queda: no hacía falta, pero");
  console.log("    REVOKE sobre una columna de la que nadie tiene permiso tampoco");
  console.log("    molesta, y documenta que ahí no va una credencial.\n");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});