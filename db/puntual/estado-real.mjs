/* Foto del estado actual: qué hay de verdad en la base.
 *
 * node db/estado-real.mjs
 *
 * ── PARA QUÉ ESTE ──
 *
 * Para decir qué le falta a un panel hay que saber primero qué está
 * pasando por ahí, no qué pantallas existen.
 *
 * Un panel con 19 pantallas puede estar perfecto y un panel con 12
 * puede tener un agujero: que el día 30 no haya forma de ver quién
 * debe qué.
 *
 * Así que esto pregunta a la base lo que un buen panel debería
 * poder contestar, y lo que hoy quizá no puede.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(import.meta.dirname, "..");
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

const { createClient } = require("@supabase/supabase-js");
const db = createClient(
  env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } }
);

const titulo = (t) => {
  console.log("");
  console.log("  " + t);
  console.log("  " + "-".repeat(t.length));
};

console.log("");
console.log("=== Lo que hay en la base ahora mismo ===");

/* ── Gente ── */
titulo("clientes");

const { data: clientes } = await db.from("clients").select("*").order("creado_en");

const activos = (clientes || []).filter((c) => !c.archivado);
const archivados = (clientes || []).filter((c) => c.archivado);

console.log("  total:          " + (clientes || []).length);
console.log("  activos:        " + activos.length);
console.log("  archivados:     " + archivados.length);

/* ¿Cuántos tienen al menos un servicio? Un cliente sin nada es
   ruido en el panel. */
let sinNada = 0;
const conServicios = new Set();

const { data: servicios } = await db.from("services").select("*");
for (const s of servicios || []) conServicios.add(s.client_id);

for (const c of activos) {
  if (!conServicios.has(c.id)) sinNada++;
}
console.log("  sin ningun servicio: " + sinNada);

/* ── Dinero ── */
titulo("cobros");

const { data: cobros } = await db.from("cobros").select("*");
const hoy = new Date().toISOString().slice(0, 10);

const vencidos = (cobros || []).filter((c) => c.estado === "pendiente" && c.vence_en < hoy);
const porPagar = (cobros || []).filter((c) => c.estado === "pendiente");
const pagados = (cobros || []).filter((c) => c.estado === "pagado");

const suma = (lista) => lista.reduce((s, c) => s + (Number(c.importe) || 0), 0);

console.log("  total:          " + (cobros || []).length);
console.log("  pendientes:     " + porPagar.length + "   (" + suma(porPagar) + ")");
console.log("  VENCIDOS:       " + vencidos.length + "   (" + suma(vencidos) + ")");
console.log("  pagados:        " + pagados.length + "   (" + suma(pagados) + ")");

if (vencidos.length) {
  console.log("");
  console.log("  los que mas tiempo llevan sin pagar:");
  const ordered = vencidos
    .slice()
    .sort((a, b) => a.vence_en.localeCompare(b.vence_en))
    .slice(0, 5);
  for (const c of ordered) {
    const nombre = (clientes || []).find((x) => x.id === c.client_id)?.nombre || "?";
    const dias = Math.floor((Date.now() - new Date(c.vence_en)) / 86400000);
    console.log("    " + String(dias).padStart(4) + " dias   " + String(c.importe).padStart(9) + "   " + nombre.slice(0, 26));
  }
}

/* ── Vencimientos ── */
titulo("servicios");

const { data: todosServicios } = await db.from("services").select("*");
const porEstado = {};
for (const s of todosServicios || []) {
  porEstado[s.estado] = (porEstado[s.estado] || 0) + 1;
}
console.log("  total:          " + (todosServicios || []).length);
for (const [k, v] of Object.entries(porEstado).sort()) {
  console.log("  " + (k || "(sin estado)").padEnd(22) + v);
}

/* Los que caducan pronto: es la pregunta que un panel tiene que
   poder contestar y que no se ve en ninguna pantalla. */
const en30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
const caducan = (todosServicios || []).filter(
  (s) => s.termina_en && s.termina_en <= en30 && s.estado === "activo"
);
console.log("  caducan en 30 dias: " + caducan.length);
for (const s of caducan.slice(0, 5)) {
  const nombre = (clientes || []).find((x) => x.id === s.client_id)?.nombre || "?";
  console.log("    " + s.termina_en + "   " + nombre.slice(0, 30));
}

/* ── Gente que entra ── */
titulo("acceso");

const { data: accesos } = await db.from("accesos").select("*");
console.log("  accesos:        " + (accesos || []).length);
const roles = {};
for (const a of accesos || []) roles[a.rol] = (roles[a.rol] || 0) + 1;
for (const [k, v] of Object.entries(roles)) console.log("  " + (k || "(sin rol)").padEnd(22) + v);

/* ── Consultas ── */
titulo("consultas");

const rCons = await db.from("consultas").select("*");
const consultas = rCons.data;
if (rCons.error) {
  console.log("  la tabla 'consultas' no existe o no se puede leer");
  console.log("  error: " + rCons.error.message);
}
if (consultas) {
  const estados = {};
  for (const c of consultas) estados[c.estado] = (estados[c.estado] || 0) + 1;
  console.log("  total:          " + consultas.length);
  for (const [k, v] of Object.entries(estados).sort()) {
    console.log("  " + (k || "(sin estado)").padEnd(22) + v);
  }
}

/* ── Modulos ── */
titulo("modulos");

const { data: modulos } = await db.from("modules").select("*").order("id");
for (const m of modulos || []) {
  console.log(
    "  " + String(m.id).padEnd(16) +
    String(m.precio).padStart(5) + "   " +
    (m.retirado ? "retirado" : m.disponible ? "a la venta" : "oculto") +
    "   url: " + (m.url || "(ninguna)")
  );
}

console.log("");
console.log("=".repeat(56));
console.log("");
process.exit(0);