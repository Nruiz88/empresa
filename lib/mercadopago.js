/* =========================================================
   Shopcito — Cliente de MercadoPago
   ------------------------------------------------------------
   Lo único que sabe hablar con la API de MercadoPago. Se usa desde
   tres sitios y por eso vive aquí y no dentro de una ruta:

     · /panel/configuracion   guarda y PRUEBA las credenciales;
     · el portal del cliente  crea la suscripción y manda a pagar;
     · el webhook (/mp/webhook) lee el pago y confirma.

   ── LAS TRES REGLAS, LAS MISMAS QUE evolution.js ──
   1. Las credenciales NUNCA salen de aquí hacia una vista.
   2. Todo tiene tiempo límite. MercadoPago lento no puede colgar una
      pantalla del portal.
   3. Los errores se devuelven, no se lanzan: quien llama tiene que
      poder escribir "MercadoPago rechazó la clave" en pantalla.

   ── CÓMO SE COBRA ──
   Suscripción (preapproval) "sin plan asociado": se manda el motivo, el
   correo del pagador y la recurrencia, y MercadoPago devuelve un
   `init_point` al que se redirige al cliente. Ahí autoriza la tarjeta
   UNA vez y, a partir de ahí, MercadoPago cobra solo cada mes.
   ========================================================= */

const crypto = require("crypto");

/** Base de la API. Una sola, la misma para test y producción: lo que
    cambia es el Access Token, no la URL. */
const URL_API = "https://api.mercadopago.com";

/** Cuánto se espera a MercadoPago antes de darlo por caído. */
const TIMEOUT_MS = 12000;

/**
 * Las credenciales de MercadoPago, tal como están guardadas.
 *
 * @param {object} db
 * @returns {Promise<object|null>} la fila de `integraciones`, o null
 */
async function leerConfig(db) {
  const { data, error } = await db
    .from("integraciones")
    .select("clave,activo,modo,access_token,public_key,webhook_secret")
    .eq("clave", "mercadopago")
    .maybeSingle();

  if (error) {
    console.error("[mercadopago] no se pudo leer la configuración: " + error.message);
    return null;
  }
  return data || null;
}

/**
 * ¿Está lista la integración para usarse?
 *
 * @param {object|null} config
 * @returns {{ok: boolean, motivo: string}}
 */
function estaLista(config) {
  if (!config) return { ok: false, motivo: "MercadoPago no está configurado." };
  if (!config.activo) return { ok: false, motivo: "MercadoPago está desactivado en Configuración." };
  if (!config.access_token) return { ok: false, motivo: "Falta el Access Token en Configuración." };
  return { ok: true, motivo: "" };
}

/** El texto del error que devuelve MercadoPago.
 *
 *  Viene en varias formas: `message` texto, `error` texto, y `cause`
 *  como lista de objetos con `description`. Se saca lo que sea texto y,
 *  si no hay nada, el número. */
function mensajeDeError(data, status) {
  if (data && typeof data === "object") {
    if (typeof data.message === "string" && data.message) return data.message;
    if (typeof data.error === "string" && data.error) return data.error;
    if (Array.isArray(data.cause) && data.cause[0]) {
      const c = data.cause[0];
      if (typeof c.description === "string" && c.description) return c.description;
      if (typeof c.message === "string" && c.message) return c.message;
      if (typeof c.code === "string" && c.code) return c.code;
    }
  }
  return "MercadoPago respondió " + status;
}

/**
 * Una llamada a la API de MercadoPago.
 *
 * @param {object} config  La fila de `integraciones`
 * @param {string} ruta     Empezando por /
 * @param {object} [opciones] { method, body, timeoutMs }
 * @returns {Promise<{ok: boolean, status: number|null, data: any, mensaje: string}>}
 */
