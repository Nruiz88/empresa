/* =========================================================
   Shopcito — Bots: reparto, cupos y altas
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
const aplicaciones = require("./aplicaciones");

/* Cuántos números caben por defecto cuando la fila no lo dice.
   El mismo 10 que estaba en el bot antes de que existiera el reparto
   automático, y el mismo que pone la migración 021. */
const CUPOS_POR_DEFECTO = 10;

/* La clave del microservicio del bot en `services.microservicio_clave`
   y en `plans.aplicaciones`. Sale de `modules.id` (migración 007) y
   tiene que ser la misma que usa `tiene_modulo()` para decidir el
   acceso: si aquí se escribiera otra, el bot se daría de alta para
   quien no tiene acceso o no se daría para quien sí. */
const MODULO_BOT = "bot_whatsapp";

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
      /* `api_key` viene en la consulta, aunque no se use para repartir.

   La primera versión de la pantalla de Cajas no lo pedía, y por eso
   el botón «Probar» y la etiqueta de estado decían cosas distintas:
   el botón consultaba la caja con la clave que pedía por su cuenta, y
   la etiqueta decía «falta la clave» porque no la tenía.

   Dos partes de la misma pantalla hablando con la caja de dos
   maneras es justo el problema que esta pantalla tiene que resolver,
   así que ahora la traen las dos. */
          .select("id,name,url,api_key,plan,activo,max_instances,webhook_secret,webhook_url")
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
      /* La clave se pide en la consulta y aquí se pasa entera.

         Antes no venía, y por eso la pantalla de Cajas decía «falta
         la clave de la caja» en una caja que sí la tenía: la clave
         se perdía al construir este objeto, que es un paso que
         parece inocuo y no lo es. La consulta la traía y este
         return la dejaba caer.

         Va sin transformar porque la Evolution la necesita tal cual
         y porque el que la lee es el servidor. La vista nunca la
         pinta. */
      api_key: c.api_key || null,
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
/**
 * Los números de una caja, uno por sitio, con su estado.
 *
 * ── POR QUÉ HACE FALTA ──
 *
 * La pantalla de Cajas solo enseña `0 / 15`. Con eso no se sabe si
 * los 15 sitios existen, si están libres o si la caja tiene menos de
 * los que dice, y se acaba mirando la API de Evolution a mano para
 * averiguarlo. Y el contador por sí solo miente en un caso: si la caja
 * tiene 15 sitios pero solo 3 números creados, `0 / 15` parece lleno
 * de huecos cuando en realidad es que la caja nunca los creó.
 *
 * ── DE DÓNDE SALE CADA COSA ──
 *
 * La lista de sitios la pone la base: `max_instances` y qué bots hay
 * apuntando a esta caja.
 *
 * Los números que existen de verdad los pone la Evolution, y se pide
 * una sola vez a la caja entera. Si la Evolution no contesta o no se
 * puede leer, la lista sale equally de sitios pero SIN número, con
 * `consultada: false`, para que la pantalla pueda decirlo en vez de
 * pintar 15 huecos que parecen libres.
 *
 * ── POR QUÉ NO SE PIDE A LA EVOLUTION EN CADA TARDE ──
 *
 * Porque son 15 peticiones con tiempo límite cada una, y la pantalla
 * se abre cada vez que se mira. Se pide una vez y ya.
 *
 * @param {object} db       Cliente de Supabase
 * @param {object} caja     Fila de `evolution_servers`, con `api_key`
 * @returns {Promise<Array<object>>} Un objeto por sitio
 */
