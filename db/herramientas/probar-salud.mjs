/* Probar la pantalla de salud, como la ve el equipo.
 *
 * node db/probar-salud.mjs
 *
 *   node db/probar-salud.mjs
 *   node db/probar-salud.mjs --url https://empresa.panel-...
 *
 * ── PARA QUÉ ESTE ──
 *
 * La pantalla de salud es de diagnóstico, y se abre con una sesión de
 * staff. Probar la URL y ver un 302 no dice nada: hay que entrar como
 * el equipo y mirar lo que sale.
 *
 * Y sobre todo: que los avisos que enseña sean los ciertos. Una
 * pantalla que dice "todo bien" con algo roto es peor que no tenerla,
 * porque te fías de ella.
 *
 * ── UNA LECIÓN QUE COSTA ──
 *
 * La primera comprobación exigía ver el aviso de "url de ejemplo" del
 * bot_whatsapp. Cuando se arregló la url, el aviso dejó de salir y la
 * prueba falló — porque la pantalla estaba BIEN. Fallar porque ya no
 * hay un problema es peor que no comprobar: entrena a ignorar la
 * pantalla justo cuando empieza a avisar de algo nuevo.
 *
 * Por eso la de urls no mira un módulo en concreto: recorre el
 * catálogo y pregunta si ALGÚN módulo a la venta tiene una url que no
 * pueda funcionar. El criterio no cambia cuando cambian los datos.
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
const EMAIL = arg("--email", "admin@nexostudio.es");
const CLAVE = arg("--clave", process.env.DC || "");

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
console.log("=== La pantalla de salud, como la ve el equipo ===");
console.log("");
console.log("  panel: " + PANEL);
console.log("");

const db = createClient(
  env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } }
);

/* El catálogo. Se lee antes de pedir la página porque la comprobación
 * de urls necesita los datos, no el html. */
const { data: modulosCatalogo } = await db
  .from("modules")
  .select("id,url,disponible,retirado");

/* ── Sesión de staff ──
 * Se mete en `sessions` directamente, que es lo que hace
 * `crearSesion()`. Rol staff, porque la pantalla es del equipo. */
const { data: staff } = await db
  .from("profiles")
  .select("id,nombre,rol,activo")
  .eq("rol", "staff")
  .limit(1);

if (!staff || !staff.length) {
  console.log("  no hay ningún perfil de staff");
  process.exit(1);
}

const csrf = crypto.randomBytes(12).toString("hex");
const token = crypto.randomBytes(32).toString("hex");
const hash = crypto.createHash("sha256").update(token).digest("hex");

const { error: eIns } = await db.from("sessions").insert({
  token_hash: hash,
  user_id: staff[0].id,
  csrf_token: csrf,
  rol: "staff",
  creada_en: new Date().toISOString(),
  ultimo_acceso: new Date().toISOString(),
  expira_en: new Date(Date.now() + 600_000).toISOString(),
});

if (eIns) {
  console.log("  no se pudo crear la sesión: " + eIns.message);
  process.exit(1);
}

const r = await fetch(PANEL + "/panel/salud", {
  headers: { cookie: "nexo_panel=" + token },
  redirect: "manual",
});

const html = await r.text();

await db.from("sessions").delete().eq("csrf_token", csrf);

comprobar("la pantalla responde 200", r.status === 200, "HTTP " + r.status);

const texto = html
  .replace(/<script[\s\S]*?<\/script>/gi, "")
  .replace(/<style[\s\S]*?<\/style>/gi, "")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ")
  .trim();

/* ── Lo que tiene que verse ── */

comprobar("tiene el título", /Salud del sistema/i.test(texto));
comprobar("menciona los microservicios", /Microservicios/i.test(html));
comprobar("lista el módulo de inventario", /inventario/i.test(html));

/* El dinero: lo tiene que enseñar, porque no aparece en ninguna otra
 * pantalla y es lo único que no tiene arreglo técnico. */
const dinero = texto.match(/vencid[oa]s?[^.]*?\./i);
comprobar("enseña el dinero pendiente o vencido", !!dinero, dinero ? dinero[0].slice(0, 70) : "no aparece");

/* Las urls: el CRITERIO, no un dato. */
const aLaVenta = (modulosCatalogo || []).filter((m) => m.disponible && !m.retirado);
const EJEMPLO = /\.(example|test|invalid)$/i;
const conUrlMala = aLaVenta.filter((m) => !m.url || EJEMPLO.test(m.url));

comprobar(
  "ningún módulo a la venta tiene una url que no exista",
  conUrlMala.length === 0,
  conUrlMala.length
    ? conUrlMala.map((m) => m.id + (m.url ? " (" + m.url + ")" : " (sin url)")).join(", ")
    : aLaVenta.length + " a la venta, todos con url real"
);

/* Y lo que NO debe aparecer: los tres módulos están registrados, así
 * que no hay ningún "módulo sin microservicio detrás" que avisar. */
const fantasma = /no está en el registro|no esta en el registro/i.test(texto);
comprobar("no inventa módulos sin microservicio", !fantasma, fantasma ? "salta un aviso que no aplica" : "");

/* El md5 del secreto, que es la comparación que importa. */
const veMd5 = /secret_md5|md5 del secreto/i.test(texto);
comprobar("enseña la comparación de secretos", veMd5, "");

/* ── Lo que NO debe pasar ──
 *
 * Una pantalla de salud que revienta es peor que no tenerla: se deja
 * de mirar justo cuando hace falta. */
const reventada = /is not defined|Cannot read|undefined is not/i.test(texto);
comprobar("la plantilla NO revienta", !reventada, reventada ? "sale un error de EJS" : "");

const sinPlantilla = /Error 404|Esta pantalla no existe/i.test(texto);
comprobar("no cae en el 404", !sinPlantilla);

/* ── Que el panel sea solo del equipo ──
 *
 * Un cliente con sesión no debe verla. Se hace la misma sesión con rol
 * `client` y se comprueba que le echa. */
const { data: usuarios } = await db.auth.admin.listUsers({ page: 1, perPage: 20 });
const uCliente = usuarios?.users?.find((u) => u.email === "cliente@ejemplo.com") || usuarios?.users?.[0];

if (uCliente) {
  const csrf2 = crypto.randomBytes(12).toString("hex");
  const token2 = crypto.randomBytes(32).toString("hex");
  const hash2 = crypto.createHash("sha256").update(token2).digest("hex");

  /* sessions tiene clave foránea a auth.users: el user_id tiene que
   * existir de verdad. */
  await db.from("sessions").insert({
    token_hash: hash2,
    user_id: uCliente.id,
    csrf_token: csrf2,
    rol: "client",
    creada_en: new Date().toISOString(),
    ultimo_acceso: new Date().toISOString(),
    expira_en: new Date(Date.now() + 600_000).toISOString(),
  });

  const r2 = await fetch(PANEL + "/panel/salud", {
    headers: { cookie: "nexo_panel=" + token2 },
    redirect: "manual",
  });

  comprobar("un cliente NO entra", r2.status === 403, "HTTP " + r2.status);
  await db.from("sessions").delete().eq("csrf_token", csrf2);
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