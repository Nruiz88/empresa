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

  /* Alias que ya usan las vistas */
  categorias: projects.categorias,
  techAuditoria: tech.auditoria,
};