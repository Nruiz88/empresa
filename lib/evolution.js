/* =========================================================
   Nexo Studio — Cliente de Evolution API
   ------------------------------------------------------------
   Evolution API es la caja donde viven los números de WhatsApp.
   Este fichero es lo único que sabe hablar con ella.

   POR QUÉ EXISTE Y POR QUÉ NO SE USA EL DEL BOT
   ----------------------------------------------
   La otra implementación está en D:\webs\wweb, en
   src/lib/evolution-multi.ts, y funciona. Está en TypeScript, dentro del
   servicio del bot, y ese servicio corre en otro proceso y otro
   subdominio. El panel no puede importarla: no comparten runtime.

   Se podría haber llamado al bot por HTTP, pero para probar una caja o
   crearle una instancia no hace falta el intermediario, y pagarla de
   más significa que un alta de bot depende de que el bot esté
   levantado. Este fichero va a la caja directamente, con la url y la
   clave que están en `evolution_servers`.

   ── LAS TRES REGLAS ──
   1. La clave NUNCA sale de aquí hacia una vista. Estas funciones
      devuelven datos de Evolution, no la clave.
   2. Todo tiene tiempo límite. Una caja caída deja una petición colgada
      hasta que el proxy se dé por vencido, y una pantalla de panel que
      no carga es indistinguible de un panel roto.
   3. Los errores se devuelven, no se lanzan. El panel tiene que poder
      escribir "la caja no responde" en la pantalla, y eso necesita el
      motivo, no una excepción.

   ── LO QUE NO HACE ESTE FICHERO ──
   No manda mensajes ni toca respuestas: eso es el motor del bot. Aquí
   solo se crea la instancia, se le engancha el webhook y se pregunta
   cómo está.
   ========================================================= */

/** Cuánto se espera a una caja antes de darla por perdida. */
const TIMEOUT_MS = 8000;

/** Los eventos que hacen falta.
    MESSAGES_UPSERT es el que dispara el bot: el mensaje que llega.
    Los otros dos son para que el panel vea si el número se conectó o se
    cayó.
    NO está MESSAGES_DOWNLOAD (el multimedia): Evolution lo rechaza con
    un 400 y, como el resultado no se miraba, el fallo pasaba
    desapercibido y el webhook se quedaba como estaba. */
const EVENTOS = ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"];

/**
 * @typedef {object} Resultado
 * @property {boolean}  ok       ¿La caja respondió bien?
 * @property {number|null} status Código HTTP, o null si no hubo respuesta
 * @property {any}      data     Lo que devolvió la caja (ya interpretado)
 * @property {string}   mensaje  Por qué falló, en castellano y sin secretos
 */

/**
 * Una llamada a Evolution.
 *
 * @param {string} url    Base de la caja, sin barra final
 * @param {string} clave  La clave de la caja (cabecera `apikey`)
 * @param {string} ruta   Ruta dentro de la caja, empezando por /
 * @param {object} [opciones] { method, body, cabeceras, timeoutMs }
 * @returns {Promise<Resultado>}
 */
