/* =========================================================
   Nexo Studio — Flujo de acceso entre el panel y un servicio
   ------------------------------------------------------------
   Prueba el camino COMPLETO, con los dos servidores de verdad:

     panel (3000)  ──firma ticket──▶  bot (3200)  ──cookie propia──▶  /mi-bot

   Lo que se comprueba, y por qué importa cada cosa:

     · El panel firma y redirige con el ticket en el # (no en ?)
     · El bot canjea el ticket y pone SU cookie, no la del panel
     · El cliente SIN suscripción no entra
     · Con la suscripción caducada, no entra
     · Un ticket manipulado no entra
     · La cookie del panel NO sirve en el bot (ni al revés)
     · Con la sesión revocada, el bot lo echa

   Necesita ambos servidores levantados. Los levanta y los para
   solo, así que se puede ejecutar sin hacer nada a mano.
   ========================================================= */

const { spawn } = require("child_process");
const path = require("path");
require("../../lib/env").load();

/* El usuario de staff se busca por ROL, no por correo. */
const { staff } = require("../../lib/staff");

const PUERTO_PANEL = 3101;
const PUERTO_BOT = 3201;

const MARCA = "-test-acceso-servicio-";

/* Un usuario de equipo de verdad, para probar que staff entra al
   servicio sin suscripción. Hace falta uno real (no uno creado aquí)
   porque el ticket lleva dentro su access_token, y ese token tiene
   que pasar las políticas RLS de staff en la base.

   OJO: son las credenciales de desarrollo de NOTAS-LOCAL.md. Este
   test no es un sitio para credenciales reales, y en un entorno
   compartido esto no funcionaría. Para producción, un usuario de
   servicio propio. */
/* ─────────────────────────────────────────────────────────
   LAS CREDENCIALES DEL STAFF

   El correo sale de la base, por ROL, y se resuelve dentro de una
   función: un `await` en el nivel de módulo no vale en CommonJS y el
   archivo ni siquiera carga.

   La contraseña NO sale de la base —Supabase no la deja leer— y no
   tiene relleno. Antes había un `|| "PanelPrueba2026"` que era una
   contraseña de verdad escrita en el repositorio, y funcionaba con el
   admin viejo, así que nadie la miró nunca.

   ── POR QUÉ NO SE ESCRIBE EN EL FICHERO ──

   Porque un fichero versionado es público para quien clone el
   repositorio, y una contraseña de relleno que funciona es una
   contraseña de verdad. Va en el entorno, que es lo único que no se
   guarda en el historial de git.
   ───────────────────────────────────────────────────────── */

async function credencialesDelStaff() {
  const email = process.env.TEST_STAFF_EMAIL || (await staff()).email;
  const password = process.env.TEST_STAFF_PASSWORD;

  if (!password) {
    console.error("\n  x falta la contraseña del staff (TEST_STAFF_PASSWORD).");
    console.error("    Esta prueba entra al panel de verdad, así que necesita");
    console.error("    una cuenta real. No hay contraseña de relleno:");
    console.error("");
    console.error("      TEST_STAFF_PASSWORD=... npm run test:acceso");
    console.error("");
    process.exit(1);
  }

  return { email, password };
}

let ok = 0;
let fallos = 0;

/* El tercer argumento (detalle) se imprimía solo cuando la
   comprobación PASABA, y cuando fallaba se perdía. Con un "✗" sin
   explicación no hay forma de saber qué mirar, que es justo cuando
   hace falta. */
function comprobar(desc, condicion, extra) {
  const cola = extra ? "  → " + extra : "";
  if (condicion) {
    console.log("  ✓ " + desc + cola);
    ok++;
  } else {
    console.log("  ✗ " + desc + cola);
    fallos++;
  }
}

function seccion(t) {
  console.log("\n── " + t + " " + "─".repeat(Math.max(0, 46 - t.length)));
}

/* Recorta un destino que lleva el ticket dentro.

   El ticket contiene el access_token del usuario. Caduca en 60 s, pero
   eso no lo hace seguro: se queda escrito en el log de la consola, en
   el historial de CI, en un screenshot... Imprimirlo entero en el
   detalle de una comprobación es justo el fallo que el diseño del
   fragmento evita en los logs del servidor. */
function sinTicket(url) {
  const s = String(url || "");
  if (s.length <= 70) return s;
  return s.slice(0, 45) + "… (ticket dentro)";
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function esperarPuerto(url, intentos = 40) {
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(url, { redirect: "manual" });
      return r;
    } catch {
      await dormir(400);
    }
  }
  throw new Error("El servidor no arrancó: " + url);
}

