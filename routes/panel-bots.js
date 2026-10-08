/* =========================================================
   Nexo Studio — Bots y cajas de Evolution (rutas)
   ------------------------------------------------------------
   Lo que el equipo necesita para dar de alta un bot y para saber por
   qué el de un cliente no contesta.

   ESTA PANTALLA SUSTITUYE AL ADMIN DEL BOT
   -----------------------------------------
   Ese panel vivía en D:\webs\wweb (Next.js) y se borró en el commit
   1843047, "El bot deja de ser multi-cliente y pasa a entrar por ticket
   del panel". Con ese cambio desaparecieron también las tres cosas que
   solo se hacían desde allí:

     · dar de alta instancias y ver de quién eran   (AdminInstanceManager)
     · dar de alta y probar cajas de Evolution      (AdminServers)
     · ver los usuarios                            (AdminUserManager)

   Ahora están aquí, junto al resto de la gestión, y con una diferencia
   que es la que importa: el bot de un cliente se da de alta desde la
   ficha de SU cliente, no desde una lista de todos los usuarios.

   ── QUÉ PUEDE HACER EL EQUIPO Y QUÉ NO ──
   Puede dar de alta el bot, cambiarlo de caja, probar la caja y ver si
   el número está enlazado. NO ve el QR ni puede desconectar o reiniciar
   el número de un cliente: eso lo hace el cliente desde su portal, y
   que el equipo pueda hacerlo en silencio es la forma corta de que un
   cliente se despierte sin WhatsApp y sin aviso.

   Lo que sí se hace aquí, y es de solo lectura, es preguntar a la caja
   cómo está el número. Preguntar no cambia nada.

   ── EL REPARTO DE CAJAS ──
   Automático: la caja con más cupos libres. La regla y sus desempates
   están en lib/bots.js, no aquí. Si no hay sitio, el alta se para y lo
   dice con el motivo, en vez de crear un bot que apuntaría a una caja
   llena.

   ── NADA DE ESTO SE VE DESDE EL PORTAL DEL CLIENTE ──
   Las urls y las claves están en `evolution_servers`, que no tiene
   políticas RLS a propósito (migración 011): al cliente no le sirven de
   nada y le darían acceso a los bots de todos los de su caja.
   ========================================================= */

const express = require("express");

const auth = require("../lib/auth");
const botsLib = require("../lib/bots");
const evolution = require("../lib/evolution");
const { validar, vacioANull } = require("../lib/validate");

const BASE = "/panel";

/* Los textos de los ?aviso=, para no repetirlos en cada vista.
   Un mensaje que se escribe dos veces acaba siendo distinto en las dos,
   y el que se queda viejo es el que nadie busca. */
const AVISOS = {
  "bot:creado": "Bot creado. El cliente ya puede entrar y conectar su número.",
  "bot:revisado": "Estado consultado en la caja.",
  "bot:servidor": "Bot movido a la otra caja.",
  "bot:sin-caja": "Ese cliente ya tiene un bot.",
  "servidor:creado": "Caja dada de alta.",
  "servidor:guardado": "Caja guardada.",
  "servidor:probado": "Caja probada.",
  "servidor:activado": "Caja activada.",
  "servidor:desactivado": "Caja desactivada. Los bots que ya viven ahí siguen funcionando.",
};

/* Los motivos de error que llegan por ?error=, redactados aquí para que
   el que llama no tenga que inventar un texto con datos de la base
   metidos en una URL. */
const ERRORES = {
  "bot:no-existe": "Ese bot no existe o ya no está.",
  "servidor:no-existe": "Esa caja no existe.",
  "servidor:lleno": "No hay sitio en ninguna caja. Revisa los cupos en Servidores.",
  "servidor:no-contesta": "La caja no respondió. No se guardó nada.",
  "servidor:clave": "La caja rechazó la clave. Revísala antes de guardar.",
  "servidor:duplicado": "Ya hay una caja con esa dirección.",
  "caja:crear": "La caja se creó, pero al preparar el bot falló la caja: ",
  "caja:traslantar": "No se pudo mover el bot: la caja nueva no respondió. Se queda donde estaba.",
};

/* El aviso de "esta caja todavía no puede hablar con el bot".
   Vive aquí y no en la vista porque aparece en dos sitios —el formulario
   de alta y la lista de cajas— y duplicado se desincroniza: la versión
   corta no diría por qué el bot no va a contestar. */
const AVISO_SIN_SECRETO =
  "La caja no tiene el secreto del webhook. Los bots que se den de alta aquí no recibirán mensajes: " +
  "la Evolution aceptará el webhook sin cabecera y el bot rechazará todo lo que llegue, sin dar ningún error. " +
  "Pon el mismo valor que WEBHOOK_SECRET en el servicio del bot.";

/* ── El esquema de validación ──
   Se declara arriba, junto a los textos, y no dentro de cada POST: son
   las mismas reglas en el alta y en la edición, y duplicadas se
   desincronizan sin que nada avise.

   `webhook_secret` NO está en el esquema a propósito: no es obligatorio
   (ver la nota en el POST del alta). Se limpia igual, para que lo que se
   guarda no venga con espacios, pero no se valida porque un valor vacío
   es una decisión legítima y no un error. */
const ESQUEMA_SERVIDOR = {
  name: [["requerido"], ["texto", { max: 80, min: 2 }]],
  url: ["requerido"],
  api_key: [["texto", { max: 200 }]],
  plan: ["unoDe", ["subscription", "free"]],
  max_instances: [],
  notas: [["texto", { max: 500 }]],
  webhook_secret: [["texto", { max: 200 }]],
};

/** La url tiene que ser una url de verdad, y no cualquier cosa.
 *
    Antes esto no se comprobaba en el servidor: se guardaba lo que
    llegara y el error salía mucho después, al ir a probar la caja, que
    es cuando ya hay un bot dado de alta al que le pasa algo. */
const reglaUrl = (v) => evolution.problemaDeUrl(v);

/** Los cupos: un entero de 1 a 500.
 *
    El 500 es un tope arbitrario, y por eso se escribe: sin él, un 999999
    pasa el validador y el reparto cree que la caja tiene sitio para
    siempre. Un número que no viene del mundo real en un campo de "cupos"
    es un error de dedo.

    Y 0 no se acepta a propósito. "0 cupos" y "desactivada" significan lo
    mismo, pero solo una de las dos dos cosas se puede equivocar en
    silencio: si el tope es 0 el reparto elige la caja y no puede meter
    nada, y el error aparece en el bot del cliente. Con `activo = false`
    el reparto lo dice por qué. */
