/* =========================================================
   Nexo Studio — Bots: reparto, cupos y altas
   ------------------------------------------------------------
   Lo que NO es de una vista: qué caja le toca a cada bot, cómo se
   calcula que una caja está llena, y qué pasa cuando ninguna tiene
   sitio.

   ── EL REPARTO ──
   Una caja (evolution_servers) puede alojar varios números, uno por
   cliente. Cuántos caben lo dice `max_instances`, que es una columna y
   no una constante porque depende de cada Evolution: una caja de pago
   aguanta más que una gratis.

   La asignación automática es "la que tenga más cupos libres". Las otras
   dos opciones eran "la primera que haya" (llena siempre la misma, que
   es justo lo contrario de repartir) y "que lo elija quien da de alta"
   (que obliga a saber cuántas caben en cada caja para poder elegir, que
   es el dato que todavía no se sabe).

   ── POR QUÉ ESTO NO ES UN `SELECT ... ORDER BY` SUELTO ──
   Porque hay tres cosas que decidir y no las hace la base:
     1. contar cuántos bots hay en cada caja,
     2. descartar las cajas desactivadas y las llenas,
     3. desempatar de forma estable.
   Con una caja la pregunta no se plantea; con varias, un empate mal
   resuelto mete todos los bots nuevos en la misma.

   ── LO QUE ESTE FICHERO NO HACE ──
   No habla con la caja. Eso es lib/evolution.js. Aquí solo se decide a
   qué caja va un bot y se escribe en `bots`.
   ========================================================= */

const site = require("./site");
const evolution = require("./evolution");

/* Cuántos números caben por defecto cuando la fila no lo dice.
   El mismo 10 que estaba en el bot antes de que existiera el reparto
   automático, y el mismo que pone la migración 021. */
const CUPOS_POR_DEFECTO = 10;

/** Los estados que devuelve Evolution, y cómo se leen.
    Se guardan tal cual en la base (texto libre, migración 011), así que
    aquí no puede haber una lista cerrada: si aparece uno nuevo, se pinta
    como lo que es en vez de romperse la pantalla. */
const ESTADOS_BOT = {
  open: { texto: "En línea", chip: "panel-chip--bot-open" },
  close: { texto: "Sin conectar", chip: "panel-chip--bot-close" },
  connecting: { texto: "Conectando", chip: "panel-chip--bot-espera" },
  qrcode: { texto: "Esperando QR", chip: "panel-chip--bot-espera" },
};

/**
 * Cómo se lee un estado de bot.
 *
 * @param {string} estado  Lo que dice la base
 * @returns {{texto: string, chip: string, conocido: boolean}}
 */
function estadoBot(estado) {
  const s = String(estado || "").trim();
  const conocido = ESTADOS_BOT[s];
  return Object.assign({ texto: s || "Sin estado", chip: "panel-chip--mute", conocido: false }, conocido || {});
}

/**
 * El slug de un bot: la dirección pública de reservas.
 *
 * Sale de la empresa o del nombre del bot, en minúsculas, sin tildes y
 * con guiones. Es lo que se escribe en `/agendar/<slug>`, así que tiene
 * que ser corto, legible y no romper la URL.
 *
 * El patrón de `bots.slug` en la base es `^[a-z0-9][a-z0-9-]{1,40}$`:
 * entre 2 y 41 caracteres. Este recorte es lo que hace que lo que se ve
 * en el formulario se pueda guardar; si el texto fuera más largo, la
 * base lo rechazaría con un error que no explica cuál de los dos campos
 * era el culpable.
 *
 * @param {string} texto
 * @returns {string}
 */
function slugDe(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") /* quita las tildes: "Panadería" → "panaderia" */
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 41)
    .replace(/-+$/g, "");
}

/**
 * Las cajas con sus cupos y sus bots.
 *
 * @param {object} db  Cliente de Supabase con la secret key
 * @returns {Promise<Array<object>>} [{ id, name, url, plan, activo, max_instances, bots, libres }]
 */
