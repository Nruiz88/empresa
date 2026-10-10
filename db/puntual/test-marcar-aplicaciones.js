/* ¿Se pueden marcar aplicaciones de un plan desde el panel?
   ─────────────────────────────────────────────────────────────
   La pantalla de planes tenía un hueco: `plans.aplicaciones` no lo
   escribía nadie. Se podía hacer la migración y tener la columna, y
   seguir sin poder marcar una casilla.

   Esto lo comprueba de punta a punta, entrando al panel de verdad,
   marcando, guardando, y mirando si quedó.

   ── POR QUÉ NO BASTA MIRAR QUE LA PANTALLA CARGA ──

   Porque una pantalla puede pintar las casillas perfectamente y seguir
   sin guardar nada. Es el fallo más difícil de ver: la casilla se
   marca, el botón dice «Guardado», y al recargar volvió a su sitio. El
   clic se acepta y no pasa nada.

   ── EL ROL DE LAS CASILLAS OCULTAS ──

   Es el patrón que ya usan `destacado` y `activo`, y está por una
   razón concreta: una casilla sin marcar NO LLEGA en el cuerpo del
   POST. Sin un campo oculto con el mismo nombre y valor "0", no se
   podría desmarcar nunca —se volvería a marcar sola al abrir la
   pantalla—, y el código solo guarda lo que llega.

   Por eso esta prueba marca, desmarca y vuelve a marcar: si el
   desmarcar no funciona, se nota acá y no tres meses después.
   ───────────────────────────────────────────────────────────── */
require("../../lib/env").load();

const db = require("../../lib/supabase").getAdmin();

const BASE = process.env.TEST_PANEL || "http://127.0.0.1:3000";
const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

let cookie = "";

async function pedir(ruta, opciones = {}) {
  const r = await fetch(BASE + ruta, {
    redirect: "manual",
    ...opciones,
    headers: Object.assign(
      cookie ? { cookie } : {},
      opciones.body ? { "content-type": "application/x-www-form-urlencoded" } : {},
      opciones.headers || {}
    ),
    signal: AbortSignal.timeout(30000),
  });

  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");

  return r;
}

