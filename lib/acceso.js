/* =========================================================
   Nexo Studio — Qué ve el cliente de cada servicio
   ------------------------------------------------------------
   El cliente no debería ver exactamente lo mismo que ve el equipo.
   Un servicio puede estar contratado pero vencido, en pausa, o ser
   solo un presupuesto que aún no ha aceptado. En cada caso lo que
   se le enseña es distinto.

   LAS CUATRO SITUACIONES
   ----------------------
     activo     Lo ve entero. Es lo suyo, en marcha y al día.
                OJO: es SOLO LECTURA. El cliente ve, no toca. Que
                pudiera editar su servicio sería un agujero de
                negocio: se cambiaría a sí mismo el estado.

     bloqueado  Tiene algo VENCIDO, es decir pasado el plazo de
                pago (20 días desde la emisión). Se le dice qué y
                cuánto debe, porque sin eso no puede pagar. El
                detalle interno no se enseña.

                OJO: el bloqueo NO lleva recargo ni interés. El
                importe es el mismo indefinidamente; el bloqueo
                existe para que el pendiente se vea y se pague, no
                para sancionar.

     inactivo   Se ve, pero con la etiqueta de que no está en marcha.
                Un cliente con un proyecto entregado en agosto sigue
                queriendo verlo: no es un dato que haya que ocultarle.

     oferta     Un presupuesto que todavía no ha aceptado. Se ve con
                el precio, porque si no no puede decidir. Ocultarle
                el importe de una oferta sería absurdo.

   POR QUÉ ES UNA FUNCIÓN Y NO UNA COLUMNA
   ----------------------------------------
   Porque el acceso depende de dos cosas que ya cambian solas: el
   estado del servicio y si sus cobros están al día. Si se guardara en
   una columna, habría que acordarse de recalcularla cada vez que se
   marca un cobro, y bastaría un olvido para que un cliente viera (o
   no viera) lo que no toca.

   Aquí se calcula en el momento, con los datos de ahora. Si algún día
   hace falta guardarlo, esta función pasa a ser la que rellena la
   columna, y el criterio queda escrito en un solo sitio.

   IMPORTANTE: esto NO es seguridad
   ---------------------------------
   El cliente solo recibe sus propios datos (eso lo garantiza RLS, en
   la base de datos). Aquí no se le oculta nada suyo: se decide qué
   se le enseña. Es una decisión de negocio y de trato, no un candado.
   Por eso el bloqueo es visual y el aislamiento es real, en otro
   sitio.
   ========================================================= */

const L = require("./labels");
const { vencio } = require("./fechas");

/* Cobros que forman deuda: pendiente o impagado.
   Los anulados no cuentan: se emitieron mal y no debe nada. */
function deudaDe(cobros) {
  return (cobros || []).filter((c) => c.estado === "pendiente" || c.estado === "impagado");
}

/**
 * Decide si una deuda está VENCIDA, que no es lo mismo que estar
 * pendiente.
 *
 * Decisión de negocio, y debatable: una factura que vence el 30 del
 * mes que viene NO bloquea nada. Bloquear por ella sería castigar al
 * cliente por algo que todavía no tenía que pagar, y un panel lleno
 * de candados acaba enseñando a la gente a ignorar los avisos de
 * verdad.
 *
 * Solo bloquea cuando:
 *   - ya está marcado como impagado, o
 *   - su fecha de vencimiento ya pasó.
 *
 * Sin fecha de vencimiento no se bloquea: no hay forma de saber si
 * toca, así que se avisa del pendiente en vez de vetar el acceso.
 *
 * EL DÍA DEL VENCIMIENTO CUENTA ENTERO
 * ------------------------------------
 * Un cobro que vence hoy todavía se puede pagar hoy: `vencio()`
 * compara días naturales, no instantes. Comparando instantes, a las
 * 09:00 de la fecha límite el cobro ya contaba como vencido y el
 * cliente perdía el acceso antes de que le diera tiempo a pagar.
 *
 * OJO con esto al escribir código nuevo: `new Date('2026-10-22')`
 * son las 00:00 UTC, no la medianoche local. En una zona negativa
 * esa fecha "vence" en realidad el día anterior. Por eso el
 * cálculo va en lib/fechas.js y no suelto aquí.
 */
function vencido(c, hoy) {
  if (c.estado === "impagado") return true;
  if (c.estado !== "pendiente") return false;
  if (!c.vence_en) return false;
  return vencio(c.vence_en, hoy);
}

const MOTIVOS = {
  pausado: "Lo tienes en pausa. Se puede volver a activar cuando quieras.",
  finalizado: "Este servicio ya terminó. Aquí queda el histórico.",
  cancelado: "Este servicio se canceló.",
};

