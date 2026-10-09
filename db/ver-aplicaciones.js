/* ¿Se puede asignar una APLICACIÓN (microservicio) a un cliente?
   ─────────────────────────────────────────────────────────────
   Ya existen `services` con `inicia_en` y `termina_en`, y `cobros` con
   `vence_en` y `pagado_en`. Así que la fecha y el pagado tienen dónde
   guardarse.

   Lo que hay que ver es si `services` sabe guardar QUÉ se contrató: el
   campo `kind` es un enumerado, y de qué valores son decide si un
   microservicio cabe o no.

   Y si el catálogo de microservicios tiene algo que lo conecte con
   `services`: sin esa pieza, se puede registrar un servicio sin saber
   cuál de los microservicios es. */
require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

(async () => {
  console.log("\n═══ ¿Se puede asignar una aplicación? ═══\n");

  /* ---- 1. De qué valores puede ser `kind` y `estado` ---- */
  console.log("  ── los valores que admite services.kind ──\n");

  const { data: tipos } = await db.rpc("ejecutar_sql", {
    consulta:
      "select t.typname, e.enumlabel from pg_type t " +
      "join pg_enum e on e.enumtypid = t.oid " +
      "where t.typname in ('service_kind','estado_service','subscription_estado','estado_suscripcion','cobro_estado') " +
      "order by t.typname, e.enumsortorder",
    args: [],
  });

  if (tipos && tipos.length) {
    let act = null;
    for (const t of tipos) {
      if (t.typname !== act) {
        act = t.typname;
        console.log("    " + act + ":");
      }
      console.log("      " + t.enumlabel);
    }
  } else {
    console.log("    (no se encontraron enumerados con esos nombres)");
  }

  /* ---- 2. ¿Hay algún campo que diga QUÉ microservicio es? ---- */
  console.log("\n  ── ¿services sabe cuál microservicio es? ──\n");

  const { data: cols } = await db.rpc("ejecutar_sql", {
    consulta:
      "select column_name from information_schema.columns " +
      "where table_schema = 'public' and table_name = 'services' " +
      "order by ordinal_position",
    args: [],
  });

  const nombres = (cols || []).map((c) => c.column_name);
  console.log("    services: " + nombres.join(", "));

  const conecta = nombres.filter((n) => /module|microservicio|producto|item_id|plan_id/.test(n));
  console.log("");
  console.log(conecta.length
    ? "    → tiene: " + conecta.join(", ")
    : "    → NO tiene ningún campo que diga qué aplicación es.");

  console.log("");

  /* ---- 3. Qué hay en microservicios ---- */
  const { data: micros } = await db.rpc("ejecutar_sql", {
    consulta: "select clave, nombre, activo, url_base from microservicios order by clave",
    args: [],
  });

  console.log("  ── microservicios ──\n");
  (micros || []).forEach((m) => {
    console.log("    " + String(m.clave).padEnd(18) + String(m.nombre).padEnd(28) +
      (m.activo ? "activo" : "inactivo"));
  });

  /* ---- 4. Y qué hay en services ahora ---- */
  const { data: servicios } = await db.rpc("ejecutar_sql", {
    consulta: "select kind, estado, count(*) as c from services group by 1, 2 order by 1",
    args: [],
  });

  console.log("\n  ── services, lo que hay ahora ──\n");
  if (!servicios || !servicios.length) {
    console.log("    (vacía)");
  } else {
    servicios.forEach((s) => {
      console.log("    kind=" + String(s.kind).padEnd(20) + " estado=" +
        String(s.estado).padEnd(14) + s.c + " servicio(s)");
    });
  }

  console.log("\n  ──────────────────────────────────────────────\n");
  console.log("  Para asignar una aplicación hacen falta tres cosas:\n");
  console.log("    1. que `services.kind` admita el tipo de aplicación, o un campo");
  console.log("       nuevo que diga cuál microservicio es;");
  console.log("    2. una pantalla para darlo de alta con cliente, fecha de fin y");
  console.log("       precio;");
  console.log("    3. un cobro con `vence_en` y `pagado_en` — esa parte ya existe.\n");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});