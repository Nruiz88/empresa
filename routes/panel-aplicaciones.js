/* =========================================================
   Shopcito — Panel: aplicaciones
   ------------------------------------------------------------
   Dos pantallas en un archivo, porque son la misma pantalla.

     · la lista  quién tiene qué, hasta cuándo y qué se le factura;
     · el alta   quién, qué, hasta cuándo y cuánto.

   ── POR QUÉ EN UN SOLO ARCHIVO Y NO DOS ──

   Porque comparten lo que más cuesta: la forma de leer
   «microservicios» y «plans», y la de calcular el estado con
   «lib/aplicaciones». En dos archivos eso son dos lecturas de lo
   mismo, y un día una cambia y la otra no: la lista dice que algo
   está activo y el alta lo vende con otro precio.

   ── EL ESTADO NO VIENE DE LA BASE ──

   Se calcula con «lib/aplicaciones». Se guarda «termina_en», una
   fecha; el estado sale de ahí. Guardarlo sería guardar algo que hay
   que recalcular todos los días, y el día que se olviden la lista
   dice que algo está vigente cuando venció hace un mes.

   ── EL FILTRO POR ESTADO, Y POR QUÉ NO ES EL DE «services» ──

   Porque «services.estado» es el estado comercial —activo, pausado—
   y no dice nada de si se pagó. El de esta pantalla es temporal:
   cuánto falta para que venza.

   Se usan los dos en la misma lista, y por eso la columna se llama
   «vencimiento» y no «estado», para que no se confundan.
   ========================================================= */

const express = require("express");
const { validar, vacioANull } = require("../lib/validate");
const { MONEDAS } = require("../lib/monedas");
const A = require("../lib/aplicaciones");

const POR_PAGINA = 25;

/* ─────────────────────────────────────────────────────────
   LAS REGLAS DEL ALTA

   El vocabulario, campo por campo:

   · `requerido`   no puede venir vacío.
   · `unoDe`       tiene que ser uno de la lista.
   · `texto`       texto, con tope de largo opcional.
   · `fecha`       AAAA-MM-DD, o vacío.

   ── POR QUÉ ESTÁN AQUÍ Y NO EN LA VISTA ──

   Porque el navegador no es la validación. Se puede mandar el POST sin
   pasar por el formulario —con curl, con un script, con las DevTools— y
   lo que llega es lo que decide.

   ── Y POR QUÉ NO SE VALIDA EL TIPO DOS VECES ──

   `tipo` dice una cosa, `microservicio_clave` y `plan_id` dicen cuál.
   Que las tres encajen se comprueba después, en el POST, porque es una
   regla que cruza campos y `validar` trabaja campo por campo.
   ───────────────────────────────────────────────────────── */
