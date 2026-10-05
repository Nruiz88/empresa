/* =========================================================
   Nexo Studio — Cliente de Evolution API
   ------------------------------------------------------------
   Evolution API es el servicio que conecta el número de WhatsApp.
   No está en este repo: corre aparte (en tu caso, en Railway) y solo
   se le habla por HTTP. Este módulo es el único que sabe cómo.

   POR QUÉ NO ES UN `fetch` SUELTO EN CADA RUTA
   ---------------------------------------------
   Hay cuatro cosas que hay que hacer SIEMPRE igual y que son fáciles
   de hacer mal en un sitio y bien en otro:

     1. La autenticación va en una cabecera `apikey`, no en
        Authorization. Es lo más fácil de equivocarse sin avisar.
     2. evolution_servers guarda la CLAVE. Esta función NUNCA la
        imprime ni la devuelve en el error: un `console.log(err)`
        cualquiera puede acabar con la clave de Evolution en un log.
     3. Una petición sin timeout se queda colgada si el servidor no
        contesta, y el usuario ve el botón "Guardando…"
        indefinidamente. Todo tiene AbortController.
     4. Evolution responde 200 con cuerpo vacío o no-JSON en varios
        endpoints. Un `res.json()` a palo reventaría con un error
        desconcertante en lo que sí funcionó.

   Patrón heredado de `wweb/src/lib/evolution-multi.ts`, que ya lo
   tiene en producción contra el mismo servidor. Los nombres de las
   funciones se mantienen para que las dos copias se puedan leer en
   paralelo mientras coexistan.
   ========================================================= */

const SUPABASE = require("./supabase");

/* Tiempos por defecto. Se pueden pasar a mano para operaciones que se
   sabe lentas: con grupos, `fetchAllGroups` tarda 25s o más
   (EvolutionAPI#1883).

   Los 8 s normales son holgados para lo que se hace aquí (crear
   instancia, leer estado, poner webhook). No son para dormir: el
   servidor va en plan de pago y no hiberna, así que un timeout muy
   largo solo serviría para dejar al usuario mirando un botón. */
const TIMEOUT_POR_DEFECTO = 8000;
const TIMEOUT_ENVIO = 40000;

/**
 * Quita la clave de un texto.
 *
 * El mensaje de error lo pone el servidor remoto, y no es de fiar:
 * si un intermediario (proxy, gateway, el propio Evolution con un
 * error mal construido) devuelve un 401 que incluye lo que le
 * mandamos, ese texto acaba en el log del panel y en la pantalla de
 * quien está diagnosticando. La clave de Evolution da acceso al
 * WhatsApp del cliente.
 *
 * No se descarta el mensaje entero porque eso sí quitaría la única
 * pista útil cuando algo falla. Se sustituye la clave concreta, que
 * es lo que sabemos que no debe aparecer.
 */
function sinClave(texto, apiKey) {
  const s = String(texto == null ? "" : texto);
  if (!apiKey) return s;
  return s.split(apiKey).join("«clave»");
}

/**
 * Una petición a Evolution.
 *
 * NUNCA lanza: devuelve siempre `{ ok, status, data }` o
 * `{ ok: false, status, message }`. Lanzar obligaría a un try/catch
 * en cada ruta, y en un sitio se olvidaría: entonces un timeout del
 * servidor se convierte en un 500 que no explica nada.
 *
 * @param {string} url        Base del servidor, sin barra final
 * @param {string} apiKey
 * @param {string} ruta       Empieza por "/"
 * @param {object} [opciones] { method, body, headers, timeout }
 * @returns {Promise<{ok:boolean,status:number|null,data?:any,message?:string}>}
 */
async function pedir(url, apiKey, ruta, opciones = {}) {
  const { method = "GET", body, headers: extra = {}, timeout = TIMEOUT_POR_DEFECTO } = opciones;

  /* La clave va en `apikey`. Si algún día se pone aquí el resultado
     de leerla mal, el error tiene que decirlo sin imprimirla. */
  if (!url || !apiKey) {
    return {
      ok: false,
      status: null,
      message: "El servidor de Evolution no está configurado (falta url o api_key).",
    };
  }

  const cabeceras = { apikey: apiKey, "Content-Type": "application/json", ...extra };

  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), timeout);

  try {
    const res = await fetch(String(url).replace(/\/+$/, "") + ruta, {
      method,
      headers: cabeceras,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: controlador.signal,
    });

    const texto = await res.text();

    /* Varios endpoints responden 200/201 con cuerpo vacío o texto
       plano. `res.json()` a pelo lanzaría aquí, y ya se habría
       enviado el mensaje. */
    let datos = null;
    if (texto) {
      try {
        datos = JSON.parse(texto);
      } catch {
        datos = texto;
      }
    }

    if (!res.ok) {
      /* Se busca `message` porque es lo que devuelve Evolution, pero
         el cuerpo puede no ser JSON o no traer ese campo. Y en
         cualquier caso pasa por sinClave(): lo ha escrito el remoto. */
      const mensaje =
        datos && typeof datos === "object" && typeof datos.message === "string"
          ? datos.message
          : "Evolution API respondió " + res.status;
      return { ok: false, status: res.status, message: sinClave(mensaje, apiKey) };
    }

    return { ok: true, status: res.status, data: datos };
  } catch (err) {
    if (controlador.signal.aborted) {
      return {
        ok: false,
        status: null,
        message: "Evolution API no respondió en " + timeout + " ms",
      };
    }
    return {
      ok: false,
      status: null,
      message: "No se pudo hablar con Evolution API: " + (err && err.message ? err.message : "error de red"),
    };
  } finally {
    clearTimeout(temporizador);
  }
}

