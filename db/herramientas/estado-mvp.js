process.on("unhandledRejection", (e) => {
  console.log("  ERROR: " + JSON.stringify((e && e.message) || e));
  process.exit(0);
});

require("../../lib/env").load();
const db = require("../../lib/supabase").getAdmin();

/* ═══════════════════════════════════════════════════════════════
   EL ESTADO REAL DE LOS DATOS

   ── POR QUÉ ESTO NO ES UN INVENTARIO DE TABLAS ──

   Porque saber cuántas filas hay en cada tabla no dice si el
   negocio funciona. Lo que lo dice es si hay los datos que un
   cliente necesita para contratar, y si lo que se le promete se
   puede entregar.

   La pregunta útil es: ¿puede alguien pagar hoy? Y para eso hay que
   mirar precios, planes, y si el bot que se vende existe.
   ═══════════════════════════════════════════════════════════════ */

const PREGUNTAS = [
  /* ¿Se puede cobrar algo? */
  {
    grupo: "COBRO",
    t: "clientes",
    q: (d) => [d.length],
    lee: (v) => [v[0] + " clientes"],
  },
  {
    grupo: "COBRO",
    t: "services",
    q: (d) => [d.length],
    lee: (v) => [v[0] + " servicios contratados"],
  },
  {
    grupo: "COBRO",
    t: "charges",
    q: (d) => [d.length],
    lee: (v) => [v[0] + " cobros emitidos"],
  },
  {
    grupo: "COBRO",
    t: "plans",
    q: (d) => [
      d.length,
      d.filter((p) => p.precio !== null && p.precio !== undefined && p.precio !== 0).length,
      d.filter((p) => p.activo).length,
    ],
    lee: (v) => [
      v[0] + " planes, " + v[1] + " con precio, " + v[2] + " visibles",
    ],
  },

  /* ¿Se puede entregar lo que se vende? */
  {
    grupo: "ENTREGA",
    t: "microservicios",
    q: (d) => [d.length, d.filter((m) => m.activo).length],
    lee: (v) => [v[0] + " microservicios, " + v[1] + " vendibles"],
  },
  {
    grupo: "ENTREGA",
    t: "evolution_servers",
    q: (d) => [d.length, d.filter((c) => c.activo).length],
    lee: (v) => [v[0] + " cajas, " + v[1] + " activas"],
  },
  {
    grupo: "ENTREGA",
    t: "bots",
    q: (d) => [d.length, d.filter((b) => b.status === "en_linea").length],
    lee: (v) => [v[0] + " bots dados de alta, " + v[1] + " en línea"],
  },
  {
    grupo: "ENTREGA",
    t: "evolution_instancias",
    q: (d) => [d.length],
    lee: (v) => [v[0] + " instancias en la Evolution"],
  },

  /* ¿Se puede avisar al cliente? */
  {
    grupo: "AVISOS",
    t: "suscripciones",
    q: (d) => [d.length, d.filter((s) => !s.termina_en).length],
    lee: (v) => [v[0] + " suscripciones, " + v[1] + " sin fecha de fin"],
  },
];

(async () => {
  const cache = {};

  for (const p of PREGUNTAS) {
    if (!(p.t in cache)) {
      const { data, error } = await db.from(p.t).select("*");
      if (error) {
        console.log("  " + p.t.padEnd(24) + "no existe o no se puede leer");
        continue;
      }
      cache[p.t] = data || [];
    }
    const v = p.q(cache[p.t]);
    console.log(
      "  " + p.grupo.padEnd(9) + p.t.padEnd(24) + p.lee(v).join(" · ")
    );
  }

  /* ── LOS PRECIOS, QUE ES LO QUE DECIDE SI SE PUEDE COBRAR ── */

  const { data: planes } = cache.plans
    ? { data: cache.plans }
    : await db.from("plans").select("*");

  console.log("\n═══ Los planes, uno a uno ═══\n");

  for (const p of (planes || []).sort((a, b) => (a.orden || 0) - (b.orden || 0))) {
    const precio = p.precio === null || p.precio === undefined || p.precio === 0
      ? "A CONSULTAR"
      : p.precio + " " + p.moneda;
    const apps = Array.isArray(p.aplicaciones) ? p.aplicaciones.length : 0;
    console.log(
      "  " + String(p.nombre).padEnd(12) +
      String(precio).padEnd(14) +
      (p.activo ? "visible  " : "oculto   ") +
      apps + " aplicaciones"
    );
  }

  process.exit(0);
})();