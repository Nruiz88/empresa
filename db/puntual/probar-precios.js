/* ¿Los precios que se guardan en el panel salen en la web?
   ─────────────────────────────────────────────────────────────
   POR QUÉ ESTA PRUEBA EXISTE

   Hay tres piezas sueltas y ninguna se basta sola:

     1. `lib/planes.js`     lee la tabla y la normaliza
     2. `routes/panel-planes.js`  guarda lo que se escribe
     3. `views/index.ejs` / `views/precios.ejs`  lo pintan

   Cada una puede estar bien y el conjunto no: hace falta guardar por
   HTTP como un navegador, y después pedir las páginas públicas y mirar
   si sale la cifra.

   ── LO QUE YA FALLÓ ANTES ──

   La primera versión de los planes leía `p.cta.href`, que la tabla no
   traía. El resultado fue un 500 en las cinco rutas con planes, y
   ninguna prueba de las que había Servía: todas miraban la base, donde
   todo estaba perfectamente.

   Eso es lo que se comprueba aquí: la web pública, no la base.

   ── CÓMO SE HACE ──

   Se entra de verdad al panel: login, CSRF, cookie de sesión. Luego se
   guarda el precio de un plan, se piden las páginas, y al final se
   devuelve el plan a como estaba.

   Un script que deja precios de prueba en la tabla es peor que uno que
   no prueba: el primer error lo paga un visitante. Por eso al final
   siempre se restaura, aunque la comprobación falle. */

require("../../lib/env").load();

const BASE = process.env.TEST_PANEL || "http://127.0.0.1:3000";

const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

/** El precio de mentira que se guarda. Alto y redondo a propósito:
    un número raro no aparecería igual en el HTML y la comprobación
    dependería de cómo se formatea. */
const PRECIO_DE_PRUEBA = "24500";

const PLAN = "inicial";

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

/** El csrf del formulario de la pantalla. Sin él el POST se rechaza,
   y rightly: es lo que impide que una página cualquiera le pida
   guardar cambios al panel de alguien queHa iniciado sesión. */
