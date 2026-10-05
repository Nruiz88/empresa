/* =========================================================
   Nexo Studio — Webhook de entrada de Evolution API
   ------------------------------------------------------------
   Lo que hace: Evolution llama a este endpoint cuando pasa algo en
   una instancia (llega un mensaje, cambia el estado de la conexión)
   y nosotros lo dejamos escrito para que el motor lo processe.

   ESTA RUTA ES PÚBLICA
   --------------------
   No hay sesión, ni cookie, ni panel detrás: la llama un servidor
   de fuera por su cuenta y hay que dejarlo abierto en Traefik. Eso
   significa que CUALQUIERA puede hacer POST aquí.

   El riesgo concreto: si aceptamos lo que sea, alguien puede
   fabricated un mensaje entrante y hacer que el bot mande un WhatsApp
   a un número que elija. Es suplantar el WhatsApp del negocio desde
   fuera. Por eso la puerta está CERRADA por defecto:

     · Se exige un secreto compartido en una cabecera.
     · Se compara en tiempo constante.
     · Si el secreto no está configurado, NO SE ACEPTA NADA. Fallar
       abierto porque "en desarrollo no hay secreto" es la forma
       habitual de que esto acabe en un incidente.

   ⚠️ AQUÍ SÍ SE USA getAdmin(), Y ES CORRECTO
   --------------------------------------------
   En todo lo demás del proyecto la regla es "nunca getAdmin() para
   leer datos de cliente", porque saltaría RLS y un cliente vería lo
   de todos. Aquí la excepción es real y conviene decir por qué:

     · La petición NO viene de un cliente. Viene de Evolution, que
       es infraestructura nuestra, no una persona.
     · No hay token de usuario que reconstruir: no hay sesión.
     · Lo que llega no son datos de un cliente, sino un evento
       sobre una instancia. Lo escribe el servidor.

   El aislamiento no está en juego porque no hay cliente. El que sí
   está en juego es "que no entre cualquiera", y de eso se ocupa el
   secreto de arriba.

   EL OTRO AISLAMIENTO, EL QUE DE VERDAD IMPORTA
   ----------------------------------------------
   Que este endpoint no pueda tocar el bot de OTRO cliente. Se
   resuelve por `instance_name`: cada bot tiene el suyo, y un evento
   de la instancia A solo puede escribir en el bot A. Si la instancia
   no existe en la base, se registra y se descarta. Nunca se "adivina"
   a cuál pertenece.
   ========================================================= */

const crypto = require("crypto");

const supabase = require("./supabase");

/* Cabecera con la que Evolution manda el secreto. El nombre lo elige
   quien configura el webhook, así que está en una constante y no
   repartido. */
const CABECERA_SECRETO = "x-nexo-webhook";

/**
 * Comparación en tiempo constante.
 *
 * `===` con dos cadenas sale en cuanto encuentra la primera carácter
 * que no coincide, y por el tiempo que tarda se puede adivinar la
 * clave letra a letra. Con una credencial que da acceso al WhatsApp
 * del negocio, eso no es un detalle.
 *
 * `timingSafeEqual` exige el mismo largo en los dos buffers, así que
 * el largo se compara aparte.
 *
 * Y si alguno de los dos está VACÍO devuelve false, sin comparar. Hoy
 * no da ningún problema, porque `verificar()` ya comprueba que el
 * secreto esté configurado antes de llegar aquí. Pero es una trampa
 * latente: `coincide(undefined, "")` daba true (los dos se
 * convertían a cadena vacía), así que llamar a esta función
 * directamente con un secreto vacío autentica. Una credencial nunca
 * es legítimamente vacía, y en un control de acceso eso tiene
 * que ser imposible, no improbable. */