/** Un cliente con cookies propias por petición */
function cliente() {
  const cookies = new Map();
  return {
    guardar(res) {
      const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const c of sc) {
        const par = c.split(";")[0];
        const i = par.indexOf("=");
        const nombre = par.slice(0, i).trim();
        const valor = par.slice(i + 1).trim();
        if (!valor) cookies.delete(nombre);
        else cookies.set(nombre, valor);
      }
    },
    cabecera() {
      return [...cookies.entries()].map(([k, v]) => k + "=" + v).join("; ");
    },
    tiene(nombre) {
      return cookies.has(nombre);
    },
    olvidar(nombre) {
      cookies.delete(nombre);
    },
  };
}

let supabase = null;
/* El cliente admin. Se declara fuera para que las funciones auxiliares
   (crearClienteConSuscripcion, etc.) lo usen sin pasárselo. */
let db = null;
let panel = null;
let bot = null;
let userId = null;
let clientId = null;

/* Lo que había en `modules` antes de que este test lo tocara.

   ESTE `let` TIENE QUE ESTAR AQUÍ Y NO DENTRO DE LA IIFE.

   Estaba declarado con `const` dentro del `(async () => { ... })`, y
   la limpieza vive en el `.finally()` de la cadena de fuera. Son
   ámbitos distintos: la limpieza no lo veía y, al no estar
   definido, tiraba `moduloAntes is not defined` dentro de un
   try/catch que solo imprime un aviso.

   Consecuencia, comprobada: el test pasa sus 46 comprobaciones,
   imprime "✓ Las 46 comprobaciones pasan", y al limpiar deja
   `modules.bot_whatsapp.url` en `https://proveedor-externo.example`,
   un dominio que no existe. O sea, el botón "Abrir" del bot queda
   roto para todos los clientes que lo tengan contratado, y el test
   que lo ha roto reporta éxito.

   El orden de captura y restauración está bien; lo que estaba mal era
   dónde vivían las variables, que es justo lo que no se ve leyendo la
   lógica de limpieza. */
let moduloAntes = null;

/* ── LA URL REAL DEL BOT, PARA REPARAR ──

   Es lo que tiene que quedar en la base cuando este test acaba, y lo
   que se pone si encuentra una dirección local ahí.

   Está en una constante y no "deducido de SITE_URL" a propósito: si
   se dedujera, un cambio de dominio cambiaría también lo que se
   repara, y un fallo en la deduplicación dejaría la url del bot
   apuntando al sitio equivocado. Un valor que se usa para REPARAR
   tiene que poder leerse, no calcularse.

   Es la misma idea que la nota de `microservicios`: un dominio
   inventado guardado como si fuera real es el peor fallo posible
   aquí, porque no se ve hasta que un cliente pincha en "Abrir". */
const URL_REAL_BOT = "https://bot.panel-niconqn.duckdns.org";

async function crearClienteConSuscripcion(estado, terminaEn) {
  const email = MARCA + "x@ejemplo.com";

  /* Si una ejecución anterior falló a medias, el usuario de Auth
     sigue ahí. `createUser` falla si el email ya existe y devuelve
     `data: null`, así que el fallo aparecía mucho más abajo como
     "Cannot read properties of null (reading 'id')" — en una línea
     que no dice nada sobre la causa real, a cuatro pantallas del
     problema.

     Se limpia antes de empezar, en vez de fiarse del `finally`. Un
     `finally` no se ejecuta si el proceso muere, y este es
     exactamente el caso en el que el proceso muere. */
  const { data: existentes } = await db.auth.admin.listUsers({ perPage: 200 });
  for (const u of (existentes && existentes.users) || []) {
    if (u.email === email) {
      await db.auth.admin.deleteUser(u.id);
    }
  }

  const { data: cli } = await db
    .from("clients")
    .insert({
      nombre: "Prueba " + MARCA,
      empresa: "Prueba " + MARCA,
      email: email,
    })
    .select("id")
    .single();

  const { data: usr, error: errorUser } = await db.auth.admin.createUser({
    email: email,
    password: "PruebaServicioAcceso123",
    email_confirm: true,
  });

  /* Si esto falla, se dice CUÁL, en vez de dejar que reviente tres
     líneas más abajo con un null. */
  if (errorUser || !usr || !usr.user) {
    throw new Error(
      "No se pudo crear el usuario de prueba: " +
        (errorUser ? errorUser.message : "Supabase devolvió un usuario vacío")
    );
  }

  await db.from("profiles").insert({
    id: usr.user.id,
    rol: "client",
    client_id: cli.id,
    nombre: "Prueba Servicio",
    activo: true,
  });

  await db.from("suscripciones").insert({
    client_id: cli.id,
    module_id: "bot_whatsapp",
    estado: estado,
    inicia_en: "2026-01-01",
    termina_en: terminaEn || null,
  });

  return { userId: usr.user.id, clientId: cli.id };
}

