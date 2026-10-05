/* =========================================================
   Nexo Studio — Panel: servicios
   ------------------------------------------------------------
   Los tres tipos (mantenimiento, proyecto, presupuesto) viven
   en la misma tabla y se distinguen por `kind`. Menos tablas
   que mantener y los informes son más sencillos.
   ========================================================= */

const express = require("express");
const auth = require("../lib/auth");
const { validar, vacioANull } = require("../lib/validate");
const L = require("../lib/labels");

const POR_PAGINA = 25;

/* Las etiquetas viven en lib/labels.js para que el listado, la ficha
   y el portal del cliente digan exactamente lo mismo. */
const TIPOS = L.OPCIONES_TIPO;
const ESTADOS = L.OPCIONES_ESTADO;
const PERIODICIDADES = L.OPCIONES_PERIODICIDAD;
const ETIQUETA_ESTADO = L.etiquetaEstado;

const ESQUEMA = {
  client_id: ["requerido"],
  kind: [["requerido"], ["unoDe", TIPOS.map((t) => t.valor)]],
  estado: [["requerido"], ["unoDe", ESTADOS.map((e) => e.valor)]],
  titulo: ["requerido", ["texto", { min: 3, max: 160 }]],
  descripcion: [["texto", { max: 2000 }]],
  importe: ["importe"],
  periodicidad: ["unoDe", PERIODICIDADES.map((p) => p.valor)],
  inicia_en: ["fecha"],
  termina_en: ["fecha"],
  notas: [["texto", { max: 2000 }]],
};