function coincide(a, b) {
  const brutoA = a == null ? "" : String(a);
  const brutoB = b == null ? "" : String(b);

  /* Ni iguales ni desiguales: vacío contra vacío no es una
     credencial válida, es una ausencia. */
  if (!brutoA || !brutoB) return false;

  const x = Buffer.from(brutoA, "utf8");
  const y = Buffer.from(brutoB, "utf8");
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/**
 * El secreto configurado.
 *
 * Vive en el entorno y no en la base a propósito: es una credencial
 * de infraestructura, y la tabla `evolution_servers` guarda una por
 * servidor. Si algún día hace falta uno por instancia, se lee de ahí
 * y este pasa a ser el secreto maestro.
 */
function secreto() {
  return String(process.env.BOT_WEBHOOK_SECRET || "").trim();
}

/**
 * Comprueba la petición y devuelve `{ ok }`.
 *
 * `ok: false` significa "no se procesa NADA", no "se procesa con
 *，menos seguridad": una firma mala no es un aviso, es un intento.
 */
function verificar(req) {
  const esperado = secreto();

  /* Fallar cerrado. Sin secreto no hay webhook, y se dice por qué:
     quien lo lea tiene que saber que hay que configurarlo. */
  if (!esperado) {
    return {
      ok: false,
      motivo: "sin_secreto_configurado",
      explica:
        "No hay BOT_WEBHOOK_SECRET. El webhook queda cerrado: sin él, cualquiera podría mandar mensajes por el WhatsApp del negocio.",
    };
  }

  const recibido = req.headers[CABECERA_SECRETO] || req.headers["x-nexo-webhook"];

  if (!recibido) {
    return { ok: false, motivo: "sin_cabecera", explica: "La petición no trae la cabecera del secreto." };
  }

  if (!coincide(recibido, esperado)) {
    /* Se registra como 'skipped' más adelante. NO se da detalle de
       por qué falla la comparación, que ya se ha dicho bastante con
       decir que no vale. */
    return { ok: false, motivo: "secreto_incorrecto", explica: "El secreto no coincide." };
  }

  return { ok: true };
}

/**
 * Saca el nombre de la instancia de un payload de Evolution.
 *
 * Evolution lo manda en `instance`, pero no siempre: en algunos
 * eventos viene dentro de `data.instance`, y hay versiones que lo
 * ponen en `instanceName`. Se mira en los tres sitios en vez de
 * asumir uno, porque asumir mal aquí significa que TODOS los mensajes
 * parecen venir de una instancia inexistente y no se procesa nada.
 *
 * @returns {string}  "" si no se encuentra
 */
function instanciaDe(payload) {
  if (!payload || typeof payload !== "object") return "";
  const candidatos = [
    payload.instance,
    payload.instanceName,
    payload.data && payload.data.instance,
    payload.data && payload.data.instanceName,
  ];
  for (const c of candidatos) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
}

/**
 * Busca el bot de una instancia.
 *
 * Se resuelve SIEMPRE por `instance_name`. No se deduce del número,
 * ni del remitente, ni del primero que encuentre: si el nombre de
 * la instancia no está en la tabla, el evento es de algo que no es
 * nuestro y se descarta.
 *
 * @returns {Promise<{ok:boolean, bot?:object, motivo?:string}>}
 */
async function botDe(instancia) {
  if (!instancia) return { ok: false, motivo: "sin_instancia" };

  const { data, error } = await supabase
    .getAdmin()
    .from("bots")
    .select("id,client_id,name,instance_name,server_id")
    .eq("instance_name", instancia)
    .maybeSingle();

  if (error) return { ok: false, motivo: "error_consulta" };
  if (!data) return { ok: false, motivo: "instance_not_found" };
  return { ok: true, bot: data };
}

/**
 * Escribe el evento en `bots_webhook_logs`.
 *
 * Se escribe SIEMPRE, también lo que se descarta. Es lo único que
 * permite responder a "no me contesta" con datos en vez de con
 * opinión: sin registro, no hay forma de saber si el mensaje entró.
 *
 * @param {object} evento  { event_type, payload, bot_id, status, error }
 */
async function registrar(evento) {
  const { error } = await supabase.getAdmin().from("bots_webhook_logs").insert({
    event_type: String(evento.event_type || "desconocido").slice(0, 120),
    bot_id: evento.bot_id || null,
    payload: evento.payload || null,
    status: evento.status || "processed",
    error: evento.error ? String(evento.error).slice(0, 1000) : null,
  });
  if (error) console.error("[webhook] no se pudo registrar:", error.message);
  return !error;
}

/**
 * El id de un mensaje, para no guardar dos veces lo mismo.
 *
 * Evolution reintenta cuando el endpoint no responde rápido, y sin
 * esto un mensaje con dos reintentos se procesa dos veces: el bot
 * contesta dos veces. Viene en `key.id` casi siempre, y en
 * `messageId` en algunos. Si no hay ninguno, se devuelve "" y no se
 * deduplica: es preferible guardar de más que filtrar un mensaje real.
 */
function idDeMensaje(payload) {
  if (!payload || typeof payload !== "object") return "";
  const key = payload.key && payload.key.id;
  if (typeof key === "string" && key.trim()) return key.trim();
  if (typeof payload.messageId === "string" && payload.messageId.trim()) return payload.messageId.trim();
  if (payload.message && typeof payload.message.messageId === "string") {
    return payload.message.messageId.trim();
  }
  return "";
}

module.exports = {
  CABECERA_SECRETO,
  verificar,
  instanciaDe,
  botDe,
  registrar,
  idDeMensaje,
  coincide,
  secreto,
};