async function numerosDeCaja(db, caja) {
  const sitios = Math.max(0, Number(caja.max_instances) || CUPOS_POR_DEFECTO);

  /* Los bots de esta caja, para saber qué sitio ocupa cada uno. */
  const { data: bots } = await db
    .from("bots")
    .select("id,name,slug,instance_name,status,client_id,clients(id,empresa,nombre)")
    .eq("server_id", caja.id);

  const lista = bots || [];

  /* ── Qué hay realmente en la Evolution ── */

  let existentes = new Map();
  let consultada = false;
  let aviso = "";

  try {
    /* Ver la nota del mismo endpoint en `estadoDeCaja()`: es GET, y
       la respuesta viene envuelta en un objeto con `instances`, no
       como un array pelado. Las dos formas se aceptan porque
       Evolution cambió la forma entre versiones y no sabemos cuál
    try {
      /* Se llama a la caja por la MISMA función que usa el botón
         «Probar» de esta pantalla, y por el mismo motivo: si las dos
         hablaras de dos maneras distintas, la etiqueta «Online» y el
         resultado del botón podrían contradecirse, y entonces la
         pantalla no valdría para diagnosticar nada.

         Las dos primeras versiones lo hicieron con un `fetch` propio y
         las dos fallaron: la primera con un 404 por hacer POST donde
         toca GET, y la segunda con un 401 por mandar cabeceras del
         webhook a la API, que no las quiere. */
      const r = await evolution.instanciasDeCaja(caja.url, caja.api_key);

      if (r.ok) {
        consultada = true;
        for (const i of r.instancias || []) {
          if (i && i.name) existentes.set(String(i.name), i);
        }
      } else {
        aviso = r.mensaje || "La caja no ha contestado.";
      }
    } catch (err) {
      aviso = "No se pudo preguntar a la caja: " + err.message;
    }

  /* ── Los renglones de la caja ──

     ── POR QUÉ YA NO SON «SITIOS NUMERADOS» ──

     Antes se pintaban N huecos fijos y cada bot tenía que «caer» en uno
     buscando un NÚMERO al final del nombre de la instancia («Server 1»
     -> sitio 1). Eso funcionaba cuando las instancias se llamaban así.
     Hoy el nombre de la instancia es el slug del bot
     («panaderia-la-espiga»), que no termina en número: ningún bot casaba
     con ningún sitio y la pantalla los enseñaba a todos como libres o
     «sin asignar». El cliente quedaba invisible aunque el bot existiera.

     Ahora se listan las cosas que HAY, en este orden:
       1. cada bot de la base, con el cliente que lo tiene;
       2. las instancias que están en la caja y no son de ningún bot
          («sin asignar»: ocupan sitio y no los paga nadie);
       3. los huecos que quedan hasta el tope.
     Se casa bot <-> instancia por el NOMBRE EXACTO, que es lo único
     fiable: el nombre es a la vez la clave del bot en la base y el
     nombre de la instancia en Evolution. */

  const lectura = (inst) => ({
    estadoEvolution: inst ? inst.state || inst.status || null : null,
    telefono:
      inst && (inst.ownerJid || inst.phoneNumber)
        ? String(inst.ownerJid || inst.phoneNumber).replace(/@.*$/, "")
        : null,
    qrcode: Boolean(inst && inst.base64),
  });

  const numeros = [];
  const instanciasUsadas = new Set();

  /* 1. Los bots, cada uno con su cliente. */
  for (const b of lista) {
    const inst = existentes.get(String(b.instance_name || ""));
    if (inst) instanciasUsadas.add(String(b.instance_name));
    const cliente = Array.isArray(b.clients) ? b.clients[0] : b.clients;

    numeros.push(
      Object.assign(
        {
          sitio: numeros.length + 1,
          nombre: b.instance_name,
          enEvolution: Boolean(inst),
          botId: b.id,
          botNombre: b.name,
          empresa: cliente ? cliente.empresa || cliente.nombre || "" : "",
          estadoBot: estadoBot(b.status),
        },
        lectura(inst)
      )
    );
  }

  /* 2. Instancias de la caja que no son de ningún bot. */
  for (const [nombreInstancia, inst] of existentes) {
    if (instanciasUsadas.has(nombreInstancia)) continue;
    numeros.push(
      Object.assign(
        {
          sitio: numeros.length + 1,
          nombre: nombreInstancia,
          enEvolution: true,
          botId: null,
          botNombre: null,
          empresa: null,
          estadoBot: null,
        },
        lectura(inst)
      )
    );
  }

  /* 3. Los huecos hasta el tope. */
  const libres = Math.max(0, sitios - numeros.length);
  for (let i = 0; i < libres; i++) {
    numeros.push({
      sitio: numeros.length + 1,
      nombre: null,
      enEvolution: false,
      estadoEvolution: null,
      telefono: null,
      qrcode: false,
      botId: null,
      botNombre: null,
      empresa: null,
      estadoBot: null,
    });
  }

  return { numeros, consultada, aviso, total: sitios, ocupados: lista.length };
}

