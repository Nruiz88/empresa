/* Pruebas de lib/evolution.js: el cliente de Evolution API.
   ------------------------------------------------------------
   Se prueba contra un servidor HTTP de mentira, no contra el real.
   Tres cosas que tienen que estar en el contrato:

     1. La clave va en la cabecera `apikey`, NO en Authorization.
     2. NUNCA aparece en un mensaje de error ni en un throw. Es la
        credencial que da acceso al WhatsApp del cliente.
     3. Un timeout, un 500 o Evolution caído devuelven `{ok:false}`.
        Nunca lanzan: si lanzan, cada ruta necesita un try/catch y en
        alguna se olvidará.

   NO se prueba contra el servidor real a propósito: su API key da
   acceso a los números, y una prueba no debería poder mandar mensajes.
   Para eso está `npm run verificar:evolution`, que sí lo hace y avisa. */

const http = require("http");

const evo = require("../lib/evolution");

let ok = 0;
let fallos = 0;
function comprobar(desc, cond, extra) {
  console.log(`  ${cond ? "✓" : "✗"} ${desc}${extra ? "  → " + extra : ""}`);
  if (cond) ok++;
  else fallos++;
}

const CLAVE = "CLAVE-SECRETA-DE-EVOLUTION-123456";

/* Servidor de mentira que responde lo que le digamos. */
function levantar(manejador) {
  return new Promise((resolve) => {
    const servidor = http.createServer((req, res) => manejador(req, res));
    servidor.listen(0, "127.0.0.1", () => {
      resolve({ servidor, url: "http://127.0.0.1:" + servidor.address().port });
    });
  });
}

