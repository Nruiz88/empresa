/* =========================================================
   Nexo Studio — Sembrar datos de demostración
   ------------------------------------------------------------
   Crea clientes y servicios de ejemplo para poder trabajar con
   el panel sin tener que teclear todo a mano.

   ⚠️  Datos INVENTADOS. Antes de enseñar esto a un cliente o a
   un tercero, borra lo que sea de mentira. La tabla audit_log
   guardará que estos datos los metió una siembra.

   Uso:
     node db/seed.js            crea (no duplica)
     node db/seed.js --limpiar  borra lo que creó este script
   ========================================================= */

const env = require("../../lib/env");
env.load();
env.require("SUPABASE_URL", "SUPABASE_SECRET_KEY");

const supabase = require("../../lib/supabase");
const db = supabase.getAdmin();

/* Marca en la empresa para reconocer lo que es de la siembra */
const MARCA = "[demo]";

const CLIENTES = [
  {
    nombre: "Marina Soler",
    empresa: "Panadería La Espiga",
    email: "cliente@ejemplo.com",
    telefono: "+34 600 111 222",
    notas: "Tienda de barrio con 2 locales. Piden reservas de mesa online.",
  },
  {
    nombre: "Javier Ruiz",
    empresa: "Taller Ruiz",
    email: "javier@tallerruiz.es",
    telefono: "+34 600 333 444",
    notas: "Taller mecánico. Web con cita previa y recordatorios.",
  },
  {
    nombre: "Lucía Peña",
    empresa: "Estudio L&P",
    email: "lucia@estudiolp.es",
    telefono: "+34 600 555 666",
    notas: "Estudio de arquitectura. Portfolio grande, necesita optimizar imágenes.",
  },
];

const SERVICIOS = {
  "Panadería La Espiga": [
    {
      kind: "mantenimiento",
      estado: "activo",
      titulo: "Mantenimiento mensual",
      descripcion: "Actualizaciones, copias de seguridad y soporte por correo.",
      importe: 120,
      periodicidad: "mensual",
      inicia_en: "2026-09-01",
      notas: "Empezó con la entrega de la web.",
    },
    {
      kind: "proyecto",
      estado: "en_curso",
      titulo: "Reservas de mesa online",
      descripcion: "Página de reservas con pago de señal y recordatorio por SMS.",
      importe: 2400,
      inicia_en: "2026-09-20",
      notas: "Entrega prevista en 4 semanas. Pendiente que validen la carta.",
    },
    {
      kind: "presupuesto",
      estado: "pendiente",
      titulo: "Tienda online de pan",
      descripcion: "Venta de pan y pastelería con recogida en tienda.",
      importe: 3800,
      inicia_en: null,
      notas: "Enviado el 28/09. Aún no responde.",
    },
  ],
  "Taller Ruiz": [
    {
      kind: "mantenimiento",
      estado: "activo",
      titulo: "Mantenimiento y hosting",
      descripcion: "Alojamiento, dominio y actualizaciones.",
      importe: 89,
      periodicidad: "mensual",
      inicia_en: "2026-06-15",
      notas: null,
    },
  ],
  "Estudio L&P": [
    {
      kind: "proyecto",
      estado: "activo",
      titulo: "Rediseño del portfolio",
      descripcion: "Nuevo portfolio con carga diferida y casos de estudio.",
      importe: 5200,
      periodicidad: "unica",
      inicia_en: "2026-07-01",
      termina_en: "2026-08-30",
      notas: "Entregado. Pendiente revisión de rendimiento.",
    },
    {
      kind: "mantenimiento",
      estado: "pausado",
      titulo: "Mantenimiento",
      descripcion: "Pausado a petición del cliente en agosto.",
      importe: 95,
      periodicidad: "mensual",
      inicia_en: "2026-08-01",
      notas: "Quiere retomarlo en enero.",
    },
  ],
};

