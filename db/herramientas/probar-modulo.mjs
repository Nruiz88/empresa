/* Comprobar que un módulo cualquiera abre desde el panel.
 *
 * node db/probar-modulo.mjs --modulo bot_whatsapp
 * node db/probar-modulo.mjs --modulo bot_whatsapp \
 *                             --url https://empresa.panel-...
 *
 * ── PARA QUÉ ESTE ──
 *
 * Corregir una url y comprobar que la página responde 200 no es
 * comprobar nada. Lo que importa es el camino entero: el panel firma
 * un ticket y el servicio lo acepta.
 *
 * Porque hay una diferencia que se ha dado en este proyecto: una
 * entrada que devuelve 200 y un canje que devuelve 401. La primera
 * prueba que "el servicio está desplegado" puede pasar con un servicio
 * que no comparte secreto con el panel.
 *
 * Y hay un caso que confunde: el bot NO tiene página de inicio, su raíz
 * da 404. No está roto. A él se entra por `/entrar`, que es la ruta
 * que construye el panel. Por eso esta prueba no mira la raíz.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const RAIZ = path.resolve(import.meta.dirname, "..");
const NL = String.fromCharCode(10);

function arg(n, d) {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : d;
}

const PANEL = arg("--url", process.env.PANEL_URL || "http://127.0.0.1:3000");
const MODULO = arg("--modulo", "bot_whatsapp");

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

let ok = 0;
let fallos = 0;

const comprobar = (txt, cond, extra) => {
  console.log("  " + (cond ? "OK  " : "FALLA") + "  " + txt + (extra ? "  " + extra : ""));
  if (cond) ok++;
  else fallos++;
};

console.log("");
console.log("=== El módulo " + MODULO + ", desde el panel ===");
console.log("");
console.log("  panel: " + PANEL);
console.log("");

const db = createClient(
  env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } }
);

/* ── 1. El módulo existe y qué url tiene ── */
const { data: modulo } = await db
  .from("modules")
  .select("id,nombre,url,disponible,retirado")
  .eq("id", MODULO)
  .single();

if (!modulo) {
  console.log("  no existe el módulo");
  process.exit(1);
}

console.log("  módulo:   " + modulo.nombre);
console.log("  url:      " + (modulo.url || "(ninguna)"));
console.log("  en venta: " + (modulo.retirado ? "retirado" : modulo.disponible ? "si" : "no"));
console.log("");

comprobar("tiene url puesta", !!modulo.url, modulo.url || "");

/* ── 2. Alguien que lo tenga contratado ── */
const { data: clientes } = await db.from("clients").select("id,nombre").limit(30);

let cliente = null;
for (const c of clientes || []) {
  const { data: tiene } = await db.rpc("tiene_modulo", {
    cliente_uuid: c.id,
    modulo: MODULO,
  });
  if (tiene === true) {
    cliente = c;
    break;
  }
}

comprobar("hay un cliente que lo tiene contratado", !!cliente, cliente ? cliente.nombre : "ninguno");

if (!cliente || !modulo.url) {
  console.log("");
  console.log("  Sin cliente o sin url no se puede probar el camino entero.");
  console.log("");
  process.exit(1);
}

/* ── 3. Sesión del CLIENTE, no del equipo ──
 *
 * Con sesión de staff el botón "Abrir" lleva a `/panel/soporte/...`,
 * que es lo correcto para el equipo: tiene que preguntar a qué cliente
 * entra y por qué. El canje directo, al que va el cliente, sale de
 * `/panel/servicios/<módulo>/entrar`.
 *
 * La primera versión de esta prueba entraba como staff, obtenía la ruta
 * de soporte, y fallaba tres comprobaciones porque la ruta no era la
 * que se quería probar. El módulo estaba bien; la prueba miraba donde
 * no era.
 *
 * Con rol `client` el botón va al canje directo, que es el camino que
 * recorre el cliente de verdad. */
const { data: usuarios } = await db.auth.admin.listUsers({ page: 1, perPage: 20 });
const uCliente = usuarios?.users?.find((u) => u.email === "cliente@ejemplo.com") || usuarios?.users?.[0];

if (!uCliente) {
  console.log("  no hay ningún usuario de cliente en la base");
  process.exit(1);
}

/* Un access_token DE VERDAD es obligatorio aquí, no opcional.
 *
 * El panel renueva el token de la sesión antes de firmar el ticket, y
 * sin uno la ruta contesta `/panel/login?error=sesion-caducada`. Que es
 * lo correcto: sin token no se puede reconstruir la sesión del cliente
 * en el servicio, y sin eso RLS no puede filtrar.
 *
 * Por eso el login va contra /auth/v1/token a pelo y no con
 * supabase-js: con la clave buena esa versión devuelve
 * `{ session: null, user: null, error: null }`, sin error y sin
 * usuario, que es indistinguible de un fallo. */
const rAuth = await fetch(
  (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL) + "/auth/v1/token?grant_type=password",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      Authorization: "Bearer " + env.SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({ email: uCliente.email, password: "ClienteDemo123" }),
  }
);

const cuerpoAuth = await rAuth.text();
let sesion = null;
try {
  const j = JSON.parse(cuerpoAuth);
  sesion = j.access_token ? j : null;
} catch {
  sesion = null;
}

comprobar("hay un access_token real", !!sesion, sesion ? "de " + uCliente.email : cuerpoAuth.slice(0, 120));

if (!sesion) {
  console.log("");
  console.log("  Sin token no se puede probar el canje: el panel no puede firmar.");
  console.log("");
  process.exit(1);
}

