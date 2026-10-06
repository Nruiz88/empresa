/* Forzar el camino de "no tengo access_token", que es el que rompia.
 *
 * node db/probar-camino-sin-token.mjs
 *
 * ── POR QUÉ HACE FALTA ──
 *
 * `mis-servicios` se renderiza en dos sitios:
 *
 *   · el normal, cuando la sesión trae access_token
 *   · el de error (503), cuando no lo trae
 *
 * El segundo solo se ve cuando caduca el token de Supabase, que es
 * de hora en hora. Y no llevaba dos variables que la plantilla usa
 * sin comprobar nada, así que EJS reventaba:
 *
 *   esStaff is not defined
 *   nombreCliente is not defined
 *
 * El cliente veía un error de servidor en vez del mensaje que le
 * dice "vuelve a entrar".
 *
 * Aquí se reproduce ese camino a proposito, para que no dependa de
 * que a alguien se le caduque el token dentro de una hora.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(import.meta.dirname, "..");
const NL = String.fromCharCode(10);

const BASE = process.env.PANEL_URL || "http://127.0.0.1:3000";

const env = {};
if (fs.existsSync(path.join(RAIZ, ".env"))) {
  for (const l of fs.readFileSync(path.join(RAIZ, ".env"), "utf8").split(NL)) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}

const { createClient } = require("@supabase/supabase-js");
const db = createClient(
  env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } }
);

let ok = 0;
let fallos = 0;

const comprobar = (txt, cond, extra) => {
  console.log("  " + (cond ? "OK  " : "FALLA") + "  " + txt + (extra ? "  " + extra : ""));
  if (cond) ok++;
  else fallos++;
};

console.log("");
console.log("=== El camino sin access_token, a proposito ===");
console.log("");

/* Un usuario real: sessions tiene clave foranea a auth.users. */
const { data: usuarios, error: eUs } = await db.auth.admin.listUsers({ page: 1, perPage: 10 });
if (eUs || !usuarios?.users?.length) {
  console.log("  no se pudo listar usuarios: " + (eUs?.message || "vacio"));
  process.exit(1);
}

const user = usuarios.users.find((u) => u.email === "cliente@ejemplo.com") || usuarios.users[0];
console.log("  usuario: " + user.email);
console.log("");

const csrf = crypto.randomBytes(12).toString("hex");
const token = crypto.randomBytes(32).toString("hex");
const hash = crypto.createHash("sha256").update(token).digest("hex");

/* La fila va SIN access_token y SIN refresh_token. Eso es lo que
 * hace que `req.sesion.access_token` sea falso y se entre por el
 * camino del 503. */
const { error: eIns } = await db.from("sessions").insert({
  token_hash: hash,
  user_id: user.id,
  csrf_token: csrf,
  rol: "client",
  access_token: null,
  refresh_token: null,
  creada_en: new Date().toISOString(),
  ultimo_acceso: new Date().toISOString(),
  expira_en: new Date(Date.now() + 600_000).toISOString(),
});

comprobar("se crea una sesion sin token", !eIns, eIns ? eIns.message : "insertada");

const r = await fetch(BASE + "/panel/mis-servicios", {
  headers: { cookie: "nexo_panel=" + token },
  redirect: "manual",
});

const html = await r.text();

await db.from("sessions").delete().eq("csrf_token", csrf);

/* ── Lo que importa ──
 *
 * Un 503 es lo CORRECTO: la sesión no se puede reconstruir, y decirlo
 * con un 503 es honesto.
 *
 * Lo que no vale es que además reviente la plantilla. Entonces el
 * cliente recibe un error de servidor en vez de "vuelve a entrar". */
const es503 = r.status === 503;
comprobar("responde 503, no 500", es503, "HTTP " + r.status);

const revienta = /is not defined/.test(html);
comprobar("la plantilla NO revienta", !revienta, revienta ? "sale un 'is not defined'" : "");

const texto = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const avisa = /vuelve a entrar|sesión no se pudo reconstruir|no se pudo reconstruir/i.test(texto);
comprobar("y el cliente ve el mensaje de reentrar", avisa, avisa ? texto.match(/[^.]*vuelve a entrar[^.]*\./i)?.[0]?.slice(0, 80) : "");

console.log("");
console.log("=".repeat(54));
if (fallos) {
  console.log("FALLAN " + fallos + " de " + (ok + fallos));
  console.log("");
  process.exit(1);
}
console.log("Los " + ok + " pasos pasan. El camino sin token no rompe la pagina.");
console.log("");
process.exit(0);