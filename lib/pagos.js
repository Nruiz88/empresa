/* =========================================================
   Shopcito — Confirmar un pago: activar el servicio y dar el bot
   ------------------------------------------------------------
   "El cliente pagó" tiene que significar lo mismo venga de donde
   venga: de marcar un cobro a mano en el panel, o de la webhook de
   MercadoPago. Todo eso pasa por `confirmarPago()`, que es lo único
   que activa un servicio y da de alta el bot.

   ── POR QUÉ ESTÁ EN lib/ Y NO EN UNA RUTA ──
   Porque lo llaman tres sitios (panel-cobros, el webhook de
   MercadoPago y la autorización de una suscripción). Cuando esa
   lógica vivía dentro de una ruta, el webhook no la podía usar sin
   copiarla, y dos copias del "activar un servicio" acaban diciendo
   cosas distintas.
   ========================================================= */

const auth = require("./auth");
const botsLib = require("./bots");

/** El día de hoy, en AAAA-MM-DD (UTC). */
const hoyISO = () => new Date().toISOString().slice(0, 10);

/** '2026-10' del día de hoy. */
const periodoActual = () => hoyISO().slice(0, 7);

/**
 * Un período después de `desde`, o de hoy si `desde` ya pasó.
 *
 * Se usa para alargar la suscripción cuando MercadoPago confirma un
 * cobro recurrente. Se cuenta por MESES enteros, no por 30 días: un
 * cobro mensual el 31 de enero tiene que caer en febrero, no en marzo.
 *
 * @param {string|null} desdeISO  AAAA-MM-DD
 * @returns {string} AAAA-MM-DD
 */
