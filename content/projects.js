/* =========================================================
   Shopcito — Proyectos (fuente única de verdad)
   ------------------------------------------------------------
   ⚠️  DATOS DE EJEMPLO — NO SON REALES ⚠️
   Nombres, resultados y métricas son ficticios. Antes de
   publicar, sustitúyelos por casos reales y pide permiso a cada
   cliente para usar su marca.

   Se centraliza aquí porque estaban duplicados entre index.ejs y
   proyectos.ejs. Eso ya había producido una discrepancia real:
   la home enseñaba 6 proyectos y /proyectos 9, con textos
   distintos para el mismo cliente.

   Campos:
     slug      {string}   Identificador
     name      {string}   Nombre del cliente o proyecto
     initials  {string}   Letras de la miniatura
     thumb     {number}   1-6, variante de color .thumb-N
     category  {string}   web | ecommerce | app | celular
                         (debe coincidir con el slug de `categorias`)
     tags      {string[]} Etiquetas visibles
     summary   {string}   Descripción de la tarjeta
     summaryShort {string} Versión corta para la home (opcional)
     result    {string}   Métrica destacada (⚠️ verificar antes de publicar)
     year      {number}   Año de entrega

  Campos del caso (solo para /proyectos/<slug>):
     sector       {string}   A qué se dedica el cliente
     heroTitle    {string}   Titular del caso
     heroLead     {string}   Entradilla
     challenge    {string}   Qué le pasaba ("El reto")
     solution     {string[]} Qué hicimos, en 3-4 puntos
     outcome      {string[]} Qué consiguió, en 3-4 puntos
     metrics      [{value,label}] Cifras destacadas
     duration     {string}   Plazo de ejecución
     stack        {string[]} Tecnologías empleadas
     testimonial  {object}   { quote, name, role }
   ========================================================= */

module.exports = [
  {
    slug: "mercado-norte",
    name: "Mercado Norte",
    initials: "MN",
    thumb: 1,
    category: "ecommerce",
    tags: ["E-commerce", "Alimentación"],
    summary:
      "Tienda online de alimentación con 1.200 referencias, envíos por horario, suscripciones de compra semanal y pagos con Bizum y tarjeta.",
    summaryShort:
      "Tienda online de alimentación con 1.200 referencias, envíos por horario y pagos recurrentes.",
    result: "+40 % conversiones en 3 meses",
    year: 2024,
  },
  {
    slug: "clinica-salud",
    name: "Clínica Salud+",
    initials: "S+",
    thumb: 2,
    category: "app",
    tags: ["Web app", "Salud"],
    summary:
      "Portal de pacientes con cita online, historial clínico, recordatorios por SMS y facturación a aseguradoras.",
    summaryShort:
      "Portal de pacientes con cita online, historial y recordatorios automáticos por SMS.",
    result: "−60 % llamadas de reserva",
    year: 2024,
  },
  {
    slug: "logitrack",
    name: "LogiTrack",
    initials: "LT",
    thumb: 3,
    category: "app",
    tags: ["Web app", "Logística"],
    summary:
      "Panel de control de flota en tiempo real con seguimiento de rutas, incidencias de conductor y facturación automática por viaje.",
    summaryShort:
      "Panel de control de flota en tiempo real con rutas, incidencias y facturación automática.",
    result: "15 h/semana ahorradas en gestión",
    year: 2023,
  },
  {
    slug: "bruma-cafe",
    name: "Bruma Café",
    initials: "BC",
    thumb: 4,
    category: "web",
    tags: ["Web", "Hostelería"],
    summary:
      "Web con carta digital escaneable, reservas de mesa, programa de fidelización y SEO local para 4 locales.",
    summaryShort:
      "Web con carta digital, reservas de mesa y programa de fidelización para 4 locales.",
    result: "+2.000 reservas online al año",
    year: 2024,
  },
  {
    slug: "finvia",
    name: "Finvia",
    initials: "FV",
    thumb: 5,
    category: "celular",
    tags: ["App a medida", "Fintech"],
    summary:
      "Aplicación de gestión de gastos con flujos de aprobación, categorías automáticas, tarjetas de equipo y exportación contable.",
    summaryShort:
      "Aplicación de gestión de gastos con aprobaciones, categorías y exportación contable.",
    result: "Adopción del 85 % en plantilla",
    year: 2023,
  },
  {
    slug: "rutaverde",
    name: "RutaVerde",
    initials: "RV",
    thumb: 6,
    category: "celular",
    tags: ["PWA", "Turismo"],
    summary:
      "App de reservas de experiencias de naturaleza con pagos, check-in sin conexión y avisos meteorológicos.",
    summaryShort:
      "App de reservas de experiencias de naturaleza con pagos y check-in sin conexión.",
    result: "+35 % reservas celular",
    year: 2024,
  },
  {
    slug: "estudio-vega",
    name: "Estudio Vega",
    initials: "EV",
    thumb: 1,
    category: "web",
    tags: ["Web", "Industria"],
    summary:
      "Web corporativa multilingüe con portfolio interactivo, blog técnico y descargas de fichas de producto para distribuidores.",
    result: "Triple de leads cualificados",
    year: 2023,
  },
  {
    slug: "ambar-lino",
    name: "Ámbar Lino",
    initials: "AL",
    thumb: 3,
    category: "ecommerce",
    tags: ["E-commerce", "Moda"],
    summary:
      "Tienda de moda sostenible con tallas guiadas, devoluciones automatizadas e integración con 3 marketplaces.",
    result: "+52 % ticket medio",
    year: 2025,
  },
  {
    slug: "campus-forja",
    name: "Campus Forja",
    initials: "CF",
    thumb: 5,
    category: "app",
    tags: ["Web app", "Formación"],
    summary:
      "Plataforma de formación con cursos, vídeos protegidos, certificados y panel para empresas que forman a su equipo.",
    result: "1.400 alumnos activos",
    year: 2025,
  },
];

/* Categorías de los filtros.
   El slug debe coincidir con `category` de cada proyecto: main.js
   compara data-filter con data-category para mostrar u ocultar. */
module.exports.categorias = [
  { slug: "all", label: "Todos" },
  { slug: "web", label: "Webs" },
  { slug: "ecommerce", label: "Tiendas online" },
  { slug: "app", label: "Web apps" },
  { slug: "celular", label: "Apps a medida" },
];