/* Que clientes tienen cada módulo, y si el catálogo lo puede cambiar.
 *
 * node db/quien-tiene-modulos.mjs
 *
 * ── PARA QUÉ ESTE ──
 *
 * `bot_whatsapp` está a la venta con una url de ejemplo y
 * `reservas_web` sin url. tempting: quitarles `disponible` y dejar de
 * announcecerlos.
 *
 * PERO hay clientes que los tienen contratados. Marina Soler paga
 * "Reservas de mesa online" y su cuota está vencida. Si quitar el
 * módulo del catálogo le tocara el acceso, estaríamos arreglando una
 * cosa rompiendo otra.
 *
 * La regla de acceso es `tiene_modulo()`, que lee de `suscripciones`
 * y NO de `modules.disponible`. Eso es lo que hay que comprobar
 * antes de tocar el catálogo, no suponerlo.
 */
import fs from "node:fs";
import path from "node:path";

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

const { createClient } = await import("@supabase/supabase-js");
const db = createClient(
  env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } }
);

console.log("");
console.log("=== Quién tiene cada módulo, y qué se puede tocar ===");
console.log("");

const { data: modulos } = await db.from("modules").select("*").order("id");
const { data: clientes } = await db.from("clients").select("id,nombre,empresa");
const { data: suscripciones } = await db.from("suscripciones").select("*");

const nombreDe = (id) => {
  const c = (clientes || []).find((x) => x.id === id);
  return c ? c.nombre || c.empresa : "(desconocido)";
};

for (const m of modulos || []) {
  const suyas = (suscripciones || []).filter((s) => s.module_id === m.id);
  const hoy = new Date().toISOString().slice(0, 10);

  /* Lo que de verdad decide el acceso. */
  const conAcceso = suyas.filter(
    (s) =>
      ["activo", "prueba"].includes(s.estado) &&
      s.inicia_en <= hoy &&
      (!s.termina_en || s.termina_en >= hoy)
  );

  console.log("  " + m.id);
  console.log("    " + m.nombre);
  console.log("    precio:      " + m.precio);
  console.log("    en venta:    " + (m.retirado ? "RETIRADO" : m.disponible ? "si" : "no"));
  console.log("    url:         " + (m.url || "(ninguna)"));
  console.log("    suscripciones: " + suyas.length + "   con acceso hoy: " + conAcceso.length);

  for (const s of suyas) {
    const vence = s.termina_en ? (s.termina_en < hoy ? "CADUCADA el " + s.termina_en : "hasta " + s.termina_en) : "sin fecha";
    console.log("      " + String(s.estado).padEnd(10) + String(nombreDe(s.client_id)).slice(0, 28).padEnd(30) + vence);
  }

  /* Si tiene gente dentro, quitarlo del catálogo NO les quita el
     acceso. Y si no tiene a nadie, quitarlo no le hace daño a nadie.
     Por eso esto se puede tocar sin miedo — pero hay que saberlo
     antes, no después. */
  console.log(
    "    → " +
      (conAcceso.length > 0
        ? "OCULTO del catálogo NO les quita el acceso (tiene_modulo lee de suscripciones)"
        : "no tiene a nadie: quitarlo del catálogo no afecta a ninguna suscripción")
  );
  console.log("");
}

console.log("=".repeat(56));
console.log("");