async function csrfDe(ruta) {
  const html = await (await pedir(ruta)).text();
  const m = html.match(/name=["']_csrf["']\s+value=["']([^"']+)["']/i);
  if (!m) throw new Error("no se encontró el csrf en " + ruta);
  return m[1];
}

/** Lo que hay guardado ahora, leído de la base y no de la pantalla. */
async function estadoEnBase() {
  const { data } = await db.rpc("ejecutar_sql", {
    consulta: "select id, nombre, aplicaciones from plans order by orden",
    args: [],
  });
  return data || [];
}

(async () => {
  if (!EMAIL || !PASSWORD) {
    console.log("\n  Faltan TEST_EMAIL y TEST_PASSWORD.\n");
    process.exit(1);
  }

  console.log("\n═══ Marcar aplicaciones desde el panel ═══\n");

  /* ---- 1. Entrar ---- */
  const login = await pedir("/panel/login", {
    method: "POST",
    body: new URLSearchParams({
      _csrf: await csrfDe("/panel/login"),
      email: EMAIL,
      password: PASSWORD,
    }).toString(),
  });

  if (login.status >= 400) {
    console.log("  x el login devolvió HTTP " + login.status + "\n");
    process.exit(1);
  }
  console.log("  1. login                                  HTTP " + login.status + "  ✓");

  /* ---- 2. Lo que hay ---- */
  const { data: micros } = await db.rpc("ejecutar_sql", {
    consulta: "select modulo, nombre, activo from microservicios order by nombre",
    args: [],
  });

  console.log("\n  2. microservicios disponibles:");
  (micros || []).forEach((m) => {
    console.log("     " + m.modulo.padEnd(18) + m.nombre + (m.activo ? "" : "   (inactivo)"));
  });

  if (!micros || micros.length < 1) {
    console.log("\n  x no hay microservicios. Sin ellos no hay casillas que marcar.\n");
    process.exit(1);
  }

  const antes = await estadoEnBase();
  console.log("\n  3. lo que hay guardado ahora:");
  antes.forEach((p) => {
    const a = p.aplicaciones || [];
    console.log("     " + p.id.padEnd(10) + (a.length ? a.join(", ") : "(ninguna aplicación)"));
  });

  /* ---- 3. Comprobar que la pantalla pinta las casillas ---- */
  const pantalla = await (await pedir("/panel/planes")).text();

  const conCasillas = micros.filter((m) =>
    pantalla.includes('value="' + m.modulo + '"')
  ).length;

  console.log("\n  4. las casillas en la pantalla:");
  console.log("     microservicios con casilla: " + conCasillas + " de " + micros.length);

  if (conCasillas === 0) {
    console.log("\n  × no se pinta ninguna casilla. La pantalla carga pero no deja marcar.\n");
    process.exit(1);
  }
  console.log("     ✓ se pueden marcar");

  /* ---- 4. Marcar uno y guardar ---- */
  const plan = antes[0];
  const aMarcar = (micros.find((m) => m.activo) || micros[0]).modulo;

  console.log("\n  5. marco «" + aMarcar + "» en el plan «" + plan.id + "» y guardo");

  const csrf = await csrfDe("/panel/planes");
  const cuerpo = new URLSearchParams({ _csrf: csrf });
  cuerpo.append("aplicaciones_" + plan.id, aMarcar);

  const guardado = await pedir("/panel/planes", {
    method: "POST",
    body: cuerpo.toString(),
  });
  const html = await guardado.text();

  const aviso = (html.match(/Guardado:[^<]*/) || [])[0] || "";
  console.log("     HTTP " + guardado.status + (aviso.trim() ? "  \"" + aviso.trim() + "\"" : ""));

  const despues = await estadoEnBase();
  const guardadoAhora = despues.find((p) => p.id === plan.id);

  console.log("\n  6. en la base, ahora:");
  despues.forEach((p) => {
    const a = p.aplicaciones || [];
    console.log("     " + p.id.padEnd(10) + (a.length ? a.join(", ") : "(ninguna)"));
  });

  console.log("");

  const tiene = (guardadoAhora.aplicaciones || []).includes(aMarcar);

  if (!tiene) {
    console.log("  × NO SE GUARDÓ. La casilla se marca, el panel dice que guardó,\n");
    console.log("    y no queda nada. Ese es el fallo más difícil de ver.\n");
    process.exit(1);
  }

  console.log("  ✓ se guardó y se puede leer de la base");

  /* ---- 5. Desmarcar, que es donde fallan los campos ocultos ---- */
  console.log("\n  7. ahora lo desmarco y guardo, para ver si el vaciado funciona\n");

  const csrf2 = await csrfDe("/panel/planes");
  const vacio = new URLSearchParams({ _csrf: csrf2 });

  /* Solo el campo oculto con "", sin ninguna casilla marcada. */
  vacio.append("aplicaciones_" + plan.id, "");

  await pedir("/panel/planes", { method: "POST", body: vacio.toString() });

  const alFinal = await estadoEnBase();
  const queda = (alFinal.find((p) => p.id === plan.id).aplicaciones || []).length;

  if (queda === 0) {
    console.log("  ✓ se desmarca. Un plan puede volver a no dar acceso a nada");
  } else {
    console.log("  × NO SE DESMARCA: quedan " + queda + ". Una casilla desmarcada");
    console.log("    no llega en el POST y el campo oculto no está haciendo su trabajo.");
    console.log("    Así no se puede quitar una aplicación de un plan.\n");
    process.exit(1);
  }

  /* ---- 6. Dejar como estaba ---- */
  console.log("");
  if ((plan.aplicaciones || []).length) {
    const csrf3 = await csrfDe("/panel/planes");
    const restauro = new URLSearchParams({ _csrf: csrf3 });
    (plan.aplicaciones || []).forEach((a) => restauro.append("aplicaciones_" + plan.id, a));
    await pedir("/panel/planes", { method: "POST", body: restauro.toString() });
    console.log("  se restauró el plan a como estaba: " + (plan.aplicaciones || []).join(", "));
  } else {
    console.log("  el plan quedó sin aplicaciones, como estaba.");
  }

  console.log("");
  console.log("  ✓ marcar, desmarcar y guardar funcionan\n");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});