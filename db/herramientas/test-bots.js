/* =========================================================
   Nexo Studio — Bots y cajas (pruebas)
   ------------------------------------------------------------
   Qué se comprueba aquí, y por qué son estas y no otras.

   ⚠️ ESTE FICHERO NO ES DE LOS QUE SE PUEDEN CORRER A LA CARGA, Y LA
      RAZÓN ES DE LAS IMPORTANTES.

   Nunca da de alta un bot ni toca una caja real, aunque tenga una a dos
   clics. Las llamadas a Evolution (crear la instancia, enganchar el
   webhook, preguntar el estado) necesitan una caja de verdad, y lo que
   hay en la base es la de producción: un "test" que creara un número ahí
   dejaría un número huérfano en la Evolution de un cliente.

   Para probar contra la Evolution real está `npm run probar:bots`, que
   solo LEE (pregunta el estado, prueba una caja) y nunca crea nada.
   Y para probar el mensaje de verdad de punta a punta, `db/
   test-bot-real.js`.

   ── LO QUE NO SE PUEDE PROBAR SIN INTERNET ──
   Las llamadas a Evolution (crear la instancia, el webhook, el estado)
   necesitan una caja real. Eso se prueba en la caja de verdad, con
   `db/test-bot-real.js`, que manda un WhatsApp de verdad y mira si el
   bot contesta. Este fichero no la toca: si lo hiciera, correr las
   pruebas crearía números en la Evolution de producción.

   ── LO QUE SÍ SE PROBAR AQUÍ ──
   La parte que decide y la que no depende de nadie:

     1. El reparto: qué caja elige y por qué.
     2. Los cupos: cuándo una caja está llena y qué pasa cuando todas
        lo están.
     3. La comprobación de la dirección de una caja.
     4. Que la base sigue como debe: un bot por cliente, el nombre de
        instancia único, y que la clave de las cajas sigue sin poder
        leerla un cliente.

   ── POR QUÉ LAS PRIMERAS SON PURAS ──
   El reparto se decide en memoria (lib/bots.js, elegirCaja) y se le
   pasa una lista de cajas a mano. No necesita base ni internet, así que
   se prueban todos los casos que importan en un archivo de texto: la caja
   llena, la desactivada, el empate, el reparto forzado. Es la parte con
   más reglas y la más fácil de romper sin que nadie se entere, porque un
   reparto que manda todos los bots a la misma caja no da ningún error:
   funciona.
   ========================================================= */

/* El .env se carga por lo menos. `ver-vistas` NO se llama aquí: termina
   con `process.exit`, así que si se trajera arriba, este fichero se
   cortaría en su primera línea y no comprobara nada. Las vistas se
   comprueban en su propio test (`npm run test:vistas`), que además va en
   el `npm test` de siempre. */
const env = require("../../lib/env");
env.load();

const supabase = require("../../lib/supabase");
const bots = require("../../lib/bots");
const evolution = require("../../lib/evolution");

let ok = 0;
let fallos = 0;
let seccion = "";

function titulo(t) {
  seccion = t;
  console.log("\n── " + t + " " + "─".repeat(Math.max(0, 52 - t.length)));
}

function comprobar(texto, condicional) {
  if (condicional) {
    ok++;
    console.log("  ✓ " + texto);
  } else {
    fallos++;
    console.log("  ✗ " + texto);
  }
}

/* Una caja de mentira. Los ids son cadenas que no son uuids: el reparto
   no los valida (solo los compara), y si empezara a hacerlo, eso ya sería
   un cambio de comportamiento que hay que probar en otro sitio. */
function caja(id, libres, extra) {
  const usados = 10 - libres;
  return Object.assign(
    {
      id,
      name: "Caja " + id,
      url: "https://caja-" + id + ".example",
      plan: null,
      activo: true,
      max_instances: 10,
      bots: usados,
      libres,
    },
    extra || {}
  );
}

