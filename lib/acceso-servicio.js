/* =========================================================
   Nexo Studio — Base para un microservicio con acceso del panel
   ------------------------------------------------------------
   Esto es lo que necesita CUALQUIER servicio en su subdominio
   (bot.midominio.com, inventario.midominio.com) para aceptar
   que entre alguien que ya está autenticado en el panel.

   EL FLUJO COMPLETO
   ------------------
     1. panel.midominio.com  →  /panel/servicios/:id/entrar
        Firma un ticket (lib/tickets.js) y redirige.

     2. bot.midominio.com/entrar#<ticket>
        Este módulo verifica la firma, comprueba que el cliente
        REALLY tiene el módulo, y monta una sesión propia.

     3. A partir de ahí el servicio trabaja con
        supabase.getClientForToken() y RLS decide en su base de
        datos, igual que ya hace el portal.

   LO QUE NO HACE, Y ES LO IMPORTANTE
   -----------------------------------
   No confía en lo que dice el ticket. El ticket dice QUIÉN es el
   usuario; para saber si tiene el módulo se consulta la tabla
   `suscripciones` de verdad, con la función tiene_modulo() de la
   migración 007. Un ticket manipulado no colaría por ahí, pero
   tampoco nos fiamos solo de la firma: si alguien le pasa a un
   cliente el ticket de otro, la suscripción no cuadra y se le
   rechaza.

   POR QUÉ NO COOKIE COMPARTIDA
   ----------------------------
   La cookie del panel es host-only a propósito. Si se compartiera
   con Domain=.midominio.com, un XSS en CUALQUIER subdominio se
   llevaría la sesión de todos, y el panel es donde están todos los
   clientes. Aquí cada servicio tiene la suya, con nombre propio
   (nexo_bot, nexo_inventario...), y solo la tiene su host.

   CÓMO SE USA
   -----------
     const { servicio } = require("./lib/acceso-servicio");

     const app = express();
     app.get("/entrar", servicio({ db, nombre: "bot", cookie: "nexo_bot", exige: "bot_whatsapp" }));
     app.get("/mi-conversacion", servicio.exigeSession({ db, cookie: "nexo_bot" }), (req, res) => {
       // req.sesion.access_token → pásalo a getClientForToken y deja
       // que RLS decida.
     });
   ========================================================= */

const express = require("express");
const auth = require("./auth");
const tickets = require("./tickets");
const supabase = require("./supabase");

/* Cuánto vive la sesión del propio servicio. Más corta que la del
   panel: el servicio es de uso concreto, no de administration. */
const HORAS_SERVICIO = 4;

const COOKIE_POR_DEFECTO = (nombre) => "nexo_" + nombre;

function secure() {
  return process.env.NODE_ENV === "production";
}

/**
 * Dónde está el PANEL, en URL completa.
 *
 * POR QUÉ NO UNA RUTA RELATIVA
 * ---------------------------
 * El servicio y el panel son hosts distintos (bot.tudominio.com y
 * panel.tudominio.com). Una ruta como "/panel/mis-servicios"
 * significa "/panel/mis-servicios EN EL HOST DEL SERVICIO", que no
 * existe: el bot tiene sus propias rutas y su propio 404.
 *
 * Con eso el acceso funcionaba (el ticket se verificaba bien y la
 * cookie se montaba) y a continuación el navegador caía en el 404 del
 * bot con un "esta página no existe" que no tiene nada que ver con los
 * permisos. Un fallo así cuesta horas de mirar el sistema de acceso
 * cuando el acceso va bien.
 *
 * Sale de lib/site.js, que ya sabe el dominio real y se dedujo de
 * SITE_URL. En desarrollo, con SITE_URL en 127.0.0.1, sale el panel en
 * el puerto del servidor web, que es donde está.
 */
function urlDelPanel() {
  const site = require("./site");
  const panel = site.panelUrl;
  /* Si el panel viene como marcador sin definir, se cae al sitio web:
     en desarrollo es el mismo proceso (server.js monta los dos). */
  if (!panel || panel.includes("midominio")) return site.url;
  return panel;
}

/**
 * Construye el manejador de /entrar y el middleware de sesión.
 *
 * @param {object} opts
 * @param {object} opts.db            cliente admin de Supabase
 * @param {string} opts.nombre        'bot', 'inventario'...
 * @param {string} [opts.cookie]      nombre de la cookie; por defecto nexo_<nombre>
 * @param {string} [opts.exige]       module_id que el cliente tiene que tener
 *                                     contratado. Sin esto, cualquiera que
 *                                     tenga un ticket válido entra.
 * @param {string} [opts.mostrar]     nombre bonito para la pantalla de error
 * @param {string} [opts.raiz]        Pantalla de inicio DEL SERVICIO, donde
 *                                     cae el usuario al entrar. Por defecto
 *                                     "/" (que aquí es un 404: cada servicio
 *                                     tiene que decir la suya).
 * @returns {{entrar: Function, sesion: Function, cookie: string}}
 */
