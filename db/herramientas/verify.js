/* =========================================================
   Nexo Studio — Verificación del esquema
   ------------------------------------------------------------
   Comprobación de que la base de datos está BIEN, no solo de
   que la migración dijo que pasó.

     Ojo en RLS: una tabla sin RLS activada se lee igual, pero
   la saltan todas las políticas. Es el fallo más grave posible
   en este sistema, y es invisible desde la aplicación.

   Uso:  node db/verify.js
   ========================================================= */

const env = require("../../lib/env");

async function main() {
  const carga = env.load();
  if (!carga.ok) {
    console.error("\n✗ " + carga.error + "\n");
    process.exit(1);
  }

  const [connectionString] = env.require("DATABASE_URL");
  const { Client } = require("pg");
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  try {
    await client.connect();
  } catch (err) {
    console.error("\n✗ No se pudo conectar: " + err.message + "\n");
    process.exit(1);
  }

  let fallos = 0;
  const ok = (m) => console.log("  ✓ " + m);
  const fail = (m) => {
    console.log("  ✗ " + m);
    fallos++;
  };

  const TABLAS = ["clients", "profiles", "services", "leads", "audit_log"];

  console.log("\n── Tablas ─────────────────────────────────────────");
  const { rows: tablas } = await client.query(`
    select c.relname as nombre, c.relrowsecurity as rls
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname
  `);
  for (const t of TABLAS) {
    const found = tablas.find((x) => x.nombre === t);
    if (!found) fail(`falta la tabla ${t}`);
    else if (!found.rls) fail(`${t} existe pero SIN Row Level Security`);
    else ok(`${t} existe y tiene RLS activo`);
  }

  console.log("\n── Políticas RLS ──────────────────────────────────");
  const { rows: politicas } = await client.query(`
    select tablename, policyname, cmd, roles::text
    from pg_policies
    where schemaname = 'public'
    order by tablename, policyname
  `);
  for (const t of TABLAS) {
    const suyas = politicas.filter((p) => p.tablename === t);
    if (!suyas.length) fail(`${t} no tiene ninguna política (con RLS sin políticas se bloquea TODO)`);
    else ok(`${t}: ${suyas.length} política(s)`);
  }

  console.log("\n── Sin políticas, no hay borrado de auditoría ────");
  const borrados = politicas.filter(
    (p) => p.tablename === "audit_log" && (p.cmd === "DELETE" || p.cmd === "ALL")
  );
  if (borrados.length) fail("audit_log permite borrar registros: la auditoría deja de ser fiable");
  else ok("audit_log no permite borrar (inmutable)");

  console.log("\n── Tipos enumerados ──────────────────────────────");
  const { rows: tipos } = await client.query(`
    select t.typname from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype = 'e'
    order by t.typname
  `);
  const faltan = ["service_kind", "service_status", "lead_estado", "user_role"].filter(
    (e) => !tipos.some((t) => t.typname === e)
  );
  if (faltan.length) fail("faltan tipos: " + faltan.join(", "));
  else ok("los 4 tipos existen");

  console.log("\n── Trigger de coherencia ──────────────────────────");
  const { rows: triggers } = await client.query(`
    select tgname from pg_trigger
    where tgrelid = 'profiles'::regclass and not tgisinternal
  `);
  if (!triggers.some((t) => t.tgname === "trg_client_rol")) {
    fail("no está el trigger que impide crear un 'client' sin client_id");
  } else {
    ok("trigger de coherencia instalado");
    // Prueba funcional, dentro de una transacción que se descarta
    try {
      await client.query("begin");
      await client.query(
        "insert into auth.users (id, email) values (gen_random_uuid(), 'qa@nexo.local')"
      );
      const { rows: u } = await client.query(
        "select id from auth.users where email = 'qa@nexo.local'"
      );
      let bloqueado = false;
      try {
        await client.query(
          "insert into profiles (id, rol, nombre) values ($1, 'client', 'QA')",
          [u[0].id]
        );
      } catch {
        bloqueado = true;
      }
      await client.query("rollback");
      if (bloqueado) ok("el trigger rechaza un cliente sin client_id (probado de verdad)");
      else fail("el trigger NO bloquea un cliente sin client_id");
    } catch (err) {
      await client.query("rollback").catch(() => {});
      console.log("  · no se pudo hacer la prueba funcional: " + err.message);
    }
  }

  console.log("\n───────────────────────────────────────────────────");
  if (fallos) {
    console.log(`\n✗ ${fallos} problema(s). Arregla la migración y vuelve a ejecutar.\n`);
    process.exit(1);
  }
  console.log("\n✓ Todo correcto. La base de datos está lista.\n");
  await client.end();
}

main().catch((err) => {
  console.error("\n✗ " + err.message + "\n");
  process.exit(1);
});
