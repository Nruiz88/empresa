/* =========================================================
   Shopcito — Panel: aplicaciones
   ------------------------------------------------------------
   Quién tiene qué microservicio, hasta cuándo y qué se le factura.

   ── POR QUÉ UNA PANTALLA PROPIA Y NO UN FILTRO DE SERVICIOS ──

   Porque no es un filtro. En `panel-servicios` se ven los servicios de
   un cliente: qué tiene y cuándo termina. Eso es una ficha.

   Acá se ve el negocio entero de un vistazo: quién tiene el bot, quién
   lo tiene vencido, y qué hay que llamar hoy. La pregunta no es «qué
   tiene este cliente» sino «qué está por vencer en toda la cartera».

   Que la lista sirva para las dos cosas, y no solo para una, es lo que
   hace que valga la pena tenerla.

   ── EL ESTADO NO VIENE DE LA BASE ──

   Se calcula con `lib/aplicaciones`. Se guarda `termina_en`, una fecha;
   el estado sale de ahí. Guardarlo sería guardar algo que hay que
   recalcular todos los días, y el día que se olviden la lista dice que
   algo está vigente cuando venció hace un mes.

   ── POR QUÉ `microservicios` VA EN UNA CONSULTA APARTE ──

   Porque la lista de servicios necesita las aplicaciones para poder
   mostrar los nombres. Y para mostrar los nombres NO hace falta leer la
   tabla: hay un puñado y no cambian. Se lee una vez al montar la
   pantalla.

   ── EL FILTRO POR ESTADO, Y POR QUÉ NO ES EL DE `services` ──

   Porque `services.estado` es el estado comercial —activo, pausado— y no
   dice nada de si se pagó. El de esta pantalla es temporal: cuánto
   falta para que venza.

   Se usan los dos en la misma lista, y por eso la columna se llama
   «vencimiento» y no «estado», para que no se confundan.
   ========================================================= */

const express = require("express");
const A = require("../lib/aplicaciones");

const POR_PAGINA = 25;

/* Los filtros de la barra. Cada uno es un valor de `lib/aplicaciones`,
   no un estado de `services`. */
const FILTROS = [
  { valor: "", etiqueta: "Todas" },
  { valor: "urgente", etiqueta: "Requieren atención" },
  { valor: "activo", etiqueta: "Activas" },
  { valor: "por_vencer", etiqueta: "Por vencer" },
  { valor: "en_margen", etiqueta: "En margen" },
  { valor: "vencido", etiqueta: "Vencidas" },
  { valor: "sin_fecha", etiqueta: "Sin fecha de fin" },
];

/**
 * Todos los servicios, con el estado ya calculado.
 *
 * Se leen todos y se calculan en JavaScript en vez de filtrar en SQL.
 * Un filtro de días sobre `termina_en` en SQL se puede escribir, pero
 * tiene que coincidir EXACTAMENTE con el cálculo de `lib/aplicaciones`,
 * y si los dos no dicen lo mismo la lista enseña unos estados y las
 * alertas dicen otros. Es mejor tener una sola definición.
 *
 * Con una cartera chica no hay problema de volumen. Y si algún día hay
 * miles, se agrega el filtro aquí —en el mismo sitio que el cálculo— en
 * vez de en la consulta.
 */
