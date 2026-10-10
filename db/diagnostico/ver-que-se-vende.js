require("../../lib/env").load();
const db = require("../../lib/supabase").getAdmin();

/* ═══════════════════════════════════════════════════════════════
   POR QUÉ UNA APLICACIÓN CON PRECIO DICE QUE NO SE VENDE

   ── EL DESCUBRIMIENTO ──

   `activo` no significa «lo estoy vendiendo». Significa **«el
   microservicio está encendido y responde»**. Es un campo de
   infraestructura, de la pantalla de salud, no de venta.

   Vivía en `microservicios`, que nació para preguntar «¿responde este
   servicio?». Cuando se le añadió la venta, se le reutilizó ese campo
   para decir si el producto se comercializa, y un campo que medía
   otra cosa acabó decidiendo qué se puede vender.

   El resultado es exactamente el que viste: pones el precio de
   inventario, la aplicación queda con precio y con stock, y en Planes
   dice «no se está vendiendo» — porque el microservicio de
   inventario no está levantado en ningún servidor.

   ── LAS DOS COSAS QUE SON DISTINTAS ──

     activo       ¿responde el microservicio?   infraestructura
     vendible     ¿lo estoy vendiendo?           negocio

   Un producto puede estar vendible y apagado: se anuncia y todavía
   no se instala. Y uno puede estar encendido y no vendible: está en
   pruebas y no se anuncia. Hoy no se puede expresar ninguna de las
   dos, porque hay un solo campo.

   ── LO QUE SE COMPRUEBA AQUÍ ──

   Que los tres microservicios tienen `activo` en falso, y si además
   tienen precio y stock puestos. Eso confirma que el problema es el
   campo y no otra cosa.
   ═══════════════════════════════════════════════════════════════ */

(async () => {
  const { data: micros, error } = await db
    .from("microservicios")
    .select("modulo, nombre, activo, vendible, precio, moneda");

  if (error) {
    console.log("  no se pudo leer: " + error.message);
    process.exit(0);
  }

  const { data: mods } = await db.from("modules").select("id, nombre");
  const nombreDe = new Map((mods || []).map((m) => [m.id, m.nombre]));

  console.log("\n═══ Los microservicios ═══\n");
  console.log(
    "  " + "módulo".padEnd(16) + "activo".padStart(8) +
    "vendible".padStart(10) + "precio".padStart(10) + "   nombre"
  );
  console.log("");

  for (const m of micros || []) {
    console.log(
      "  " + String(m.modulo).padEnd(16) +
      String(m.activo === false ? "FALSO" : String(m.activo)).padStart(8) +
      String(m.vendible ? "sí" : "no").padStart(10) +
      String(m.precio === null || m.precio === undefined ? "—" : m.precio).padStart(10) +
      "   " + (nombreDe.get(m.modulo) || m.nombre)
    );
  }

  /* ── CUÁNTAS APLICACIONES APARECEN EN PLANES ── */

  const { data: planes } = await db
    .from("plans")
    .select("nombre, aplicaciones, activo");

  console.log("\n═══ Los planes ═══\n");

  for (const p of (planes || []).sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""))) {
    const apps = Array.isArray(p.aplicaciones) ? p.aplicaciones : [];
    console.log(
      "  " + String(p.nombre).padEnd(12) +
      (p.activo ? "visible " : "oculto  ") +
      (apps.length ? apps.join(", ") : "sin aplicaciones marcadas")
    );
  }

  /* ── EL DIAGNÓSTICO ── */

  const apagados = (micros || []).filter((m) => !m.activo);

  console.log("\n═══ ═══\n");
  console.log(
    "  " + apagados.length + " microservicios con activo = falso de " +
    (micros || []).length + "."
  );
  console.log("");
  console.log("  Esos son los que Planes muestra como «no se está vendiendo»,");
  console.log("  y el motivo es que `activo` es de la pantalla de salud:");
  console.log("  dice si el servicio responde, no si lo estás vendiendo.");
  console.log("");

  process.exit(0);
})();