async function pedir(config, ruta, opciones = {}) {
  const { method = "GET", body, timeoutMs = TIMEOUT_MS } = opciones;

  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), timeoutMs);

  try {
    const res = await fetch(URL_API + ruta, {
      method,
      headers: {
        Authorization: "Bearer " + String((config && config.access_token) || ""),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: control.signal,
      cache: "no-store",
    });

    const crudo = await res.text();
    let data = null;
    if (crudo) {
      try {
        data = JSON.parse(crudo);
      } catch {
        data = crudo;
      }
    }

    if (!res.ok) {
      return { ok: false, status: res.status, data, mensaje: mensajeDeError(data, res.status) };
    }
    return { ok: true, status: res.status, data, mensaje: "" };
  } catch (err) {
    if (control.signal.aborted) {
      return {
        ok: false,
        status: null,
        data: null,
        mensaje: "MercadoPago no respondió en " + Math.round(timeoutMs / 1000) + " s",
      };
    }
    return {
      ok: false,
      status: null,
      data: null,
      mensaje: "No se pudo contactar con MercadoPago: " + (err && err.message ? err.message : "error de red"),
    };
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * ¿La credencial vale?
 *
 * `GET /users/me` devuelve 200 con el usuario dueño del token y 401 si
 * la clave no sirve. Es lo que distingue "la clave está mal" de
 * "MercadoPago está caído", que se arreglan distinto.
 *
 * @param {object} config
 * @returns {Promise<{ok: boolean, status: number|null, data: any, mensaje: string}>}
 */
async function probar(config) {
  if (!config || !config.access_token) {
    return { ok: false, status: null, data: null, mensaje: "Falta el Access Token." };
  }

  const r = await pedir(config, "/users/me", { timeoutMs: 15000 });
  if (!r.ok && (r.status === 401 || r.status === 403)) {
    return Object.assign({}, r, { mensaje: "MercadoPago rechazó el Access Token." });
  }
  if (r.ok) {
    const u = r.data || {};
    return { ok: true, status: r.status, data: { id: u.id, nickname: u.nickname, email: u.email }, mensaje: "" };
  }
  return r;
}

/**
 * Crea una suscripción (preapproval) y devuelve a dónde mandar al cliente.
 *
 * ── POR QUÉ SIN PLAN ASOCIADO ──
 *
 * Porque el precio lo tenemos en `services.importe`, que puede ser
 * distinto por cliente. Con un plan de MercadoPago el monto iría atado
 * al plan, y un cliente grande con precio propio no podría tenerlo.
 *
 * @param {object} config
 * @param {{reason: string, externalReference: string, payerEmail: string,
 *          monto: number, moneda: string, frecuencia: number,
 *          tipoFrecuencia: string, backUrl: string}} datos
 * @returns {Promise<{ok: boolean, status: number|null, data: any, mensaje: string}>}
 */
function crearPreapproval(config, datos) {
  return pedir(config, "/preapproval", {
    method: "POST",
    body: {
      reason: datos.reason,
      external_reference: String(datos.externalReference),
      payer_email: datos.payerEmail,
      back_url: datos.backUrl,
      status: "pending",
      auto_recurring: {
        frequency: datos.frecuencia || 1,
        frequency_type: datos.tipoFrecuencia || "months",
        transaction_amount: Number(datos.monto),
        currency_id: datos.moneda || "ARS",
      },
    },
  });
}

/** Una suscripción por su id. */
function leerPreapproval(config, id) {
  return pedir(config, "/preapproval/" + encodeURIComponent(id));
}

/** Un pago autorizado (el cargo mensual de una suscripción). */
function leerPagoAutorizado(config, id) {
  return pedir(config, "/authorized_payments/" + encodeURIComponent(id));
}

/** Un pago suelto (por si algún día se cobra sin suscripción). */
function leerPago(config, id) {
  return pedir(config, "/v1/payments/" + encodeURIComponent(id));
}

/**
 * ¿La notificación la mandó de verdad MercadoPago?
 *
 * ── EL ALGORITMO (documentación oficial, "sin SDKs") ──
 *
 * El header `x-signature` trae `ts=<segundos>,v1=<hmac>`. Se arma un
 * "manifest" con el id del recurso y el request-id:
 *
 *     id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 *
 * y se calcula HMAC-SHA256 con la CLAVE SECRETA del webhook. Si el
 * resultado no es igual a `v1`, la notificación es falsa y se descarta.
 * Sin esto, cualquiera con la URL podría marcar pagos que no existen.
 *
 * @param {{xSignature: string, xRequestId: string, dataId: string, secret: string}} p
 * @returns {boolean}
 */
function verificarFirma(p) {
  const firma = String((p && p.xSignature) || "");
  const secreto = String((p && p.secret) || "");
  if (!firma || !secreto) return false;

  const partes = {};
  for (const trozo of firma.split(",")) {
    const i = trozo.indexOf("=");
    if (i > 0) partes[trozo.slice(0, i).trim()] = trozo.slice(i + 1).trim();
  }

  const ts = partes.ts;
  const v1 = partes.v1;
  if (!ts || !v1) return false;

  /* Se incluyen solo las partes que llegan. MercadoPago documenta que
     si un valor no está, su tramo se omite (y el `;` se mantiene). */
  let manifiesto = "";
  if (p.dataId) manifiesto += "id:" + p.dataId + ";";
  if (p.xRequestId) manifiesto += "request-id:" + p.xRequestId + ";";
  manifiesto += "ts:" + ts + ";";

  const esperado = crypto.createHmac("sha256", secreto).update(manifiesto).digest("hex");

  /* Comparación en tiempo constante: un `!==` filtra por el tiempo
     cuántos caracteres acertó quien prueba firmas. */
  const a = Buffer.from(esperado);
  const b = Buffer.from(v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  URL_API,
  TIMEOUT_MS,
  leerConfig,
  estaLista,
  pedir,
  probar,
  crearPreapproval,
  leerPreapproval,
  leerPagoAutorizado,
  leerPago,
  verificarFirma,
  mensajeDeError,
};
