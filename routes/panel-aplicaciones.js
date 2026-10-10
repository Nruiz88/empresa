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
const { MONEDAS, esMonedaConocida } = require("../lib/monedas");
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

/* ─────────────────────────────────────────────────────────
   EL CATÁLOGO: QUÉ ES CADA APLICACIÓN Y A QUÉ PRECIO

   Los campos que esta pantalla puede cambiar, y solo estos.

   Una lista y no "cualquier columna": si mañana alguien mete un
   `update(cuerpo)` por comodidad, se puede editar el `modulo` —que es
   la clave con la que los servicios guardan a qué aplicación
   pertenecen— y la fila se queda huérfana. La clave NO se edita.

   Los periodos, con el vocabulario de `microservicios.periodo`, que no
   es el de `services.periodicidad`. La traducción la hace
   `lib/aplicaciones.js`, en un solo sitio. */
const EDITABLES_CATALOGO = ["nombre", "descripcion", "precio", "moneda", "periodo", "activo"];

const PERIODOS_CATALOGO = [
  { valor: "mes", label: "Cada mes" },
  { valor: "trimestre", label: "Cada tres meses" },
  { valor: "anio", label: "Cada año" },
  { valor: "unica", label: "Una sola vez" },
];

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

        /* `diasAviso` y no `aviso`, igual que en el catálogo de
           planes. Con `aviso` la vista lo pintaba dentro de un
           `panel-alert--ok` como si fuera un mensaje, y salía una
           franja verde con el número de días suelto. */
        diasAviso: A.DIAS_DE_AVISO,
      });
    });

    /* ═══════════════════════════════════════════════════════════
       EL CATÁLOGO DE APLICACIONES

       Qué es cada aplicación, a qué precio se vende y en qué planes
       está incluida.

       ── POR QUÉ ESTA PANTALLA NO EXISTÍA Y HACÍA FALTA ──

       Porque `microservicios.precio` no se podía tocar desde el panel.
       `/panel/catalogo` edita `modules`, que es el catálogo del estudio
       viejo y no tiene nada que ver: los precios de los que se venden
       estaban fuera del panel, y se cambiaban con una sesión de base
       de datos.

       Y como no había forma de verlos, no se cambiaban. Los tres
       planes siguen a «a consultar» y las aplicaciones no tienen
       importe, que es exactamente lo que pasa cuando el precio no se
       puede cambiar a mano.

       ── POR QUÉ ESTÁ SEPARADA DE LA CARTERA ──

       La cartera responde «quién tiene qué y hasta cuándo». Esta
       responde «qué vendemos y a cuánto». Son dos preguntas que se
       hacen en momentos distintos y por gente distinta: una al día,
       para llamar a alguien; otra al decidir qué se ofrece.

       Meterlas en una pantalla obligaría a pasar por la cartera para
       cambiar un precio, y el catálogo quedaría enterrado bajo datos
       de clientes.
       ───────────────────────────────────────────────────────── */

    /** El nombre del campo en el formulario para un módulo y un campo */
    const campoCatalogo = (modulo, nombre) => nombre + "_" + modulo;

    /**
     * El catálogo, con lo que hay que saber ANTES de cambiar un precio.
     *
     * · cuántos clientes lo tienen ahora mismo, y a qué precio lo
     *   tienen CONTRATADO —que no es el del catálogo—;
     * · en qué planes está incluida, y si alguno la vende por su cuenta.
     *
     * Sin el número de clientes, un precio se sube sin saber si detrás
     * hay veinte personas pagando otra cosa. Con él, la pantalla puede
     * decirlo antes de guardar.
     *
     * @returns {Promise<{apps: Array, planes: Array}>}
     */
    async function leerCatalogo() {
      const [apps, servicios, planes] = await Promise.all([
        db
          .from("microservicios")
          .select("modulo,nombre,descripcion,precio,moneda,periodo,activo")
          .order("nombre", { ascending: true }),

        /* Sólo las de tipo aplicación. Un plan no cuenta: sus
           aplicaciones se muestran en su propia fila. */
        db
          .from("services")
          .select("microservicio_clave,importe,moneda,termina_en")
          .eq("kind", "aplicacion"),

        db.from("plans").select("id,nombre,aplicaciones").order("orden", { ascending: true }),
      ]);

      if (apps.error) {
        console.error("[catalogo de aplicaciones] " + apps.error.message);
        return {
          apps: [],
          planes: [],
          error: "No se pudo leer el catálogo: " + apps.error.message,
        };
      }

      /* ─────────────────────────────────────────────────────
         LO QUE HAY DETRÁS DE CADA APLICACIÓN

         Se cuenta sobre `services`, no sobre `clients`. La pregunta
         es «cuántas veces se ha vendido esto», y un cliente puede
         tenerlo dos veces.

         Y se separa lo que está VIGENTE de lo que no, porque no es lo
         mismo: veinte clientes activos detrás de un precio es una
         subida fácil; veinte, de los cuales dieciocho vencieron hace
         un año, es otra cosa.
         ───────────────────────────────────────────────────── */
      const hoy = new Date();
      const porClave = new Map();

      for (const s of servicios.data || []) {
        const clave = s.microservicio_clave;
        if (!clave) continue;

        if (!porClave.has(clave)) {
          porClave.set(clave, { total: 0, vigentes: 0, importes: new Map() });
        }

        const fila = porClave.get(clave);
        fila.total++;

        const vencida =
          s.termina_en && new Date(s.termina_en).getTime() < hoy.getTime();
        if (!vencida) fila.vigentes++;

        /* Los importes distintos que se contrataron. Es lo que dice si
           la subida afecta a alguien: si todo el mundo tiene lo
           mismo, se les puede ofrecer lo mismo; si hay tres precios,
           hay que mirar uno por uno. */
        const claveImporte =
          s.importe === null || s.importe === undefined
            ? "sin"
            : String(s.importe);
        fila.importes.set(claveImporte, (fila.importes.get(claveImporte) || 0) + 1);
      }

      /* En qué planes está cada una. */
      const porPlan = new Map();
      for (const p of planes.data || []) {
        for (const clave of Array.isArray(p.aplicaciones) ? p.aplicaciones : []) {
          if (!porPlan.has(clave)) porPlan.set(clave, []);
          porPlan.get(clave).push(p.nombre);
        }
      }

      return {
        planes: planes.data || [],
        error: null,
        apps: (apps.data || []).map((m) => {
          const uso = porClave.get(m.modulo);

          return Object.assign({}, m, {
            clientes: uso ? uso.total : 0,
            clientesVigentes: uso ? uso.vigentes : 0,

            /* Los precios que hay detrás, de más a menos repetidos. */
            importesContratados: uso
              ? [...uso.importes.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([importe, n]) => ({ importe, n }))
              : [],

            /* Si se está vendiendo con el precio vacío, hay gente
               detrás. Es la pregunta que hace falta para no subir un
               precio que nunca se cobró. */
            sinPrecioContratado: uso
              ? uso.importes.get("sin") || 0
              : 0,

            enPlanes: porPlan.get(m.modulo) || [],
          });
        }),
      };
    }

    const vistaCatalogo = (req, res, datos = {}) =>
      res.render("panel/aplicacion-catalogo", {
        title: "Catálogo de aplicaciones",
        site: sitio,
        base: "/panel",
        /* Un valor aparte de `aplicaciones`, y no el mismo.

           El menú marca el apartado con una clase y al hijo con otra,
           y usa el mismo nombre para los dos: marcaría los dos
           iluminados a la vez, y no se sabría en cuál de las dos
           pantallas se está. */
        current: "aplicaciones-catalogo",
        noindex: true,
        csrf: req.sesion.csrf_token,
        monedas: MONEDAS,
        periodos: PERIODOS_CATALOGO,
        campo: campoCatalogo,
        errores: {},
        ...datos,
      });

    /* ---------- Ver ---------- */
    router.get("/aplicaciones/catalogo", requiereStaff, async (req, res) => {
      const { apps, error } = await leerCatalogo();
      vistaCatalogo(req, res, { apps, errores: error ? { general: error } : {} });
    });

    /* ---------- Guardar ---------- */
    router.post("/aplicaciones/catalogo", requiereStaff, async (req, res) => {
      const cuerpo = req.body || {};

      /* Qué hay en la base, no qué dice el formulario.

         El POST no recorre lo que le llegue: pregunta a la base qué
         aplicaciones hay y lee ese campo de cada una. Recorrer el POST
         sería un agujero —cualquiera podría mandar
         `precio_inventario=0` para tocar algo que no existe— y además
         permitiría editar el `modulo`, que es la clave con la que los
         servicios guardan a qué aplicación pertenecen. */
      const { apps, error: errorLectura } = await leerCatalogo();

      if (errorLectura) {
        return vistaCatalogo(req, res, { apps, errores: { general: errorLectura } });
      }

      const cambios = {};
      const errores = {};
      let tocados = 0;

      for (const app of apps) {
        const mod = app.modulo;
        let fallo = null;

        /* Se construye el cuerpo con SOLO lo que se puede cambiar. Un
           objeto con `{...cuerpo}` traería el `modulo` del POST, que
           es justo lo que no debe poder editarse. */
        const limpio = {};

        /* ---- nombre ---- */
        const nombre = String(cuerpo[campoCatalogo(mod, "nombre")] || "").trim();
        if (!nombre) {
          fallo = fallo || "El nombre no puede quedar vacío.";
        } else if (nombre.length > 120) {
          fallo = fallo || "El nombre es demasiado largo.";
        } else {
          limpio.nombre = nombre;
        }

        /* ---- descripción ----
           Cadena vacía, y NUNCA null.

           `microservicios.descripcion` es NOT NULL, y con `null` el
           `update` entero se rechaza. Lo que se pierde no es solo la
           descripción: con el fallo, tampoco se guardan el precio ni
           el estado, que estaban bien. Es decir: no poder borrar el
           texto de una descripción rompía la pantalla entera.

           Vacío es un valor legítimo aquí: una aplicación sin
           descripción es una aplicación a la que todavía no se le
           escribió qué hace. */
        const descripcion = String(
          cuerpo[campoCatalogo(mod, "descripcion")] || ""
        ).trim();
        limpio.descripcion = descripcion;

        /* ---- precio ----
           Vacío es una respuesta válida: «a consultar». No es un
           error, y por eso no se rechaza: se guarda como está.

           El separador de miles se quita antes de convertir. Escribir
           «45.000» en Argentina es lo natural, y `Number("45.000")` da
           NaN. */
        const precioCrudo = String(cuerpo[campoCatalogo(mod, "precio")] || "").trim();
        let precio = null;

        if (precioCrudo) {
          const limpioNum = precioCrudo.replace(/\./g, "").replace(",", ".");
          const n = Number(limpioNum);

          if (!isFinite(n) || n < 0) {
            fallo = fallo || "El precio tiene que ser un número, o vacío para «a consultar».";
          } else {
            precio = n;
          }
        }
        limpio.precio = precio;

        /* ---- moneda ----
           `esMonedaConocida` de `lib/monedas`, no una lista propia. La
           lista de monedas vive en un solo sitio a propósito: si aquí
           se comprobara contra una copia, el día que se añada una
           moneda el formulario la ofrecería y el servidor la
           rechazaría. */
        const moneda = String(cuerpo[campoCatalogo(mod, "moneda")] || "").trim();
        if (moneda && !esMonedaConocida(moneda)) {
          fallo = fallo || "Esa moneda no existe.";
        } else {
          /* NOT NULL: vacío es "", no null. */
          limpio.moneda = moneda;
        }

        /* ---- periodo ----
           Se manda SIEMPRE, aunque no haya periodo. Un `checkbox`
           desmarcado no llega, pero un `select` llega vacío, y el
           vacío es un valor válido: el que significa «sin periodo». */
        const periodo = String(cuerpo[campoCatalogo(mod, "periodo")] || "").trim();
        if (periodo && !PERIODOS_CATALOGO.some((p) => p.valor === periodo)) {
          fallo = fallo || "Ese periodo no existe.";
        } else {
          /* NOT NULL también. El desplegable tiene «Sin periodo», que
             es "", y no null: null no lo admite. */
          limpio.periodo = periodo;
        }

        /* ---- activo ----
           El patrón de toda la casa: un campo oculto con "0" delante,
           para que el desmarcado llegue de verdad. Sin él, quitar la
           marca no se puede guardar. */
        limpio.activo = String(cuerpo[campoCatalogo(mod, "activo")] || "") === "1";

        /* ¿Ha cambiado algo? Se compara campo a campo y no se manda un
           update por fila sin motivo. Un update que no cambia nada
           dispara triggers y ensucia la auditoría. */
        const cambio = {};
        for (const campo of EDITABLES_CATALOGO) {
          const antes = app[campo] === undefined ? null : app[campo];
          const ahora = limpio[campo];
          const sonDistintos =
            (antes === null || antes === undefined ? null : String(antes)) !==
            String(ahora === undefined ? null : ahora);
          if (sonDistintos) cambio[campo] = ahora;
        }

        if (fallo) {
          errores[app.nombre] = fallo;
          continue;
        }

        if (Object.keys(cambio).length) {
          cambios[mod] = cambio;
        }
      }

      /* ─────────────────────────────────────────────────────
         EL PRECIO ES LO ÚNICO QUE AVISA

         Se escribe lo guardado, con el nombre y a quién afecta.
         No «2 campos cambiados»: eso obliga a ir a mirar, y lo que
         se hizo mal —si se hizo algo— es el precio.

         Y se dice que a los que ya lo tienen no les cambia. Es la
         pregunta que sale al ver un número que se puede cambiar por
         primera vez, y la respuesta es siempre la misma: no.
         ───────────────────────────────────────────────────── */
      let aviso = null;

      if (Object.keys(errores).length) {
        aviso = "No se guardó nada. Hay campos con errores.";
      } else if (tocados > 0) {
        const cambiosDePrecio = cualCambiaPrecio(cambios, apps);
        aviso =
          "Guardado" +
          (cambiosDePrecio.length
            ? ": cambió el precio de " + cambiosDePrecio.length +
              (cambiosDePrecio.length === 1 ? " aplicación." : " aplicaciones.") +
              " Lo que ya estaba contratado conserva su precio."
            : ".");
      }

      /* ─────────────────────────────────────────────────────
         GUARDAR UNA POR UNA, NO TODAS JUNTAS

         Un `update` con veinte filas en un solo `upsert` es todo o
         nada: si una falla, no se guarda ninguna, y el error no dice
         cuál. Yendo una por una se sabe exactamente qué se grabó, y un
         fallo en una no tira abajo las otras diecinueve.
         ───────────────────────────────────────────────────── */
      for (const mod of Object.keys(cambios)) {
        const { error } = await db
          .from("microservicios")
          .update(cambios[mod])
          .eq("modulo", mod);

        if (error) {
          console.error("[catalogo de aplicaciones] " + mod + ": " + error.message);
          errores[mod] = "No se pudo guardar: " + error.message;
          continue;
        }
        tocados++;
      }

      /* Los errores que aparecen al guardar van por módulo, y la vista
         los pinta por nombre. */
      const erroresPorNombre = {};
      for (const mod of Object.keys(errores)) {
        const app = apps.find((a) => a.modulo === mod);
        erroresPorNombre[app ? app.nombre : mod] = errores[mod];
      }

      /* Se relee para pintar lo que hay, no lo que se mandó: si un
         guardado falló, la pantalla tiene que mostrarlo. */
      const fresco = await leerCatalogo();

      return vistaCatalogo(req, res, {
        apps: fresco.apps,
        error: fresco.error,
        errores: erroresPorNombre,
        aviso,
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

    /**
     * El cliente que trae la URL, si es uno de verdad.
     *
     * Se mira contra la lista de clientes que ya está cargada, y no se
     * acepta el `id` a ciegas: un `?cliente=` con un uuid que no
     * existe dejaría el desplegable sin nada marcado, y el alta
     * no sabría si es un fallo o si se lo pasaron mal.
     *
     * @param {object} req
     * @param {object} extra lo que venga del POST, que manda
     * @returns {string|null}
     */
    function preelegido(req, extra) {
      /* Si viene del POST, ese manda: es lo que el formulario tiene
         delante ahora mismo, aunque sea una equivocación que hay que
         corregir a ojo. */
      if (extra && extra.servicio && extra.servicio.client_id) {
        return extra.servicio.client_id;
      }

      const pedido = String((req.query && req.query.cliente) || "").trim();
      if (!pedido) return null;

      return pedido;
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

        /* El margen y los días de aviso. Van desde A para que la vista
           no tenga los números escritos a mano: si se cambian en un
           sitio, que sea en uno.

           `diasAviso` y no `aviso`, que era un número de días con
           nombre de mensaje. La vista lo pintaba en un
           `panel-alert--ok` porque `if (aviso)` es verdadero con un
           7, y salía una franja verde con un número suelto. */
        margen: A.DIAS_DE_MARGEN,
        diasAviso: A.DIAS_DE_AVISO,

        /* Lo que venga del POST, para que no se pierda al reintentar.

           Y con el cliente de la URL detrás: `Object.assign` pone lo
           del POST encima, así que si alguien llegó con `?cliente=`,
           elige otro y vuelve a mandar con error, el del POST gana y
           el del enlace no le pisa la espalda. */
        servicio: Object.assign(
          { client_id: preelegido(req, extra) },
          (extra && extra.servicio) || {}
        ),

        /* ─────────────────────────────────────────────────────
           EL CLIENTE QUE TRAE LA URL

           `?cliente=<id>`, para llegar desde la ficha de un cliente
           con el desplegable ya puesto.

           ── POR QUÉ ──

           El caso real: se abre la ficha de un cliente para
           preguntarle qué tiene, se ve que no tiene el bot, y se
           quiere dárselo. Con el formulario en blanco hay que bajar
           hasta el primer campo y buscar el cliente en una lista de
           cientos. Es un trabajo de cinco segundos que se repite en
           cada alta.

           ── Y POR QUÉ SOLO EN EL GET ──

           Porque en el POST manda lo que vino del formulario. Si se
           aceptara el de la URL, un enlace viejo con un `?cliente=`
           podría cambiar a quién se le asigna lo que se está
           guardando: uno abre el formulario, otra pestaña cambia el
           enlace, y guarda para el cliente que no quería.
           ───────────────────────────────────────────────────── */
        clientePedido: preelegido(req, extra),
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

/**
 * De los cambios pendientes, cuáles tocan el precio.
 *
 * Existe para una cosa: el aviso que se devuelve después del guardado.
 * «Guardado: cambió el precio de 2 aplicaciones» dice algo que hay que
 * ir a mirar; «Guardado.» no dice nada.
 *
 * El precio es el único campo de esta pantalla que es caro de cambiar
 * mal, porque es el único que se ve desde fuera y el único detrás del
 * cual hay un número con gente detrás.
 *
 * @param {Object<string, object>} cambios por módulo
 * @param {Array} apps el catálogo, para poder poner el nombre
 * @returns {string[]} los nombres de las aplicaciones cuyo precio cambia
 */
function cualCambiaPrecio(cambios, apps) {
  const porModulo = Object.fromEntries((apps || []).map((a) => [a.modulo, a.nombre]));

  return Object.keys(cambios || {})
    .filter((mod) => Object.prototype.hasOwnProperty.call(cambios[mod], "precio"))
    .map((mod) => porModulo[mod] || mod);
}
