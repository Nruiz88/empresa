/* El login del panel, por HTTP, como lo hace el navegador.
 *
 * node db/entrar-panel.mjs
 *
 *   $env:DC="..."; node db/entrar-panel.mjs
 *   node db/entrar-panel.mjs --email cliente@ejemplo.com --url https://empresa.panel-...
 *
 * ── POR QUÉ ESTE Y NO UNO MÁS ──
 *
 * Todo lo otro ya se ha probado y funciona: crearSesion() con token
 * real, el cliente de getAdmin(), el getAdmin() cacheado, insert a
 * mano. Y en el log del servidor hay un fallo que no aparece en
 * ninguno de esos insert.
 *
 * Lo que no se ha probado es el CAMINO ENTERO: GET al formulario
 * (que deja una cookie de CSRF) y luego POST con ella. Puede que el
 * fallo no sea en el insert de la sesión sino en el de la sesión de
 * la WEB, que va antes.
 *
 * Un detalle que cambia el resultado: el login hace
 *
 *   getPublico().auth.signInWithPassword()
 *   ... y despues usa el cliente ADMIN para escribir.
 *
 * Si el cliente público mantiene la sesión en el mismo almacenamiento
 * que el admin —y los dos se crean en el mismo proceso—, el admin
 * puede acabar con el token del usuario en la cabecera y hablar a la
 * base como `authenticated` en vez de como `service_role`. Con RLS
 * encendido en sessions, eso es exactamente este error.
 */
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");

function arg(nombre, porDefecto) {
  const i = process.argv.indexOf(nombre);
  return i > -1 ? process.argv[i + 1] : porDefecto;
}

const EMAIL = arg("--email", process.env.EMAIL_CLIENTE || "cliente@ejemplo.com");
const CLAVE = process.env.DC || "";
const PANEL = arg("--url", process.env.PANEL_URL || "https://empresa.panel-niconqn.duckdns.org");
const BASE = arg("--base", "/panel");

console.log("\n═══ El login del panel, por HTTP ═══\n");
console.log(`  panel: ${PANEL}`);
console.log(`  email: ${EMAIL}`);
console.log(`  clave: ${CLAVE ? CLAVE.length + " chars" : "NO VIENE"}\n`);

if (!CLAVE) {
  console.log('  $env:DC="tu-clave"; node db/entrar-panel.mjs\n');
  process.exit(1);
}

/* ── Las cookies, a mano ──
 * fetch no tieneCookies en Node, y este script tiene que llevar las
 * suyas: el login exige la cookie de CSRF que deja el GET. */
let galleta = "";

function conGalleta(h) {
  return { ...h, ...(galleta ? { Cookie: galleta } : {}) };
}

function guardarGalleta(res) {
  const todos = res.headers.getSetCookie?.() || [];
  for (const c of todos) {
    const par = c.split(";")[0].trim();
    if (!par) continue;
    const nombre = par.split("=")[0];
    /* Reemplaza si existe, si no, añade. */
    const resto = galleta
      .split("; ")
      .filter((x) => x && x.split("=")[0] !== nombre);
    resto.push(par);
    galleta = resto.join("; ");
  }
}

/* ── 1. El formulario ── */
console.log("── 1. GET al formulario ──\n");

const r1 = await fetch(PANEL + BASE + "/login", {
  headers: { "User-Agent": "diag" },
  redirect: "manual",
});
const h1 = await r1.text();
guardarGalleta(r1);

console.log(`  HTTP ${r1.status}`);
console.log(`  cookies: ${galleta ? galleta.split("; ").map((c) => c.split("=")[0]).join(", ") : "(ninguna)"}`);

