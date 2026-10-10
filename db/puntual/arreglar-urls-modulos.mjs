/* Arreglar las direcciones de los módulos del catálogo.
 *
 * node db/arreglar-urls-modulos.mjs
 *
 * ── QUÉ ESTÁ MAL Y QUÉ SE HACE ──
 *
 * `bot_whatsapp` estaba a la venta con:
 *
 *     https://proveedor-externo.example
 *
 * que es un dominio de ejemplo de la documentación de RFC 2606. No
 * existe. La cosa buena es que el bot SÍ está desplegado y funciona:
 *
 *     Bot Empresa  ygkmu2b2tcydixxvssqzgd4s  running:healthy
 *       https://bot.empresa.panel-niconqn.duckdns.org/entrar   200
 *
 * Ojo con la comprobación: la RAÍZ de ese dominio da 404, y parece
 * que el bot no esté desplegado. No lo está: el bot no tiene página
 * de inicio, porque a él se entra por `/entrar`, que es la ruta que
 * construye el panel. Probar `/` y concluir que está roto es
 * confundir "no tiene inicio" con "no funciona".
 *
 * `reservas_web` no tiene url y no hay ninguna app detrás. No es que
 * apunte a algo roto: es que no hay nada. Por eso no se le inventa
 * una dirección, sino que se saca de la venta.
 *
 * ── POR QUÉ TOCAR EL CATÁLOGO NO QUITA EL ACCESO A NADIE ──
 *
 * Marina Soler tiene suscripciones a los tres módulos. Si quitar un
 * módulo del catálogo le tocara el acceso, esto sería un desastre
 * dentro de otro.
 *
 * No lo es: la regla de acceso es la función `tiene_modulo()`, que
 * lee de `suscripciones` y en ningún sitio mira `modules.disponible`.
 * `disponible` decide si se anuncia a alguien nuevo; `suscripciones`
 * decide quién entra. Son dos cosas distintas y aquí solo se toca la
 * primera.
 *
 * Verificado antes de tocar nada, con db/quien-tiene-modulos.mjs.
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

/* ── Lo que hay que dejar ──
 *
 * `url` es la que responde. La de inventario se queda igual, que ya
 * está bien.
 *
 * `disponible` en false solo para reservas_web: no hay software, así
 * que anunciarlo es vender algo que no existe. */
const CAMBIOS = [
  {
    id: "bot_whatsapp",
    cambios: { url: "https://bot.empresa.panel-niconqn.duckdns.org" },
    porque:
      "Estaba con una url de ejemplo (proveedor-externo.example). El bot " +
      "está desplegado y su /entrar responde 200.",
  },
  {
    id: "reservas_web",
    cambios: { disponible: false },
    porque:
      "No hay url ni software detrás. Se saca de la venta en vez de " +
      "inventarle una dirección. Los que ya lo tienen contratado no se " +
      "ven afectados: el acceso lo decide tiene_modulo(), que lee de " +
      "suscripciones.",
  },
];

console.log("");
console.log("=== Antes ===");
console.log("");

const { data: antes } = await db.from("modules").select("id,url,disponible,retirado").order("id");
for (const m of antes || []) {
  console.log(
    "  " + String(m.id).padEnd(15) +
    String(m.url || "(sin url)").padEnd(46) +
    (m.retirado ? "retirado" : m.disponible ? "a la venta" : "oculto")
  );
}

/* ── Que nadie haya perdido el acceso ──
 *
 * Se mide ANTES y se vuelve a medir DESPUÉS, y se comparan. Decir
 * "no afecta" sin comprobarlo es exactamente el tipo de cosa que en
 * este proyecto ha salido cara.
 *
 * La primera versión comparaba contra `c.__antes`, una propiedad que
 * nunca se rellenaba: daba cero perdidos siempre, que es lo mismo que
 * no comprobar nada pero con la-appearance de haber comprobado. */
console.log("");
console.log("=== Acceso a cada módulo, ANTES ===");
console.log("");

const { data: clientes } = await db.from("clients").select("id,nombre");

const antesDe = {};

for (const c of clientes || []) {
  for (const m of antes || []) {
    const { data: tiene } = await db.rpc("tiene_modulo", {
      cliente_uuid: c.id,
      modulo: m.id,
    });
    if (tiene === true) antesDe[c.id + "/" + m.id] = (c.nombre || "").slice(0, 22);
  }
}

console.log("  " + Object.keys(antesDe).length + " combinaciones con acceso ahora mismo");
for (const [k, nombre] of Object.entries(antesDe)) {
  console.log("    " + k.split("/")[1].padEnd(15) + nombre);
}

/* ── Y ahora sí, el cambio ── */
console.log("");
console.log("=== Aplicando ===");
console.log("");

for (const c of CAMBIOS) {
  const { error } = await db.from("modules").update(c.cambios).eq("id", c.id);

  if (error) {
    console.log("  ✗ " + c.id + ": " + error.message);
    continue;
  }

  console.log("  ✓ " + c.id);
  console.log("      " + c.porque);
}

console.log("");
console.log("=== Después ===");
console.log("");

const { data: despues } = await db.from("modules").select("id,url,disponible,retirado").order("id");
for (const m of despues || []) {
  console.log(
    "  " + String(m.id).padEnd(15) +
    String(m.url || "(sin url)").padEnd(46) +
    (m.retirado ? "retirado" : m.disponible ? "a la venta" : "oculto")
  );
}

console.log("");
console.log("=== ¿Alguien perdió el acceso? ===");
console.log("");

let perdidos = 0;

for (const [k, nombre] of Object.entries(antesDe)) {
  const [cid, modulo] = k.split("/");
  const { data: tiene } = await db.rpc("tiene_modulo", {
    cliente_uuid: cid,
    modulo,
  });

  if (tiene !== true) {
    console.log("  ✗ " + nombre + " PIERDE " + modulo);
    perdidos++;
  }
}

if (perdidos === 0) {
  console.log("  ✓ los " + Object.keys(antesDe).length + " accesos siguen intactos");
}

console.log("");
console.log("=".repeat(56));
console.log("");
process.exit(perdidos ? 1 : 0);