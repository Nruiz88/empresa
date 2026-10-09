require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

/* ¿Cómo está `evolution_servers` para que NO se pueda leer desde el
   navegador? Ese es el patrón a copiar, y hay que copiarlo exacto: si
   se copia "casi", se repite el fallo de la 027. */
(async () => {
  console.log("\n═══ Cómo se protege evolution_servers ═══\n");

  const { data: tabla } = await db.rpc("ejecutar_sql", {
    consulta:
      "select grantee, privilege_type from information_schema.table_privileges " +
      "where table_name = 'evolution_servers' order by grantee, privilege_type",
    args: [],
  });

  console.log("  ── permisos de tabla ──");
  if (!tabla || !tabla.length) {
    console.log("    NINGUNO. Nadie tiene permiso por tabla.");
  } else {
    tabla.forEach((r) => console.log("    " + r.grantee.padEnd(18) + r.privilege_type));
  }

  const { data: rls } = await db.rpc("ejecutar_sql", {
    consulta:
      "select relrowsecurity from pg_class where relname = 'evolution_servers'",
    args: [],
  });

  console.log("\n  ── RLS ──");
  console.log("    relrowsecurity: " + (rls && rls[0] ? rls[0].relrowsecurity : "no encontrada"));

  /* Y si los permisos vienen de un GRANT por defecto, de una ACL... */
  const { data: acl } = await db.rpc("ejecutar_sql", {
    consulta: "select relacl from pg_class where relname = 'evolution_servers'",
    args: [],
  });

  console.log("\n  ── ACL en bruto ──");
  console.log("    " + (acl && acl[0] && acl[0].relacl ? String(acl[0].relacl) : "(null: sin ACL, nadie tiene permiso)"));

  console.log("\n  ──────────────────────────────────────────────\n");

  const hayAlguien = (tabla || []).filter(
    (r) => r.grantee === "authenticated" || r.grantee === "anon"
  );

  if (!hayAlguien.length) {
    console.log("  El patrón es: NINGÚN permiso para anon ni authenticated.\n");
    console.log("  Solo llega el service key, que se salta todo. Por eso el test\n");
    console.log("  de aislamiento dice que el cliente A no lee los servidores.\n");
    console.log("\n  Eso es lo que hay que replicar para el token de la instancia:\n");
    console.log("    · tabla nueva;\n");
    console.log("    · sin RLS;\n");
    console.log("    · sin ningún GRANT a anon ni authenticated;\n");
    console.log("    · y `bots` se queda sin credenciales.\n");
  } else {
    console.log("  Ojo: SÍ hay permisos para el navegador en evolution_servers.");
    hayAlguien.forEach((r) => console.log("    " + r.grantee + " " + r.privilege_type));
    console.log("\n  La protección sería entonces el RLS, no los permisos.");
    console.log("  Habría que mirar cuál de las dos cosas es la que frena.\n");
  }
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});