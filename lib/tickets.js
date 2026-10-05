/* =========================================================
   Nexo Studio — Tickets de acceso entre servicios
   ------------------------------------------------------------
   Un ticket es la prueba de que quien llega a otro subdominio
   (bot.midominio.com) es un cliente que ya ha entrado en el panel.
   Se firma aquí y se valida allí, sin que los dos servicios
   tengan que llamarse.

   POR QUÉ UN TICKET Y NO UNA COOKIE COMPARTIDA
   -------------------------------------------
   Lo tentador sería poner la cookie de sesión con
   Domain=.midominio.com y que el bot la leyera directamente. No.

   La cookie es host-only a propósito: si alguien mete XSS en la web
   pública, no debe poder leer la sesión del panel (está escrito en
   panel.js y en las reglas del proyecto). Una cookie compartida
   rompe esa protección: bastaría con comprometer CUALQUIER
   subdominio para llevarse la sesión de todos. Con el ticket, cada
   servicio mantiene su cookie y el alcance queda acotado.

   QUÉ CONTIENE
   ------------
   Solo lo mínimo:
     uid  id del usuario en Supabase Auth
     cid  id del cliente al que pertenece (null si es staff)
     rol  'staff' | 'client'
     at   access_token, para reconstruir la sesión y que RLS decida
     exp  caduca en SEGUNDOS_TICKET

   El access_token va dentro a propósito: es lo que permite al bot
   trabajar con RLS en vez de preguntarle al panel. Va en un fragmento
   (#) que NO se envía al servidor, así que no acaba en los logs de
   Railway ni en el Access Log del proxy.

   LA FIRMA
   --------
   HMAC-SHA256 con SERVICE_SECRET. Lo verifica el servicio con
   crypto.timingSafeEqual: comparar firmas con === filtra información
   por tiempo y permite forjar tickets poco a poco.

   OJO CON EL SECRET
   -----------------
   SERVICE_SECRET tiene que ser el MISMO en los dos servicios y
   distinto de SESSION_SECRET. Si comparten secreto, una firma válida
   del panel valdría como cookie de sesión.

   Y tiene que estar en .env, nunca en git. `npm run estado` avisa si
   el código la usa y no está en .env.example.
   ========================================================= */

const crypto = require("crypto");
const env = require("./env");

/* El secret se lee del entorno una vez, pero se puede pasar a mano en
   cada llamada. Las dos cosas:

     · leerlo del entorno  → es lo normal, y hace que `npm run estado`
                             vea la variable usada y avise si alguien
                             la quita del .env
     · pasarlo por parámetro → permite testear con un secret propio, y
                             que dos servicios con secretos distintos
                             no se puedan validar mutuamente

   Si viene SERVICE_SECRET y el que se pasa es undefined, se usa el del
   entorno. Si vienen los dos, manda el parámetro. */
const secretPorDefecto = () => {
  const carga = env.load();
  if (!carga.ok) return "";
  return (process.env.SERVICE_SECRET || "").trim();
};

/* Cuánto vive un ticket. Corto a propósito: si alguien lo roba de la
   barra del navegador, sirve durante muy poco. */
const SEGUNDOS_TICKET = 60;

/* Cuánto margen se deja al token de Supabase. Caduca a la hora, así
   que si le quedan menos de 2 minutos hay que renovarlo ANTES de
   firmar, no después: si no, el ticket llega vivo al servicio pero con
   un token que muere al llegar. */
const MARGEN_TOKEN_MS = 2 * 60 * 1000;

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function b64urlDecode(str) {
  return Buffer.from(str, "base64url");
}

/* ------------------------------------------------------------
   Firmar
   ------------------------------------------------------------ */

/**
 * Crea un ticket para pasar al control de un cliente.
 *
 * @param {object} opts
 * @param {string} opts.secret   SERVICE_SECRET
 * @param {object} opts.sesion   Fila de `sessions` del usuario
 * @param {string} opts.userId
 * @param {string} [opts.clientId]  null si es staff
 * @param {string} opts.rol      'staff' | 'client'
 * @param {string} opts.accessToken  Access token VIGENTE de Supabase
 * @param {string} [opts.motivo]  Por qué entra staff. Solo staff.
 * @param {number} [opts.segundos]
 * @returns {string}  El ticket, listo para poner en la URL
 */
