/* Inventario de los precios que siguen en euros.

   No los cambio: los importes son del estudio y no son mios. Pero si
   quedan en euros en una web argentina, eso es un dato publico
   equivocado, y lo unico que no se puede hacer es dejarlo pasar en
   silencio.

   Este script no modifica nada: cuenta y lista. Sirve para responder
   a "que queda pendiente" con numeros y no de memoria. */
const fs = require("fs");

const NL = String.fromCharCode(10);
const env = {};
for (const l of fs.readFileSync(".env", "utf8").split(NL)) {
  const t = l.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
void env;

const { createClient } = require("@supabase/supabase-js");

(async () => {
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

  console.log("=== 1. CATALOGO PUBLICO (content/precios.js) ===");
  const precios = require("../content/precios.js");
  console.log("  MONEDA declarada: " + precios.MONEDA);
  console.log("  MONEDA, que es lo que se imprime en cada plan: " + (precios.MONEDA && precios.MONEDA.simbolo ? precios.MONEDA.simbolo : JSON.stringify(precios.MONEDA)));
  precios.PROYECTOS.forEach((p) => {
    console.log("  proyecto  " + String(p.precio).padStart(7) + "  " + p.nombre);
  });
  precios.MANTENIMIENTO.forEach((p) => {
    console.log("  recurrente" + String(p.precio).padStart(7) + "  " + p.nombre);
  });

  console.log("");
  console.log("=== 2. MODULOS (la tabla modules, lo que edita /panel/catalogo) ===");
  const { data: mods } = await db.from("modules").select("id,nombre,precio,moneda,disponible").order("id");
  let enEuro = 0;
  let sinPrecio = 0;
  (mods || []).forEach((m) => {
    if (m.precio === null || m.precio === undefined) {
      sinPrecio++;
      console.log("  SIN PRECIO   " + String(m.id).padEnd(22) + m.nombre + (m.disponible ? "  [a la venta]" : ""));
      return;
    }
    if (m.moneda === "EUR") {
      enEuro++;
      console.log("  EN EUROS     " + String(m.id).padEnd(22) + String(m.precio).padStart(10) + "  " + m.nombre + (m.disponible ? "  [a la venta]" : ""));
    } else {
      console.log("  ok           " + String(m.id).padEnd(22) + String(m.precio).padStart(10) + " " + (m.moneda || "?") + "  " + m.nombre);
    }
  });
  console.log("  ---");
  console.log("  en euros: " + enEuro + "   sin precio: " + sinPrecio + "   total: " + (mods || []).length);

  console.log("");
  console.log("=== 3. SERVICIOS DE CLIENTES (la tabla services) ===");
  const { data: serv } = await db.from("services").select("id,titulo,importe,moneda,estado").order("creado_en", { ascending: false });
  const porMoneda = {};
  (serv || []).forEach((s) => {
    if (s.importe === null || s.importe === undefined) return;
    const m = s.moneda || "(sin moneda)";
    porMoneda[m] = (porMoneda[m] || 0) + 1;
  });
  Object.entries(porMoneda).forEach(([m, n]) => console.log("  " + m.padEnd(12) + n + " servicios"));
  const euro = (serv || []).filter((s) => s.moneda === "EUR" && s.importe !== null);
  euro.forEach((s) => console.log("    EN EUROS: " + String(s.importe).padStart(10) + "  " + s.titulo));

  console.log("");
  console.log("=== 4. UMBRALES DE LAS CONDICIONES (no son de catalogo) ===");
  const cond = fs.readFileSync("views/condiciones.ejs", "utf8");
  const eur = cond.match(/[^\n]*\u20AC[^\n]*/g) || [];
  eur.forEach((l) => console.log("  " + l.trim().replace(/<[^>]+>/g, "").slice(0, 84)));

  process.exit(0);
})();