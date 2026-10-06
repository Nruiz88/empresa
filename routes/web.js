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
  const { posts, projects, figures, faq, cases, precios } = content;

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
    res.locals.PROYECTOS = precios.PROYECTOS;
    res.locals.MANTENIMIENTO = precios.MANTENIMIENTO;
    res.locals.BANDAS_PRESUPUESTO = precios.BANDAS_PRESUPUESTO;
    res.locals.precio = precios.importe;
    res.locals.simbolo = precios.simbolo;
    res.locals.precioDe = precios.precioDe;
    next();
  });

  /* ---------- Home ---------- */
  router.get("/", (req, res) => {
    res.locals.current = "inicio";
    res.locals.structuredFaq = faq.home;
    res.render("index", {
      title: "Nexo Studio — Diseño web, webs app y aplicaciones para empresas",
      description:
        "Diseñamos y desarrollamos webs, tiendas online, web apps y aplicaciones a medida para empresas y comercios. Ver proyectos, precios y servicios.",
      posts: posts.slice(0, 3),
    });
  });

  /* ---------- Servicios ---------- */
  router.get("/servicios", (req, res) => {
    res.locals.current = "servicios";
    res.locals.structuredFaq = faq.servicios;
    res.render("servicios", {
      title: "Servicios — Nexo Studio",
      description:
        "Diseño y desarrollo web, tiendas online, web apps, aplicaciones a medida, SEO y mantenimiento para empresas y comercios.",
    });
  });

  /* ---------- Precios ---------- */
  router.get("/precios", page("precios", "precios", {
    title: "Precios — Nexo Studio",
    description:
      "Planes y precios de diseño y desarrollo web, tiendas online, web apps y aplicaciones a medida. Presupuesto cerrado y sin sorpresas.",
  }));

  /* ---------- Contacto ---------- */
  router.get("/contacto", page("contacto", "contacto", {
    title: "Contacto — Nexo Studio",
    description:
      "Pide tu presupuesto gratuito de diseño y desarrollo web, tiendas online, web apps o aplicaciones a medida. Respondemos en menos de 24 horas.",
  }));

  /* ---------- Proyectos ---------- */
  router.get("/proyectos", page("proyectos", "proyectos", {
    title: "Proyectos — Nexo Studio",
    description:
      "Portafolio de webs, tiendas online, web apps y aplicaciones a medida realizadas para empresas y comercios.",
  }));

  /* ---------- Caso de proyecto ---------- */
  router.get("/proyectos/:slug", (req, res, next) => {
    const project = projects.find((p) => p.slug === req.params.slug);
    if (!project) return next();

    const caseData = cases[project.slug];
    if (!caseData) return next();

    res.locals.current = "proyectos";
    res.locals.project = project;
    res.locals.caseData = caseData;
    res.locals.breadcrumbs = [
      { name: "Inicio", url: "/" },
      { name: "Proyectos", url: "/proyectos" },
      { name: project.name, url: null },
    ];

    res.locals.structuredData = {
      "@context": "https://schema.org",
      "@type": "CreativeWork",
      name: caseData.heroTitle,
      headline: caseData.heroTitle,
      description: caseData.heroLead,
      abstract: caseData.challenge,
      dateCreated: String(project.year),
      creator: { "@type": "Organization", name: site.company, url: site.url },
      about: project.tags,
      url: site.url + "/proyectos/" + project.slug,
      image: site.url + site.ogImage,
    };

    res.locals.relatedProjects = projects.filter((p) => p.slug !== project.slug).slice(0, 3);

    res.render("proyecto", {
      title: caseData.heroTitle + " — Nexo Studio",
      description: caseData.heroLead,
    });
  });

  /* ---------- Blog ---------- */
  router.get("/blog", page("blog", "blog", {
    title: "Blog — Nexo Studio",
    description:
      "Guías sobre precios de webs, SEO local, apps para empresas y tecnología: lo que necesitas saber antes de contratar un estudio digital.",
    data: { posts },
  }));

  router.get("/blog/:slug", (req, res) => {
    const post = posts.find((p) => p.slug === req.params.slug);
    if (!post) {
      return res.status(404).render("404", { title: "Artículo no encontrado", description: "", current: "" });
    }

    const related = posts.filter((p) => p.slug !== post.slug).slice(0, 3);
    res.locals.current = "blog";
    res.locals.ogType = "article";
    res.locals.breadcrumbs = [
      { name: "Inicio", url: "/" },
      { name: "Blog", url: "/blog" },
      { name: post.title, url: null },
    ];
    res.locals.structuredData = {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: post.title,
      description: post.description,
      author: { "@type": "Organization", name: site.company },
      publisher: {
        "@type": "Organization",
        name: site.company,
        logo: { "@type": "ImageObject", url: site.url + site.ogImage, width: 540, height: 140 },
      },
      datePublished: post.dateISO,
      dateModified: post.dateISO,
      image: site.url + site.ogImage,
      url: site.url + "/blog/" + post.slug,
    };
    res.render("post", { title: post.title + " — Nexo Studio", description: post.description, post, related });
  });

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
      { loc: site.url + "/servicios", lastmod: today, changefreq: "monthly", priority: "0.8" },
      { loc: site.url + "/proyectos", lastmod: today, changefreq: "monthly", priority: "0.8" },
      ...projects.map((p) => ({
        loc: site.url + "/proyectos/" + p.slug,
        lastmod: String(p.year) + "-01-01",
        changefreq: "yearly",
        priority: "0.7",
      })),
      { loc: site.url + "/precios", lastmod: today, changefreq: "monthly", priority: "0.8" },
      { loc: site.url + "/contacto", lastmod: today, changefreq: "monthly", priority: "0.8" },
      { loc: site.url + "/blog", lastmod: today, changefreq: "weekly", priority: "0.7" },
      ...posts.map((p) => ({
        loc: site.url + "/blog/" + p.slug,
        lastmod: p.dateISO,
        changefreq: "monthly",
        priority: "0.7",
      })),
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