async function cajasConCupos(db) {
  const [{ data: cajas, error: eCajas }, { data: bots, error: eBots }] = await Promise.all([
    db
      .from("evolution_servers")
      .select("id,name,url,plan,activo,max_instances,webhook_secret,webhook_url")
      .order("name"),
    db.from("bots").select("id,server_id,status"),
  ]);

  if (eCajas) throw new Error("no se pudieron leer las cajas: " + eCajas.message);
  if (eBots) throw new Error("no se pudieron leer los bots: " + eBots.message);

  /* Un solo GROUP BY en memoria. En SQL sería un `count(*)` con join a
     `clients` para no traer filas de más, pero aquí solo hace falta
     agrupar por servidor y `bots` es una tabla corta (un bot por
     cliente). La decisión se toma una vez por carga de pantalla. */
  const porCaja = new Map();
  for (const b of bots || []) {
    porCaja.set(b.server_id, (porCaja.get(b.server_id) || 0) + 1);
  }

  return (cajas || []).map((c) => {
    const usados = porCaja.get(c.id) || 0;
    const max = Number(c.max_instances) || CUPOS_POR_DEFECTO;
    return {
      id: c.id,
      name: c.name,
      url: c.url,
      plan: c.plan || null,
      /* Sin secreto no puede hablar con el bot. No impide repartir (una
         caja se puede preparar antes de tener el bot desplegado), pero
         hay que verlo, porque un bot dado de alta en una caja sin secreto
         no va a contestar nunca y no da ningún error. */
      tieneSecreto: Boolean(c.webhook_secret),
      /* La URL que tiene puesta esta caja, y cuál está usando de
         verdad. Se calculan las dos porque la diferencia entre ellas es
         justo lo que hay que ver en la pantalla: si pone "deducida" y
         la deducida es "", el bot no tiene a dónde llamar y hay que
         avisarlo antes de que monte nada. */
      webhookPropia: c.webhook_url || null,
      webhookEnUso: urlDeWebhookDe(c),
      /* `activo !== false` y no `activo === true`: una fila creada antes
         de que existiera la columna llega con null y debe contar como
         caja disponible. Con la comparación estricta, esa caja
         desaparecería del reparto sin que nadie la haya desactivado. */
      activo: c.activo !== false,
      max_instances: max,
      bots: usados,
      libres: Math.max(0, max - usados),
    };
  });
}

/**
 * La caja donde va un bot nuevo.
 *
 * @param {Array<object>} cajas  Lo que devuelve cajasConCupos()
 * @param {string|null} [preferido]  Id que se pidió explícitamente
 * @returns {{caja: object|null, motivo: string|null}}
 *          `caja` es null cuando no hay sitio; `motivo` lo explica para
 *          poder escribirlo en la pantalla sin inventar el texto allí.
 */
function elegirCaja(cajas, preferido) {
  const disponibles = (cajas || []).filter((c) => c.activo);

  /* Elegida a mano: se respeta, pero solo si se puede. No se avisa y ya:
     el motivo importa, porque "no cabe" y "está desactivada" son
     problemas distintos y se arreglan distinto. */
  if (preferido) {
    const elegida = disponibles.find((c) => c.id === preferido);
    if (!elegida) {
      const existe = (cajas || []).find((c) => c.id === preferido);
      return {
        caja: null,
        motivo: existe
          ? "La caja elegida está desactivada. Actívala en Servidores o elige otra."
          : "La caja elegida ya no existe.",
      };
    }
    if (elegida.libres < 1) {
      return {
        caja: null,
        motivo:
          "La caja elegida ya tiene sus " +
          elegida.max_instances +
          " números. Sube su cupo o elige otra.",
      };
    }
    return { caja: elegida, motivo: null };
  }

  const conSitio = disponibles.filter((c) => c.libres > 0);
  if (!conSitio.length) {
    const detalle = disponibles.length
      ? "entre " + disponibles.length + " " + (disponibles.length === 1 ? "caja" : "cajas") + " activas"
      : "porque no hay ninguna caja activa";
    return {
      caja: null,
      motivo: "No hay sitio para otro bot: todas las cajas están llenas " + detalle + ".",
    };
  }

  /* Más cupos libres primero. Los tres desempates van en el orden que
     hace la decisión estable y explicable:

       1. más sitios libres      → reparte
       2. menos bots ya puestos  → no amontona en la que está menos llena
       3. nombre                 → dos cajas empatadas siempre eligen la
                                   misma, y no "la que toque" según el
                                   orden de la base (que no está garantizado)
     */
  conSitio.sort((a, b) => {
    if (b.libres !== a.libres) return b.libres - a.libres;
    if (a.bots !== b.bots) return a.bots - b.bots;
    return String(a.name).localeCompare(String(b.name));
  });

  return { caja: conSitio[0], motivo: null };
}

