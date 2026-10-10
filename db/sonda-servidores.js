const { chromium } = require("D:/webs/wweb/node_modules/playwright");

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });

  const errores = [];
  p.on("console", (m) => {
    if (m.type() === "error") errores.push("consola: " + m.text().slice(0, 100));
  });
  p.on("pageerror", (e) => errores.push("página: " + String(e.message).slice(0, 100)));
  p.on("response", (r) => {
    if (r.status() >= 400) errores.push(r.status() + " en " + r.url().replace("http://127.0.0.1:3000", ""));
  });

  await p.goto("http://127.0.0.1:3000/panel/login");
  await p.fill('input[name="email"]', process.env.TEST_EMAIL);
  await p.fill('input[name="password"]', process.env.TEST_PASSWORD);
  await p.click('button[type="submit"]');
  await p.waitForLoadState("domcontentloaded");

  for (const ruta of ["/panel/servidores", "/panel/bots"]) {
    errores.length = 0;

    const r = await p.goto("http://127.0.0.1:3000" + ruta);
    await p.waitForLoadState("domcontentloaded");
    await p.waitForTimeout(400);

    const d = await p.evaluate(() => {
      const main = document.querySelector(".panel-main") || document.body;
      const texto = main.innerText.replace(/\s+/g, " ").trim();
      return {
        h1: (document.querySelector("h1") || {}).innerText || "(sin h1)",
        largo: texto.length,
        texto: texto.slice(0, 300),
        filas: document.querySelectorAll("tbody tr").length,
        tarjetas: document.querySelectorAll(".panel-tarjeta, .panel-stat, .panel-card").length,
        vacio: !!document.querySelector(".panel-empty"),
      };
    });

    console.log("\n═══ " + ruta + "  HTTP " + r.status() + " ═══\n");
    console.log("  h1:        " + d.h1);
    console.log("  filas:     " + d.filas);
    console.log("  tarjetas:  " + d.tarjetas);
    console.log("  estado vacío: " + (d.vacio ? "sí" : "no"));
    console.log("  texto:     " + d.texto);
    if (errores.length) {
      console.log("\n  ── avisos ──");
      for (const e of [...new Set(errores)]) console.log("    " + e);
    }
  }

  await b.close();
})();