/* Dejar el registro de microservicios Saying la verdad.
 *
 * node db/actualizar-registro.mjs
 *
 * ── POR QUÉ ──
 *
 * El registro se creó con lo que se sabía al principio, y desde
 * entonces cambiaron dos cosas:
 *
 *   · `bot_whatsapp` estaba con una url de ejemplo. Ahora apunta a su
 *     dominio real, que está desplegado y responde en /entrar. Y como
 *     funciona, deja de estar inactivo.
 *
 *   · `reservas_web` no tiene software detrás. Sigue sin tenerlo, así
 *     que sigue inactivo — pero ahora el CATÁLOGO ya no lo anuncia,
 *     que es otra cosa.
 *
 * El registro y el catálogo se contradicen si no se actualizan los
 * dos: el catálogo diría que no se vende y el registro que sí.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

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

const db = createClient(
  env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } }
);

/* Lo que debería decir el registro. */
const ESPERADO = [
  {
    modulo: "inventario",
    nombre: "Gestión de inventario",
    url_base: "https://inventario.panel-niconqn.duckdns.org",
    activo: true,
    nota: "Next.js 16 standalone. Entrada por /entrar, canje de ticket. Tiene /api/salud.",
  },
  {
    modulo: "bot_whatsapp",
    nombre: "Bot de WhatsApp",
    url_base: "https://bot.empresa.panel-niconqn.duckdns.org",
    activo: true,
    nota:
      "Desplegado. OJO: su raíz da 404 y no es un fallo — no tiene página de " +
      "inicio porque a él se entra por /entrar, que es la ruta que construye el panel.",
  },
  {
    modulo: "reservas_web",
    nombre: "Reservas web",
    url_base: "",
    activo: false,
    nota:
      "Sin software detrás. Se sacó de la venta en el catálogo. Los que ya lo " +
      "tienen contratado siguen entrando: el acceso lo decide tiene_modulo().",
  },
];

console.log("");
console.log("=== El registro de microservicios ===");
console.log("");

const { data: antes } = await db.from("microservicios").select("modulo,url_base,activo").order("modulo");

for (const r of antes || []) {
  console.log(
    "  " + String(r.modulo).padEnd(15) +
    String(r.url_base || "(sin url)").padEnd(46) +
    (r.activo ? "activo" : "inactivo")
  );
}

console.log("");
console.log("=== Actualizando ===");
console.log("");

for (const e of ESPERADO) {
  const { error } = await db.from("microservicios").update(e).eq("modulo", e.modulo);

  if (error) {
    console.log("  ✗ " + e.modulo + ": " + error.message);
    continue;
  }
  console.log("  ✓ " + e.modulo);
}

console.log("");
console.log("=== Después ===");
console.log("");

const { data: despues } = await db
  .from("microservicios")
  .select("modulo,url_base,activo")
  .order("modulo");

for (const r of despues || []) {
  console.log(
    "  " + String(r.modulo).padEnd(15) +
    String(r.url_base || "(sin url)").padEnd(46) +
    (r.activo ? "activo" : "inactivo")
  );
}

/* ── Que el registro y el catálogo no se contradigan ──
 *
 * Un módulo que el catálogo anuncia y no tiene nada detrás es un
 * cliente pagando por nada. Y uno que el catálogo no anuncia pero el
 * registro dice que está desplegado, no pasa nada, pero confunde a
 * quien lee la pantalla.
 *
 * Se comprueba con el mismo criterio que usa la pantalla de salud. */
console.log("");
console.log("=== ¿El registro y el catálogo se contradicen? ===");
console.log("");

const { data: modulos } = await db.from("modules").select("id,url,disponible,retirado");

const contradicciones = [];

for (const m of modulos || []) {
  const reg = (despues || []).find((r) => r.modulo === m.id);
  const EJEMPLO = /\.(example|test|invalid)$/i;

  if (m.disponible && !m.retirado) {
    if (!m.url || EJEMPLO.test(m.url)) {
      contradicciones.push(m.id + ": a la venta con una url que no existe");
    }
    if (!reg || !reg.activo) {
      contradicciones.push(m.id + ": a la venta pero sin software detrás en el registro");
    }
  }
}

if (contradicciones.length === 0) {
  console.log("  ✓ no se contradicen");
} else {
  for (const c of contradicciones) console.log("  ✗ " + c);
}

console.log("");
console.log("=".repeat(56));
console.log("");
process.exit(contradicciones.length ? 1 : 0);