const reglaCupos = (v) => {
  const s = String(v == null ? "" : v).trim();
  if (!s) return undefined; /* vacío = el default de la base */
  if (!/^\d+$/.test(s)) return "Un número entero, sin decimales ni signos.";
  const n = Number(s);
  if (n < 1) return "Mínimo 1. Para dejar de repartir bots a esta caja, desactívala.";
  if (n > 500) return "Más de 500 números en una caja no es real. Repásalo.";
  return undefined;
};

/** Las reglas propias de este fichero, por nombre de campo.
 *
    Se escriben en un objeto y no en el esquema porque `validar()` de
    lib/validate.js solo conoce las suyas. El esquema dice QUÉ campos hay
    y con qué límite de longitud; aquí solo se añade lo que necesita el
    fichero. */
const REGLAS_SERVIDOR = {
  url: reglaUrl,
  max_instances: reglaCupos,
};

/* El validador del panel, más las dos reglas de aquí. */
const validarServidor = (datos) => {
  const { errores, datos: limpios } = validar(datos, ESQUEMA_SERVIDOR);
  for (const [campo, regla] of Object.entries(REGLAS_SERVIDOR)) {
    if (errores[campo]) continue;
    const e = regla(limpios[campo]);
    if (e) errores[campo] = e;
  }
  return { errores, datos: limpios };
};