async function todosLosServicios(db) {
  const { data, error } = await db
    .from("services")
    .select("*")
    .order("creado_en", { ascending: false });

  if (error) {
    console.error("[aplicaciones] " + error.message);
    return [];
  }

  /* Los nombres de aplicación y los datos de plan. Sin esto no se puede
     ni mostrar el nombre ni saber qué se factura. */
  const [apps, planes] = await Promise.all([
    db
      .from("microservicios")
      .select("modulo,nombre,descripcion,precio,moneda,periodo,activo")
      .order("nombre", { ascending: true }),
    db
      .from("plans")
      .select("id,nombre,precio,moneda,aplicaciones,activo")
      .order("orden", { ascending: true }),
  ]);

  const microservicios = {
    porClave: Object.fromEntries((apps.data || []).map((m) => [m.modulo, m])),
    planes: planes.data || [],
  };

  const enriched = A.paraCliente(data || [], microservicios);

  /* El nombre del cliente va aparte: la consulta de `services` no trae
     la relación, y `client_id` es un uuid que no dice nada a quien mira. */
  const ids = [...new Set((data || []).map((s) => s.client_id).filter(Boolean))];
  const clientes = ids.length
    ? await db
        .from("clients")
        .select("id,empresa,nombre")
        .in("id", ids)
    : { data: [] };

  const porCliente = Object.fromEntries(
    (clientes.data || []).map((c) => [c.id, c.empresa || c.nombre || c.id.slice(0, 8)])
  );

  return enriched.map((s) =>
    Object.assign({}, s, { cliente: porCliente[s.client_id] || "(cliente borrado)" })
  );
}

module.exports = function rutasAplicaciones({ db, sitio, csrf, requiereStaff }) {
  const router = express.Router();

  /* ---------- Listado ---------- */
  router.get("/aplicaciones", requiereStaff, async (req, res) => {
    const filtro = String(req.query.estado || "").trim();
    const q = String(req.query.q || "").trim().toLowerCase();
    const pagina = Math.max(1, parseInt(req.query.pagina || "1", 10) || 1);

    let filas = await todosLosServicios(db);

    /* El resumen se calcula ANTES de filtrar, y sobre todo. Porque
       «cuántos hay» es la pregunta que uno se hace al entrar, y si el
       filtro puesto fuera «vencidas», el resumen tiene que seguir
       diciendo cuántas hay en total. */
    const resumen = A.resumen(filas);

    if (filtro === "urgente") {
      filas = filas.filter(
        (s) => ["por_vencer", "en_margen", "vencido"].includes(s.estado.clave)
      );
    } else if (filtro) {
      filas = filas.filter((s) => s.estado.clave === filtro);
    }

    if (q) {
      filas = filas.filter(
        (s) =>
          s.cliente.toLowerCase().includes(q) ||
          (s.aplicaciones || []).some((a) => (a.nombre || "").toLowerCase().includes(q)) ||
          (s.precio.detalle || "").toLowerCase().includes(q)
      );
    }

    /* Lo urgente arriba. Es lo que uno mira al entrar: si hay algo que
       venció, va primero, no en su lugar alfabético. */
    const orden = { vencido: 0, en_margen: 1, por_vencer: 2, activo: 3, sin_fecha: 4 };
    filas.sort((a, b) => {
      const d = (orden[a.estado.clave] ?? 9) - (orden[b.estado.clave] ?? 9);
      if (d !== 0) return d;
      /* Dentro del mismo estado, el que vence antes. */
      return (a.estado.dias ?? 1e9) - (b.estado.dias ?? 1e9);
    });

    const total = filas.length;
    const desde = (pagina - 1) * POR_PAGINA;
    const visibles = filas.slice(desde, desde + POR_PAGINA);

    res.render("panel/aplicaciones", {
      title: "Aplicaciones",
      site: sitio,
      base: "/panel",
      current: "aplicaciones",

      filas: visibles,
      resumen,
      filtros: FILTROS,
      filtro,
      q,

      pagina,
      paginas: Math.max(1, Math.ceil(total / POR_PAGINA)),
      total,
      desde: total === 0 ? 0 : desde + 1,
      hasta: Math.min(desde + POR_PAGINA, total),

      /* Se pasan a la vista para que no tenga que saber los números. */
      margen: A.DIAS_DE_MARGEN,
      aviso: A.DIAS_DE_AVISO,
    });
  });

  return router;
};

module.exports.FILTROS = FILTROS;
module.exports.todosLosServicios = todosLosServicios;