/**
 * Si una caja está viva, y desde cuándo se sabe.
 *
 * ── POR QUÉ ESTO NO ES LO MISMO QUE EL ESTADO DE LOS BOTS ──
 *
 * El estado de un bot dice si ese número está conectado a WhatsApp. Lo
 * que se pregunta aquí es otra cosa: si la CAJA responde. Son dos
 * cosas distintas y se confunden todo el rato.
 *
 * Una caja puede estar online y no tener ningún bot: es exactamente
 * el caso de ahora, y por eso la pantalla parecia vacía. Y una caja
 * puede llevar horas sin que nadie la mire y aun así estar caída,
 * sin que ningún bot avise de nada, porque el bot no se entera: se
 * queda sin respuestas y no tiene dónde quejarse.
 *
 * ── POR QUÉ `ONLINE` Y NO UNA LUZ VERDE ──
 *
 * Porque en una caja con 15 sitios, «online» no quiere decir que los
 * 15 funcionan. Quiere decir que la caja contesta. La palabra lo dice
 * y una luz verde no lo aclararía.
 *
 * @param {object} caja  Fila de `evolution_servers` con `url` y `api_key`
 * @returns {Promise<{online: boolean, mensaje: string, ms: number, instancias: number}>}
 */
async function estadoDeCaja(caja) {
  const inicio = Date.now();

  try {
    /* ── POR QUÉ SE USA `evolution.probar()` Y NO UN `fetch` PROPIO ──

       Las dos primeras versiones llamaron a la caja con `fetch` a
       mano. La primera hizo POST y la caja devolvió 404. La segunda
       hizo GET bien, pero añadió las cabeceras del webhook y la caja
       devolvió 401.

       El 401 no era por la clave: era por las cabeceras de más.
       Evolution comprueba la clave y las cabeceras del webhook son
       para el webhook, no para la API, y mandarlas ahí la caja las
       rechaza.

       `evolution.probar()` ya sabe cómo se le habla a esta caja, y es
       la misma función que usa el botón «Probar» de esta misma
       pantalla. Si aquí se habla de otra manera, las dos pueden
       discrepar, y entonces la pantalla se contradice a sí misma:
       el botón dice que la caja vive y la etiqueta dice que no.

       Por eso se delega en vez de repetir la llamada. */
    const r = await evolution.probar(caja.url, caja.api_key);
    const ms = Date.now() - inicio;

    if (!r.ok) {
      return {
        online: false,
        ms,
        instancias: 0,
        mensaje: r.mensaje || "La caja no ha contestado.",
      };
    }

    return {
      online: true,
      ms,
      instancias: (r.data && r.data.instancias) || 0,
      mensaje: "",
    };
  } catch (err) {
    return {
      online: false,
      ms: Date.now() - inicio,
      instancias: 0,
      mensaje: err.name === "AbortError" ? "La caja tardó demasiado." : "No se pudo contactar: " + err.message,
    };
  }
}

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

/**
 * Un slug de bot que todavía no esté usado.
 *
 * ── POR QUÉ NO SALE SOLO DEL NOMBRE ──
 *
 * Porque `bots.slug` es ÚNICO (migración 011) y es la dirección pública
 * `/agendar/<slug>`. Dos clientes con la misma empresa —«Panadería»,
 * que es un nombre que se repite— chocarían al 100%, y el error saldría
 * como un rechazo de la base que no explica que el culpable es el
 * nombre repetido.
 *
 * ── POR QUÉ TAMBIÉN MIRA `instance_name` ──
 *
 * Porque en este flujo los dos valen lo mismo (el nombre de la instancia
 * en Evolution es el slug, ver `nombreDeInstancia`), y una instancia
 * repetida dentro de la misma caja haría que los mensajes de un cliente
 * aparecieran en el panel de otro sin ningún error a la vista.
 *
 * @param {object} db
 * @param {string} raiz  El texto del que partir (empresa, nombre...)
 * @returns {Promise<string>}
 */
async function slugLibre(db, raiz) {
  let base = (slugDe(raiz) || "").replace(/-+$/g, "");
  /* El patrón de la columna pide entre 2 y 41 caracteres: un slug de una
     letra lo rechazaría la base. */
  if (base.length < 2) base = "bot";
  base = base.slice(0, 38);

  for (let n = 0; n < 100; n++) {
    const sufijo = n === 0 ? "" : "-" + (n + 1);
    const intento = (base.slice(0, 41 - sufijo.length) + sufijo) || "bot";

    const { data, error } = await db
      .from("bots")
      .select("id")
      .or(`slug.eq.${intento},instance_name.eq.${intento}`)
      .maybeSingle();

    if (error) throw new Error("no se pudo comprobar el nombre del bot: " + error.message);
    if (!data) return intento;
  }

  throw new Error("no se encontró un nombre libre para el bot");
}

