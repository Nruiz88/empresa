require("../lib/env").load();

const { createRequire } = require("module");
const req = createRequire("file:///D:/webs/empresa/db/capturar-panel.js");
const { chromium } = req("D:/webs/wweb/node_modules/playwright");

const BASE = process.env.TEST_PANEL || "http://127.0.0.1:3000";
const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;
const SALIDA = process.env.TEMP + "/opencode";

/* ─────────────────────────────────────────────────────────────
   FOTOS DEL PANEL, EN MÓVIL Y EN ESCRITORIO

   Las comprobaciones automáticas del panel dicen que el texto cabe.
   La persona que mira la pantalla dice que no. Cuando eso pasa, la
   comprobación está midiendo otra cosa —y el caso de la home fue
   exactamente eso: `.reveal` sin disparar, que no es maquetación pero
   se ve igual de roto.

   Así que se saca la foto y se mira, que es lo que funcionó.

   ── POR QUÉ MÓVIL Y ESCRITORIO ──

   Porque el fallo que se busca es distinto en cada uno: en escritorio
   suele ser una columna que aprieta, y en móvil es la celda apilada
   que se queda con la mitad del ancho.
   ───────────────────────────────────────────────────────────── */

const RUTAS = [
  "/panel",
  "/panel/clientes",
  "/panel/cobros",
  "/panel/aplicaciones/catalogo",
];

/* Se pueden pasar rutas por consola, para sacar solo una:
     node db/capturar-panel.js /panel /panel/cobros */
const pedidas = process.argv.slice(2).filter((a) => a.startsWith("/"));
const A_VER = pedidas.length ? pedidas : RUTAS;

(async () => {
  const navegador = await chromium.launch();
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 } });

  const login = await ctx.newPage();
  await login.goto(BASE + "/panel/login");
  await login.fill('input[name="email"]', EMAIL);
  await login.fill('input[name="password"]', PASSWORD);
  await login.click('button[type="submit"]');
  await login.waitForLoadState("domcontentloaded");

  console.log("\n═══ Fotos del panel ═══\n");

  for (const ruta of A_VER) {
    const nombre = "panel-" + ruta.replace(/\//g, "_").replace(/^_/, "");

    for (const v of [
      { sufijo: "escritorio", ancho: 1440, alto: 900 },
      { sufijo: "movil", ancho: 390, alto: 844 },
    ]) {
      const p = await ctx.newPage();
      await p.setViewportSize({ width: v.ancho, height: v.alto });

      try {
        await p.goto(BASE + ruta, { waitUntil: "domcontentloaded", timeout: 25000 });
        await p.waitForTimeout(500);

        /* Sin desplazarse y sin `fullPage`: la foto tiene que ser lo
           que se ve al ABRIR la página.

           Con `fullPage`, al coser la imagen los elementos `sticky` se
           vuelven a pintar en su sitio, y el resultado aparenta que la
           barra de arriba tapa el título. Es lo que pasó con
           «Clientes»: en la foto salía cortado, y midiendo el DOM en
           vivo el solapamiento era de cero.

           Y desplazarse antes esconde justo lo que se quiere mirar: el
           primer pantallazo, que es donde están los fallos de
           cabecera. */
        await p.waitForTimeout(200);

        const archivo = SALIDA + "/" + nombre + "-" + v.sufijo + ".png";
        await p.screenshot({ path: archivo });

        console.log("  " + (nombre + "-" + v.sufijo).padEnd(42) + " " + v.ancho + "x" + v.alto);
      } catch (e) {
        console.log("  " + (nombre + "-" + v.sufijo).padEnd(42) + " ERROR " + e.message.split("\n")[0]);
      }

      await p.close();
    }
  }

  await navegador.close();
  console.log("");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});
