/* =========================================================
   Nexo Studio — Autenticación del panel
   ------------------------------------------------------------
   Sesiones, CSRF, límite de intentos y auditoría.

   CAMBIO IMPORTANTE respecto a la primera versión
   -----------------------------------------------
   Antes la cookie era un token firmado con HMAC y sin estado:
   couldn't revocarse, y llevaba dentro el id y el rol en
   texto legible.

   Ahora la cookie es un token opaco y aleatorio. El servidor
   guarda solo su SHA-256. Consecuencias:
     · El logout invalida de verdad (marca revoked)
     · Un robo de la tabla no sirve para suplantar a nadie
     · En la cookie no viaja información
     · Se pueden cerrar todas las sesiones de un usuario

   CSRF
   ----
   Cada sesión tiene su propio token CSRF. Va en un campo oculto
   de cada formulario y se compara con timingSafeEqual. Sin esto,
   cualquier sitio podría enviar un POST a /panel/logout o, más
   adelante, crear clientes en nombre tuyo.
   ========================================================= */

const crypto = require("crypto");

const IP_FALLBACK = "desconocida";

/* ---------- Configuración ---------- */
const CFG = {
  /* Duración de la sesión */
  HORAS_SESION: 8,

  /* Límite de intentos */
  MAX_INTENTOS: 8,
  VENTANA_MINUTOS: 15,

  /* Caducidad de los registros de intento (limpieza) */
  DIAS_LIMPIEZA: 30,
};

/* =========================================================
   Utilidades de bajo nivel
   ========================================================= */

const hash = (valor) => crypto.createHash("sha256").update(valor).digest("hex");

const aleatorio = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");

/** Compara dos cadenas sin filtrar información por tiempo */
function igual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

const ipDe = (req) =>
  (req && (req.ip || (req.headers && req.headers["x-forwarded-for"])) ) || IP_FALLBACK;

const dentroDeVentana = (iso, minutos) => {
  const limite = Date.now() - minutos * 60 * 1000;
  return new Date(iso).getTime() >= limite;
};

/* =========================================================
   Sesiones
   ========================================================= */

/**
 * Crea una sesión y devuelve { token, csrf }.
 * El token NUNCA se guarda: solo su hash.
 */
async function crearSesion(db, { userId, rol, req, accessToken = null, refreshToken = null }) {
  const token = aleatorio(32);
  const csrf = aleatorio(24);

  const expira = new Date(Date.now() + CFG.HORAS_SESION * 3600 * 1000).toISOString();

  const { error } = await db
    .from("sessions")
    .insert({
      token_hash: hash(token),
      user_id: userId,
      rol,
      csrf_token: csrf,
      // Puente con Supabase Auth: permite reconstruir la sesión del
      // usuario para que las políticas RLS se apliquen en el portal.
      access_token: accessToken,
      /* Con el refresh_token se puede renovar el access_token, que
         caduca a la ~1 h, sin obligar al usuario a entrar otra vez.
         Lo necesita el paso a microservicios: al firmar un ticket
         para otro subdominio, el token tiene que estar vivo. Ver
         lib/tickets.js y la migración 008. */
      refresh_token: refreshToken,
      ip: ipDe(req),
      user_agent: (req && req.headers && req.headers["user-agent"] || "").slice(0, 250),
      expira_en: expira,
    });

  if (error) throw new Error(error.message);
  return { token, csrf, expira };
}

/**
 * Devuelve un access_token VIGENTE para esta sesión, renovándolo si
 * hace falta.
 *
 * POR QUÉ EXISTE
 * --------------
 * Los access_tokens de Supabase caducan a la ~1 hora. El portal
 * funciona sin esto porque avisa de que vuelvas a entrar. Pero al
 * firmar un ticket para otro servicio, si el token está a punto de
 * caducar el ticket llega vivo y el servicio receptor no puede
 * reconstruir la sesión: el usuario entra al panel, pulsa "ir a mi
 * bot" y lo rechaza sin explicación.
 *
 * Por eso se renueva ANTES de firmar, no cuando ya ha caducado.
 *
 * Si la sesión no tiene refresh_token (es de antes de la migración
 * 008), devuelve el token que haya sin tocar nada: es mejor un token
 * a punto de caducar que ninguno. El servicio receptor es el que
 * decide si le sirve o lo rechaza.
 *
 * Nunca lanza. Devuelve el token o null.
 */
