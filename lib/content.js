/* =========================================================
   Nexo Studio — Contenido de /content
   ------------------------------------------------------------
   Punto único de carga para todo el contenido editorial.
   Las dos aplicaciones (web y panel) leen de aquí.

   Por qué está separado: antes cada vista hacía su propio
   require de cada archivo, y añadir contenido obligaba a
   tocar varios ficheros. Con esto, añadir un archivo aquí
   basta.
   ========================================================= */

const path = require("path");

const dir = path.join(__dirname, "..", "content");

const posts = require(path.join(dir, "posts.js"));
const projects = require(path.join(dir, "projects.js"));
const figures = require(path.join(dir, "stats.js"));
const testimonials = require(path.join(dir, "testimonials.js"));
const tech = require(path.join(dir, "tech.js"));
const faq = require(path.join(dir, "faq.js"));
const fit = require(path.join(dir, "fit.js"));
const cases = require(path.join(dir, "cases.js"));
const automation = require(path.join(dir, "automation.js"));
const precios = require(path.join(dir, "precios.js"));

module.exports = {
  posts,
  projects,
  figures,
  testimonials,
  tech,
  faq,
  fit,
  cases,
  automation,
  /* Los precios públicos van aquí, y no sueltos en cada vista: antes
     los mismos ocho números estaban escritos en `index.ejs`,
     `precios.ejs`, `faq.js` y `posts.js`, y cambiarlos era editar
     cuatro archivos. Olvidar uno es tener dos precios distintos en la
     propia web. Ver la cabecera de `content/precios.js`. */
  precios,
  PROYECTOS: precios.PROYECTOS,
  MANTENIMIENTO: precios.MANTENIMIENTO,

  /* Alias que ya usan las vistas */
  categorias: projects.categorias,
  techAuditoria: tech.auditoria,
};