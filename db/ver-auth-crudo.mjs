/* Ver la respuesta CRUDA de Supabase al entrar como cliente demo.
 *
 * node db/ver-auth-crudo.mjs
 *
 *   $env:DC="..."; node db/ver-auth-crudo.mjs
 *
 * El cliente de supabase-js se come algunos errores y devuelve
 * {data: {user: null}, error: null}. Con eso no se ve si la cuenta no
 * existe, si la clave esta mal, o si el proyecto esta en pausa. Esto
 * habla directamente con /auth/v1/token y enseña lo que viene.
 */
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");

function leerEnv(ruta) {
  const s = {};
  if (!fs.existsSync(ruta)) return s;
  for (const l of fs.readFileSync(ruta, "utf8").split(/\r?\n")) {
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

const EMAIL = process.env.EMAIL_CLIENTE || process.env.EMAIL || "cliente@ejemplo.com";
const CLAVE = process.env.DC || "";

const URL_SB = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY;

console.log("\n═══ La respuesta cruda de Supabase ═══\n");
console.log(`  proyecto: ${URL_SB}`);
console.log(`  email:    ${EMAIL}`);
console.log(`  clave:    ${CLAVE ? CLAVE.length + " chars" : "NO VIENE"}\n`);

/* ---- 1. La peticion tal cual ---- */
const r = await fetch(`${URL_SB}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    apikey: PUBLISHABLE,
    Authorization: "Bearer " + PUBLISHABLE,
  },
  body: JSON.stringify({ email: EMAIL, password: CLAVE }),
});

const texto = await r.text();

console.log(`  HTTP ${r.status} ${r.statusText}\n`);
console.log(`  respuesta cruda:\n`);

let json = null;
try {
  json = JSON.parse(texto);
} catch {
  /* no es json */
}

if (json) {
  /* No se enseña el access_token entero. */
  const copia = { ...json };
  for (const k of ["access_token", "refresh_token"]) {
    if (copia[k]) copia[k] = copia[k].slice(0, 18) + "...";
  }
  console.log("  " + JSON.stringify(copia, null, 2).split("\n").join("\n  "));
} else {
  console.log("  " + texto.slice(0, 600));
}

console.log("");

/* ---- 2. Que dice de este usuario la secret key ---- */
const admHeaders = {
  "Content-Type": "application/json",
  apikey: process.env.SUPABASE_SECRET_KEY,
  Authorization: "Bearer " + process.env.SUPABASE_SECRET_KEY,
};

const lu = await fetch(`${URL_SB}/auth/v1/admin/users?page=1&per_page=50`, { headers: admHeaders });
const usuarios = await lu.json();

console.log("── el usuario, visto con la secret key ──\n");

const lista = usuarios?.users || usuarios;
if (!Array.isArray(lista)) {
  console.log("  no se pudo listar: " + JSON.stringify(usuarios).slice(0, 200));
} else {
  for (const u of lista) {
    console.log(`  ${u.id}`);
    console.log(`     email:        ${u.email}`);
    console.log(`     confirmado:   ${u.email_confirmed_at ? "si, " + u.email_confirmed_at : "NO"}`);
    console.log(`     ultimo acceso: ${u.last_sign_in_at || "nunca"}`);
    console.log(`     banned:       ${u.banned_until ? "si, hasta " + u.banned_until : "no"}`);
    console.log(`     phone:        ${u.phone || "-"}`);
  }
}

/* ---- 3. Si el proyecto esta en pausa ---- */
console.log("\n── el proyecto responde? ──\n");
const salud = await fetch(`${URL_SB}/auth/v1/health`, { headers: admHeaders });
console.log(`  /auth/v1/health: HTTP ${salud.status}`);
const cuerpoSalud = await salud.text();
console.log(`  cuerpo: ${cuerpoSalud.slice(0, 200)}`);

const rest = await fetch(`${URL_SB}/rest/v1/`, { headers: admHeaders });
console.log(`  /rest/v1:      HTTP ${rest.status}`);
const cuerpoRest = await rest.text();
console.log(`  cuerpo: ${cuerpoRest.slice(0, 200)}`);

console.log("");
process.exit(0);