const csrf = crypto.randomBytes(12).toString("hex");
const token = crypto.randomBytes(32).toString("hex");
const hash = crypto.createHash("sha256").update(token).digest("hex");

await db.from("sessions").insert({
  token_hash: hash,
  user_id: uCliente.id,
  csrf_token: csrf,
  rol: "client",
  access_token: sesion.access_token,
  refresh_token: sesion.refresh_token,
  creada_en: new Date().toISOString(),
  ultimo_acceso: new Date().toISOString(),
  expira_en: new Date(Date.now() + 600_000).toISOString(),
});

/* ── 4. El enlace del botón "Abrir" ── */
const portal = await fetch(PANEL + "/panel/mis-servicios", {
  headers: { cookie: "nexo_panel=" + token },
  redirect: "manual",
});
const html = await portal.text();

const enlaces = [...html.matchAll(/href="(\/panel\/(?:servicios|soporte)\/[^"]+)"/g)].map((m) => m[1]);
const destino = enlaces.find((e) => e.includes("/" + MODULO + "/"));

comprobar("el portal ofrece el módulo", !!destino, destino || "no sale en " + enlaces.length + " enlaces");

let ticket = "";
let base = "";

if (destino) {
  const rAbrir = await fetch(PANEL + destino, {
    headers: { cookie: "nexo_panel=" + token },
    redirect: "manual",
  });
  const donde = rAbrir.headers.get("location") || "";

  comprobar("el enlace redirige al servicio", rAbrir.status === 302, "HTTP " + rAbrir.status);

  ticket = donde.split("#ticket=")[1] || "";
  base = donde.split("#")[0].replace(/\/entrar$/, "");

  comprobar("apunta al dominio del catálogo", base.startsWith(modulo.url.replace(/\/+$/, "")), base);
  comprobar("y lleva ticket firmado", ticket.split(".").length === 2, ticket.length + " chars");
}

await db.from("sessions").delete().eq("csrf_token", csrf);

/* ── 5. El canje, en el servicio ──
 *
 * Cada servicio canjea en una ruta distinta:
 *
 *   inventario   POST /api/entrar
 *   bot wweb     POST /api/entrar
 *   bot maqueta  POST /entrar   (misma ruta que el GET, sin /api)
 *
 * La primera versión de esta prueba lo LEÍA del HTML de la página de
 * entrada. Funcionaba con el bot maqueta, que es HTML plano con un
 * `fetch("/entrar"...)` visible, y fallaba con wweb, que es una SPA
 * de Next: el endpoint no aparece en el HTML que llega.
 *
 * Un 404 aquí no dice que el servicio esté roto: dice que se le
 * preguntó en una puerta que no tiene.
 *
 * Ahora se PREGUNTA, con un ticket inventado. El que responda 401 es el
 * que canjea; el que responda 404 no canjea por ahí. Y de paso
 * comprueba algo que la lectura del HTML no comprobaba: que el
 * servicio rechaza un ticket falso de verdad, y no que devuelve 200 a
 * cualquier cosa. */
const CANDIDATOS = ["/api/entrar", "/entrar"];

let endpoint = null;

for (const c of CANDIDATOS) {
  const r = await fetch(base + c, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket: "inventado.aaaabbbbcccc" }),
  });
  if (r.status !== 404 && r.status !== 405) {
    endpoint = c;
    break;
  }
}

comprobar("el servicio tiene alguna ruta de canje", !!endpoint, endpoint || "ninguna de " + CANDIDATOS.join(" / "));

if (endpoint) {
  /* Un ticket inventado DEBE rechazarse. Si el servicio devolviera 200
   * a cualquier cosa, la comprobación de abajo pasaría sin que el
   * canje real significara nada. */
  const rFalso = await fetch(base + endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket: "inventado.aaaabbbbcccc" }),
  });

  comprobar(
    "rechaza un ticket inventado",
    rFalso.status === 401 || rFalso.status === 403,
    "HTTP " + rFalso.status
  );

  /* Y ahora el ticket de verdad. */
  const r = await fetch(base + endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket }),
  });
  const texto = await r.text();

  console.log("");
  console.log("  canje en " + base + endpoint);
  console.log("  respuesta: HTTP " + r.status);
  if (r.status !== 200) console.log("  " + texto.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160));
  console.log("");

  comprobar("el servicio acepta el ticket del panel", r.status === 200, "HTTP " + r.status);

  const sc = r.headers.get("set-cookie") || "";
  comprobar("y pone cookie de sesión", /=\s*\S+/.test(sc) && sc.length > 0, sc.slice(0, 40));

  if (r.status !== 200 && r.status === 401 && /ese enlace no vale/i.test(texto)) {
    console.log("");
    console.log("  ── Qué mirar ──");
    console.log("  Si el ticket inventado también da 401 (lo comprobamos antes), el");
    console.log("  servicio está bien y lo que falla es la FIRMA: los dos no");
    console.log("  comparten SERVICE_SECRET.");
    console.log("");
    console.log('    docker exec <contenedor> sh -lc \'echo -n "$SERVICE_SECRET" | md5sum\'');
    console.log("");
  }
}

console.log("");
console.log("=".repeat(56));
if (fallos) {
  console.log("FALLAN " + fallos + " de " + (ok + fallos));
  console.log("");
  process.exit(1);
}
console.log("Las " + ok + " comprobaciones pasan.");
console.log("");
process.exit(0);