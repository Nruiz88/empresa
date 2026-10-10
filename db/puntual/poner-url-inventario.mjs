/* Poner la URL publica de inventario en el panel.
 *
 * node poner-url.js
 *
 * Se hace por script y no con un -e en linea por una razon concreta:
 * el valor se pasa por linea de ordenes en el otro caso, y esa es
 * justo la forma de que un caracter se comido sin que se note.
 * Aqui el valor esta en el fichero, se lee de las variables del
 * panel, y el unico dato escrito a mano es el dominio.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const RAIZ = path.resolve(import.meta.dirname, "..");

/* El panel carga sus variables solo al arrancar el servidor, asi que
   aqui se leen del fichero directamente. */
function leerEnv(ruta) {
  const s = {};
  if (!fs.existsSync(ruta)) return s;
  for (const l of fs.readFileSync(ruta, "utf8").split(/\r?\n/)) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) s[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return s;
}

const env = leerEnv(path.join(RAIZ, ".env"));

const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const clave = env.SUPABASE_SECRET_KEY;

if (!url || !clave) {
  console.log("  faltan las variables del panel");
  process.exit(1);
}

const DOMINIO = "https://inventario.panel-niconqn.duckdns.org";
const MODULO = "inventario";

const db = createClient(url, clave, { auth: { persistSession: false } });

const { data: antes, error: e1 } = await db
  .from("modules")
  .select("id,nombre,url,precio,disponible,retirado")
  .eq("id", MODULO)
  .single();

if (e1) {
  console.log("  no se pudo leer el modulo: " + e1.message);
  process.exit(1);
}

console.log(`  ${antes.nombre}  (${antes.precio})`);
console.log(`  url antes:  ${antes.url || "(ninguna)"}`);

/* Si ya estaba puesta, no se toca. Reescribirla sin motivo cambia el
   updated_at y ensucia el historial del panel. */
if (antes.url === DOMINIO) {
  console.log(`  url:        ya era ${DOMINIO}`);
  console.log("\n  nada que hacer");
  process.exit(0);
}

const { error: e2 } = await db.from("modules").update({ url: DOMINIO }).eq("id", MODULO);

if (e2) {
  console.log("  no se pudo actualizar: " + e2.message);
  process.exit(1);
}

const { data: despues, error: e3 } = await db
  .from("modules")
  .select("id,nombre,url,precio,disponible")
  .eq("id", MODULO)
  .single();

if (e3) {
  console.log("  se actualizo pero no se pudo releer: " + e3.message);
  process.exit(1);
}

console.log(`  url despues: ${despues.url}`);

/* Que el modulo siga a la venta. Si estuviera retirado, el boton no
   sale y el cambio de url no sirve de nada. */
console.log(`  a la venta: ${despues.disponible ? "si" : "NO"}`);
console.log("\n  listo: el boton Abrir ya apunta al servicio");