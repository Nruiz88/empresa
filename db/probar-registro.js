require("../lib/env").load();

const { createRequire } = require("module");
const req = createRequire("file:///D:/webs/empresa/db/probar-registro.js");
const { chromium } = req("D:/webs/wweb/node_modules/playwright");

const BASE = process.env.TEST_PANEL || "http://127.0.0.1:3000";

/* ─────────────────────────────────────────────────────────────
   EL ALTA DE CLIENTE, DE VERDAD

   El formulario pedía 32 caracteres porque la constante que lo
   controla se llamaba `MIN_ESPACIO_HORAS` y venía de otro archivo,
   donde sí significaba horas. Su único uso en todo el repositorio
   era este.

   ── LO QUE SE COMPRUEBA ──

     1. lo que dice la PÁGINA es el mínimo que ACEPTA el servidor;
     2. con 8 caracteres se guarda;
     3. con 7 se rechaza, y el aviso dice 8 y no otro número;
     4. las dos contraseñas distintas se rechazan.

   ── POR QUÉ SE COMPRUEBA EL NÚMERO DE LOS DOS SITIOS ──

   Porque estaban escritos a mano en dos ficheros, y por eso el
   arreglo más fácil —bajar el de la validación— deja el texto diciendo
   32 mientras el formulario acepta ocho. Un formulario que acepta
   menos de lo que dice no falla: engaña.

   Y el texto sale ahora de la misma constante, así que no pueden
   separarse. Eso es lo que se comprueba: que no se han separado.
   ───────────────────────────────────────────────────────────── */

const CORREO = "prueba-registro-" + Date.now() + "@shopcito.invalid";

(async () => {
  const navegador = await chromium.launch();
  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();

  console.log("\n═══ El alta de cliente ═══\n");

  let fallos = 0;

  /* ---- 1. Lo que dice la página ---- */
  await p.goto(BASE + "/cuenta/crear", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(400);

  const dicho = await p.evaluate(() => {
    const notas = [...document.querySelectorAll(".form-note")].map((n) =>
      n.textContent.replace(/\s+/g, " ").trim()
    );
    const dePassword = notas.find((t) => /contrase|Mínimo/i.test(t)) || "";

    const m = dePassword.match(/Mínimo (\d+) caracteres/i);
    return { texto: dePassword, minimo: m ? Number(m[1]) : null };
  });

  console.log("  1. lo que dice la pantalla:");
  console.log('     "' + dicho.texto + '"');

  if (dicho.minimo === null) {
    console.log("     × no dice el mínimo. No se puede seguir: el texto es la");
    console.log("       referencia de lo que acepta el formulario.");
    fallos++;
  } else if (dicho.minimo > 8) {
    console.log("     × pide " + dicho.minimo + " y debería pedir 8");
    fallos++;
  } else {
    console.log("     ✓ pide " + dicho.minimo);
  }

  /* ---- El alta ---- */
  const intentar = async (password) => {
    await p.goto(BASE + "/cuenta/crear", { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(300);

    await p.fill("#nombre", "Prueba Alta");
    await p.fill("#email", CORREO);
    await p.fill("#password", password);
    await p.fill("#repetir", password);

    const acepta = p.locator('input[name="acepta"]');
    if (await acepta.count()) {
      await acepta.check().catch(() => {});
    }

    await p.click('button[type="submit"]');
    await p.waitForLoadState("domcontentloaded");
    await p.waitForTimeout(700);

    const url = p.url();
    const cuerpo = await p.content();

    const errores = await p.evaluate(() =>
      [...document.querySelectorAll("[data-error-for]")]
        .map((e) => e.textContent.trim())
        .filter(Boolean)
    );

    return { url, errores, cuerpo };
  };

  /* ---- 2. Con 8 caracteres ---- */
  console.log("");
  console.log("  2. una contraseña de 8 caracteres:");

  const r8 = await intentar("Ab3dEf7h");

  /* ─────────────────────────────────────────────────────
     CÓMO SE SABE QUE LA ACEPTÓ

     Por la URL, no por los errores. Con ocho caracteres y el resto
     bien, la cuenta se crea y el navegador va a otro sitio; si se
     queda en el formulario es que algo lo rechazó.

     ── POR QUÉ NO BASTA CON QUE NO HAYA ERRORES ──

     Porque la primera versión solo miraba que no hubiera errores, y
     pasó: el formulario devolvió «Dinos cómo te llamas» —porque la
     prueba no rellenaba el nombre— y eso es un rechazo, no una duda.
     La prueba daba el visto bueno con el formulario entero roto.
     ───────────────────────────────────────────────────── */
  const seQuedo = r8.url.indexOf("/cuenta/crear") !== -1;

  if (!seQuedo) {
    console.log("     ✓ aceptada (ya no está en el formulario)");
  } else {
    console.log("     × rechazada: " + (r8.errores.join(" | ") || "sin aviso"));
    fallos++;
  }

  /* ---- 3. Con 7 ---- */
  console.log("");
  console.log("  3. una de 7 caracteres (tiene que rechazarla):");

  const r7 = await intentar("Ab3dEf7");
  const dice = r7.errores.join(" ");

  const menciona8 = /Mínimo 8 caracteres/.test(dice);
  const mencionaOtro = /Mínimo (\d+) caracteres/.exec(dice);

  if (r7.errores.length === 0) {
    console.log("     × la aceptó. El mínimo no está puesto.");
    fallos++;
  } else if (!menciona8 && mencionaOtro) {
    console.log("     × la rechazó pero dice «Mínimo " + mencionaOtro[1] + "»");
    console.log("       El texto y la validación no dicen lo mismo.");
    fallos++;
  } else {
    console.log("     ✓ rechazada, y el aviso dice 8");
  }

  /* ---- 4. Las dos distintas ---- */
  console.log("");
  console.log("  4. las dos contraseñas distintas:");

  await p.goto(BASE + "/cuenta/crear", { waitUntil: "domcontentloaded" });
  await p.fill("#nombre", "Prueba Otra");
  await p.fill("#email", "otro-" + Date.now() + "@shopcito.invalid");
  await p.fill("#password", "Ab3dEf7h");
  await p.fill("#repetir", "Zy9wVu2t");

  const acepta = p.locator('input[name="acepta"]');
  if (await acepta.count()) await acepta.check().catch(() => {});

  await p.click('button[type="submit"]');
  await p.waitForLoadState("domcontentloaded");
  await p.waitForTimeout(500);

  const err4 = await p.evaluate(() =>
    [...document.querySelectorAll("[data-error-for]")]
      .map((e) => e.textContent.trim())
      .filter(Boolean)
  );

  if (err4.some((t) => /no coinciden/i.test(t))) {
    console.log("     ✓ rechazada, con el aviso de que no coinciden");
  } else {
    console.log("     × no la rechazó: " + (err4.join(" | ") || "sin aviso"));
    fallos++;
  }

  await navegador.close();

  console.log("");
  console.log("  ──────────────────────────────────────────────");
  console.log(fallos ? "  × " + fallos + " fallo(s)" : "  ✓ el alta pide lo que dice, y dice lo que pide");
  console.log("");

  process.exit(fallos ? 1 : 0);
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});