async function entrarEnElPanel(cookie) {
  const base = "http://127.0.0.1:" + PUERTO_PANEL;
  const r = await fetch(base + "/panel/login", { redirect: "manual" });
  cookie.guardar(r);
  const html = await r.text();
  const csrf = (html.match(/name="_csrf" value="([^"]+)"/) || [])[1];

  const r2 = await fetch(base + "/panel/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie.cabecera(),
    },
    body: new URLSearchParams({
      email: MARCA + "x@ejemplo.com",
      password: "PruebaServicioAcceso123",
      _csrf: csrf,
    }),
    redirect: "manual",
  });
  cookie.guardar(r2);
  return r2;
}

/** El flujo completo: panel -> ticket -> bot -> cookie propia */
async function irAlBot(cookie) {
  const r = await fetch(
    "http://127.0.0.1:" + PUERTO_PANEL + "/panel/servicios/bot_whatsapp/entrar",
    { redirect: "manual", headers: { Cookie: cookie.cabecera() } }
  );

  const destino = r.headers.get("location") || "";
  /* El ticket debe venir en el #, nunca en el ?. */
  const conHash = destino.includes("#ticket=");
  const conQuery = /[?&]ticket=/.test(destino);
  const ticket = conHash ? destino.split("#ticket=")[1] : "";

  if (!ticket) return { destino, conHash, conQuery, status: null };

  const rBot = await fetch("http://127.0.0.1:" + PUERTO_BOT + "/entrar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket }),
  });
  const cuerpo = await rBot.json();

  return {
    destino,
    conHash,
    conQuery,
    ticket,
    status: rBot.status,
    cuerpo,
    cookieBot: (rBot.headers.getSetCookie ? rBot.headers.getSetCookie() : [])[0] || "",
  };
}