/**
 * Decide el acceso de un servicio.
 *
 * @param {object} servicio  Fila de `services`
 * @param {Array}  cobros    Cobros de ESE servicio
 * @param {Date}   hoy
 * @returns {{nivel, titulo, motivo, accion, detalle}}
 */
function accesoDe(servicio, cobros = [], hoy = new Date()) {
  const debts = deudaDe(cobros);
  const vencidos = debts.filter((c) => vencido(c, hoy));

  const sumar = (lista) =>
    lista.reduce((t, c) => t + (Number(c.importe) || 0) - (Number(c.descuento) || 0), 0);

  const pendiente = sumar(debts);
  const vencidoImporte = sumar(vencidos);

  /* ---------- 1. Si está vencido, va bloqueado ----------
     Va por delante de todo. Un servicio "activo" con un cobro
     vencido no es un servicio activo: es una deuda, y enseñarle la
     ficha como si no pasara nada sería deshonesto por las dos
     partes. */
  if (vencidos.length) {
    return {
      nivel: "bloqueado",
      titulo: "Pendiente de pago",
      motivo:
        vencidos.length === 1
          ? "Hay un cobro vencido."
          : "Hay " + vencidos.length + " cobros vencidos.",
      /* El importe SÍ se enseña. Es lo que debe y tiene que poder
         pagarlo: ocultárselo no protege de nada. */
      detalle: { pendiente: vencidoImporte, vencidos: vencidos.length },
      accion: "Ver el pendiente y pagar",
    };
  }

  /* ---------- 2. Presupuesto sin aceptar ----------
     No está contratado: es una oferta. Se ve el precio, porque si no
     no puede decidir. Ocultarle el importe de una oferta es absurdo. */
  if (servicio.kind === "presupuesto" && servicio.estado === "pendiente") {
    return {
      nivel: "oferta",
      titulo: "Presupuesto sin aceptar",
      motivo: "Te hemos enviado este presupuesto. Si te sirve, contesta y lo activamos.",
      detalle: {},
      accion: "Aceptar o preguntar",
    };
  }

  /* ---------- 3. En marcha ----------
     Aunque tenga una factura emitida que aún no vence, se ve entera.
     Se le avisa del importe al lado: eso es información, no un veto. */
  if (servicio.estado === "activo" || servicio.estado === "en_curso") {
    return {
      nivel: "activo",
      titulo: L.ESTADO[servicio.estado] || servicio.estado,
      motivo: debts.length ? "Tienes una factura emitida. Aún no vence." : "",
      detalle: debts.length ? { pendiente } : {},
      accion: "",
    };
  }

  /* ---------- 4. Todo lo demás: visible, pero no en marcha ----------
     Pausado, finalizado o cancelado. Se enseña, porque es historial
     del cliente, pero se dice claramente que no está en marcha. */
  return {
    nivel: "inactivo",
    titulo: L.ESTADO[servicio.estado] || servicio.estado,
    motivo: MOTIVOS[servicio.estado] || "",
    detalle: {},
    accion: "",
  };
}

/**
 * Agrupa los servicios del cliente por nivel de acceso y calcula las
 * cifras de arriba.
 *
 * @param {Array} servicios
 * @param {Array} cobros     Todos los cobros de ESOS servicios
 * @param {Date}  hoy
 */
function agrupar(servicios, cobros, hoy = new Date()) {
  const porServicio = new Map();
  for (const c of cobros || []) {
    if (!porServicio.has(c.service_id)) porServicio.set(c.service_id, []);
    porServicio.get(c.service_id).push(c);
  }

  const lista = (servicios || []).map((s) => {
    const suyos = porServicio.get(s.id) || [];
    return {
      ...s,
      acceso: accesoDe(s, suyos, hoy),
      /* Cuántos cobros tiene, y si alguno está cobrado: le sirve
         para entender de dónde sale el "pendiente de pago". */
      numCobros: suyos.length,
      pagado: suyos.some((c) => c.estado === "pagado"),
    };
  });

  /* Primero lo que requiere una acción del cliente. */
  const peso = { bloqueado: 0, oferta: 1, activo: 2, inactivo: 3 };
  lista.sort((a, b) => peso[a.acceso.nivel] - peso[b.acceso.nivel]);

  const cuenta = (n) => lista.filter((x) => x.acceso.nivel === n).length;

  return {
    lista,
    cuenta: {
      bloqueado: cuenta("bloqueado"),
      oferta: cuenta("oferta"),
      activo: cuenta("activo"),
      inactivo: cuenta("inactivo"),
    },
    /* Lo que hay pendiente de cobrarle, para el titular. */
    pendiente: lista
      .filter((x) => x.acceso.nivel === "bloqueado")
      .reduce((t, x) => t + (x.acceso.detalle.pendiente || 0), 0),
  };
}

module.exports = { accesoDe, agrupar, deudaDe, vencido, MOTIVOS };