/* El token de CSRF va en el formulario, no solo en la cookie. */
const mCsrf = h1.match(/name=["']_csrf["'][^>]*value=["']([^"']+)["']/i)
  || h1.match(/value=["']([^"']+)["'][^>]*name=["']_csrf["']/i);
const csrf = mCsrf ? mCsrf[1] : "";

console.log(`  token CSRF: ${csrf ? csrf.slice(0, 16) + "..." : "NO ENCONTRADO en el HTML"}`);

/* ── 2. El envío ── */
console.log("\n── 2. POST con la clave ──\n");

/* El campo se llama `password`, no `clave`. Con `clave` el servidor
 * recibe un cuerpo sin contraseña, y como el error que devuelve es un
 * 400 de CSRF genérico parece que el problema es el token. */
const cuerpo = new URLSearchParams();
cuerpo.set("email", EMAIL);
cuerpo.set("password", CLAVE);
cuerpo.set("siguiente", BASE);
if (csrf) cuerpo.set("_csrf", csrf);

const r2 = await fetch(PANEL + BASE + "/login", {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": "diag",
    ...(galleta ? { Cookie: galleta } : {}),
  },
  body: cuerpo.toString(),
  redirect: "manual",
});
const h2 = await r2.text();
guardarGalleta(r2);

console.log(`  HTTP ${r2.status}`);
if (r2.status >= 300 && r2.status < 400) {
  console.log(`  redirige a: ${r2.headers.get("location")}`);
}

/* ── 3. Que dice ── */
console.log("\n── 3. La respuesta ──\n");

if (r2.status === 200) {
  /* El mensaje de error va en la propia pagina. */
  const mErr = h2.match(/class=["'][^"']*(error|alert|aviso|danger)[^"']*["'][^>]*>([\s\S]{0,200}?)</i);
  console.log(`  HTTP 200 con la pagina de login: el login NO entro.`);
  if (mErr) console.log(`  mensaje: ${mErr[2].replace(/\s+/g, " ").trim().slice(0, 140)}`);

  const textos = h2
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  console.log(`  pagina: ${textos.slice(0, 200)}`);
} else if (r2.status >= 300 && r2.status < 400) {
  const destino = r2.headers.get("location") || "";
  const entro = !destino.includes("login");
  console.log(`  ${entro ? "✓" : "✗"} ${entro ? "ENTRO" : "vuelve al login: clave incorrecta"}`);
  console.log(`  destino: ${destino}`);
  console.log(`  cookie de sesion: ${galleta.includes("panel_sesion") || galleta.includes("sesion") ? "puesta" : "NO"}`);
  console.log(`  todas: ${galleta.split("; ").map((c) => c.split("=")[0]).join(", ")}`);
} else {
  console.log(`  HTTP ${r2.status}: ${textosSafe(h2)}`);
}

function textosSafe(h) {
  return h
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

console.log("\n" + "═".repeat(52));

/* Si entró, un paso más: comprobar que de verdad hay sesión. */
if (r2.status >= 300 && r2.status < 400 && !(r2.headers.get("location") || "").includes("login")) {
  /* El portal del cliente es donde sale el 500, no el panel de equipo:
   * /panel/mis-servicios es lo que ve el cliente demo. */
  for (const [nombre, ruta] of [
    ["panel de equipo", BASE],
    ["portal del cliente", BASE + "/mis-servicios"],
  ]) {
    const r = await fetch(PANEL + ruta, {
      headers: conGalleta({ "User-Agent": "diag" }),
      redirect: "manual",
    });
    console.log(`\n── ${nombre} ──`);
    console.log(`  GET ${ruta}: HTTP ${r.status}${r.status >= 300 && r.status < 400 ? "  -> " + r.headers.get("location") : ""}`);
    if (r.status === 200) {
      const t = await h3Texto(r);
      console.log(`  pagina: ${t.slice(0, 160)}`);
    }
    if (r.status >= 500) {
      console.log("");
      console.log("  Un 500 aqui. El cuerpo suele decir por que; si no, esta en");
      console.log("  el log del servidor.");
      const cuerpo = await r.text();
      const limpio = cuerpo.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      console.log(`  cuerpo: ${limpio.slice(0, 220)}`);
    }
  }
}

async function h3Texto(res) {
  const h = await res.text();
  return h
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

console.log("");
process.exit(0);