module.exports = function rutasBots({ db, sitio, requiereStaff }) {
  const router = express.Router();

  /** Un aviso o un error según lo que venga en la URL.
      Devuelve siempre la misma forma, y si el texto no se reconoce
      devuelve null en vez de inventar uno: una URL manipulada a mano no
      puede pintar en la pantalla del panel lo que quiera. */
  const mensajeDe = (req) => {
    const ok = AVISOS[req.query.aviso];
    if (ok) {
      /* "Caja probada" sin el número no dice nada: lo que se quiere saber
         después de darle a Probar es si hay sitio y si la caja tiene lo
         que debería. El recuento llega en la URL porque la prueba se hizo
         en el POST, que se pierde al redirigir. */
      if (req.query.aviso === "servidor:probado" && req.query.instancias != null) {
        const n = Number(req.query.instancias) || 0;
        return {
          tipo: "ok",
          texto:
            "Caja probada: responde y acepta la clave. Hay " +
            n +
            " instancia" +
            (n === 1 ? "" : "s") +
            " dentro.",
        };
      }
      return { tipo: "ok", texto: ok };
    }
    const ko = ERRORES[req.query.error];
    if (ko) return { tipo: "error", texto: ko };
    /* Los errores con texto detrás (los de Evolution) vienen como
       `error=caja:crear&detalle=...`. El detalle se recorta porque va
       en la URL y una URL no debería llevar medio kilobyte. */
    if (req.query.error === "caja:crear" || req.query.error === "caja:traslantar") {
      const detalle = String(req.query.detalle || "").slice(0, 200);
      return { tipo: "error", texto: ERRORES[req.query.error] + (detalle || "(sin detalle)") };
    }
    return null;
  };

  /** Las notas que viajan en la redirección.
      Son avisos que NO impiden la acción (una caja guardada sin
      comprobar, un webhook reenganchado), así que no son errores: van
      aparte y en tono distinto. Se truncan porque vienen en la URL. */
  const notaDe = (req) => {
    const n = String(req.query.nota || "").trim();
    return n ? n.slice(0, 400) : null;
  };

  /* =========================================================
     Los bots
     ========================================================= */

  /* ---------- Listado ----------
     Cada fila: el bot, el cliente que lo tiene (con su email, que es
     lo que se busca cuando alguien escribe "el bot de Fulano"), la caja
     y el estado del número.

     El estado sale de la base, no de la caja: preguntar a la caja en cada
     carga serían tantas peticiones como bots, cada una con su tiempo
     límite, y la pantalla tardaría lo que tardase la más lenta. Hay un
     botón "Revisar" por fila para ir a la caja a preguntar, y ese es el
     dato que se usa para decidir si algo está roto. */
  router.get("/bots", requiereStaff, async (req, res) => {
    const q = String(req.query.q || "").trim();
    const estado = String(req.query.estado || "").trim();

    let filas = [];
    let cajas = [];
    let errorCarga = null;

    try {
      [filas, cajas] = await Promise.all([botsLib.botsConCaja(db), botsLib.cajasConCupos(db)]);
    } catch (err) {
      console.error("[bots] no se pudo cargar:", err.message);
      errorCarga = "No se pudo leer la base: " + err.message;
    }

    /* El filtro va en memoria y no en la consulta. Con un bot por
       cliente son decenas de filas; el día que fueran miles habría que
       moverlo, pero antes de eso lo complicado de más es lo que se rompe:
       el filtro tiene que buscar por el nombre del bot Y por el de la
       empresa Y por el email, y el email no está en `bots`. Se cruzan
       en el servidor, como se hace en /panel/accesos. */
    let bots = filas.map((b) => {
      const cliente = Array.isArray(b.clients) ? b.clients[0] : b.clients;
      const caja = Array.isArray(b.evolution_servers) ? b.evolution_servers[0] : b.evolution_servers;
      return {
        id: b.id,
        nombre: b.name,
        slug: b.slug,
        instancia: b.instance_name,
        estado: botsLib.estadoBot(b.status),
        estadoCrudo: b.status,
        comprobadoEn: b.status_checked_at,
        clienteId: b.client_id,
        cliente: cliente ? cliente.empresa || cliente.nombre : "(sin empresa)",
        clienteEmail: cliente ? cliente.email : null,
        cajaId: b.server_id,
        caja: caja ? caja.name : "(caja eliminada)",
        url: caja ? caja.url : null,
        creadoEn: b.created_at,
        busqueda: [b.name, b.slug, cliente && cliente.empresa, cliente && cliente.nombre, cliente && cliente.email]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      };
    });

    if (q) {
      const p = q.toLowerCase();
      bots = bots.filter((b) => b.busqueda.includes(p));
    }
    if (estado === "conectado") bots = bots.filter((b) => b.estadoCrudo === "open");
    else if (estado === "sin-conectar") bots = bots.filter((b) => b.estadoCrudo !== "open");

    /* Los contadores de arriba. El de "sin conectar" es el que hace
       aparecer trabajo pendiente; por eso va en rojo en la pantalla, no
       como un dato más. */
    const cuenta = filas.map((b) => ({ estado: b.status }));
    const sinConectar = cuenta.filter((b) => b.estado !== "open").length;

    const libres = cajas.filter((c) => c.activo).reduce((n, c) => n + c.libres, 0);

    res.render("panel/bots", {
      title: "Bots",
      site: sitio,
      base: BASE,
      current: "bots",
      bots,
      cajas,
      q,
      estado,
      mensaje: mensajeDe(req),
      nota: notaDe(req),
      errorCarga,
      counts: {
        total: filas.length,
        sinConectar,
        conectados: filas.length - sinConectar,
        cajas: cajas.filter((c) => c.activo).length,
        libres,
      },
    });
  });

  /* ---------- Alta ----------
     Un bot por cliente (ver migración 015). El formulario solo ofrece
     clientes que NO tienen uno, porque la lista de todos los clientes
     con un desplegable "elegir" obliga a acertar a la primera y el
     error sale como un rechazo de la base que no explica nada. */
  router.get("/bots/nuevo", requiereStaff, async (req, res) => {
    let reparto = { sinBot: [], conBot: [] };
    let cajas = [];
    let errorCarga = null;

    try {
      reparto = await clientesRepartidos(db);
      cajas = await botsLib.cajasConCupos(db);
    } catch (err) {
      console.error("[bots] alta:", err.message);
      errorCarga = "No se pudo leer la base: " + err.message;
    }

    /* Qué caja se propondría. Se calcula aquí para poder ponerlo en el
       texto del botón ("se propondrá X"), no para decidirlo: si el
      la propuesta es un dato y no la decisión, quien da de alta puede
       mirar la capacidad de cada caja antes de aceptar. */
    const propuesta = botsLib.elegirCaja(cajas, null);

    res.render("panel/bot-form", {
      title: "Nuevo bot",
      site: sitio,
      base: BASE,
      current: "bots",
      clientes: reparto.sinBot,
      conBot: reparto.conBot,
      cajas,
      propuesta: propuesta.caja,
      sinSitio: propuesta.motivo,
      modo: "nuevo",
      bot: {
        client_id: String(req.query.cliente || ""),
        name: "",
        slug: "",
        server_id: "",
        welcome_message: "",
      },
      errores: {},
      mensaje: mensajeDe(req),
      nota: notaDe(req),
      errorCarga,
    });
  });

  router.post("/bots/nuevo", requiereStaff, async (req, res) => {
    const clientId = vacioANull(req.body.client_id);
    const nombre = String(req.body.name || "").trim();
    const slugPedido = String(req.body.slug || "").trim();
    const servidorPedido = vacioANull(req.body.server_id);

    const errores = {};
    if (!clientId) errores.client_id = "Elige a qué cliente es el bot.";
    if (!nombre) errores.name = "Elige un nombre para el bot.";
    else if (nombre.length > 80) errores.name = "Máximo 80 caracteres.";

    /* El slug no es obligatorio: sale del nombre. Pero si se escribe,
     * tiene que ser válido, porque es una URL pública y un slash
     * dentro rompe el enlace que se le da al cliente. */
    const slug = slugPedido ? botsLib.slugDe(slugPedido) : botsLib.slugDe(nombre);
    if (slugPedido && slug !== slugPedido.toLowerCase()) {
      /* No es un error: minúsculas y guiones son lo único que se
         guarda. Se avisa para que nadie se quede pensando que se
         guardó el texto tal cual. */
    }

    /* ¿Tiene ya bot? Se comprueba antes de tocar la caja: crear la
       instancia en Evolution y luego fallar aquí dejaría un número
       huérfano en la caja, que es justo el tipo de basura que no se
       ve hasta que la caja se llena. */
    if (clientId && !errores.client_id) {
      try {
        const previo = await botsLib.botDeCliente(db, clientId);
        if (previo) return res.redirect(BASE + "/bots?error=bot:sin-caja");
      } catch (err) {
        console.error("[bots] no se pudo comprobar el cliente:", err.message);
      }
    }

    let cajas = [];
    let elegido = { caja: null, motivo: null };
    if (!Object.keys(errores).length) {
      try {
        cajas = await botsLib.cajasConCupos(db);
        elegido = botsLib.elegirCaja(cajas, servidorPedido);
        if (!elegido.caja) errores.server_id = elegido.motivo;
      } catch (err) {
        console.error("[bots] reparto:", err.message);
        errores.general = "No se pudo decidir la caja: " + err.message;
      }
    }

    /* `async` porque vuelve a pedir los clientes sin bot: si se rindiera
       con la lista del GET, el formulario que vuelve a pintarse tras un
       error ofrecería clientes que ya tienen bot, o no ofrecería ninguno.

       Y repropone caja aunque la haya elegido a mano: si el equipo marcó
       una y esa es la que no tiene sitio, el error tiene que verse
       debajo de la caja que marquaron, no al lado de otra distinta. */
    const rehacer = async () => {
      const reparto = await clientesRepartidos(db);
      const propuestaAhora = elegido.caja || botsLib.elegirCaja(cajas, servidorPedido).caja;

      res.status(400).render("panel/bot-form", {
        title: "Nuevo bot",
        site: sitio,
        base: BASE,
        current: "bots",
        clientes: reparto.sinBot,
        conBot: reparto.conBot,
        cajas,
        propuesta: propuestaAhora,
        sinSitio: elegido.motivo,
        modo: "nuevo",
        bot: { client_id: clientId || "", name: nombre, slug: slugPedido, server_id: servidorPedido || "" },
        errores,
        mensaje: null,
        nota: null,
        errorCarga: null,
      });
    };

    if (Object.keys(errores).length) return rehacer();

    const caja = elegido.caja;
    const nombreInstancia = botsLib.nombreDeInstancia(slug);

    /* El slug es ÚNICO en la base (migración 011) y el nombre de
       instancia también (015). Se comprueba aquí, ANTES de llamar a
       la caja, por lo mismo que antes: crear la instancia y luego
       chocar con el índice deja un número en la caja que nadie va a
       usar. */
    const { data: chocando } = await db
      .from("bots")
      .select("id,name")
      .or(`slug.eq.${slug},instance_name.eq.${nombreInstancia}`)
      .maybeSingle();

    if (chocando) {
      errores.slug = `Ese nombre de bot ya lo usa "${chocando.name}". Cambia el nombre o la dirección.`;
      return rehacer();
    }

    /* ── Ahora sí, la caja ── */
    const { data: cajaFila, error: eCaja } = await db
      .from("evolution_servers")
      .select("id,name,url,api_key,webhook_secret")
      .eq("id", caja.id)
      .maybeSingle();

    if (eCaja || !cajaFila) {
      return res.redirect(BASE + "/bots?error=servidor:no-existe");
    }

    const preparado = await botsLib.prepararEnCaja(cajaFila, nombreInstancia);

    if (!preparado.ok) {
      /* La caja pudo crear la instancia y fallar después (al guardar el
         webhook). No se inserta la fila: un bot en la base sin número
         detrás parece que funciona y no contesta. Se vuelve al
         formulario con el motivo. */
      console.error("[bots] la caja falló al preparar el bot:", preparado.mensaje);
      errores.general = preparado.mensaje;
      return rehacer();
    }

    const { data: creado, error: eBot } = await db
      .from("bots")
      .insert({
        client_id: clientId,
        server_id: caja.id,
        name: nombre,
        instance_name: nombreInstancia,
        slug,
        status: "close",
        welcome_message: vacioANull(req.body.welcome_message),
      })
      .select("id")
      .single();

    if (eBot) {
      /* La caja ya tiene la instancia y la base no ha guardado el bot.
         No se deshace (borrar la instancia de la caja es una operación
         destructiva y aquí no se hace nunca por sorpresa), pero se dice
         en claro: el número existe en la caja y no está dado de alta en
         la base. */
      console.error("[bots] la caja creó la instancia pero no se pudo guardar el bot:", eBot.message);
      return res.redirect(BASE + "/bots?error=caja:crear&detalle=" + encodeURIComponent(eBot.message));
    }

    await auth.auditar(db, {
      actor: { id: req.sesion.user_id, email: null },
      accion: "crear-bot",
      entidad: "bots",
      entidadId: creado.id,
      /* El nombre de la caja va en el log porque "el bot no contesta" se
         depura empezando por dónde vive el número. La clave NO: nunca,
         ni en el log ni en el detalle. */
      detalle: { client_id: clientId, server_id: caja.id, server_name: caja.name, slug },
      req,
    });

    /* Los avisos de la preparación (webhook reenganchado, sin dominio)
       se pasan por la URL porque la redirección es lo único que sobrevive
       a un POST. El texto va truncado: una URL no es un sitio para
       mensajes largos. */
    const extra = preparado.avisos.length ? "&aviso=bot:creado&nota=" + encodeURIComponent(preparado.avisos.join(" ")) : "";
    res.redirect(BASE + "/bots?aviso=bot:creado" + extra);
  });

  /* ---------- Revisar el estado ----------
     Pregunta a la caja cómo está el número y guarda la respuesta.

     Es de solo lectura: no toca la instancia, no genera QR, no
     reinicia. Lo que se guarda es un dato que caduca, así que se
     anota cuándo se preguntó (`status_checked_at`), porque un estado
     viejo pintado como si fuera de ahora es peor que no pintarlo. */
  router.post("/bots/:id/revisar", requiereStaff, async (req, res) => {
    const bot = await botConCaja(db, req.params.id);
    if (!bot) return res.redirect(BASE + "/bots?error=bot:no-existe");

    /* El nombre va en la RUTA de Evolution, y es el de la INSTANCIA, no el
       de la caja. Se parecen (los dos son nombres que alguien escribió) y
       por eso es fácil equivocarse: preguntando por "Evolution principal"
       la caja responde 404 con un mensaje que no dice nada útil, y la
       pantalla dice "la caja no responde" cuando lo que no existe es ese
       número.

       Ocurrió: la primera versión destructuraba `{ url, api_key, name }`
       de la caja y leía `name` pensando que era el número. */
    const r = await evolution.estadoConexion(
      bot.cajaFila.url,
      bot.cajaFila.api_key,
      bot.nombreInstancia
    );

    if (r.ok) {
      await db
        .from("bots")
        .update({ status: r.data.estado, status_checked_at: new Date().toISOString() })
        .eq("id", bot.id);
    }
    /* Si la caja no respondió no se guarda nada: el estado anterior pasa
       a ser de "hace una hora", que es más honesto que dejar el mismo
       valor con la fecha puesta ahora. */

    const detalle = r.ok ? "" : "&detalle=" + encodeURIComponent(r.mensaje);
    res.redirect(
      BASE + "/bots" + (r.ok ? "?aviso=bot:revisado" : "?error=servidor:no-contesta" + detalle)
    );
  });

  /* ---------- Cambiar de caja ----------
     Solo cuando el bot no está en línea. Mover un número que está
     funcionando dejaría al cliente sin WhatsApp en mitad de una
     conversación, y no es un problema que se pueda arreglar desde el
     panel: tiene que volver a escanear el QR. */
  router.post("/bots/:id/servidor", requiereStaff, async (req, res) => {
    const bot = await botConCaja(db, req.params.id);
    if (!bot) return res.redirect(BASE + "/bots?error=bot:no-existe");

    if (bot.status === "open") {
      return res.redirect(
        BASE + "/bots?error=caja:traslantar&detalle=" +
          encodeURIComponent("El número está en línea. Desconéctalo antes de moverlo de caja.")
      );
    }

    const destino = vacioANull(req.body.server_id);
    if (!destino || destino === bot.cajaFila.id) {
      return res.redirect(BASE + "/bots");
    }

    let cajas = [];
    try {
      cajas = await botsLib.cajasConCupos(db);
    } catch (err) {
      return res.redirect(BASE + "/bots?error=servidor:no-existe");
    }

    /* La caja de la que se sale también cuenta como sitio mientras el
       bot siga en ella: si no, cambiar un bot de una caja llena a otra
       llena se dejaría sin poder, cuando lo único que hace falta es
       mirar el conjunto. */
    const elegido = botsLib.elegirCaja(cajas, destino);
    if (!elegido.caja) {
      return res.redirect(
        BASE + "/bots?error=servidor:lleno&detalle=" + encodeURIComponent(elegido.motivo)
      );
    }

    const { data: cajaFila } = await db
      .from("evolution_servers")
      .select("id,name,url,api_key,webhook_secret")
      .eq("id", elegido.caja.id)
      .maybeSingle();

    if (!cajaFila) return res.redirect(BASE + "/bots?error=servidor:no-existe");

    /* Se crea en la caja nueva ANTES de cambiar la fila. Si la caja
       falla, el bot sigue apuntando a la antigua, que es la que
       funcionaba. Si se hiciera al revés, la fila apuntaría a una caja
       sin instancia y el bot no contestaría sin explicación. */
    const preparado = await botsLib.prepararEnCaja(cajaFila, bot.nombreInstancia);

    if (!preparado.ok) {
      console.error("[bots] traslado fallido:", preparado.mensaje);
      return res.redirect(
        BASE + "/bots?error=caja:traslantar&detalle=" + encodeURIComponent(preparado.mensaje)
      );
    }

    const { error: eCambio } = await db
      .from("bots")
      .update({ server_id: cajaFila.id, status: "close", status_checked_at: new Date().toISOString() })
      .eq("id", bot.id);

    if (eCambio) {
      return res.redirect(BASE + "/bots?error=caja:traslantar&detalle=" + encodeURIComponent(eCambio.message));
    }

    await auth.auditar(db, {
      actor: { id: req.sesion.user_id, email: null },
      accion: "mover-bot",
      entidad: "bots",
      entidadId: bot.id,
      detalle: { de: bot.cajaFila.name, a: cajaFila.name },
      req,
    });

    res.redirect(BASE + "/bots?aviso=bot:servidor");
  });

  /* =========================================================
     Las cajas
     ========================================================= */

  router.get("/servidores", requiereStaff, async (req, res) => {
    let cajas = [];
    let errorCarga = null;
    try {
      cajas = await botsLib.cajasConCupos(db);
    } catch (err) {
      console.error("[servidores] no se pudo cargar:", err.message);
      errorCarga = "No se pudo leer la base: " + err.message;
    }

    /* Los nombres de los bots de cada caja. Se piden todos los bots una
       vez y se agrupan aquí: son N llamadas a la caja si se hace una por
       caja, y cada una tiene su tiempo límite. Con la base ya se sabe
       qué número tiene cada caja sin preguntar a nadie. */
    let porCaja = new Map();
    try {
      const { data: bots } = await db.from("bots").select("id,name,slug,server_id,status,clients(empresa)");
      for (const b of bots || []) {
        if (!porCaja.has(b.server_id)) porCaja.set(b.server_id, []);
        const c = Array.isArray(b.clients) ? b.clients[0] : b.clients;
        porCaja.get(b.server_id).push({
          id: b.id,
          nombre: b.name,
          empresa: c ? c.empresa || c.nombre : "",
          estado: botsLib.estadoBot(b.status),
        });
      }
    } catch (err) {
      console.error("[servidores] bots por caja:", err.message);
    }

    const totalSlots = cajas.filter((c) => c.activo).reduce((n, c) => n + c.max_instances, 0);
    const totalLibres = cajas.filter((c) => c.activo).reduce((n, c) => n + c.libres, 0);

    res.render("panel/servidores", {
      title: "Servidores de bots",
      site: sitio,
      base: BASE,
      current: "servidores",
      /* El array va en `contenido` y NO en `bots`.

       `cajasConCupos()` ya trae `bots` como NÚMERO (cuántos hay), que es
       lo que pinta el "3 / 10" de la cabecera. Si aquí se llamara
       `bots` al array, lo pisaría y la cabecera salía con
       "[object Object] / 10": el typeof de un array es object, y al
       pintarlo con <%= %> sale tal cual.

       Dos nombres para el mismo dato, uno encima del otro, es justo el
       error que hace que un número se convierta en "undefined" o en
       "[object Object]" sin que nada más se entere. */
      cajas: cajas.map((c) => Object.assign({}, c, { contenido: porCaja.get(c.id) || [] })),
      mensaje: mensajeDe(req),
      nota: notaDe(req),
      errorCarga,
      counts: {
        total: cajas.length,
        inactivas: cajas.filter((c) => !c.activo).length,
        slots: totalSlots,
        libres: totalLibres,
        ocupados: totalSlots - totalLibres,
      },
    });
  });

  router.get("/servidores/nuevo", requiereStaff, (req, res) => {
    res.render("panel/servidor-form", {
      title: "Nuevo servidor de bots",
      site: sitio,
      base: BASE,
      current: "servidores",
      modo: "nuevo",
      servidor: {
        name: "",
        url: "",
        api_key: "",
        plan: "",
        max_instances: botsLib.CUPOS_POR_DEFECTO,
        notas: "",
        webhook_secret: "",
        tieneSecreto: false,
      },
      errores: {},
      mensaje: mensajeDe(req),
      aviso: null,
      /* El resultado de la última prueba. Aquí null: no se ha probado
         nada todavía. Después del POST llega con lo que respondió la caja,
         y la vista lo pinta arriba del formulario (ver la nota de la
         cabecera de servidor-form.ejs). */
      estadoPrueba: null,
    });
  });

  /* ---------- Alta de caja ----------
     Se prueba ANTES de guardar. Una caja con la clave mal escrita se
     guarda sin quejarse (la base no sabe si una clave es válida) y el
     error sale cuando ya hay bots que apuntan a ella: es decir, cuando
     un cliente pierde su número.

     Por eso el botón tiene un "probar y guardar" y la prueba va
     primero. La casilla "guardar aunque no responda" existe para el
     caso real: una caja recién apagada, o una que se quiere dejar
     preparada antes de levantarla. Sin ella habría que esperar a que
     la caja esté viva para poder darla de alta. */
  router.post("/servidores/nuevo", requiereStaff, async (req, res) => {
    const { errores, datos } = validarServidor(req.body);

    /* Clave de la caja: obligatoria. Es lo único que autoriza a hablar
       con la Evolution, así que una caja sin ella no sirve para nada. */
    if (!errores.api_key && !String(datos.api_key || "").trim()) {
      errores.api_key = "La clave de la caja es obligatoria al darla de alta.";
    }

    /* El secreto del webhook NO es obligatorio, pero avisa.

       Es el valor que el servicio del bot comprueba en cada mensaje
       (WEBHOOK_SECRET en wweb). Sin él, los bots que se den de alta en
       esta caja quedarán mudos: la Evolution acepta el webhook sin
       cabecera de autenticación y devuelve 200, y el bot rechaza todo lo
       que llega. El alta parecería correcta.

       Avisa en vez de bloquear porque hay un caso legítimo: la caja se
       prepara antes de que el bot esté desplegado, y en local no hay
       nada que escuchar. Bloquear el alta obligaría a tener el bot
       levantado para poder dar de alta la caja. */
    const sinSecreto = !String(datos.webhook_secret || "").trim();

    /* Una caja con la misma url es la misma caja. Doblarla no da más
       capacidad (es el mismo servidor) y reparte los bots entre dos
       filas que dicen lo mismo, así que el segundo bot de un cliente
       acaba en la que se creó primero por casualidad. */
    if (!errores.url) {
      const { data: mismaUrl } = await db
        .from("evolution_servers")
        .select("id,name")
        .eq("url", datos.url)
        .maybeSingle();
      if (mismaUrl) errores.url = `Esa dirección ya es la caja "${mismaUrl.name}". Edítala en lugar de crear otra.`;
    }

    const modo = "nuevo";
    const rehacer = (estado) =>
      res.status(400).render("panel/servidor-form", {
        title: "Nuevo servidor de bots",
        site: sitio,
        base: BASE,
        current: "servidores",
        modo,
        servidor: datos,
        errores,
        mensaje: null,
        aviso: sinSecreto ? AVISO_SIN_SECRETO : null,
        estadoPrueba: estado || null,
      });

    if (Object.keys(errores).length) return rehacer();

    /* La prueba. Va antes del insert por lo dicho arriba. */
    const prueba = await evolution.probar(datos.url, datos.api_key);

    const forzar = String(req.body.forzar || "") === "1";
    if (!prueba.ok && !forzar) {
      errores.url = prueba.mensaje;
      return rehacer({ ok: false, mensaje: prueba.mensaje });
    }

    const { data: creada, error: eIns } = await db
      .from("evolution_servers")
      .insert({
        name: datos.name,
        url: datos.url,
        api_key: datos.api_key,
        plan: datos.plan || null,
        max_instances: datos.max_instances ? Number(datos.max_instances) : botsLib.CUPOS_POR_DEFECTO,
        notas: datos.notas || null,
        /* Se guarda aunque venga vacío: el patrón es "sin secreto" y
           `String(null)` sería lo mismo, pero vacío se lee como lo que
           es, que es que todavía no se ha puesto. */
        webhook_secret: String(datos.webhook_secret || "").trim() || null,
      })
      .select("id")
      .single();

    if (eIns) {
      errores.url = "No se pudo guardar: " + eIns.message;
      return rehacer({ ok: false, mensaje: "No se pudo guardar." });
    }

    await auth.auditar(db, {
      actor: { id: req.sesion.user_id, email: null },
      accion: "crear-servidor",
      entidad: "evolution_servers",
      entidadId: creada.id,
      /* La url sí (hay que saber qué caja se creó). La clave NO, nunca:
       un log con la clave es un log con acceso a todos los bots de esa
       caja. */
      detalle: { name: datos.name, url: datos.url, plan: datos.plan || null, probado: prueba.ok },
      req,
    });

    /* La respuesta de la prueba viaja en la redirección. Si la caja
       estaba caída y se guardó de todos modos, el aviso tiene que
       seguir viéndose después de perder el POST.

       Los avisos se juntan en una sola nota en vez de encadenar varios
       `&nota=`: en la URL solo se leería el último, y con dos cosas
       que avisar se perdería la primera, que es la más grave. */
    const avisos = [];
    if (!prueba.ok) avisos.push("Se guardó sin comprobar: " + prueba.mensaje);
    if (sinSecreto) avisos.push(AVISO_SIN_SECRETO);

    if (prueba.ok && prueba.data.instancias > 0) {
      avisos.push(
        "La caja ya tiene " +
          prueba.data.instancias +
          " instancias. Comprueba que no sean números tuyos que no estén dados de alta."
      );
    }
    const notaFinal = avisos.length ? "&nota=" + encodeURIComponent(avisos.join(" ")) : "";

    res.redirect(BASE + "/servidores?aviso=servidor:creado" + notaFinal);
  });

  /* ---------- Edición ---------- */
  router.get("/servidores/:id/editar", requiereStaff, async (req, res) => {
    const { data, error } = await db
      .from("evolution_servers")
      .select("id,name,url,plan,max_instances,activo,notas,webhook_secret")
      .eq("id", req.params.id)
      .maybeSingle();

    if (error || !data) return res.redirect(BASE + "/servidores?error=servidor:no-existe");

    /* Ni la clave ni el secreto del webhook llegan al formulario. De los
       dos solo se envía si hay. El formulario solo necesita saber SI hay
       secreto, para poder avisar de que sin él los bots no van a
       funcionar.

       Escribir el valor actual en cada edición es una forma de que
       alguien lo deje a medias y lo rompa sin querer, y un campo de
       texto con la clave delante hace que quien edita el nombre de una
       caja la tenga en pantalla. Para cambiarlas hay un botón aparte. */
    res.render("panel/servidor-form", {
      title: "Editar servidor de bots",
      site: sitio,
      base: BASE,
      current: "servidores",
      modo: "editar",
      servidor: Object.assign({}, data, {
        api_key: "",
        webhook_secret: "",
        tieneSecreto: Boolean(data.webhook_secret),
      }),
      errores: {},
      mensaje: mensajeDe(req),
      aviso: data.webhook_secret ? null : AVISO_SIN_SECRETO,
      estadoPrueba: null,
    });
  });

  router.post("/servidores/:id/editar", requiereStaff, async (req, res) => {
    const { data: antes } = await db
      .from("evolution_servers")
      .select("id,name,url,plan,max_instances,activo,notas,webhook_secret")
      .eq("id", req.params.id)
      .maybeSingle();

    if (!antes) return res.redirect(BASE + "/servidores?error=servidor:no-existe");

    /* La clave solo se valida si viene. Vacío = se deja la que hay. */
    const cuerpo = Object.assign({}, req.body);
    if (!String(cuerpo.api_key || "").trim()) delete cuerpo.api_key;

    const { errores, datos } = validarServidor(cuerpo);

    /* Bajar los cupos por debajo de los bots que ya hay no se puede
       dejar pasar: la caja quedaría "llena" y el reparto dejaría de
       usarla, con bots dentro que son los que hay que atender. El
       formulario lo avisa antes de dejar guardar. */
    if (!errores.max_instances) {
      const { count } = await db
        .from("bots")
        .select("id", { count: "exact", head: true })
        .eq("server_id", req.params.id);
      const usados = count || 0;
      const nuevos = datos.max_instances ? Number(datos.max_instances) : antes.max_instances;
      if (nuevos < usados) {
        errores.max_instances =
          "Hay " + usados + " bot(s) en esta caja y el nuevo tope es " + nuevos + ". Muévelos antes de bajarlo.";
      }
    }

    if (!errores.url && datos.url !== antes.url) {
      const { data: mismaUrl } = await db
        .from("evolution_servers")
        .select("id,name")
        .eq("url", datos.url)
        .neq("id", req.params.id)
        .maybeSingle();
      if (mismaUrl) errores.url = `Esa dirección ya es la caja "${mismaUrl.name}".`;
    }

    const actualizar = {
      name: datos.name,
      url: datos.url,
      plan: datos.plan || null,
      max_instances: datos.max_instances ? Number(datos.max_instances) : antes.max_instances,
      activo: String(req.body.activo) === "1",
      notas: datos.notas || null,
    };
    if (datos.api_key) actualizar.api_key = datos.api_key;

    /* El secreto del webhook, igual que la clave: vacío = se deja el
       que hay. Y no se puede BORRAR desde aquí a propósito: si alguien
       lo deja en blanco sin querer, la caja se queda sin secreto y todos
       sus bots se quedan mudos de golpe. Para quitarlo hay que vaciarlo
       a mano en la base, que es más difícil de hacer por error.

       Ojo con esto: `webhook_secret` sí viene en el SELECT de `antes`,
       pero NUNCA se pasa a la vista (ver el GET de más abajo): la vista
       solo necesita saber si hay, no cuál es. */
    const secretoNuevo = String(datos.webhook_secret || "").trim();
    if (secretoNuevo) actualizar.webhook_secret = secretoNuevo;

    /* Si cambia la url o la clave hay que volver a probar: una caja
       editada con una url mal escrita rompe a todos los bots que viven
       en ella, y sin prueba el error sale cuando un cliente escribe. */
    const cambioConexion = actualizar.url !== antes.url || Boolean(actualizar.api_key);
    let prueba = null;
    if (cambioConexion && !Object.keys(errores).length) {
      const { data: claveActual } = await db
        .from("evolution_servers")
        .select("api_key")
        .eq("id", req.params.id)
        .maybeSingle();

      prueba = await evolution.probar(actualizar.url, actualizar.api_key || (claveActual && claveActual.api_key));
      const forzar = String(req.body.forzar || "") === "1";
      if (!prueba.ok && !forzar) {
        errores.url = prueba.mensaje + " (puedes marcar la casilla para guardar igualmente)";
      }
    }

    if (Object.keys(errores).length) {
      return res.status(400).render("panel/servidor-form", {
        title: "Editar servidor de bots",
        site: sitio,
        base: BASE,
        current: "servidores",
        modo: "editar",
        servidor: Object.assign({}, antes, datos, {
          api_key: "",
          webhook_secret: "",
          tieneSecreto: Boolean(actualizar.webhook_secret || antes.webhook_secret),
          activo: actualizar.activo,
        }),
        errores,
        mensaje: null,
        aviso: actualizar.webhook_secret || antes.webhook_secret ? null : AVISO_SIN_SECRETO,
        estadoPrueba: prueba ? { ok: prueba.ok, mensaje: prueba.mensaje } : null,
      });
    }

    const { error: eUpd } = await db.from("evolution_servers").update(actualizar).eq("id", req.params.id);

    if (eUpd) {
      return res.status(400).render("panel/servidor-form", {
        title: "Editar servidor de bots",
        site: sitio,
        base: BASE,
        current: "servidores",
        modo: "editar",
        servidor: Object.assign({}, antes, datos, {
          api_key: "",
          webhook_secret: "",
          tieneSecreto: Boolean(antes.webhook_secret),
          activo: actualizar.activo,
        }),
        errores: { general: "No se pudo guardar: " + eUpd.message },
        mensaje: null,
        aviso: antes.webhook_secret ? null : AVISO_SIN_SECRETO,
        estadoPrueba: null,
      });
    }

    await auth.auditar(db, {
      actor: { id: req.sesion.user_id, email: null },
      accion: "editar-servidor",
      entidad: "evolution_servers",
      entidadId: req.params.id,
      /* Otra vez sin la clave. `cambio_url` sí, porque es lo que se
         necesita saber si algo empezó a fallar después de guardar. */
      detalle: {
        antes: { name: antes.name, url: antes.url, max_instances: antes.max_instances },
        ahora: { name: actualizar.name, url: actualizar.url, max_instances: actualizar.max_instances },
        cambio_url: actualizar.url !== antes.url,
        cambio_clave: Boolean(actualizar.api_key),
        /* El secreto también es un secreto: se anota QUE ha cambiado, no
           con qué. Y que se haya puesto por primera vez se registra
           porque es el momento en que la caja pasa a poder hablar con el
           bot. */
        cambio_secreto: Boolean(actualizar.webhook_secret),
      },
      req,
    });

    res.redirect(BASE + "/servidores?aviso=servidor:guardado");
  });

  /* ---------- Probar ----------
     Pregunta a la caja y dice qué ha pasado, sin cambiar nada. Es la
     operación que más se usa: "no me funciona", y la primera pregunta
     es si la caja responde siquiera. */
  router.post("/servidores/:id/probar", requiereStaff, async (req, res) => {
    const { data: caja } = await db
      .from("evolution_servers")
      .select("id,name,url,api_key,webhook_secret")
      .eq("id", req.params.id)
      .maybeSingle();

    if (!caja) return res.redirect(BASE + "/servidores?error=servidor:no-existe");

    const r = await evolution.probar(caja.url, caja.api_key);

    if (!r.ok) {
      const clave = r.status === 401 || r.status === 403 ? "error=servidor:clave" : "error=servidor:no-contesta";
      return res.redirect(
        BASE + "/servidores?" + clave + "&detalle=" + encodeURIComponent(r.mensaje) + "#" + caja.id
      );
    }

    /* Que responda no es lo mismo que esté bien. Una caja puede contestar
       todo y tener el webhook de un bot sin guardar, que es el bot mudo:
       el alta dice que bien, la caja devuelve 200, y el único síntoma es
       que no llegan mensajes. Esto ya pasó de verdad: `Boti 1` estaba con
       "(SIN URL)" y ningún evento, y se tardó semanas en verlo.

       Por eso "Probar" no solo pregunta si la caja vive: pregunta a la
       caja QUÉ tiene configurado de verdad para cada número, y lo compara
       con lo que debería.

       Y comprueba el secreto, que es el otro fallo mudo. */
    const avisos = [];

    if (!caja.webhook_secret) {
      avisos.push(
        "La caja no tiene secreto del webhook: los bots que se den de alta aquí no recibirán mensajes."
      );
    }

    const urlEsperada = botsLib.urlDeWebhook();
    if (!urlEsperada) {
      avisos.push(
        "No hay dominio del bot configurado (SITE_URL o BOT_URL), así que no se puede comprobar a dónde debería llamar la caja."
      );
    }

    const { data: bots } = await db
      .from("bots")
      .select("instance_name,name")
      .eq("server_id", caja.id);

    let webhooksFlojos = 0;
    let webhooksMalApuntados = 0;

    for (const b of bots || []) {
      const leido = await evolution.leerWebhook(caja.url, caja.api_key, b.instance_name);
      if (!leido.ok) continue;

      const cfg = leido.data || {};
      const eventos = Array.isArray(cfg.events) ? cfg.events.map((e) => String(e).toUpperCase()) : [];

      /* Lo primero, lo que deja el bot MUDO: sin webhook, sin eventos, o
         sin `byEvents` (que hace que Evolution ignore lo guardado por
         instancia y use su configuración global). */
      if (cfg.webhook !== true || cfg.byEvents !== true || !eventos.includes("MESSAGES_UPSERT")) {
        webhooksFlojos++;
        continue;
      }

      /* Y lo segundo, que sí habla pero a otro sitio. */
      if (urlEsperada && (cfg.url || "") !== urlEsperada) {
        webhooksMalApuntados++;
      }
    }

    if (webhooksFlojos) {
      avisos.push(
        webhooksFlojos +
          " bot(s) de esta caja no tienen el webhook preparado: el número puede estar enlazado y aun así no contestar."
      );
    }
    if (webhooksMalApuntados) {
      avisos.push(
        webhooksMalApuntados +
          " bot(s) tienen el webhook apuntando a otro sitio, y no a " +
          urlEsperada +
          "."
      );
    }

    const nota = avisos.length ? "&nota=" + encodeURIComponent(avisos.join(" ")) : "";
    res.redirect(
      BASE + "/servidores?aviso=servidor:probado&instancias=" + r.data.instancias + nota + "#" + caja.id
    );
  });

  /* ---------- Activar / desactivar ---------- */
  router.post("/servidores/:id/activo", requiereStaff, async (req, res) => {
    const nuevo = String(req.body.activo || "") === "1";

    /* Desactivar no es borrar. Los bots que ya viven en la caja siguen
       hablando con ella (por eso el botón dice "desactivar" y no
       "eliminar"), pero el reparto deja de elegirla. Es lo que se
       quiere cuando una caja se cae: que no le metan bots nuevos
       mientras se arregla, sin dejar de servir a los que ya están. */
    const { data: antes } = await db
      .from("evolution_servers")
      .select("id,name,activo")
      .eq("id", req.params.id)
      .maybeSingle();

    if (!antes) return res.redirect(BASE + "/servidores?error=servidor:no-existe");

    await db.from("evolution_servers").update({ activo: nuevo }).eq("id", req.params.id);

    await auth.auditar(db, {
      actor: { id: req.sesion.user_id, email: null },
      accion: nuevo ? "activar-servidor" : "desactivar-servidor",
      entidad: "evolution_servers",
      entidadId: req.params.id,
      detalle: { antes: antes.activo },
      req,
    });

    res.redirect(BASE + "/servidores?aviso=" + (nuevo ? "servidor:activado" : "servidor:desactivado"));
  });

  /* ---------- Cambiar la clave ----------
     Aparte del formulario de edición. Escribir la clave en el formulario
     de edición significa que se puede borrar por accidente (y guardarla
     vacía deja la caja sin acceso sin querer), o que alguien que edita
     el nombre de la caja tiene la clave delante. Aquí solo va la clave,
     y solo hace falta cuando se rota. */
  router.post("/servidores/:id/clave", requiereStaff, async (req, res) => {
    const nueva = String(req.body.api_key || "").trim();
    if (!nueva) return res.redirect(BASE + "/servidores?error=servidor:no-existe");

    const { data: caja } = await db
      .from("evolution_servers")
      .select("id,name,url")
      .eq("id", req.params.id)
      .maybeSingle();

    if (!caja) return res.redirect(BASE + "/servidores?error=servidor:no-existe");

    const prueba = await evolution.probar(caja.url, nueva);
    if (!prueba.ok) {
      return res.redirect(
        BASE + "/servidores?error=servidor:clave&detalle=" + encodeURIComponent(prueba.mensaje) + "#" + caja.id
      );
    }

    await db.from("evolution_servers").update({ api_key: nueva }).eq("id", req.params.id);

    await auth.auditar(db, {
      actor: { id: req.sesion.user_id, email: null },
      accion: "cambiar-clave-servidor",
      entidad: "evolution_servers",
      entidadId: caja.id,
      /* Ni la nueva ni la vieja. Se registra que se rotó, no con qué. */
      detalle: { name: caja.name },
      req,
    });

    res.redirect(BASE + "/servidores?aviso=servidor:guardado");
  });

  return router;
};

