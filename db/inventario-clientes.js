require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

/* =========================================================
   Shopcito - Inventario de clientes, para decidir qué es prueba
   ------------------------------------------------------------
   Por qué existe: el script de borrado borra todo lo que no sea el
   admin, y entre eso está `adri.ruiz.nqn@gmail.com`, que es un
   cliente real. Este script solo mira y escribe. Nada se borra aquí.
   ========================================================= */

const MARCAS_PRUEBA = ["test", "prueba", "demo", "ejemplo", "example", "fixture", "seed"];

const esDePrueba = (v) => {
  const t = String(v || "").toLowerCase();
  return MARCAS_PRUEBA.some((m) => t.includes(m));
};

(async () => {
  /* La tabla se llama `clients`, la fecha es `creado_en` y no hay
     columna `cuit`. La primera versión de este script decía
     `clientes`, `created_at` y pedía `cuit`, y falló con un error que
     parecía de conexión y no de nombre de columna. */
  const { data: clientes, error } = await db
    .from("clients")
    .select("id, nombre, empresa, email, telefono, archivado, creado_en")
    .order("creado_en");

  if (error) throw error;

  console.log("\n═══ Inventario de clientes ═══\n");
  console.log("  " + clientes.length + " clientes\n");

  const pruebas = [];
  const reales = [];

  for (const c of clientes) {
    if (esDePrueba(c.empresa) || esDePrueba(c.email) || esDePrueba(c.nombre)) {
      pruebas.push(c);
    } else {
      reales.push(c);
    }
  }

  console.log("  ── REALES (no tocar) ──\n");
  for (const c of reales) {
    console.log("    " + String(c.empresa || "(sin empresa)").padEnd(28) + (c.email || "-"));
  }

  console.log("\n  ── DE PRUEBA (borrables) ──\n");
  for (const c of pruebas) {
    console.log(
      "    " +
        String(c.empresa || "(sin empresa)").padEnd(28) +
        String(c.email || "-").padEnd(34) +
        (c.creado_en || "").slice(0, 10)
    );
  }

  console.log("\n  ──────────────────────────────────────────────");
  console.log("  reales:  " + reales.length);
  console.log("  prueba:  " + pruebas.length);
  console.log("\n  Para borrar SOLO los de prueba:");
  console.log("      node db/borrar-pruebas-clientes.js\n");
})();