/* Cobros de ejemplo, con estados variados a propósito:
   un panel donde todo está pagado no deja comprobar que los avisos
   de vencimiento funcionan. */
const COBROS = {
  "Panadería La Espiga": [
    { estado: "pagado", periodo: "2026-09", emitido_en: "2026-09-01", vence_en: "2026-09-10", pagado_en: "2026-09-08", referencia: "F-2026-014" },
    { estado: "impagado", periodo: "2026-10", emitido_en: "2026-10-01", vence_en: "2026-10-10" },
    { estado: "pendiente", periodo: "2026-11", emitido_en: "2026-11-01", vence_en: "2026-11-10" },
  ],
  "Taller Ruiz": [
    { estado: "pagado", periodo: "2026-09", emitido_en: "2026-09-15", vence_en: "2026-09-20", pagado_en: "2026-09-15", referencia: "F-2026-013" },
  ],
  "Estudio L&P": [
    { estado: "pagado", periodo: "2026-08", emitido_en: "2026-08-30", vence_en: "2026-09-15", pagado_en: "2026-09-02", referencia: "F-2026-009" },
  ],
};

async function main() {
  const limpiar = process.argv.includes("--limpiar");

  if (limpiar) {
    console.log("\nBorrando datos de demostración...");
    /* Se buscan por DOS vías, porque antes solo se buscaba por la marca
       y eso se dejaba cosas sin borrar:

         1. La marca [demo], que ponen los clientes que crea este
            script.
         2. Los emails de la lista CLIENTES. Hace falta la segunda
            porque un cliente puede existir SIN la marca: si te creaste
            una cuenta con create-user.js usando el email de ejemplo
            (cliente@ejemplo.com), el alta es real y no lleva marca,
            pero los servicios de ejemplo se le colgaron encima al
            reusarlo. Buscando solo por [demo] se quedaba ahí para
            siempre, con sus servicios de mentira puestos.

       Los emails son de ejemplo.com y de dominios inventados para la
       demo, así que no hay riesgo de borrar a un cliente real. */
    const { data: clientes, error } = await db
      .from("clients")
      .select("id,empresa,email")
      .or(
        "empresa.ilike.%" + MARCA + "%," +
          "email.in.(" + CLIENTES.map((c) => '"' + c.email + '"').join(",") + ")"
      );
    if (error) {
      console.error("  (no se pudo leer: " + error.message + ")");
      process.exit(1);
    }
    const rows = clientes || [];
    const ids = rows.map((c) => c.id);
    if (ids.length) {
      /* Los cobros caen en cascada con el servicio (on delete cascade),
         así que no hace falta borrarlos a mano. */
      await db.from("services").delete().in("client_id", ids);
      await db.from("clients").delete().in("id", ids);
    }
    for (const c of rows) console.log("  · borrado: " + (c.empresa || c.email));
    console.log(`\n✓ ${ids.length} cliente(s) y sus servicios borrados`);
    if (!ids.length) console.log("  No había nada de demostración.Quizá ya lo habías limpiado.");
    console.log("");
    console.log("  Ojo: esto NO borra la cuenta de acceso de esos clientes.");
    console.log("  Los usuarios de Supabase Auth siguen existiendo (con su");
    console.log("  contraseña), aunque ya no tengan empresa asociada. Para");
    console.log("  fuera del todo, desactívalos en el panel > Accesos.\n");
    process.exit(0);
  }

  console.log("\n── Comprobando si ya existe ───────────────────────");
  const { data: previos } = await db.from("clients").select("id,empresa,email");
  const porEmail = new Map((previos || []).map((c) => [String(c.email || "").toLowerCase(), c]));

  let creados = 0;
  let reutilizados = 0;
  let servicios = 0;
  let cobros = 0;

  console.log("\n── Creando clientes ───────────────────────────────");
  for (const c of CLIENTES) {
    /* Si ya existe ese email (p. ej. lo creaste con create-user.js
       para darte acceso al panel), NO se duplica: se le cuelgan
       encima los servicios de ejemplo. */
    const existente = porEmail.get(String(c.email).toLowerCase());

    let cliente;
    if (existente) {
      cliente = existente;
      reutilizados++;
      console.log(`  · ${existente.empresa}: ya existía, se le añaden sus servicios`);
    } else {
      const empresa = c.empresa + " " + MARCA;
      const { data: nuevo, error } = await db
        .from("clients")
        .insert({
          nombre: c.nombre,
          empresa,
          email: c.email,
          telefono: c.telefono,
          notas: c.notas,
        })
        .select()
        .single();

      if (error) {
        console.log(`  ✗ ${empresa}: ${error.message}`);
        continue;
      }
      cliente = nuevo;
      creados++;
      console.log(`  ✓ ${empresa}`);
    }

    const lista = SERVICIOS[c.empresa] || [];

    /* No duplicar servicios si ya se sembró antes */
    const { data: yaTiene } = await db
      .from("services")
      .select("titulo")
      .eq("client_id", cliente.id);
    const titulosPuestos = new Set((yaTiene || []).map((s) => s.titulo));

    let anadidos = 0;
    const idsServicios = [];
    for (const s of lista) {
      if (titulosPuestos.has(s.titulo)) continue;
      const { data: nuevo, error: errS } = await db
        .from("services")
        .insert({ ...s, client_id: cliente.id })
        .select("id")
        .single();
      if (errS) console.log(`      ✗ servicio "${s.titulo}": ${errS.message}`);
      else {
        servicios++;
        anadidos++;
        idsServicios.push(nuevo.id);
      }
    }
    if (anadidos) console.log(`      · ${anadidos} servicio(s) añadidos`);

    /* ---------- Cobros de ejemplo ----------
       Se emiten sobre los servicios del cliente, sean nuevos o de
       una siembra anterior. Si solo se miraran los recién creados,
       reejecutar el script no añadiría cobros nunca, que es justo
       lo que pasaba.

       Los cobros van con estados variados a propósito: un panel donde
       todo está pagado no deja comprobar que los avisos funcionan. */
    const listaCobros = COBROS[cliente.empresa.replace(" " + MARCA, "")] || COBROS[c.empresa] || [];
    if (listaCobros.length) {
      const { data: serviciosCliente } = await db
        .from("services")
        .select("id,titulo,importe,moneda")
        .eq("client_id", cliente.id)
        .order("creado_en", { ascending: true });

      /* Un cobro por servicio: el repetido son los distintos meses
         del mismo mantenimiento, y el resto son páginas sueltas. */
      const usados = new Set();
      let n = 0;
      for (const co of listaCobros) {
        const srv = (serviciosCliente || []).find((s) => !usados.has(s.id));
        if (!srv) break;
        usados.add(srv.id);

        const { error } = await db.from("cobros").insert({
          ...co,
          service_id: srv.id,
          concepto: srv.titulo,
          importe: srv.importe || 0,
          moneda: srv.moneda || "EUR",
        });
        if (error) {
          /* La unique (service_id, periodo) salta si ya existe: es lo
             esperado al reejecutar, no un fallo. */
          if (!String(error.message).includes("duplicate")) {
            console.log(`      ✗ cobro "${co.periodo}": ${error.message}`);
          }
        } else {
          n++;
        }
      }
      if (n) {
        cobros += n;
        console.log(`      · ${n} cobro(s) emitidos`);
      }
    }
  }

  console.log("\n───────────────────────────────────────────────────");
  console.log(`  ${creados} cliente(s) nuevos, ${reutilizados} reutilizados, ${servicios} servicio(s), ${cobros} cobro(s)`);
  console.log("  Los marcados con [demo] son inventados.\n");
  process.exit(0);
}

main().catch((e) => {
  console.error("\n✗ " + e.message + "\n");
  process.exit(1);
});
