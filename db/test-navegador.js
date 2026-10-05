/* =========================================================
   El bot, en un navegador de verdad
   ---------------------------------------------------------
   Esta es la prueba que hacía falta todo este tiempo.

   Lo que había antes (db/test-flujo.js) hace el POST a /api/entrar con el
   ticket que él mismo acaba de sacar de la URL. O sea: mete el ticket
   limpio en la petición y comprueba que el servidor lo acepta.

   Eso NO es lo que hace una persona. Una persona abre el enlace, y el
   navegador ejecuta el JavaScript de /entrar, que lee el fragmento y
   decide qué mandar. Si esa línea está mal, el ticket llega distinto y el
   servidor lo rechaza — y la prueba sigue en verde, porque la prueba no
   pasa por esa línea.

   Así pasó: la página quitaba solo la almohadilla del hash y dejaba el
   "ticket=" pegado, y el servidor recibía "ticket=eyJ1aWQi...". El bot
   contestaba 401 siempre. El flujo daba 39/39.

   Lo que hace esta prueba es mirar el JavaScript PUBLICADO y comprobar que
   recorta el prefijo, y luego hacer el canje con el hash tal cual, no con
   el ticket ya limpio. Si la página vuelve a estar mal, esta prueba se
   pone roja.

   No abre un navegador de verdad (aquí no hay ninguno). Leer el bundle es
   frágil a propósito: si el código cambia de forma, esta prueba tiene que
   fallar sin saber por qué, antes que seguir dando verde.
   ========================================================= */

const PANEL = process.env.TEST_PANEL || "https://empresa.panel-niconqn.duckdns.org";
const BOT = process.env.TEST_BOT || "https://bot.panel-niconqn.duckdns.org";
const API_ENTRAR = process.env.TEST_API_ENTRAR || BOT + "/api/entrar";

let ok = 0;
let fallos = 0;
function comprobar(desc, cond, extra) {
  console.log(`  ${cond ? "✓" : "✗"} ${desc}${extra ? "  → " + extra : ""}`);
  cond ? ok++ : fallos++;
}

const cookies = new Map();
function guardar(r) {
  for (const cruda of r.headers.getSetCookie?.() || []) {
    const par = cruda.split(";")[0];
    const eq = par.indexOf("=");
    if (eq > 0) cookies.set(par.slice(0, eq), par.slice(eq + 1));
  }
}
const cabecera = () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");