/**
 * Da de alta el bot de un cliente, si le toca y se puede.
 *
 * ── POR QUÉ ESTO NO ES EL ALTA DE /panel/bots ──
 *
 * Es la MISMA alta, con el mismo reparto (`cajasConCupos` + `elegirCaja`)
 * y la misma preparación en la caja (`prepararEnCaja`). Existe para que
 * asignar la aplicación del bot desde Aplicaciones no deje al cliente
 * con un servicio contratado y sin número: hasta ahora había que darlo
 * de alta a mano después, y si nadie se acordaba, el bot no existía y el
 * sitio de la caja no se descontaba.
 *
 * ── POR QUÉ NO LANZA CUANDO NO HAY SITIO ──
 *
 * Porque el que llama (el alta de la aplicación) no puede deshacer la
 * venta: el cliente ya contrató. Devuelve el motivo para que se pueda
 * guardar el servicio y avisar de que el bot quedó pendiente, que es más
 * útil que un 400 que borra una asignación que sí se hizo.
 *
 * ── EL ORDEN, Y POR QUÉ ES EL MISMO QUE EL DEL ALTA MANUAL ──
 *
 * Se comprueba si ya tiene bot ANTES de tocar la caja: crear la instancia
 * en Evolution y luego chocar con `un_bot_por_cliente` deja un número
 * huérfano en la caja. Y se prepara la caja ANTES de insertar la fila,
 * por el mismo motivo: un bot en la base sin instancia detrás parece que
 * funciona y no contesta.
 *
 * @param {object} db
 * @param {string} clientId
 * @param {object} [opciones] { nombre, slug, cajaId }
 * @returns {Promise<{creado: boolean, yaTenia?: boolean, botId?: string,
 *                    caja?: object, slug?: string, motivo?: string}>}
 */
async function asegurarBotDeCliente(db, clientId, opciones) {
  const opts = opciones || {};

  if (!clientId) {
    return { creado: false, motivo: "No se sabe a qué cliente dar de alta el bot." };
  }

  /* Ya tiene uno: no se crea otro. No es un error —puede llegar aquí
     reasignando un plan que incluye el bot— y por eso se distingue con
     `yaTenia` en vez de mezclarlo con los fallos. */
  const previo = await botDeCliente(db, clientId);
  if (previo) return { creado: false, yaTenia: true, botId: previo.id };

  const { data: cliente } = await db
    .from("clients")
    .select("id,empresa,nombre")
    .eq("id", clientId)
    .maybeSingle();

  if (!cliente) {
    return { creado: false, motivo: "El cliente ya no existe." };
  }

  const etiqueta = String(cliente.empresa || cliente.nombre || "").trim();
  let nombre = String(opts.nombre || "").trim() || "Bot de " + (etiqueta || "cliente");
  if (nombre.length > 80) nombre = nombre.slice(0, 80);

  const slug = await slugLibre(db, opts.slug || etiqueta);
  const nombreInstancia = nombreDeInstancia(slug);

  const cajas = await cajasConCupos(db);
  const elegido = elegirCaja(cajas, opts.cajaId || null);
  if (!elegido.caja) return { creado: false, motivo: elegido.motivo };

  const { data: cajaFila, error: eCaja } = await db
    .from("evolution_servers")
    .select("id,name,url,api_key,webhook_secret")
    .eq("id", elegido.caja.id)
    .maybeSingle();

  if (eCaja || !cajaFila) {
    return { creado: false, motivo: "La caja elegida ya no existe." };
  }

  const preparado = await prepararEnCaja(cajaFila, nombreInstancia);
  if (!preparado.ok) {
    return { creado: false, motivo: preparado.mensaje, avisos: preparado.avisos };
  }

  const { data: creado, error: eBot } = await db
    .from("bots")
    .insert({
      client_id: clientId,
      server_id: cajaFila.id,
      name: nombre,
      instance_name: nombreInstancia,
      slug,
      status: "close",
    })
    .select("id")
    .single();

  if (eBot) {
    /* La caja ya tiene la instancia y la base no guardó el bot. No se
       deshace —borrar la instancia es destructivo—, pero se dice. */
    return {
      creado: false,
      motivo: "La caja creó la instancia pero no se pudo guardar el bot: " + eBot.message,
    };
  }

  return { creado: true, botId: creado.id, caja: cajaFila, slug, avisos: preparado.avisos };
}

