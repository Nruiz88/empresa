const { chromium } = require("D:/webs/wweb/node_modules/playwright");

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });

  const visto = [];
  p.on("response", (r) => {
    const u = r.url().replace("http://127.0.0.1:3000", "");
    if (r.request().method() === "POST" || u.includes("servidor")) {
      visto.push(r.request().method() + " " + u + "  ->  " + r.status());
    }
  });
  p.on("pageerror", (e) => visto.push("ERROR DE PÁGINA: " + String(e.message).slice(0, 120)));
  p.on("console", (m) => {
    if (m.type() === "error") visto.push("CONSOLA: " + m.text().slice(0, 120));
  });

  await p.goto("http://127.0.0.1:3000/panel/login");
  await p.fill('input[name="email"]', process.env.TEST_EMAIL);
  await p.fill('input[name="password"]', process.env.TEST_PASSWORD);
  await p.click('button[type="submit"]');
  await p.waitForLoadState("domcontentloaded");

  await p.goto("http://127.0.0.1:3000/panel/servidores");
  await p.waitForLoadState("domcontentloaded");

  /* ── El formulario del botón Probar, tal como está en el HTML ── */
  const form = await p.evaluate(() => {
    const f = document.querySelector('form[action*="probar"]');
    if (!f) return { existe: false };
    const btn = f.querySelector("button");
    return {
      existe: true,
      accion: f.getAttribute("action"),
      metodo: f.getAttribute("method"),
      botonTexto: btn ? btn.textContent.trim() : null,
      botonDeshabilitado: btn ? btn.disabled : null,
      csrf: !!f.querySelector('input[name="_csrf"]'),
      csrfVacio: (f.querySelector('input[name="_csrf"]') || {}).value === "",
      /* Si el form está dentro de otro form, el navegador lo ignora y el
         botón no hace nada. Es un fallo silencioso clásico. */
      formAnidado: !!f.closest("form"),
      padre: f.parentElement ? f.parentElement.tagName + "." + f.parentElement.className : null,
    };
  });

  console.log("\n═══ El formulario de Probar ═══\n");
  for (const [k, v] of Object.entries(form)) console.log("  " + k.padEnd(18) + v);

  /* ── Pulsarlo de verdad ── */
  console.log("\n═══ Al pulsar ═══\n");
  visto.length = 0;

  const btn = await p.$('form[action*="probar"] button');
  if (!btn) {
    console.log("  no se encontró el botón");
  } else {
    const antes = p.url();
    await btn.click();
    await p.waitForTimeout(3000);
    const despues = p.url();

    console.log("  url antes:   " + antes.replace("http://127.0.0.1:3000", ""));
    console.log("  url después: " + despues.replace("http://127.0.0.1:3000", ""));
    console.log("  cambió:      " + (antes !== despues ? "sí" : "NO — la página no se movió"));

    const texto = await p.evaluate(() => {
      const a = document.querySelector(".panel-alert, .panel-msg, [role=alert], .panel-nota");
      return a ? a.innerText.replace(/\s+/g, " ").trim().slice(0, 160) : "(sin aviso en pantalla)";
    });
    console.log("  aviso:       " + texto);

    console.log("\n  peticiones:");
    for (const v of [...new Set(visto)]) console.log("    " + v);
    if (!visto.length) console.log("    ninguna: el clic no llegó a hacer nada");
  }

  await b.close();
})();