/**
 * Carga un servidor de Evolution de la tabla.
 *
 * Va CON LA SECRET KEY a propósito: el `api_key` de Evolution no es
 * un dato del cliente, es una credencial de infraestructura que el
 * usuario de un cliente no debe poder leer nunca. Por eso esta tabla
 * tiene RLS a cero políticas: solo la llega a leer el servidor.
 *
 * Devuelve `{ ok, server }` para que quien llama no tenga que
 * distinguir "no existe" de "falló la consulta".
 *
 * @param {string} id  uuid de evolution_servers
 */
async function servidor(id) {
  const { data, error } = await SUPABASE.getAdmin()
    .from("evolution_servers")
    .select("id,name,url,api_key")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return { ok: false, message: "No se pudo leer el servidor de Evolution: " + error.message };
  }
  if (!data) {
    return { ok: false, message: "El servidor de Evolution " + id + " no existe." };
  }
  return { ok: true, server: data };
}

/** ¿Llega el servidor? No crea nada: solo comprueba que responde. */
function probarConexion(url, apiKey) {
  return pedir(url, apiKey, "/instance/fetchInstances");
}

function conectar(url, apiKey, instancia) {
  return pedir(url, apiKey, "/instance/connect/" + encodeURIComponent(instancia) + "?number=");
}

function estadoDeConexion(url, apiKey, instancia) {
  return pedir(url, apiKey, "/instance/connectionState/" + encodeURIComponent(instancia));
}

function cerrarSesion(url, apiKey, instancia) {
  return pedir(url, apiKey, "/instance/logout/" + encodeURIComponent(instancia), { method: "DELETE" });
}

function reiniciar(url, apiKey, instancia) {
  return pedir(url, apiKey, "/instance/restart/" + encodeURIComponent(instancia), { method: "PUT" });
}

/**
 * Crea una instancia.
 *
 * Evolution cambió el endpoint entre versiones: la v2 toma el
 * `instanceName` en el cuerpo de POST /instance/create, y la v1 lo
 * lleva en la ruta. Se prueban las dos. Si no, un despliegue con la
 * versión vieja falla con un 404 que no dice nada de versiones.
 */
function crearInstancia(url, apiKey, instancia) {
  return pedir(url, apiKey, "/instance/create", {
    method: "POST",
    body: { instanceName: instancia, integration: "WHATSAPP-BAILEYS", qrcode: true },
  }).then((v2) => {
    if (!v2.ok && [400, 404, 405].includes(v2.status)) {
      return pedir(url, apiKey, "/instance/create/" + encodeURIComponent(instancia), {
        method: "POST",
        body: {},
      });
    }
    return v2;
  });
}

/**
 * Apunta los webhooks de la instancia a una URL nuestra.
 *
 * `events` decide qué llega: si no se es explícito, Evolution manda
 * de todo y se llena `bots_webhook_logs` con estados que no
 * interessan. Es un filtro de coste, no solo de ruido.
 */
function ponerWebhook(url, apiKey, instancia, webhookUrl, eventos, cabeceras = {}) {
  return pedir(url, apiKey, "/webhook/set/" + encodeURIComponent(instancia), {
    method: "POST",
    body: {
      webhook: {
        enabled: true,
        url: webhookUrl,
        events: eventos,
        headers: cabeceras,
        byEvents: false,
        base64: false,
      },
    },
  });
}

/**
 * Manda un texto.
 *
 * El timeout es largo a propósito: enviar a un número que no
 * responde se queda esperando, y con los 8 s por defecto se marcaría
 * como fallo cuando en realidad el mensaje había salido.
 */
function enviarTexto(url, apiKey, instancia, numero, texto, retraso) {
  const body = { number: numero, text: texto };
  if (typeof retraso === "number" && retraso >= 0) body.delay = retraso;

  return pedir(url, apiKey, "/message/sendText/" + encodeURIComponent(instancia), {
    method: "POST",
    body,
    timeout: TIMEOUT_ENVIO,
  });
}

/** Botones de respuesta, hasta 3. */
function enviarBotones(url, apiKey, instancia, numero, titulo, descripcion, botones, pie, retraso) {
  const body = {
    number: numero,
    title: titulo,
    description: descripcion,
    footer: pie || "",
    buttons: botones.map((b) => ({ type: b.type || "reply", displayText: b.displayText, id: b.id })),
  };
  if (typeof retraso === "number" && retraso >= 0) body.delay = retraso;

  return pedir(url, apiKey, "/message/sendButtons/" + encodeURIComponent(instancia), {
    method: "POST",
    body,
    timeout: TIMEOUT_ENVIO,
  });
}

module.exports = {
  pedir,
  servidor,
  probarConexion,
  conectar,
  estadoDeConexion,
  cerrarSesion,
  reiniciar,
  crearInstancia,
  ponerWebhook,
  enviarTexto,
  enviarBotones,
  TIMEOUT_POR_DEFECTO,
  TIMEOUT_ENVIO,
};
