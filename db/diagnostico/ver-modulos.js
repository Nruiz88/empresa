// Qué hay hoy en la tabla `modules`: estructura y filas.
//
// ── POR QUÉ ESTO ──
//
// El panel ya tiene una pantalla de catálogo donde se editan módulos con
// su precio y su moneda, y hay una migración que dice, textual, que la
// página pública /precios NO lee de esa tabla: sus cifras estaban
// escritas a mano.
//
// El plan es que los precios de Shopcito se gestionan desde el
// panel. Antes de decidir si los tres planes pueden vivir en `modules`
// o necesitan su propia tabla, hay que ver qué hay.
//
// Y hay que mirar los dos cosas que decides si la tabla sirve:
//
//   1. La FORMA: ¿tiene sitio para una lista de 특징 y para marcar
//      cuál es el recomendado? Un módulo es algo que se le añade a un
//      cliente. Un plan es el producto completo, con sus tres niveles.
//
//   2. Lo que HAY dentro: si hay filas de demo con precios en euros,
//      mezclarlas con los planes sería meter datos falsos en la
//      pantalla donde el cliente decide.

require("../../lib/env").load();
const db = require("../../lib/supabase").getAdmin();

(async () => {
  const { data: columnas, error: e1 } = await db.rpc
    ? { data: null, error: null }
    : { data: null, error: null };

  /* El RPC no siempre existe, así que se pregunta por information_schema
     con una consulta directa. */
  const info = await fetch(
    process.env.SUPABASE_URL + "/rest/v1/rpc/executar_sql",
    {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SECRET_KEY,
        Authorization: "Bearer " + process.env.SUPABASE_SECRET_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql: "EXECUTAR" }),
    }
  ).catch(() => null);

  /* Si el RPC de SQL no está, se va por PostgREST: una consulta a la
     propia tabla con limit=0 trae las columnas en la cabecera. */
  const r = await fetch(process.env.SUPABASE_URL + "/rest/v1/modules?limit=1", {
    headers: {
      apikey: process.env.SUPABASE_SECRET_KEY,
      Authorization: "Bearer " + process.env.SUPABASE_SECRET_KEY,
      Prefer: "count=exact",
    },
  });

  console.log("=== estructura de modules ===");
  console.log("  HTTP " + r.status);

  if (!r.ok) {
    const t = await r.text();
    console.log("  " + t.slice(0, 200));
    console.log("");
    console.log("  La tabla no se pudo leer por PostgREST. Puede que no exista,");
    console.log("  o que las claves del .env no sean las de esta base.");
    return;
  }

  const claves = [...r.headers.keys()].filter((k) => k.startsWith("content-range"));
  console.log("  filas: " + (claves[0] || "?"));

  const filas = await r.json();
  if (filas.length) console.log("  columnas: " + Object.keys(filas[0]).join(", "));

  console.log("");
  console.log("=== filas ===");
  const { data: todas } = await db.from("modules").select("*").order("nombre");
  (todas || []).forEach((m) => {
    console.log(
      "  " + String(m.nombre || "(sin nombre)").padEnd(22) +
      String(m.precio !== null && m.precio !== undefined ? m.precio : "-").padStart(8) +
      "  " + (m.moneda || "?") +
      "  activo=" + (m.activo === undefined ? "?" : m.activo) +
      "  id=" + String(m.id).slice(0, 8)
    );
  });

  if (!todas || !todas.length) console.log("  (ninguna)");
})();