async function tokenVigente(db, sesion) {
  if (!sesion || !sesion.access_token) return null;

  const tickets = require("./tickets");
  if (!tickets.tokenPorExpirar(sesion.access_token)) {
    return sesion.access_token;
  }

  /* Caduca pronto. Sin refresh_token no hay nada que hacer. */
  if (!sesion.refresh_token) return sesion.access_token;

  const supabase = require("./supabase");
  const { data, error } = await supabase
    .getAdmin()
    .auth.refreshSession({ refresh_token: sesion.refresh_token });

  if (error || !data || !data.session || !data.session.access_token) {
    /* El refresh_token también caducó o se revocó. Se avisa por
       consola y se sigue con el token viejo: que la base de datos
       decida si lo acepta. Borrar la sesión aquí expulsaría al
       usuario sin motivo. */
    console.warn(
      "[sesiones] No se pudo renovar el token de " +
        sesion.user_id +
        ": " +
        (error ? error.message : "respuesta sin sesión")
    );
    return sesion.access_token;
  }

  /* Se guarda el token nuevo para las próximas peticiones. Si este
     guardado falla, el usuario entra igual: solo se renueva mal. */
  await db
    .from("sessions")
    .update({
      access_token: data.session.access_token,
      /* Supabase rota el refresh_token en cada uso. Guardar el nuevo
         es lo que evita que el segundo uso falle. */
      refresh_token: data.session.refresh_token || sesion.refresh_token,
    })
    .eq("id", sesion.id)
    .then(() => {}, () => {});

  return data.session.access_token;
}

/**
 * Devuelve la sesión viva de una petición, o null.
 * Refresca 'ultimo_acceso' si lleva más de 5 min sin tocarse,
 * para que el menú del panel sepa cuándo fue la última actividad.
 */
async function leerSesion(db, token) {
  if (!token) return null;

  const { data, error } = await db
    .from("sessions")
    .select("*")
    .eq("token_hash", hash(token))
    .maybeSingle();

  if (error || !data) return null;
  if (data.revocada_en) return null;
  if (new Date(data.expira_en).getTime() < Date.now()) return null;

  const toca = Date.now() - new Date(data.ultimo_acceso).getTime() > 5 * 60 * 1000;
  if (toca) {
    db.from("sessions")
      .update({ ultimo_acceso: new Date().toISOString() })
      .eq("id", data.id)
      .then(() => {}, () => {});
  }

  return data;
}

/** Revoca una sesión concreta (logout) */
async function revocarSesion(db, token) {
  if (!token) return false;
  const { error } = await db
    .from("sessions")
    .update({ revocada_en: new Date().toISOString() })
    .eq("token_hash", hash(token))
    .is("revocada_en", null);
  return !error;
}

/** Revoca TODAS las sesiones de un usuario.
    Útil para "cerrar sesión en todos los dispositivos" o si
    sospechas que le han robado la contraseña. */
async function revocarTodas(db, userId) {
  const { error } = await db
    .from("sessions")
    .update({ revocada_en: new Date().toISOString() })
    .eq("user_id", userId)
    .is("revocada_en", null);
  return !error;
}

/* =========================================================
   Límite de intentos
   ========================================================= */

/**
 * ¿Puede este email+IP intentar entrar ahora?
 * Devuelve { permitido, restantes, minutosEspera }
 */
async function comprobarLimite(db, email, ip) {
  const { data, error } = await db
    .from("login_attempts")
    .select("exito, created_at")
    .eq("email", email)
    .eq("ip", ip)
    .gte("created_at", new Date(Date.now() - CFG.VENTANA_MINUTOS * 60000).toISOString())
    .order("created_at", { ascending: false })
    .limit(CFG.MAX_INTENTOS + 5);

  if (error) {
    // Si no podemos comprobar, dejamos pasar: que el fallo de la
    // base no deje a nadie fuera del panel.
    return { permitido: true, restantes: CFG.MAX_INTENTOS, minutosEspera: 0 };
  }

  const fallos = (data || []).filter((r) => !r.exito);
  if (fallos.length < CFG.MAX_INTENTOS) {
    return {
      permitido: true,
      restantes: CFG.MAX_INTENTOS - fallos.length,
      minutosEspera: 0,
    };
  }

  // Cuando se bloquea, el bloqueo dura hasta que expire la ventana
  // del último fallo. Así no hay que esperar la ventana completa.
  const ultimo = fallos[fallos.length - 1];
  const restante = Math.ceil(
    (new Date(ultimo.created_at).getTime() + CFG.VENTANA_MINUTOS * 60000 - Date.now()) / 60000
  );

  return { permitido: false, restantes: 0, minutosEspera: Math.max(1, restante) };
}