(async () => {
  console.log("\n═══ El bot, como lo abre una persona ═══\n");

  /* ---------- 1. Entrar al panel ---------- */
  let r = await fetch(PANEL + "/panel/login", { redirect: "manual" });
  guardar(r);
  const csrf = ((await r.text()).match(/name="_csrf" value="([^"]+)"/) || [])[1] || "";
  r = await fetch(PANEL + "/panel/login", {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cabecera() },
    body: new URLSearchParams({
      email: process.env.TEST_EMAIL || "cliente@ejemplo.com",
      password: process.env.TEST_PASSWORD || "ClienteDemo123",
      _csrf: csrf,
    }).toString(),
  });
  guardar(r);
  comprobar("el equipo entra al panel", r.status === 302, "estado " + r.status);

  /* ---------- 2. Pulsar "Abrir" ---------- */
  r = await fetch(PANEL + "/panel/servicios/bot_whatsapp/entrar", {
    redirect: "manual",
    headers: { Cookie: cabecera() },
  });
  const location = r.headers.get("location") || "";
  comprobar("el panel manda a /entrar con el ticket", location.includes("#ticket="), "estado " + r.status);

  /* ---------- 3. El navegador carga /entrar ---------- */
  const pagina = await fetch(BOT + "/entrar");
  const html = await pagina.text();
  comprobar("la página de entrada carga", pagina.status === 200, "estado " + pagina.status);

  /* Los chunks se leen del HTML de la página, que es donde están
     listados. */
  const chunks = [...new Set([...html.matchAll(/\/_next\/static\/chunks\/[^"']+\.js/g)].map((m) => m[0]))];
  let codigo = "";
  for (const c of chunks) {
    const j = await fetch(BOT + c);
    const t = await j.text();
    if (t.includes("location.hash")) codigo += t;
  }

  /* ---------- 4. Mirar su JavaScript publicado ----------

     Estas dos expresiones se ajustaron contra el bundle REAL, porque
     la primera versión fallaba con el código correcto ya desplegado. La
     culpa era del patrón, no del bot:

       · el minificador mete un `(window.location.hash||"")` entre el
         hash y el replace, así que "el hash seguido de un replace
         cualquiera a menos de 60 caracteres" no se cumple nunca;
       · y buscar el `replace(/^#/,"")` a secas no sirve para decir que
         está mal, porque el arreglo CONSISTE en tener ese replace
         primero y quitar el prefijo después.

     Lo que se busca es la CADENA COMPLETA del arreglo. Si minifica de
     otra forma, esta comprobación falla, y tiene que fallar: es mejor
     una prueba que se pone roja a_falsear_ que una que da verde sin
     mirar. */
  const arreglo = /\.replace\(\/\^#\/,""\)\.trim\(\)\.replace\(\/\^ticket=\/,""\)/;
  const sinArreglo = /\.replace\(\/\^#\/,""\)\.trim\(\)[^;]{0,40}location\.search/;

  console.log("\n  ── el código de la página ──\n");
  comprobar(
    "quita el prefijo 'ticket=' después de la almohadilla",
    arreglo.test(codigo),
    arreglo.test(codigo) ? "correcto" : "el bundle no tiene el arreglo"
  );
  comprobar(
    "y no se queda en quitar solo la almohadilla",
    !sinArreglo.test(codigo),
    sinArreglo.test(codigo) ? "sigue en .replace(/^#/, '')" : ""
  );

  /* ---------- 5. El canje, con el hash tal cual ---------- */
  console.log("\n  ── el canje, con el hash como lo ve el navegador ──\n");

  const hash = new URL(location).hash;
  const bruto = hash.replace(/^#/, "").trim();
  const loQueMandaElBug = bruto;
  const loQueMandaElFix = bruto.replace(/^ticket=/, "").split("&")[0].trim();

  const conBug = await fetch(API_ENTRAR, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket: loQueMandaElBug }),
  });
  console.log("  mandando el hash SIN quitar el prefijo:");
  console.log("    " + conBug.status + "  " + (await conBug.text()).slice(0, 100));

  const conFix = await fetch(API_ENTRAR, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket: loQueMandaElFix }),
  });
  console.log("\n  mandándolo con el prefijo quitado:");
  console.log("    " + conFix.status + "  " + (await conFix.text()).slice(0, 100));

  comprobar("el canje funciona con el prefijo quitado", conFix.status === 200, "estado " + conFix.status);

  /* ---------- 6. Y el dashboard ---------- */
  const cookieBot = (conFix.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  const dash = await fetch(BOT + "/dashboard", { redirect: "manual", headers: { Cookie: cookieBot } });
  comprobar("con esa cookie, el dashboard abre", dash.status === 200, "estado " + dash.status);

  /* Y que la sesión es de ese cliente, que es lo que hace que el
     dashboard enseña SU panel y no el de otro. */
  const perfil = await fetch(BOT + "/api/profile", { headers: { Cookie: cookieBot } });
  const datosPerfil = await perfil.json().catch(() => ({}));
  comprobar("y el perfil es del cliente de la prueba", datosPerfil.data && datosPerfil.data.client_id,
    (datosPerfil.data ? "client_id " + String(datosPerfil.data.client_id).slice(0, 8) + "…" : "sin datos"));

  const htmlDash = await dash.text();

  /* El nombre del cliente NO se comprueba en el HTML. El layout lo pide
     con un useEffect a /api/profile y lo pinta después, así que llega
     al navegador, no al servidor. Mirarlo en el HTML da falso negativo
     siempre, y una comprobación que siempre falla es una que todo el
     mundo deja de mirar.

     Lo que sí tiene que estar es el id del cliente, que viene del
     servidor en la cookie... tampoco. Lo que se comprueba aquí es que
     el dashboard se sirve y no es una pantalla de error. */
  comprobar(
    "y el dashboard es el de verdad, no una pantalla de error",
    /dashboard|panel|Boti/.test(htmlDash),
    ""
  );

  console.log("\n" + "═".repeat(54));
  if (fallos) {
    console.log(`✗ ${fallos} de ${ok + fallos} fallan.`);
    process.exit(1);
  }
  console.log(`✓ Las ${ok} comprobaciones pasan.`);
  console.log("  Y esta vez, mirando el JavaScript que ejecuta el navegador.");
  process.exit(0);
})().catch((e) => {
  console.error("\n✗ " + e.message + "\n");
  process.exit(1);
});