/* =========================================================
   Nexo Studio — Panel: clientes
   ------------------------------------------------------------
   Listado con búsqueda y paginación, alta, ficha y edición.

   SEGURIDAD
   ---------
   Todas las rutas exigen rol staff. Además, el rol se
   revalida contra `profiles` en cada petición (ver panel.js),
   así que bajar el rol a alguien surte efecto de inmediato.

   El aislamiento con clientes NO depende de estas rutas: RLS
   impide que un cliente lea o escriba clientes aunque manipule
   la URL. Aquí la comprobación es para dar un 403 limpio.
   ========================================================= */

const express = require("express");
const supabase = require("../lib/supabase");
const auth = require("../lib/auth");
const { validar, vacioANull } = require("../lib/validate");
const acceso = require("../lib/acceso");
const L = require("../lib/labels");

const POR_PAGINA = 25;

const ESQUEMA_CLIENTE = {
  nombre: ["requerido", ["texto", { min: 2, max: 120 }]],
  empresa: [["texto", { max: 160 }]],
  email: ["email"],
  telefono: ["telefono"],
  notas: [["texto", { max: 2000 }]],
};

module.exports = function rutasClientes({ db, sitio, csrf, requiereStaff }) {
  const router = express.Router();

  /* ---------- Listado ---------- */
  router.get("/clientes", requiereStaff, async (req, res) => {
    const q = String(req.query.q || "").trim();
    const pagina = Math.max(1, parseInt(req.query.pagina || "1", 10) || 1);
    const desde = (pagina - 1) * POR_PAGINA;

    let consulta = db.from("clients").select("*", { count: "exact" });
    if (!q) consulta = consulta.eq("archivado", false);
    else {
      // Postgres busca sin distinguir mayúsculas. El comodín % va en
      // la consulta, no en la entrada del usuario, para no romperla.
      const patron = "%" + q.replace(/[%_]/g, (m) => "\\" + m) + "%";
      consulta = consulta.or(`nombre.ilike.${patron},empresa.ilike.${patron},email.ilike.${patron}`);
    }

    const { data, error, count } = await consulta.order("empresa", { ascending: true }).range(desde, desde + POR_PAGINA - 1);

    if (error) {
      console.error("[clientes] " + error.message);
    }

    const total = count || 0;
    const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

    res.render("panel/clientes", {
      title: "Clientes",
      site: sitio,
      base: "/panel",
      current: "clientes",
      clientes: data || [],
      q,
      pagina,
      paginas,
      total,
      desde: total === 0 ? 0 : desde + 1,
      hasta: Math.min(desde + POR_PAGINA, total),
    });
  });

  /* ---------- Alta ---------- */
  router.get("/clientes/nuevo", requiereStaff, (req, res) => {
    res.render("panel/cliente-form", {
      title: "Nuevo cliente",
      site: sitio,
      base: "/panel",
      current: "clientes",
      modo: "nuevo",
      cliente: { nombre: "", empresa: "", email: "", telefono: "", notas: "" },
      errores: {},
    });
  });

  router.post("/clientes/nuevo", requiereStaff, async (req, res) => {
    const { errores, datos } = validar(req.body, ESQUEMA_CLIENTE);

    if (Object.keys(errores).length) {
      return res.status(400).render("panel/cliente-form", {
        title: "Nuevo cliente",
        site: sitio,
        base: "/panel",
        current: "clientes",
        modo: "nuevo",
        cliente: datos,
        errores,
      });
    }

    const { data, error } = await db
      .from("clients")
      .insert({
        nombre: datos.nombre,
        empresa: vacioANull(datos.empresa),
        email: vacioANull(datos.email),
        telefono: vacioANull(datos.telefono),
        notas: vacioANull(datos.notas),
      })
      .select()
      .single();

    if (error) {
      return res.status(500).render("panel/cliente-form", {
        title: "Nuevo cliente",
        site: sitio,
        base: "/panel",
        current: "clientes",
        modo: "nuevo",
        cliente: datos,
        errores: { general: "No se pudo guardar: " + error.message },
      });
    }

    await auth.auditar(db, {
      actor: { id: req.sesion.user_id, email: null },
      accion: "crear",
      entidad: "clients",
      entidadId: data.id,
      detalle: { empresa: data.empresa || data.nombre },
      req,
    });

    res.redirect("/panel/clientes/" + data.id + "?creado=1");
  });

  /* ---------- Ficha ---------- */
  router.get("/clientes/:id", requiereStaff, async (req, res) => {
    const { data: cliente, error } = await db
      .from("clients")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();

    if (error || !cliente) {
      return res.status(404).render("panel/404", {
        title: "Cliente no encontrado",
        site: sitio,
        base: "/panel",
        noindex: true,
      });
    }

    const [{ data: servicios }, { data: accesos }] = await Promise.all([
      db.from("services").select("*").eq("client_id", cliente.id).order("creado_en", { ascending: false }),
      db.from("profiles").select("id,nombre,rol,activo,ultimo_acceso").eq("client_id", cliente.id),
    ]);

    /* Qué ve el cliente de cada uno de sus servicios.
       Con las MISMAS reglas que usa su portal (lib/acceso.js), para
       que lo que ve el equipo y lo que ve él no puedan divergir: si
       divergent, un cliente pregunta por algo que el panel le decía
       que no tenía y nadie sabe responder.

       Solo se calculan si el cliente tiene portal: si no tiene
       acceso, no hay nada que enseñarle. */
    let cobrosCliente = [];
    if ((servicios || []).length) {
      const { data: susCobros } = await db
        .from("cobros")
        .select("service_id,estado,importe,descuento,vence_en")
        .in("service_id", servicios.map((s) => s.id));
      cobrosCliente = susCobros || [];
    }

    const vistaCliente = acceso.agrupar(servicios || [], cobrosCliente);
    const porServicio = new Map(vistaCliente.lista.map((s) => [s.id, s]));

    /* Mensaje de éxito según de dónde se venga. Lo decide la ruta,
       no la vista: así la URL y el texto no pueden desincronizarse. */
    const AVISOS = {
      creado: "Cliente creado correctamente.",
      guardado: "Cambios guardados.",
      "servicio=creado": "Servicio añadido.",
      "servicio=guardado": "Servicio actualizado.",
    };
    const aviso =
      AVISOS[req.query.servicio || req.query.creado || req.query.guardado] || null;

    res.render("panel/cliente-detalle", {
      title: cliente.empresa || cliente.nombre,
      site: sitio,
      base: "/panel",
      current: "clientes",
      cliente,
      servicios: (servicios || []).map((s) => {
        const v = porServicio.get(s.id);
        return v ? { ...s, vistaCliente: v.acceso } : s;
      }),
      accesos: accesos || [],
      /* Si el cliente tiene portal, se le avisa de lo que le está
         bloqueado: es lo primero que va a preguntar. */
      resumenCliente: (accesos || []).length ? vistaCliente.cuenta : null,
      etiquetaEstado: L.etiquetaEstado,
      etiquetaTipo: L.etiquetaTipo,
      aviso,
    });
  });

  /* ---------- Edición ---------- */
  router.get("/clientes/:id/editar", requiereStaff, async (req, res) => {
    const { data: cliente } = await db.from("clients").select("*").eq("id", req.params.id).maybeSingle();
    if (!cliente) {
      return res.status(404).render("panel/404", { title: "Cliente no encontrado", site: sitio, base: "/panel", noindex: true });
    }

    res.render("panel/cliente-form", {
      title: "Editar cliente",
      site: sitio,
      base: "/panel",
      current: "clientes",
      modo: "editar",
      cliente,
      errores: {},
    });
  });

  router.post("/clientes/:id/editar", requiereStaff, async (req, res) => {
    const { data: actual } = await db.from("clients").select("*").eq("id", req.params.id).maybeSingle();
    if (!actual) {
      return res.status(404).render("panel/404", { title: "Cliente no encontrado", site: sitio, base: "/panel", noindex: true });
    }

    const { errores, datos } = validar(req.body, ESQUEMA_CLIENTE);
    if (Object.keys(errores).length) {
      return res.status(400).render("panel/cliente-form", {
        title: "Editar cliente",
        site: sitio,
        base: "/panel",
        current: "clientes",
        modo: "editar",
        cliente: { ...actual, ...datos },
        errores,
      });
    }

    const { error } = await db
      .from("clients")
      .update({
        nombre: datos.nombre,
        empresa: vacioANull(datos.empresa),
        email: vacioANull(datos.email),
        telefono: vacioANull(datos.telefono),
        notas: vacioANull(datos.notas),
      })
      .eq("id", req.params.id);

    if (error) {
      return res.status(500).render("panel/cliente-form", {
        title: "Editar cliente",
        site: sitio,
        base: "/panel",
        current: "clientes",
        modo: "editar",
        cliente: { ...actual, ...datos },
        errores: { general: "No se pudo guardar: " + error.message },
      });
    }

    await auth.auditar(db, {
      actor: { id: req.sesion.user_id, email: null },
      accion: "editar",
      entidad: "clients",
      entidadId: req.params.id,
      detalle: { antes: { empresa: actual.empresa, email: actual.email } },
      req,
    });

    res.redirect("/panel/clientes/" + req.params.id + "?guardado=1");
  });

  /* ---------- Archivar (no borrar) ----------
     Borrar un cliente con servicios es una后悔Decision: si se
     equivoca, se acabó. Archivar lo saca de las listas pero
     conserva el histórico y los servicios. */
  router.post("/clientes/:id/archivar", requiereStaff, async (req, res) => {
    const { error } = await db.from("clients").update({ archivado: true }).eq("id", req.params.id);

    await auth.auditar(db, {
      actor: { id: req.sesion.user_id, email: null },
      accion: "archivar",
      entidad: "clients",
      entidadId: req.params.id,
      detalle: { error: error ? error.message : null },
      req,
    });

    res.redirect("/panel/clientes");
  });

  return router;
};