/** Registra un intento (exitoso o no) */
async function registrarIntento(db, email, ip, exito) {
  await db
    .from("login_attempts")
    .insert({ email, ip, exito })
    .then(() => {}, () => {});

  // Limpieza perezosa: de vez en cuando quitamos lo viejo.
  // Sin esto la tabla crece sin parar.
  try {
    const { count } = await db
      .from("login_attempts")
      .select("id", { count: "exact", head: true });
    if ((count || 0) > 2000) {
      const limite = new Date(Date.now() - CFG.DIAS_LIMPIEZA * 86400000).toISOString();
      await db.from("login_attempts").delete().lt("created_at", limite).then(() => {}, () => {});
    }
  } catch {
    /* la limpieza no es crítica */
  }
}

/** Borra los intentos fallidos de un email (tras un login correcto).
    Así un usuario que falla 3 veces y acierta no arrastra el
    contador. */
async function limpiarIntentos(db, email, ip) {
  await db
    .from("login_attempts")
    .delete()
    .eq("email", email)
    .eq("ip", ip)
    .eq("exito", false)
    .then(() => {}, () => {});
}

/* =========================================================
   CSRF
   ========================================================= */

/** Devuelve el token CSRF de la sesión para meterlo en un formulario */
const csrfDe = (sesion) => (sesion && sesion.csrf_token) || "";

/**
 * Comprueba el token recibido contra el de la sesión.
 * Comparación en tiempo constante.
 */
function comprobarCsrf(sesion, recibido) {
  if (!sesion) return false;
  if (!recibido) return false;
  return igual(sesion.csrf_token, String(recibido));
}

/** Campo oculto listo para pegar en un <form> */
const campoCsrf = (sesion) =>
  `<input type="hidden" name="_csrf" value="${csrfDe(sesion)}">`;

/* ---------- CSRF sin sesión (el login) ----------
   El login no puede usar el token de sesión: todavía no hay
   sesión. Se usa el patrón "double submit":
     1. Al pintar el login, se pone un valor aleatorio en una
        cookie httpOnly
     2. El mismo valor va en un campo oculto del formulario
     3. Al enviar, se comparan cookie y campo

   Por qué funciona: un sitio externo puede ENVIAR el formulario,
   pero no puede LEER la cookie de nuestra web (política de mismo
   origen). Sin poder leerla, no puede conocer el valor correcto y
   no puede falsificar la petición. */
function generarTokenPre() {
  return aleatorio(24);
}

function comprobarCsrfPre(cookieValor, recibido) {
  if (!cookieValor || !recibido) return false;
  return igual(cookieValor, String(recibido));
}

/* =========================================================
   Auditoría
   ========================================================= */

/**
 * Cierra las sesiones de un usuario EXCEPTO la actual.
 *
 * Para qué: cuando alguien cambia su contraseña porque cree que se la
 * han visto, cerrar solo las sesiones antiguas no sirve: si el
 * intruso ya tenía una sesión abierta, esa sesión sigue valiendo y
 * el cambio de contraseña no expulsa a nadie.
 *
 * Al revés, cerrar también la sesión con la que se acaba de cambiar
 * sería una tontería: el usuario se quedaría fuera de su cuenta por
 * cambiar la contraseña, y tendría que entrar otra vez sin saber por
 * qué.
 *
 * @param {object} db
 * @param {string} userId
 * @param {string} tokenActual  Token de la cookie, en claro
 * @returns {Promise<number>}   Cuántas se han cerrado
 */
