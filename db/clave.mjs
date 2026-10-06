/* Ver, sin rodeos, si una clave sirve.
 *
 *   $env:DC="..."; node db/clave.mjs
 *   node db/clave.mjs --clave "..."
 *   node db/clave.mjs --clave "..." --email cliente@ejemplo.com
 *
 * Habla directo con /auth/v1/token y enseña lo que viene, sin
 * supabase-js en medio. Sirve para cuando login devuelve "sin error
 * pero sin usuario", que no dice nada de POR QUE.
 */
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");
const NL = String.fromCharCode(10);

function arg(n, d) {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : d;
}

const env = {};
if (fs.existsSync(path.join(RAIZ, ".env"))) {
  for (const l of fs.readFileSync(path.join(RAIZ, ".env"), "utf8").split(NL)) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}

const URL_SB = process.env.SUPABASE_URL || env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const PUB = process.env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY;
const EMAIL = arg("--email", "cliente@ejemplo.com");
const CLAVE = arg("--clave", process.env.DC || "ClienteDemo123");

console.log("");
console.log("=== La clave, tal cual la acepta Supabase ===");
console.log("");
console.log("  email:  " + EMAIL);
console.log("  clave:  " + (CLAVE ? CLAVE.length + " chars" : "VACIA"));
console.log("");

const r = await fetch(URL_SB + "/auth/v1/token?grant_type=password", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    apikey: PUB,
    Authorization: "Bearer " + PUB,
  },
  body: JSON.stringify({ email: EMAIL, password: CLAVE }),
});

const texto = await r.text();
console.log("  HTTP " + r.status);
console.log("");

let j = null;
try {
  j = JSON.parse(texto);
} catch {
  /* no es json */
}

if (j) {
  const copia = Object.assign({}, j);
  for (const k of Object.keys(copia)) {
    if (k.includes("token") && typeof copia[k] === "string") {
      copia[k] = copia[k].slice(0, 16) + "...";
    }
  }
  console.log("  " + JSON.stringify(copia));
} else {
  console.log("  " + texto.slice(0, 300));
}

console.log("");
if (r.status === 200) {
  console.log("  La clave ES correcta.");
  console.log("");
} else {
  console.log("  La clave NO sirve. Si el mensaje es de credenciales, la cuenta");
  console.log("  existe pero la clave no es esa. Se arregla con:");
  console.log("    node db/create-user.js");
  console.log("");
}

process.exit(r.status === 200 ? 0 : 1);