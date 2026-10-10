const { execFileSync } = require("child_process");
const fs = require("fs");

/* Ejecuta PHP dentro del contenedor de Coolify.
 *
 * El código PHP va en base64 dentro del comando, porque el viaje es en
 * tres capas (SSH, bash y el intérprete de PHP) y las comillas, los
 * signos de dólar y los paréntesis no sobreviven escapados a mano: un
 * `->first()` se come el shell y el error que sale no menciona el código
 * que lo provocó.
 *
 * El código se lee de un FICHERO, no del argumento de la línea de
 * comandos, por lo mismo: el argumento también pasa por el shell de
 * Windows y por el de bash. Con un fichero no hay escapado en ningún
 * punto.
 *
 *   node db/coolify-php.js algo.php
 */

const ruta = process.argv[2];
if (!ruta || !fs.existsSync(ruta)) {
  console.error("  falta el fichero con el código PHP: " + (ruta || "(nada)"));
  process.exit(1);
}

/* Se quita la apertura de PHP: el código se evalúa, no se incluye, y
   dejarla haría que PHP buscase una salida antes de tiempo. El BOM
   también, que si no se cuela en el primer carácter y rompe todo. */
const php = fs
  .readFileSync(ruta, "utf8")
  .replace(/^﻿/, "")
  .replace(/<\?php\s*/i, "")
  .trim();

const b64 = Buffer.from(php, "utf8").toString("base64");

/* El contenedor ya tiene PHP y el vendor de Laravel dentro; solo hace
   falta arrancar el framework para que los modelos estén disponibles. */
const remoto = [
  "docker exec -i -e CODIGO=" + b64 + " coolify",
  "php -r",
  "'require \"/var/www/html/vendor/autoload.php\";",
  '$app = require "/var/www/html/bootstrap/app.php";',
  "$app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap();",
  'eval(base64_decode(getenv("CODIGO")));',
  "'",
].join(" ");

try {
  const salida = execFileSync(
    "ssh",
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=20", "coolify", remoto],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }
  );
  process.stdout.write(salida);
} catch (e) {
  if (e.stdout) process.stdout.write(e.stdout.toString());
  if (e.stderr) process.stderr.write(e.stderr.toString());
  process.exitCode = 1;
}