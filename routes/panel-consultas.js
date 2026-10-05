/* =========================================================
   Nexo Studio — Panel: consultas (leads)
   ------------------------------------------------------------
   Lo que llega del formulario de contacto. Aquí se les da
   estado para poder seguir el embudo.

   El embudo:
     nuevo -> contactado -> presupuestado -> ganado
                                      \-> descartado
   "descartado" y "ganado" son terminales: se puede volver
   atrás, pero el panel avisa.
   ========================================================= */

const express = require("express");
const auth = require("../lib/auth");
const L = require("../lib/labels");
const { validar, vacioANull } = require("../lib/validate");

const POR_PAGINA = 30;

/* Las etiquetas del embudo viven en lib/labels.js, no aquí. Este
   router tenía su propia copia y se desincronizó de la de las otras
   vistas. */
const ESTADOS = L.OPCIONES_LEAD;

const fechaCorta = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "2-digit" });
};

module.exports = function rutasConsultas({ db, sitio, csrf, requiereStaff }) {
  const router = express.Router();

  router.get("/consultas", requiereStaff, async (req, res) => {
    const estado = String(req.query.estado || "").trim();
    const q = String(req.query.q || "").trim();
    const pagina = Math.max(1, parseInt(req.query.pagina || "1", 10) || 1);
    const desde = (pagina - 1) * POR_PAGINA;

    let consulta = db.from("leads").select("*", { count: "exact" });
    if (estado) consulta = consulta.eq("estado", estado);
    if (q) {
      const patron = "%" + q.replace(/[%_]/g, (m) => "\\" + m) + "%";
      consulta = consulta.or(`nombre.ilike.${patron},email.ilike.${patron},empresa.ilike.${patron},mensaje.ilike.${patron}`);
    }

    const { data, error, count } = await consulta
      .order("recibido_en", { ascending: false })
      .range(desde, desde + POR_PAGINA - 1);

    if (error) console.error("[consultas] " + error.message);

    /* Recuento por estado para los filtros */
    const { data: todas } = await db.from("leads").select("estado");
    const recuento = {};
    ESTADOS.forEach((e) => (recuento[e.valor] = 0));
    (todas || []).forEach((l) => {
      recuento[l.estado] = (recuento[l.estado] || 0) + 1;
    });

    const total = count || 0;
    res.render("panel/consultas", {
      title: "Consultas",
      site: sitio,
      base: "/panel",
      current: "consultas",
      consultas: data || [],
      estados: ESTADOS,
      /* Traduce el estado del embudo a texto legible. */
      etiqueta: L.etiquetaLead,
      recuento,
      /* Necesario en la vista: al cambiar el estado o guardar una
         nota se vuelve al mismo filtro, y los enlaces de paginación
         lo arrastran. */
      estado,
      fecha: fechaCorta,
      estado,
      q,
      pagina,
      paginas: Math.max(1, Math.ceil(total / POR_PAGINA)),
      total,
      desde: total === 0 ? 0 : desde + 1,
      hasta: Math.min(desde + POR_PAGINA, total),
    });
  });

  /* ---------- Cambiar estado ---------- */
  router.post("/consultas/:id/estado", requiereStaff, async (req, res) => {
    const nuevo = String((req.body && req.body.estado) || "");
    if (!ESTADOS.some((e) => e.valor === nuevo)) {
      return res.redirect("/panel/consultas");
    }

    const { data: actual } = await db.from("leads").select("estado").eq("id", req.params.id).maybeSingle();
    const { error } = await db.from("leads").update({ estado: nuevo }).eq("id", req.params.id);

    await auth.auditar(db, {
      actor: { id: req.sesion.user_id, email: null },
      accion: "cambiar-estado",
      entidad: "leads",
      entidadId: req.params.id,
      detalle: { antes: actual && actual.estado, despues: nuevo },
      req,
    });

    const volver = (req.body && req.body.volver) || "/panel/consultas";
    res.redirect(String(volver).startsWith("/panel") ? volver : "/panel/consultas");
  });

  /* ---------- Notas internas ----------
     No se ven nunca fuera del panel: son]]:
       · notas del cliente
       · notas internas
     Las internas no se enseñan en el portal, así que aquí son
     el sitio natural para anotar "ha pedido presupuesto de 3k". */
  router.post("/consultas/:id/notas", requiereStaff, async (req, res) => {
    const { errores, datos } = validar(req.body, { notas: [["texto", { max: 2000 }]] });
    if (errores.notas) return res.redirect("/panel/consultas");

    const { error } = await db.from("leads").update({ notas: vacioANull(datos.notas) }).eq("id", req.params.id);

    await auth.auditar(db, {
      actor: { id: req.sesion.user_id, email: null },
      accion: "notas",
      entidad: "leads",
      entidadId: req.params.id,
      req,
    });

    const volver = (req.body && req.body.volver) || "/panel/consultas";
    res.redirect(String(volver).startsWith("/panel") ? volver : "/panel/consultas");
  });

  return router;
};

module.exports.ESTADOS = ESTADOS;
