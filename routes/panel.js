/* =========================================================
   Nexo Studio — Panel de gestión (rutas)
   ------------------------------------------------------------
   Montado en /panel. Aquí vive TODO lo que requiere identidad:
   el panel del equipo y el portal de clientes.

   SEPARACIÓN DE PROPÓSITO
   ------------------------
   Este archivo NO importa nada de routes/web.js, y al revés.
   Eso permite desplegar el panel como proceso aparte más
   adelante (subdominio propio) sin tocar la lógica:

     panel.js  ->  solo este router   (servicio del panel)
     server.js ->  web + panel        (servicio web)

   REGLAS QUE NO SE DEBEN ROMPER
   ------------------------------
   1. Todo lo de aquí es noindex. Nunca debe salir en buscadores.
   2. Ninguna ruta POST sin comprobar CSRF.
   3. Las rutas del panel se montan ANTES que el 404 público.
   4. El rol se lee de `profiles`, nunca de los metadatos del JWT:
      si no, alguien podría auto-asignarse el rol admin.
   ========================================================= */

const express = require("express");

const env = require("../lib/env");
const supabase = require("../lib/supabase");
const auth = require("../lib/auth");
const vencimientos = require("../lib/vencimientos");
const L = require("../lib/labels");

const BASE = "/panel";
const COOKIE = "nexo_panel";

/** "hace 3 h", "hace 2 días" */
function relativo(iso) {
  if (!iso) return "";
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return "hace " + min + " min";
  const h = Math.floor(min / 60);
  if (h < 24) return "hace " + h + " h";
  const d = Math.floor(h / 24);
  if (d < 30) return "hace " + d + (d === 1 ? " día" : " días");
  return new Date(iso).toLocaleDateString("es-ES");
}

const dinero = (n, moneda) =>
  n === null || n === undefined
    ? null
    : new Intl.NumberFormat("es-ES", { style: "currency", currency: moneda || "EUR" }).format(n);

/** Cookie host-only a propósito: así no viaja a la web pública. */
const cookieOpts = (maxAgeMs) => ({
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: BASE,
  ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
});

/* ===============================================================
   Middlewares
   =============================================================== */

/** Adjunta req.sesion si hay cookie válida. Nunca bloquea.
    Rellenar req.sesion aquí evita una consulta a la base de datos
    por cada request que necesite saber quién es. */
function cargarSesion(db) {
  return async (req, res, next) => {
    try {
      req.token = (req.cookies && req.cookies[COOKIE]) || null;
      req.sesion = await auth.leerSesion(db, req.token);
      if (req.sesion) {
        // El rol vive en la sesión, pero lo revalidamos contra
        // profiles: si a alguien le bajan el rol o le desactivan
        // la cuenta, no debe seguir dentro por su cookie.
        const { data: perfil } = await db
          .from("profiles")
          .select("rol, activo, nombre")
          .eq("id", req.sesion.user_id)
          .maybeSingle();

        if (!perfil || !perfil.activo) {
          req.sesion = null;
        } else {
          req.sesion.rol = perfil.rol;
          req.sesion.nombre = perfil.nombre;
          req.perfil = perfil;
        }
      }
    } catch (err) {
      console.error("[panel] Error al leer la sesión:", err.message);
      req.sesion = null;
    }
    next();
  };
}

/** Exige sesión iniciada */
function requiereLogin(req, res, next) {
  if (!req.sesion) {
    return res.redirect(BASE + "/login?siguiente=" + encodeURIComponent(req.originalUrl));
  }
  next();
}

/** Exige rol del equipo */
function requiereStaff(req, res, next) {
  /* Sin sesión NO es un 403: es alguien que aún no ha entrado, y su
     sitio es el login. El 403 se reserva para quien sí entró pero no
     tiene permiso, que es otro caso muy distinto. */
  if (!req.sesion) {
    return res.redirect(BASE + "/login?siguiente=" + encodeURIComponent(req.originalUrl));
  }
  if (req.sesion.rol !== "staff") {
    return res.status(403).render("panel/403", {
      title: "Acceso restringido",
      site: require("../lib/site"),
      noindex: true,
      base: BASE,
    });
  }
  next();
}

