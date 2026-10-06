/* El flujo entero del panel al microservicio, contra PRODUCCION.
 *
 * node db/flujo-completo.mjs
 *
 *   node db/flujo-completo.mjs
 *   node db/flujo-completo.mjs --url https://empresa.panel-...
 *
 * PARA QUE ESTE
 *
 * Antes de este, cada prueba comprobaba una cosa: que la clave es
 * buena, que el portal carga, que el enlace existe. Y el boton
 * "Abrir" fallaba igual, porque el fallo estaba en un valor que
 * ninguno de esos pasos toca.
 *
 * Este hace el camino entero y sin recortes:
 *
 *   entrar en el panel
 *     -> ver el portal del cliente
 *       -> pulsar el enlace del servicio
 *         -> canjear el ticket en el microservicio
 *           -> leer la API del servicio con esa sesion
 *
 * El paso del canje es el que importa y el que fallaba: el panel
 * firma el ticket con SU SERVICE_SECRET y el servicio lo verifica
 * con el suyo. Que coincidan es una condicion que no se ve mirando
 * ninguna de las otras pantallas, y que se rompe sola en cuanto uno
 * de los dos se redespliega con la variable cambiada.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(import.meta.dirname, "..");

function arg(n, d) {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : d;
}

const PANEL = arg("--url", process.env.PANEL_URL || "https://empresa.panel-niconqn.duckdns.org");
const MODULO = arg("--modulo", "inventario");

const NL = String.fromCharCode(10);

function leerEnv(ruta) {
  const s = {};
  if (!fs.existsSync(ruta)) return s;
  for (const l of fs.readFileSync(ruta, "utf8").split(NL)) {
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

const EMAIL = arg("--email", "cliente@ejemplo.com");
const CLAVE = arg("--clave", process.env.DC || "ClienteDemo123");

let ok = 0;
let fallos = 0;

const comprobar = (txt, cond, extra) => {
  console.log("  " + (cond ? "OK  " : "FALLA") + "  " + txt + (extra ? "  " + extra : ""));
  if (cond) ok++;
  else fallos++;
};

console.log("");
console.log("=== Del panel al microservicio ===");
console.log("");
console.log("  panel:    " + PANEL);
console.log("  usuario:  " + EMAIL);
console.log("  modulo:   " + MODULO);
console.log("");

const { createClient } = require("@supabase/supabase-js");

const URL_SB = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;

const db = createClient(URL_SB, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

/* El login va contra /auth/v1/token a pelo, NO con supabase-js.
 *
 * La version de supabase-js que hay instalada devuelve, con la clave
 * buena, `{ data: { session: null, user: null }, error: null }`:
 * sin error y sin usuario. El mismo caso que un fallo, y la unica
 * forma de saber la diferencia es ir a la API directamente.
 *
 * Y lo que se prueba aqui es justo esa llamada, porque es la que hace
 * el panel de verdad en routes/panel.js. */
const rLogin = await fetch(URL_SB + "/auth/v1/token?grant_type=password", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    apikey: env.SUPABASE_PUBLISHABLE_KEY,
    Authorization: "Bearer " + env.SUPABASE_PUBLISHABLE_KEY,
  },
  body: JSON.stringify({ email: EMAIL, password: CLAVE }),
});

const cuerpoLogin = await rLogin.text();

let sesion = null;
let motivo = "";
try {
  const j = JSON.parse(cuerpoLogin);
  sesion = j.access_token ? j : null;
  if (!sesion) motivo = (j.msg || j.error_description || j.error || "sin token");
} catch {
  motivo = cuerpoLogin.slice(0, 80);
}

comprobar("1. la clave es correcta", rLogin.status === 200 && !!sesion, "HTTP " + rLogin.status + (motivo ? "  " + motivo : ""));

comprobar(
  "   y Supabase devuelve token",
  !!sesion?.access_token,
  sesion?.access_token ? "si" : "FALTA: sin esto el servicio no puede validar nada"
);

if (!sesion?.access_token) {
  console.log("");
  console.log("  Sin sesion no se puede seguir. Con la API directa se ve el motivo:");
  console.log("  " + cuerpoLogin.slice(0, 220));
  console.log("");
  process.exit(1);
}

const userId = sesion.user.id;

const csrf = crypto.randomBytes(12).toString("hex");
const token = crypto.randomBytes(32).toString("hex");
const hash = crypto.createHash("sha256").update(token).digest("hex");

