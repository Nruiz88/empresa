require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

/* ¿El REVOKE a nivel de columna surtió efecto?

   En Postgres, cuando hay un GRANT de tabla completo, el permiso de
   columna no se puede reducir: los dos se conceden y el de tabla manda.
   Por eso el REVOKE de la 027 parece correcto y no hace nada.

   Esto mira los permisos reales, no lo que dice la migración. */
(async () => {
  console.log("\n═══ ¿A quién puede leer el token? ═══\n");

  const { data: col, error: eCol } = await db.rpc("ejecutar_sql", {
    consulta:
      "select grantee, privilege_type from information_schema.column_privileges " +
      "where table_name = 'bots' and column_name = 'instance_token'",
    args: [],
  });

  if (eCol) {
    console.log("  x no se pudieron leer los permisos de columna: " + eCol.message + "\n");
  } else {
    console.log("  ── permiso de COLUMNA sobre instance_token ──");
    (col || []).forEach((r) => console.log("    " + r.grantee + "  " + r.privilege_type));
    if (!(col || []).length) console.log("    (ninguno)");
  }

  const { data: tabla, error: eTabla } = await db.rpc("ejecutar_sql", {
    consulta:
      "select grantee, privilege_type from information_schema.table_privileges " +
      "where table_name = 'bots' order by grantee",
    args: [],
  });

  console.log("\n  ── permiso de TABLA sobre bots ──");
  if (eTabla) {
    console.log("    x " + eTabla.message);
  } else {
    (tabla || []).forEach((r) => console.log("    " + r.grantee + "  " + r.privilege_type));
    if (!(tabla || []).length) console.log("    (ninguno)");
  }

  /* Y el de evolution_servers, que es el patrón que sí funciona. */
  const { data: srv } = await db.rpc("ejecutar_sql", {
    consulta:
      "select grantee, privilege_type from information_schema.table_privileges " +
      "where table_name = 'evolution_servers' order by grantee",
    args: [],
  });

  console.log("\n  ── permiso de TABLA sobre evolution_servers ──");
  console.log("    (el patrón que ya funciona: nadie del navegador lo lee)");
  (srv || []).forEach((r) => console.log("    " + r.grantee + "  " + r.privilege_type));
  if (!(srv || []).length) console.log("    (ninguno: ni service ni nadie. Se llega con service)");

  console.log("\n  ──────────────────────────────────────────────\n");

  const conTabla = (tabla || []).some(
    (r) => r.grantee === "authenticated" && r.privilege_type === "SELECT"
  );

  if (conTabla) {
    console.log("  `authenticated` tiene SELECT de tabla sobre `bots`.\n");
    console.log("    Eso hace que el REVOKE de columna sea inútil: en Postgres, un\n");
    console.log("    permiso de tabla completo concede TODAS las columnas, y quitar\n");
    console.log("    una por columnas no lo reduce. Hay que quitar el de tabla y\n");
    console.log("    devolver las columnas una por una, que es frágil.\n");
    console.log("    EL ARREGLO QUE FUNCIONA es el que ya usa el proyecto con la\n");
    console.log("    clave del servidor: una tabla SIN RLS y a la que el navegador\n");
    console.log("    no tiene permiso. `evolution_servers` funciona así.\n");
    console.log("    El token de la instancia va a una tabla igual, y `bots` deja de\n");
    console.log("    llevar credenciales. Es lo que hay que hacer.\n");
  } else {
    console.log("  ✓ `authenticated` NO tiene SELECT de tabla sobre `bots`.");
    console.log("    Entonces el REVOKE de columna sí manda y el token está a salvo.\n");
  }
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});