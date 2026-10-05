/* =========================================================
   Nexo Studio — Configuración del sitio
   ------------------------------------------------------------
   Lo usan las DOS aplicaciones (web pública y panel), por eso
   vive en lib/ y no dentro de server.js.

   ⚠️  Datos de contacto de ejemplo. Sustituye NIF, teléfono,
       dirección y perfiles sociales antes de publicar.

   LOS DOMINIOS
   ------------
   Los dos de aquí son de MARCADOR. Cuando elijas el definitivo solo
   hay que cambiar estas dos líneas y el .env; no hay ningún dominio
   escrito en el código.

     web   →  https://midominio.com
     panel →  https://panel.midominio.com

   El panel va en subdominio aparte por una razón de seguridad, no de
   gusto: la cookie de sesión es host-only, así que un XSS en la web
   pública NO puede leer la sesión del panel. Si el panel viviera en
   midominio.com/panel, sería el mismo host y se perdería esa ventaja.
   ========================================================= */

module.exports = {
  name: "Nexo Studio",
  company: "Nexo Studio S.L.",
  nif: "B-12345678",

  /* Dominio de la web pública. */
  url: "https://midominio.com",

  /* Dominio del panel. Solo se usa para redirecciones y para el aviso
     de "entra por panel.midominio.com". La navegación dentro del panel
     va por rutas relativas, así que funciona igual en las dos formas. */
  panelUrl: "https://panel.midominio.com",

  email: "hola@midominio.com",
  phone: "+34 910 00 00 00",
  phoneHref: "+34910000000",
  whatsapp: "https://wa.me/34910000000",
  address: "Calle Mayor 12, 3º B, 28013 Madrid (España)",
  hours: "Lunes a viernes · 9:00 – 18:00 (CET)",
  ogImage: "/assets/og-image.svg",
  twitter: "@nexostudio",
  linkedin: "https://www.linkedin.com/company/nexostudio",
  instagram: "https://www.instagram.com/nexostudio",
  github: "https://github.com/nexostudio",
};

/* Etiquetas de las migas de pan por ruta estática */
module.exports.breadcrumbLabels = {
  "/servicios": "Servicios",
  "/proyectos": "Proyectos",
  "/precios": "Precios",
  "/contacto": "Contacto",
  "/blog": "Blog",
  "/aviso-legal": "Aviso legal",
  "/privacidad": "Privacidad",
  "/cookies": "Cookies",
  "/condiciones": "Condiciones",
};

/* =========================================================
   Dominios: .env gana sobre el valor de arriba
   ---------------------------------------------------------
   SITE_URL  → la web pública
   PANEL_URL → el panel

   Se leen aquí y no en las rutas porque site.js se usa en las dos
   aplicaciones, y en las vistas de redirección (canonical, og:url,
   sitemap) el dominio tiene que ser el de producción aunque el
   fichero siga diciendo midominio.com.

   Si no hay nada en .env, se queda el marcador de arriba: en
   desarrollo está bien así, y aviso al arrancar para que nadie
   publique con el dominio equivocado. */
const env = require("./env");
env.load();

/* Con https por delante si falta el protocolo, pero SOLO si no es
   localhost/127.0.0.1: en desarrollo se sirve en http y forzar https
   haría que las redirecciones apuntaran a un sitio que no responde. */
