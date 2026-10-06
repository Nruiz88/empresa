/* =========================================================
   Nexo Studio — Portal del cliente
   ------------------------------------------------------------
   Lo único que ve un cliente: sus propios servicios.

   ⚠️  AQUÍ NO SE USA LA SECRET KEY ⚠️
   Para leer datos como este cliente se usa getClientForToken(),
   que reconstruye su sesión de Supabase. Por eso manda RLS: si
   alguien cambia esta llamada por getAdmin(), el cliente pasa a
   ver TODOS los clientes. Es el fallo más grave posible en este
   archivo, por eso va en mayúsculas.

   Comprobado con: npm run test:aislamiento

   TODO(pago): este portal es de SOLO LECTURA y no cobra. El cliente
   ve lo que debe y no tiene forma de pagarlo. Montarlo implica elegir
   pasarela (Stripe, Redsys, Bizum...), y el webhook es la parte
   delicada: tiene que escribir el cobro pasando por el cliente admin,
   porque llega sin sesión de cliente y RLS lo rechazaría.
   Ver PENDIENTES.md.
   ========================================================= */

const express = require("express");
const supabase = require("../lib/supabase");
const auth = require("../lib/auth");
const tickets = require("../lib/tickets");
const L = require("../lib/labels");
const acceso = require("../lib/acceso");
const iconos = require("../lib/iconos");

/* `clientIdDe` vive en lib/client-id.js: lo usan este archivo y
   panel-perfil.js, y una copia en cada uno es una copia que algún día
   se queda vieja. Ver el comentario de allí sobre por qué va con la
   secret key. */
const clientIdDe = require("../lib/client-id");
const siteCfg = require("../lib/site");

/**
 * Dónde vive cada microservicio.
 *
 * Se deduce del dominio que haya en SITE_URL, no de un texto escrito
 * en la base de datos. El módulo `bot_whatsapp` tenía guardado
 * "https://bot.midominio.com" en `modules.url`: un dominio inventado
 * guardado como si fuera real, que se habría quedado ahí cuando el
 * dominio verdadero fuera otro, y el botón "Abrir" llevaría a un
 * sitio inexistente sin decir nada.
 *
 * `modules.url` sigue mandando si tiene ALGO REAL escrito. El caso
 * que justifica esto es un servicio que no vive en un subdominio del
 * dominio principal (un proveedor externo, un dominio aparte).
 *
 * @param {string} moduleId
 * @param {string|null} urlGuardada  Lo que hay en `modules.url`
 * @returns {string|null}  null si no se sabe a dónde ir
 */
function urlDeServicio(moduleId, urlGuardada) {
  const guardada = String(urlGuardada || "").trim();

  /* Solo se acepta una URL que no sea el marcador de ejemplo. Con
     "midominio.com" guardado, manda lo deducido. */
  if (guardada && !guardada.includes("midominio")) {
    return guardada.replace(/\/+$/, "");
  }

  /* Cada servicio tiene su subdominio y su puerto. El mapa se podría
     hacer una tabla, pero con uno solo, un objeto literal que se lee
     entero de un vistazo vale más que una indirección. */
  const SERVICIOS = {
    bot_whatsapp: { sub: "bot", puerto: 3200, env: process.env.BOT_URL },
  };

  const s = SERVICIOS[moduleId];
  if (!s) return guardada ? guardada.replace(/\/+$/, "") : null;

  return siteCfg.urlDeServicio(s.sub, s.env, s.puerto);
}

/** ¿Tiene este cliente contratado este módulo? Regla única: la de la
    función tiene_modulo() de la migración 007. */
async function tieneModulo(clientId, moduleId) {
  if (!clientId) return false;
  const { data, error } = await supabase
    .getAdmin()
    .rpc("tiene_modulo", { cliente_uuid: clientId, modulo: moduleId });
  if (error) {
    console.error("[servicios] tiene_modulo:", error.message);
    return false;
  }
  return data === true;
}

/* Los mensajes de los fallos del cambio de contraseña.
   Viven aquí y no en la vista porque llevan un `?error=` en la URL:
   si el texto estuviera en el HTML habría dos sitios donde cambiarlo,
   y tarde o temprano uno se queda viejo. */
