/* =========================================================
   Nexo Studio — Cuenta de cliente (alta y acceso)
   ------------------------------------------------------------
   Estas rutas viven en la WEB PÚBLICA, no en el panel. Es a
   propósito: quien se registra es alguien que llega desde la home, sin
   sesión y sin saber que existe un panel. Si el alta estuviera dentro
   de routes/panel.js, su formulario tendría el panel alrededor.

   Aun así usa pieces del panel —sesiones, CSRF, auditoría— porque la
   cuenta que crea es la MISMA que entra por /panel/login. Un usuario
   no tiene dos cuentas según por dónde entre: tiene una.

   ── POR QUÉ AQUÍ Y NO EN web.js ──

   routes/web.js dice, en su cabecera, que nada de esa carpeta debe
   importar nada del panel: "si algún día el panel necesita
   autenticación, DB o auditoría, este archivo ni se entera".

   Este router necesita las tres. Si estuviera dentro de web.js,
   estaría rompiendo esa separación a propósito. Montado antes que
   web.js, el sitio público sigue sin depender del panel para
   funcionar.

   ── EL ROL NUNCA VIENE DEL FORMULARIO ──

   Todo alta nace con `rol = 'client'`, escrito aquí en el servidor.
   No hay ningún campo del formulario que pueda pedir otro rol, ni
   aunque se añada mañana.

   db/create-user.js dice que el panel no tiene registro abierto "a
   propósito", porque "quien puede crear usuarios puede crear
   administradores". Eso es cierto y es la razón de que el alta de
   STAFF siga siendo solo por consola. Pero esa razón no aplica
   igual a un cliente: un alta de cliente no puede crear un
   administrador, y el sitio público necesita poder convertir a un
   visitante en alguien con cuenta, que es de donde sale todo.

   El riesgo real del alta abierta no es la escalada de privilegios,
   que aquí no existe. Es el ruido: cualquiera puede llenar la tabla
   de clientes y crear usuarios de Supabase, que se pagan. Por eso
   hay tres contras, abajo.
   ========================================================= */

const express = require("express");

const auth = require("../lib/auth");
const supabase = require("../lib/supabase");
const siteConfig = require("../lib/site");

const site = siteConfig;
const router = express.Router();

const CSRF_PRE = "nexo_csrf";
const MIN_ESPACIO_HORAS = 32;

const emailValido = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

/* =========================================================
   Locals
   ========================================================= */

router.use((req, res, next) => {
  res.locals.site = site;
  res.locals.year = new Date().getFullYear();
  res.locals.current = "cuenta";
  res.locals.canonical = site.url + req.originalUrl;
  res.locals.ogType = "website";
  res.locals.ogImage = site.ogImage;

  /* Estas dos páginas nunca en el índice: no hay nada que buscar y una
     web con loginindexado se lleva coladas de credenciales. */
  res.locals.noindex = true;
  next();
});

/** Devuelve la vista de error con el formulario aún utilizable. */
function vista(res, vista_, datos, status = 200) {
  return res.status(status).render("cuenta/" + vista_, {
    site,
    year: new Date().getFullYear(),
    current: "cuenta",
    noindex: true,
    ...datos,
  });
}

/* =========================================================
   Alta
   ========================================================= */

router.get("/cuenta/crear", (req, res) => {
  if (req.sesion) return res.redirect("/panel");

  const tokenPre = auth.generarTokenPre();
  res.cookie(CSRF_PRE, tokenPre, auth.cookieOptsCsrf(30 * 60 * 1000));

  vista(res, "crear", {
    title: "Crear cuenta",
    description: "Crea tu cuenta de cliente de Nexo Studio.",
    datos: {},
    errores: {},
    csrfPre: tokenPre,
  });
});