async function csrfDe(ruta) {
  const html = await (await pedir(ruta)).text();
  const m = html.match(/name=["']_csrf["']\s+value=["']([^"']+)["']/i);
  if (!m) throw new Error("no se encontró el csrf en " + ruta);
  return m[1];
}

(async () => {
  if (!EMAIL || !PASSWORD) {
    console.log("\n  Falta TEST_EMAIL o TEST_PASSWORD.\n");
    process.exit(1);
  }

  console.log("\n═══ El precio, de punta a punta ═══\n");
  console.log("  panel:  " + BASE);
  console.log("  plan:   " + PLAN + "\n");

  /* ---- 1. Entrar ---- */
  const csrfLogin = await csrfDe("/panel/login");

  const login = await pedir("/panel/login", {
    method: "POST",
    body: new URLSearchParams({
      _csrf: csrfLogin,
      email: EMAIL,
      password: PASSWORD,
    }).toString(),
  });

  /* Un 302 tras el login es lo NORMAL: el panel manda a /panel cuando
     las credenciales son buenas. Contarlo como fallo daría por roto un
     login que acaba de funcionar.

     Lo que sí indica fallo es un 4xx (credenciales malas) o un 5xx. Y un
     302 que no va a /panel: sería el "vuelve a entrar" del logout, que
     significa que la sesión no se abrió. */
  const destino = login.headers.get("location") || "";

  if (login.status >= 400 || (login.status >= 300 && !destino.startsWith("/panel"))) {
    console.log("  x el login devolvió HTTP " + login.status +
      (destino ? " hacia " + destino : ""));
    process.exit(1);
  }
  console.log("  1. login                        HTTP " + login.status + "  ✓");

  /* ---- 2. Abrir la pantalla y ver qué hay ahora ---- */
  const pantalla = await (await pedir("/panel/planes")).text();
  if (!pantalla.includes("name=\"precio_" + PLAN + "\"")) {
    console.log("  x la pantalla no tiene el campo del precio");
    process.exit(1);
  }

  const antes = (pantalla.match(
    new RegExp('name="precio_' + PLAN + '"[^>]*value="([^"]*)"')
  ) || [, ""])[1];
  console.log("  2. precio ahora                 \"" + (antes || "vacío") + "\"");

  /* ---- 3. Guardar un precio de prueba ---- */
  const csrfPlanes = await csrfDe("/panel/planes");

  const guardado = await pedir("/panel/planes", {
    method: "POST",
    body: new URLSearchParams({
      _csrf: csrfPlanes,
      ["precio_" + PLAN]: PRECIO_DE_PRUEBA,
      ["moneda_" + PLAN]: "ARS",
      ["periodo_" + PLAN]: "mes",
    }).toString(),
  });

  const htmlGuardado = await guardado.text();

  /* Se busca el aviso de éxito del propio panel, no un HTTP 200: la
     pantalla devuelve 200 también cuando dice que no se guardó nada,
     que es justo el caso que un comprobador de status no pilla. */
  const aviso = (htmlGuardado.match(/Guardado:[^<]*/) || [])[0] || "";
  console.log("  3. guardado desde el panel       HTTP " + guardado.status +
    (aviso ? "  \"" + aviso.trim() + "\"" : ""));

  if (!/Guardado:\s*1 plan/.test(aviso)) {
    console.log("  x el panel no confirmó el guardado");
    if (/No se guardó nada/.test(htmlGuardado)) {
      console.log("    Dice que algo estaba mal. Abajo se ve qué.");
    }
    const err = (htmlGuardado.match(/panel-cell-error">([^<]+)/g) || []).slice(0, 4);
    err.forEach((e) => console.log("    " + e.replace(/<[^>]+>/g, "")));
    await restaurar(csrfPlanes, antes);
    process.exit(1);
  }

  /* ---- 4. ¿Sale en la web pública? ---- */
  console.log("");
  const espera = new Set(["24.500", "24500"]);
  let vistasOk = 0;

  for (const ruta of ["/", "/precios"]) {
    const r = await pedir(ruta);
    const html = await r.text();

    /* Se busca el número CON y SIN separador de miles. El formateador
       los pone ("24.500"), pero el HTML puede venir escapado o con la
       entidad, y un comprobador demasiado exacto daría un falso
       negativo justo cuando todo funciona. */
    const aparece = [...espera].some((t) => html.includes(t));

    console.log("  " + (ruta === "/" ? "4." : "5.") + " " + ruta.padEnd(22) +
      "HTTP " + r.status + "  " + (aparece ? "✓ sale 24.500" : "x no sale"));

    if (r.status === 200 && aparece) vistasOk++;
  }

  /* ---- 5. Restaurar ---- */
  console.log("");
  await restaurar(csrfPlanes, antes);

  console.log("");
  if (vistasOk === 2) {
    console.log("  ✓ el precio guardado en el panel sale en la web pública\n");
    process.exit(0);
  }

  console.log("  x de las dos páginas públicas, " + vistasOk + " lo mostraban\n");
  process.exit(1);
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});

/* Devuelve el plan a como estaba.
   Se llama siempre, también en el camino de error: si la prueba falla
   a mitad, dejar un precio inventado en la tabla lo va a ver un
   visitante. */
async function restaurar(csrf, valorPrevio) {
  try {
    const csrfPlanes = await csrfDe("/panel/planes");
    const cuerpo = new URLSearchParams({ _csrf: csrfPlanes });
    cuerpo.set("precio_" + PLAN, valorPrevio || "");

    await pedir("/panel/planes", {
      method: "POST",
      body: cuerpo.toString(),
    });

    console.log(
      "  (precio de prueba retirado; quedó en \"" + (valorPrevio || "vacío") + "\")"
    );
  } catch (e) {
    console.log("  ! no se pudo restaurar: " + e.message);
    console.log("    Hay que dejar precio_" + PLAN + " en \"" + (valorPrevio || "") + "\" a mano.");
  }
}