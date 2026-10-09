/* =========================================================
   Nexo Studio — Configuración del sitio
   ------------------------------------------------------------
   Lo usan las DOS aplicaciones (web pública y panel), por eso
   vive en lib/ y no dentro de server.js.

   ⚠️  Datos de contacto de ejemplo. Sustituye NIF, teléfono,
       dirección y perfiles sociales antes de publicar.

   LOS DOMINIOS
   ------------
   Son los de producción. Se cambian en dos sitios: aquí y en el entorno
   de Coolify. Aquí están los valores por defecto, que son los que se
   usan cuando no hay .env (en el contenedor, siempre: allí las variables
   llegan por el entorno y no hay fichero por diseño).

     web   →  https://shopcito.com.ar
     panel →  https://panel.shopcito.com.ar

   El panel va en subdominio aparte por una razón de seguridad, no de
   gusto: la cookie de sesión es host-only, así que un XSS en la web
   pública NO puede leer la sesión del panel. Si el panel viviera en
   shopcito.com.ar/panel, sería el mismo host y se perdería esa
   ventaja.

   ⚠️  EL ORDEN DE ESTAS DOS CUENTAS IMPORTA, Y NO POR ESTÉTICA.

   Más abajo, `dominio` se saca de `url`, y de `url` se deduce el
   subdominio del bot (`urlDeServicio("bot", ...)`), que es la dirección
   del webhook que el panel le da a cada Evolution. Si `panelUrl` fuera
   `url` + "/panel", el bot acabaría en panel.shopcito.com.ar y el
   fallo sería mudo: la Evolution aceptaría el webhook con un 200 y los
   mensajes no llegarían a ningún sitio.

   Por eso `panelUrl` lleva el subdominio escrito, y no se deduce. La
   URL del webhook sí se puede cambiar por caja desde el panel
   (`evolution_servers.webhook_url`), que es el arreglo rápido cuando
   el bot no está donde se espera.
   ========================================================= */

module.exports = {
  name: "Shopcito",

  /* ⚠️  DATOS LEGALES, EN TRÁMITE.

     Estos dos campos van al aviso legal, a la política de privacidad,
     al pie y al JSON-LD de todas las páginas. Son del negocio, no de la
     marca, y no se inventan.

     · company — la razón social. Ahora dice Shopcito, que es el nombre
                comercial. Para que el aviso legal valga del todo
                debería ir la razón social con su CUIT.
     · cuit    — el CUIT. Va en null a propósito: no se inventa un
                identificador fiscal. Las vistas solo enseñan la línea si
                hay algo, para que no aparezca un hueco ni un «null» en
                un aviso legal.

     Lo que ya no se hace es dejar el nombre de la sociedad vieja: un
     aviso legal que menciona una empresa que no existe es peor que uno
     que menciona la marca correcta.

     Cuando estén, se cambian acá y en ningún otro sitio: todo lo demás
     lee de acá.
     */
  company: "Shopcito",

  cuit: null,

  /* Dominio de la web pública. */
  url: "https://shopcito.com.ar",

  /* Dominio del panel. Solo se usa para redirecciones y para el aviso
     de "entra por panel.midominio.com". La navegación dentro del panel
     va por rutas relativas, así que funciona igual en las dos formas. */
  panelUrl: "https://panel.shopcito.com.ar",

  email: "hola@shopcito.com.ar",
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
  if (esLocal || !base || base.includes("midominio") || base.includes("tu-dominio")) {
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
 *
 * ── POR QUÉ CADA HOST SE MIRA POR SEPARADO ──
 *
 * Antes la condición de local era `h.startsWith("127.") && ph.
 * startsWith("127.")`, o sea los DOS a la vez. Se rompió al poner
 * `panelUrl` real (`panel.shopcito.com.ar`) mientras el `.env` de
 * desarrollo seguía con `SITE_URL=http://127.0.0.1:3000`: la pareja dejó
 * de ser "los dos locales" y el aviso de desarrollo dejó de salir sin
 * más, que es justo lo que hace mal un aviso que desaparece callado.
 *
 * Lo que importa es el host DE LA WEB: si el sitio está en localhost, se
 * está en desarrollo, lo diga o no el panel. Y en producción los dos
 * hosts son reales, así que ninguna de las dos señales salta.
 *
 * Ojo al orden: el `.env` gana sobre los valores de arriba, así que en
 * desarrollo es el `.env` el que pone `127.0.0.1` y no este fichero.
 */
const esHostLocal = (host) =>
  host === "localhost" || host === "::1" || host.startsWith("127.");

module.exports.dominioDeEjemplo = (() => {
  const h = module.exports.host.toLowerCase();
  const ph = module.exports.panelHost.toLowerCase();
  return (
    h.includes("midominio") ||
    ph.includes("midominio") ||
    h.includes("tu-dominio") ||
    ph.includes("tu-dominio") ||
    /* Host vacío: pasa cuando SITE_URL no trae dominio, y entonces no
       hay de dónde sacar el subdominio del bot. */
    !h ||
    esHostLocal(h) ||
    esHostLocal(ph)
  );
})();