/** Corta cualquier POST sin token CSRF válido.
    Sin esto, un sitio externo podría enviar formularios a tu panel.

    El login se queda FUERA aquí: todavía no hay sesión de la que
    sacar un token. Lo protege su propio double-submit, más abajo. */
function exigeCsrf(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD") return next();
  if (req.path === BASE + "/login") return next();

  const recibido = (req.body && req.body._csrf) || req.headers["x-csrf-token"];
  if (auth.comprobarCsrf(req.sesion, recibido)) return next();

  console.warn("[panel] CSRF rechazado en " + req.method + " " + req.path);
  return res.status(403).render("panel/403", {
    title: "Petición rechazada",
    site: require("../lib/site"),
    noindex: true,
    base: BASE,
  });
}

/* ===============================================================
   Router
   =============================================================== */
const router = express.Router();

{
  const carga = env.load();
  if (!carga.ok) {
    console.warn("[panel] Sin .env, el panel queda deshabilitado.");
  }

  const listo = supabase.disponible() && Boolean(process.env.SESSION_SECRET);
  const db = supabase.disponible() ? supabase.getAdmin() : null;
  const site = require("../lib/site");

  /* Cabeceras de seguridad del panel.
     frame-ancestors 'none' evita el clickjacking sobre acciones
     administrativas. */
  router.use(BASE, (req, res, next) => {
    res.locals.base = BASE;
    res.locals.noindex = true;
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
    next();
  });

  router.use(cargarSesion(db));
  router.use(exigeCsrf);

  /* Datos de sesión como locals, NO como parámetros del include.
     Motivo: las vistas los pasaban una a una en forma abreviada
     ({ nombre, csrf }) y si una se olvidaba de uno, EJS reventaba
     al renderizar. Con res.locals el partial los ve siempre, y
     añadir una vista nueva no puede romper nada. */
  router.use((req, res, next) => {
    res.locals.rol = req.sesion ? req.sesion.rol : "";
    res.locals.nombre = req.sesion ? req.sesion.nombre : "";
    res.locals.csrf = req.sesion ? auth.csrfDe(req.sesion) : "";
    if (res.locals.current === undefined) res.locals.current = "";
    /* Las etiquetas de estado, aquí y no en cada router.
       logs/error.log tenía tres `TypeError: etiqueta is not a
       function`: consultas.ejs, cobros.ejs y mis-servicios.ejs
       llamaban a un helper que su ruta no había pasado. Inyectándolos
       aquí, toda vista del panel los tiene siempre y no se pueden
       olvidar.

       Se inyectan en plano (etiquetaTipo, no L.etiquetaTipo) porque así
       los usan las vistas actuales, y además el objeto L completo
       para lo nuevo. Los textos salen de lib/labels.js, que es la
       fuente única: por eso los routers ya no traen sus propios
       mapas. */
    res.locals.L = L;
    Object.assign(res.locals, L.helpers());
    /* Los iconos también aquí y no en cada vista: el partial de la
       cabecera los usa (menú del portal, botón de salir) y si lo
       hubiera que pasar por cada ruta, el primero que se olvidara
       dejaría el menú sin iconos. */
    res.locals.icono = require("../lib/iconos").icono;
    next();
  });

  /* ---------- Login ---------- */
  /* Cookie del double-submit CSRF. Se renueva en cada visita al
     login y solo dura lo que tarda en entrar. */
  const CSRF_PRE = "nexo_csrf";

  router.get(BASE + "/login", (req, res) => {
    if (req.sesion) return res.redirect(BASE);

    const tokenPre = auth.generarTokenPre();
    res.cookie(CSRF_PRE, tokenPre, cookieOpts(30 * 60 * 1000));

    res.render("panel/login", {
      title: "Acceso al panel",
      error: null,
      siguiente: req.query.siguiente || BASE,
      site,
      base: BASE,
      csrfPre: tokenPre,
      noindex: true,
    });
  });

  router.post(BASE + "/login", async (req, res) => {
    const email = String((req.body && req.body.email) || "").trim().toLowerCase();
    const password = String((req.body && req.body.password) || "");
    const siguiente = String((req.body && req.body.siguiente) || BASE);
    const ip = auth.ipDe(req);

    /* Double-submit CSRF: la cookie contra el campo oculto.
       Sin esto, otro sitio podría forzarte a entrar con SU cuenta
       y ver lo que tú escribes. */
    if (!auth.comprobarCsrfPre(req.cookies && req.cookies[CSRF_PRE], req.body && req.body._csrf)) {
      console.warn("[panel] CSRF de login rechazado desde " + ip);
      // Se emite un token nuevo para que el formulario siga siendo
      // utilizable: si no, el visitante se queda sin poder entrar.
      const nuevo = auth.generarTokenPre();
      res.cookie(CSRF_PRE, nuevo, cookieOpts(30 * 60 * 1000));
      return res.status(403).render("panel/login", {
        title: "Acceso al panel",
        error: "La sesión del formulario caducó. Vuelve a intentarlo.",
        siguiente,
        site,
        base: BASE,
        csrfPre: nuevo,
        noindex: true,
      });
    }

    const vistaLogin = (error, status) =>
      res.status(status).render("panel/login", {
        title: "Acceso al panel",
        error,
        siguiente,
        site,
        base: BASE,
        csrfPre: (req.cookies && req.cookies[CSRF_PRE]) || auth.generarTokenPre(),
        noindex: true,
      });

    if (!listo) {
      return vistaLogin("El panel no está configurado. Revisa el archivo .env.", 503);
    }
    if (!email || !password) {
      return vistaLogin("Introduce email y contraseña.", 400);
    }

    /* 1. Límite de intentos ANTES de tocar Supabase.
       Es lo que evita que se prueben contraseñas a saco. */
    const limite = await auth.comprobarLimite(db, email, ip);
    if (!limite.permitido) {
      console.warn(`[panel] Login bloqueado para ${email} desde ${ip}`);
      return vistaLogin(
        `Demasiados intentos. Espera ${limite.minutosEspera} min y vuelve a intentarlo.`,
        429
      );
    }

    try {
      const { data, error } = await supabase
        .getPublico()
        .auth.signInWithPassword({ email, password });

      const ok = !error && data && data.user;
      await auth.registrarIntento(db, email, ip, Boolean(ok));

      if (!ok) {
        // Mismo mensaje para email inexistente y contraseña mala:
        // así no se puede averiguar a quién escribís.
        return vistaLogin("Email o contraseña incorrectos.", 401);
      }

      /* 2. El rol sale de profiles, nunca del JWT. */
      const { data: perfil } = await db
        .from("profiles")
        .select("rol, activo, nombre")
        .eq("id", data.user.id)
        .maybeSingle();

      if (!perfil || !perfil.activo) {
        return vistaLogin("Tu cuenta no tiene acceso. Contacta con el administrador.", 403);
      }

      /* 3. Sesión real en la base de datos.
         Guardamos también el access_token de Supabase: hace falta
         para que el portal del cliente consulte con SU identidad y
         sea RLS quien filtre (ver rutas/panel-portal.js).

         Y el refresh_token, para poder renovar ese access_token
         cuando caduque sin expulsar al usuario (migración 008). Sin
         él, el token del portal caduca a la hora y hay que entrar
         otra vez; y al firmar un ticket para otro servicio, el
         usuario entraría al panel y el servicio lo rechazaría. */
      const accessToken = data.session && data.session.access_token;
      const refreshToken = data.session && data.session.refresh_token;

      /* Se declaran aquí y no en el `const { token, csrf }` de antes:
       * hacen falta para la cookie y para la auditoría, y el bloque
       * de escrituras va dentro de un try propio que los etiqueta. */
      let token = null;
      let csrf = null;

      /* Cada escritura va envuelta para que el error diga QUÉ PASO
       * falló. Antes el log ponía siempre `donde=desconocido`, y con
       * eso no se puede arreglar nada: había que probar a mano los
       * cuatro inserts del login uno a uno, por dentro del contenedor,
       * adivinando el orden.
       *
       * Con `detalle` puesto, un fallo dice exactamente su origen, y
       * con la tabla. Que es lo que hace falta a las tres de la
       * mañana. */
      let paso = "crearSesion";

      try {
        paso = "crearSesion: sessions";
        const creada = await auth.crearSesion(db, {
          userId: data.user.id,
          rol: perfil.rol,
          req,
          accessToken: accessToken || null,
          refreshToken: refreshToken || null,
        });
        token = creada.token;
        csrf = creada.csrf;

        paso = "marcar ultimo acceso: profiles";
        await db
          .from("profiles")
          .update({ ultimo_acceso: new Date().toISOString() })
          .eq("id", data.user.id)
          .then(() => {}, () => {});

        /* `entidad: "sessions"` con el id de la sesión que se acaba de
           crear. Antes ponía la tabla entera, y en el registro de
           auditoría no había forma de saber a qué sesión se refería:
           con muchas sesiones de la misma persona es imposible. */
        paso = "auditar: auditoría";
        await auth.auditar(db, {
          actor: { id: data.user.id, email },
          accion: "login",
          entidad: "session",
          entidadId: token,
          req,
        });

        // Un login correcto borra el contador de fallos de esta IP
        paso = "limpiar intentos: login_attempts";
        await auth.limpiarIntentos(db, email, ip);

        res.cookie(COOKIE, token, cookieOpts(auth.CFG.HORAS_SESION * 3600 * 1000));
        // El token del login ya se ha usado: se retira
        res.clearCookie(CSRF_PRE, { ...cookieOpts(), maxAge: 0 });
        res.redirect(siguiente.startsWith(BASE) ? siguiente : BASE);
      } catch (errDePaso) {
        /* Se propaga con el paso puesto en `detalle`, que es lo que
           lee el catch de abajo. */
        errDePaso.detalle = paso;
        throw errDePaso;
      }
    } catch (err) {
      /* El mensaje solo no dice de dónde viene el fallo: los dos
         sitios donde se inserta en `sessions` son el perfil y la
         auditoría, y con el texto suelto no se distingue. El stack sí. */
      console.error(
        "[panel] Error en login:",
        err.message,
        "| code=" + (err.code || "sin código"),
        "| donde=" + (err.detalle || "sin etiqueta: fallo antes del bloque de escritura"),
        "| tabla=" + (err.detalleTabla || "sessions?")
      );
      if (process.env.NODE_ENV !== "production") console.error(err.stack);
      vistaLogin("No se pudo contactar con la base de datos. Inténtalo en un momento.", 503);
    }
  });

  /* ---------- Logout ---------- */
  router.post(BASE + "/logout", async (req, res) => {
    if (req.sesion) {
      await auth.revocarSesion(db, req.token);
      await auth.auditar(db, {
        actor: { id: req.sesion.user_id, email: null },
        accion: "logout",
        entidad: "sessions",
        req,
      });
    }
    res.clearCookie(COOKIE, { ...cookieOpts(), maxAge: 0 });
    res.redirect(BASE + "/login");
  });

  /* ---------- Raíz del panel ----------
     El equipo ve el resumen; los clientes aterrizan en su portal,
     que es lo único que les corresponde. */
  router.get(BASE, requiereLogin, async (req, res) => {
    if (req.sesion.rol !== "staff") {
      return res.redirect(BASE + "/mis-servicios");
    }

    let resumen = null;
    let caducidades = [];
    let consultas = [];

    if (db) {
      try {
        const [leads, clientes, servicios, sinLeer, vivos, recientes] = await Promise.all([
          db.from("leads").select("id", { count: "exact", head: true }),
          db.from("clients").select("id", { count: "exact", head: true }).eq("archivado", false),
          db
            .from("services")
            .select("id", { count: "exact", head: true })
            .in("estado", ["activo", "en_curso", "pendiente"]),
          db.from("leads").select("id", { count: "exact", head: true }).eq("estado", "nuevo"),

          /* Para los avisos: solo los servicios vivos con la empresa
             delante. El cálculo de fechas vive en lib/vencimientos.js. */
          db
            .from("services")
            .select("id,titulo,kind,estado,importe,moneda,periodicidad,inicia_en,termina_en,clients(empresa,nombre)")
            .in("estado", ["activo", "en_curso", "pendiente", "pausado"]),

          db.from("leads").select("nombre,empresa,estado,recibido_en").order("recibido_en", { ascending: false }).limit(5),
        ]);

        resumen = {
          consultasNuevas: sinLeer.count || 0,
          clientes: clientes.count || 0,
          serviciosActivos: servicios.count || 0,
        };

        caducidades = vencimientos.proximos(vivos.data || []);

        /* "Hace 3 h" en vez de una fecha: lo que importa al entrar
           es si es nuevo o lleva días ahí parado. */
        consultas = (recientes.data || []).map((l) => ({
          nombre: l.nombre,
          empresa: l.empresa,
          estado: l.estado,
          cuando: relativo(l.recibido_en),
        }));
      } catch (err) {
        console.error("[panel] No se pudo cargar el resumen:", err.message);
      }
    }

    res.render("panel/index", {
      title: "Panel",
      site,
      base: BASE,
      noindex: true,
      resumen,
      caducidades,
      consultas,
      aviso: req.query.aviso || null,
      etiquetaLead: L.etiquetaLead,
      dinero,
    });
  });

  /* ---------- Módulos del bloque 1 ----------
     Se montan aquí y no dentro de sus propios ficheros para que
     panel.js siga siendo el único punto donde se decide qué está
     protegido y con qué rol. */
  if (db) {
    const comunes = { db, sitio: site, csrf: auth.csrfDe, requiereStaff };

    /* OJO al prefijo BASE: estos routers declaran rutas como
       "/clientes", pero este router se monta en la RAÍZ de Express.
       Sin el prefijo, la ruta real sería /clientes y no
       /panel/clientes, y todo caería en el 404 de abajo. */
    router.use(BASE, require("./panel-clientes")(comunes));
    router.use(BASE, require("./panel-servicios")(comunes));
    router.use(BASE, require("./panel-consultas")(comunes));
    router.use(BASE, require("./panel-cobros")(comunes));
    router.use(BASE, require("./panel-accesos")(comunes));
    router.use(BASE, require("./panel-portal")({ db, sitio: site, requiereLogin }));
    router.use(BASE, require("./panel-perfil")({ sitio: site, requiereLogin }));

    /* TODO(historial): aquí falta la sección de historial. `audit_log`
       se escribe desde lib/auth.js (auditar()) en cada acción del
       panel, pero no hay ninguna ruta ni vista que la lea: se escribe
       y no se puede consultar. El índice por fecha ya existe en
       001_init.sql, así que es un SELECT ordenado y una vista.
       RLS ya bloquea al cliente (lo comprueba db/test-isolation.js);
       el staff leería con el cliente admin.

       Para añadirla: crear routes/panel-historial.js y descomentar
       la línea de abajo. Ver PENDIENTES.md. */
    // router.use(BASE, require("./panel-historial")(comunes));
  } else {
    console.warn("[panel] Módulos de gestión desactivados: falta Supabase.");
  }

  /* ---------- 404 del panel ---------- */
  router.use(BASE, (req, res) => {
    res.status(404).render("panel/404", {
      title: "No encontrado en el panel",
      site,
      base: BASE,
      noindex: true,
    });
  });

  /* ---------- Errores del panel ----------
     El 404 de arriba solo se alcanza si no hubo error: si una vista
     revienta al renderizar (por una variable que falta, casi
     siempre), salta aquí. Sin esto el error sube al manejador
     genérico y solo se ve un 500 sin explicación. */
  router.use(BASE, (err, req, res, next) => {
    console.error("[panel] " + (err && err.stack ? err.stack : err));
    try {
      const fs = require("fs");
      const dir = require("path").join(__dirname, "..", "logs");
      /* mkdirSync y no open: si el directorio no existe, appendFile
         falla en silencio y se pierde justo el error que Buscamos. */
      fs.mkdirSync(dir, { recursive: true });
      /* Con timestamp, como hace server.js:anotarError. Estas líneas
         se leían en logs/error.log sin fecha y no había forma de
         saber si eran de ayer o de hace tres meses. */
      fs.appendFileSync(
        require("path").join(dir, "error.log"),
        "\n[" + new Date().toISOString() + "] [panel] " + req.method + " " + req.originalUrl + "\n" +
          (err && err.stack ? err.stack : String(err)) + "\n"
      );
    } catch { /* sin log, pero al menos no se rompe más */ }

    if (res.headersSent) return next(err);
    res.status(500).render("panel/404", {
      title: "Error",
      site,
      base: BASE,
      noindex: true,
    });
  });
}

module.exports = router;

/* Accesorios: los usa panel.js como entrada independiente */
module.exports.BASE = BASE;
module.exports.COOKIE = COOKIE;
