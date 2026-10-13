/* =========================================================
   Shopcito — Webhook de MercadoPago (público)
   ------------------------------------------------------------
   MercadoPago avisa aquí cuando una suscripción se autoriza o cuando
   cobra el mes. Esta ruta es PÚBLICA (no puede llevar sesión del
   panel: quien llama es MercadoPago), así que lo único que la protege
   es la firma `x-signature`.

   ── POR QUÉ VIVE FUERA DE /panel ──
   Porque /panel exige login. Un webhook que pida login no lo puede
   llamar nadie de fuera. Se monta en /mp/webhook, antes del 404 de la
   web pública (ver server.js).

   ── LO QUE SE HACE CON CADA AVISO ──
     subscription_preapproval         el cliente autorizó (o canceló)
                                      la suscripción -> activar + bot;
     subscription_authorized_payment  el cargo del mes -> marcar el cobro
                                      pagado y alargar el servicio.

   ── POR QUÉ SE RESPONDE 200 CASI SIEMPRE ──
   MercadoPago reintenta hasta 3 veces si no recibe 2xx. A un aviso que
   no sabemos procesar se le contesta 200 (no insistas) y se anota en el
   log; solo se contesta 401 si la firma no es válida, que es lo único
   que de verdad hay que rechazar.
   ========================================================= */

const express = require("express");
const supabase = require("../lib/supabase");
const mp = require("../lib/mercadopago");
const pagos = require("../lib/pagos");

const router = express.Router();

router.post("/mp/webhook", async (req, res) => {
  try {
    const db = supabase.getAdmin();

    const config = await mp.leerConfig(db);
    const listo = mp.estaLista(config);

    if (!listo.ok || !config.webhook_secret) {
      /* Sin credenciales no se puede verificar nada ni tocar la base.
         Se contesta 200 para que MercadoPago no reintente en bucle. */
      console.warn("[mp] webhook ignorado: " + (listo.ok ? "sin clave secreta" : listo.motivo));
      return res.status(200).json({ ok: false, motivo: "integración no lista" });
    }

    const dataId = String(
      (req.query && req.query["data.id"]) ||
        (req.body && req.body.data && req.body.data.id) ||
        ""
    );
    const tipo = String(
      (req.query && (req.query.type || req.query.topic)) ||
        (req.body && (req.body.type || req.body.topic)) ||
        ""
    );

    const firmaOk = mp.verificarFirma({
      xSignature: req.get("x-signature"),
      xRequestId: req.get("x-request-id"),
      dataId,
      secret: config.webhook_secret,
    });

    if (!firmaOk) {
      console.warn("[mp] webhook con firma inválida (tipo=" + tipo + ")");
      return res.status(401).end();
    }

    if (!dataId) {
      return res.status(200).json({ ok: true, ignorado: "sin data.id" });
    }

    if (tipo === "subscription_preapproval") {
      const r = await mp.leerPreapproval(config, dataId);
      if (r.ok) {
        const aplicado = await pagos.aplicarSuscripcion(db, { preapproval: r.data });
        if (!aplicado.ok) console.warn("[mp] suscripción: " + aplicado.motivo);
      } else {
        console.error("[mp] no se pudo leer la suscripción " + dataId + ": " + r.mensaje);
      }
    } else if (tipo === "subscription_authorized_payment") {
      const r = await mp.leerPagoAutorizado(config, dataId);
      if (r.ok) {
        const aplicado = await pagos.aplicarCargo(db, { pago: r.data });
        if (!aplicado.ok) console.warn("[mp] cargo: " + aplicado.motivo);
      } else {
        console.error("[mp] no se pudo leer el cargo " + dataId + ": " + r.mensaje);
      }
    } else if (tipo === "payment") {
      /* Un pago suelto. Solo interesa si pertenece a una suscripción. */
      const r = await mp.leerPago(config, dataId);
      const pre = r.ok && r.data && (r.data.preapproval_id || (r.data.metadata && r.data.metadata.preapproval_id));
      if (pre) {
        await pagos.aplicarCargo(db, { pago: Object.assign({}, r.data, { preapproval_id: pre }) });
      }
    } else {
      console.warn("[mp] tipo de aviso no manejado: " + tipo);
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[mp] error en el webhook:", e && e.message ? e.message : e);
    /* 200 y no 500: un fallo nuestro no debe hacer que MercadoPago
       reintente y multiplique el problema. Queda en el log. */
    return res.status(200).json({ ok: false });
  }
});

/* Un GET solo para comprobar desde el navegador que la URL existe.
   No procesa nada. */
router.get("/mp/webhook", (req, res) => {
  res.type("text/plain").send("webhook de MercadoPago: usa POST");
});

module.exports = router;
