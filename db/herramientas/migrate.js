/* =========================================================
   Nexo Studio — Ejecutor de migraciones
   ------------------------------------------------------------
   Para que no tengas que pegar SQL a mano cada vez.

   Uso:
     node db/migrate.js            aplica lo que falte
     node db/migrate.js --estado   solo muestra qué se ha aplicado
     node db/migrate.js --reset    BORRA la tabla de control
                                    (NO borra datos, solo el registro)

   OJO con --reset: borra el REGISTRO, no el esquema. Las tablas se
   quedan donde están y la siguiente pasada las vuelve a encontrar,
   así que no las toca. Para rehacer la base desde cero de verdad hay
   que borrar el esquema a mano. Aun así, aplicar las migraciones
   sobre un esquema que ya existe funciona: son idempotentes, y
   db/test-idempotencia.js lo comprueba en un schema aparte.

   Cómo funciona:
     - Guarda en schema_migrations qué ficheros se aplicaron
     - Cada migración corre dentro de una transacción: si falla a
       medias, no queda nada a medias
     - Los ficheros se aplican en orden alfabético
     - Reintentar es seguro: solo aplica lo pendiente

   ⚠️  Nunca imprime la contraseña ni la cadena de conexión.
   ========================================================= */

const fs = require("fs");
const path = require("path");
const env = require("../../lib/env");

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

function log(msg) {
  console.log(msg);
}

/** Extrae host y nombre de la base sin mostrar la contraseña */
function safeTarget(connectionString) {
  try {
    const url = new URL(connectionString);
    return `${url.hostname}:${url.port || 5432}/${url.pathname.replace(/^\//, "")}`;
  } catch {
    return "(no se pudo leer)";
  }
}

async function main() {
  const args = process.argv.slice(2);
  const soloEstado = args.includes("--estado");
  const reset = args.includes("--reset");

  const carga = env.load();
  if (!carga.ok) {
    console.error("\n✗ " + carga.error + "\n");
    process.exit(1);
  }

  let connectionString;
  try {
    [connectionString] = env.require("DATABASE_URL");
  } catch (err) {
    console.error("\n✗ " + err.message + "\n");
    process.exit(1);
  }

  // pg solo se carga cuando hay credenciales: sin .env, este comando
  // falla con un mensaje claro en vez de con un error de módulo.
  const { Client } = require("pg");
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  log("\nConectando a " + safeTarget(connectionString) + " ...");
  try {
    await client.connect();
  } catch (err) {
    console.error("\n✗ No se pudo conectar.\n");
    console.error("  " + err.message + "\n");
    console.error("  Causas frecuentes:");
    console.error("   · La contraseña de la base de datos está mal.");
    console.error("   · Usas la conexión directa (IPv6) en vez del pooler.");
    console.error("     -> Connection string > Deployment type: Session pooler");
    console.error("   · El proyecto de Supabase está pausado (plan Free).");
    console.error("   · La whitelist de IP no incluye tu red.\n");
    process.exit(1);
  }

  log("✓ Conectado");

  // --- Tabla de control ---
  await client.query(`
    create table if not exists schema_migrations (
      nombre     text primary key,
      aplicada_en timestamptz not null default now()
    )
  `);

  if (reset) {
    await client.query("drop table if exists schema_migrations");
    log("✓ Tabla de control borrada (los datos siguen intactos)");
    await client.end();
    return;
  }

  // --- Qué hay aplicado ---
  const { rows: aplicadas } = await client.query(
    "select nombre from schema_migrations order by nombre"
  );
  const yaAplicadas = new Set(aplicadas.map((r) => r.nombre));

  const ficheros = fs.existsSync(MIGRATIONS_DIR)
    ? fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".sql"))
        .sort()
    : [];

  const pendientes = ficheros.filter((f) => !yaAplicadas.has(f));

  log("");
  log(`Migraciones en disco:  ${ficheros.length}`);
  log(`Ya aplicadas:          ${yaAplicadas.size}`);
  log(`Pendientes:            ${pendientes.length}`);
  log("");

  if (soloEstado) {
    for (const f of ficheros) {
      log(`  ${yaAplicadas.has(f) ? "✓ aplicada " : "· pendiente"}  ${f}`);
    }
    log("");
    await client.end();
    return;
  }

  if (!pendientes.length) {
    log("✓ Nada que hacer. La base de datos está al día.\n");
    await client.end();
    return;
  }

  // --- Aplicar ---
  for (const fichero of pendientes) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, fichero), "utf8");
    log(`→ Aplicando ${fichero} ...`);
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (nombre) values ($1)", [fichero]);
      await client.query("commit");
      log("  ✓ aplicada");
    } catch (err) {
      await client.query("rollback");
      console.error(`\n✗ Falló ${fichero}\n`);
      console.error(`  ${err.message}\n`);
      console.error("  Se ha hecho rollback: no quedó nada a medias.\n");
      await client.end();
      process.exit(1);
    }
  }

  log("");
  log(`✓ ${pendientes.length} migración(es) aplicada(s).`);
  log("");

  // --- Comprobación de tablas ---
  const { rows: tablas } = await client.query(`
    select table_name from information_schema.tables
    where table_schema = 'public' order by table_name
  `);
  log("Tablas en public:");
  for (const t of tablas) log("  · " + t.table_name);
  log("");

  await client.end();
}

main().catch((err) => {
  console.error("\n✗ Error inesperado:\n");
  console.error(err);
  process.exit(1);
});