module.exports = function rutasServicios({ db, sitio, csrf, requiereStaff }) {
  const router = express.Router();

  /* ---------- Listado ---------- */
  router.get("/servicios", requiereStaff, async (req, res) => {
    const q = String(req.query.q || "").trim();
    const tipo = String(req.query.tipo || "").trim();
    const estado = String(req.query.estado || "").trim();
    const pagina = Math.max(1, parseInt(req.query.pagina || "1", 10) || 1);
    const desde = (pagina - 1) * POR_PAGINA;

    let consulta = db.from("services").select("*, clients(empresa,nombre)", { count: "exact" });

    if (tipo) consulta = consulta.eq("kind", tipo);
    if (estado) consulta = consulta.eq("estado", estado);
    if (q) {
      const patron = "%" + q.replace(/[%_]/g, (m) => "\\" + m) + "%";
      consulta = consulta.ilike("titulo", patron);
    }

    const { data, error, count } = await consulta
      .order("creado_en", { ascending: false })
      .range(desde, desde + POR_PAGINA - 1);

    if (error) console.error("[servicios] " + error.message);

    /* Para el formulario: qué clientes hay */
    const { data: clientes } = await db
      .from("clients")
      .select("id,empresa,nombre")
      .eq("archivado", false)
      .order("empresa", { ascending: true });

    const total = count || 0;
    res.render("panel/servicios", {
      title: "Servicios",
      site: sitio,
      base: "/panel",
      current: "servicios",
      servicios: data || [],
      clientes: clientes || [],
      tipos: TIPOS,
      estados: ESTADOS,
      etiqueta: ETIQUETA_ESTADO,
      etiquetaTipo: L.etiquetaTipo,
      q,
      tipo,
      estado,
      pagina,
      paginas: Math.max(1, Math.ceil(total / POR_PAGINA)),
      total,
      desde: total === 0 ? 0 : desde + 1,
      hasta: Math.min(desde + POR_PAGINA, total),
    });
  });

  /* ---------- Alta ---------- */
  const formulario = (req, res, extra) => {
    db.from("clients")
      .select("id,empresa,nombre")
      .eq("archivado", false)
      .order("empresa", { ascending: true })
      .then(({ data }) => {
        res.render("panel/servicio-form", {
          title: extra.modo === "nuevo" ? "Nuevo servicio" : "Editar servicio",
          site: sitio,
          base: "/panel",
          current: "servicios",
          tipos: TIPOS,
          estados: ESTADOS,
          periodicidades: PERIODICIDADES,
          clientes: data || [],
          servicio: extra.servicio,
          errores: extra.errores || {},
          modo: extra.modo,
        });
      });
  };

  const vacio = {
    client_id: "", kind: "mantenimiento", estado: "pendiente",
    titulo: "", descripcion: "", importe: "", periodicidad: "",
    inicia_en: "", termina_en: "", notas: "",
  };

  router.get("/servicios/nuevo", requiereStaff, async (req, res) => {
    const inicial = { ...vacio, client_id: String(req.query.cliente || "") };
    formulario(req, res, { modo: "nuevo", servicio: inicial, errores: {} });
  });

  router.post("/servicios/nuevo", requiereStaff, async (req, res) => {
    const { errores, datos } = validar(req.body, ESQUEMA);
    const cruce = validar({ fin: datos.termina_en, inicio: datos.inicia_en }, {
      fin: [(v) => require("../lib/validate").reglas.rangoFechas(v, datos.inicia_en)],
    });
    if (cruce.errores.fin) errores.termina_en = cruce.errores.fin;

    if (Object.keys(errores).length) {
      return formulario(req, res, { modo: "nuevo", servicio: datos, errores });
    }

    const { data, error } = await db
      .from("services")
      .insert({
        client_id: datos.client_id,
        kind: datos.kind,
        estado: datos.estado,
        titulo: datos.titulo,
        descripcion: vacioANull(datos.descripcion),
        importe: datos.importe ? Number(String(datos.importe).replace(/\./g, "").replace(",", ".")) : null,
        periodicidad: vacioANull(datos.periodicidad),
        inicia_en: vacioANull(datos.inicia_en),
        termina_en: vacioANull(datos.termina_en),
        notas: vacioANull(datos.notas),
      })
      .select()
      .single();

    if (error) {
      return formulario(req, res, {
        modo: "nuevo",
        servicio: datos,
        errores: { general: "No se pudo guardar: " + error.message },
      });
    }

    await auth.auditar(db, {
      actor: { id: req.sesion.user_id, email: null },
      accion: "crear",
      entidad: "services",
      entidadId: data.id,
      detalle: { titulo: data.titulo, kind: data.kind, importe: data.importe },
      req,
    });

    res.redirect("/panel/clientes/" + data.client_id + "?servicio=creado");
  });

  /* ---------- Editar ---------- */
  router.get("/servicios/:id/editar", requiereStaff, async (req, res) => {
    const { data } = await db.from("services").select("*").eq("id", req.params.id).maybeSingle();
    if (!data) {
      return res.status(404).render("panel/404", { title: "Servicio no encontrado", site: sitio, base: "/panel", noindex: true });
    }
    formulario(req, res, { modo: "editar", servicio: data, errores: {} });
  });

  router.post("/servicios/:id/editar", requiereStaff, async (req, res) => {
    const { data: actual } = await db.from("services").select("*").eq("id", req.params.id).maybeSingle();
    if (!actual) {
      return res.status(404).render("panel/404", { title: "Servicio no encontrado", site: sitio, base: "/panel", noindex: true });
    }

    const { errores, datos } = validar(req.body, ESQUEMA);
    const { reglas } = require("../lib/validate");
    const cruce = reglas.rangoFechas(datos.termina_en, datos.inicia_en);
    if (cruce) errores.termina_en = cruce;

    if (Object.keys(errores).length) {
      return formulario(req, res, { modo: "editar", servicio: { ...actual, ...datos }, errores });
    }

    const { error } = await db
      .from("services")
      .update({
        client_id: datos.client_id,
        kind: datos.kind,
        estado: datos.estado,
        titulo: datos.titulo,
        descripcion: vacioANull(datos.descripcion),
        importe: datos.importe ? Number(String(datos.importe).replace(/\./g, "").replace(",", ".")) : null,
        periodicidad: vacioANull(datos.periodicidad),
        inicia_en: vacioANull(datos.inicia_en),
        termina_en: vacioANull(datos.termina_en),
        notas: vacioANull(datos.notas),
      })
      .eq("id", req.params.id);

    if (error) {
      return formulario(req, res, {
        modo: "editar",
        servicio: { ...actual, ...datos },
        errores: { general: "No se pudo guardar: " + error.message },
      });
    }

    // Guardamos qué cambió: en facturación importa saberlo
    const cambios = {};
    for (const campo of ["titulo", "estado", "kind", "importe", "periodicidad", "inicia_en", "termina_en"]) {
      const antes = actual[campo];
      const despues = campo === "importe"
        ? (datos.importe ? Number(String(datos.importe).replace(/\./g, "").replace(",", ".")) : null)
        : vacioANull(datos[campo]);
      if (String(antes) !== String(despues)) cambios[campo] = { antes, despues };
    }

    await auth.auditar(db, {
      actor: { id: req.sesion.user_id, email: null },
      accion: "editar",
      entidad: "services",
      entidadId: req.params.id,
      detalle: cambios,
      req,
    });

    res.redirect("/panel/clientes/" + actual.client_id + "?servicio=guardado");
  });

  /* ---------- Cambio rápido de estado ----------
     Un clic en la ficha para mover un proyecto de "en curso" a
     "finalizado". Es lo que más se usa del panel, y pedir abrir
     el formulario para eso sería absurdo. */
  router.post("/servicios/:id/estado", requiereStaff, async (req, res) => {
    const nuevo = String((req.body && req.body.estado) || "");
    if (!ESTADOS.some((e) => e.valor === nuevo)) {
      return res.redirect(req.get("referer") || "/panel/servicios");
    }

    const { data: actual } = await db.from("services").select("estado,client_id").eq("id", req.params.id).maybeSingle();
    const { error } = await db.from("services").update({ estado: nuevo }).eq("id", req.params.id);

    await auth.auditar(db, {
      actor: { id: req.sesion.user_id, email: null },
      accion: "cambiar-estado",
      entidad: "services",
      entidadId: req.params.id,
      detalle: { antes: actual && actual.estado, despues: nuevo },
      req,
    });

    const volver = (req.body && req.body.volver) || "/panel/servicios";
    // Solo permitimos volver a rutas internas del panel
    res.redirect(String(volver).startsWith("/panel") ? volver : "/panel/servicios");
  });

  return router;
};

module.exports.TIPOS = TIPOS;
module.exports.ESTADOS = ESTADOS;
module.exports.ETIQUETA_ESTADO = ETIQUETA_ESTADO;
