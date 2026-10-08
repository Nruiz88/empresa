/* =========================================================
   Nexo Studio — Rutas públicas (web)
   ------------------------------------------------------------
   TODO lo que ve un visitante sin_IDENTIFICarse va aquí.

   Nada de esta carpeta debe importar nada del panel: si algún
   día el panel necesita autenticación, DB o auditoría, este
   archivo ni se entera. Ese es justo el punto de separarlas:
   un fallo en el panel no puede tumbar la web pública.
   ========================================================= */

const express = require("express");
const fs = require("fs");
const path = require("path");

const siteConfig = require("../lib/site");

/* Los planes que se venden al público, y de dónde salen. */
const planesLib = require("../lib/planes");
const content = require("../lib/content");

const site = siteConfig;
const { breadcrumbLabels } = siteConfig;

const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "consultas.jsonl");

/* El router se construye y se EXPORTA ya montado.
   Ojo: si esto fuera una función tipo module.exports = function(){...},
   Express la trataría como middleware, la llamaría con (req,res,next),
   ella devolvería un router sin llamar a next() y TODAS las peticiones
   se quedarían colgadas. Por eso se exporta el router, no la fábrica. */
const router = express.Router();

{
  const { posts, projects, figures, faq, cases, precios, shopcito } = content;

  /* Atajo para páginas sin lógica propia */
  const page = (view, current, meta) => (req, res) => {
    res.locals.current = current;
    res.render(view, Object.assign({ title: meta.title, description: meta.description }, meta.data || {}));
  };

  /* ---------- Contenido común a cada vista ---------- */
  router.use((req, res, next) => {
    res.locals.site = site;
    res.locals.year = new Date().getFullYear();
    res.locals.current = "";
    res.locals.projects = content.projects;
    res.locals.categorias = content.categorias;
    res.locals.figures = figures;
    res.locals.testimonials = content.testimonials;
    res.locals.tech = content.tech;
    res.locals.techAuditoria = content.techAuditoria;
    res.locals.faq = faq;
    res.locals.fit = content.fit;
    res.locals.automation = content.automation;

    /* SEO */
    res.locals.canonical = site.url + req.originalUrl;
    res.locals.ogType = "website";
    res.locals.ogImage = site.ogImage;
    res.locals.noindex = false;

    /* Migas de pan por defecto */
    if (req.path === "/") {
      res.locals.breadcrumbs = [{ name: "Inicio", url: null }];
    } else if (req.path.startsWith("/blog/")) {
      res.locals.breadcrumbs = [{ name: "Inicio", url: "/" }, { name: "Blog", url: "/blog" }];
    } else if (breadcrumbLabels[req.path]) {
      res.locals.breadcrumbs = [
        { name: "Inicio", url: "/" },
        { name: breadcrumbLabels[req.path], url: null },
      ];
    } else {
      res.locals.breadcrumbs = [{ name: "Inicio", url: "/" }];
    }

    next();
  });

  /* Los precios públicos van en `res.locals`, y no en el `render` de
     cada ruta.

     Motivo: la página de precios los necesita igual que la portada, y
     metidos en el objeto de `render` habría que acordarse de pasarlos
     en cada ruta nueva que pinte un plan. Con `res.locals` los tienen
     todas, y añadir una página con precios no puede olvidarse de nada
     —que es el mismo motivo por el que `csrf` y `rol` van así en el
     panel. */
  router.use(function inyectaPrecios(req, res, next) {
    /* PROYECTOS y MANTENIMIENTO ya no se inyectan: eran los planes del
       estudio digital y se retiraron con las páginas que los vendían.
       Serpintían como undefined, que no rompe, y por eso esto pasó
       desapercibido hasta que una vista los recorrió con forEach. */
    res.locals.BANDAS_PRESUPUESTO = precios.BANDAS_PRESUPUESTO;
    res.locals.precio = precios.importe;
    res.locals.simbolo = precios.simbolo;
    res.locals.precioDe = precios.precioDe;
    /* El que sabe qué pintar cuando el plan no tiene cifra. Va en
       `res.locals` y no en `render` de cada ruta por el mismo motivo
       que los otros: la portada y /precios pintan planes, y que una
       página nueva se acuerde de pasárselo a mano es la forma
       segura de que una se quede sin él. */
    res.locals.precioDePlan = precios.precioDePlan;

    /* Los textos de la portada de Shopcito. */
    res.locals.shopcito = shopcito;
    next();
  });

  /* Los planes para la web pública.

     Se piden AQUÍ y no en la vista, porque una vista es síncrona: si
     los pidiera ella, la primera vez que se renderizara no los tendría
     y la portada saldría sin planes. Un fallo que solo aparece en
     producción y solo la primera vez.

     `planes()` nunca lanza: si la base falla devuelve el respaldo sin
     precio y la web sigue en pie. Ver la cabecera de `lib/planes.js`. */
  router.use(async function inyectaPlanes(req, res, next) {
    const { planes, deRespaldo } = await planesLib.planes();
    res.locals.planes = planes;
    res.locals.precioDePlan = planesLib.precioDe;
    res.locals.planesDeRespaldo = deRespaldo;
    next();
  });

  /* ---------- Home ----------
     El título y la descripción van aquí y no en la vista: son lo
     que lee el buscador, y la vista es lo que lee el visitante.

     Se quitaron las palabras "diseño web", "web apps" y
     "aplicaciones a medida" que decía antes. Con el título viejo,
     un comercio que busca "bot de whatsapp" no encuentra nada y
     una agencia que ya no existe nos encuentra a nosotros. */
  router.get("/", (req, res) => {
    res.locals.current = "inicio";
    res.render("index", {
      title: "Shopcito — El copiloto digital para tu comercio o emprendimiento",
      description:
        "Automatizá tus respuestas de WhatsApp, agendá turnos y vendé desde tu propio mini shop. " +
        "Tu bot atiende las 24 horas y a vos te llega todo ordenado al celular. Sin comisiones ni letra chica.",
    });
  });

  /* ---------- Servicios ----------
     Retirado. Vendía diseño web, que no es lo que se vende.

     302 y no 301: hay enlaces fuera que se llevan a la portada, y no
     se cierra la puerta a reescribirla si algún día hace falta. */
  router.get("/servicios", (req, res) => res.redirect(302, "/#precios"));

  /* ---------- Precios ---------- */
  router.get("/precios", page("precios", "precios", {
    title: "Planes de Shopcito — el bot, el catálogo y los turnos",
    description:
      "Los tres planes de Shopcito: bot de WhatsApp, mini shop y agenda de turnos. Mensuales y sin permanencia. El precio se dice cuando nos escribís.",
  }));

  /* ---------- Contacto ---------- */
  router.get("/contacto", page("contacto", "contacto", {
    title: "Contacto — Shopcito",
    description:
      "Escribinos y te decimos cuánto cuesta el plan que te sirve. Respondemos en menos de 24 horas.",
  }));

  /* ---------- Proyectos ----------
     Retirado: los seis casos que había eran de ejemplo, con nombres y
     métricas inventadas. Publicarlos en nombre de Shopcito sería
     publicar cifras falsas. */
  router.get("/proyectos", (req, res) => res.redirect(302, "/"));

  /* ---------- Caso de proyecto ----------
     Retirado junto con /proyectos: los casos que había eran de ejemplo,
     con nombres y métricas inventadas. Publicarlos en nombre de
     Shopcito sería publicar cifras falsas.

     302 y no 301: hay enlaces fuera y una redirección lleva a donde sí
     hay algo. El 301 lo cachea el navegador un año, y esta decisión no
     está tomada. */
  router.get("/proyectos/:slug", (req, res) => res.redirect(302, "/"));

  /* ---------- Blog ----------
     Retirado. Los tres artículos hablan de cuánto cuesta una web, con
     cifras en euros de un negocio que ya no existe. */
  router.get("/blog", (req, res) => res.redirect(302, "/"));
  router.get("/blog/:slug", (req, res) => res.redirect(302, "/"));

  /* ---------- Legales ---------- */
  router.get("/aviso-legal", page("aviso-legal", "", {
    title: "Aviso legal — Nexo Studio",
    description:
      "Aviso legal: titularidad del sitio web, condiciones de uso, propiedad intelectual y responsabilidad.",
  }));

  router.get("/privacidad", page("privacidad", "", {
    title: "Política de privacidad — Nexo Studio",
    description: "Política de privacidad y tratamiento de datos personales conforme al RGPD y la LOPDGDD.",
  }));

  router.get("/cookies", page("cookies", "", {
    title: "Política de cookies — Nexo Studio",
    description:
      "Política de cookies: qué cookies utiliza este sitio web y cómo gestionarlas o retirar el consentimiento.",
  }));

  router.get("/condiciones", page("condiciones", "", {
    title: "Condiciones de contratación — Nexo Studio",
    description:
      "Condiciones de contratación de proyectos web: presupuesto, pagos, plazos, garantía, propiedad del código y soporte.",
  }));

  /* ---------- Formulario de contacto ----------
     Escribe en dos sitios a propósito:
       1. data/consultas.jsonl — funciona siempre, aunque Supabase esté caído
       2. Supabase (leads)      — el panel de gestión
     Si el primero falla, no se pierde el contacto. */
  router.post("/contacto", (req, res) => {
    const body = req.body || {};
    const clean = (v) => String(v == null ? "" : v).trim();
    const errors = {};

    const name = clean(body.name);
    const email = clean(body.email);
    const message = clean(body.message);

    if (!name) errors.name = "Indica tu nombre.";
    if (!email) {
      errors.email = "Indica tu email.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      errors.email = "Introduce un email válido.";
    }
    if (!message || message.length < 10) {
      errors.message = "Cuéntanos un poco más (mínimo 10 caracteres).";
    }
    if (!body.rgpd) {
      errors.rgpd = "Debes aceptar la política de privacidad para enviar el formulario.";
    }

    if (Object.keys(errors).length) {
      return res.status(400).json({ ok: false, errors });
    }

    const registro = {
      fecha: new Date().toISOString(),
      nombre: name,
      email,
      empresa: clean(body.company),
      telefono: clean(body.phone),
      tipo: clean(body.type),
      presupuesto: clean(body.budget),
      mensaje: message,
      ip: req.ip,
    };

    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.appendFileSync(DATA_FILE, JSON.stringify(registro) + "\n", "utf8");
    } catch (err) {
      console.error("No se pudo guardar la consulta:", err);
      return res
        .status(500)
        .json({ ok: false, errors: { general: "No se pudo enviar el mensaje. Escríbenos a " + site.email } });
    }

    /* Copia operativa en Supabase. Nunca dejamos que un fallo aquí
       rompa el envío: el contacto ya está guardado en el archivo. */
    try {
      const { saveLead } = require("../lib/leads");
      saveLead(registro).catch((err) => console.error("Lead no guardado en Supabase:", err.message));
    } catch (err) {
      console.error("Módulo de leads no disponible:", err.message);
    }

    console.log("[consulta] " + registro.nombre + " <" + registro.email + "> · " + registro.tipo);
    res.json({ ok: true });
  });

  /* ---------- Sitemap ---------- */
  router.get("/sitemap.xml", (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const urls = [
      { loc: site.url + "/", lastmod: today, changefreq: "weekly", priority: "1.0" },
      /* /servicios, /proyectos y /blog ya no se publican: ahora
           redirigen a la portada. Una URL que redirige no va en el
           sitemap, y dejarlas hacia que Google las indexara con el
           contenido del estudio digital. */
      { loc: site.url + "/precios", lastmod: today, changefreq: "monthly", priority: "0.8" },
      { loc: site.url + "/contacto", lastmod: today, changefreq: "monthly", priority: "0.8" },
      { loc: site.url + "/aviso-legal", lastmod: today, changefreq: "monthly", priority: "0.4" },
      { loc: site.url + "/privacidad", lastmod: today, changefreq: "monthly", priority: "0.4" },
      { loc: site.url + "/cookies", lastmod: today, changefreq: "monthly", priority: "0.4" },
      { loc: site.url + "/condiciones", lastmod: today, changefreq: "monthly", priority: "0.4" },
    ];

    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls
        .map(
          (u) =>
            "  <url>\n    <loc>" +
            u.loc +
            "</loc>\n    <lastmod>" +
            u.lastmod +
            "</lastmod>\n    <changefreq>" +
            u.changefreq +
            "</changefreq>\n    <priority>" +
            u.priority +
            "</priority>\n  </url>"
        )
        .join("\n") +
      "\n</urlset>";

    res.header("Content-Type", "application/xml");
    res.send(xml);
  });

  /* ---------- 404 público ----------
     Va al final de esta router, nunca antes: si se pusiera al
     principio, se comería las rutas del panel. */
  router.use((req, res) => {
    res.locals.noindex = true;
    res.status(404).render("404", {
      title: "Página no encontrada — Nexo Studio",
      description: "La página que buscas no existe.",
      current: "",
    });
  });
}

module.exports = router;