/**
 * El nombre de la instancia dentro de la caja.
 *
 * El nombre de la caja es lo que usa el webhook para encontrar el bot
 * (`WHERE instance_name = ?`), y es ÚNICO en toda la base (migración
 * 015). Por eso no se inventa aquí sin mirar: si saliera uno repetido,
 * los pedidos de un cliente aparecerían en el panel de otro y no habría
 * ningún error. Se deriva del slug, que es único por construcción.
 *
 * @param {string} slug
 * @returns {string}
 */
function nombreDeInstancia(slug) {
  return String(slug || "").trim();
}

/**
 * La dirección del webhook DEDUCIDA, sin mirar ninguna caja.
 *
 * Sale del dominio igual que el botón "Abrir" del portal (ver
 * routes/panel-portal.js): si el bot se mueve de subdominio, el webhook
 * se mueve con él y no hay ningún dominio escrito en el código.
 *
 * @returns {string} La URL completa del webhook, o "" si no hay dominio
 */
function urlDeWebhook() {
  const base = site.urlDeServicio("bot", process.env.BOT_URL, 3200);
  if (!base) return "";
  return base.replace(/\/+$/, "") + "/api/webhook";
}

/**
 * A dónde tiene que llamar ESTA caja.
 *
 * Si la caja tiene `webhook_url` propia, manda esa. Si no, la deducida.
 *
 * ── POR QUÉ ES POR CAJA Y NO UN AJUSTE GENERAL ──
 *
 * Porque la URL es una propiedad de la caja, como su clave o su nombre:
 * dice a dónde tiene que llamar esa Evolution. El caso real que lo pide
 * es un bot que no está en `bot.<dominio>` —un hosting aparte, o dos
 * entornos en paralelo— y con una sola URL global no habría forma de
 * que las dos estuvieran bien a la vez.
 *
 * Y el fallo que evita es invisible: una Evolution con la URL
 * equivocada responde 200 igual, el alta se guarda, y los mensajes se
 * van a una dirección donde no hay nadie. Por eso se ve en el panel
 * ("Probar") y se puede corregir con un campo, en vez de tener que
 * llegar a editar la variable de entorno y reenganchar cada instancia.
 *
 * @param {object|null} caja  Fila de evolution_servers, o null
 * @returns {string} La URL completa, o "" si no hay ninguna
 */
function urlDeWebhookDe(caja) {
  const propia = String((caja && caja.webhook_url) || "").trim();
  if (propia) return propia.replace(/\/+$/, "");
  return urlDeWebhook();
}

/**
 * ¿Es una URL de webhook válida para guardar en una caja?
 *
 * Exige esquema http(s) y que termine en la ruta del webhook. Esta
 * última comprobación es la que más importa: una URL a la que sí se
 * puede escribir pero que no es el webhook (por ejemplo, la home del
 * bot) devuelve 200 y no hace nada, o sea el bot mudo otra vez.
 *
 * ── EL VALOR DE VUELTA ES SIEMPRE `null`, COMO EL DE `problemaDeUrl` ──
 *
 * Antes esta función devolvía `undefined` con el campo vacío y `null`
 * con una URL buena, que son las dos cosas "está bien". Dos valores para
 * lo mismo en dos funciones hermanas es el tipo de detalle que hace que
 * un test falle por la razón equivocada: aquí pasó, el test comparaba
 * contra `undefined` y daba tres fallos que no eran de la URL.
 *
 * @param {string} valor
 * @returns {string|null} El motivo, o null si está bien
 */
