/**
 * Nexo Studio — Punto de entrada de la WEB PÚBLICA
 *
 * Este archivo ya no contiene rutas: solo configura Express y
 * monta las dos aplicaciones.
 *
 *   routes/web.js     -> lo público (sin identidad)
 *   routes/panel.js   -> panel del equipo y portal de clientes
 *
 * ORDEN DE MONTAJE (importante)
 *   1. estáticos
 *   2. panel   <- ANTES que web
 *   3. web      <- su 404 va al final y cierra todo
 *
 * Si el panel se montara después, el 404 público se comería sus
 * rutas y el panel sería inaccesible.
 *
 * DESPLEGUE
 *   Todo esto sirve por 127.0.0.1 sin TLS, así que hasta que haya
 *   dominio y certificado el panel de clientes viaja en claro. La
 *   cookie Secure ya se activa sola con NODE_ENV=production.
 *
 *   La guía de despliegue (Coolify, subdominios, qué variables van
 *   en cada servicio) está en COOLIFY.md.
 *
 *   `panel.js` permite servir el panel en un proceso aparte, pero con
 *   el panel en subdominio NO hace falta: la cookie host-only ya
 *   aporta el aislamiento. Ver COOLIFY.md.
 */
const express = require("express");
const path = require("path");
const cookieParser = require("./lib/cookieParser");

/* El .env se carga AQUÍ, y no dentro de cada router, por una razón
   concreta: server.js lee process.env (PORT, NODE_ENV) ANTES de
   montar nada. Si el .env se cargara más tarde, esas decisiones se
   tomarían con variables vacías. */
const env = require("./lib/env");
env.load();

const app = express();

/* ---------- Log de errores a fichero ----------
   Existe por una razón práctica: cuando el servidor se arranca sin
   consola (por ejemplo desde una herramienta que no puede quedarse
   esperando a un proceso hijo), stdout y stderr se pierden y un 500
   no deja rastro de qué pasó. Escribirlo aquí permite diagnosticar
   sin depender de tener una terminal delante.

   Un panel con datos de clientes no puede depender de "a veces hay
   una terminal abierta". */
const LOG_DIR = path.join(__dirname, "logs");
function anotarError(err) {
  try {
    require("fs").mkdirSync(LOG_DIR, { recursive: true });
    const linea =
      "[" + new Date().toISOString() + "] " + (err && err.stack ? err.stack : String(err)) + "\n\n";
    require("fs").appendFileSync(path.join(LOG_DIR, "error.log"), linea);
  } catch {
    /* Si ni el log se puede escribir, no vamos a inventar nada más. */
  }
}
process.on("uncaughtException", (err) => {
  anotarError(err);
  console.error(err);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  anotarError(err);
  console.error(err);
});

// Algunos entornos exportan PORT=0 o no numérico: forzamos un puerto real
const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 3000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Trust proxy: para que req.ip sea la IP real detrás de un proxy/CDN.
// Sin esto, todas las peticiones parecen venir de localhost y el
// registro de auditoría guardaría IPs inútiles.
app.set("trust proxy", 1);

app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieParser);

/* Cabeceras de seguridad de la web pública.
   El CSP es intencionadamente simple: si algún día incrustas un
   iframe de terceros (vídeos, mapas), habrá que ajustarlo. */
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  next();
});

/* ---------- Reinicio desde dentro ----------
   Por qué existe: matar y relanzar el servidor desde fuera deja un
   proceso hijo colgando, y cualquier herramienta que espere a que
   termine se queda esperando para siempre: un servidor web nunca
   cierra sus streams.

   Aquí el proceso se reinicia a sí mismo: se responde al cliente
   ANTES de morir y se arranca otro. Nadie desde fuera tiene que esperar.

   Solo en desarrollo y con SESSION_SECRET puesto: si esto llegara a
   producción, cualquiera podría tumbar la web con un GET.

   VA ANTES de routes/web.js a propósito: el router público termina
   en un 404 que se come todo lo que no haya
   y esta ruta quedaría inalcanzable. */
if (process.env.NODE_ENV !== "production" && process.env.SESSION_SECRET) {
  app.get("/__reiniciar", (req, res) => {
    res.send("reiniciando…");
    console.log("[restart] reinicio pedido por " + req.ip);

    setTimeout(() => {
      /* spawn con stdio ignorado: el hijo NO hereda los streams de
         este proceso, que es justo lo que causaba el cuelgue. */
      const { spawn } = require("child_process");
      const hijo = spawn(process.execPath, [__filename], {
        cwd: __dirname,
        detached: true,
        stdio: "ignore",
      });
      hijo.unref();

      /* Se suelta el puerto y se sale, dejando al hijo con el sitio. */
      process.exit(0);
    }, 250);
  });
}

/* El panel va primero: su 404 cierra el espacio de /panel */
app.use(require("./routes/panel"));

/* Y después la web pública, con su 404 al final */
app.use(require("./routes/web"));

const servidor = app.listen(PORT, "127.0.0.1", () => {
  console.log(`Nexo Studio escuchando en http://127.0.0.1:${PORT}`);

  /* Aviso de dominio sin definir. Publicar con 'midominio.com' en las
     etiquetas canonical, el sitemap y los correos es una forma
     silenciosa de tirar el SEO por tierra, y no se ve hasta que Google
     ya ha indexado el sitio equivocado. */
  const site = require("./lib/site");
  if (process.env.NODE_ENV === "production" && site.dominioDeEjemplo) {
    console.warn("");
    console.warn("  ⚠️  ARRANCANDO EN PRODUCCIÓN SIN DOMINIO DEFINIDO");
    console.warn("      web   → " + site.url);
    console.warn("      panel → " + site.panelUrl);
    console.warn("      Pon SITE_URL y PANEL_URL en el .env, y actualiza");
    console.warn("      lib/site.js. Ver PENDIENTES.md.");
    console.warn("");
  }
});
