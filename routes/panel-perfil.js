/* =========================================================
   Nexo Studio — Perfil del cliente (rutas)
   ------------------------------------------------------------
   GET  /panel/perfil          ver y editar la ficha y la facturación
   POST /panel/perfil/ficha    guardar la ficha del negocio
   POST /panel/perfil/facturacion  guardar los datos de facturación

   La lógica de validación y limpieza está en lib/perfil.js, no aquí.
   Motivo: son reglas de negocio, no de HTTP, y las necesita también
   el worker que rellene fichas automáticamente (cuando exista).

   ⚠️  Por qué va con la secret key
   -------------------------------
   Estas tablas tienen RLS y el cliente podría leerlas con
   getClientForToken igual que los servicios. Se usa la secret key por
   comodidad de escritura (upsert), no por necesidad: la comprobación
   de que el client_id es el suyo la hace `clientIdDe()`, que sale de
   la sesión, no de lo que llegue en el formulario. Si algún día esto
   se expone a un formulario público, hay que revisar el cliente.
   ========================================================= */

const express = require("express");
const supabase = require("../lib/supabase");
const perfil = require("../lib/perfil");
const clientIdDe = require("../lib/client-id");
const auth = require("../lib/auth");

module.exports = function rutasPerfil({ sitio, requiereLogin }) {
  const router = express.Router();
  const db = supabase.getAdmin();

  /* ---------- Ver ---------- */
  router.get("/perfil", requiereLogin, async (req, res) => {
    const clientId = await clientIdDe(req.sesion.user_id);

    /* Los avisos van como variables, no como `req.query` dentro de la
       vista: EJS no tiene `req`, y leerlo ahí revienta la página. Es
       la misma razón por la que las variables de sesión viajan en
       res.locals y no pasadas una a una. */
    const hecho = req.query.hecho === "1";
    const errorGuardar = req.query.error === "guardar";
    const avisoIva = req.query.aviso === "iva";

    if (!clientId) {
      /* Staff sin ficha de cliente, o un perfil a medio hacer. No es un
         error: se pinta la página vacía para que rellene. */
      return res.render("panel/perfil", {
        title: "Mi perfil",
        site: sitio,
        base: "/panel",
        current: "perfil",
        csrf: req.sesion ? auth.csrfDe(req.sesion) : "",
        rol: req.sesion ? req.sesion.rol : "",
        perfil: null,
        ficha: {},
        facturacion: {},
        errores: {},
        aviso: null,
        hecho,
        errorGuardar,
        pendientes: [],
      });
    }

    const { data: datos, error } = await db.rpc("perfil_completo", {
      cliente_uuid: clientId,
    });

    /* Los enlaces libres vienen como array jsonb. La vista los pinta
       como "texto|url", uno por línea, que es como se editan. */
    const ficha = (datos && datos.ficha) || {};
    if (Array.isArray(ficha.enlaces)) {
      ficha.enlaces = ficha.enlaces
        .map((e) => (e && e.etiqueta ? e.etiqueta + "|" + e.url : null))
        .filter(Boolean)
        .join("\n");
    } else {
      ficha.enlaces = "";
    }

    res.render("panel/perfil", {
      title: "Mi perfil",
      site: sitio,
      base: "/panel",
      current: "perfil",
        csrf: req.sesion ? auth.csrfDe(req.sesion) : "",
        rol: req.sesion ? req.sesion.rol : "",
      perfil: datos,
      ficha,
      facturacion: (datos && datos.facturacion) || {},
      errores: {},
      aviso: avisoIva
        ? "El régimen de IVA lo pone el equipo. Guarda el resto y avísanos si esto está mal."
        : null,
      hecho,
      errorGuardar,
      pendientes: perfil.pendientes(datos),
    });
  });

  /* ---------- Guardar ficha ---------- */
  router.post("/perfil/ficha", requiereLogin, async (req, res) => {
    const clientId = await clientIdDe(req.sesion.user_id);
    if (!clientId) return res.redirect("/panel/perfil?error=sin-cliente");

    const { datos, errores } = perfil.prepararFicha(req.body || {});

    /* Con errores se vuelve a pintar el formulario con lo escrito, para
       que no se pierda. Sin errores, guardar y volver. */
    if (Object.keys(errores).length) {
      const { data: actual } = await db.rpc("perfil_completo", { cliente_uuid: clientId });
      return res.status(400).render("panel/perfil", {
        title: "Mi perfil",
        site: sitio,
        base: "/panel",
        current: "perfil",
        csrf: req.sesion ? auth.csrfDe(req.sesion) : "",
        rol: req.sesion ? req.sesion.rol : "",
        perfil: actual,
        ficha: datos,
        facturacion: (actual && actual.facturacion) || {},
        errores,
        aviso: null,
        hecho: false,
        errorGuardar: false,
        pendientes: perfil.pendientes(actual),
      });
    }

    try {
      await perfil.guardarFicha(db, clientId, datos);
    } catch (err) {
      console.error("[perfil] No se pudo guardar la ficha:", err.message);
      return res.redirect("/panel/perfil?error=guardar");
    }

    await db.from("audit_log").insert(
      [
        {
          actor_id: req.sesion.user_id,
          actor_email: req.sesion.email || "",
          accion: "editar-ficha",
          entidad: "clients",
          entidad_id: clientId,
        },
      ].filter((r) => r.entidad_id)
    ).then(() => {}, () => {});

    res.redirect("/panel/perfil?hecho=1#negocio");
  });

  /* ---------- Guardar facturación ---------- */
  router.post("/perfil/facturacion", requiereLogin, async (req, res) => {
    const clientId = await clientIdDe(req.sesion.user_id);
    if (!clientId) return res.redirect("/panel/perfil?error=sin-cliente");

    const esStaff = req.sesion.rol === "staff";
    const { datos, errores, aviso } = perfil.prepararFacturacion(req.body || {}, esStaff);

    if (Object.keys(errores).length) {
      const { data: actual } = await db.rpc("perfil_completo", { cliente_uuid: clientId });
      return res.status(400).render("panel/perfil", {
        title: "Mi perfil",
        site: sitio,
        base: "/panel",
        current: "perfil",
        csrf: req.sesion ? auth.csrfDe(req.sesion) : "",
        rol: req.sesion ? req.sesion.rol : "",
        perfil: actual,
        ficha: (actual && actual.ficha) || {},
        facturacion: datos,
        errores,
        aviso,
        hecho: false,
        errorGuardar: false,
        pendientes: perfil.pendientes(actual),
      });
    }

    try {
      await perfil.guardarFacturacion(db, clientId, datos);
    } catch (err) {
      console.error("[perfil] No se pudo guardar la facturación:", err.message);
      return res.redirect("/panel/perfil?error=guardar");
    }

    res.redirect(
      "/panel/perfil?hecho=1" + (aviso ? "&aviso=iva" : "") + "#facturacion"
    );
  });

  return router;
};