function unPeriodoDespues(desdeISO) {
  const hoy = hoyISO();
  const base = desdeISO && desdeISO > hoy ? desdeISO : hoy;
  const d = new Date(base + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Lo que pasa cuando un pago se confirma.
 *
 * ── QUÉ HACE ──
 *
 *   1. Si el servicio estaba en `pendiente` (una venta cerrada a la
 *      espera del primer pago), lo pasa a `activo`. Solo desde
 *      `pendiente`: un servicio pausado, finalizado o cancelado no se
 *      reactiva por cobrar una factura.
 *   2. Si con eso el cliente tiene derecho al bot y no lo tiene, se lo
 *      da de alta. Quién decide "tiene derecho" es `tiene_modulo` en la
 *      base (migración 032), no esta función.
 *
 * Todo es idempotente y no lanza: un fallo al crear el bot no puede
 * tumbar el registro del pago.
 *
 * @param {object} db
 * @param {{serviceId: string, actor?: object, req?: object}} opciones
 * @returns {Promise<object|void>}
 */
async function confirmarPago(db, opciones) {
  const { serviceId, actor, req } = opciones || {};
  if (!serviceId) return;

  const { data: servicio } = await db
    .from("services")
    .select("id,client_id,estado")
    .eq("id", serviceId)
    .maybeSingle();

  if (!servicio) return;

  if (servicio.estado === "pendiente") {
    const { error } = await db
      .from("services")
      .update({ estado: "activo" })
      .eq("id", servicio.id);

    if (error) {
      console.error("[pagos] no se pudo activar el servicio tras el pago:", error.message);
      return;
    }
  }

  let bot;
  try {
    bot = await botsLib.ponerBotSiTieneAcceso(db, servicio.client_id);
  } catch (e) {
    console.error("[pagos] no se pudo dar de alta el bot tras el pago:", e.message);
    return;
  }

  if (bot && bot.creado) {
    try {
      await auth.auditar(db, {
        actor: actor || { id: null, email: null },
        accion: "crear-bot",
        entidad: "bots",
        entidadId: bot.botId,
        detalle: {
          client_id: servicio.client_id,
          server_id: bot.caja.id,
          server_name: bot.caja.name,
          slug: bot.slug,
          origen: (opciones && opciones.origen) || "pago",
        },
        req,
      });
    } catch (e) {
      console.error("[pagos] no se pudo auditar el bot:", e.message);
    }
  }

  return bot;
}

/**
 * El estado de una suscripción de MercadoPago.
 *
 * Guarda/actualiza el puente `preapproval_id` <-> `services.id` y, si
 * está autorizada, activa el servicio (que es el primer pago).
 *
 * @param {object} db
 * @param {{preapproval: object, actor?: object, req?: object}} opciones
 * @returns {Promise<{ok: boolean, motivo?: string, activado?: boolean}>}
 */
async function aplicarSuscripcion(db, opciones) {
  const pre = (opciones && opciones.preapproval) || {};
  const preapprovalId = pre.id ? String(pre.id) : null;
  const serviceId = pre.external_reference ? String(pre.external_reference) : null;

  if (!preapprovalId) return { ok: false, motivo: "la suscripción no trae id" };

  let servicio = null;
  if (serviceId) {
    const { data } = await db
      .from("services")
      .select("id,client_id,estado")
      .eq("id", serviceId)
      .maybeSingle();
    servicio = data || null;
  }

  if (!servicio) {
    return { ok: false, motivo: "la suscripción no apunta a ningún servicio conocido" };
  }

  const recurrente = pre.auto_recurring || {};
  const estado = String(pre.status || "pending");

  const { error } = await db.from("suscripciones_mp").upsert(
    {
      preapproval_id: preapprovalId,
      service_id: servicio.id,
      client_id: servicio.client_id,
      estado,
      monto: recurrente.transaction_amount != null ? Number(recurrente.transaction_amount) : null,
      moneda: recurrente.currency_id || null,
      actualizado_en: new Date().toISOString(),
    },
    { onConflict: "preapproval_id" }
  );

  if (error) {
    console.error("[pagos] no se pudo guardar la suscripción:", error.message);
    return { ok: false, motivo: error.message };
  }

  /* Autorizada = el cliente dio el OK y MercadoPago cobró el primer
     mes. Es el momento de activar y dar el bot. */
  if (estado === "authorized") {
    await confirmarPago(db, {
      serviceId: servicio.id,
      actor: opciones.actor,
      req: opciones.req,
      origen: "mercadopago",
    });
    return { ok: true, activado: true };
  }

  return { ok: true, activado: false };
}

/**
 * Un cargo recurrente ya cobrado: se anota y se alarga el servicio.
 *
 * ── LA IDEMPOTENCIA ES LO IMPORTANTE ──
 *
 * MercadoPago reintenta una notificación hasta 3 veces si no recibe un
 * 200. Sin el `mp_id` único en `pagos_mp`, el mismo cargo alargaría el
 * servicio tres meses. Por eso el insert es la puerta: si choca, ya
 * estaba hecho y no se hace nada más.
 *
 * @param {object} db
 * @param {{pago: object, actor?: object, req?: object}} opciones
 *   `pago` es un authorized payment de MercadoPago.
 * @returns {Promise<{ok: boolean, nuevo?: boolean, motivo?: string}>}
 */
async function aplicarCargo(db, opciones) {
  const pago = (opciones && opciones.pago) || {};
  const mpId = pago.id != null ? String(pago.id) : null;
  if (!mpId) return { ok: false, motivo: "el cargo no trae id" };

  const estado = String(pago.status || "");

  /* El puente con el servicio. */
  const preapprovalId = pago.preapproval_id ? String(pago.preapproval_id) : null;
  let servicio = null;
  if (preapprovalId) {
    const { data } = await db
      .from("suscripciones_mp")
      .select("service_id, services(id,client_id,estado,titulo,importe,moneda,termina_en)")
      .eq("preapproval_id", preapprovalId)
      .maybeSingle();
    const s = data && (Array.isArray(data.services) ? data.services[0] : data.services);
    servicio = s || null;
  }

  const monto = pago.transaction_amount != null ? Number(pago.transaction_amount) : null;
  const moneda = pago.currency_id || null;

  /* La puerta de la idempotencia. */
  const { error: eIns } = await db.from("pagos_mp").insert({
    mp_id: mpId,
    preapproval_id: preapprovalId,
    service_id: servicio ? servicio.id : null,
    client_id: servicio ? servicio.client_id : null,
    monto,
    moneda,
    estado,
    pagado_en: new Date().toISOString(),
    bruto: pago,
  });

  if (eIns) {
    /* 23505 = unique_violation: esa notificación ya se procesó. */
    if (/duplicate key|23505/i.test(eIns.message)) {
      return { ok: true, nuevo: false };
    }
    console.error("[pagos] no se pudo registrar el cargo:", eIns.message);
    return { ok: false, motivo: eIns.message };
  }

  if (!servicio) {
    return { ok: true, nuevo: true, motivo: "el cargo no apunta a un servicio conocido" };
  }

  /* Solo se alarga cuando el cobro salió bien. */
  if (!/approved|processed|authorized/i.test(estado)) {
    return { ok: true, nuevo: true };
  }

  const periodo = periodoActual();
  const importe = monto != null ? monto : Number(servicio.importe) || 0;
  const concepto = servicio.titulo || "Suscripción";

  /* El cobro del mes: se marca pagado si ya estaba emitido, y si no,
     se crea ya pagado. Es el mismo registro que vería el equipo en
     /panel/cobros, para que la contabilidad cuadre por un solo sitio. */
  const { data: previo } = await db
    .from("cobros")
    .select("id")
    .eq("service_id", servicio.id)
    .eq("periodo", periodo)
    .maybeSingle();

  if (previo) {
    await db
      .from("cobros")
      .update({ estado: "pagado", pagado_en: hoyISO(), pagado_importe: importe })
      .eq("id", previo.id);
  } else {
    await db.from("cobros").insert({
      service_id: servicio.id,
      periodo,
      concepto,
      importe,
      moneda: moneda || servicio.moneda || "ARS",
      estado: "pagado",
      emitido_en: hoyISO(),
      pagado_en: hoyISO(),
      pagado_importe: importe,
    });
  }

  /* Y se alarga el servicio un período más. */
  const nuevoFin = unPeriodoDespues(servicio.termina_en);
  await db.from("services").update({ termina_en: nuevoFin }).eq("id", servicio.id);

  return { ok: true, nuevo: true, termina_en: nuevoFin };
}

module.exports = {
  confirmarPago,
  aplicarSuscripcion,
  aplicarCargo,
  unPeriodoDespues,
};
