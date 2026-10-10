/* Prepara un caso real para mirar el portal del cliente:
   deja a Marina con un servicio pagado, uno con cobro VENCIDO y una
   oferta. Así se ven los cuatro niveles de golpe.
   Uso: node db/escenario-cliente.js */
const env = require("../../lib/env");
env.load();
const supabase = require("../../lib/supabase");
const db = supabase.getAdmin();

(async () => {
  const { data: cli } = await db
    .from("clients")
    .select("id,empresa")
    .ilike("empresa", "%Espiga%")
    .limit(1)
    .maybeSingle();

  if (!cli) throw new Error("no está el cliente de ejemplo; ejecuta npm run seed");

  const { data: servicios } = await db
    .from("services")
    .select("id,titulo,estado,kind,importe")
    .eq("client_id", cli.id)
    .order("creado_en");

  /* Se borran los cobros de este cliente y se ponen los tres casos.
     Con esto el escenario se puede repetir tantas veces como haga
     falta sin acumular cobros falsos. */
  await db.from("cobros").delete().in("service_id", servicios.map((s) => s.id));

  const manten = servicios.find((s) => s.kind === "mantenimiento");
  const proy = servicios.find((s) => s.kind === "proyecto");
  const presu = servicios.find((s) => s.kind === "presupuesto");

  const filas = [];

  /* 1. Al día: pagado → activo */
  if (manten) {
    filas.push({
      service_id: manten.id,
      concepto: manten.titulo,
      importe: manten.importe,
      periodo: "2026-08",
      estado: "pagado",
      emitido_en: "2026-08-01",
      vence_en: "2026-08-10",
      pagado_en: "2026-08-03",
      referencia: "F-2026-014",
    });
  }

  /* 2. Factura emitida que NO vence: se ve entero, con aviso.
        Este es el caso que hay que recordar no bloquear: aún no toca. */
  if (proy) {
    filas.push({
      service_id: proy.id,
      concepto: proy.titulo,
      importe: proy.importe,
      periodo: "2026-10",
      estado: "pendiente",
      emitido_en: "2026-10-01",
      vence_en: "2026-11-15",
    });
  }

  /* 3. Oferta sin cobrar: presupuesto sin aceptar → oferta */
  if (presu) {
    filas.push({
      service_id: presu.id,
      concepto: presu.titulo,
      importe: presu.importe,
      periodo: null,
      estado: "pendiente",
      emitido_en: null,
      vence_en: null,
    });
  }

  /* 4. Con --vencido se añade un cobro PASADO de fecha, que es lo
        único que bloquea de verdad. Sirve para ver el caso rojo. */
  if (process.argv.includes("--vencido") && proy) {
    filas.push({
      service_id: proy.id,
      concepto: proy.titulo + " (cuota vencida)",
      importe: proy.importe,
      periodo: "2026-09",
      estado: "pendiente",
      emitido_en: "2026-09-01",
      vence_en: "2026-09-20",
    });
  }

  const { error } = await db.from("cobros").insert(filas);
  if (error) throw new Error(error.message);

  console.log("\n  Escenario preparado para " + cli.empresa + ":");
  console.log("   · mantenimiento pagado        → activo");
  console.log("   · proyecto con factura futura → activo + aviso");
  console.log("   · presupuesto sin cobrar      → oferta");
  if (process.argv.includes("--vencido")) {
    console.log("   · cuota pasada de fecha       → BLOQUEADO");
  } else {
    console.log("   (añade --vencido para ver el caso bloqueado)");
  }
  console.log("");
  process.exit(0);
})().catch((e) => {
  console.error("\n✗ " + e.message + "\n");
  process.exit(1);
});