(async () => {
  console.log("\n═══ Acceso del panel a un microservicio ═══\n");

  process.env.PORT = String(PUERTO_PANEL);
  process.env.BOT_PORT = String(PUERTO_BOT);
  process.env.PANEL_HOST = "127.0.0.1";
  process.env.BOT_HOST = "127.0.0.1";
  process.env.NODE_ENV = "test";
  /* El secret lo comparten los dos, como en producción. */
  process.env.SERVICE_SECRET = "secret-compartido-en-la-prueba-de-acceso-servicio";
  /* Y la URL PÚBLICA del bot. El panel deduce el subdominio del
     dominio que haya, y en esta máquina el dominio es 127.0.0.1, así
     que sin esta variable deduciría el puerto 3200 (el de
     desarrollo) en vez del 3201 que usa el bot de la prueba, y
     mandaría al usuario a un sitio donde no hay nada.

     En Coolify esto no hace falta: el dominio se declara en la
     interfaz del servicio. Está aquí porque la deducción necesita
     saber el puerto cuando el dominio es local. */
  process.env.BOT_URL = "http://127.0.0.1:" + PUERTO_BOT;

  supabase = require("../../lib/supabase");
  db = supabase.getAdmin();

  /* --- El módulo tiene que estar disponible para la prueba ---

     Se guarda su estado REAL antes de tocarlo, porque el
     almacenamiento es de datos que importan: `url` es la dirección a
     la que manda el botón "Abrir" de todos los clientes. Antes la
     limpieza ponía un valor fijo ("https://bot.midominio.com") en vez
     de devolver el que había, así que después de cualquier ejecución
     el botón apuntaba a un dominio inventado. Lo que se tiene que
     devolver es lo que estaba. */
  const { data: moduloAntesLeido } = await db
    .from("modules")
    .select("url,disponible")
    .eq("id", "bot_whatsapp")
    .maybeSingle();

  /* Se guarda en la variable de módulo, no en una de aquí. Ver la nota
     de su declaración: si se declara en este ámbito, la limpieza de
     abajo no la ve y deja la url rota en producción. */
  moduloAntes = moduloAntesLeido;

  /* ── REPARAR ANTES DE EMPEZAR, NO DESPUÉS ──

     Comprobado: `bot_whatsapp.url` estaba en `http://127.0.0.1:3201`
     en la base de PRODUCCIÓN. Es decir, el botón "Abrir" del bot
     llevaba a todos los clientes a `localhost`.

     De dónde salió: este test pone ahí la url local para apuntar al
     bot de pruebas, y la restaura en el `finally`. Pero el proceso
     murió DURA —código de salida de Windows, el mismo que se vio en
     `test:panel`— y un `finally` no se ejecuta cuando el proceso
     muere. La url se quedó.

     Y el fallo se propagaba: la siguiente vuelta capturaba
     `127.0.0.1:3201` como "el valor bueno" y lo restauraba. Un test
     que restaura lo que encuentra se queda con el valor equivocado
     para siempre.

     Es el mismo motivo por el que más arriba, para el usuario de
     Auth, este archivo limpia ANTES de empezar en vez de fiarse del
     `finally`. Aquí faltaba aplicarlo.

     Por eso ahora: si lo que hay ya es una dirección local, no se
     guarda como valor a restaurar — se repara y se avisa. El `finally`
     se queda igual, para el caso normal. */
  const esLocal = (u) => /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:\d+)?/i.test(String(u || ""));

  if (esLocal(moduloAntes.url)) {
    console.warn("");
    console.warn("  AVISO: modules.bot_whatsapp.url estaba en " + moduloAntes.url);
    console.warn("  Eso es una dirección local en la base de producción: el botón");
    console.warn('  "Abrir" del bot llevaba a todos los clientes a localhost.');
    console.warn("  Se ha reparado a " + URL_REAL_BOT + " y no se va a restaurar el valor local.");
    console.warn("");

    await db.from("modules").update({ url: URL_REAL_BOT }).eq("id", "bot_whatsapp");

    /* Y no se restaura lo que había: restaurar `127.0.0.1` sería volver
       a romperlo. Se deja `moduloAntes` con la url buena, para que el
       `finally` de abajo no deshaga la reparación. */
    moduloAntes = { url: URL_REAL_BOT, disponible: moduloAntes.disponible };
  }

  await db.from("modules").update({ disponible: true }).eq("id", "bot_whatsapp");
  await db
    .from("modules")
    .update({ url: "http://127.0.0.1:" + PUERTO_BOT })
    .eq("id", "bot_whatsapp");

  const base = await crearClienteConSuscripcion("activo", null);
  userId = base.userId;
  clientId = base.clientId;

  /* --- Levantar los dos servidores --- */
  const raiz = path.join(__dirname, "..", "..", );
  panel = spawn(process.execPath, ["server.js"], {
    cwd: raiz,
    env: { ...process.env },
    stdio: "ignore",
  });
  bot = spawn(process.execPath, ["bot.js"], {
    cwd: raiz,
    env: { ...process.env, PORT: String(PUERTO_BOT), BOT_HOST: "127.0.0.1" },
    stdio: "ignore",
  });

  await esperarPuerto("http://127.0.0.1:" + PUERTO_PANEL + "/panel/login");
  await esperarPuerto("http://127.0.0.1:" + PUERTO_BOT + "/entrar");

  // --- 1. Login y entrada ---
  seccion("el cliente entra al servicio");

  const c = cliente();
  const login = await entrarEnElPanel(c);

  comprobar("el cliente entra al panel", login.status === 302 || login.status === 200);
  comprobar("el panel le da su cookie (nexo_panel)", c.tiene("nexo_panel"));
  comprobar("y NO le da la del bot", !c.tiene("nexo_bot"));

  const ida = await irAlBot(c);

  comprobar("el panel redirige al subdominio del servicio", ida.destino.includes(String(PUERTO_BOT)));
  comprobar("el ticket va en el # (nunca en los logs)", ida.conHash);
  comprobar("y no va en la query", !ida.conQuery);
  comprobar("el bot acepta el ticket", ida.status === 200 && ida.cuerpo.ok === true);
  comprobar("el bot pone su propia cookie (nexo_bot)", /nexo_bot=/.test(ida.cookieBot));

  /* A dónde manda el navegador DESPUÉS de canjear.

     Histórico de esta comprobación, que ha cambiado dos veces:
     1. La vuelta era "/panel/mis-servicios", una ruta RELATIVA. En el
        host del bot esa ruta no existe, así que el acceso funcionaba
        (ticket verificado, cookie montada) y a continuación el
        cliente caía en el 404 del bot con un "esta página no
        existe" que no hablaba de permisos.
     2. Corregido eso, la vuelta pasó a ser la URL COMPLETA del
        panel. Tampoco era lo correcto: el botón decía "Abrir" y
        quien lo pulsaba volvía al panel sin llegar a ver nunca el
        bot. Ahora cae en la pantalla del propio servicio.

     Se exige `destino`, relativo a este host: es el servicio, así
     que una ruta relativa no puede salirse a otro sitio. */
  comprobar(
    "la vuelta cae en la pantalla del servicio",
    (ida.cuerpo.destino || "") === "/mi-bot",
    "destino=" + JSON.stringify(ida.cuerpo.destino)
  );
  comprobar(
    "y en ningún caso al panel",
    !(ida.cuerpo.destino || "").includes("/panel"),
    "destino=" + JSON.stringify(ida.cuerpo.destino)
  );
  /* El panel se sigue mandando aparte, para los enlaces de vuelta de
     las pantallas de error. Que no falte: si desaparece, el usuario
     que se equivoca se queda sin salida. */
  comprobar(
    "el panel sigue disponible para volver",
    typeof ida.cuerpo.panel === "string" && ida.cuerpo.panel.length > 0,
    ida.cuerpo.panel
  );
  comprobar("la cookie del bot es httpOnly", /HttpOnly/i.test(ida.cookieBot));
  comprobar("y va con su propio Path", /Path=\//.test(ida.cookieBot));

  /* Lo importante: el acceso_token NO puede haber pasado por la URL
     como query, porque acabaría en los logs del servidor. */
  comprobar("el token no aparece en la query del destino", !ida.destino.includes("?"));

  // --- 2. La sesión propia sirve ---
  seccion("con la cookie del bot, dentro");

  /* Sin cookie propia no se entra. No hay atajo: sin ticket no hay
     sesión, porque el servicio no comparte cookie con el panel. */
  const sinCookie = await fetch("http://127.0.0.1:" + PUERTO_BOT + "/mi-bot", {
    redirect: "manual",
  });
  comprobar("sin cookie propia, /mi-bot no deja pasar", sinCookie.status === 302);
  comprobar("y manda al login del panel", (sinCookie.headers.get("location") || "").includes("panel/login"));

  /* Con la cookie buena, dentro. */
  const tokenBot = (ida.cookieBot.match(/nexo_bot=([^;]+)/) || [])[1];
  comprobar("se puede sacar el token de la cookie del bot", Boolean(tokenBot));

  const rDentro = await fetch("http://127.0.0.1:" + PUERTO_BOT + "/mi-bot", {
    redirect: "manual",
    headers: { Cookie: "nexo_bot=" + tokenBot },
  });
  const htmlDentro = await rDentro.text();
  comprobar("con su cookie, /mi-bot responde 200", rDentro.status === 200);
  comprobar("saluda con el nombre del cliente", htmlDentro.includes("Prueba Servicio"));
  comprobar("confirma que tiene un token de Supabase para RLS", htmlDentro.includes("¿Hay token de Supabase"));

  // --- 3. Aislamiento de cookies ---
  seccion("las cookies no se cruzan");

  const conPanelEnBot = await fetch("http://127.0.0.1:" + PUERTO_BOT + "/mi-bot", {
    redirect: "manual",
    headers: { Cookie: "nexo_panel=inventado" },
  });
  comprobar("la cookie del panel no vale en el bot", conPanelEnBot.status === 302);

  const conBotEnPanel = await fetch(
    "http://127.0.0.1:" + PUERTO_PANEL + "/panel/mis-servicios",
    { redirect: "manual", headers: { Cookie: "nexo_bot=" + tokenBot } }
  );
  comprobar("la cookie del bot no vale en el panel", conBotEnPanel.status === 302);

  // --- 4. Tickets manipulados ---
  seccion("tickets manipulados");

  const partes = ida.ticket.split(".");
  const cuerpoAlterado = Buffer.from(
    JSON.stringify(
      Object.assign(JSON.parse(Buffer.from(partes[0], "base64url").toString("utf8")), {
        cid: "00000000-0000-0000-0000-000000000000",
      })
    )
  ).toString("base64url");

  const rFalso = await fetch("http://127.0.0.1:" + PUERTO_BOT + "/entrar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket: cuerpoAlterado + "." + partes[1] }),
  });
  const cuerpoFalso = await rFalso.json();
  comprobar("un ticket con el cliente cambiado no entra", rFalso.status === 401);
  comprobar("y no dice si el problema es la firma o la caducidad", !cuerpoFalso.error.includes("firma"));

  const rBasura = await fetch("http://127.0.0.1:" + PUERTO_BOT + "/entrar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket: "no-es-un-ticket" }),
  });
  comprobar("basura no entra", rBasura.status === 401);

  const rSecreto = await fetch("http://127.0.0.1:" + PUERTO_BOT + "/entrar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket: partes[0] + "." + Buffer.from("otra-cosa").toString("base64url") }),
  });
  comprobar("una firma inventada no entra", rSecreto.status === 401);

  // --- 5. Sin suscripción ---
  seccion("sin suscripción no entra");

  await db
    .from("suscripciones")
    .update({ estado: "cancelado" })
    .eq("client_id", clientId);

  const rSinSuscripcion = await fetch("http://127.0.0.1:" + PUERTO_BOT + "/entrar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket: partes[0] + "." + partes[1] }),
  });
  comprobar("con la suscripción cancelada, no entra (403)", rSinSuscripcion.status === 403);

  const c4 = cliente();
  await entrarEnElPanel(c4);
  const rPanelSin = await fetch(
    "http://127.0.0.1:" + PUERTO_PANEL + "/panel/servicios/bot_whatsapp/entrar",
    { redirect: "manual", headers: { Cookie: c4.cabecera() } }
  );
  comprobar(
    "y el panel tampoco le manda (vuelve al portal con aviso)",
    (rPanelSin.headers.get("location") || "").includes("sin-modulo")
  );

  /* Se vuelve a activar para la prueba de caducidad. */
  await db
    .from("suscripciones")
    .update({ estado: "activo" })
    .eq("client_id", clientId);

  // --- 6. Suscripción caducada ---
  seccion("suscripción caducada");

  await db
    .from("suscripciones")
    .update({ termina_en: "2026-06-01" })
    .eq("client_id", clientId);

  const rCaducada = await fetch("http://127.0.0.1:" + PUERTO_BOT + "/entrar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket: partes[0] + "." + partes[1] }),
  });
  comprobar("con la suscripción caducada, no entra (403)", rCaducada.status === 403);

  await db
    .from("suscripciones")
    .update({ termina_en: null })
    .eq("client_id", clientId);

  // --- 7. Cookie revocada ---
  seccion("sesión revocada");

  /* Lo más importante del servicio: la suscripción se comprueba en
     CADA petición. Si alguien ya tenía el bot abierto y cancela,
     deja de funcionar en la siguiente llamada. */
  await db
    .from("suscripciones")
    .update({ estado: "cancelado" })
    .eq("client_id", clientId);

  const rDespues = await fetch("http://127.0.0.1:" + PUERTO_BOT + "/mi-bot", {
    redirect: "manual",
    headers: { Cookie: "nexo_bot=" + tokenBot },
  });
  comprobar("con la cookie ya dada, cancelar lo echa igualmente", rDespues.status === 403);

  await db
    .from("suscripciones")
    .update({ estado: "activo" })
    .eq("client_id", clientId);

  const rVuelve = await fetch("http://127.0.0.1:" + PUERTO_BOT + "/mi-bot", {
    redirect: "manual",
    headers: { Cookie: "nexo_bot=" + tokenBot },
  });
  comprobar("y al reactivarla, vuelve a funcionar", rVuelve.status === 200);

  // --- 8. Logout ---
  seccion("salir");

  await fetch("http://127.0.0.1:" + PUERTO_BOT + "/salir", {
    redirect: "manual",
    headers: { Cookie: "nexo_bot=" + tokenBot },
  });
  const rTrasSalir = await fetch("http://127.0.0.1:" + PUERTO_BOT + "/mi-bot", {
    redirect: "manual",
    headers: { Cookie: "nexo_bot=" + tokenBot },
  });
  comprobar("tras salir, la cookie ya no vale", rTrasSalir.status === 302);

  /* --- 9. El equipo entra sin suscripción ---
     ┌─────────────────────────────────────────────────────────┐
     │ ESTE BLOQUE NO EXISTÍA. Y el fallo que tapa es real.     │
     │                                                         │
     │ El panel deja pasar a staff a propósito: la comprobación  │
     │ de suscripción en routes/panel-portal.js solo se hace si  │
     │ NO es staff ("es para soporte"). El bot, en cambio,       │
     │ exigía el módulo a todo el mundo, y un member del equipo  │
     │ no tiene `cid` porque no pertenece a ningún cliente.      │
     │ Resultado: el panel montaba el ticket, lo firmaba y       │
     │ reenviaba al bot, que respondía 403 con un texto que     │
     │ hablaba de contratar un producto que ya tenía acceso.     │
     │ Dos servicios con reglas distintas sobre el mismo acceso. */
  seccion("el equipo entra sin suscripción");

  const libTickets = require("../../lib/tickets");

  /* Se firma un ticket de staff con un token real suyo. El token es
     necesario porque viaja dentro del ticket y es lo que el bot
     usará para reconstruir la sesión con RLS. */
  const credenciales = await credencialesDelStaff();
  const staffAuth = await supabase.getAdmin().auth.signInWithPassword({
    email: credenciales.email,
    password: credenciales.password,
  });
  comprobar("el usuario de equipo puede autenticarse", Boolean(staffAuth.data && staffAuth.data.session));

  const staffToken = staffAuth.data.session.access_token;
  const staffId = staffAuth.data.session.user.id;

  const ticketStaff = libTickets.firmar({
    sesion: { rol: "staff" },
    userId: staffId,
    clientId: null,
    rol: "staff",
    accessToken: staffToken,
  });

  const rStaff = await fetch("http://127.0.0.1:" + PUERTO_BOT + "/entrar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket: ticketStaff }),
  });
  const cStaff = await rStaff.json();

  comprobar(
    "el equipo canjea el ticket en vez de recibir un 403",
    rStaff.status === 200 && cStaff.ok === true,
    "estado " + rStaff.status + " · " + (cStaff.error || "")
  );
  /* Al entrar hay que caer en la pantalla DEL SERVICIO, no en el
     panel, ni el del equipo ni el del cliente. El botón decía
     "Abrir" y lo que se abre es la aplicación. Antes devolvía la URL
     del panel y el usuario nunca llegaba a ver el bot. */
  comprobar(
    "cae en la pantalla del bot, no en el panel",
    (cStaff.destino || "") === "/mi-bot",
    cStaff.destino
  );
  comprobar(
    "ni siquiera el panel del equipo",
    !(cStaff.destino || "").includes("/panel"),
    cStaff.destino
  );
  comprobar(
    "y el panel sigue disponible para los enlaces de vuelta",
    typeof cStaff.panel === "string" && cStaff.panel.length > 0,
    cStaff.panel
  );

  const cookieStaff = (rStaff.headers.getSetCookie ? rStaff.headers.getSetCookie() : [])[0] || "";
  const tokenStaffBot = (cookieStaff.match(/nexo_bot=([^;]+)/) || [])[1];
  comprobar("el bot le pone su propia cookie", Boolean(tokenStaffBot));

  /* Lo importante: no solo entrar una vez. Si el middleware lo
     rechazara en la segunda petición, el botón "Abrir" funcionaría
     una vez y el servicio se cerraría solo al recargar. */
  const rStaffDentro = await fetch("http://127.0.0.1:" + PUERTO_BOT + "/mi-bot", {
    redirect: "manual",
    headers: { Cookie: "nexo_bot=" + tokenStaffBot },
  });
  comprobar(
    "y dentro sigue funcionando en la segunda petición",
    rStaffDentro.status === 200,
    "estado " + rStaffDentro.status
  );

  await fetch("http://127.0.0.1:" + PUERTO_BOT + "/salir", {
    redirect: "manual",
    headers: { Cookie: "nexo_bot=" + tokenStaffBot },
  });
  const rStaffSalio = await fetch("http://127.0.0.1:" + PUERTO_BOT + "/mi-bot", {
    redirect: "manual",
    headers: { Cookie: "nexo_bot=" + tokenStaffBot },
  });
  comprobar("y puede salir igual que un cliente", rStaffSalio.status === 302);

  // --- 10. El destino se deduce, no está escrito ---
  seccion("dirección del servicio");

  /* CAMBIÓ el criterio, a propósito.
     Antes: `modules.url` vacío = "no hay a dónde ir", y el panel
     avisaba con ?error=sin-url. Ahora vacío significa "dedúcelo":
     el bot va a bot.<tu-dominio> sin tener su URL guardada en la
     base. Por eso esta comprobación ya no espera un aviso.

     Lo que NO debe pasar es que se mande a un sitio inventado: el
     dominio de esta máquina es 127.0.0.1, así que lo deducido es el
     puerto del bot de la prueba, no bot.midominio.com. */
  await db.from("modules").update({ url: null }).eq("id", "bot_whatsapp");
  const c5 = cliente();
  await entrarEnElPanel(c5);
  const rSinUrl = await fetch(
    "http://127.0.0.1:" + PUERTO_PANEL + "/panel/servicios/bot_whatsapp/entrar",
    { redirect: "manual", headers: { Cookie: c5.cabecera() } }
  );
  const destino = rSinUrl.headers.get("location") || "";

  comprobar(
    "sin url escrita, deduce el subdominio del bot",
    destino.startsWith("http://127.0.0.1:" + PUERTO_BOT),
    sinTicket(destino)
  );
  comprobar(
    "y no manda a un dominio inventado",
    !destino.includes("midominio"),
    sinTicket(destino)
  );
  /* Lo deduce el PANEL, que es quien manda: el subdominio sale de
     SITE_URL. En la prueba el dominio es 127.0.0.1, así que sale el
     puerto del bot de la prueba (3201), que es lo que hay que poner
     en BOT_URL para que el panel lo sepa. Sin eso, el panel
     deduciría el 3200 y mandaría a un sitio donde no hay nada. */
  comprobar(
    "el panel sabe el puerto del bot (BOT_URL)",
    destino.includes(":" + PUERTO_BOT),
    "esperado :" + PUERTO_BOT + ", obtenido " + sinTicket(destino)
  );
  comprobar(
    "el ticket va en el fragmento, no en la query",
    destino.includes("#ticket=") && !destino.includes("?ticket="),
    destino.includes("#ticket=") ? "#ticket=…" : "no lleva ticket"
  );

  /* Y lo de antes: si la URL guardada es el marcador de ejemplo, se
     ignora y manda lo deducido. Ese valor estaba en la base y habría
     carried al día que el dominio fuera otro. */
  await db
    .from("modules")
    .update({ url: "https://bot.midominio.com" })
    .eq("id", "bot_whatsapp");
  const rMarcador = await fetch(
    "http://127.0.0.1:" + PUERTO_PANEL + "/panel/servicios/bot_whatsapp/entrar",
    { redirect: "manual", headers: { Cookie: c5.cabecera() } }
  );
  const destinoMarcador = rMarcador.headers.get("location") || "";
  comprobar(
    "con el marcador de ejemplo puesto, se deduce igualmente",
    destinoMarcador.startsWith("http://127.0.0.1:" + PUERTO_BOT) &&
      !destinoMarcador.includes("midominio"),
    sinTicket(destinoMarcador)
  );

  /* Una URL REAL escrita sí manda. Es lo que permite un servicio que
     no vive en el subdominio del dominio principal. */
  await db
    .from("modules")
    .update({ url: "https://proveedor-externo.example" })
    .eq("id", "bot_whatsapp");
  const rReal = await fetch(
    "http://127.0.0.1:" + PUERTO_PANEL + "/panel/servicios/bot_whatsapp/entrar",
    { redirect: "manual", headers: { Cookie: c5.cabecera() } }
  );
  comprobar(
    "una url real escrita manda sobre la deducida",
    (rReal.headers.get("location") || "").startsWith("https://proveedor-externo.example/entrar#"),
    sinTicket(rReal.headers.get("location"))
  );

  console.log("\n" + "─".repeat(54));
  if (fallos) {
    console.log(`✗ ${fallos} de ${ok + fallos} fallan.`);

    /* `process.exitCode = 1`, NO `process.exit(1)`.

       `process.exit()` corta el proceso en el acto: no resuelve la
       cadena de promesas, así que el `.finally()` de abajo —que es lo
       único que devuelve `modules.url` a su sitio— no llega a correr.
       Un test que falla se lleva por delante la limpieza de producción
       y deja el "Abrir" apuntando a un dominio que no existe.

       Con exitCode el proceso sigue su curso, la cadena termina, el
       finally limpia y Node sale solo con código 1. Es lo que hace falta desde el principio. */
    process.exitCode = 1;
  } else {
    console.log(`✓ Las ${ok} comprobaciones pasan.`);
    console.log("  Del panel al servicio y de vuelta, sin saltarse el login.\n");
  }
})()
  .catch((e) => {
    console.error("\n✗ " + e.message + "\n");
    process.exitCode = 1;
  })
  .finally(async () => {
    /* Limpiar SIEMPRE, aunque el test falle: si no, el siguiente
       intento encuentra el usuario ya creado y peta. */
    try {
      if (clientId) {
        await db.from("suscripciones").delete().eq("client_id", clientId);
        await db.from("clients").delete().eq("id", clientId);
      }
      if (userId) await db.auth.admin.deleteUser(userId);
      /* Se devuelve el estado que había, no un valor inventado. Antes
         ponía "https://bot.midominio.com", que es un dominio que no
         existe, y con ello el botón "Abrir" del portal de todos los
         clientes quedaba apuntando a la nada en cuanto se pasaba una
         prueba. */
      if (moduloAntes) {
        await db
          .from("modules")
          .update({ url: moduloAntes.url, disponible: moduloAntes.disponible })
          .eq("id", "bot_whatsapp");
      }
    } catch (e) {
      console.error("(limpieza: " + e.message + ")");
    }
    if (panel) panel.kill();
    if (bot) bot.kill();
  });
