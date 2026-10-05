/**
 * Nexo Studio — Punto de entrada del PANEL (proceso separado)
 *
 * No se usa en desarrollo: ahí server.js monta las dos cosas.
 * Existe para el día que quieras aislarlas, que es lo que
 * recomiendo antes de producción:
 *
 *   · Un fallo en el panel no tumba la web pública
 *   · Desplegar el panel no toca la web (y al revés)
 *   · La cookie de sesión es host-only: un XSS en la web pública
 *     NO puede leer la sesión del panel
 *
 * Cómo usarlo
 * -----------
 *   1. En el servicio nuevo, mismo repo, comando de arranque:
 *        node panel.js
 *   2. Variables de entorno propias: PANEL_HOST y su DATABASE_URL
 *   3. DNS: panel.tudominio.com -> ese servicio
 *
 * No hace nada de esto solo: COOLIFY.md tiene la guía.
 *
 * OJO: con el panel ya en subdominio propio, este fichero NO hace
 * falta. La cookie de sesión es host-only, así que panel.tudominio.com
 * ya está aislado de la web pública sin partir nada en dos procesos.
 * Existe para cuando quieras el panel como servicio independiente.
 */
const express = require("express");
const path = require("path");
const cookieParser = require("./lib/cookieParser");

/* El .env se carga AQUÍ, y no dentro de cada router, por la misma razón
   que en server.js: justo debajo se lee process.env.PORT. Si el .env se
   cargara más tarde, el panel se ataría al 3100 por defecto en silencio,
   aunque .env dijera otra cosa. server.js:28-33 lleva este mismo aviso
   desde que se paid por ello. */
const env = require("./lib/env");
env.load();

const app = express();

const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 3100;

/* PANEL_HOST acota la escucha a una interfaz. Sin él, este proceso
   queda escuchando en 0.0.0.0 y el panel se sirve en todas las redes
   donde llegue la máquina. En un panel con datos de clientes, lo
   razonable es dejarlo sin valor en desarrollo y ponerlo en producción
   (127.0.0.1 detrás de un reverse proxy, o la IP del servicio). */
const HOST = (process.env.PANEL_HOST || "").trim();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("trust proxy", 1);

app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieParser);

/* Solo se sirve el panel. Cualquier otra ruta cae en el 404 del panel. */
app.use(require("./routes/panel"));

/* Red de seguridad: si alguien despliega esto sin querer y espera
   la web pública, que lo diga en lugar de mostrar un error raro. */
app.use((req, res) => {
  res.status(404).render("panel/404", {
    title: "No encontrado",
    site: require("./lib/site"),
    noindex: true,
  });
});

app.listen(PORT, HOST || "0.0.0.0", () => {
  console.log(
    `Panel Nexo Studio escuchando en http://${HOST || "0.0.0.0"}:${PORT}` +
      (HOST ? "" : "  (sin PANEL_HOST: escucha en todas las interfaces)")
  );

  /* Mismo aviso que server.js: si arrancas en producción con el
     dominio de marcador, hay que saberlo ya y no al ver las etiquetas
     canonical en el navegador. */
  const site = require("./lib/site");
  if (process.env.NODE_ENV === "production" && site.dominioDeEjemplo) {
    console.warn("");
    console.warn("  ⚠️  PANEL EN PRODUCCIÓN SIN DOMINIO DEFINIDO");
    console.warn("      panel → " + site.panelUrl);
    console.warn("      Pon PANEL_URL en el .env y actualiza lib/site.js.");
    console.warn("      Ver PENDIENTES.md.");
    console.warn("");
  }
});