router.post("/cuenta/crear", async (req, res) => {
  const cuerpo = req.body || {};

  const email = String(cuerpo.email || "").trim().toLowerCase();
  const nombre = String(cuerpo.nombre || "").trim();
  const empresa = String(cuerpo.empresa || "").trim();
  const password = String(cuerpo.password || "");
  const repetir = String(cuerpo.repetir || "");
  const acepta = cuerpo.acepta === "1" || cuerpo.acepta === "on";

  const ip = auth.ipDe(req);
  const reintentar = () => {
    const nuevo = auth.generarTokenPre();
    res.cookie(CSRF_PRE, nuevo, auth.cookieOptsCsrf(30 * 60 * 1000));
    return nuevo;
  };

  /* ── 1. CSRF ── */
  if (!auth.comprobarCsrfPre(req.cookies && req.cookies[CSRF_PRE], cuerpo._csrf)) {
    console.warn("[cuenta] CSRF de alta rechazado desde " + ip);
    return vista(res, "crear", {
      title: "Crear cuenta",
      description: "Crea tu cuenta de cliente de Nexo Studio.",
      datos: { email, nombre, empresa },
      errores: { general: "La sesión del formulario caducó. Vuelve a intentarlo." },
      csrfPre: reintentar(),
    }, 403);
  }

  /* ── 2. Trampa para robots ──
     Un campo invisible que una persona no rellena. Se comprueba
     DESPUÉS del CSRF a propósito: si se comprobara antes, un robot
     ni siquiera gastaría la validación y el rechazo sería idéntico
     al de una persona, lo que no dice nada.
     Aquí, que el rechazo es silencioso, es lo correcto. */
  if (String(cuerpo.sitio_web || "").trim()) {
    console.warn("[cuenta] alta desde un formulario automatizado, ip " + ip);
    return vista(res, "crear", {
      title: "Crear cuenta",
      description: "Crea tu cuenta de cliente de Nexo Studio.",
      datos: { email, nombre, empresa },
      errores: {},
      csrfPre: reintentar(),
    });
  }

  /* ── 3. Validación ── */
  const errores = {};

  if (!nombre) errores.nombre = "Dinos cómo te llamas.";
  if (nombre.length > 120) errores.nombre = "Ese nombre es demasiado largo.";

  if (!email) errores.email = "Necesitamos un correo para tu cuenta.";
  else if (!emailValido(email)) errores.email = "Ese correo no parece válido.";

  if (empresa.length > 160) errores.empresa = "Ese nombre de empresa es demasiado largo.";

  if (!password) errores.password = "Elige una contraseña.";
  else if (password.length < MIN_ESPACIO_HORAS) {
    errores.password = "Mínimo " + MIN_ESPACIO_HORAS + " caracteres.";
  } else if (password.length > 200) {
    /* Un campo de 200 caracteres es lo que manda el navegador, pero
       poner el tope en el servidor evita que alguien envíe lo que
       quiera por detrás. */
    errores.password = "Esa contraseña es demasiado larga.";
  }

  if (password !== repetir) errores.repetir = "Las dos contraseñas no coinciden.";

  if (!acepta) errores.acepta = "Necesitamos que aceptes las condiciones.";

  if (Object.keys(errores).length) {
    return vista(res, "crear", {
      title: "Crear cuenta",
      description: "Crea tu cuenta de cliente de Nexo Studio.",
      datos: { email, nombre, empresa },
      errores,
      csrfPre: reintentar(),
    }, 400);
  }

  /* ── 4. Límite de intentos ──
     El alta abierta admite ruido, así que se acota. Se reusa el
     mismo contador que el login, con el email y la IP: si alguien
     insiste con el mismo correo, para.

     OJO: `comprobarLimite` devuelve `{ permitido }`, no `{ ok }`. La
     primera versión leía `.ok`, que no existe: `!undefined` es true
     siempre, así que TODOS los altas devolvían 429 y ninguna cuenta
     se podía crear. Un nombre de propiedad equivocado en una
     condición que por defecto es "no permitido" convierte el fallo en
     un muro, y no en un despiste. */
  const limite = await auth.comprobarLimite(supabase.getAdmin(), email, ip);
  if (!limite.permitido) {
    return vista(res, "crear", {
      title: "Crear cuenta",
      description: "Crea tu cuenta de cliente de Nexo Studio.",
      datos: { email, nombre, empresa },
      errores: { general: "Demasiados intentos desde esta conexión. Prueba en un rato." },
      csrfPre: reintentar(),
    }, 429);
  }

  const admin = supabase.getAdmin();

  /* ── 5. Usuario de Auth ──
     `email_confirm: true` porque aquí no hay a quién confirmarle:
     el correo es de quien se está registrando, en la misma pantalla,
     y con confirmación por correo el alta parecería que no funciona
     en casi todos los casos.

     Que no haya confirmación no significa que no haga falta probar
     que el correo es suyo: eso se hace cuando contracted algo, no al
     crear una cuenta vacía que todavía no da acceso a nada. */
  let userId;
  try {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (error) {
      /* ── Email ya usado ──
         AQUÍ SÍ SE DICE QUE LA CUENTA EXISTE, y es una decisión.

         Antes este comentario afirmaba lo contrario —"no se distingue
         de un alta correcta"— y el mensaje de debajo lo contradecía
         en la misma línea. Un comentario que miente sobre lo que hace
         el código es peor que no tener comentario: lo siguiente que
         lea se va a fiar de él.

         Las dos cosas que se pueden hacer:

           a) No decir nada. El visitante que ya se registró y no lo
              recuerda recibe un "si no tienes cuenta, escríbenos" y
              no puede entrar. Para un negocio pequeño con clientes
              que se registran una vez y vuelven, es un problema real
              en cada cliente que vuelve.

           b) Decirlo, y apuntar a entrar.

         Se elige (b), como GitHub, Vercel o Stripe. El coste es
         que quien pruebe correos puede saber cuáles están dados de
         alta. En un sitio donde los correos son de negocios y las
         cuentas se crean a mano casi siempre, ese dato no sirve
         para mucho. Y el alta sin confirmacion por correo funciona
         porque no hay a quién confirmárselo.
         confirmárselo.
         Lo que NO se dice nunca es si una CONTRASEÑA es correcta: en
         /cuenta/entrar el texto es el mismo exista o no la cuenta. Eso
         sí es lo que permite ir probando contraseñas por correo, y
         ahí sí se neutraliza. Ver la nota del login. */
      if (/already|registered|exists/i.test(error.message || "")) {
        console.log("[cuenta] alta con email ya existente, ip " + ip);
        await auth.registrarIntento(supabase.getAdmin(), email, ip, true);
        return vista(res, "crear", {
          title: "Crear cuenta",
          description: "Crea tu cuenta de cliente de Nexo Studio.",
          datos: {},
          errores: {},
          aviso:
            "Ese correo ya tiene una cuenta. Entra con tu contraseña, " +
            "o escríbenos si no te acuerdas y la cambiamos.",
          csrfPre: reintentar(),
        });
      }

      console.error("[cuenta] no se pudo crear el usuario:", error.message);
      return vista(res, "crear", {
        title: "Crear cuenta",
        description: "Crea tu cuenta de cliente de Nexo Studio.",
        datos: { email, nombre, empresa },
        errores: { general: "No pudimos crear la cuenta. Inténtalo en un momento." },
        csrfPre: reintentar(),
      }, 503);
    }

    userId = data.user.id;
  } catch (e) {
    console.error("[cuenta] Auth fallsó:", e.message);
    return vista(res, "crear", {
      title: "Crear cuenta",
      description: "Crea tu cuenta de cliente de Nexo Studio.",
      datos: { email, nombre, empresa },
      errores: { general: "No pudimos crear la cuenta. Inténtalo en un momento." },
      csrfPre: reintentar(),
    }, 503);
  }

  /* ── 6. Ficha de cliente ──
     El alta REUTILIZA la empresa si ya existe, igual que
     db/create-user.js. Alguien que se registra con el nombre de su
     empresa ya dada de alta no debe crear una segunda ficha: la
     segunda tendría cero servicios y parecería un cliente nuevo.

     Y en ese caso la cuenta se enlaza a la ficha que ya había, que es
     justo lo que quiere la persona que se registra. */
  let clientId = null;
  try {
    const { data: existentes } = await admin
      .from("clients")
      .select("id")
      .ilike("empresa", empresa || nombre)
      .limit(1);

    if (existentes && existentes.length) {
      clientId = existentes[0].id;
      console.log("[cuenta] ficha reutilizada: " + (empresa || nombre));
    } else {
      const { data: nueva, error } = await admin
        .from("clients")
        .insert({
          nombre,
          empresa: empresa || null,
          email,
          /* Una nota que dice de dónde salió. Sin esto, el equipo ve
             una ficha nueva y no sabe si es un alta de la web o
             alguien que se creó por otra vía. */
          notas: "Alta desde la web pública.",
        })
        .select("id")
        .single();

      if (error) throw new Error(error.message);
      clientId = nueva.id;
    }

    /* ── 7. Perfil: aquí se fija el rol ── */
    const { error: errPerfil } = await admin.from("profiles").insert({
      id: userId,
      rol: "client",
      client_id: clientId,
      nombre,
      activo: true,
    });

    if (errPerfil) throw new Error(errPerfil.message);
  } catch (e) {
    /* Si el usuario de Auth ya existe pero la ficha no, queda una
       cuenta sin perfil. El login la rechaza con "tu cuenta no tiene
       acceso", que es un mensaje real, pero el alta tiene que
       avisar de que se ha quedado a medias. */
    console.error("[cuenta] alta a medias (Auth ok, ficha no):", e.message);
    return vista(res, "crear", {
      title: "Crear cuenta",
      description: "Crea tu cuenta de cliente de Nexo Studio.",
      datos: { email, nombre, empresa },
      errores: {
        general:
          "Hemos creado tu acceso pero no tu ficha, y la cuenta se ha quedado " +
          "a medias. Escríbenos con este correo y la terminamos: " + email,
      },
      csrfPre: reintentar(),
    }, 503);
  }

  await auth.registrarIntento(supabase.getAdmin(), email, ip, true);

  /* ── 8. Sesión ──
     Se entra directamente, sin pedir la contraseña otra vez: la acaba
     de escribir y ya está comprobada. Mandarle a la pantalla de
     acceso sería decirle que no le hemos creído. */
  try {
    const { data: sesion, error } = await supabase
      .getPublico()
      .auth.signInWithPassword({ email, password });

    if (error || !sesion || !sesion.session) throw new Error(error ? error.message : "sin sesión");

    await auth.crearSesion(supabase.getAdmin(), {
      userId,
      rol: "client",
      req,
      accessToken: sesion.session.access_token,
      refreshToken: sesion.session.refresh_token,
    }).then((creada) => {
      res.cookie(auth.COOKIE, creada.token, auth.cookieOpts(auth.CFG.HORAS_SESION * 3600 * 1000));
    });

    await auth.auditar(supabase.getAdmin(), {
      actor: { id: userId, email },
      accion: "alta",
      entidad: "clients",
      entidadId: clientId,
      detalle: { desde: "web", empresa: empresa || nombre },
      req,
    });
  } catch (e) {
    /* La cuenta existe y está bien. Lo que falla es dejarle dentro
       ahora mismo, y eso no es motivo para decirle que su alta falló:
       se le manda a entrar y listo. */
    console.error("[cuenta] alta creada pero sin sesión:", e.message);
  }

  res.clearCookie(CSRF_PRE, { ...auth.cookieOptsCsrf(), maxAge: 0 });
  res.redirect("/panel/mis-servicios?bienvenida=1");
});

