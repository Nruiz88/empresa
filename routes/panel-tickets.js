/* =========================================================
   Nexo Studio — Tickets de soporte
   ------------------------------------------------------------
   Lo que avisa un cliente y atiende el equipo.

   ┌─ POR QUÉ VIVE EN UN SOLO ARCHIVO ────────────────────┐
   │ Un ticket tiene dos mitades: la que ve el equipo y la que│
   │ ve el cliente. Si estuvieran en dos routers, la mitad   │
   │ del equipo se olvidaría de la regla que las une —la     │
   │ nota interna— y acabaría contestando al cliente lo que │
   │ se dijo de viva voz dentro.                            │
   └────────────────────────────────────────────────────────┘

   ── EL NOMBRE ──

   En la interfaz se dice "ticket" porque es la palabra que usa
   el equipo y la que entiende el cliente.

   En el código NO se dice, porque ya existe `lib/tickets.js`:
   el ticket de acceso entre servicios, un token firmado para
   pasar de panel. a bot. sin volver a autenticarse. Dos cosas
   distintas con el mismo nombre, y la que se confunde es la
   criptográfica. Las tablas se llaman `soporte_tickets`.

   ── POR QUÉ NO ESTÁ EN /soporte/ ──

   Porque ya existe `/soporte/:moduleId`, que es lo de darle a
   un cliente acceso al bot de su módulo. Si el equipo estuviera
   en `/soporte/tickets`, esa ruta se lo comería como si
   `tickets` fuera un moduleId, y el ticket abriría en la
   pantalla equivocada sin decir nada. De ahí `/panel/tickets`.

   ── LA REGLA QUE NO SE ROMPE ──

   En ninguna ruta de cliente se lee `interno` del cuerpo.

   Es la defensa real, y no la convención: la RLS de la 019
   también lo rechaza (`with check (not interno)`), pero esa es
   la red. La red debería pillarlo, no ser lo único que pilla.

   Si alguien añade un `interno: req.body.interno` a una ruta de
   cliente, el cliente podrá escribir notas internas. Por eso
   está aquí, arriba, y no solo en la vista.
   ========================================================= */

const express = require("express");
const auth = require("../lib/auth");
const { validar } = require("../lib/validate");
const clientIdDe = require("../lib/client-id");

const POR_PAGINA = 30;

/* Los estados del ticket.
 *
 * Tres y no seis: `abierto`, `en_curso` y `resuelto`. Falta
 * `cerrado` a propósito. En un negocio de este tamaño "resuelto"
 * y "cerrado" son lo mismo, y tener los dos obliga a decidir
 * cuál de los dos es en cada caso sin que nada cambie.
 *
 * La fuente de verdad es el CHECK de la migración 018, no esta
 * lista: esta es la que usa la interfaz para pintar, y el CHECK
 * es el que hace fallar un estado inventado en el POST.
 */
const ESTADOS = [
  { valor: "abierto", etiqueta: "Abierto" },
  { valor: "en_curso", etiqueta: "En curso" },
  { valor: "resuelto", etiqueta: "Resuelto" },
];

const esEstado = (v) => ESTADOS.some((e) => e.valor === v);

const etiquetaEstado = (v) => {
  const e = ESTADOS.find((x) => x.valor === v);
  return e ? e.etiqueta : v;
};