/**
 * Si el cliente tiene derecho al bot y no lo tiene, se lo damos de alta.
 *
 * ── POR QUÉ PREGUNTA A `tiene_modulo` Y NO A LOS CAMPOS DEL SERVICIO ──
 *
 * Porque "¿tiene el bot?" tiene UNA respuesta, y la da la base: la
 * función `tiene_modulo` (migración 032) que mira `suscripciones`,
 * `services` y `plans.aplicaciones`. Si aquí se decidiera mirando el
 * estado y la fecha del servicio por separado, habría dos reglas y el
 * día que una cambie el bot se crearía para quien no tiene acceso o no
 * se crearía para quien sí.
 *
 * ── CUÁNDO SE LLAMA ──
 *
 *   · al asignar la aplicación o el plan del bot (panel/aplicaciones);
 *   · al confirmar el pago de un cobro (panel/cobros), que es cuando
 *     un servicio en `pendiente` pasa a `activo`.
 *
 * Es idempotente: si el bot ya existe, `asegurarBotDeCliente` no crea
 * otro. Y si el cliente no tiene acceso (servicio en pendiente, o
 * vencido hace más del margen), no crea nada y lo dice con
 * `sinAcceso`, para que quien llama pueda avisar en vez de tratarlo
 * como un fallo.
 *
 * @param {object} db
 * @param {string} clientId
 * @returns {Promise<{creado: boolean, yaTenia?: boolean, sinAcceso?: boolean,
 *                    botId?: string, caja?: object, slug?: string, motivo?: string}>}
 */
async function ponerBotSiTieneAcceso(db, clientId) {
  if (!clientId) {
    return { creado: false, motivo: "No se sabe de qué cliente es el bot." };
  }

  const { data: tiene, error } = await db.rpc("tiene_modulo", {
    cliente_uuid: clientId,
    modulo: MODULO_BOT,
  });

  if (error) {
    return {
      creado: false,
      motivo: "No se pudo comprobar el acceso al bot: " + error.message,
    };
  }

  if (tiene !== true) return { creado: false, sinAcceso: true };

  return asegurarBotDeCliente(db, clientId);
}

/**
 * El contrato del bot: si el cliente tiene un bot, tiene que tener el servicio.
 *
 * ── POR QUÉ ──
 *
 * El bot (`bots`) es la parte TÉCNICA (el número en Evolution) y el
 * servicio (`services`) es la parte COMERCIAL: es lo que sale en
 * Aplicaciones, lo que el cliente ve en su portal y lo que se cobra.
 * Se pueden crear por dos caminos:
 *
 *   · asignando la aplicación -> crea el bot (ponerBotSiTieneAcceso);
 *   · dando de alta el bot en /panel/bots -> ANTES no creaba el
 *     servicio, y el cliente quedaba con el número pero invisible: no
 *     salía en Servicios ni en Aplicaciones, y su portal lo mostraba
 *     como si no tuviera nada.
 *
 * Esto es el segundo camino. Si ya tiene un servicio que dé el bot (la
 * aplicación suelta O un plan que lo incluya), no toca nada: crearlo
 * otra vez sería cobrar dos veces por lo mismo.
 *
 * @param {object} db
 * @param {string} clientId
 * @returns {Promise<{creado: boolean, yaTenia?: boolean, serviceId?: string, motivo?: string}>}
 */
