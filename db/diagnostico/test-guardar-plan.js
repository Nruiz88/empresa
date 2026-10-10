const { chromium } = require("D:/webs/wweb/node_modules/playwright");

/* Cambia un plan, guarda, y comprueba que el valor llegó a la base.
   El rediseño no debe poder romper el guardado: si los `name`
   cambian, la pantalla sigue viéndose perfecta y no se guarda
   nada, sin ningún error. */

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });

  await p.goto("http://127.0.0.1:3000/panel/login");
  await p.fill('input[name="email"]', process.env.TEST_EMAIL);
  await p.fill('input[name="password"]', process.env.TEST_PASSWORD);
  await p.click('button[type="submit"]');
  await p.waitForLoadState("domcontentloaded");

  await p.goto("http://127.0.0.1:3000/panel/planes");
  await p.waitForLoadState("domcontentloaded");

  const antes = await p.evaluate(() => {
    const el = document.querySelector(".plan-nombre");
    return el ? el.value : null;
  });

  const marca = "-prueba-" + Date.now();
  const nuevo = antes + marca;

  await p.fill(".plan-nombre", nuevo);
  await p.click('button[form="form-planes"]');
  await p.waitForLoadState("domcontentloaded");

  const despues = await p.evaluate(() => ({
    nombre: (document.querySelector(".plan-nombre") || {}).value,
    aviso: (document.querySelector(".panel-alert") || {}).innerText,
    /* Cuántos campos tiene el formulario: si el rediseño hubiera
       perdido alguno, el guardado dejaría de funcionar en silencio. */
    campos: document.querySelectorAll("#form-planes [name]").length,
    tarjetas: document.querySelectorAll(".plan").length,
  }));

  console.log("\n═══ Guardar un plan ═══\n");
  console.log("  antes:      " + antes);
  console.log("  enviado:    " + nuevo);
  console.log("  guardado:   " + despues.nombre);
  console.log("  coincide:   " + (despues.nombre === nuevo ? "sí" : "NO — no se guardó"));
  console.log("  aviso:      " + (despues.aviso || "(ninguno)").trim());
  console.log("  campos:     " + despues.campos);
  console.log("  tarjetas:   " + despues.tarjetas);

  /* Volver a dejarlo como estaba */
  await p.fill(".plan-nombre", antes);
  await p.click('button[form="form-planes"]');
  await p.waitForLoadState("domcontentloaded");

  const restaurado = await p.evaluate(
    () => (document.querySelector(".plan-nombre") || {}).value
  );
  console.log("\n  restaurado: " + restaurado);
  console.log("  bien:       " + (restaurado === antes ? "sí" : "NO"));

  await b.close();
})();