require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

/* ¿Quedó algo en `audit_log` del alta?

   ── POR QUÉ ESTO NO ESTÁ EN EL TEST ──

   Porque la auditoría va dentro de un `try/catch` que avisa por consola
   y sigue. Es lo correcto: si la auditoría falla, el alta YA está
   hecha, y dar el alta por fallida sería mentir.

   Pero esa misma decisión hace que un fallo de la auditoría sea
   INVISIBLE para el test. El test ve un 302 y una fila en la base, y
   pasa. El «no se pudo auditar el alta» solo existe en el log del
   servidor, que nadie mira.

   Esta comprobación mira esa fila directamente. Es lenta de leer y
   fácil de que se pase, que es exactamente el problema que tiene.
   ───────────────────────────────────────────────────────────── */

(async () => {
  console.log("\n═══ Auditoría ═══\n");

  const { data, error } = await db
    .from("audit_log")
    .select("id,actor_id,accion,entidad,detalle,creado_en")
    .eq("entidad", "services")
    .order("creado_en", { ascending: false })
    .limit(10);

  if (error) {
    console.log("  x " + error.message + "\n");
    process.exit(1);
  }

  console.log("  altas de servicios registradas: " + ((data || []).length) + "\n");

  for (const a of data || []) {
    const detalle = a.detalle || {};
    console.log(
      "    " + String(a.creado_en).slice(0, 19).replace("T", " ") +
      "  " + a.accion +
      "  " + (detalle.tipo || "?") +
      "  " + (detalle.microservicio_clave || detalle.plan_id || "—") +
      (detalle.termina_en ? "  hasta " + String(detalle.termina_en).slice(0, 10) : "")
    );
  }

  console.log("");
  console.log("  Las altas de prueba se borran de `services`, pero la auditoría");
  console.log("  se queda: es un registro de que alguien hizo algo, y borrarlo");
  console.log("  sería tirar la única prueba de que el alta existió.\n");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});