async function pedir(url, clave, ruta, opciones = {}) {
  const { method = "GET", body, cabeceras = {}, timeoutMs = TIMEOUT_MS } = opciones;

  const cabecerasFinales = { ...cabeceras, apikey: clave };
  if (body !== undefined) cabecerasFinales["Content-Type"] = "application/json";

  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), timeoutMs);

  try {
    const res = await fetch(String(url).replace(/\/+$/, "") + ruta, {
      method,
      headers: cabecerasFinales,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: control.signal,
      cache: "no-store",
    });

    const crudo = await res.text();
    /* Evolution devuelve 200 con el cuerpo vacío en varios sitios (por
       ejemplo al desconectar). Un JSON.parse de "" revienta, y el fallo
       parecería un error de la caja cuando lo que pasó es que todo fue
       bien. */
    let data = null;
    if (crudo) {
      try {
        data = JSON.parse(crudo);
      } catch {
        data = crudo;
      }
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        data,
        mensaje: mensajeDeError(data, res.status),
      };
    }

    return { ok: true, status: res.status, data, mensaje: "" };
  } catch (err) {
    if (control.signal.aborted) {
      return {
        ok: false,
        status: null,
        data: null,
        mensaje: "La caja no respondió en " + Math.round(timeoutMs / 1000) + " s",
      };
    }
    return {
      ok: false,
      status: null,
      data: null,
      mensaje:
        "No se pudo contactar con la caja: " + (err && err.message ? err.message : "error de red"),
    };
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * El texto que trae la caja cuando contesta con error.
 *
 * Viene en tres formas según la versión: `message` como texto,
 * `message` como lista de textos, o nada en absoluto. Solo se coge lo
 * que sea texto: si `message` fuera un objeto, ponerlo tal cual acabaría
 * impreso como "[object Object]" en la pantalla del panel.
 *
 * @param {any} data
 * @param {number} status
 * @returns {string}
 */
function mensajeDeError(data, status) {
  if (data && typeof data === "object") {
    if (typeof data.message === "string" && data.message) return data.message;
    if (Array.isArray(data.message) && typeof data.message[0] === "string") return data.message[0];
    if (typeof data.error === "string" && data.error) return data.error;
    if (Array.isArray(data.response) && typeof data.response[0] === "object") {
      /* Las v2 recientes envuelven el error en `response[].message`. */
      const r = data.response[0];
      if (typeof r.message === "string" && r.message) return r.message;
      if (typeof r.error === "string" && r.error) return r.error;
    }
  }
  return "Evolution respondió " + status;
}

/**
 * ¿Es una URL que se puede dar de alta como caja?
 *
 * No es una comprobación de seguridad: quien da de alta una caja es del
 * equipo y puede escribir lo que quiera. Es para que un error de dedo (un
 * espacio, "https:/api...", un host sin esquema) se diga en el
 * formulario y no después, con el bot ya creado y sin poder hablar con
 * la caja.
 *
 * @param {string} url
 * @returns {string|null} El motivo, o null si está bien
 */
function problemaDeUrl(url) {
  const s = String(url || "").trim();
  if (!s) return "Falta la dirección de la caja.";
  if (!/^https?:\/\//i.test(s)) return "La dirección tiene que empezar por http:// o https://";
  if (/\s/.test(s)) return "La dirección no puede tener espacios.";
  try {
    const u = new URL(s);
    if (!u.hostname) return "La dirección no tiene un dominio.";
  } catch {
    return "La dirección no es válida.";
  }
  return null;
}

/**
 * Comprueba que la caja responde y que la clave vale.
 *
 * `GET /instance/fetchInstances` es el endpoint que devuelve 200 con la
 * lista de instancias si la clave es correcta, y 401 si no lo es. Es lo
 * único que distingue "la caja está caída" de "la clave está mal", que
 * son dos problemas distintos y merecen mensajes distintos.
 *
 * @param {string} url
 * @param {string} clave
 * @returns {Promise<Resultado>} con `data.instancias` = cuántas hay
 */
async function probar(url, clave) {
  const problema = problemaDeUrl(url);
  if (problema) return { ok: false, status: null, data: null, mensaje: problema };
  if (!clave) return { ok: false, status: null, data: null, mensaje: "Falta la clave de la caja." };

  const r = await pedir(url, clave, "/instance/fetchInstances", { timeoutMs: 12000 });
  if (!r.ok) {
    /* El 401/403 casi siempre es la clave. Decirlo ahorra el viaje de
       buscar el motivo en otro sitio, y no revela nada: quien está en
       esta pantalla ya puede ver y editar la clave. */
    if (r.status === 401 || r.status === 403) {
      return Object.assign({}, r, { mensaje: "La caja respondió pero rechazó la clave" });
    }
    return r;
  }

  const lista = instanciasDe(r.data);
  return { ok: true, status: r.status, data: { instancias: lista.length }, mensaje: "" };
}

/**
 * La lista de instancias, venga como venga.
 *
 * @param {any} data
 * @returns {Array<object>}
 */
function instanciasDe(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.response)) return data.response;
  return [];
}

/**
 * Las instancias que hay en la caja, con su número y su estado.
 *
 * Sirve para dos cosas: pintar cuántos números hay de verdad (que no son
 * necesariamente los de nuestra base: alguien pudo crear uno a mano en
 * el panel de Evolution) y saber si un número está enlazado.
 *
 * @param {string} url
 * @param {string} clave
 * @returns {Promise<Resultado>} con `data.lista`
 */
async function listarInstancias(url, clave) {
  const r = await pedir(url, clave, "/instance/fetchInstances", { timeoutMs: 12000 });
  if (!r.ok) return r;
  const lista = instanciasDe(r.data);
  return {
    ok: true,
    status: r.status,
    data: {
      lista: lista.map((i) => ({
        nombre: i && i.name ? i.name : "(sin nombre)",
        estado: (i && (i.connectionStatus || i.state)) || "unknown",
        numero: i && i.ownerJid ? String(i.ownerJid).replace("@s.whatsapp.net", "") : "",
      })),
    },
    mensaje: "",
  };
}

/**
 * Crea la instancia en la caja.
 *
 * Evolution v2 quiere `POST /instance/create` con el nombre en el cuerpo;
 * la v1, `POST /instance/create/{nombre}`. Se prueba la v2 y, si la caja
 * contesta 404/405/400, se cae a la v1. Sin ese segundo intento, contra
 * una caja v1 el alta del bot fallaría siempre con un 404 que no dice
 * nada de la causa.
 *
 * @param {string} url
 * @param {string} clave
 * @param {string} nombre
 * @returns {Promise<Resultado>}
 */
