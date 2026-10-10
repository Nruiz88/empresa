/* Reproducir el login REAL del panel, paso a paso.
 *
 * Se ejecuta dentro del contenedor del panel:
 *   docker cp este-fichero <cont>:/app/diag-real.mjs
 *   docker exec -w /app <cont> node /app/diag-real.mjs
 *
 * node db/diag-real.mjs      (fuera del contenedor, apuntando al panel)
 *
 * ── POR QUÉ ESTE ──
 *
 * El login del panel falla con:
 *
 *   [panel] Error en login: new row violates row-level security
 *   policy for table "sessions"
 *
 * Y con las MISMAS funciones, dentro del MISO contenedor, crearSesion()
 * funciona. La diferencia entre mi prueba y el login real era una sola:
 * yo pasaba accessToken: null y el login real pasa el token de verdad.
 *
 * Con un token de verdad en la fila, si algo rebuilda el cliente de
 * Supabase con ese token, el rol deja de ser service_role y pasa a
 * authenticated — que NO salta RLS. Y el error resultante es
 * exactamente este: una tabla con RLS y cero políticas rechaza a
 * authenticated, y solo a authenticated.
 *
 * Por eso aquí se hacen los dos inserts con la misma db, y solo
 * cambia el access_token de la fila. Si el segundo falla y el primero
 * no, el cliente se está autenticando por debajo.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const DENTRO = fs.existsSync("/app/lib/supabase.js");
const RAIZ = DENTRO ? "/app" : path.resolve(import.meta.dirname, "..");

function leerEnv(ruta) {
  const s = {};
  if (!fs.existsSync(ruta)) return s;
  for (const l of fs.readFileSync(ruta, "utf8").split(/\r?\n/)) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) s[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return s;
}

const env = leerEnv(path.join(RAIZ, ".env"));
for (const [k, v] of Object.entries(env)) {
  if (k in process.env) continue;
  process.env[k] = v;
}

const supabase = require(path.join(RAIZ, "lib", "supabase.js"));
const auth = require(path.join(RAIZ, "lib", "auth.js"));
const { createClient } = require("@supabase/supabase-js");

console.log(`\n═══ El login real, paso a paso ═══\n`);
console.log(`  dentro del contenedor: ${DENTRO ? "si" : "no"}`);
console.log(`  raiz de la app:        ${RAIZ}\n`);

const EMAIL = process.env.EMAIL_CLIENTE || "cliente@ejemplo.com";
const CLAVE = process.env.DC || "";

/* ---- 0. Un token de verdad ---- */
console.log("── 0. conseguir un token real ──\n");

let tokenReal = null;
let refreshReal = null;

if (CLAVE) {
  const r = await supabase
    .getPublico()
    .auth.signInWithPassword({ email: EMAIL, password: CLAVE });

  if (r.error) {
    console.log(`  no se pudo entrar: ${r.error.message}`);
  } else {
    tokenReal = r.data?.session?.access_token || null;
    refreshReal = r.data?.session?.refresh_token || null;
    console.log(`  ✓ login con la clave: ${r.data.user.id.slice(0, 8)}...`);
    console.log(`    access_token:  ${tokenReal ? tokenReal.length + " chars" : "FALTA"}`);
    console.log(`    refresh_token: ${refreshReal ? refreshReal.length + " chars" : "FALTA"}`);
  }
} else {
  console.log("  sin clave (pasa $env:DC=...): se prueba solo con null");
}

/* El user_id del cliente, para no usar el del admin por error. */
const admin = supabase.getAdmin();
const { data: usuarios } = await admin.auth.admin.listUsers({ page: 1, perPage: 20 });
const userCliente = usuarios?.users?.find((u) => u.email === EMAIL);

console.log(`\n  user_id del cliente: ${userCliente ? userCliente.id.slice(0, 8) + "..." : "no encontrado"}`);

