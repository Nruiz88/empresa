// Renderiza el og-image.svg a PNG para poder mirarlo.
//
// El SVG es XML valido aunque el logo no se haya interpolarado: se
// abre igual en cualquier visor y sale sin logo. Compilarlo y mirarlo
// es la unica forma de saber que la imagen buena.
//
// Usa el Playwright que ya esta en el proyecto. Se abre el archivo con
// file:// y no por el servidor, para que no dependa de que haya algo
// levantado en el puerto 3000.

// El Playwright no está en este proyecto: se usa el que hay instalado
// en el del bot (D:/webs/wweb), que es de donde lo toma tambien
// `db/probar-paleta.mjs`. Referenciarlo por la ruta de este proyecto
// da ERR_MODULE_NOT_FOUND, que es un fallo bastante poco informativo
// para lo que en realidad es "esta dependencia vive en otro sitio".
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("D:/webs/wweb/node_modules/playwright");

const svg = "D:/webs/empresa/public/assets/og-image.svg";
const salida = process.argv[2] || "C:/Users/chin0/AppData/Local/Temp/opencode/og.png";

const navegador = await chromium.launch();
try {
  const pagina = await navegador.newPage({ viewport: { width: 1200, height: 630 } });
  await pagina.goto(require("node:url").pathToFileURL(svg).href);
  // La fuente no se carga de la red: el SVG la nombra pero no la
  // incluye, y en un visor sin red sale la del sistema. Por eso el
  // texto se ve distinto en el PNG que en un navegador con Internet.
  await pagina.waitForTimeout(400);
  await pagina.screenshot({ path: salida });
  console.log("captura: " + salida);
} finally {
  await navegador.close();
}