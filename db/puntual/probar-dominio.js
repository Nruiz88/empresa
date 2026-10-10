/* Comprueba cómo queda la deducción de direcciones con las variables de
   producción, sin tocar el .env ni la base.

     node db/probar-dominio.js
*/

const RUTAS = [
  ["desarrollo", { SITE_URL: "http://127.0.0.1:3000" }],
  ["producción", { SITE_URL: "https://tucormercio.com.ar" }],
  ["producción, panel aparte", {
    SITE_URL: "https://tucormercio.com.ar",
    PANEL_URL: "https://panel.tucormercio.com.ar",
  }],
  ["producción, bot en otro sitio", {
    SITE_URL: "https://tucormercio.com.ar",
    BOT_URL: "https://bot.vercel.app",
  }],
  ["sin SITE_URL", {}],
];

/* Cada caso corre en un proceso aparte: `site.js` lee el entorno al ser
   cargado y guarda el resultado en `module.exports`, así que cargarlo dos
   veces con valores distintos en el mismo proceso no da lo que parece. */

const { execFileSync } = require("child_process");
const path = require("path");

const uno = `
  const s = require(${JSON.stringify(path.join(__dirname, "..", "..", "lib", "site.js"))});
  const b = require(${JSON.stringify(path.join(__dirname, "..", "lib", "bots.js"))});
  const linea = (k, v) => console.log("    " + String(k).padEnd(16) + v);
  linea("web", s.url);
  linea("panel", s.panelUrl);
  linea("dominio", s.dominio);
  linea("aviso desarrollo", s.dominioDeEjemplo ? "SI" : "no");
  linea("webhook deducido", b.urlDeWebhook() || "(ninguno)");
  linea("bot (portal)", s.urlDeServicio("bot", process.env.BOT_URL || "", 3200));
`;

let fallos = 0;

for (const [nombre, env] of RUTAS) {
  /* Se pasa solo lo que el caso necesita, y se vacían las variables que
     la máquina del que prueba pueda tener puestas: si no, el resultado
     depende de quién lo lance. */
  const limpio = { PATH: process.env.PATH, NODE_ENV: "production" };
  for (const [k, v] of Object.entries(env)) limpio[k] = v;

  console.log("\n── " + nombre + " ──");
  try {
    const salida = execFileSync(process.execPath, ["-e", uno], { env: limpio, encoding: "utf8" });
    console.log(salida.trim());
  } catch (e) {
    fallos++;
    console.log("    ✗ reventó: " + (e.stderr || e.message).split("\n")[0]);
  }
}

console.log(fallos ? "\n  " + fallos + " caso(s) fallan\n" : "\n  todo correcto\n");
process.exitCode = fallos ? 1 : 0;