const conProtocolo = (v, porDefecto) => {
  const limpio = String(v || "").trim().replace(/\/+$/, "");
  if (!limpio) return porDefecto;
  if (/^https?:\/\//i.test(limpio)) return limpio;
  const esLocal = /^https?:\/\//i.test(porDefecto) || /localhost|127\.0\.0\.1/.test(limpio);
  return esLocal ? "http://" + limpio : "https://" + limpio;
};

module.exports.url = conProtocolo(process.env.SITE_URL, module.exports.url);
module.exports.panelUrl = conProtocolo(process.env.PANEL_URL, module.exports.panelUrl);

/** El dominio pelado, para comparar hosts ("panel.midominio.com"). */
const hostDe = (u) => {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
};
module.exports.host = hostDe(module.exports.url);
module.exports.panelHost = hostDe(module.exports.panelUrl);

/**
 * El host del que se derivan los subdominios de los servicios.
 *
 * OJO: esto NO es "el dominio pelado". Antes lo era, y se quedaba con
 * las dos últimas etiquetas. Eso está bien para "panel.midominio.com"
 * pero es un desastre con más niveles:
 *
 *   empresa.panel-niconqn.duckdns.org  →  duckdns.org  →  bot.duckdns.org
 *
 * Que es justo lo que pasó en el primer despliegue: el botón "Abrir"
 * mandaba a `bot.duckdns.org`, un subdominio de DuckDNS que no es
 * nuestro. Los clientes habrían ido a un sitio ajeno.
 *
 * Tampoco vale quedarse con las dos últimas para dominios como
 * `ejemplo.co.uk` o `empresa.nexoestudio.es`, que son de lo más
 * normal.
 *
 * Lo que sí es fiable: quitar el `www.` de delante y ya está. El
 * subdominio del servicio se antepone al host ENTERO, que es lo que
 * quiere quien configura `SITE_URL=https://empresa.midominio.es` y
 * espera que el bot esté en `bot.empresa.midominio.es`.
 */
module.exports.dominio = (() => {
  const h = module.exports.host;
  /* El `www.` sí se quita: `www.nexoestudio.es` y `nexoestudio.es`
     son el mismo sitio, y el subdominio del bot tiene que ser el
     mismo en los dos casos. Cualquier otro subdominio se respeta. */
  return h.replace(/^www\./, "");
})();

/**
 * La URL de un microservicio, deducida del dominio que haya.
 *
 * POR QUÉ NO ESTÁ ESCRITA A MANO EN CADA SITIO
 * --------------------------------------------
 * El bot estaba en "https://bot.midominio.com", escrito en la tabla
 * `modules` de la base de datos. Eso es un valor inventado guardado
 * como si fuera real: el día que el dominio sea otro, seguiría
 * apuntando a midominio.com y el botón "Abrir" llevaría a un sitio
 * que no existe, sin ningún aviso.
 *
 * Aquí se deduce del dominio que ya está configurado, así que cambia
 * solo: se cambia SITE_URL una vez y el bot va detrás.
 *
 * CON LOCALHOST NO HAY SUBDOMINIO
 * -------------------------------
 * "http://127.0.0.1:3000" no tiene dominio del que sacar "bot.". En
 * desarrollo se devuelve la URL del servicio tal cual, que es lo que
 * funciona: el bot escucha en 127.0.0.1:3200 y se llega por puerto.
 *
 * @param {string} sub   "bot", "inventario"...
 * @param {string} envUrl Variable de entorno que lo sobrescribe, o ""
 * @param {number} puerto Puerto del servicio en desarrollo
 * @returns {string}
 */
module.exports.urlDeServicio = (sub, envUrl, puerto) => {
  /* Con override explícito en .env gana ese. Es el caso de un
     servicio que NO va en subdominio del dominio principal, o de uno
     que esté en un dominio aparte entero. */
  const desdeEnv = String(envUrl || "").trim();
  if (desdeEnv) return conProtocolo(desdeEnv, desdeEnv);

  const base = module.exports.dominio;
  const esLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(module.exports.host);

  /* Sin dominio real: se devuelve lo que se pueda, que será el host
     local. Un subdominio de 127.0.0.1 no resuelve en ningún
     navegador, así que ni se intenta. */
  if (esLocal || !base || base.includes("midominio")) {
    return "http://127.0.0.1:" + (puerto || 3200);
  }

  const protocolo = module.exports.url.startsWith("http://") ? "http://" : "https://";
  return protocolo + sub + "." + base;
};

/**
 * ¿Seguimos sin dominio real?
 *
 * Hay dos señales: que siga el marcador de posición, o que sea
 * 127.0.0.1/localhost. Lo usan los avisos de desarrollo.
 */
module.exports.dominioDeEjemplo = (() => {
  const h = module.exports.host.toLowerCase();
  const ph = module.exports.panelHost.toLowerCase();
  constHosts = ["midominio.com", "panel.midominio.com", "", "127.0.0.1", "localhost"];
  return (
    h.includes("midominio") ||
    ph.includes("midominio") ||
    h === "localhost" ||
    ph === "localhost" ||
    (h.startsWith("127.") && ph.startsWith("127."))
  );
})();