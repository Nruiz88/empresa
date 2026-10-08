/**
 * Artículos del blog.
 * El metadata vive aquí y el cuerpo de cada artículo en views/posts/<slug>.ejs
 */
/* Los importes del excerpt salen de `content/precios.js`.

   Es un artículo sobre cuánto cuesta una web. Si el precio del plan
   cambia y el excerpt sigue con el número viejo, el artículo que
   explica los precios está mintiendo, que es peor que no hablar de
   ellos: es el artículo al que va la gente justo cuando pregunta
   cuánto va a pagar. */
const precios = require("./precios.js");
module.exports = [
  {
    slug: "cuanto-cuesta-una-web-para-una-empresa",
    title: "¿Cuánto cuesta una web para una empresa? Precios reales",
    description:
      "Precios reales de una web corporativa en España: qué influye en el coste, qué debería incluir un presupuesto y cómo detectar presupuestos demasiado baratos.",
    category: "Precios",
    dateISO: "2026-09-12",
    dateLabel: "12 sep 2026",
    readTime: "7 min de lectura",
    excerpt:
      "Retirado: el artículo hablaba de cuánto cuesta una web, con cifras en euros de un negocio que ya no existe.",
  },
  {
    slug: "seo-local-para-comercios",
    title: "SEO local: cómo aparecer en Google Maps cuando te buscan cerca",
    description:
      "Guía práctica de SEO local para comercios: ficha de Google Business Profile, reseñas, citas locales y página con datos de contacto que Google entiende.",
    category: "SEO",
    dateISO: "2026-09-24",
    dateLabel: "24 sep 2026",
    readTime: "6 min de lectura",
    excerpt:
      "El 46 % de las búsquedas en Google tienen intención local. Te enseñamos los 5 factores que de verdad mueven tu ficha en el mapa.",
  },
  {
    slug: "web-o-aplicacion-para-tu-negocio",
    title: "¿Web o aplicación a medida? Cómo decidir sin gastar de más",
    description:
      "Cuándo necesitas una web, cuándo una web app y cuándo una aplicación a medida. Errores habituales que disparan el coste de un proyecto digital.",
    category: "Producto",
    dateISO: "2026-09-29",
    dateLabel: "29 sep 2026",
    readTime: "5 min de lectura",
    excerpt:
      "La mayoría de proyectos se encarecen por elegir tecnología antes de definir el problema. Te damos un criterio de decisión en 3 preguntas.",
  },
];
