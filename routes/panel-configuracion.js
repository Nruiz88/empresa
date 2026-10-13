/* =========================================================
   Shopcito — Configuración (panel)
   ------------------------------------------------------------
   Dónde se cargan las credenciales de los servicios externos. Hoy
   solo MercadoPago.

   ── POR QUÉ UNA PANTALLA Y NO VARIABLES DE ENTORNO ──
   Porque son datos que cambian sin desplegar: se pasa de test a
   producción, se rota una clave, se pega el secreto del webhook. En
   el .env del contenedor eso es editar a mano y reiniciar, y encima
   quedaría fuera del panel, donde nadie las ve.

   ── LO QUE NO SE MUESTRA ──
   Las claves se guardan en claro (como `evolution_servers.api_key`),
   porque el servidor las necesita tal cual para firmar las llamadas.
   Se enseñan en campos de tipo password: quien entra aquí ya es del
   equipo y las puede editar, pero no quedan a la vista de un vistazo
   ni en una captura.
   ========================================================= */

const express = require("express");
const auth = require("../lib/auth");
const mp = require("../lib/mercadopago");

module.exports = function rutasConfiguracion({ db, sitio, requiereStaff }) {
  const router = express.Router();

  /** La URL que hay que pegar en MercadoPago para que avise aquí. */
  const urlWebhook = () => String(sitio.url || "").replace(/\/+$/, "") + "/mp/webhook";

  async function vista(req, res, extra = {}) {
    const config = (await mp.leerConfig(db)) || {
      clave: "mercadopago",
      activo: false,
      modo: "test",
      access_token: "",
      public_key: "",
      webhook_secret: "",
    };

    res.render("panel/configuracion", {
      title: "Configuración",
      site: sitio,
      base: "/panel",
      current: "configuracion",
      noindex: true,
      config,
      webhookUrl: urlWebhook(),
      errores: {},
      aviso: null,
      prueba: null,
      ...extra,
    });
  }

  /* ---------- Ver ---------- */
  router.get("/configuracion", requiereStaff, (req, res) => vista(req, res));

  /* ---------- Guardar ---------- */
  router.post("/configuracion", requiereStaff, async (req, res) => {
    const cuerpo = req.body || {};

    const modo = String(cuerpo.modo || "test") === "prod" ? "prod" : "test";
    const activo = String(cuerpo.activo || "") === "1";
    const accessToken = String(cuerpo.access_token || "").trim();
    const publicKey = String(cuerpo.public_key || "").trim();
    const webhookSecret = String(cuerpo.webhook_secret || "").trim();

    /* Si el campo viene vacío, se RESPETA lo que ya había. Así el
       formulario puede volver sin perder una clave que no se toca: con
       un update de vacío, reenviar la pantalla borraría el token. */
    const antes = (await mp.leerConfig(db)) || {};

    const { error } = await db.from("integraciones").upsert(
      {
        clave: "mercadopago",
        modo,
        activo,
        access_token: accessToken || antes.access_token || null,
        public_key: publicKey || antes.public_key || null,
        webhook_secret: webhookSecret || antes.webhook_secret || null,
        actualizado_en: new Date().toISOString(),
      },
      { onConflict: "clave" }
    );

    if (error) {
      return vista(req, res, {
        errores: { general: "No se pudo guardar: " + error.message },
      });
    }

    await auth.auditar(db, {
      actor: { id: req.sesion.user_id, email: null },
      accion: "guardar-config",
      entidad: "integraciones",
      entidadId: "mercadopago",
      detalle: { modo, activo },
      req,
    });

    return vista(req, res, { aviso: "Guardado." });
  });

  /* ---------- Probar la credencial ----------
     No guarda nada: comprueba la que ya está guardada y lo dice en
     pantalla. Es lo que separa "la clave está mal" de "MercadoPago no
     contesta", que se arreglan distinto. */
  router.post("/configuracion/probar", requiereStaff, async (req, res) => {
    const config = await mp.leerConfig(db);
    const r = await mp.probar(config);

    const prueba = r.ok
      ? {
          ok: true,
          texto:
            "MercadoPago acepta la credencial" +
            (r.data && r.data.nickname ? " (" + r.data.nickname + ")" : "") +
            ". El modo guardado es «" + (config && config.modo === "prod" ? "producción" : "prueba") + "».",
        }
      : { ok: false, texto: r.mensaje };

    return vista(req, res, { prueba });
  });

  return router;
};
