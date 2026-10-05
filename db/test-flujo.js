/* =========================================================
   Nexo Studio — El flujo completo, por HTTPS y entre dominios
   ------------------------------------------------------------
   Esto NO es una prueba de código: es una prueba del
   despliegue. Va a los servicios de verdad, por su dominio de
   verdad, con TLS, y salta de un host a otro.

   Por qué existe aparte de db/test-acceso-servicio.js:

   aquel levanta dos servidores en 127.0.0.1 y prueba la lógica. Este
   prueba LO QUE NO SE PUEDE PROBAR EN LOCAL: que el subdominio
   exista, que el certificado valga, que Traefik enrute, que la
   cookie del panel no viaje al bot, que la vuelta desde el bot
   vuelva al panel.

   Todos los fallos del primer despliegue eran de esa categoría, y
   ninguno se habría visto con las pruebas locales.

   USO
     TEST_PANEL=https://... TEST_BOT=https://... npm run test:flujo

   Con las variables sin poner, usa las de desarrollo local.
   ========================================================= */

const PANEL = (process.env.TEST_PANEL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const BOT = (process.env.TEST_BOT || "http://127.0.0.1:3200").replace(/\/+$/, "");

const EMAIL = process.env.TEST_EMAIL || "admin@nexostudio.es";
const PASSWORD = process.env.TEST_PASSWORD || "PanelPrueba2026";
const MODULO = process.env.TEST_MODULO || "bot_whatsapp";

/* 'staff' vuelve al panel del equipo; 'client' vuelve a su portal.
   No es un detalle: es la diferencia entre el camino que se salta la
   comprobación de suscripción y el que no. Probar solo con staff deja
   sin cubrir justo lo que importa. */
const ROL = process.env.TEST_ROL || "staff";
const VUELTA_DE_STAFF = "/panel";
const VUELTA_DE_CLIENTE = "/panel/mis-servicios";

/* La pantalla de inicio del servicio, según lo declara en
   `acceso.crear({ raiz })`. Es donde hay que caer al entrar.

   Cada servicio tiene la suya: `empresa` usa /mi-bot, `wweb` usa
   /dashboard. Va por variable porque las pruebas recorren rutas
   fijas más abajo, y hardcodear una haría que contra el otro
   servicio todo saliera 404 y parece un fallo del despliegue. */
const RAIZ_SERVICIO = process.env.TEST_RAIZ || "/mi-bot";

/* Dónde canjea el servicio el ticket.

   No siempre es la pantalla de entrada. `empresa` acepta el POST en
   la misma ruta que sirve la página; `wweb` la sirve en /entrar y
   canjea en /api/entrar. Por eso es configurable: si se fija a la
   pantalla, contra `wweb` sale un 405 "Method Not Allowed" que parece
   un fallo del producto y es del test. */
const API_ENTRAR = process.env.TEST_API_ENTRAR || BOT + "/entrar";

/* Dónde cierra sesión el servicio. Es un POST y no un GET: cerrar
   sesión es un cambio de estado, y si fuera un GET bastaría con que
   alguien enlazara la imagen para cerrarle la sesión a otro.
   Configurable por la misma razón que API_ENTRAR. */
const API_SALIR = process.env.TEST_API_SALIR || BOT + "/salir";

const ES_HTTPS = PANEL.startsWith("https://");

let ok = 0;
let fallos = 0;

function comprobar(desc, cond, extra) {
  console.log(`  ${cond ? "✓" : "✗"} ${desc}${extra ? "  → " + extra : ""}`);
  if (cond) ok++;
  else fallos++;
}

function seccion(t) {
  console.log("\n── " + t + " " + "─".repeat(Math.max(0, 48 - t.length)));
}

/* Almacén de cookies a mano: fetch no los gestiona, y aquí hace
   falta ver qué cookie se queda cada host. */
const cookies = new Map();

function guardar(respuesta) {
  const lista =
    respuesta.headers.getSetCookie ? respuesta.headers.getSetCookie() : [];
  for (const cruda of lista) {
    const par = cruda.split(";")[0];
    const eq = par.indexOf("=");
    if (eq > 0) cookies.set(par.slice(0, eq), par.slice(eq + 1));
  }
}

function cabecera() {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

/* Las cookies NO se comparten entre hosts, y eso es justo lo que hay
   que comprobar abajo. Para eso está el almacén: guarda lo que cada
   respuesta puso, y las peticiones se mandan con la cabecera que
   toque. */

async function pedir(url, opciones = {}) {
  const r = await fetch(url, { redirect: "manual", ...opciones });
  guardar(r);
  return r;
}

(async () => {
  console.log("\n═══ Flujo completo contra el despliegue ═══");
  console.log("  panel: " + PANEL);
  console.log("  bot:   " + BOT);
  console.log("  usuario: " + EMAIL + "  (rol: " + ROL + ")");
  console.log("  " + (ES_HTTPS ? "con HTTPS" : "SIN HTTPS (esto no es una prueba real)"));

  /* ---------- 0. Que los dos dominios existen ---------- */
  seccion("los dos dominios responden");

  const rPanel = await pedir(PANEL + "/panel/login");
  comprobar("el panel responde", rPanel.status === 200, "estado " + rPanel.status);

  const rBot = await pedir(BOT + "/entrar");
  comprobar("el bot responde en SU /entrar", rBot.status === 200, "estado " + rBot.status);

  if (ES_HTTPS) {
    /* Con TLS válido, fetch no abre la conexión si el certificado no
       cuadra. Si llegamos aquí, el certificado vale. */
    comprobar("el TLS del panel es válido", true);
    comprobar("el TLS del bot es válido", true);
  }

  /* El bot tiene que embeberse el panel con URL completa. Esta es la
     comprobación que destapa el "midominio.com": el bot arranca
     igual con el dominio equivocado, así que /entrar da 200 igual. */
  const htmlBot = await rBot.text();
  comprobar(
    "el bot no muestra el 404 suyo",
    !htmlBot.includes("Esta página no existe"),
    htmlBot.includes("Esta página no existe") ? "sale su pagina de 404" : ""
  );
  comprobar(
    "el bot no tiene el marcador de dominio inventado",
    !htmlBot.includes("midominio"),
    htmlBot.includes("midominio") ? "sale midominio en el HTML" : ""
  );

  /* El bot tiene que saber dónde está el panel, para los enlaces de
     vuelta. Cada servicio lo deja a su manera: `empresa` lo suelta en
     un `var panel = "..."`, `wweb` lo lleva en `data-panel` y en el
     bundle de JS. Se buscan las dos formas porque lo que importa es
     que el enlace lleve a un sitio real. */
  const panelEmbebido =
    (htmlBot.match(/var panel = "([^"]+)"/) || [])[1] ||
    (htmlBot.match(/data-panel="([^"]+)"/) || [])[1] ||
    (htmlBot.match(/"(https?:\/\/[^"]*?panel[^"]*?\/panel\/mis-servicios)"/) || [])[1];

  comprobar("el bot sabe dónde está el panel", Boolean(panelEmbebido), panelEmbebido || "no lo trae");
  if (panelEmbebido) {
    comprobar("y con URL completa", /^https?:\/\//.test(panelEmbebido), panelEmbebido);
    comprobar(
      "y es el MISMO panel que estamos probando",
      panelEmbebido.startsWith(PANEL),
      panelEmbebido + " vs " + PANEL
    );
  }

  /* ---------- 1. Entrar al panel ---------- */
  seccion("el equipo entra al panel");

  cookies.clear();
  const rLogin = await pedir(PANEL + "/panel/login");
  const htmlLogin = await rLogin.text();
  const csrf = (htmlLogin.match(/name="_csrf" value="([^"]+)"/) || [])[1];
  comprobar("el formulario trae CSRF", Boolean(csrf));

  const rPost = await pedir(PANEL + "/panel/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cabecera() },
    body: new URLSearchParams({ email: EMAIL, password: PASSWORD, _csrf: csrf }).toString(),
  });
  comprobar(
    "el login va bien (no vuelve al formulario)",
    rPost.status === 302,
    "estado " + rPost.status
  );
  comprobar("el panel da su cookie propia", cookies.has("nexo_panel"));

  const rTras = await pedir(PANEL + "/panel", { headers: { Cookie: cabecera() } });
  /* Un cliente NO entra en /panel: le mandan a su portal. Un member
     del equipo sí. La comprobación es distinta por rol a propósito,
     porque aquí el 302 es la respuesta correcta, y decir "no vale"
     sería un falso positivo que invitaría a alguien a "arreglarlo". */
  if (ROL === "client") {
    const loc = rTras.headers.get("location") || "";
    comprobar(
      "un cliente no entra al panel del equipo: le mandan a su portal",
      rTras.status === 302 && loc.includes(VUELTA_DE_CLIENTE),
      "estado " + rTras.status + (loc ? " → " + loc : "")
    );
  } else {
    comprobar("con esa cookie entra al panel", rTras.status === 200, "estado " + rTras.status);
  }

  /* ---------- 1b. El portal de un cliente ----------
     A un cliente no se le prueba con "/panel": su pantalla es
     /panel/mis-servicios, y lo que tiene que aparecer ahí es el
     botón "Abrir" del bot. Sin esto, la prueba pasaría yendo a la
     ruta del servicio a pelo, sin comprobar que un cliente real ve
     la forma de llegar. */
  if (ROL === "client") {
    seccion("el portal del cliente ve la aplicación");

    const rPortal = await pedir(PANEL + "/panel/mis-servicios", {
      headers: { Cookie: cabecera() },
    });
    comprobar("el portal del cliente responde", rPortal.status === 200, "estado " + rPortal.status);

    const htmlPortal = await rPortal.text();
    const botVisible = htmlPortal.includes("/panel/servicios/" + MODULO + "/entrar");
    comprobar("el bot aparece con su botón de abrir", botVisible, botVisible ? "" : "no sale el enlace");

    /* Si el cliente tuviera el cobro de una suscripción VENCIDO, el
       portal lo avisa pero NO le quita la aplicación: el bloqueo por
       impago es del servicio de acceso, no del módulo. Aquí se
       comprueba que la pantalla no dice "sin acceso". */
    comprobar(
      "y no le dice que no tiene acceso",
      !htmlPortal.includes("sin acceso") && !htmlPortal.includes("no está activo"),
      ""
    );
  }

  /* ---------- 2. El salto al bot ---------- */
  seccion("el salto al bot");

  const rSalto = await pedir(PANEL + "/panel/servicios/" + MODULO + "/entrar", {
    headers: { Cookie: cabecera() },
  });
  const destino = rSalto.headers.get("location") || "";

  comprobar("el panel responde con redirección", rSalto.status === 302, "estado " + rSalto.status);

  /* El destino se imprime recortado. El ticket lleva dentro el
     access_token del usuario, y aunque expire en 60 s está bien que
     no acabe en un log de consola ni en la salida de una prueba. */
  const destinoCorto = destino.length > 60 ? destino.slice(0, 45) + "… (ticket dentro)" : destino;
  comprobar("redirige a algo", Boolean(destino), destinoCorto);
  comprobar("y va al subdominio del bot", destino.startsWith(BOT), destinoCorto);

  const urlDestino = new URL(destino);
  comprobar("el ticket va en el fragmento", urlDestino.hash.startsWith("#ticket="), urlDestino.hash.slice(0, 20));
  comprobar("y NO en la query", urlDestino.search === "", "query: '" + urlDestino.search + "'");
  comprobar(
    "ni en la ruta, que también acaba en los logs",
    !destino.replace(urlDestino.hash, "").includes("ticket"),
    (destino.replace(urlDestino.hash, "") || "(solo el host y /entrar)").slice(0, 60)
  );

  /* ---------- 3. El canje ---------- */
  seccion("el canje en el bot");

  const ticket = decodeURIComponent(urlDestino.hash.replace("#ticket=", ""));
  const rCanje = await fetch(API_ENTRAR, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket }),
  });

  /* El servicio puede contestar 200 con JSON o un error en texto
     plano. Sin esto, un 405 de un proxy revienta el JSON.parse y el
     fallo sale como "Unexpected token" en vez de como lo que es. */
  const textoCanje = await rCanje.text();
  let canje = {};
  try {
    canje = textoCanje ? JSON.parse(textoCanje) : {};
  } catch {
    canje = { error: textoCanje.slice(0, 200) };
  }

  comprobar("el bot acepta el ticket", rCanje.status === 200 && canje.ok === true, "estado " + rCanje.status + " · " + (canje.error || ""));

  /* El nombre de la clave con la que el servicio dice dónde caer no es
     el mismo en los dos: `empresa` la llama `destino` y `wweb` la llama
     `volver`. Se lee la que venga, porque lo que importa es el valor,
     no cómo lo bauticen. */
  const cai = canje.destino || canje.volver || "";

  /* Al entrar hay que caer en la PANTALLA DEL SERVICIO, no en el
     panel. El botón decía "Abrir" y lo que se abre es la aplicación.

     Esto estuvo mal: el canje devolvía la URL del panel, así que
     pulsar "Abrir" te devolvía al panel y nunca llegabas a ver el bot.
     La prueba lo daba por bueno porque comprobaba lo que el código
     hacía, no lo que debía hacer. */
  comprobar(
    "cae en la pantalla del servicio, no en el panel",
    cai === RAIZ_SERVICIO,
    "'" + cai + "'  se esperaba '" + RAIZ_SERVICIO + "'"
  );
  comprobar(
    "y en ningún caso es el panel",
    !cai.includes("/panel"),
    cai
  );
  comprobar(
    "el destino es relativo a ESTE host, para que no se salga",
    typeof cai === "string" && cai.startsWith("/") && !cai.startsWith("//"),
    cai
  );
  /* `wweb` no devuelve la URL del panel en el canje: la lleva embebida
     en el HTML de /entrar, que ya se ha comprobado arriba. Así que
     aquí solo se exige si el servicio la manda. */
  if (canje.panel !== undefined) {
    comprobar(
      "el panel sigue disponible para los enlaces de vuelta",
      (canje.panel || "").startsWith(PANEL),
      canje.panel
    );
  }

  const cookieBot = (rCanje.headers.getSetCookie ? rCanje.headers.getSetCookie() : [])[0] || "";
  const tokenBot = (cookieBot.match(/nexo_bot=([^;]+)/) || [])[1];
  comprobar("el bot da su cookie propia", Boolean(tokenBot));
  comprobar("y es httpOnly", /HttpOnly/i.test(cookieBot));
  /* `Secure` importa, pero hay un caso en que NO debe estar: si el
   servicio se sirve en HTTP por dentro de una red privada, el
   navegador descarta la cookie entera y el servicio parece roto
   ("no me acuerdo"). Por eso solo se exige cuando de verdad hay
   HTTPS, y aun así el texto lo enseña siempre: si aparece "sin
   Secure" hay que mirarlo, aunque la prueba pase. */
comprobar(
  "y con Secure, por estar en HTTPS",
  !ES_HTTPS || /Secure/i.test(cookieBot),
  ES_HTTPS && !/Secure/i.test(cookieBot) ? "OJO: sin Secure" : ""
);

  /* ---------- 4. Aislamiento entre hosts ---------- */
  seccion("las cookies no se cruzan");

  /* Con la cookie del panel, el bot NO debe dejar entrar. Esto es lo
     que hace que un XSS en el bot no se lleve la sesión del panel. */
  const rPanelEnBot = await fetch(BOT + RAIZ_SERVICIO, {
    redirect: "manual",
    headers: { Cookie: "nexo_panel=" + (cookies.get("nexo_panel") || "x") },
  });
  comprobar(
    "la cookie del PANEL no vale en el bot",
    rPanelEnBot.status !== 200,
    "estado " + rPanelEnBot.status
  );

  const rBotEnPanel = await fetch(PANEL + "/panel", {
    redirect: "manual",
    headers: { Cookie: "nexo_bot=" + (tokenBot || "x") },
  });
  comprobar(
    "la cookie del BOT no vale en el panel",
    rBotEnPanel.status !== 200,
    "estado " + rBotEnPanel.status
  );

  /* ---------- 5. Dentro ---------- */
  seccion("dentro del bot");

  const rDentro = await fetch(BOT + RAIZ_SERVICIO, {
    redirect: "manual",
    headers: { Cookie: "nexo_bot=" + tokenBot },
  });
  comprobar("con su cookie, el bot responde", rDentro.status === 200, "estado " + rDentro.status);

  const htmlDentro = await rDentro.text();
  /* El aviso de RLS solo lo trae `empresa`, que depura la sesión en
     pantalla. `wweb` no lo tiene porque su dashboard es real y no
     muestra diagnósticos dentro. Si el servicio no lo trae, no se
     cuenta como fallo: lo que no puede pasar es que lo traiga y diga
     que no hay token. */
  if (htmlDentro.includes("¿Hay token de Supabase")) {
    comprobar("y confirma que tiene token de Supabase para RLS",
      !htmlDentro.includes("no hay token"), "");
  }
  comprobar(
    "y no es la página de sin acceso",
    !htmlDentro.includes("no está activo"),
    ""
  );

  /* Sin la cookie, el bot tiene que mandar a una pantalla de entrada.
     Cuál depende del servicio: `empresa` manda a su login del panel;
     `wweb` tiene pantalla propia (/entrar) porque el canje es un POST
     con JavaScript, y esa pantalla trae el panel embebido para volver.

     Lo que no vale en ningún caso es quedarse en el bot y enseñar su
     propio 404, que no habla de permisos. */
  const rSin = await fetch(BOT + RAIZ_SERVICIO, { redirect: "manual" });
  const loc = rSin.headers.get("location") || "";
  comprobar("sin cookie, redirige", rSin.status === 302 || rSin.status === 307,
    "estado " + rSin.status);
  const vaAlPanel = loc.includes("/panel/login");
  const vaAPropia = loc.includes("/entrar");
  comprobar("a una pantalla de entrada", vaAlPanel || vaAPropia, loc);
  if (vaAlPanel) {
    comprobar("con URL completa", /^https?:\/\//.test(loc), loc);
    comprobar("y no al propio bot", !loc.startsWith(BOT), loc);
  } else {
    comprobar("y recuerda dónde volver con next", loc.includes("next="), loc);
    /* Relativa es MEJOR que absoluta: no puede hacer que el servicio
       se apunte a sí mismo y manda al dominio equivocado. */
    comprobar("y es relativa, para no salirse del host", loc.startsWith("/") && !loc.startsWith("//"), loc);
  }

  /* ---------- 6. Salir ---------- */
  seccion("salir");
  const rSalir = await fetch(API_SALIR, {
    method: "POST",
    redirect: "manual",
    headers: { Cookie: "nexo_bot=" + tokenBot },
  });
  comprobar("el servicio acepta cerrar sesión", rSalir.status < 400, "estado " + rSalir.status);

  const rTrasSalir = await fetch(BOT + RAIZ_SERVICIO, {
    redirect: "manual",
    headers: { Cookie: "nexo_bot=" + tokenBot },
  });
  /* Tras cerrar sesión la cookie puede seguir travelling en la
     petición, porque el navegador la tiene que borrar y aquí se manda
     a mano. Lo que no puede es seguir VALIENDO: lo decide la fila de
     la sesión, no la cookie. Por eso se mira el estado y no si vino
     cookie nueva. */
  comprobar("tras salir, la cookie ya no vale",
    rTrasSalir.status !== 200, "estado " + rTrasSalir.status);

  /* ---------- Resumen ---------- */
  console.log("\n" + "═".repeat(54));
  if (fallos) {
    console.log(`✗ ${fallos} de ${ok + fallos} fallan.`);
    process.exit(1);
  }
  console.log(`✓ Las ${ok} comprobaciones pasan.`);
  if (!ES_HTTPS) {
    console.log("\n⚠️  Han pasado contra localhost. Esto NO valida nada de un");
    console.log("    despliegue: faltan TLS, subdominios, Traefik y el salto");
    console.log("    entre hosts. Pásale TEST_PANEL y TEST_BOT para comprobarlo.");
  } else {
    console.log("  Del panel al servicio y de vuelta, por HTTPS y entre dominios.");
  }
  process.exit(0);
})().catch((e) => {
  console.error("\n✗ " + e.message + "\n");
  if (e.cause && e.cause.message) console.error("  causa: " + e.cause.message);
  process.exit(1);
});