const ESQUEMA = {
  client_id: ["requerido"],
  tipo: [["requerido"], ["unoDe", ["aplicacion", "plan"]]],
  microservicio_clave: ["texto"],
  plan_id: ["texto"],
  estado: ["requerido"],
  inicia_en: ["fecha"],
  termina_en: ["fecha"],
  notas: [["texto", { max: 2000 }]],
};

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

      /* ─────────────────────────────────────────────────────────
         LA CONFIRMACIÓN DEL ALTA

         El POST del alta redirige acá con `?alta=<id>`. Sin esto, quien
         acaba de dar de alta vuelve a una lista y no sabe si se guardó
         o si se perdió: el alta no tiene ninguno de los movimientos de
         una tabla —no hay fila nueva arriba de todo que se note— y se
         va a dar otra vez.

         ── POR QUÉ SE BUSCA EN TODAS, Y NO EN LAS VISIBLES ──

         Porque con un filtro puesto, la fila nueva puede no estar en la
         página. Con filtro «vencidas», un alta de hoy no aparece, y el
         aviso «no encuentro lo que diste de alta» sería la respuesta
         a algo que sí se guardó.

         Por eso se busca sobre `filas` —la cartera entera, ya
         calculada— y no sobre `visibles`.

         ── Y SI NO ESTÁ, NO SE DICE NADA ──

         Un id que no existe puede ser un enlace viejo, un favor
         guardado, o alguien tocando la URL. Ninguno de esos tres es
         un error que haya que mostrarle a quien está trabajando.
         */
      const altaId = String(req.query.alta || "").trim();
      const alta = altaId
        ? filas.find((s) => s.id === altaId) || null
        : null;

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

        /* La fila que se acaba de dar de alta, si viene del POST. */
        alta,

        /* Se pasan a la vista para que no tenga que saber los números. */
        margen: A.DIAS_DE_MARGEN,
        aviso: A.DIAS_DE_AVISO,
      });
    });

    async function contexto() {
      const [apps, planes, clientes] = await Promise.all([
        db
          .from("microservicios")
          .select("modulo,nombre,descripcion,precio,moneda,periodo,activo")
          .order("nombre", { ascending: true }),
        db
          .from("plans")
          .select("id,nombre,descripcion,precio,moneda,periodo,aplicaciones,activo")
          .order("orden", { ascending: true }),
        db
          .from("clients")
          .select("id,empresa,nombre")
          .eq("archivado", false)
          .order("empresa", { ascending: true }),
      ]);

      return {
        /* Solo las activas. Una aplicación dada de baja no se vende; si
           aparece en el desplegable, alguien la va a vender. */
        microservicios: (apps.data || []).filter((m) => m.activo),
        microserviciosInactivos: (apps.data || []).filter((m) => !m.activo),
        planes: planes.data || [],
        clientes: clientes.data || [],
        errores: {},
      };
    }

    /* ─────────────────────────────────────────────────────────
       LOS PRECIOS DE REFERENCIA

       Se calculan de la aplicación o del plan. Y van a la vista para que
       el que está rellenando vea de dónde sale el número.

       ── POR QUÉ EL PLAN PUEDE SALIR SIN PRECIO ──

       Porque `plans.precio` está en NULL: los tres dan «a consultar». Un
       plan sin precio no se puede cobrar, y se avisa antes de darlo de
       alta y no cuando llega el cobro.

       Y un plan sin APLICACIONES es peor: no da acceso a nada. Eso se
       avisa con todas las letras, porque es una venta que no se puede
       cumplir.
       ───────────────────────────────────────────────────────── */
    function referencias(contextoDatos) {
      const micros = {
        porClave: Object.fromEntries(
          (contextoDatos.microservicios || []).map((m) => [m.modulo, m])
        ),
        planes: contextoDatos.planes || [],
      };

      return {
        micros,

        apps: (contextoDatos.microservicios || []).map((m) => ({
          modulo: m.modulo,
          nombre: m.nombre,
          precio: m.precio === null || m.precio === undefined ? null : Number(m.precio),
          moneda: m.moneda || "ARS",
          periodo: m.periodo || "mes",
          sinPrecio: m.precio === null || m.precio === undefined,
        })),

        planes: (contextoDatos.planes || []).map((p) => {
          const claves = Array.isArray(p.aplicaciones) ? p.aplicaciones : [];
          return {
            id: p.id,
            nombre: p.nombre,
            descripcion: p.descripcion,
            precio: p.precio === null || p.precio === undefined ? null : Number(p.precio),
            moneda: p.moneda || "ARS",
            periodo: p.periodo || "mes",
            aplicaciones: claves.map((c) => micros.porClave[c]).filter(Boolean),
            sinPrecio: p.precio === null || p.precio === undefined,
            sinAplicaciones: claves.length === 0,
            inactivo: p.activo === false,
          };
        }),
      };
    }

    async function formulario(req, res, extra = {}) {
      const base = await contexto();
      const ref = referencias(base);

      res.render("panel/aplicacion-form", {
        title: "Dar de alta una aplicación",
        site: sitio,
        base: "/panel",
        current: "aplicaciones",
        noindex: true,
        csrf: req.sesion.csrf_token,
        monedas: MONEDAS,
        estados: require("../lib/labels").OPCIONES_ESTADO,

        apps: ref.apps,
        planes: ref.planes,
        clientes: base.clientes,
        inactivos: base.microserviciosInactivos,

        /* El margen y el aviso. Van desde A para que la vista no tenga
           los numeros escritos a mano: si se cambian en un sitio, que sea
           en uno. */
        margen: A.DIAS_DE_MARGEN,
        aviso: A.DIAS_DE_AVISO,

        /* Lo que venga del POST, para que no se pierda al reintentar. */
        servicio: {},

        /* Siempre presente, aunque esté vacía.

           Sin esto, la vista tiene que comprobar si existe antes de cada
           uso, y un día alguien usa `errores.cliente` sin comprobar y
           la pantalla devuelve 500 —que es lo que pasó la primera vez. */
        errores: {},

        ...extra,
      });
    }

    /* ---------- Formulario ---------- */
    /* El `await` por el mismo motivo que en la lista: `formulario` es
     `async` porque espera a la base. Sin `await`, un fallo al leer los
     microservicios deja la petición colgada en vez de dar error. */
  router.get("/aplicaciones/nuevo", requiereStaff, async (req, res) => {
    await formulario(req, res);
  });

    /* ---------- Guardar ---------- */
    router.post("/aplicaciones/nuevo", requiereStaff, async (req, res) => {
      const { errores, datos } = validar(req.body, ESQUEMA);

      /* La fecha de fin no puede ser antes que la de inicio.

         Se llama a la regla por su NOMBRE, con la fecha de inicio como
         opción, y no con una flecha.

         ── POR QUÉ ──

         `validar` recorre las reglas así:

             for (const [regla, opciones] of lista)

         o sea que cada elemento de la lista se DESTRUCTURA en dos
         partes: el nombre de la regla y sus opciones. Si en vez del
         nombre se pasa una función, `lista` contiene una función, y las
         funciones no son iterables:

             TypeError: .for is not iterable

         ── EL BUG QUE HABÍA, Y ERA VIEJO ──

         La forma antigua era una flecha:

             fin: [(v) => reglas.rangoFechas(v, datos.inicia_en)]

         y reventaba con ese TypeError. El POST se quedaba colgado sin
         responder, y `/panel/servicios/nuevo` —que tiene exactamente el
         mismo código— llevaba tiempo roto sin que nadie lo notara: la
         pantalla cargaba, el botón estaba ahí, y al darle no pasaba nada.

         Se vio al escribir la validación de esta pantalla, que es la
         forma habitual: uno copia el patrón de al lado y el patrón está
         roto. */
      const cruce = validar({ fin: datos.termina_en }, {
        fin: [["rangoFechas", datos.inicia_en]],
      });
      if (cruce.errores.fin) errores.termina_en = cruce.errores.fin;

      /* ─────────────────────────────────────────────────────────
         QUE LOS DOS CAMPOS COINCIDAN CON EL TIPO ELEGIDO

         El formulario manda los dos, porque el usuario elige en un
         desplegable y los campos no saben cuál chose. Pero en el POST
         hay que quedarse con uno.

         Y el `CHECK` de la base lo exige: un servicio de tipo aplicación
         tiene que tener `microservicio_clave` y NO `plan_id`. Sin esto,
         el error de Postgres sería «violates check constraint», que no
         le dice a nadie qué campo corregir.
         ───────────────────────────────────────────────────────── */
      if (!errores.tipo) {
        if (datos.tipo === "aplicacion") {
          if (!datos.microservicio_clave) {
            errores.microservicio_clave = "Elegí qué aplicación es.";
          }
          datos.plan_id = null;
        } else {
          if (!datos.plan_id) {
            errores.plan_id = "Elegí qué plan es.";
          }
          datos.microservicio_clave = null;
        }
      }

      if (Object.keys(errores).length) {
        return formulario(req, res, { servicio: datos, errores });
      }

      /* ─────────────────────────────────────────────────────────
         EL PRECIO Y EL TÍTULO, LEÍDOS DE LA FUENTE

         No del POST. Del POST no vienen, y si vinieran podrían venir
         distintos de lo que dice la aplicación, y entonces el servicio
         queda con un precio que nadie puede explicar.
         ───────────────────────────────────────────────────────── */
      let titulo;
      let importe = null;
      let moneda = null;
      let periodo = "";

      const ref = referencias(await contexto());

      if (datos.tipo === "aplicacion") {
        const app = ref.apps.find((a) => a.modulo === datos.microservicio_clave);

        if (!app) {
          return formulario(req, res, {
            servicio: datos,
            errores: { microservicio_clave: "Esa aplicación no existe o no se está vendiendo." },
          });
        }

        titulo = app.nombre;
        importe = app.precio;
        moneda = app.moneda;
        periodo = app.periodo;
      } else {
        const plan = ref.planes.find((p) => p.id === datos.plan_id);

        if (!plan) {
          return formulario(req, res, {
            servicio: datos,
            errores: { plan_id: "Ese plan no existe." },
          });
        }

        /* Se avisa ANTES de guardar, no cuando llega el cobro. */
        if (plan.sinAplicaciones) {
          return formulario(req, res, {
            servicio: datos,
            errores: {
              plan_id:
                "El plan «" + plan.nombre + "» no tiene ninguna aplicación marcada. " +
                "No da acceso a nada. Marcá sus aplicaciones en Planes antes de venderlo.",
            },
          });
        }

        titulo = "Plan " + plan.nombre;
        importe = plan.precio;
        moneda = plan.moneda;
        periodo = plan.periodo;
      }

      const { data, error } = await db
        .from("services")
        .insert({
          client_id: datos.client_id,
          kind: datos.tipo,
          estado: datos.estado,

          microservicio_clave: datos.microservicio_clave,
          plan_id: datos.plan_id,

          titulo,
          importe,
          moneda,
          /* Traducido, no copiado.

             `services.periodicidad` admite `mensual · trimestral · anual
             · unica` y `plans.periodo` dice `mes · trimestre · anio`.
             Son dos vocabularios y no coinciden; mandar el de uno al
             otro da «violates check constraint», que es lo que pasaba.

             Y no se manda fijo porque si mañana el plan pasa a
             trimestral, este servicio se quedaría diciendo mensual. */
          periodicidad: A.periodicidadDe(periodo),

          inicia_en: vacioANull(datos.inicia_en),
          termina_en: vacioANull(datos.termina_en),
          notas: vacioANull(datos.notas),
        })
        .select()
        .single();

      if (error) {
        /* Un error del CHECK llega como texto de Postgres. Se traduce,
           porque «violates check constraint» no le dice a nadie que hay
           que elegir una aplicación o un plan. */
        const texto = error.message || "";
        let mensaje = "No se pudo guardar: " + texto;

        if (/servicios_dicen_de_donde_vene/.test(texto)) {
          mensaje =
            "Elegí una aplicación o un plan, no los dos. La base no lo admite " +
            "y es mejor que lo diga esto que un error de Postgres.";
        }

        return formulario(req, res, { servicio: datos, errores: { general: mensaje } });
      }

      /* Se anota. Una alta de acceso es de las cosas que después hay que
         poder explicar: quién lo dio, cuándo y a quién. */
      try {
        await db.from("audit_log").insert({
          actor_id: req.sesion.user_id,
          accion: "crear",
          entidad: "services",
          entidad_id: data.id,
          detalle: {
            tipo: datos.tipo,
            microservicio_clave: datos.microservicio_clave,
            plan_id: datos.plan_id,
            termina_en: data.termina_en,
          },
        });
      } catch (e) {
        /* Si la auditoría falla, el alta YA está hecha. Se avisa por
           consola y no se devuelve error: darlo por fallida sería
           mentir, porque el servicio existe. */
        console.error("[aplicaciones] no se pudo auditar el alta:", e.message);
      }

      /* A la lista, no al formulario.

         Y con el id en la query para que la lista pueda confirmar el alta
         con nombre y todo. Un `POST` que responde con un redirect vacío
         deja a quien lo hizo pensando que no pasó nada, y va a darle otra
         vez. */
      res.redirect("/panel/aplicaciones?alta=" + encodeURIComponent(data.id));
    });

  return router;
};

module.exports.FILTROS = FILTROS;
module.exports.todosLosServicios = todosLosServicios;
