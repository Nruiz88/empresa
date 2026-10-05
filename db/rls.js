/* Comprueba qué tablas tienen RLS activado y cuántas políticas tienen.
   Uso: node db/rls.js */
const env = require("../lib/env");
env.load();
const { Client } = require("pg");

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const tablas = await c.query(
    "select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename"
  );

  const politicas = await c.query(
    "select tablename, count(*)::int as n from pg_policies where schemaname = 'public' group by tablename"
  );
  const porTabla = new Map(politicas.rows.map((r) => [r.tablename, r.n]));

  console.log("\n  tabla                 RLS      políticas");
  console.log("  " + "-".repeat(44));

  let sinRls = [];
  for (const t of tablas.rows) {
    const n = porTabla.get(t.tablename) || 0;
    /* Lo único peligroso es RLS APAGADO: entonces da igual cuántas
       políticas haya, porque ninguna se aplica.

       RLS encendido con cero políticas es lo más cerrado que hay:
       ni el usuario autenticado entra, solo el servidor con la
       secret key (que va como service_role y se salta RLS). Eso es
       lo correcto para sessions y login_attempts. */
    const ok = t.rowsecurity;
    if (!ok) sinRls.push(t.tablename);
    console.log(
      "  " +
        t.tablename.padEnd(20) +
        (t.rowsecurity ? "si" : "NO ").padEnd(8) +
        String(n).padEnd(11) +
        (ok ? (n === 0 ? "(solo servidor)" : "") : "  <-- expuesta")
    );
  }

  await c.end();

  if (sinRls.length) {
    console.log("\n  Sin RLS: " + sinRls.join(", "));
    console.log("  Con RLS apagado, la tabla se puede leer y escribir desde");
    console.log("  fuera con la clave publicable, que va en el cliente.\n");
    process.exit(1);
  }
  console.log("\n  Todas las tablas tienen RLS activado.\n");
  process.exit(0);
})().catch((e) => {
  console.error("error: " + e.message);
  process.exit(1);
});