const ERRORES = {
  actual: "La contraseña actual no es correcta.",
  larga: "La nueva tiene que tener 10 caracteres o más.",
  distinta: "Las dos contraseñas nuevas no coinciden.",
  igual: "La nueva no puede ser la misma que la actual.",
  noaplicada: "No se pudo cambiar. Inténtalo dentro de un momento.",
};

/* Los ?error= de /servicios/:id/entrar. */
const ERRORES_SERVICIO = {
  modulo: "Ese servicio no existe.",
  "sin-modulo": "Ese servicio no está activo en tu cuenta.",
  "sin-url": "Ese servicio aún no tiene dirección de acceso.",
  ticket: "No se pudo preparar el acceso. Inténtalo otra vez.",
  "sesion-caducada": "Tu sesión es muy antigua. Vuelve a entrar.",
  /* Los de soporte, en /soporte/:moduleId. */
  cliente: "Ese cliente ya no está en la base. Elige otro de la lista.",
  staff: "Esta pantalla es solo para el equipo.",
};

/* Los textos salen de lib/labels.js, la misma fuente que usan el
   listado y la ficha. Antes cada vista guardaba su copia y el
   cliente veía un "Mantenimiento" en su portal y otro distinto en
   la ficha. */

/* Cómo se lee una cuota para el cliente. Es al revés que en el panel:
   allí es un dato ("Mensual"), aquí una frase ("al mes"), porque un
   cliente no lee Periodicidad = Mensual igual de rápido. */
const PERIODO = {
  mensual: "al mes",
  trimestral: "cada 3 meses",
  anual: "al año",
  unica: "pago único",
};

/* Cómo se leen a un cliente las piezas de un producto.

   Vienen como claves técnicas porque son identificadores de la base
   de datos: 'turnos', 'movimientos', 'respuestas'. Puestas en crudo
   delante de alguien que quiere comprar, hacen que el producto
   parezca una cosa de programadores.

   OJO con esto: NO es un sitio para inventar características. Si una
   clave no está aquí, se capitaliza y se enseña tal cual. Es mejor
   escribir «Proveedores» (correcto aunque suena seco) que
   «Gestión avanzada de proveedores» (suena mejor y no está
   comprobado). En una venta, un detalle inflado en la lista es razón
   para que el cliente pregunte, y si la respuesta es «más o menos»,
   ya se perdió la confianza antes de pagar.

   Para añadir una: la clave exacta de modules.componentes. */
const LIBRES = {
  bot: "Respuestas automáticas",
  turnos: "Reserva de citas",
  productos: "Catálogo de productos",
  movimientos: "Entradas y salidas de stock",
  proveedores: "Proveedores",
  avisos: "Avisos de stock bajo",
  facturacion: "Facturación",
};

/** 'movimientos' → 'Movimientos'. Para lo que no esté en LIBRES. */
function capitalizar(texto) {
  const s = String(texto || "").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

const dinero = (n, moneda) => {
  if (n === null || n === undefined) return null;
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: moneda || "EUR" }).format(n);
};

const fecha = (iso) => {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
};

/* Cuántos días le quedan a una suscripción. Para poner "quedan 12 días"
   en vez de una fecha suelta: es lo que el cliente entiende de un
   vistazo. Con Infinity cuando no caduca (se renueva solo). */
function diasRestantes(terminaEn) {
  if (!terminaEn) return Infinity;
  const ms = new Date(terminaEn).getTime() - Date.now();
  return Math.ceil(ms / 86400000);
}