const { error: eIns } = await db.from("sessions").insert({
  token_hash: hash,
  user_id: userId,
  csrf_token: csrf,
  rol: "client",
  access_token: sesion.access_token,
  refresh_token: sesion.refresh_token,
  creada_en: new Date().toISOString(),
  ultimo_acceso: new Date().toISOString(),
  expira_en: new Date(Date.now() + 600_000).toISOString(),
});

comprobar("2. se crea la sesion del panel", !eIns, eIns ? eIns.message : "insertada");

const galleta = { cookie: "nexo_panel=" + token };

const portal = await fetch(PANEL + "/panel/mis-servicios", { headers: galleta, redirect: "manual" });
comprobar("3. el portal del cliente carga", portal.status === 200, "HTTP " + portal.status);

const html = await portal.text();

const enlaces = [...html.matchAll(/href="(\/panel\/(?:servicios|soporte)\/[^"]+)"/g)].map((m) => m[1]);
const destino = enlaces.find((e) => e.includes("/" + MODULO + "/"));

comprobar(
  "4. el portal ofrece el modulo " + MODULO,
  !!destino,
  destino || "no sale en " + enlaces.length + " enlaces"
);

const rAbrir = await fetch(PANEL + (destino || ""), { headers: galleta, redirect: "manual" });
const donde = rAbrir.headers.get("location") || "";

comprobar(
  "5. el enlace redirige al servicio",
  rAbrir.status === 302 && donde.includes("#ticket="),
  "HTTP " + rAbrir.status + " -> " + donde.slice(0, 58)
);

const tk = donde.split("#ticket=")[1] || "";
comprobar("   y el ticket viene firmado", tk.split(".").length === 2, tk.length + " chars");

if (tk) {
  const base = donde.split("#")[0].replace(/[\/]entrar$/, "");

  const rCanje = await fetch(base + "/api/entrar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket: tk }),
  });

  const sc = rCanje.headers.get("set-cookie") || "";
  const ck = sc.split(/,(?=\s*[^;=]+=)/).map((c) => c.trim().split(";")[0]).join("; ");
  const texto = await rCanje.text();

  comprobar("6. el servicio acepta el ticket", rCanje.status === 200, "HTTP " + rCanje.status);

  if (rCanje.status !== 200) {
    console.log("");
    console.log("  --- Cuando esto falla ---");
    console.log("  Si el servicio dice 'ese enlace no vale', el SERVICE_SECRET del");
    console.log("  panel y el del servicio son distintos.");
    console.log("");
    console.log("  OJO: en Coolify cada variable esta DUPLICADA, una con preview");
    console.log("  y otra sin ella, y pueden tener valores distintos. El contenedor");
    console.log("  se construye con una de las dos, asi que hay que mirar las dos:");
    console.log("");
    console.log("    SELECT is_preview, left(md5(value), 12)");
    console.log("      FROM environment_variables WHERE key = 'SERVICE_SECRET';");
    console.log("");
    console.log("  respuesta: " + texto.slice(0, 150));
    console.log("");
  }

  if (rCanje.status === 200) {
    comprobar("   y pone la cookie de sesion", ck.includes("inv_sesion"));
    comprobar("   va con secure", /;\s*secure/i.test(sc));

    const H = { "Content-Type": "application/json", Cookie: ck };

    const resumen = await fetch(base + "/api/resumen", { headers: H });
    const rj = await resumen.json();
    comprobar("7. la API del servicio responde", resumen.status === 200, "HTTP " + resumen.status);
    comprobar(
      "   y lee datos de verdad",
      Array.isArray(rj.data?.stock?.lista),
      (rj.data?.stock?.total ?? "?") + " presentaciones"
    );

    for (const api of ["productos", "ventas", "cuentas"]) {
      const r = await fetch(base + "/api/" + api, { headers: H });
      comprobar("8. /api/" + api + " responde 200", r.status === 200, "HTTP " + r.status);
    }
  }
}

await db.from("sessions").delete().eq("csrf_token", csrf);

console.log("");
console.log("=".repeat(54));
if (fallos) {
  console.log("FALLAN " + fallos + " de " + (ok + fallos));
  console.log("");
  process.exit(1);
}
console.log("Las " + ok + " comprobaciones pasan. El panel abre el servicio.");
console.log("");
process.exit(0);