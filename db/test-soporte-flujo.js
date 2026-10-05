/* =========================================================
   Nexo Studio — El acceso de soporte, de extremo a extremo
   ------------------------------------------------------------
   db/test-soporte.js comprueba que la BASE deja y no deja. Esta
   comprueba que los dos SERVICIOS se pasan la información correcta:
   que el panel firma un ticket con el cliente y el motivo, y que el
   bot lo lee bien y crea la sesión de soporte.

   Por qué hace falta la de la base: cada una se equivoca en cosas
   distintas. La base puede estar perfecta y que el panel firme el
   ticket sin `mot`, y el bot crearía una sesión de soporte sin motivo
   que no podría escribir: se vería todo y no se podría tocar nada, y
   no hay ningún error en ninguna parte.

   Y al revés: el bot puede leer `mot` perfectamente y que el panel no
   lo mande nunca.

   USO
     TEST_PANEL=... TEST_BOT=... TEST_API_ENTRAR=... npm run test:soporte:flujo
   ========================================================= */

const PANEL = (process.env.TEST_PANEL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const BOT = (process.env.TEST_BOT || "http://127.0.0.1:3200").replace(/\/+$/, "");
const API_ENTRAR = process.env.TEST_API_ENTRAR || BOT + "/api/entrar";
const MODULO = process.env.TEST_MODULO || "bot_whatsapp";

const EMAIL = process.env.TEST_EMAIL || "admin@nexostudio.es";
const PASSWORD = process.env.TEST_PASSWORD || "PanelPrueba2026";
const MOTIVO = "prueba: el cliente dice que no le llegan los mensajes";

let ok = 0, fallos = 0;
function comprobar(desc, cond, extra) {
  console.log(`  ${cond ? "✓" : "✗"} ${desc}${extra ? "  → " + extra : ""}`);
  cond ? ok++ : fallos++;
}
function seccion(t) {
  console.log("\n── " + t + " " + "─".repeat(Math.max(0, 48 - t.length)));
}

const cookies = new Map();
function guardar(r) {
  for (const cruda of r.headers.getSetCookie?.() || []) {
    const par = cruda.split(";")[0];
    const eq = par.indexOf("=");
    if (eq > 0) cookies.set(par.slice(0, eq), par.slice(eq + 1));
  }
}
const cabecera = () => [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

async function pedir(url, opciones = {}) {
  const r = await fetch(url, { redirect: "manual", ...opciones });
  guardar(r);
  return r;
}

/** El contenido del ticket, sin imprimir el access_token que lleva. */
function abrirTicket(ticket) {
  const [cuerpo] = ticket.split(".");
  try {
    return JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

(async () => {
  console.log("\n═══ Soporte de extremo a extremo ═══");
  console.log("  panel: " + PANEL);
  console.log("  bot:   " + BOT + "\n");

  /* ---------- 1. Entrar como staff ---------- */
  seccion("el equipo entra al panel");

  cookies.clear();
  const login = await pedir(PANEL + "/panel/login");
  const csrf = ((await login.text()).match(/name="_csrf" value="([^"]+)"/) || [])[1];
  comprobar("el formulario trae CSRF", Boolean(csrf));

  const post = await pedir(PANEL + "/panel/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cabecera() },
    body: new URLSearchParams({ email: EMAIL, password: PASSWORD, _csrf: csrf }).toString(),
  });
  comprobar("el login va bien", post.status === 302, "estado " + post.status);
  comprobar("el panel da su cookie", cookies.has("nexo_panel"));

  /* ---------- 2. La pantalla de soporte ---------- */
  seccion("la pantalla de soporte");

  const sel = await pedir(PANEL + "/panel/soporte/" + MODULO, { headers: { Cookie: cabecera() } });
  comprobar("el equipo la ve", sel.status === 200, "estado " + sel.status);

  const html = await sel.text();
  comprobar("pide el motivo", /name="motivo"/.test(html));
  comprobar("y un cliente, no solo un texto libre", /name="cliente"/.test(html));
  comprobar("el motivo no se puede dejar en blanco", /motivo[^>]*required/.test(html) || /required[^>]*name="motivo"/.test(html));

  /* ---------- 3. Sin motivo, no se entra ---------- */
  seccion("sin motivo no se firma nada");

  /* El id de un cliente sale del propio HTML. Es un dato de la barra de
     direcciones para el bot, pero para el test sirve: lo que se
     comprueba es que la ruta NO firme un ticket. */
  const clienteId = (html.match(/name="cliente" value="([^"]+)"/) || [])[1];
  comprobar("hay un cliente en la lista", Boolean(clienteId));

  if (clienteId) {
    const sinMotivo = await pedir(
      PANEL + "/panel/servicios/" + MODULO + "/entrar?cliente=" + encodeURIComponent(clienteId),
      { headers: { Cookie: cabecera() } }
    );
    const loc = sinMotivo.headers.get("location") || "";
    comprobar("no devuelve un ticket", !loc.includes("#ticket="), loc.slice(0, 70));
    comprobar("vuelve a la pantalla de soporte", loc.includes("/soporte/"), loc.slice(0, 70));
  }

  /* ---------- 4. Con motivo, el ticket lo lleva ---------- */
  seccion("con motivo, el ticket lo lleva dentro");

  const conMotivo = await pedir(
    PANEL + "/panel/servicios/" + MODULO + "/entrar?cliente=" +
      encodeURIComponent(clienteId || "") +
      "&motivo=" + encodeURIComponent(MOTIVO),
    { headers: { Cookie: cabecera() } }
  );
  const destino = conMotivo.headers.get("location") || "";
  comprobar("redirige al bot", conMotivo.status === 302 && destino.startsWith(BOT), "estado " + conMotivo.status);

  const ticket = decodeURIComponent((destino.match(/#ticket=(.+)$/) || [])[1] || "");
  comprobar("hay ticket", Boolean(ticket), ticket.length + " caracteres");

  const payload = abrirTicket(ticket);
  if (!payload) {
    console.log("\n  no se pudo abrir el ticket");
  } else {
    comprobar("el rol es staff", payload.rol === "staff", payload.rol);
    comprobar("lleva el cliente elegido", payload.cid === clienteId, String(payload.cid));
    comprobar("lleva el motivo", payload.mot === MOTIVO, payload.mot);
    comprobar("y el motivo va firmado, no aparte", String(ticket).includes("."), "");
  }

  /* ---------- 5. El bot lo canjea ---------- */
  seccion("el bot canjea la entrada de soporte");

  const canje = await fetch(API_ENTRAR, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket }),
  });
  const texto = await canje.text();
  comprobar("el bot acepta el ticket", canje.status === 200, "estado " + canje.status + " · " + texto.slice(0, 120));

  const cookieBot = (canje.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  const tokenBot = (cookieBot.match(/nexo_bot=([^;]+)/) || [])[1];
  comprobar("da su cookie propia", Boolean(tokenBot));

  /* ---------- 6. El dashboard muestra la banda ---------- */
  seccion("el bot avisa de que está viendo a un cliente");

  const perfil = await fetch(BOT + "/api/profile", { headers: { Cookie: cookieBot } });
  const datos = await perfil.json().catch(() => ({}));
  const soporte = datos.data && datos.data.soporte;

  comprobar("el perfil responde", perfil.status === 200, "estado " + perfil.status);
  comprobar("dice que es una sesión de soporte", Boolean(soporte && soporte.activo), JSON.stringify(soporte));
  comprobar("con el motivo intacto", soporte && soporte.motivo === MOTIVO, soporte && soporte.motivo);

  const dash = await fetch(BOT + "/dashboard", { headers: { Cookie: cookieBot }, redirect: "manual" });
  comprobar("y el dashboard abre", dash.status === 200, "estado " + dash.status);

  /* ---------- Resumen ---------- */
  console.log("\n" + "═".repeat(54));
  if (fallos) {
    console.log(`✗ ${fallos} de ${ok + fallos} fallan.`);
    process.exit(1);
  }
  console.log(`✓ Las ${ok} comprobaciones pasan.`);
  process.exit(0);
})().catch((e) => {
  console.error("\n✗ " + e.message + "\n");
  if (e.cause && e.cause.message) console.error("  causa: " + e.cause.message);
  process.exit(1);
});