async function crearInstancia(url, clave, nombre) {
  const v2 = await pedir(url, clave, "/instance/create", {
    method: "POST",
    body: {
      instanceName: nombre,
      integration: "WHATSAPP-BAILEYS",
      /* Sin esto la caja no genera el QR, y sin QR el cliente no puede
         enlazar su número desde su portal. */
      qrcode: true,
    },
  });

  const v1Posible = v2.status === 404 || v2.status === 405 || v2.status === 400;
  if (!v2.ok && v1Posible) {
    return pedir(url, clave, "/instance/create/" + encodeURIComponent(nombre), {
      method: "POST",
      body: {},
    });
  }

  return v2;
}

/**
 * Engancha el webhook del bot a la instancia.
 *
 * `byEvents: true` no es opcional: con `false`, Evolution IGNORA lo que
 * se guarda aquí y usa su configuración global, y devuelve 200 con lo
 * que se le mandó. Lo que se guarda por instancia es lo único que sirve
 * cuando hay varias instancias en la misma caja, que es exactamente el
 * caso de una caja compartida.
 *
 * @param {string} url
 * @param {string} clave
 * @param {string} nombre
 * @param {string} urlWebhook  A dónde tiene que llamar la caja
 * @param {object} [cabeceras] Cabeceras extra (el secreto)
 * @returns {Promise<Resultado>}
 */
function engancharWebhook(url, clave, nombre, urlWebhook, cabeceras) {
  return pedir(url, clave, "/webhook/set/" + encodeURIComponent(nombre), {
    method: "POST",
    body: {
      webhook: {
        enabled: true,
        url: urlWebhook,
        events: EVENTOS,
        headers: cabeceras || {},
        byEvents: true,
        base64: false,
      },
    },
  });
}

/**
 * Lo que la caja tiene CONFIGURADO de verdad para una instancia.
 *
 * Existe por lo mismo que el resto: `POST /webhook/set` devuelve 200 con
 * lo que se le mandó, así que "lo escribí y me dijo bien" no prueba
 * nada. Y la configuración vive dentro de la instancia: si se recrea o
 * la caja se reinstala, se pierde sin que ninguna parte avise. Por eso
 * se LEE, y no solo se escribe.
 *
 * @param {string} url
 * @param {string} clave
 * @param {string} nombre
 * @returns {Promise<Resultado>}
 */
function leerWebhook(url, clave, nombre) {
  return pedir(url, clave, "/webhook/fetchWebhook/" + encodeURIComponent(nombre), {
    timeoutMs: 12000,
  });
}

/**
 * El estado del número: "open", "close", "connecting", "qrcode"...
 *
 * Evolution lo devuelve en varias formas (texto pelado, objeto con
 * `state`, objeto con `instance.state`), y a veces devuelve algo que no
 * es ninguno de los estados conocidos. Por eso sale el dato TAL CUAL y
 * decide quien lo pinte: la base guarda texto libre (migración 011)
 * precisamente para no perder el diagnóstico.
 *
 * @param {string} url
 * @param {string} clave
 * @param {string} nombre
 * @returns {Promise<Resultado>} con `data.estado`
 */
async function estadoConexion(url, clave, nombre) {
  const r = await pedir(url, clave, "/instance/connectionState/" + encodeURIComponent(nombre), {
    timeoutMs: 12000,
  });
  if (!r.ok) return r;

  const d = r.data;
  let estado = null;
  if (typeof d === "string") {
    estado = d;
  } else if (d && typeof d === "object") {
    if (typeof d.state === "string") estado = d.state;
    else if (d.instance && typeof d.instance === "object" && typeof d.instance.state === "string") {
      estado = d.instance.state;
    }
  }

  return { ok: true, status: r.status, data: { estado: estado || "unknown" }, mensaje: "" };
}

/**
 * Reinicia la instancia.
 *
 * El caso real: la caja estaba dormida y el número aparece caído.
 * Reiniciar lo levanta sin que el cliente tenga que volver a escanear el
 * QR.
 *
 * @param {string} url
 * @param {string} clave
 * @param {string} nombre
 * @returns {Promise<Resultado>}
 */
function reiniciar(url, clave, nombre) {
  return pedir(url, clave, "/instance/restart/" + encodeURIComponent(nombre), { method: "PUT" });
}

/**
 * Desconecta el número (equivale a "desvincular dispositivo").
 *
 * @param {string} url
 * @param {string} clave
 * @param {string} nombre
 * @returns {Promise<Resultado>}
 */
function desconectar(url, clave, nombre) {
  return pedir(url, clave, "/instance/logout/" + encodeURIComponent(nombre), { method: "DELETE" });
}

module.exports = {
  pedir,
  problemaDeUrl,
  probar,
  listarInstancias,
  instanciasDe,
  crearInstancia,
  engancharWebhook,
  leerWebhook,
  estadoConexion,
  reiniciar,
  desconectar,
  EVENTOS,
  TIMEOUT_MS,
};