/** Los clientes partidos en dos: los que pueden tener un bot y los que
    ya lo tienen.

    Va en su propia función porque la usan el GET y el POST del alta, y
    duplicar la consulta en los dos sitios era una forma de que un día
    una cambiara y la otra no: el POST volvería a pintar el formulario
    de error ofreciendo un cliente que ya tenía bot.

    Los que YA tienen bot no salen en el desplegable pero se cuentan, y
    con nombre. Es lo que contesta a "quiero un segundo bot para este
    cliente": no un rechazo de la base, sino cuántos hay. */
async function clientesRepartidos(db) {
  const [{ data: clientes }, { data: bots }] = await Promise.all([
    db.from("clients").select("id,empresa,nombre,email").eq("archivado", false).order("empresa"),
    db.from("bots").select("id,client_id,name"),
  ]);

  const conBotId = new Set((bots || []).map((b) => b.client_id));
  const empresaDe = (id) => {
    const c = (clientes || []).find((x) => x.id === id);
    return c ? c.empresa || c.nombre : "(sin empresa)";
  };

  return {
    sinBot: (clientes || []).filter((c) => !conBotId.has(c.id)),
    conBot: (bots || []).map((b) => ({ nombre: b.name, empresa: empresaDe(b.client_id) })),
  };
}

/** Un bot con su caja, o null.
    Se usa en las acciones (revisar, cambiar de caja) y devuelve la
    fila de la CAJA CON LA CLAVE, porque hacen falta para hablar con
    Evolution. La clave se queda en el servidor: las rutas la pasan a
    lib/evolution.js y no la pintan nunca. */
async function botConCaja(db, id) {
  const { data, error } = await db
    .from("bots")
    .select("id,name,instance_name,status,server_id,client_id,evolution_servers(id,name,url,api_key)")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[bots] no se pudo leer el bot:", error.message);
    return null;
  }
  if (!data) return null;

  const caja = Array.isArray(data.evolution_servers) ? data.evolution_servers[0] : data.evolution_servers;
  if (!caja) return null;

  return {
    id: data.id,
    nombre: data.name,
    nombreInstancia: data.instance_name,
    status: data.status,
    cajaFila: caja,
  };
}