async function asegurarServicioDeBot(db, clientId) {
  if (!clientId) return { creado: false, motivo: "No se sabe de qué cliente es el bot." };

  /* ¿Ya tiene un servicio activo que dé el bot? */
  const { data: planesConBot } = await db
    .from("plans")
    .select("id")
    .contains("aplicaciones", [MODULO_BOT]);
  const planIds = (planesConBot || []).map((p) => p.id);

  const { data: suyos } = await db
    .from("services")
    .select("id,kind,microservicio_clave,plan_id")
    .eq("client_id", clientId)
    .in("estado", ["activo", "en_curso", "pendiente"]);

  const yaTiene = (suyos || []).some(
    (s) =>
      (s.kind === "aplicacion" && s.microservicio_clave === MODULO_BOT) ||
      (s.kind === "plan" && planIds.includes(s.plan_id))
  );
  if (yaTiene) return { creado: false, yaTenia: true };

  /* El título y el precio salen del catálogo, no se inventan. */
  const { data: app } = await db
    .from("microservicios")
    .select("nombre,precio,moneda,periodo")
    .eq("modulo", MODULO_BOT)
    .maybeSingle();

  const { data: creado, error } = await db
    .from("services")
    .insert({
      client_id: clientId,
      kind: "aplicacion",
      estado: "activo",
      microservicio_clave: MODULO_BOT,
      titulo: (app && app.nombre) || "Bot de WhatsApp",
      importe: app && app.precio != null ? Number(app.precio) : null,
      moneda: (app && app.moneda) || "ARS",
      periodicidad: aplicaciones.periodicidadDe(app && app.periodo),
    })
    .select("id")
    .single();

  if (error) return { creado: false, motivo: error.message };
  return { creado: true, serviceId: creado.id };
}

/* ─────────────────────────────────────────────────────────
   LOS DEFAULTS DE UN BOT NUEVO

   Respuestas y horarios de arranque, para que un bot recién creado ya
   conteste algo (hola, horario, menú…) y la palabra "turno" funcione de
   una. Son un PUNTO DE PARTIDA editable desde el panel del cliente, no
   algo cerrado.

   Lo mismo existe en el repo del bot (`wweb/src/lib/seed-defaults.ts`),
   que siembra cuando la instancia se crea por su propio camino. Acá se
   siembra desde el panel porque es el panel quien da de alta los bots
   (y con esa vía los bots quedaban con 0 respuestas y sin horarios).
   Si se cambia un texto, cambiarlo en los dos sitios.
   ───────────────────────────────────────────────────────── */

/** Horarios de arranque: Lun–Vie 9–18 y Sáb 9–13, turnos de 30 min. */
const HORAS_POR_DEFECTO = [
  { day_of_week: 1, start_time: "09:00", end_time: "18:00", slot_duration_min: 30 },
  { day_of_week: 2, start_time: "09:00", end_time: "18:00", slot_duration_min: 30 },
  { day_of_week: 3, start_time: "09:00", end_time: "18:00", slot_duration_min: 30 },
  { day_of_week: 4, start_time: "09:00", end_time: "18:00", slot_duration_min: 30 },
  { day_of_week: 5, start_time: "09:00", end_time: "18:00", slot_duration_min: 30 },
  { day_of_week: 6, start_time: "09:00", end_time: "13:00", slot_duration_min: 30 },
];

/** Respuestas de texto de arranque. La clave (`key`) es solo interna. */
function respuestasPorDefecto(negocio) {
  return [
    {
      key: "turno",
      keyword: "turno",
      priority: 20,
      text:
        "🕐 *Turnos*\n\n" +
        "Escribinos la palabra *turno* y te muestro la disponibilidad para que elijas día y hora 📅",
    },
    {
      key: "productos",
      keyword: "productos",
      priority: 20,
      text: "🛒 *Nuestros productos*\n\nEscribinos *menú* o *precios* y te mostramos el catálogo.",
    },
    {
      /* En vez de "humano": el cliente pidió que diga *Atención Personal*. */
      key: "atencion",
      keyword: "atencion",
      priority: 10,
      text:
        "💬 *Atención Personal*\n\n" +
        "Te leemos enseguida. Mientras tanto podés escribir *horario* o *ubicación* y te respondemos al instante.",
    },
    {
      key: "saludo",
      keyword: "hola",
      priority: 50,
      text:
        "¡Hola! 👋\n\n" +
        "Bienvenido a *" + negocio + "*.\n\n" +
        "¿En qué te podemos ayudar? Escribinos *menú* y te mostramos todas las opciones 😊",
    },
    {
      key: "horarios",
      keyword: "horario",
      priority: 40,
      text:
        "🕐 *Horarios de atención*\n\n" +
        "Lunes a Viernes de 9 a 18 h\n" +
        "Sábados de 9 a 13 h\n" +
        "Domingos cerrado\n\n" +
        "_Editá estos horarios desde tu panel._",
    },
    {
      key: "ubicacion",
      keyword: "ubicacion",
      priority: 40,
      text:
        "📍 *Dónde estamos*\n\n" +
        "Cargá tu dirección desde el panel y la mostramos acá con el link al mapa.",
    },
    {
      key: "gracias",
      keyword: "gracias",
      priority: 30,
      text: "¡Gracias por escribir! 😊\n\nCualquier cosa estamos a mano.",
    },
  ];
}