/* =========================================================
   Acceso
   ========================================================= */

router.get("/cuenta/entrar", (req, res) => {
  if (req.sesion) return res.redirect("/panel");

  const tokenPre = auth.generarTokenPre();
  res.cookie(CSRF_PRE, tokenPre, auth.cookieOptsCsrf(30 * 60 * 1000));

  vista(res, "entrar", {
    title: "Entrar",
    description: "Accede a tu cuenta de Nexo Studio.",
    datos: {},
    error: null,
    csrfPre: tokenPre,
  });
});

router.post("/cuenta/entrar", async (req, res) => {
  const cuerpo = req.body || {};
  const email = String(cuerpo.email || "").trim().toLowerCase();
  const password = String(cuerpo.password || "");
  const ip = auth.ipDe(req);

  const reintentar = () => {
    const nuevo = auth.generarTokenPre();
    res.cookie(CSRF_PRE, nuevo, auth.cookieOptsCsrf(30 * 60 * 1000));
    return nuevo;
  };

  if (!auth.comprobarCsrfPre(req.cookies && req.cookies[CSRF_PRE], cuerpo._csrf)) {
    return vista(res, "entrar", {
      title: "Entrar",
      description: "Accede a tu cuenta de Nexo Studio.",
      datos: { email },
      error: "La sesión del formulario caducó. Vuelve a intentarlo.",
      csrfPre: reintentar(),
    }, 403);
  }

  const fallo = (mensaje, status = 401) =>
    vista(res, "entrar", {
      title: "Entrar",
      description: "Accede a tu cuenta de Nexo Studio.",
      datos: { email },
      error: mensaje,
      csrfPre: (req.cookies && req.cookies[CSRF_PRE]) || reintentar(),
    }, status);

  if (!email || !password) return fallo("Escribe tu correo y tu contraseña.");

  const admin = supabase.getAdmin();

  try {
    const { data, error } = await supabase
      .getPublico()
      .auth.signInWithPassword({ email, password });

    const ok = !error && data && data.user;
    await auth.registrarIntento(admin, email, ip, Boolean(ok));

    if (!ok) {
      /* El mismo texto para email que no existe y contraseña mala. Si
         se distinguen, el formulario sirve para averiguar a qué correos
         hay cuenta. */
      return fallo("El correo o la contraseña no son correctos.");
    }

    const { data: perfil } = await admin
      .from("profiles")
      .select("rol, activo")
      .eq("id", data.user.id)
      .maybeSingle();

    if (!perfil || !perfil.activo) {
      return fallo("Tu cuenta no tiene acceso. Habla con el equipo para reactivarla.", 403);
    }

    const creada = await auth.crearSesion(admin, {
      userId: data.user.id,
      rol: perfil.rol,
      req,
      accessToken: data.session && data.session.access_token,
      refreshToken: data.session && data.session.refresh_token,
    });

    await auth.limpiarIntentos(admin, email, ip);

    await auth.auditar(admin, {
      actor: { id: data.user.id, email },
      accion: "login",
      entidad: "session",
      entidadId: creada.token,
      req,
    });

    res.cookie(auth.COOKIE, creada.token, auth.cookieOpts(auth.CFG.HORAS_SESION * 3600 * 1000));
    res.clearCookie(CSRF_PRE, { ...auth.cookieOptsCsrf(), maxAge: 0 });

    /* Un cliente al portal y el equipo al panel. /panel ya hace esto
       solo por rol, pero se dice aquí para que la URL de la barra de
       direcciones no pase por un rebote que se ve como un parpadeo. */
    return res.redirect(perfil.rol === "staff" ? "/panel" : "/panel/mis-servicios");
  } catch (e) {
    console.error("[cuenta] error en login:", e.message);
    return fallo("No se pudo contactar con la base de datos. Inténtalo en un momento.", 503);
  }
});

module.exports = router;