/* =========================================================
   Nexo Studio — Panel: cobros
   ------------------------------------------------------------
   Qué se ha emitido y qué se ha cobrado. Es la vista que se mira al
   cerrar el mes, así que el foco NO es el listado completo (eso ya
   lo hace la tabla de servicios) sino dos cosas:

     - Lo que falta por cobrar, arriba y visible.
     - El histórico, que se consulta pero no se lee cada día.

   Por eso el listado arranca filtrado por "por cobrar" en vez de
   por fecha: lo primero que importa es qué debt hay.

   SEGUIMIENTO DE ESTADOS
   -----------------------
   Un cobro NO se borra nunca: se anula. Marcar un cobro pagado como
   pendiente por error y que desaparezca deja un hueco en la
   contabilidad que nadie sabe explicar. Anulado conserva la fila y
   además registra el motivo.

   Al marcar un cobro como pagado, `pagado_en` se rellena solo con la
   fecha de hoy. No se pide: nadie recuerda la fecha exacta de un pago
   que acaba de hacer, y casi siempre es hoy.
   ========================================================= */

const express = require("express");
const auth = require("../lib/auth");
const L = require("../lib/labels");
const cm = require("../lib/cobros-mensuales");
const { iso, aDia, aFecha, vencio } = require("../lib/fechas");
const { validar, vacioANull } = require("../lib/validate");

const POR_PAGINA = 40;

/* Los estados del cobro (ENUM cobro_estado) viven en lib/labels.js.
   Este router tenía su propio mapa ETIQUETA, duplicado del de
   consultas y del de servicios. */
const ESTADOS = L.OPCIONES_COBRO;

const MESES = {
  "01": "enero", "02": "febrero", "03": "marzo", "04": "abril",
  "05": "mayo", "06": "junio", "07": "julio", "08": "agosto",
  "09": "septiembre", "10": "octubre", "11": "noviembre", "12": "diciembre",
};

const dinero = (n, moneda) =>
  n === null || n === undefined
    ? null
    : new Intl.NumberFormat("es-ES", { style: "currency", currency: moneda || "EUR" }).format(n);

const fechaCorta = (v) => {
  if (!v) return "—";
  /* `aFecha` y no `new Date(v)`: una fecha "YYYY-MM-DD" parseada
     como UTC se ve del día ANTERIOR en zonas negativas, que es donde
     está la máquina de desarrollo. Al usuario se le enseñaba el día
     que no es. */
  const f = aFecha(v);
  if (!f) return "—";
  return f.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
};

/** "2026-10" -> "octubre 2026" */
function periodoLargo(periodo) {
  if (!periodo) return "sin periodo";
  const [a, m] = periodo.split("-");
  return (MESES[m] || m) + " " + a;
}

/* Cuántos días lleva sin pagarse. Se pinta en rojo si se pasa.

   Compara por DÍAS, no por instantes: un cobro que venció hoy
   muestra 0 días de retraso, no un número negativo o fraccional
   según la hora. Es el mismo criterio que usa lib/fechas.js para
   decidir el bloqueo, y tiene que coincidir con él: si esta cifra
   dijera 3 y el bloqueo llevara 2, el panel daría dos Numbers
   distintos de la misma realidad. */
function diasDeRetraso(vence, estado) {
  if (estado === "pagado" || !vence) return null;
  const dias = Math.floor((aDia(new Date()).getTime() - aDia(vence).getTime()) / 86400000);
  return dias > 0 ? dias : null;
}

const ESQUEMA = {
  service_id: ["requerido"],
  periodo: ["periodo"],
  concepto: [["texto", { max: 200 }]],
  importe: ["requerido", "importe"],
  descuento: ["importe"],
  emitido_en: ["fecha"],
  vence_en: ["fecha"],
  referencia: [["texto", { max: 80 }]],
  notas: [["texto", { max: 2000 }]],
};

/** Valida "2026-10" */
const RE_PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Lo que necesita la vista del formulario aparte del cobro.
 *
 * Va en una función porque el formulario se renderiza en tres sitios
 * (el GET inicial y los dos POST, uno por error). Si el plazo se
 * pasara a mano en los tres, un día se olvidaría en uno y el
 * formulario se vería sin el texto que explica cuándo vence.
 */