async function revocarOtras(db, userId, tokenActual) {
  try {
    const { data: abiertas } = await db
      .from("sessions")
      .select("id")
      .eq("user_id", userId)
      .is("revocada_en", null)
      .neq("token_hash", hash(tokenActual || ""));

    if (!abiertas || !abiertas.length) return 0;

    await db
      .from("sessions")
      .update({ revocada_en: new Date().toISOString() })
      .in("id", abiertas.map((s) => s.id));

    return abiertas.length;
  } catch (err) {
    console.error("[sesiones] No se pudieron cerrar las otras:", err.message);
    return 0;
  }
}

/**
 * Deja constancia de una acción. Nunca lanza: si el registro falla,
 * la acción sigue siendo válida.
 */
async function auditar(db, { actor, accion, entidad, entidadId, detalle, req }) {
  try {
    await db.from("audit_log").insert({
      actor_id: actor ? actor.id : null,
      actor_email: actor ? actor.email : null,
      accion,
      entidad: entidad || null,
      entidad_id: entidadId ? String(entidadId) : null,
      detalle: detalle || null,
      ip: req ? ipDe(req) : null,
    });
  } catch (err) {
    console.error("[audit] No se pudo registrar:", err.message);
  }
}

/* =========================================================
   La cookie de sesión
   =========================================================

   Vive aquí y no en routes/panel.js porque ahora la ponen dos sitios:
   el login del panel y el de la web pública (routes/cuenta.js). Si
   cada uno declarara la suya, el día que una cambiara —el path, el
   `secure`, el `maxAge`— el otro seguiría con la suya y se rompería
   el paso entre las dos pantallas sin que nada lo dijera.

   El `path` es `/panel` y no `/`: es a propósito, para que la cookie
   no viaje con cada petición a la web pública. Entra solo con las
   peticiones del panel, que es donde está el contenido privado.

   Que se ponga desde `/cuenta/entrar` no estorba: el `path` decide
   qué peticiones la ENVIAN, no desde dónde se puede poner. El
   navegador la guarda y la manda a `/panel/*`, que es justo lo que
   hace falta para que entrar desde la web deje al cliente dentro. */
const COOKIE = "nexo_panel";
const PATH_PANEL = "/panel";
const RAIZ = "/";

/**
 * Opciones de la cookie de sesión.
 *
 * `path` por defecto es `/panel` porque es donde está el contenido
 * privado y así la cookie no viaja con cada petición de la web
 * pública. Se puede pasar otro para las cookies que legítimamente
 * necesita leer otra ruta (ver `cookieOptsCsrf`).
 */
const cookieOpts = (maxAgeMs, path = PATH_PANEL) => ({
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path,
  ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
});

/**
 * La cookie del CSRF previo (el "double submit" del login).
 *
 * ESTA VA EN `/` Y NO EN `/panel`, y es el fallo que cuesta media hora
 * si no se busca.
 *
 * La idea de dejar la cookie de sesión en `/panel` es buena, pero esa
 * restricción también se aplicaba a la del CSRF. El resultado: los
 * formularios de /cuenta/crear y /cuenta/entrar mandan un token que
 * el navegador NO envía, porque la cookie no es de esa ruta. El
 * navegador no da ningún error: la petición llega, el servidor
 * compara la cookie contra el campo, la cookie no está, y responde
 * 403. Alta y acceso rotos, sin ningún rastro en la consola.
 *
 * Es el mismo token que panel/login, y ahí sí funcionaba, porque /panel
 * está dentro de la ruta. Por eso no se nota en el panel: falla solo
 * en la parte nueva.
 *
 * Que esté en `/` no abre nada. El valor no es un secreto: es un
 * nonce que tiene que coincidir con un campo del formulario de ESTE
 * sitio, y un sitio externo puede mandar el formulario pero no leer
 * la cookie. Aunque se filtrara, sin el otro mitad no sirve de nada.
 */
const cookieOptsCsrf = (maxAgeMs) => cookieOpts(maxAgeMs, RAIZ);

module.exports = {
  CFG,
  COOKIE,
  PATH_PANEL,
  cookieOpts,
  cookieOptsCsrf,
  hash,
  aleatorio,
  igual,
  ipDe,
  dentroDeVentana,
  crearSesion,
  tokenVigente,
  leerSesion,
  revocarSesion,
  revocarTodas,
  revocarOtras,
  comprobarLimite,
  registrarIntento,
  limpiarIntentos,
  csrfDe,
  comprobarCsrf,
  campoCsrf,
  generarTokenPre,
  comprobarCsrfPre,
  auditar,
};