function crear({ db, nombre, cookie, exige, mostrar, raiz }) {
  const nombreCookie = cookie || COOKIE_POR_DEFECTO(nombre);
  const nombreBonito = mostrar || nombre;

  /* Dónde cae el usuario después de canjear el ticket.
     ANTES devolvía la URL del panel, con la idea de que "el usuario
     entró en otro sitio y quiere seguir donde estaba". Estaba
     invertido: el usuario ha pulsado un botón que decía ABRIR, y lo
     que quiere es ver la aplicación. Con el comportamiento anterior,
     abrir el bot te devolvía al panel y nunca llegabas a verlo: el
     botón no abría nada.
     Por eso esto lo declara cada servicio y no se deduce aquí: el
     módulo es genérico y no puede saber qué rutas tiene cada uno. */
  const raizServicio = String(raiz || "/").replace(/^\/+/, "");

  /* ¿Tiene este cliente el módulo?
     Se consulta con la secret key porque aquí no hay sesión de
     Supabase todavía: el acceso_token viene DENTRO del ticket y
     todavía no se ha construido el cliente con él.

     Y aunque se pudiera usar RLS, no se hace: esta es una comprobación
     de NEGOCIO ("¿tiene el producto contracted?"), no de datos. La
     respuesta es sí o no sobre un cliente concreto, y la tabla
     suscripciones está protegida para que solo el staff la lea.
     Una comprobación de negocio va con la clave de servidor; los
     DATOS del cliente, esos sí, siempre por RLS. */
  async function tieneElModulo(clientId, moduleId) {
    if (!clientId || !moduleId) return false;
    const { data, error } = await db.rpc("tiene_modulo", {
      cliente_uuid: clientId,
      modulo: moduleId,
    });
    if (error) {
      console.error("[" + nombre + "] tiene_modulo falló:", error.message);
      return false;
    }
    return data === true;
  }

  /**
   * GET /entrar#<ticket>
   *
   * El ticket va en el FRAGMENTO (#), que el navegador no manda al
   * servidor. Por eso está aquí la página que lo lee y lo canjea
   * desde el navegador: si el ticket fuera un query param, el
   * access_token que lleva dentro acabaría en los logs de Railway,
   * en los del proxy y en el historial del navegador.
   */
  function entrar(req, res) {
    res.render("servicio/entrar", {
      titulo: nombreBonito,
      error: null,
      /* El JavaScript de la página lee el fragmento y lo canjea. */
      endpoint: "/entrar",
      /* Y el panel, en URL completa, para que el botón "volver a
         entrar" apunte allí y no a este host. */
      panelUrl: urlDelPanel(),
      cookie: nombreCookie,
      csrf: "",
      listo: false,
    });
  }

  /**
   * POST /entrar  (lo llama el JS de la página de arriba)
   *
   * Body: { ticket }
   */
  async function canjear(req, res) {
    const ticket = String((req.body && req.body.ticket) || "");

    const p = tickets.verificar(ticket);

    if (!p) {
      /* No se distingue entre "no existe", "caducado" y "manipulado":
         informar de cuál sería una guía para ir probando. */
      return res.status(401).json({
        ok: false,
        error:
          "Ese enlace no vale o ha caducado. Vuelve a entrar desde el panel.",
      });
    }

    /* La firma vale, pero ¿de verdad tiene el módulo?
       Esto se comprueba SIEMPRE, aunque el ticket sea auténtico: si
       a alguien le comparten el ticket de otro cliente, su
       suscripción no cuadra y se le rechaza aquí.

       EXCEPTO para staff, que no tiene `cid` (no pertenece a ningún
       cliente) y por lo tanto nunca tendría el módulo contratado.

       Esto no era una excepción, era un descuido: el panel SÍ deja
       pasar a staff a propósito (ver routes/panel-portal.js, donde
       la comprobación se hace solo si NO es staff, "es para soporte").
       El bot, en cambio, exigía el módulo a todo el mundo, así que a
       un member del equipo le montaba el ticket bien y se lo
       rechazaba acto seguido con un 403 que hablaba de contratar un
       producto que ya tenía acceso. Dos servicios con reglas
       distintas sobre el mismo acceso.

       El staff entra por un motivo: soporte. Ver el bot de un cliente
       para reproducir un problema. No es un hueco, es lo mismo que
       ya puede hacer en el panel. */
    if (exige && p.rol !== "staff") {
      const ok = await tieneElModulo(p.cid, exige);
      if (!ok) {
        return res.status(403).json({
          ok: false,
          error:
            "Tu cuenta no tiene " +
            nombreBonito +
            " contratado o está vencido.",
        });
      }
    }

    /* Cookie propia de este servicio, host-only. NUNCA la del panel. */
    const sesion = await auth.crearSesion(db, {
      userId: p.uid,
      rol: p.rol,
      req,
      accessToken: tickets.tokenDe(p),
      /* El refresh_token viaja en la sesión del panel, no aquí: este
         servicio no renueva. Cuando el token caduque, el usuario
         vuelve a pasar por el panel. Es lo simple y es suficiente
         para un servicio de uso corto. */
      refreshToken: null,
    });

    res.cookie(nombreCookie, sesion.token, {
      httpOnly: true,
      secure: secure(),
      sameSite: "lax",
      path: "/",
      maxAge: HORAS_SERVICIO * 3600 * 1000,
    });

    /* A dónde se va después de canjear.

       Es la PANTALLA DEL PROPIO SERVICIO, no el panel. El botón decía
       "Abrir" y lo que se abre es la aplicación; mandar al panel
       haría que el usuario nunca llegue a verla.

       Se manda relativa a propósito: este host ES el servicio, así
       que una ruta relativa no puede acabar en otro sitio. Con la
       URL del panel era justo lo contrario de lo que se quería. */
    res.json({
      ok: true,
      destino: "/" + raizServicio,
      /* El panel se sigue mandando, pero para lo que sí sirve: el
         enlace de "volver al panel" de las pantallas de error. */
      panel: urlDelPanel(),
      nombre: nombreBonito,
    });
  }

  /**
   * Middleware: exige sesión propia de este servicio.
   * Deja en req.sesion lo mismo que deja el middleware del panel.
   */
  async function sesion(req, res, next) {
    const token = req.cookies && req.cookies[nombreCookie];
    const s = await auth.leerSesion(db, token);

    if (!s) {
      /* Sin sesión no hay ticket, y sin ticket no hay entrada. Se
         manda al login del PANEL para que rehaga el viaje.

         URL completa por el mismo motivo que la vuelta: el login no
         está en este host. Con "/panel/login" el navegador se
         quedaba en el servicio y le mostraba su propio 404, que
         decía "esta página no existe" sin explicar que lo que
         faltaba era entrar. */
      const destino = encodeURIComponent(
        (req.headers.referer || "").split("?")[0]
      );
      return res.redirect(302, urlDelPanel() + "/panel/login?origen=" + destino);
    }

    /* El service vuelve a comprobar el módulo en cada petición, no
       solo al entrar. Si una suscripción se cancela con el
       navegador ya abierto, deja de funcionar en la siguiente
       llamada y no cuando le dé la gana. Es una consulta barata a
       una tabla de una fila, y evita el caso más feo del SaaS: el
       cliente sigue usando lo que ya pagó y ya no tiene.

       Staff se salta, por el mismo motivo que en canjear(): no
       pertenece a ningún cliente y no puede tener el módulo
       contratado. Sin esta excepción, un member del equipo entraba
       una vez y le salía el error en la siguiente llamada. */
    if (exige && s.rol !== "staff") {
      const { data: perfil } = await db
        .from("profiles")
        .select("client_id")
        .eq("id", s.user_id)
        .maybeSingle();
      const ok = await tieneElModulo(perfil && perfil.client_id, exige);
      if (!ok) {
        res.clearCookie(nombreCookie, { path: "/" });
        return res.status(403).render("servicio/sin-acceso", {
          titulo: nombreBonito,
          motivo:
            "Tu acceso a " +
            nombreBonito +
            " no está activo. Puede que la suscripción haya caducado.",
        });
      }
    }

    req.sesion = s;
    /* El cliente de Supabase YA PUESTO. Es lo que tienen que usar
       las rutas del servicio: pasa por RLS, nunca por getAdmin(). */
    req.db = supabase.getClientForToken(s.access_token);
    next();
  }

  return {
    entrar,
    canjear,
    sesion,
    cookie: nombreCookie,
    nombreCookie,
  };
}

module.exports = { crear, HORAS_SERVICIO };
