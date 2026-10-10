/* Que pasa al entrar como cliente demo.
 *
 * node db/entrar-cliente.mjs
 *
 * Sigue los mismos pasos que el login del panel, uno a uno, y dice en
 * cual falla. Sin agrupar los pasos: el fallo del panel es
 *
 *   [panel] Error en login: new row violates row-level security
 *   policy for table "sessions"
 *
 * que es el error de UN paso concreto, y sin saber cual es no hay
 * nada que arreglar.
 *
 * La clave se pasa por entorno para no dejarla escrita en un fichero:
 *
 *   $env:DC="..."; node db/entrar-cliente.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(import.meta.dirname, "..");

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

const { createClient } = require("@supabase/supabase-js");

const EMAIL = process.env.EMAIL_CLIENTE || process.env.EMAIL || "cliente@ejemplo.com";
const CLAVE = process.env.DC || process.env.CLAVE_CLIENTE || "";

console.log("\n═══ Entrar como cliente demo ═══\n");
console.log(`  email: ${EMAIL}`);
console.log(`  clave: ${CLAVE ? "viene por entorno (" + CLAVE.length + " chars)" : "NO VIENE"}\n`);

if (!CLAVE) {
  console.log("  Ponla en el entorno:");
  console.log('    $env:DC="tu-clave"; node db/entrar-cliente.mjs\n');
  process.exit(1);
}

const URL_SB = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const pub = createClient(URL_SB, process.env.SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false },
});
const adm = createClient(URL_SB, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

let fallos = 0;
const paso = (n, txt, cond, extra) => {
  console.log(`  ${cond ? "✓" : "✗"} ${n}. ${txt}${extra ? "  → " + extra : ""}`);
  if (!cond) fallos++;
};

/* ---- 1. La clave ---- */
const r = await pub.auth.signInWithPassword({ email: EMAIL, password: CLAVE });

/* El texto del paso 1 depende de las dos cosas: si Supabase devuelve
 * error, el mensaje es ese; si devuelve usuario, es su id. Antes solo
 * miraba el error, y con un `user`undefined reventaba al construir el
 * mensaje, que es justo el caso que hay que explicar. */
const detalle1 = r.error
  ? r.error.message
  : r.user
    ? r.user.id.slice(0, 8) + "..."
    : "sin error pero sin usuario";

paso(1, "la clave es correcta", !r.error && !!r.user, detalle1);

if (r.error || !r.user) {
  console.log("");
  console.log("  ── Si falla aquí ──");
  console.log("  La clave no es la que crees, o la cuenta no está confirmada.");
  console.log("  Con la secret key se ve si la cuenta existe y está activa:");
  console.log("    node db/create-user.js  (crea o reestablece la clave)");
  console.log("");
  process.exit(1);
}

const user = r.user;
const sesion = r.session;

/* ---- 2. Que viene la sesion completa ---- */
paso(2, "Supabase devuelve una sesion", !!sesion, sesion ? "expira en " + Math.round((sesion.expires_at - Date.now() / 1000) / 60) + " min" : "nada");

/* Esto es lo que el panel guarda en sessions.access_token, y lo que
 * luego necesita para firmar el ticket del microservicio. Si el token
 * no viene, el login va bien pero el servicio no puede funcionar. */
paso(3, "viene access_token", !!sesion?.access_token, sesion?.access_token ? sesion.access_token.length + " chars" : "FALTA");
paso(4, "viene refresh_token", !!sesion?.refresh_token, sesion?.refresh_token ? "si" : "FALTA — el enlace al servicio caducara a la hora");

/* ---- 5. El perfil ---- */
const { data: perfil, error: ePerfil } = await adm
  .from("profiles")
  .select("rol,activo,nombre")
  .eq("id", user.id)
  .maybeSingle();

if (ePerfil) {
  paso(5, "se lee el perfil", false, ePerfil.message);
} else if (!perfil) {
  paso(5, "existe el perfil", false, "no hay fila en profiles para este usuario");
  console.log("");
  console.log("  ── Si falla aquí ──");
  console.log("  El login es correcto pero sin perfil el panel responde");
  console.log('  "Tu cuenta no tiene acceso". Se crea con:');
  console.log("    node db/seed.js");
} else {
  paso(5, "el perfil existe y esta activo", !!perfil && perfil.activo, `${perfil.rol}  ${perfil.nombre}`);
}

/* ---- 6. El INSERT que falla en produccion ----
 * Esto es lo que hace auth.crearSesion(), con las mismas columnas y
 * el mismo token. Si falla aqui, ya se sabe por que falla alla. */
const marca = "diag-entrar-" + Date.now();
const expira = new Date(Date.now() + 3600_000).toISOString();

const { error: eIns } = await adm.from("sessions").insert({
  token_hash: marca,
  user_id: user.id,
  csrf_token: marca,
  rol: "staff",
  creada_en: new Date().toISOString(),
  ultimo_acceso: new Date().toISOString(),
  expira_en: expira,
  access_token: sesion?.access_token || null,
  refresh_token: sesion?.refresh_token || null,
  ip: "127.0.0.1",
  user_agent: "diag",
});

paso(6, "se crea la sesion en la base", !eIns, eIns ? `${eIns.message}  (code=${eIns.code})` : "insertada");

if (eIns) {
  console.log("");
  console.log("  ── Si falla AQUÍ ──");
  console.log("  La clave es correcta y el perfil está bien; lo que falla es");
  console.log("  guardar la sesión. Y eso es EXACTAMENTE lo que dice el log");
  console.log("  del panel:");
  console.log('');
  console.log('    [panel] Error en login: new row violates row-level security');
  console.log('    policy for table "sessions"');
  console.log("");
  console.log("  La tabla sessions tiene RLS encendido y NINGUNA política");
  console.log("  (migración 005_rls_cerrado.sql, a propósito: solo el servidor).");
  console.log("  Con eso, solo puede escribir el rol service_role.");
  console.log("");
  console.log("  Que el cliente de la secret key pueda y este INSERT no, significa");
  console.log("  que los dos NO están entrando con el mismo rol.");
  console.log("");
  console.log(`  error: ${eIns.message}`);
  console.log(`  code:  ${eIns.code || "-"}`);
  console.log(`  hint:  ${eIns.hint || "-"}`);
  console.log("");
} else {
  await adm.from("sessions").delete().eq("token_hash", marca);
}

/* ---- 7. El cliente tiene el modulo ---- */
const { data: modulo } = await adm.rpc("tiene_modulo", {
  cliente_uuid: (await adm.from("clients").select("id").limit(1)).data?.[0]?.id,
  modulo: "inventario",
});
paso(7, "tiene el modulo contratado", modulo === true, modulo ? "si" : "no");

console.log("\n" + "═".repeat(52));
if (fallos) {
  console.log(`✗ ${fallos} de 7 pasos fallan.\n`);
  process.exit(1);
}
console.log("✓ Los 7 pasos pasan. El login deberia funcionar.\n");
process.exit(0);