(async () => {
  console.log("\n── autenticación ──");

  {
    let recibido = null;
    let cuerpo = null;
    const { servidor: s, url } = await levantar((req, res) => {
      recibido = req.headers;
      let d = "";
      req.on("data", (c) => (d += c));
      req.on("end", () => {
        cuerpo = d;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify([{ name: "inst-a" }]));
      });
    });

    const r = await evo.probarConexion(url, CLAVE);

    comprobar("la clave va en la cabecera apikey", recibido && recibido.apikey === CLAVE);
    comprobar("y NO en Authorization", !(recibido && recibido.authorization));
    comprobar("envía Content-Type JSON", recibido && /application\/json/.test(recibido["content-type"] || ""));
    comprobar("el resultado sale bien", r.ok === true);
    comprobar("con los datos", Array.isArray(r.data) && r.data[0].name === "inst-a", JSON.stringify(r.data));

    s.close();
  }

  console.log("\n── la clave NUNCA sale ──");

  {
    /* 401 con la clave en el cuerpo, que es lo que devuelve
       Evolution cuando se rechaza. */
    const { servidor: s, url } = await levantar((req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "unauthorized: " + CLAVE }));
    });

    const r = await evo.probarConexion(url, CLAVE);
    comprobar("falla", r.ok === false);
    comprobar("devuelve el estado", r.status === 401);
    comprobar(
      "y el mensaje NO lleva la clave",
      !JSON.stringify(r).includes(CLAVE),
      JSON.stringify(r.message || "")
    );
    /* La clave se sustituye, no se quita el mensaje entero: si no,
       cuando algo falla no queda ninguna pista. */
    comprobar(
      "pero el mensaje sigue siendo útil",
      (r.message || "").includes("unauthorized"),
      r.message
    );

    s.close();
  }

  {
    /* URL inexistente: el error de red no debe_FILTER la clave. */
    const r = await evo.probarConexion("http://127.0.0.1:1/", CLAVE);
    comprobar("error de red no lanza", r.ok === false && typeof r.message === "string");
    comprobar("y tampoco lleva la clave", !JSON.stringify(r).includes(CLAVE), r.message);
  }

  {
    const r = await evo.probarConexion("https://evolution.example", "");
    comprobar(
      "sin api_key dice que falta, sin llamar a nadie",
      r.ok === false && r.message.includes("api_key"),
      r.message
    );
  }

  console.log("\n── nunca lanza ──");

  {
    /* Cuerpo vacío con 200: varios endpoints de Evolution hacen esto.
       Un res.json() a pelo reventaría aquí, cuando el mensaje ya se ha
       enviado. */
    const { servidor: s, url } = await levantar((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("");
    });
    const r = await evo.enviarTexto(url, CLAVE, "inst-a", "34600111222", "hola");
    comprobar("200 con cuerpo vacío no es error", r.ok === true, "status " + r.status);
    comprobar("y los datos son null", r.data === null);
    s.close();
  }

  {
    /* Texto plano donde se esperaba JSON. */
    const { servidor: s, url } = await levantar((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
    });
    const r = await evo.enviarTexto(url, CLAVE, "inst-a", "34600111222", "hola");
    comprobar("texto plano donde había JSON no revienta", r.ok === true);
    comprobar("y se devuelve tal cual", r.data === "OK");
    s.close();
  }

  {
    /* 500 con JSON. */
    const { servidor: s, url } = await levantar((req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "boom" }));
    });
    const r = await evo.enviarTexto(url, CLAVE, "inst-a", "34600111222", "hola");
    comprobar("un 500 no lanza", r.ok === false && r.status === 500);
    comprobar("y trae el mensaje del servidor", r.message === "boom", r.message);
    s.close();
  }

  {
    /* 500 SIN cuerpo. El `message` no existe: tiene que decirlo sin
       inventarse nada. */
    const { servidor: s, url } = await levantar((req, res) => {
      res.writeHead(502);
      res.end("");
    });
    const r = await evo.enviarTexto(url, CLAVE, "inst-a", "34600111222", "hola");
    comprobar("500 sin cuerpo no es una excepción", r.ok === false);
    comprobar("y el mensaje menciona el estado", /502/.test(r.message || ""), r.message);
    s.close();
  }

  console.log("\n── timeout ──");

  {
    /* Un servidor que no contesta. Sin AbortController esto se queda
       colgado hasta que agote el proxy, y el usuario ve "Guardando…"
       indefinidamente. */
    const { servidor: s, url } = await levantar(() => {
      /* no responde nunca */
    });

    const t0 = Date.now();
    const r = await evo.pedir(url, CLAVE, "/instance/fetchInstances", { timeout: 400 });
    const ms = Date.now() - t0;

    comprobar("aborta en vez de colgarse", r.ok === false);
    comprobar("y el mensaje lo dice", /no respondió/.test(r.message || ""), r.message);
    comprobar("tardó lo del timeout, no más", ms < 3000, ms + " ms");

    s.close();
  }

  {
    /* El envío usa timeout largo a propósito: si no, marcaría como
       fallido un mensaje que sí había salido. */
    const { servidor: s, url } = await levantar(() => {
      /* no responde */
    });

    const t0 = Date.now();
    const r = await evo.enviarTexto(url, CLAVE, "inst-a", "34600111222", "hola", undefined);
    const ms = Date.now() - t0;

    comprobar("el envío respeta su timeout propio", r.ok === false);
    comprobar("que es más largo que el normal", ms >= evo.TIMEOUT_ENVIO - 500, ms + " ms de " + evo.TIMEOUT_ENVIO);

    s.close();
  }

  console.log("\n── rutas y cuerpos ──");

  {
    let ruta = "";
    let cuerpo = null;
    const { servidor: s, url } = await levantar((req, res) => {
      ruta = req.url;
      let d = "";
      req.on("data", (c) => (d += c));
      req.on("end", () => {
        cuerpo = d;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
      });
    });

    await evo.enviarTexto(url, CLAVE, "inst-a", "34600111222", "hola", 500);
    comprobar("enviarTexto va a /message/sendText/", ruta.startsWith("/message/sendText/inst-a"), ruta);
    const c = JSON.parse(cuerpo);
    comprobar("con el número", c.number === "34600111222");
    comprobar("y el texto", c.text === "hola");
    comprobar("y el retraso", c.delay === 500);

    await evo.enviarBotones(url, CLAVE, "inst-a", "34600", "Titulo", "Desc", [
      { displayText: "Si", id: "si" },
      { displayText: "No", id: "no" },
    ], "pie");
    comprobar("enviarBotones va a su ruta", ruta.startsWith("/message/sendButtons/"), ruta);
    const c2 = JSON.parse(cuerpo);
    comprobar("manda los botones con su forma", c2.buttons[0].type === "reply" && c2.buttons[0].id === "si");
    comprobar("y el pie", c2.footer === "pie");

    await evo.conectar(url, CLAVE, "inst-a");
    comprobar("conectar va a /instance/connect/", ruta.startsWith("/instance/connect/inst-a"), ruta);
    comprobar("con el sufijo que espera Evolution", ruta.endsWith("?number="), ruta);

    await evo.ponerWebhook(url, CLAVE, "inst-a", "https://bot.example/webhook", ["MESSAGES.UPSERT"], { x: "y" });
    const c3 = JSON.parse(cuerpo);
    comprobar("el webhook va envuelto en 'webhook'", Boolean(c3.webhook));
    comprobar("con la url que le pasamos", c3.webhook.url === "https://bot.example/webhook");
    comprobar("y solo los eventos pedidos", c3.webhook.events.length === 1 && c3.webhook.events[0] === "MESSAGES.UPSERT");
    comprobar("y las cabeceras extra", c3.webhook.headers.x === "y");

    s.close();
  }

  {
    /* El nombre de instancia va en la ruta, y va escapado. Con un
       nombre con "/" o espacios sin escapar se rompe la URL. */
    let ruta = "";
    const { servidor: s, url } = await levantar((req, res) => {
      ruta = req.url;
      res.writeHead(200);
      res.end("{}");
    });

    await evo.estadoDeConexion(url, CLAVE, "mi instancia/con barra");
    comprobar("el nombre de instancia va escapado", ruta === "/instance/connectionState/mi%20instancia%2Fcon%20barra", ruta);

    s.close();
  }

  console.log("\n── createInstance: v2 y luego v1 ──");

  {
    /* v2: 404 → se reintenta por la v1. Es el despliegue con
       Evolution antiguo, que devuelve un 404 que no dice nada de
       versiones. */
    const { servidor: s, url } = await levantar((req, res) => {
      if (req.url === "/instance/create") {
        res.writeHead(404);
        res.end("{}");
        return;
      }
      res.writeHead(200);
      res.end('{"ok":true}');
    });

    const r = await evo.crearInstancia(url, CLAVE, "inst-b");
    comprobar("si la v2 da 404, prueba la v1", r.ok === true);

    s.close();
  }

  {
    const { servidor: s, url } = await levantar((req, res) => {
      res.writeHead(200);
      res.end('{"ok":true}');
    });
    const r = await evo.crearInstancia(url, CLAVE, "inst-b");
    comprobar("si la v2 va bien, no reintenta", r.ok === true);
    s.close();
  }

  console.log("\n── servidor(): leer de la tabla ──");

  {
    /* Se usa un id que no existe: lo que importa aquí es que falla
       con un mensaje claro y no con una excepción. */
    const r = await evo.servidor("00000000-0000-0000-0000-000000000000");
    comprobar("un id inexistente da error claro", r.ok === false);
    comprobar("y nombra el id que buscó", r.message && r.message.includes("00000000"), r.message);
  }

  console.log(fallos ? `\n  ${fallos} fallo(s)\n` : "\n  Todo correcto\n");
  process.exit(fallos ? 1 : 0);
})();