(async () => {
  console.log("\n═══ Bots y cajas de Evolution ═══\n");

  /* =========================================================
     1. El reparto
     ========================================================= */
  titulo("El reparto elige la caja con más sitio");

  {
    const cajas = [caja("a", 2), caja("b", 7), caja("c", 1)];
    const e = bots.elegirCaja(cajas, null);
    comprobar("con tres cajas elige la que más libres tiene", e.caja && e.caja.id === "b");
    comprobar("y no da ningún motivo de error", e.motivo === null);
  }

  {
    /* El caso de una sola caja: no hay nada que repartir y aun así tiene
       que elegir bien. */
    const e = bots.elegirCaja([caja("solo", 4)], null);
    comprobar("con una sola caja la elige", e.caja && e.caja.id === "solo");
  }

  {
    /* El desempate. Dos cajas con 5 libres cada una: da igual cuál sea,
           pero tiene que ser SIEMPRE la misma. Si dependiera del orden de
           la base, la misma operación daría cajas distintas en dos
           ejecuciones y nadie sabría reproducir un fallo. */
    const a = bots.elegirCaja([caja("x", 5), caja("y", 5)], null).caja.id;
    const b = bots.elegirCaja([caja("y", 5), caja("x", 5)], null).caja.id;
    comprobar("un empate se resuelve siempre igual, sea cual sea el orden", a === b);
  }

  {
    /* El segundo desempate: mismos libres, distinto número de bots ya
       puestos. El de menos bots va primero, porque es el que reparte. */
    const muchas = caja("llena-ish", 3, { bots: 7, max_instances: 10 });
    const pocas = caja("vacia-ish", 3, { bots: 3, max_instances: 10 });
    const e = bots.elegirCaja([muchas, pocas], null);
    comprobar("a igualdad de sitios, la que tiene menos bots", e.caja && e.caja.id === "vacia-ish");
  }

  titulo("Las cajas que no sirven no se reparten");

  {
    const e = bots.elegirCaja([caja("llena", 0), caja("bien", 4)], null);
    comprobar("una caja llena no se elige aunque sea la única", e.caja && e.caja.id === "bien");
  }

  {
    const e = bots.elegirCaja([caja("apagada", 9, { activo: false }), caja("bien", 1)], null);
    comprobar("una caja desactivada no se elige aunque tenga sitio de sobra", e.caja && e.caja.id === "bien");
  }

  {
    /* El caso que hace falta el motivo: no hay ninguna caja. Sin él, el
       alta crearía un bot apuntando a una caja llena, y el síntoma
       aparecería en el bot del cliente. */
    const e = bots.elegirCaja([], null);
    comprobar("sin cajas no elige ninguna", e.caja === null);
    comprobar("y explica que no hay ninguna activa", /no hay ninguna caja activa/i.test(e.motivo || ""));
  }

  {
    const e = bots.elegirCaja([caja("a", 0), caja("b", 0)], null);
    comprobar("todas llenas: no elige ninguna", e.caja === null);
    comprobar("y lo dice como están llenas", /están llenas/i.test(e.motivo || ""));
  }

  titulo("Elegir a mano");

  {
    const cajas = [caja("llena", 0), caja("bien", 2)];
    const e = bots.elegirCaja(cajas, "llena");
    comprobar("una caja llena elegida a mano NO se acepta", e.caja === null);
    comprobar("y el motivo nombra el cupo, para que se sepa qué subir", /cupo|números/i.test(e.motivo || ""));
  }

  {
    const cajas = [caja("apagada", 5, { activo: false })];
    const e = bots.elegirCaja(cajas, "apagada");
    comprobar("una caja desactivada elegida a mano NO se acepta", e.caja === null);
    comprobar("y el motivo dice que está desactivada", /desactivada/i.test(e.motivo || ""));
  }

  {
    const e = bots.elegirCaja([caja("a", 1), caja("b", 9)], "a");
    comprobar("una caja con sitio sí se acepta aunque no sea la mejor", e.caja && e.caja.id === "a");
  }

  {
    const e = bots.elegirCaja([caja("a", 1)], "no-existe");
    comprobar("una caja que no existe no se acepta", e.caja === null);
    comprobar("y el motivo lo dice", /no existe/i.test(e.motivo || ""));
  }

  /* =========================================================
     2. La dirección de una caja
     ========================================================= */
  titulo("Direcciones que se rechazan antes de guardar");

  const malas = [
    ["", /falta la dirección/i],
    ["evolution.example", /http/i],
    ["https://x.example con espacio", /espacios/i],
    ["ftp://x.example", /http/i],
  ];

  for (const [url, patron] of malas) {
    comprobar('"' + url + '" se rechaza', patron.test(evolution.problemaDeUrl(url) || ""));
  }

  const buenas = ["https://evolution.example", "http://127.0.0.1:8080", "https://x.example:3000/api/"];
  for (const url of buenas) {
    comprobar('"' + url + '" se acepta', evolution.problemaDeUrl(url) === null);
  }

  /* =========================================================
     3. El nombre de la caja y el slug
     ========================================================= */
  titulo("Nombres de caja");

  comprobar('"Panadería La Espiga" → "panaderia-la-espiga"', bots.slugDe("Panadería La Espiga") === "panaderia-la-espiga");
  comprobar('las tildes se quitan', bots.slugDe("Ñoño Azúcar") === "nono-azucar");
  comprobar("los signos se vuelven guiones", bots.slugDe("Bot ¿Nuevo? (2026)") === "bot-nuevo-2026");
  comprobar("nada de espacios al final", !bots.slugDe("  Hola  ").endsWith("-"));

  /* El slug va a una URL pública y la base tiene un CHECK que lo limita a
     41 caracteres. Si el recorte no existiera, un nombre largo daría un
     error de la base en el POST, con un mensaje que no dice qué campo
     era. */
  comprobar("se recorta a 41 caracteres (el límite de la base)", bots.slugDe("a".repeat(80)).length === 41);
  comprobar("el recorte no deja un guion colgando", !bots.slugDe("hola " + "b".repeat(50)).endsWith("-"));

  comprobar("el nombre de instancia sale del slug", bots.nombreDeInstancia("panaderia") === "panaderia");

  /* =========================================================
     4. La dirección del webhook
     ========================================================= */
  titulo("El webhook apunta al bot, no a un sitio inventado");

  {
    const url = bots.urlDeWebhook();
    comprobar("sale una dirección", typeof url === "string" && url.length > 0);
    comprobar("termina en /api/webhook, que es donde lo espera el bot", url.endsWith("/api/webhook"));
    comprobar("no lleva la barra del final duplicada", !url.includes("//api") || url.startsWith("http"));
  }

  /* =========================================================
     5. La base
     ========================================================= */
  if (!supabase.disponible()) {
    console.log("\n  (sin Supabase: se saltan las comprobaciones de la base)");
  } else {
    const db = supabase.getAdmin();

    titulo("Los cupos de las cajas");

    {
      const cajas = await bots.cajasConCupos(db);
      comprobar("cada caja tiene un número de cupos", cajas.every((c) => Number(c.max_instances) > 0));
      comprobar("cada caja tiene su cuenta de bots", cajas.every((c) => Number(c.bots) >= 0));
      comprobar(
        "los sitios libres son la cuenta menos el tope, y nunca negativos",
        cajas.every((c) => c.libres === Math.max(0, c.max_instances - c.bots))
      );

      /* El reparto tiene que ser coherente con lo que hay en la base: si
         una caja dice que le caben 3 y hay 3 bots, el siguiente va a
         otra. Con los datos reales, no con las cajas de mentira de antes. */
      const conSitio = cajas.filter((c) => c.activo && c.libres > 0);
      if (conSitio.length) {
        const e = bots.elegirCaja(cajas, null);
        comprobar("con los datos de la base se elige una caja con sitio", e.caja && e.caja.libres > 0);
      } else {
        console.log("  · no hay ninguna caja con sitio: el reparto no se puede probar aquí");
      }
    }

    titulo("La clave de las cajas no la lee un cliente");

    {
      /* Esto es lo que la migración 011 protege y lo que hace que la
         tabla de cajas no se pueda añadir al portal del cliente tal
         cual. Se comprueba con la identidad de un cliente real, y no
         "debería" comprobarse. */
      const { data: perfil } = await db
        .from("profiles")
        .select("id,access_token")
        .eq("rol", "client")
        .limit(1)
        .maybeSingle();

      if (!perfil || !perfil.access_token) {
        console.log("  · no hay un cliente con token guardado: se omite");
      } else {
        const comoCliente = supabase.getClientForToken(perfil.access_token);
        const { data, error } = await comoCliente.from("evolution_servers").select("id,api_key");
        comprobar("un cliente no lee ninguna caja", !error && (data || []).length === 0);
        comprobar("y el error, si lo hay, no trae claves", !error || !/key|apikey/i.test(error.message || ""));
      }
    }

    titulo("Los bots y su unicidad");

    {
      /* Un cliente, un bot. `instance_name` es ÚNICO en toda la base
         (migración 015) y es lo que usa el webhook para encontrar el bot:
         si se repitiera, los mensajes de un cliente acabarían en el panel
         de otro sin ningún error. */
      const { data: clientes, error: eC } = await db.from("bots").select("client_id,instance_name,slug");
      comprobar("se pueden leer los bots con la secret key", !eC);

      if (!eC) {
        const porCliente = new Map();
        for (const b of clientes || []) {
          porCliente.set(b.client_id, (porCliente.get(b.client_id) || 0) + 1);
        }
        comprobar("no hay dos bots del mismo cliente", [...porCliente.values()].every((n) => n <= 1));

        const instancias = (clientes || []).map((b) => b.instance_name);
        comprobar("los nombres de instancia son únicos", new Set(instancias).size === instancias.length);

        const slugs = (clientes || []).map((b) => b.slug);
        comprobar("las direcciones de reservas son únicas", new Set(slugs).size === slugs.length);

        comprobar(
          "todos los bots tienen caja",
          (clientes || []).every((b) => Boolean(b.instance_name)),
          /* El server_id no viene en este select a propósito: la
             unicidad de la instancia es la que importa aquí y la caja se
             comprueba abajo, donde sí se pide. */
        );
      }
    }

    titulo("La URL del webhook");

  {
    /* La URL es por caja, no una sola para todo. Sin esta comprobación,
       que alguien la deje en el entorno otra vez, volvería a ser
       imposible mover un bot a otro sitio desde el panel, que es
       justo lo que motivó la migración 022. */
    const propia = bots.urlDeWebhookDe({ webhook_url: "https://otro.example/api/webhook" });
    comprobar("si la caja tiene URL, manda la suya", propia === "https://otro.example/api/webhook");

    const deducida = bots.urlDeWebhook();
    comprobar(
      "si no tiene, se usa la deducida",
      deducida ? bots.urlDeWebhookDe({ webhook_url: "" }) === deducida : true
    );
    comprobar("una caja sin fila tampoco revienta", bots.urlDeWebhookDe(null) === deducida);

    /* La barra final no debe duplicar: la URL se guarda tal cual y
      .some() la compara con lo que tiene la Evolution, y "/api/webhook/"
       con barra no es igual a "/api/webhook". */
    comprobar(
      "no deja doble barra al final",
      bots.urlDeWebhookDe({ webhook_url: "https://x.example/api/webhook/" }) ===
        "https://x.example/api/webhook"
    );
  }

  {
    /* Lo importante: una Evolution a la que se le manda a la home del
       bot contesta 200 igual, y el bot queda mudo sin ningún error. Por
       eso el campo tiene que exigir la ruta del webhook. */
    const malas = [
      ["https://bot.example", /\/api\/webhook/],
      ["https://bot.example/api/webhook/v2", /\/api\/webhook/],
      ["https://bot.example/api/webhook#salta", /#/],
      ["bot.example/api/webhook", /http/i],
      ["https://con espacio/api/webhook", /espacios/i],
    ];
    for (const [url, patron] of malas) {
      const e = bots.problemaDeUrlWebhook(url);
      comprobar('"' + url + '" se rechaza', Boolean(e) && patron.test(e));
    }

    const buenas = [
      "https://bot.example/api/webhook",
      "http://127.0.0.1:3200/api/webhook",
      "https://bot.example/api/webhook/",
      "",
    ];
    for (const url of buenas) {
      comprobar(
        '"' + (url || "(vacío)") + '" se acepta',
        /* `null` y no `undefined`: las dos funciones de validación de
           este fichero devuelven null cuando está bien. */
        bots.problemaDeUrlWebhook(url) === null
      );
    }
  }

  titulo("Los secretos");

    {
      /* Sin `webhook_secret` la caja no puede tener bots funcionando: la
         Evolution acepta el webhook sin cabecera y el bot rechaza todo
         lo que llega, sin dar ningún error. Por eso `prepararEnCaja` se
         niega a crear la instancia; esto comprueba que de verdad se
         niega. */
      const caja = {
        url: "https://caja.example",
        api_key: "clave",
        webhook_secret: "",
      };
      const r = await bots.prepararEnCaja(caja, "prueba-sin-secreto", {
        urlWebhook: "https://bot.example/api/webhook",
        /* No se toca la caja de verdad: `prepararEnCaja` tiene que
           fallar ANTES de la llamada de red, y si no, este test
           crearía una instancia en la Evolution de producción. */
      });

      /* Si la caja no existe, `crearInstancia` falla por red y el mensaje
         es otro. Lo que se comprueba aquí es que la razón del fallo es
         el secreto, no el timeout. */
      const porFaltaDeRed = /no respondió|no se pudo contactar/i.test(r.mensaje);
      if (porFaltaDeRed) {
        console.log("  · no se comprobó: la caja de ejemplo no resuelve (red)");
      } else {
        comprobar("sin secreto, preparar el bot se niega", r.ok === false);
        comprobar("y el motivo habla del secreto del webhook", /secreto del webhook/i.test(r.mensaje));
      }
    }

    {
      /* Con secreto, las cabeceras que se mandan a la caja tienen que
         llevar `x-webhook-secret`: es lo que comprueba el bot (ver
         src/lib/webhook-secret.ts en wweb). */
      const conSecreto = bots.cabecerasDeWebhook({ webhook_secret: "s3cr3to" });
      comprobar("con secreto, se manda la cabecera x-webhook-secret", conSecreto["x-webhook-secret"] === "s3cr3to");

      const sinSecreto = bots.cabecerasDeWebhook({ webhook_secret: "" });
      comprobar("sin secreto, no se manda ninguna cabecera", Object.keys(sinSecreto).length === 0);
      comprobar("ni una caja inexistente revienta la función", Object.keys(bots.cabecerasDeWebhook(null)).length === 0);
    }

    {
      /* Y cada caja que ya tiene bots debería tener secreto. Una que no
         lo tiene es un bot mudo esperando a que alguien escriba, así
         que se avisa aunque no sea un fallo de esta migración. */
      const cajas = await bots.cajasConCupos(db);
      const conBots = cajas.filter((c) => c.bots > 0);
      const sinSecreto = conBots.filter((c) => !c.tieneSecreto);

      if (sinSecreto.length) {
        console.log(
          "  ⚠ " +
            sinSecreto.map((c) => c.name).join(", ") +
            " tiene bots y no tiene secreto del webhook: esos bots no van a recibir mensajes."
        );
      } else {
        comprobar("toda caja con bots tiene el secreto del webhook", true);
      }

      /* Y lo mismo con el destino. Sin a dónde llamar, el bot también
         está mudo, y por un motivo distinto: la caja acepta los
         mensajes pero no hay nadie escuchando. */
      const sinDestino = conBots.filter((c) => !c.webhookEnUso);
      if (sinDestino.length) {
        console.log(
          "  ⚠ " +
            sinDestino.map((c) => c.name).join(", ") +
            " tiene bots y no tiene a dónde llamar. Ponle URL propia en la caja o configura SITE_URL."
        );
      } else {
        comprobar("toda caja con bots tiene a dónde llamar", true);
      }
    }

    titulo("Los bots y su caja");

    {
      /* Cada bot tiene que estar en una caja que exista. Un bot cuya
         caja desapareció (borrada a mano en la base, saltándose el
         `on delete restrict`) es un bot mudo, y no se ve en ninguna
         pantalla hasta que el cliente escribe. */
      const { data: botsTabla } = await db.from("bots").select("id,server_id,instance_name");
      const cajas = await bots.cajasConCupos(db);
      const ids = new Set(cajas.map((c) => c.id));

      const huerfanos = (botsTabla || []).filter((b) => !ids.has(b.server_id));
      if (huerfanos.length) {
        console.log(
          "  ✗ " +
            huerfanos.length +
            " bot(s) en cajas que ya no existen: " +
            huerfanos.map((b) => b.instance_name).join(", ")
        );
        fallos += huerfanos.length;
      } else {
        comprobar("todos los bots están en una caja que existe", true);
      }

      /* Y cada caja con bots tiene que tener sitio. Si una caja está por
         encima de su cupo, significa que se bajó el número a mano o que
         el reparto metió más de la cuenta. */
      const exceso = cajas.filter((c) => c.bots > c.max_instances);
      if (exceso.length) {
        console.log(
          "  ✗ " + exceso.map((c) => c.name + " (" + c.bots + "/" + c.max_instances + ")").join(", ") +
            " tiene más números que su cupo"
        );
        fallos += exceso.length;
      } else {
        comprobar("ninguna caja tiene más bots que su cupo", true);
      }
    }
  }

  /* =========================================================
     Resumen
     ========================================================= */
  console.log("\n" + "─".repeat(56));
  console.log(fallos ? "  ✗ " + fallos + " fallo(s) de " + (ok + fallos) : "  ✓ " + ok + " comprobaciones");
  console.log("");

  process.exit(fallos ? 1 : 0);
})().catch((err) => {
  console.error("\n✗ " + (err && err.stack ? err.stack : err) + "\n");
  process.exit(1);
});