function firmar(opts) {
  const secret = opts.secret || secretPorDefecto();
  if (!secret) throw new Error("tickets: falta SERVICE_SECRET");

  /* El token tiene que existir. Sin él el servicio receptor no puede
     reconstruir la sesión y RLS no puede funcionar, así que es mejor
     fallar aquí, al firmar, que allí con un error críptico. */
  if (!opts.accessToken) {
    throw new Error(
      "tickets: hace falta un access_token vigente. " +
        "Llama antes a tokenVigente() para renovarlo si caducó."
    );
  }

  const ahora = Math.floor(Date.now() / 1000);
  const segundos = opts.segundos || SEGUNDOS_TICKET;
  const payload = {
    uid: opts.userId,
    cid: opts.clientId || null,
    rol: opts.rol,
    /* La sesión de la que viene, para poder auditar y revocar. */
    sid: (opts.sesion && opts.sesion.id) || null,
    at: opts.accessToken,
    exp: ahora + segundos,
    /* Un valor único por ticket: aunque se firmen dos idénticos en el
       mismo segundo, no son el mismo ticket. */
    jti: crypto.randomBytes(9).toString("base64url"),
  };

  /* Por qué entra un member del equipo, SOLO si es staff.
     Se añade al final y no se firma aparte: va dentro del cuerpo, así
     que si alguien lo cambia a mano la firma deja de cuadrar. Es texto
     que el panel escribió, y el bot lo guarda tal cual. */
  if (opts.rol === "staff" && opts.motivo) {
    payload.mot = String(opts.motivo).trim().slice(0, 200);
  }

  const cuerpo = b64url(JSON.stringify(payload));
  return cuerpo + "." + firma(cuerpo, secret);
}

function firma(cuerpo, secret) {
  return crypto.createHmac("sha256", secret).update(cuerpo).digest("base64url");
}

/* ------------------------------------------------------------
   Verificar
   ------------------------------------------------------------ */

/**
 * Valida un ticket. NO lanza: devuelve null si algo no cuadra.
 *
 * Que devuelva null en vez de lanzar es a propósito: un ticket
 * manipulado es un evento normal (alguien que cambia un carácter por
 * curiosidad, un escáner, un enlace caducado). El servicio que lo
 * llama decide qué hacer con eso, normalmente redirigir al login.
 *
 * @returns {object|null}  El payload, o null
 */
function verificar(ticket, secretParam) {
  const secret = secretParam || secretPorDefecto();
  if (!secret) return null;
  if (!ticket || typeof ticket !== "string") return null;

  const corte = ticket.lastIndexOf(".");
  if (corte < 1) return null;

  const cuerpo = ticket.slice(0, corte);
  const firmaRecibida = ticket.slice(corte + 1);
  if (!firmaRecibida) return null;

  /* La firma se comprueba ANTES de mirar el contenido. Si no, alguien
     podría mandar un payload arbitrario y que lo deserialicemos antes
     de comprobar nada. */
  const esperada = firma(cuerpo, secret);
  if (!comparacionSegura(firmaRecibida, esperada)) return null;

  let payload;
  try {
    payload = JSON.parse(b64urlDecode(cuerpo).toString("utf8"));
  } catch {
    return null;
  }

  /* Comprobaciones de forma. Que la firma cuadre no significa que el
     contenido sea lo que creemos: alguien con el secret podría haber
     firmado otra cosa. */
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.uid !== "string" || !payload.uid) return null;
  if (payload.rol !== "staff" && payload.rol !== "client") return null;
  if (typeof payload.exp !== "number") return null;

  /* Caducado. Con 5 s de margen: un ticket que expira justo mientras
     el servicio lo procesa no sirve de nada. */
  if (payload.exp + 5 < Math.floor(Date.now() / 1000)) return null;

  return payload;
}

/** Comparación en tiempo constante, sin filtrar por longitud */
function comparacionSegura(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * ¿Caduca pronto el access_token del ticket?
 *
 * Se comprueba ANTES de firmar, no después: si se firma con un token a
 * punto de expirar, el ticket llega vivo pero el servicio no puede
 * reconstruir la sesión y devuelve un error que no explica el motivo.
 */
function tokenPorExpirar(accessToken, margenMs = MARGEN_TOKEN_MS) {
  if (!accessToken) return true;
  try {
    const partes = String(accessToken).split(".");
    if (partes.length !== 3) return true;
    const payload = JSON.parse(b64urlDecode(partes[1]).toString("utf8"));
    if (!payload.exp) return true;
    return payload.exp * 1000 - Date.now() < margenMs;
  } catch {
    /* Si no se puede leer, se asume caducado: mejor renovar de más. */
    return true;
  }
}

/**
 * Extrae el access_token de un ticket ya verificado.
 * Es lo que se pasa a supabase.getClientForToken() para que RLS
 * decida, en lugar de filtrar por client_id en el código.
 */
const tokenDe = (payload) => (payload && payload.at) || "";

module.exports = {
  firmar,
  verificar,
  tokenPorExpirar,
  tokenDe,
  comparacionSegura,
  SEGUNDOS_TICKET,
  MARGEN_TOKEN_MS,
};