function problemaDeUrlWebhook(valor) {
  const s = String(valor || "").trim();

  /* Vacío = se usa la deducida. Es válido, y con lo que devuelve el
     resto de validaciones, se comprobará aparte (en la ruta) que esa
     deducida exista. */
  if (!s) return null;

  if (!/^https?:\/\//i.test(s)) return "Tiene que empezar por http:// o https://";
  if (/\s/.test(s)) return "No puede tener espacios.";

  let u;
  try {
    u = new URL(s);
  } catch {
    return "No es una dirección válida.";
  }
  if (!u.hostname) return "No tiene un dominio.";
  if (u.hash) return "No puede llevar un # al final: no se manda a la Evolution.";
  if (!/\/api\/webhook\/?$/.test(u.pathname)) {
    return "Tiene que terminar en /api/webhook. Es la ruta donde el bot escucha, y mandar la Evolution a otro sitio devuelve 200 sin hacer nada.";
  }
  return null;
}

/** Las cabeceras que la caja tiene que mandar al webhook.
 *
    El secreto sale de la CAJA (`evolution_servers.webhook_secret`) y no
    de una variable de entorno del panel. Es lo que hace que este panel y
    el bot puedan ponerse de acuerdo: si el valor estuviera en el `.env`
    del panel, se configuraría la caja con un secreto que el bot no
    comparte, y el resultado sería un bot mudo sin que se viera ningún
    error: la Evolution devuelve 200, el alta se guarda, y los mensajes se
    rechazan al llegar.

    Vacío si la caja no tiene secreto. Eso se avisa con un motivo antes de
    crear la instancia, en vez de guardar una instancia que no va a
    recibir nada. */
function cabecerasDeWebhook(caja) {
  const secreto = String((caja && caja.webhook_secret) || "").trim();
  return secreto ? { "x-webhook-secret": secreto } : {};
}

/**
 * Prepara en la caja lo que necesita el bot: la instancia y el webhook.
 *
 * ── POR QUÉ EL WEBHOOK VA DENTRO Y NO COMO PASO SUELTO ──
 * Porque una instancia sin webhook es un bot mudo, y es mudo SIN
 * ERROR: la caja devuelve 200, el panel dice que todo bien, y el único
 * síntoma es que no llegan mensajes. Por eso si el enganche falla, la
 * alta NO se da por buena: se devuelve el motivo para que se vea.
 *
 * ── POR QUÉ SE COMPRUEBA LO QUE HAY Y NO SOLO LO QUE SE ESCRIBE ──
 * `POST /webhook/set` devuelve 200 con lo que se le mandó, así que un
 * 200 no dice que esté bien. Se relee con `leerWebhook` y, si no
 * coincide, se vuelve a guardar una vez. Es el fallo que dejó un bot
 * funcionando en la caja equivocada durante semanas.
 *
 * @param {object} caja   Fila de evolution_servers (con url y api_key)
 * @param {string} nombre  instance_name del bot
 * @param {object} [opciones] { urlWebhook, cabeceras, comprobar }
 * @returns {Promise<{ok: boolean, mensaje: string, avisos: Array<string>}>}
 */
async function prepararEnCaja(caja, nombre, opciones) {
  const opts = Object.assign({ comprobar: true }, opciones || {});
  const avisos = [];

  /* ── LO QUE SE COMPRUEBA ANTES DE TOCAR LA CAJA ──

     Estas comprobaciones van PRIMERO, antes de crear la instancia, y
     no por orden de lectura sino por una razón concreta: crear una
     instancia en la Evolution es una operación que NO se deshace sola.
     Si se crea y después resulta que faltaba el secreto, queda un
     número en la caja que no está en la base de nadie, que no lo usa
     ningún bot y que ocupa sitio hasta que alguien lo borre a mano.

     Por eso aquí se para antes. Un alta que se puede repetir con otro
     clic es un alta a medias; un número huérfano en la Evolution de un
     cliente es basura que hay que ir a buscar. */

  /* La URL es la de la caja si la tiene, y si no la deducida del
     dominio. Por eso la comprobación siguiente solo mira el dominio
     cuando la caja NO tiene URL propia: si el equipo la ha escrito a
     mano, ya está decidido y no hay nada que deducir. */
  const webhook = opts.urlWebhook || urlDeWebhookDe(caja);
  const cabeceras = opts.cabeceras || cabecerasDeWebhook(caja);

  /* Sin secreto, la Evolution aceptaría el webhook SIN cabecera de
     autenticación (por eso el enganche devuelve 200) y el bot rechazaría
     todos los mensajes al llegar, porque su `verifyWebhookSignature`
     devuelve false cuando no recibe la cabecera.

     Es el peor tipo de fallo que hay aquí: el alta parecería correcta,
     la caja estaría contenta, y el bot no contestaría nunca. */
  if (!cabeceras["x-webhook-secret"]) {
    return {
      ok: false,
      avisos,
      mensaje:
        "Esta caja no tiene el secreto del webhook, así que no se puede dejar el bot escuchando. " +
        "Ponlo en la caja (Servidores de bots → Editar) con el mismo valor que WEBHOOK_SECRET en el servicio del bot.",
    };
  }

  /* Y sin URL no hay a dónde apuntar.

     Bloquea, y no solo avisa, por el mismo motivo que el secreto:
     crear la instancia para no poder engancharle el webhook deja
     basura en la caja. Un alta entera que se puede volver a hacer es
     mucho menos mala que un número huérfano.

     Ojo al mensaje: con una URL puesta a mano el problema sería otro
     (una URL mal escrita), y este texto habla de SITE_URL, que ya no
     es lo que haría falta arreglar. Se distinguen los dos casos. */
  if (!webhook) {
    return {
      ok: false,
      avisos,
      mensaje: caja && caja.webhook_url
        ? "La URL del webhook de esta caja no es válida. Revísala en Servidores de bots → Editar."
        : "No hay dirección pública del bot (SITE_URL o BOT_URL) y esta caja no tiene una URL propia, así que no se le puede decir dónde está el webhook. " +
          "Sin eso el bot no recibirá ningún mensaje. Configura el dominio, o pon la URL en la caja, y vuelve a intentarlo.",
    };
  }

  const creada = await evolution.crearInstancia(caja.url, caja.api_key, nombre);
  if (!creada.ok) {
    return {
      ok: false,
      avisos,
      mensaje: "La caja no creó la instancia: " + creada.mensaje,
    };
  }

  if (opts.comprobar) {
    const leido = await evolution.leerWebhook(caja.url, caja.api_key, nombre);

    /* Si la caja NO deja leer el webhook (versiones de Evolution que no
       tienen esa ruta), no se puede comparar y no se dice que esté mal.
       Se comprueba con lo que sí hay: que la Evolution acepte lo que se
       le manda.

       Esto no es un detalle teórico. La caja de producción no tiene
       `GET /webhook/fetchWebhook`: devuelve 404 "Cannot GET" y no hay
       otra ruta para leerlo. Con la comprobación anterior, un bot con
       el webhook perfectamente puesto aparecía en el panel como roto, y
       eso hace que quien lo ve deje de fiarse de la pantalla y toque
       cosas que funcionan. */
    if (!leido.ok && leido.data && leido.data.soportado === false) {
      avisos.push(
        "Esta Evolution no tiene forma de leer el webhook, así que no se ha podido comprobar si ya estaba bien. Se le ha vuelto a guardar y la caja lo ha aceptado."
      );
    } else if (leido.ok) {
      const cfg = leido.data.config || {};
      const eventos = Array.isArray(cfg.events) ? cfg.events.map((e) => String(e).toUpperCase()) : [];
      const coincide =
        cfg.webhook === true &&
        (cfg.url || "") === webhook &&
        cfg.byEvents === true &&
        eventos.includes("MESSAGES_UPSERT");

      if (!coincide) {
        /* Se distingue el caso "no tenía nada" del caso "tenía algo
           distinto". Si la caja apuntaba a OTRO sitio, el bot se queda
           sin mensajes igual de mudo, y el aviso tiene que decir a
           dónde apuntaba para que se entienda que se ha movido. */
        const anterior = String(cfg.url || "").trim();
        avisos.push(
          anterior
            ? "La caja apuntaba a " + anterior + " y se le ha cambiado a " + webhook + "."
            : "La caja no tenía el webhook de este bot y se lo ha puesto."
        );
      }
    }
  }

  const enganchado = await evolution.engancharWebhook(caja.url, caja.api_key, nombre, webhook, cabeceras);
  if (!enganchado.ok) {
    return {
      ok: false,
      avisos,
      mensaje:
        "El webhook no se pudo guardar en la caja: " +
        enganchado.mensaje +
        ". La instancia está creada, pero el bot no va a recibir mensajes hasta que se repita.",
    };
  }

  return { ok: true, avisos, mensaje: "" };
}

/**
 * El bot, con su caja y su número, para pintar y para decidir.
 *
 * @param {object} db
 * @returns {Promise<Array<object>>}
 */
async function botsConCaja(db) {
  const { data, error } = await db
    .from("bots")
    .select(
      "id,name,slug,instance_name,status,status_checked_at,server_id,client_id,created_at," +
        "clients(id,empresa,nombre,email),evolution_servers(id,name,url,plan)"
    )
    .order("created_at", { ascending: false });

  if (error) throw new Error("no se pudieron leer los bots: " + error.message);
  return data || [];
}

/**
 * Los bots de un cliente, si tiene alguno.
 *
 * @param {object} db
 * @param {string} clientId
 * @returns {Promise<object|null>}
 */
async function botDeCliente(db, clientId) {
  const { data, error } = await db
    .from("bots")
    .select("id,name,slug,instance_name,status")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw new Error("no se pudo leer el bot del cliente: " + error.message);
  return data || null;
}

module.exports = {
  CUPOS_POR_DEFECTO,
  ESTADOS_BOT,
  estadoBot,
  slugDe,
  cajasConCupos,
  elegirCaja,
  nombreDeInstancia,
  urlDeWebhook,
  urlDeWebhookDe,
  problemaDeUrlWebhook,
  cabecerasDeWebhook,
  prepararEnCaja,
  botsConCaja,
  botDeCliente,
};