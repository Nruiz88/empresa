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
const VUELTA_ESPERADA = ROL === "client" ? VUELTA_DE_CLIENTE : VUELTA_DE_STAFF;

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
  const panelEmbebido = (htmlBot.match(/var panel = "([^"]+)"/) || [])[1];
  comprobar("el bot sabe dónde está el panel", Boolean(panelEmbebido), panelEmbebido || "no lo trae");
  if (panelEmbebido) {
    comprobar("y con URL completa", /^https?:\/\//.test(panelEmbebido), panelEmbebido);
    comprobar(
      "y es el MISMO panel que estamos probando",
      panelEmbebido.replace(/\/+$/, "") === PANEL,
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
  const rCanje = await fetch(BOT + "/entrar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket }),
  });
  const canje = await rCanje.json();

  comprobar("el bot acepta el ticket", rCanje.status === 200 && canje.ok === true, "estado " + rCanje.status + " · " + (canje.error || ""));
  comprobar(
    ROL === "client" ? "vuelve al portal del cliente" : "vuelve al panel del equipo",
    (canje.volver || "").endsWith(VUELTA_ESPERADA),
    canje.volver + "  (se esperaba ... " + VUELTA_ESPERADA + ")"
  );
  comprobar("y con URL completa", /^https?:\/\//.test(canje.volver || ""), canje.volver);
  comprobar(
    "la vuelta es al panel que estamos probando",
    (canje.volver || "").startsWith(PANEL),
    canje.volver
  );

  const cookieBot = (rCanje.headers.getSetCookie ? rCanje.headers.getSetCookie() : [])[0] || "";
  const tokenBot = (cookieBot.match(/nexo_bot=([^;]+)/) || [])[1];
  comprobar("el bot da su cookie propia", Boolean(tokenBot));
  comprobar("y es httpOnly", /HttpOnly/i.test(cookieBot));
  comprobar("y con Secure, por estar en HTTPS", !ES_HTTPS || /Secure/i.test(cookieBot), ES_HTTPS ? "sin Secure" : "");

  /* ---------- 4. Aislamiento entre hosts ---------- */
  seccion("las cookies no se cruzan");

  /* Con la cookie del panel, el bot NO debe dejar entrar. Esto es lo
     que hace que un XSS en el bot no se lleve la sesión del panel. */
  const rPanelEnBot = await fetch(BOT + "/mi-bot", {
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

  const rDentro = await fetch(BOT + "/mi-bot", {
    redirect: "manual",
    headers: { Cookie: "nexo_bot=" + tokenBot },
  });
  comprobar("con su cookie, el bot responde", rDentro.status === 200, "estado " + rDentro.status);

  const htmlDentro = await rDentro.text();
  comprobar(
    "y confirma que tiene token de Supabase para RLS",
    htmlDentro.includes("¿Hay token de Supabase"),
    ""
  );
  comprobar(
    "y no es la página de sin acceso",
    !htmlDentro.includes("no está activo"),
    ""
  );

  /* Sin la cookie, el bot tiene que mandar al login DEL PANEL, con
     URL completa. Con una ruta relativa se quedaba en el bot y
     enseñaba su propio 404 ("esta página no existe"), que no hablaba
     de permisos. */
  const rSin = await fetch(BOT + "/mi-bot", { redirect: "manual" });
  const loc = rSin.headers.get("location") || "";
  comprobar("sin cookie, redirige", rSin.status === 302, "estado " + rSin.status);
  comprobar("al login del panel", loc.includes("/panel/login"), loc);
  comprobar("con URL completa", /^https?:\/\//.test(loc), loc);
  comprobar("y no al propio bot", !loc.startsWith(BOT), loc);

  /* ---------- 6. Salir ---------- */
  seccion("salir");
  await fetch(BOT + "/salir", { redirect: "manual", headers: { Cookie: "nexo_bot=" + tokenBot } });
  const rTrasSalir = await fetch(BOT + "/mi-bot", {
    redirect: "manual",
    headers: { Cookie: "nexo_bot=" + tokenBot },
  });
  comprobar("tras salir, la cookie ya no vale", rTrasSalir.status === 302, "estado " + rTrasSalir.status);

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