module.exports = function rutasTickets({ db, sitio, requiereStaff, requiereLogin }) {
  const router = express.Router();

  /* ─────────────────────────────────────────────────────────
     EL EQUIPO
     ───────────────────────────────────────────────────────── */

  router.get("/tickets", requiereStaff, async (req, res) => {
    const estado = String(req.query.estado || "").trim();
    const q = String(req.query.q || "").trim();
    const pagina = Math.max(1, parseInt(req.query.pagina || "1", 10) || 1);
    const desde = (pagina - 1) * POR_PAGINA;

    let consulta = db.from("soporte_tickets").select("*, clients(empresa,nombre)", { count: "exact" });
    if (esEstado(estado)) consulta = consulta.eq("estado", estado);

    /* ── LA BÚSQUEDA POR EMPRESA, Y POR QUÉ SON DOS CONSULTAS ──

       PostgREST NO admite `or()` sobre una relación embebida. Ni
       `or(asunto.ilike.x, clients.empresa.ilike.x)` ni con
       `!inner`: el primero falla al construir el árbol de filtros
       y el segundo busca la columna en la tabla equivocada.

       Así que se busca la empresa primero, aparte, y después se
       filtra por `cliente_id`. Dos consultas en vez de una porque
       no hay manera de hacerlo en una.
    */
    let idsCliente = [];

    if (q) {
      const patron = "%" + q.replace(/[%_]/g, (m) => "\\" + m) + "%";

      const { data: coincidencias } = await db
        .from("clients")
        .select("id")
        .or(`empresa.ilike.${patron},nombre.ilike.${patron}`)
        .limit(200);

      idsCliente = (coincidencias || []).map((c) => c.id);

      const porAsunto = `asunto.ilike.${patron}`;

      /* Con empresas que coinciden y sin, el filtro es distinto. Un
         `in.()` con la lista vacía es un error de sintaxis de
         PostgREST, no un "no hay nada": hay que quitarlo. */
      consulta = consulta.or(
        idsCliente.length
          ? `${porAsunto},cliente_id.in.(${idsCliente.join(",")})`
          : porAsunto
      );
    }

    const { data, error, count } = await consulta
      .order("actualizado_en", { ascending: false })
      .range(desde, desde + POR_PAGINA - 1);

    /* ── UN ERROR NO ES UNA LISTA VACÍA ──

       Antes de esto solo había un `console.error` y la vista pintaba
       `data || []`. Con el `or()` roto, buscar escribía un error en
       el log y le enseñaba al usuario "no hay tickets que
       coincidan".

       Es la peor forma de fallar: no dice que hay un fallo, dice que
       el usuario se equivocó. Y como el log no lo lee nadie, la
       búsqueda seemed broken sin que nadie supiera por qué.

       Por eso el error baja a la vista y se enseña. Si la lista no
       se pudo leer, hay que decirlo. */
    const fallo = error ? error.message : "";

    if (error) console.error("[tickets] " + error.message);

    /* El recuento por estado, para los filtros.

     Una consulta aparte y no un conteo por grupo: con tres
     estados y una tabla pequeña sale más barato, y sobre todo no
     depende de que la base soporte aggregaciones en PostgREST,
     que no las tiene. */
    const { data: todos } = await db.from("soporte_tickets").select("estado");
    const recuento = {};
    ESTADOS.forEach((e) => (recuento[e.valor] = 0));
    (todos || []).forEach((t) => {
      recuento[t.estado] = (recuento[t.estado] || 0) + 1;
    });

    const total = count || 0;
    res.render("panel/tickets", {
      title: "Soporte",
      site: sitio,
      base: "/panel",
      current: "tickets",
      tickets: data || [],
      estados: ESTADOS,
      etiquetaEstado,
      estado,
      q,
      recuento,
      /* El mensaje del fallo de la consulta, para enseyarlo en la
         vista. Vacio si todo va bien. Es lo que impide que un
         error se vea como una lista vacia. */
      fallo,
      pagina,
      paginas: Math.max(1, Math.ceil(total / POR_PAGINA)),
      total,
      desde: total === 0 ? 0 : desde + 1,
      hasta: Math.min(desde + POR_PAGINA, total),
    });
  });

  router.get("/tickets/:id", requiereStaff, async (req, res) => {
    const { data: ticket } = await db
      .from("soporte_tickets")
      .select("*, clients(empresa,nombre), services(titulo)")
      .eq("id", req.params.id)
      .maybeSingle();

    /* Un ticket que no existe y uno de otro tenant dan la misma
       respuesta: 404. Distinguirlos sería contarle a quien
       prueba si el id existe. */
    if (!ticket) return res.status(404).render("panel/404", { title: "No encontrado", base: "/panel", site: sitio });

    /* Aquí SÍ se leen los mensajes internos: es la vista del
       equipo. El filtro `interno` no va, a propósito. */
    const { data: mensajes } = await db
      .from("soporte_mensajes")
      .select("*")
      .eq("ticket_id", ticket.id)
      .order("creado_en", { ascending: true });

    res.render("panel/ticket", {
      title: ticket.asunto,
      site: sitio,
      base: "/panel",
      current: "tickets",
      ticket,
      mensajes: mensajes || [],
      estados: ESTADOS,
      etiquetaEstado,
    });
  });

  /* Contestar.
   *
   * `interno` sí se lee del cuerpo, y solo aquí, porque esta ruta
   * es del equipo. */
  router.post("/tickets/:id/mensaje", requiereStaff, async (req, res) => {
    const cuerpo = String((req.body && req.body.cuerpo) || "").trim();
    const interno = Boolean(req.body && req.body.interno);

    if (!cuerpo) return res.redirect("/panel/tickets/" + req.params.id);

    const { data: ticket } = await db
      .from("soporte_tickets")
      .select("id,estado")
      .eq("id", req.params.id)
      .maybeSingle();

    if (!ticket) return res.status(404).render("panel/404", { title: "No encontrado", base: "/panel", site: sitio });

    await db.from("soporte_mensajes").insert({
      ticket_id: ticket.id,
      autor_id: req.sesion.user_id,
      autor_rol: "staff",
      cuerpo,
      interno,
      creado_en: new Date().toISOString(),
    });

    /* Contestar mueve el ticket a "en curso", y solo si estaba
       abierto.

       Es una consecuencia, no una función: nadie ha marcado "lo
       cogo", pero el ticket tiene una respuesta del equipo, y
       dejarlo en "abierto" haría que la lista dijera que nadie
       lo ha tocado cuando es falso. Un resuelto NO se reabre solo
       por contestarlo: eso lo decide quien lo resolvió. */
    if (!interno && ticket.estado === "abierto") {
      await db
        .from("soporte_tickets")
        .update({ estado: "en_curso", actualizado_en: new Date().toISOString() })
        .eq("id", ticket.id);
    } else {
      await db.from("soporte_tickets").update({ actualizado_en: new Date().toISOString() }).eq("id", ticket.id);
    }

    await auth.auditar(db, {
      actor: { id: req.sesion.user_id, email: null },
      accion: interno ? "nota-interna" : "responder",
      entidad: "soporte_tickets",
      entidadId: ticket.id,
      req,
    });

    res.redirect("/panel/tickets/" + ticket.id + "#ultimo");
  });

  router.post("/tickets/:id/estado", requiereStaff, async (req, res) => {
    const nuevo = String((req.body && req.body.estado) || "");
    if (!esEstado(nuevo)) return res.redirect("/panel/tickets/" + req.params.id);

    const { data: actual } = await db.from("soporte_tickets").select("estado").eq("id", req.params.id).maybeSingle();

    const ahora = new Date().toISOString();
    await db
      .from("soporte_tickets")
      .update({
        estado: nuevo,
        /* `resuelto_en` se pone al resolver y se borra al salir de
           ahí. Guardar cuándo se resolvió de verdad solo sirve si
           además se puede saber que dejó de estarlo; si se dejara
           la marca vieja, "resuelto hace 3 días" sería mentira
           después de un REABIERTO. */
        resuelto_en: nuevo === "resuelto" ? ahora : null,
        actualizado_en: ahora,
      })
      .eq("id", req.params.id);

    await auth.auditar(db, {
      actor: { id: req.sesion.user_id, email: null },
      accion: "cambiar-estado",
      entidad: "soporte_tickets",
      entidadId: req.params.id,
      detalle: { antes: actual && actual.estado, despues: nuevo },
      req,
    });

    res.redirect("/panel/tickets/" + req.params.id);
  });

  /* ─────────────────────────────────────────────────────────
     EL CLIENTE
     ───────────────────────────────────────────────────────── */

  router.get("/mis-tickets", requiereLogin, async (req, res) => {
    const clienteId = await clientIdDe(req.sesion.user_id);

    if (!clienteId) {
      return res.render("panel/mis-tickets", {
        title: "Soporte",
        site: sitio,
        base: "/panel",
        tickets: [],
        mensaje: "Tu cuenta todavía no está asociada a una empresa.",
      });
    }

    const { data: tickets } = await db
      .from("soporte_tickets")
      .select("*, services(titulo)")
      .eq("cliente_id", clienteId)
      .order("actualizado_en", { ascending: false })
      .limit(POR_PAGINA);

    res.render("panel/mis-tickets", {
      title: "Soporte",
      site: sitio,
      base: "/panel",
      tickets: tickets || [],
      etiquetaEstado,
    });
  });

  router.get("/mis-tickets/nuevo", requiereLogin, async (req, res) => {
    const clienteId = await clientIdDe(req.sesion.user_id);

    const { data: servicios } = await db
      .from("services")
      .select("id,titulo")
      .eq("client_id", clienteId)
      .order("titulo");

    res.render("panel/mi-ticket-nuevo", {
      title: "Abrir un ticket",
      site: sitio,
      base: "/panel",
      servicios: servicios || [],
    });
  });

  router.post("/mis-tickets", requiereLogin, async (req, res) => {
    const clienteId = await clientIdDe(req.sesion.user_id);
    if (!clienteId) return res.redirect("/panel/mis-tickets");

    const { errores, datos } = validar(req.body, {
      asunto: [["texto", { min: 6, max: 160 }]],
      cuerpo: [["texto", { min: 10, max: 4000 }]],
    });

    if (errores.asunto || errores.cuerpo) {
      const { data: servicios } = await db
        .from("services")
        .select("id,titulo")
        .eq("client_id", clienteId)
        .order("titulo");

      return res.status(400).render("panel/mi-ticket-nuevo", {
        title: "Abrir un ticket",
        site: sitio,
        base: "/panel",
        servicios: servicios || [],
        errores,
        datos: req.body,
      });
    }

    const servicioId = String(req.body.servicio_id || "").trim() || null;

    /* El servicio se comprueba contra los del cliente ANTES de
       guardar.

       La RLS ya lo rechaza si apunta a otro cliente, pero eso
       llegaría como error de la base: un 500 con un texto que no
       explica el problema. Comprobándolo aquí, el cliente ve que
       ese servicio no es suyo, y el equipo no recibe tickets
       imposibles de interpretar. */
    if (servicioId) {
      const { data: suyo } = await db
        .from("services")
        .select("id")
        .eq("id", servicioId)
        .eq("client_id", clienteId)
        .maybeSingle();

      if (!suyo) servicioId = null;
    }

    const ahora = new Date().toISOString();

    const { data: ticket, error } = await db
      .from("soporte_tickets")
      .insert({
        cliente_id: clienteId,
        servicio_id: servicioId,
        asunto: datos.asunto,
        estado: "abierto",
        creado_en: ahora,
        actualizado_en: ahora,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[tickets] " + error.message);
      return res.redirect("/panel/mis-tickets");
    }

    /* El primer mensaje va en la MISMA fila conceptual que el
       ticket, no en un segundo paso.

       Motivo: si se guardara el ticket y luego fallara el
       mensaje, el cliente tendría un ticket vacío con un asunto y
       ningún texto. Y un ticket vacío no se puede contestar bien,
       así que el cliente se queda sin poder hacer nada con él. Es
       mejor que no exista. */
    await db.from("soporte_mensajes").insert({
      ticket_id: ticket.id,
      autor_id: req.sesion.user_id,
      autor_rol: "cliente",
      cuerpo: datos.cuerpo,
      interno: false,
      creado_en: ahora,
    });

    await auth.auditar(db, {
      actor: { id: req.sesion.user_id, email: null },
      accion: "abrir-ticket",
      entidad: "soporte_tickets",
      entidadId: ticket.id,
      req,
    });

    res.redirect("/panel/mis-tickets/" + ticket.id);
  });

  router.get("/mis-tickets/:id", requiereLogin, async (req, res) => {
    const clienteId = await clientIdDe(req.sesion.user_id);

    /* El filtro por `cliente_id` NO es una cortesía: es la
       propiedad que impide que un cliente lea el ticket de otro
       cambiando el id en la URL. Si se quitara, cualquier cliente
       sabría el id de otro y vería su conversación. */
    const { data: ticket } = await db
      .from("soporte_tickets")
      .select("*, services(titulo)")
      .eq("id", req.params.id)
      .eq("cliente_id", clienteId || "__ninguno__")
      .maybeSingle();

    if (!ticket) return res.status(404).render("panel/404", { title: "No encontrado", base: "/panel", site: sitio });

    /* `interno: false` en la consulta, y no un filtro en la vista.

       Es la única defensa real aquí, y es de datos: el mensaje
       interno no llega al HTML del cliente. Filtrarlo al pintar
       sería tener el secreto ya en el HTML, en un `if` que
       alguien puede quitar. */
    const { data: mensajes } = await db
      .from("soporte_mensajes")
      .select("id,autor_rol,cuerpo,creado_en")
      .eq("ticket_id", ticket.id)
      .eq("interno", false)
      .order("creado_en", { ascending: true });

    res.render("panel/mi-ticket", {
      title: ticket.asunto,
      site: sitio,
      base: "/panel",
      ticket,
      mensajes: mensajes || [],
      etiquetaEstado,
    });
  });

  router.post("/mis-tickets/:id/mensaje", requiereLogin, async (req, res) => {
    const clienteId = await clientIdDe(req.sesion.user_id);
    const cuerpo = String((req.body && req.body.cuerpo) || "").trim();

    if (!cuerpo) return res.redirect("/panel/mis-tickets/" + req.params.id);

    const { data: ticket } = await db
      .from("soporte_tickets")
      .select("id,estado")
      .eq("id", req.params.id)
      .eq("cliente_id", clienteId || "__ninguno__")
      .maybeSingle();

    if (!ticket) return res.redirect("/panel/mis-tickets");

    /* Ni `interno` ni nada parecido se lee del cuerpo. Está dicho
       arriba y repetido aquí porque este es el sitio donde el
       descuido costaría. */
    const ahora = new Date().toISOString();

    await db.from("soporte_mensajes").insert({
      ticket_id: ticket.id,
      autor_id: req.sesion.user_id,
      autor_rol: "cliente",
      cuerpo,
      interno: false,
      creado_en: ahora,
    });

    /* Si estaba resuelto y el cliente escribe, vuelve a abierto.

       Es lo que hace que un ticket resuelto no sea una puerta en
       la que no se puede volver: el cliente responde y el equipo
       lo ve otra vez. Sin esto, escribir en un resuelto se
       archivaría en silencio y el cliente creería haber dicho algo.

       El objeto se arma antes porque `resuelto_en: undefined` NO es
       lo mismo que no mandar la columna. Depender de que el cliente
       de la base se trague un `undefined` es pedirle que un día
       deje de tragárselo y se borre la marca de la fecha sin querer.
       Aquí se dice explícitamente: si sigue resuelto, no se toca la
       fecha. */
    const cambios = { actualizado_en: ahora };

    if (ticket.estado === "resuelto") {
      cambios.estado = "abierto";
      cambios.resuelto_en = null;
    }

    await db.from("soporte_tickets").update(cambios).eq("id", ticket.id);

    res.redirect("/panel/mis-tickets/" + ticket.id + "#ultimo");
  });

  return router;
};

module.exports.ESTADOS = ESTADOS;
module.exports.etiquetaEstado = etiquetaEstado;