module.exports = function rutasPortal({ db, sitio, requiereLogin }) {
  const router = express.Router();

  /* ---------- Catálogo: qué se puede contratar ----------
     Ruta aparte, no una sección más del portal.

     POR QUÉ SEPARADA
     ---------------
     "Lo que tengo" y "lo que quiero" son dos intenciones distintas y
     no deben competir en la misma pantalla: si el catálogo está en la
     página de siempre, el cliente tiene que saltar por encima de sus
     facturas para ver los precios. Y si está en todas partes, nadie
     lo encuentra.

     Solo se enseñan los módulos `disponible = true`: uno en desarrollo
     no puede estar en la vitrina. Y se marca cuáles tiene ya, para que
     no le ofrezcamos dos veces lo mismo.

     Los proyectos (trabajo a medida) NO están aquí: eso se pide por
     correo, no se cataloga. Meter un "quiero una web" en una lista de
     precios sería prometer algo que hay que presupuestar antes. */
  router.get("/servicios-disponibles", requiereLogin, async (req, res) => {
    const { data: catalogo, error } = await supabase
      .getAdmin()
      .from("modules")
      .select("id,nombre,descripcion,precio,periodicidad,componentes")
      .eq("disponible", true)
      .order("nombre");

    /* Qué tiene ya, para no ofrecerle lo que ya compró. */
    const clientId = await clientIdDe(req.sesion.user_id);
    const { data: suyos } = clientId
      ? await supabase
          .getAdmin()
          .from("suscripciones")
          .select("module_id,estado,termina_en")
          .eq("client_id", clientId)
          .in("estado", ["activo", "prueba"])
      : { data: [] };

    const yaTiene = new Map((suyos || []).map((s) => [s.module_id, s]));

    res.render("panel/catalogo", {
      title: "Contratar",
      site: sitio,
      base: "/panel",
      current: "catalogo",
      catalogo: (catalogo || []).map((m) => ({
        ...m,
        yaTiene: yaTiene.get(m.id) || null,
        dias: diasRestantes(
          yaTiene.get(m.id) ? yaTiene.get(m.id).termina_en : null
        ),
        icono: iconos.icono(iconos.iconoDeModulo(m.id), { tamano: 20 }),
      })),
      yaTiene,
      error: error ? "No se pudo cargar el catálogo. Inténtalo en un momento." : null,
      periodo: PERIODO,
      dinero,
      fecha,
      LIBRES,
      capitalizar,
      icono: iconos.icono,
    });
  });

  router.get("/mis-servicios", requiereLogin, async (req, res) => {
    /* Los MÓDULOS se piden ANTES de nada, y con la secret key.
       Antes iban después de un `return` de 503, así que un token
       caducado vaciaba la pantalla entera y el cliente veía "no
       tienes nada" cuando lo que tenía era un problema de sesión.

       Y no es acceso a sus datos: leer "qué productos tiene
       contratados" es una comprobación de negocio sobre un id. Los
       DATOS (servicios, cobros) sí van por getClientForToken y RLS. */
    const clientId = await clientIdDe(req.sesion.user_id);

    let modulos = [];

    /* Un member del equipo no pertenece a ningún cliente, así que
       `modulos_del_cliente` no le devuelve nada y su portal saldría
       vacío. Para él la lista es la de MÓDULOS QUE EXISTEN: tiene que
       ver "el bot" para poder entrar en el de un cliente, no solo para
       consultarlo.

       No es que staff tenga el bot contratado: es que su tarjeta es un
       acceso a la herramienta de soporte, y el destino real se elige
       después. Por eso el botón dice "Atender a un cliente" y no
       "Abrir". */
    if (req.sesion.rol === "staff") {
      const { data: todos } = await supabase
        .getAdmin()
        .from("modules")
        .select("id,componentes")
        .eq("disponible", true);

      /* El nombre sale de `modules`, que la consulta de arriba no trajo. Sin
       él la tarjeta se queda sin título, que es justo el dato que
       identifica qué herramienta se está abriendo. */
      const { data: nombres } = await supabase
        .getAdmin()
        .from("modules")
        .select("id,nombre,descripcion,icono");

      const porId = new Map((nombres || []).map((m) => [m.id, m]));

      modulos = (todos || []).map((m) => {
        const ficha = porId.get(m.id) || {};
        return {
          module_id: m.id,
          nombre: ficha.nombre || m.id,
          descripcion: ficha.descripcion || "",
          estado: "activo",
          termina_en: null,
          componentes: m.componentes || [],
          dias: null,
          icono: iconos.icono(iconos.iconoDeModulo(m.id), { tamano: 22 }),
        };
      });
    } else if (clientId) {
      const { data: mods } = await supabase
        .getAdmin()
        .rpc("modulos_del_cliente", { cliente_uuid: clientId });

      if (mods && mods.length) {
        const { data: extras } = await supabase
          .getAdmin()
          .from("modules")
          .select("id,componentes")
          .in("id", mods.map((m) => m.module_id));

        const porId = new Map((extras || []).map((m) => [m.id, m]));

        modulos = mods.map((m) => ({
          ...m,
          componentes: (porId.get(m.module_id) || {}).componentes || [],
          dias: diasRestantes(m.termina_en),
          /* El SVG ya resuelto, para que la vista no tenga que saber
             qué icono va con qué módulo. Si el nombre del icono se
             calcula en la vista, hay que duplicar la tabla en dos
             sitios y un día se desincronizan. */
          icono: iconos.icono(iconos.iconoDeModulo(m.module_id), { tamano: 22 }),
        }));
      }
    }

    const datos = {
      title: "Mis servicios",
      site: sitio,
      base: "/panel",
      current: "servicios",
      servicios: [],
      /* OJO: en_curso NO viene en cuenta. `cuenta` (lib/acceso.js)
         cuenta los NIVELES de acceso —bloqueado, oferta, activo,
         inactivo— y "en curso" es un ESTADO del servicio, no un
         nivel: un servicio en_curso cae dentro de 'activo'. Por eso
         aquí sale 0 siempre, y se cuenta aparte abajo. */
      cuenta: { bloqueado: 0, oferta: 0, activo: 0, inactivo: 0, en_curso: 0 },
      pendiente: 0,
      error: null,
      etiquetaEstado: L.etiquetaEstado,
      etiquetaTipo: L.etiquetaTipo,
      icono: iconos.icono,
      periodo: PERIODO,
      dinero,
      fecha,
      modulos,
      errorServicio: ERRORES_SERVICIO[req.query.error] || null,
    };

    /* Sin token no se puede consultar con identidad: mejor decirlo
       claro que mostrar una lista vacía sin explicación.

       OJO: los módulos de arriba ya vienen cargados, porque no
       necesitan el token. Si se perdieran también, un token caducado
       haría que el cliente viera "no tienes nada" teniendo el bot
       pagado, y esa es la peor forma de perder a un cliente. */
    if (!req.sesion.access_token) {
      return res.status(503).render("panel/mis-servicios", {
        ...datos,
        error:
          "Tu sesión no se pudo reconstruir. Vuelve a entrar y lo verás.",
        empresa: "",
        /* Estas dos faltaban y la plantilla las usa sin comprobar nada.
         *
         * El síntoma es un 500 con un nombre de variable en el cuerpo,
         * que dice lo que pasó y no lo que hay que hacer:
         *
         *   esStaff is not defined      (views/panel/mis-servicios.ejs:179)
         *   nombreCliente is not defined (views/panel/mis-servicios.ejs:40)
         *
         * Y lo que debería ver el cliente, que está justo al lado del
         * mensaje, es "vuelve a entrar". Un token caducado lo deja
         * encerrado en la puerta con un error de servidor.
         *
         * El render de más abajo, el que sí lleva token, sí las pasa.
         * Este camino es el menos transitado, y por eso se quedó sin
         * ellas dos. */
        esStaff: (req.sesion && req.sesion.rol) === "staff",
        nombreCliente: (req.sesion && req.sesion.nombre) || "",
      });
    }

    /* Cliente que actúa COMO el usuario: RLS decide qué ve */
    const comoUsuario = supabase.getClientForToken(req.sesion.access_token);

    const { data: servicios, error } = await comoUsuario
      .from("services")
      .select("*")
      .order("creado_en", { ascending: false });

    /* Los cobros también salen filtrados por RLS (migración 005): el
       cliente solo ve los de sus propios servicios. Sin ellos no se
       puede saber si algo está vencido, y entonces todo se enseñaría
       como si estuviera al día. */
    let cobros = [];
    if ((servicios || []).length) {
      const { data: susCobros } = await comoUsuario
        .from("cobros")
        .select("service_id,estado,importe,descuento,vence_en,periodo")
        .in("service_id", servicios.map((s) => s.id));
      cobros = susCobros || [];
    }

    /* Aquí se decide qué se le enseña a cada servicio: entero, con
       aviso de factura, bloqueado si está vencido, o como oferta.
       Las reglas están en lib/acceso.js, con sus pruebas. */
    const vista = acceso.agrupar(servicios || [], cobros);

    /* La ficha de la empresa sale filtrada por RLS igual */
    const { data: ficha } = await comoUsuario
      .from("clients")
      .select("empresa,nombre")
      .limit(1)
      .maybeSingle();

    /* Salen de la misma consulta filtrada por RLS: un cliente solo
       ve su propia ficha, así que si no viene es que no tiene. */
    const empresa = (ficha && (ficha.empresa || ficha.nombre)) || "";

    res.render("panel/mis-servicios", {
      ...datos,
      empresa,
      /* El nombre de la persona, para saludar por su nombre en vez de
         por el de la empresa. Viene en res.locals como `nombre`, pero
         aquí se pasa con nombre propio porque la cabecera lo usa. */
      nombreCliente: (req.sesion && req.sesion.nombre) || "",
      servicios: vista.lista,
      cuenta: vista.cuenta,
      pendiente: vista.pendiente,
      modulos,
      /* Si quien está aquí es del equipo, su tarjeta "Abrir" lleva a la
         pantalla de soporte y no a un canje directo. Sin esto, un member
         del equipo pulsaría Abrir, el servicio le pediría elegir cliente
         y el motivo mediante una redirección, y parecería un fallo.

         La vista decide qué botón pintar; la ruta de "Abrir" acepta
         igual las dos formas. */
      esStaff: req.sesion.rol === "staff",
      error: error ? "No se pudieron cargar tus servicios ahora mismo." : null,
    });
  });

  /* ---------- Entrar a un servicio externo ----------
     El puente entre el panel y el subdominio del servicio
     (bot.<tu-dominio>).

     QUÉ PASA AQUÍ
     ------------
     1. Se renueva el access_token si va a caducar. Sin esto, el
        ticket llevaría un token a punto de expirar, llegaría vivo al
        servicio y allí no se podría reconstruir la sesión: el
        usuario entra, pulsa el botón y lo rechaza sin explicación.

     2. Se firma un ticket de 60 s con los datos de QUIÉN es y su
        access_token.

     3. Se redirige con el ticket en el FRAGMENTO (#), no en la query.

     POR QUÉ EL FRAGMENTO
     --------------------
     El navegador no manda el # al servidor. Con ?ticket=..., el
     access_token que lleva dentro quedaría escrito en los logs del
     servicio, en los del proxy y en el historial del navegador.
     Con #..., el servidor solo ve un "GET /entrar" limpio, y la
     página que se pinta en el servicio es la que lo lee y lo canjea
     desde el navegador.

     El secret sale de SERVICE_SECRET, y tiene que ser el mismo que
     en el servicio y distinto de SESSION_SECRET. */
  router.get("/servicios/:moduleId/entrar", requiereLogin, async (req, res) => {
    const { moduleId } = req.params;

    /* El módulo tiene que existir y estar a la venta. Comprobarlo
       aquí evita mandar a alguien a un subdominio que no existe. */
    const { data: modulo } = await supabase
      .getAdmin()
      .from("modules")
      .select("id,nombre,url,disponible")
      .eq("id", moduleId)
      .maybeSingle();

    if (!modulo) {
      return res.redirect("/panel/mis-servicios?error=modulo");
    }

    /* Staff puede verlo todo, así que se le deja entrar sin
     suscripción: es para soporte. Un cliente sí necesita contrato. */
    const esStaff = req.sesion.rol === "staff";

    if (!esStaff) {
      const clientId = await clientIdDe(req.sesion.user_id);
      const tiene = await tieneModulo(clientId, moduleId);
      if (!tiene) {
        /* No se entra. No se redirige tampoco: que vea el aviso en
           el portal, donde puede entender por qué. */
        return res.redirect("/panel/mis-servicios?error=sin-modulo");
      }
    }

    /* A dónde se va. O lo que tenga el módulo escrito, o el subdominio
       deducido del dominio real. Ver urlDeServicio() arriba: la idea
       es que en la base no haya ningún dominio inventado. */
    const destinoServicio = urlDeServicio(moduleId, modulo.url);
    if (!destinoServicio) {
      return res.redirect("/panel/mis-servicios?error=sin-url");
    }

    /* Token vigente antes de firmar. Ver lib/auth.js:tokenVigente. */
    const token = await auth.tokenVigente(supabase.getAdmin(), req.sesion);
    if (!token) {
      /* No hay token con el que reconstruir la sesión en el servicio.
         Pasa si la sesión es muy vieja. Se manda a entrar otra vez. */
      return res.redirect("/panel/login?error=sesion-caducada");
    }

    /* ---------- Staff: a cuál cliente atiende y por qué ----------

       Antes staff entraba con `cid = null` y el bot lo rechazaba con un
       403 ("este enlace no es de una cuenta de cliente"), que era una
       respuesta rara: al panel el staff ya lo dejaba pasar.

       Ahora staff tiene que decir a qué cliente entra y por qué. Las dos
       cosas van en el ticket, y la segunda no es opcional: el motivo es
       lo que queda guardado y lo que se lee cuando hay que preguntar por
       qué soporte tocó la configuración de alguien.

       El cliente también elige, pero no tiene que justificar nada: es su
       bot. */
    let clientId = null;
    let motivo = null;

    if (esStaff) {
      const elegido = String(req.query.cliente || "").trim();
      const porQue = String(req.query.motivo || "").trim();

      if (!elegido || !porQue) {
        /* Sin los dos no se entra. Se vuelve al selector con el motivo
           puesto, para que escribirlo no se tenga que hacer dos veces. */
        return res.redirect(
          "/panel/soporte/" +
            moduleId +
            "?motivo=" +
            encodeURIComponent(porQue)
        );
      }

      /* El cliente tiene que existir. No se fía del `?cliente=` sin
         mirar: es un identificador que viene de la barra de direcciones,
         y es exactamente el dato que un cambio de una letra pasa. */
      const existe = await supabase
        .getAdmin()
        .from("clients")
        .select("id")
        .eq("id", elegido)
        .maybeSingle();

      if (!existe) {
        return res.redirect("/panel/soporte/" + moduleId + "?error=cliente");
      }

      clientId = elegido;
      motivo = porQue.slice(0, 200);
    } else {
      clientId = await clientIdDe(req.sesion.user_id);
    }

    let ticket;
    try {
      ticket = tickets.firmar({
        sesion: req.sesion,
        userId: req.sesion.user_id,
        clientId,
        rol: req.sesion.rol,
        accessToken: token,
        motivo,
      });
    } catch (err) {
      console.error("[servicios] No se pudo firmar el ticket:", err.message);
      return res.redirect("/panel/mis-servicios?error=ticket");
    }

    /* El # va aquí, y no en el query. Es lo único que cambia entre
       un patrón y otro, y es el detalle que más caro sale si se
       equivoca. */
    res.redirect(destinoServicio + "/entrar#ticket=" + ticket);
  });

  /* ---------- Soporte: elegir cliente ----------
     La pantalla intermedia. No existe una ruta aparte para ella: es la
     misma de "abrir el servicio", pero parada antes de firmar el ticket
     cuando quien la abre es del equipo.

     El motivo es un campo de texto y no una lista de casillas. Las
     casillas se consultarían rápido y quedarían sin sentido al
     cabo de un mes; escribir una frase es más lento y es la que sirve
     para saber qué pasó. */
  router.get("/soporte/:moduleId", requiereLogin, async (req, res) => {
    /* Un cliente no ve ni la pantalla ni el mensaje de "esto es solo
       para el equipo": se le manda a su portal, que es donde tiene
       sentido que esté. Enseñar el error solo le daría la idea de que
       la pantalla existe. */
    if (req.sesion.rol !== "staff") {
      return res.redirect("/panel/mis-servicios");
    }

    const { moduleId } = req.params;
    const { data: modulo } = await supabase
      .getAdmin()
      .from("modules")
      .select("id,nombre")
      .eq("id", moduleId)
      .maybeSingle();

    if (!modulo) return res.redirect("/panel/mis-servicios?error=modulo");

    /* Solo los clientes que TIENEN bot. La lista sale del propio cruce de
       `bots` con `clients` que hace la consulta, en vez de leer todos
       los clientes y luego ir descartando: con 400 clientes, la otra
       forma trae 400 filas para enseñar 12. */
    const { data: conBot } = await supabase
      .getAdmin()
      .from("bots")
      .select("client_id, clients(id,nombre,email)");

    const vistos = new Map();
    for (const b of conBot || []) {
      if (b.clients && b.clients.id) vistos.set(b.clients.id, b.clients);
    }

    const lista = [...vistos.values()].sort((a, b) =>
      String(a.nombre || "").localeCompare(String(b.nombre || ""))
    );

    res.render("panel/soporte", {
      title: "Atender a un cliente",
      site: sitio,
      base: "/panel",
      current: "soporte",
      modulo,
      clientes: lista,
      motivo: String(req.query.motivo || "").trim(),
      /* Los errores de esta pantalla son los del servicio, no los de la
         cuenta: "ese cliente ya no está" es del mismo grupo que "ese
         servicio no existe". */
      error: ERRORES_SERVICIO[req.query.error] || null,
    });
  });

  /* ---------- Mi cuenta ----------
     El cliente necesita poder cambiar SU contraseña. Al crear el
     acceso se le da una temporal y, sin esto, se la queda para
     siempre: eso empuja a la gente a reutilizar la misma clave en
     otros sitios, que es de las pocas cosas que un portal sí puede
     evitar. */
  router.get("/mi-cuenta", requiereLogin, async (req, res) => {
    /* El email no está en `profiles`: vive en Auth. */
    const { data: usuario } = await supabase
      .getAdmin()
      .auth.admin.getUserById(req.sesion.user_id);

    res.render("panel/mi-cuenta", {
      title: "Mi cuenta",
      site: sitio,
      base: "/panel",
      current: "cuenta",
      email: (usuario && usuario.user && usuario.user.email) || "",
      error: ERRORES[req.query.error] || null,
      aviso: req.query.hecho === "1" ? "Contraseña cambiada." : null,
    });
  });

  /* ---------- Cambiar la contraseña ----------

     Las cuatro reglas, y por qué:

     1. Pide la contraseña ACTUAL. Sin ella, quien encuentre el
        navegador abierto cambia la clave y se queda la cuenta.

     2. La actual se verifica contra Supabase, no contra nuestra base
        de datos. Aquí no hay hashes: solo existe en Auth. La única
        forma de comprobarla es intentar entrar.

     3. Mínimo 10 caracteres y tiene que ser distinta de la actual.
        Poner la misma no arregla nada.

     4. Cierra las demás sesiones. Si el cambio viene de "creo que me
        la han visto", dejar las sesiones abiertas seguiría dejando
        dentro a quien las abrió, aunque la clave ya fuera otra. */
  router.post("/mi-cuenta/password", requiereLogin, async (req, res) => {
    const volver = "/panel/mi-cuenta";
    const actual = String((req.body && req.body.actual) || "");
    const nueva = String((req.body && req.body.nueva) || "");
    const repetida = String((req.body && req.body.repetida) || "");

    /* 1 y 2: verificar la actual.
       Se hace con un cliente público nuevo, sin sesión guardada: si
       se usara el de la sesión, un fallo no distinguiría "contraseña
       equivocada" de "todo roto". */
    const { data: usuario } = await supabase
      .getAdmin()
      .auth.admin.getUserById(req.sesion.user_id);
    const email = (usuario && usuario.user && usuario.user.email) || "";

    const comprobador = supabase.getPublico();
    const { error: errActual } = await comprobador.auth.signInWithPassword({
      email,
      password: actual,
    });
    if (errActual) return res.redirect(volver + "?error=actual");

    /* 3: las reglas de la nueva. */
    if (nueva.length < 10) return res.redirect(volver + "?error=larga");
    if (nueva !== repetida) return res.redirect(volver + "?error=distinta");
    if (nueva === actual) return res.redirect(volver + "?error=igual");

    /* ---------- Aplicar ---------- */
    const { error } = await supabase
      .getAdmin()
      .auth.admin.updateUserById(req.sesion.user_id, { password: nueva });

    if (error) return res.redirect(volver + "?error=noaplicada");

    /* 4: fuera las demás sesiones, esta se queda.
       El access_token de Supabase sigue siendo válido, así que el
       portal sigue funcionando sin obligar a entrar otra vez. */
    const cerradas = await auth.revocarOtras(db, req.sesion.user_id, req.token);

    await auth.auditar(db, {
      actor: { id: req.sesion.user_id, email: null },
      accion: "cambiar-password-propio",
      entidad: "profiles",
      entidadId: req.sesion.user_id,
      /* NUNCA la contraseña, ni la vieja ni la nueva. */
      detalle: { sesiones_cerradas: cerradas },
      req,
    });

    res.redirect(volver + "?hecho=1");
  });

  return router;
};