/**
 * Siembra las respuestas y los horarios de un bot nuevo.
 *
 * ── POR QUÉ ES POR CLAVE Y NO "SI ESTÁ VACÍO" ──
 *
 * Porque un bot puede tener algo cargado a medias (una respuesta suelta,
 * un par de días de horario) y lo que falta es justo lo que se agrega.
 * Se inserta solo lo que NO está: repetirlo no duplica ni pisa lo que el
 * cliente ya editó.
 *
 * @param {object} db
 * @param {string} botId
 * @param {{negocio?: string}} [opciones]
 * @returns {Promise<{respuestas: number, horarios: number}>}
 */
async function sembrarDefaultsDelBot(db, botId, opciones) {
  const negocio = String((opciones && opciones.negocio) || "").trim() || "tu negocio";
  const resultado = { respuestas: 0, horarios: 0 };

  if (!botId) return resultado;

  /* Respuestas: se mira qué claves ya hay para no repetir. */
  const { data: existentes } = await db
    .from("bots_responses")
    .select("id,keyword")
    .eq("bot_id", botId);

  const porKeyword = new Map((existentes || []).map((r) => [r.keyword, r.id]));
  const ids = {};

  for (const d of respuestasPorDefecto(negocio)) {
    if (porKeyword.has(d.keyword)) {
      ids[d.key] = porKeyword.get(d.keyword);
      continue;
    }
    const { data, error } = await db
      .from("bots_responses")
      .insert({
        bot_id: botId,
        keyword: d.keyword,
        response_text: d.text,
        response_type: "text",
        is_active: true,
        priority: d.priority,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[bots] no se pudo sembrar la respuesta «" + d.keyword + "»: " + error.message);
    } else {
      ids[d.key] = data.id;
      resultado.respuestas++;
    }
  }

  /* El menú apunta a las respuestas por id. Si alguna no se pudo crear,
     su botón se omite en vez de quedar apuntando a la nada. */
  if (!porKeyword.has("menu")) {
    const botones = [
      ids.turno ? { id: "b_turno", text: "🕐 Sacar un turno", target_id: ids.turno } : null,
      ids.productos ? { id: "b_productos", text: "🛒 Ver productos", target_id: ids.productos } : null,
      ids.atencion ? { id: "b_atencion", text: "💬 Atención Personal", target_id: ids.atencion } : null,
    ].filter(Boolean);

    const { error } = await db.from("bots_responses").insert({
      bot_id: botId,
      keyword: "menu",
      response_text: "[menú base]",
      response_type: "menu",
      menu_config: {
        title: negocio + " — ¿qué necesitás?",
        description: "Elegí una opción y te ayudamos al toque 👇",
        footer: "Boti · tu asistente",
        buttons: botones,
      },
      is_active: true,
      priority: 15,
    });

    if (error) console.error("[bots] no se pudo sembrar el menú: " + error.message);
    else resultado.respuestas++;
  }

  /* Horarios: se agregan solo los días que faltan. */
  const { data: horas } = await db
    .from("bots_business_hours")
    .select("day_of_week")
    .eq("bot_id", botId);
  const dias = new Set((horas || []).map((h) => h.day_of_week));

  for (const h of HORAS_POR_DEFECTO) {
    if (dias.has(h.day_of_week)) continue;
    const { error } = await db
      .from("bots_business_hours")
      .insert(Object.assign({ bot_id: botId }, h));
    if (error) console.error("[bots] no se pudo sembrar el horario del día " + h.day_of_week + ": " + error.message);
    else resultado.horarios++;
  }

  return resultado;
}

module.exports = {
  numerosDeCaja,
  estadoDeCaja,
  CUPOS_POR_DEFECTO,
  MODULO_BOT,
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
  slugLibre,
  asegurarBotDeCliente,
  asegurarServicioDeBot,
  sembrarDefaultsDelBot,
  ponerBotSiTieneAcceso,
};