function paraElFormulario(hoy) {
  return {
    diasPlazo: cm.DIAS_VENCIMIENTO,
    venceSugerido: cm.fechaVence(hoy),
  };
}

module.exports = function rutasCobros({ db, sitio, requiereStaff }) {
  const router = express.Router();

  /* ---------- Listado ---------- */
  router.get("/cobros", requiereStaff, async (req, res) => {
    const estado = String(req.query.estado || "").trim();
    const periodo = String(req.query.periodo || "").trim();
    const q = String(req.query.q || "").trim();
    const pagina = Math.max(1, parseInt(req.query.pagina || "1", 10) || 1);
    const desde = (pagina - 1) * POR_PAGINA;

    /* ── "vencido" NO es un estado ──
     *
     * En la base los estados son pendiente, impagado, pagado y anulado.
     * Vencido es otra cosa: un pendiente cuya fecha ya pasó. Por eso
     * no se puede filtrar con `.eq("estado", "vencido")` — devolvería
     * una lista vacía, sin error, que es lo peor que puede pasar un
     * filtro: parece que no hay nada vencido.
     *
     * Y hace falta, porque es lo que se mira. La portada enlaza aquí
     * con ?estado=vencido, y sin este bloque el enlace llevaba a una
     * página en blanco. */
    const VENCIDO = "vencido";
    const hoy = new Date().toISOString().slice(0, 10);

    let consulta = db
      .from("cobros")
      .select("*, services(titulo,kind,estado,clients(id,empresa,nombre))", { count: "exact" });

    if (estado === VENCIDO) {
      /* Lo vencido es un pendiente con fecha pasada. Un impagado cuenta
         como vencido también: se emitió, no se cobró y pasó la fecha.
         Por eso no se limita a `pendiente`. */
      consulta = consulta
        .in("estado", ["pendiente", "impagado"])
        .lt("vence_en", hoy);
    } else if (estado) {
      consulta = consulta.eq("estado", estado);
    }
    if (periodo) consulta = consulta.eq("periodo", periodo);
    if (q) {
      const patron = "%" + q.replace(/[%_]/g, (m) => "\\" + m) + "%";
      consulta = consulta.or(`concepto.ilike.${patron},referencia.ilike.${patron}`);
    }

    /* Los anulados no aparecen salvo que los pidas: son ruido. */
    if (!estado) consulta = consulta.neq("estado", "anulado");

    const { data, error, count } = await consulta
      .order("emitido_en", { ascending: false, nullsFirst: false })
      .range(desde, desde + POR_PAGINA - 1);

    if (error) console.error("[cobros] " + error.message);

    /* Cifras: del mes en curso y del pendiente total. */
    /* El periodo en curso. `toISOString().slice(0,7)` daría el mes
       equivocado los días 1 y 2 del mes en zonas negativas: el 1 de
       octubre a las 23:00 en Buenos Aires ya es el 2 en UTC, y el
       resumen del mes enseñaría un periodo que aún no ha empezado. */
    const mesActual = iso(new Date()).slice(0, 7);

    const [mes, porEstado] = await Promise.all([
      db.from("v_cobros_mensual").select("*").eq("periodo", mesActual).maybeSingle(),
      db
        .from("cobros")
        .select("estado,importe,descuento,vence_en")
        .in("estado", ["pendiente", "impagado", "pagado"]),
    ]);

    /* Sumar en JS y no en SQL: son pocas filas (de miles) y así el
       mismo código sirve para el resumen del panel. */
    const suma = { pendiente: 0, impagado: 0, pagado: 0 };

    /* Y lo VENCIDO: lo pendiente o impagado cuya fecha ya pasó.
       Antes esta tarjeta decía "8.809 € por cobrar" y seacababa ahí,
       cuando 7.809 de esos euros estaban fuera de plazo. Es la
       diferencia entre "hay que mirar" y "hay que llamar a alguien".

       Ojo: no es lo mismo que `impagado`. Un impagado está en mora
       pero su fecha puede no haber llegado. Aquí va por fecha, que es
       lo que el filtro Vencidos de más abajo usa — si las dos cosas
       no contaran lo mismo, el número de la cabecera no cuadraría con
       las filas de la lista. */
    let vencido = 0;
    let nVencidos = 0;

    for (const c of porEstado.data || []) {
      suma[c.estado] = (suma[c.estado] || 0) + (Number(c.importe) - Number(c.descuento || 0));

      if (c.estado !== "pagado" && c.vence_en && c.vence_en < hoy) {
        vencido += Number(c.importe) - Number(c.descuento || 0);
        nVencidos++;
      }
    }

    /* Periodos que existen, para el filtro. */
    const { data: periodos } = await db
      .from("cobros")
      .select("periodo")
      .not("periodo", "is", null)
      .order("periodo", { ascending: false })
      .limit(24);

    const total = count || 0;

    res.render("panel/cobros", {
      title: "Cobros",
      site: sitio,
      base: "/panel",
      current: "cobros",
      cobros: data || [],
      estados: ESTADOS,
      /* Traduce el estado de la base ("pagado") al texto que se
         enseña ("Pagado"). */
      etiqueta: L.etiquetaCobro,
      dinero,
      fechaCorta,
      periodoLargo,
      diasDeRetraso,
      /* Lo vencido, para el pie de la tarjeta roja. */
      vencido,
      nVencidos,
      estado,
      periodo,
      q,
      pagina,
      paginas: Math.max(1, Math.ceil(total / POR_PAGINA)),
      total,
      desde: total === 0 ? 0 : desde + 1,
      hasta: Math.min(desde + POR_PAGINA, total),
      periodos: [...new Set((periodos || []).map((p) => p.periodo))],
      /* La vista pinta el mensaje de éxito de un POST reciente. */
      aviso: req.query.creado === "1" ? "Cobro emitido." : null,
      resumen: {
        mes: mesActual,
        mesCobrado: mes && mes.data ? Number(mes.data.cobrado) : 0,
        mesPendiente: mes && mes.data ? Number(mes.data.pendiente) : 0,
        pendiente: suma.pendiente,
        impagado: suma.impagado,
        pagado: suma.pagado,
      },
    });
  });

  /* ---------- Generar los cobros del mes ----------

     Dos pasos a propósito. Primero se enseña el plan (qué se crearía,
     qué se salta y por qué), y solo después se confirma.

     Con un solo botón que crea datos, el primero que lo pulsa sin
     mirar se lleva una sorpresa; y como no se puede deshacer (los
     cobros no se borran, se anulan, y anular 12 uno a uno es un
     castigo), mejor que nada ocurra hasta haberlo leído.

     El plan lo calcula lib/cobros-mensuales.js, con pruebas. La ruta
     NO decide qué crear: solo ejecuta el plan. Si esa función
     cambiara, la vista previa y lo que se crea no pueden separarse. */
  const datosParaElPlan = async () => {
    const { data: servicios } = await db
      .from("services")
      .select("id,titulo,importe,moneda,periodicidad,estado,clients(id,empresa,nombre)")
      .in("estado", ["activo", "pausado", "cancelado", "finalizado", "en_curso", "pendiente"]);

    /* Los cobros de ESOS servicios. Traer todos los de la tabla sería
       fácil y wasteful: se acumulan doce al año por cliente y aquí
       solo hacen falta para saber qué ya está facturado. */
    let cobros = [];
    if ((servicios || []).length) {
      const { data: susCobros } = await db
        .from("cobros")
        .select("service_id,periodo,estado,vence_en,importe")
        .in("service_id", servicios.map((s) => s.id));
      cobros = susCobros || [];
    }

    return { servicios: servicios || [], cobros };
  };

  router.get("/cobros/generar", requiereStaff, async (req, res) => {
    const pedido = String(req.query.periodo || "");
    const periodo = cm.periodoValido(pedido) ? pedido : cm.periodoActual();

    const { servicios, cobros } = await datosParaElPlan();
    const plan = cm.plan(periodo, servicios, cobros);

    /* Mensaje de resultado. Se compone aquí y no en la vista: el
       texto lleva números que vienen de la petición, y mezclarlos
       en el HTML es donde se desincronizan las cosas. */
    let aviso = null;
    if (req.query.hecho !== undefined) {
      const n = Number(req.query.hecho) || 0;
      aviso = n
        ? "Se han creado " + n + (n === 1 ? " cobro" : " cobros") + " de " + periodoLargo(periodo) + "."
        : "No había nada que generar de " + periodoLargo(periodo) + ".";
    }
    if (req.query.bloqueados) {
      aviso +=
        " Quedan " + req.query.bloqueados + " sin facturar porque ya deben: revísalo antes.";
    }

    res.render("panel/cobros-generar", {
      title: "Generar cobros",
      site: sitio,
      base: "/panel",
      current: "cobros",
      periodo,
      periodos: [periodo, ...cm.periodosAnteriores()],
      plan,
      dinero,
      periodoLargo,
      /* El plazo va a la vista para que el equipo vea que vence 20
         días DESDE la emisión y no el día 20 del mes. Es la decisión
         que más surprised podría dar si se leyera el código. */
      diasPlazo: cm.DIAS_VENCIMIENTO,
      hoy: iso(new Date()),
      aviso,
      error: req.query.error ? "No se pudo generar: " + req.query.error : null,
    });
  });

  /* TODO(automatico): esto solo corre cuando alguien entra aquí y
     pulsa el botón. Falta el ejecutor que lo haga solo cada mes
     (cron externo llamando a un endpoint, o node-cron dentro del
     proceso). Ojo con una cosa antes de hacerlo desatendido: la
     auditoría de más abajo firma con req.sesion, que en una
     ejecución automática no existe, así que habrá que decidir quién
     figura como autor. Ver PENDIENTES.md. */
  router.post("/cobros/generar", requiereStaff, async (req, res) => {
    const periodo = String(req.body.periodo || "");
    if (!cm.periodoValido(periodo)) return res.redirect("/panel/cobros/generar");

    /* Se vuelve a calcular el plan aquí, en el momento de confirmar,
       y no se usa el que venía del formulario. Motivo: entre la vista
       previa y el clic pueden haber pasado minutos y algo cambiar
       (alguien marcó un cobro). Si se confirmara a ciegas lo que se
       vio hace un rato, se podrían crear cobros que ya existen; el
       UNIQUE de la base lo evitaría, pero el error le saldría al
       usuario sin explicación. Con el plan recalculado, lo que se
       crea es exactamente lo que dice la pantalla. */
    const hoy = new Date();

    /* OJO: `fechas.iso()` y no `toISOString().slice(0,10)`. Este
       último devuelve la fecha en UTC, que en una zona negativa es
       el día ANTERIOR al que se emite de verdad.

       Y es la MISMA fecha que se le pasa al `plan`, porque el plazo
       de pago se cuenta desde la emisión. Si el plan se calcula con
       un día y se inserta con otro, el vencimiento se desplaza un
       día respecto de lo que la vista previa enseñó. */
    const { servicios, cobros } = await datosParaElPlan();
    const plan = cm.plan(periodo, servicios, cobros, hoy);

    if (!plan.crear.length) {
      return res.redirect(
        "/panel/cobros/generar?hecho=0&periodo=" + encodeURIComponent(periodo)
      );
    }

    const emitido = iso(hoy);
    const filas = cm.aFilas(plan).map((f) => ({ ...f, emitido_en: emitido }));

    /* insert() es atómico: o entran todos o no entra ninguno. Con
       inserciones de uno en uno, un fallo a mitad dejaría el mes a
       medio facturar sin que se note. */
    const { data: creados, error } = await db.from("cobros").insert(filas).select("id");

    if (error) {
      return res.redirect(
        "/panel/cobros/generar?error=" + encodeURIComponent(error.message)
      );
    }

    /* Se apunta en la auditoría qué se emitió y por qué importe. Sin
       esto, dentro de tres meses nadie sabe si esos cobros se
       generaron solos o los hizo alguien a mano. */
    await auth.auditar(db, {
      actor: { id: req.sesion.user_id, email: null },
      accion: "generar-cobros",
      entidad: "cobros",
      /* Varios ids no caben en entidad_id: se deja el periodo, que
         es lo que identifica la tanda. */
      entidadId: periodo,
      detalle: {
        periodo,
        creados: (creados || []).length,
        importe: plan.importe,
        omitidos: plan.saltar.length,
        bloqueados: plan.bloqueados.length,
      },
      req,
    });

    res.redirect(
      "/panel/cobros/generar?hecho=" +
        (creados || []).length +
        "&periodo=" +
        encodeURIComponent(periodo) +
        (plan.bloqueados.length ? "&bloqueados=" + plan.bloqueados.length : "")
    );
  });

  /* ---------- Marcar pagado ----------
     Es la acción que más se usa del bloque: por eso no pide
     formulario, se resuelve con un clic. */
  router.post("/cobros/:id/pagado", requiereStaff, async (req, res) => {
    const { data: actual } = await db.from("cobros").select("estado,importe").eq("id", req.params.id).maybeSingle();

    if (!actual) return res.redirect("/panel/cobros");

    /* Idempotente: pulsar dos veces no rompe nada.
       La fecha es la de HOY, no la que se pasó al reenviar el
       formulario con el F5. */
    const { error } = await db
      .from("cobros")
      .update({
        estado: "pagado",
        pagado_en: iso(new Date()),
      })
      .eq("id", req.params.id)
      .neq("estado", "pagado");

    await auth.auditar(db, {
      actor: { id: req.sesion.user_id, email: null },
      accion: "cobrar",
      entidad: "cobros",
      entidadId: req.params.id,
      detalle: { antes: actual.estado, importe: actual.importe },
      req,
    });

    res.redirect(volver(req));
  });

  /* ---------- Volver a pendiente ----------
     Se necesita: si marcas algo pagado por error, la única salida
     siendo un clic es deshacerlo. */
  router.post("/cobros/:id/pendiente", requiereStaff, async (req, res) => {
    const { data: actual } = await db.from("cobros").select("estado").eq("id", req.params.id).maybeSingle();
    if (!actual) return res.redirect("/panel/cobros");

    const { error } = await db
      .from("cobros")
      .update({ estado: "pendiente", pagado_en: null })
      .eq("id", req.params.id);

    await auth.auditar(db, {
      actor: { id: req.sesion.user_id, email: null },
      accion: "deshacer-cobro",
      entidad: "cobros",
      entidadId: req.params.id,
      detalle: { antes: actual.estado },
      req,
    });

    res.redirect(volver(req));
  });

  /* ---------- Anular ---------- */
  router.post("/cobros/:id/anular", requiereStaff, async (req, res) => {
    const { data: actual } = await db.from("cobros").select("estado,importe").eq("id", req.params.id).maybeSingle();
    if (!actual) return res.redirect("/panel/cobros");

    /* Motivo obligatorio: un cobro anulado sin explicación es
       indistinguible de un error. */
    const motivo = String((req.body && req.body.motivo) || "").trim();
    if (motivo.length < 3) return res.redirect("/panel/cobros");

    const { error } = await db
      .from("cobros")
      .update({
        estado: "anulado",
        notas: motivo,
        pagado_en: null,
      })
      .eq("id", req.params.id);

    await auth.auditar(db, {
      actor: { id: req.sesion.user_id, email: null },
      accion: "anular",
      entidad: "cobros",
      entidadId: req.params.id,
      detalle: { antes: actual.estado, importe: actual.importe, motivo },
      req,
    });

    res.redirect(volver(req));
  });

  /* ---------- Nuevo cobro ----------
     Para lo que no viene de un servicio recurrente: un cobro suelto,
     un extra, una consultoría puntual.

     El formulario viene YA con la fecha límite puesta (emisión + 20
     días) en lugar de vacía. Antes se dejaba en blanco porque no
     importaba mucho; ahora que el plazo de pago decide si el cliente
     pierde el acceso, enviarlo vacío significa enviarlo sin
     vencimiento, que no bloquea nunca. Es decir: el valor por defecto
     que no producía bloqueo era justo el que más problemas creaba. */
  router.get("/cobros/nuevo", requiereStaff, async (req, res) => {
    const { data: servicios } = await db
      .from("services")
      .select("id,titulo,kind,importe,moneda,clients(id,empresa,nombre)")
      .eq("estado", "activo")
      .order("titulo");

    const hoy = new Date();

    res.render("panel/cobro-form", {
      title: "Nuevo cobro",
      site: sitio,
      base: "/panel",
      current: "cobros",
      servicios: servicios || [],
      dinero,
      ...paraElFormulario(hoy),
      cobro: {
        service_id: String(req.query.servicio || ""),
        periodo: "",
        concepto: "",
        importe: "",
        descuento: "",
        emitido_en: iso(hoy),
        vence_en: cm.fechaVence(hoy),
        referencia: "",
        notas: "",
      },
      errores: {},
    });
  });

  router.post("/cobros/nuevo", requiereStaff, async (req, res) => {
    const { errores, datos } = validar(req.body, ESQUEMA);

    /* El periodo no viene del validador genérico porque su formato
       es propio: tiene que ser un mes real. */
    if (datos.periodo && !RE_PERIODO.test(datos.periodo)) {
      errores.periodo = "Usa el formato AAAA-MM.";
    }
    /* La comparación va por días naturales con `vencio()`, no con `<`
       sobre dos `new Date()`. Con Dates, "vence hoy" daría error
       desde las 00:00 y el usuario no podría ni guardar el día que
       le toca pagar. */
    if (errores.vence_en || (datos.vence_en && datos.emitido_en &&
        vencio(datos.vence_en, datos.emitido_en))) {
      errores.vence_en = "No puede vencerse antes de emitirse.";
    }

    const { data: servicios } = await db
      .from("services")
      .select("id,titulo,importe,moneda,periodicidad")
      .eq("id", datos.service_id || "___")
      .maybeSingle();

    /* Si no se escribe concepto, se hereda el del servicio. Es lo
       que se quiere el 90% de las veces y ahorra teclear. */
    if (!datos.concepto && servicios) datos.concepto = servicios.titulo;
    if (!datos.importe && servicios && servicios.importe !== null) {
      datos.importe = servicios.importe;
    }

    if (Object.keys(errores).length) {
      return res.status(400).render("panel/cobro-form", {
        title: "Nuevo cobro",
        site: sitio,
        base: "/panel",
        current: "cobros",
        servicios: servicios ? (await db.from("services").select("id,titulo,kind,importe,moneda,clients(id,empresa,nombre)").eq("estado", "activo")).data || [] : [],
        dinero,
        ...paraElFormulario(new Date()),
        cobro: datos,
        errores,
      });
    }

    const num = (v) => (v ? Number(String(v).replace(/\./g, "").replace(",", ".")) : null);

    const { data, error } = await db
      .from("cobros")
      .insert({
        service_id: datos.service_id,
        periodo: vacioANull(datos.periodo),
        concepto: datos.concepto || "Cobro",
        importe: num(datos.importe) || 0,
        descuento: num(datos.descuento) || 0,
        moneda: servicios ? servicios.moneda : "EUR",
        estado: "pendiente",
        emitido_en: vacioANull(datos.emitido_en),
        /* Si no se escribió fecha, se pone el plazo por defecto en vez
           de dejar el cobro SIN vencimiento. Sin `vence_en` no vence
           nunca, o sea que un campo vacío en el formulario equivale a
           "este cliente no bloquea jamás", que no es lo que quiere
           decir quien deja el campo en blanco. */
        vence_en: vacioANull(datos.vence_en) || cm.fechaVence(datos.emitido_en || new Date()),
        referencia: vacioANull(datos.referencia),
        notas: vacioANull(datos.notas),
      })
      .select()
      .single();

    if (error) {
      return res.status(500).render("panel/cobro-form", {
        title: "Nuevo cobro",
        site: sitio,
        base: "/panel",
        current: "cobros",
        servicios: [],
        dinero,
        ...paraElFormulario(new Date()),
        cobro: datos,
        errores: { general: "No se pudo guardar: " + error.message },
      });
    }

    await auth.auditar(db, {
      actor: { id: req.sesion.user_id, email: null },
      accion: "crear",
      entidad: "cobros",
      entidadId: data.id,
      detalle: { importe: data.importe, periodo: data.periodo },
      req,
    });

    res.redirect("/panel/cobros?creado=1");
  });

  return router;
};

/** Vuelve a la vista que estabas mirando, no al principio */
function volver(req) {
  const v = (req.body && req.body.volver) || "";
  return String(v).startsWith("/panel") ? v : "/panel/cobros";
}
