const { execFileSync } = require("child_process");

/* Consulta a la base de Coolify por SSH.
 *
 * El SQL va en base64 porque pasa por tres capas de comillas (PowerShell,
 * ssh y el heredoc del contenedor) y escapado a mano siempre acaba
 * fallando en algún sitio. En base64 no hay nada que escapar.
 *
 *   node db/coolify-sql.js "select 1"
 */

const sql = process.argv[2];
if (!sql) {
  console.error("  falta la consulta");
  process.exit(1);
}

const b64 = Buffer.from(sql, "utf8").toString("base64");

const guion = `
echo '${b64}' | base64 -d | docker exec -i coolify-db psql -U coolify -d coolify -At -F' | ' -f -
`;

try {
  /* El comando remoto va como UN argumento de ssh, y no por un shell de
     Windows: con execFileSync y un array de argumentos no hay escapado que
     hacer, así que el SQL no vuelve a pasar por un parser de comillas. */
  const salida = execFileSync(
    "ssh",
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "coolify", guion.trim()],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }
  );
  process.stdout.write(salida);
} catch (e) {
  const err = e.stderr ? e.stderr.toString() : String(e.message);
  process.stderr.write(err);
  process.exitCode = 1;
}