if (!userCliente) {
  console.log("\n  Sin el usuario no se puede seguir.\n");
  process.exit(1);
}

/* ---- 1. El INSERT de la sesión, con token y sin token ---- */
console.log("\n── 1. crearSesion() con y sin token ──\n");

/* 1a. Sin token. */
try {
  const s = await auth.crearSesion(admin, {
    userId: userCliente.id,
    rol: "staff",
    req: { headers: { "user-agent": "diag" }, ip: "127.0.0.1" },
    accessToken: null,
    refreshToken: null,
  });
  console.log(`  ✓ SIN token:  funciona`);
  await admin.from("sessions").delete().eq("token_hash", s.token);
} catch (e) {
  console.log(`  ✗ SIN token:  ${e.message}`);
}

/* 1b. Con el token de verdad. Esto es lo que hace el login real. */
if (tokenReal) {
  try {
    const s = await auth.crearSesion(admin, {
      userId: userCliente.id,
      rol: "staff",
      req: { headers: { "user-agent": "diag" }, ip: "127.0.0.1" },
      accessToken: tokenReal,
      refreshToken: refreshReal,
    });
    console.log(`  ✓ CON token:  funciona`);
    await admin.from("sessions").delete().eq("token_hash", s.token);
  } catch (e) {
    console.log(`  ✗ CON token:  ${e.message}`);
    console.log("");
    console.log("  ── reproduced ──");
    console.log("  El mismo fallo del panel, con el mismo codigo. La diferencia");
    console.log("  entre los dos inserts es unicamente el access_token.");
    console.log("");
    console.log("  Con el token presente, el cliente de Supabase se autentica");
    console.log("  como ese usuario en lugar de como service_role. Y como");
    console.log("  sessions tiene RLS sin politicas, authenticated no puede");
    console.log("  escribir. Solo service_role puede, y con BYPASSRLS.");
  }
}

/* ---- 2. El mismo INSERT, pero con el cliente del panel intacto ----
 * A veces el cliente cacheado se queda "contaminado" por un login. Esta
 * prueba dice si hay que reiniciar el contenedor para arreglarlo. */
if (tokenReal) {
  console.log("\n── 2. el mismo insert, con un cliente NUEVO ──\n");

  const { createClient } = require("@supabase/supabase-js");
  const nuevo = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const marca = "diag2-" + Date.now();
  const r = await nuevo.from("sessions").insert({
    token_hash: marca,
    user_id: userCliente.id,
    csrf_token: marca,
    rol: "staff",
    creada_en: new Date().toISOString(),
    ultimo_acceso: new Date().toISOString(),
    expira_en: new Date(Date.now() + 3600_000).toISOString(),
    access_token: tokenReal,
    refresh_token: refreshReal,
  });

  console.log(r.error ? `  ✗ FALLA: ${r.error.message}` : "  ✓ funciona");
  if (!r.error) await nuevo.from("sessions").delete().eq("token_hash", marca);
}

/* ---- 3. Si el cliente cacheado esta bien ---- */
console.log("\n── 3. el cliente que tiene el panel ahora mismo ──\n");

const marca3 = "diag3-" + Date.now();
const r3 = await admin.from("sessions").insert({
  token_hash: marca3,
  user_id: userCliente.id,
  csrf_token: marca3,
  rol: "staff",
  creada_en: new Date().toISOString(),
  ultimo_acceso: new Date().toISOString(),
  expira_en: new Date(Date.now() + 3600_000).toISOString(),
  access_token: null,
});

console.log(r3.error ? `  ✗ FALLA: ${r3.error.message}` : "  ✓ funciona");
if (!r3.error) await admin.from("sessions").delete().eq("token_hash", marca3);

if (!r3.error) {
  console.log("");
  console.log("  El cliente cacheado funciona. Entonces el fallo depende solo");
  console.log("  de los DATOS que mete el login, no del cliente.");
}

console.log("\n");
process.exit(0);