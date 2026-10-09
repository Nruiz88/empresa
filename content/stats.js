/* =========================================================
   Shopcito — Cifras y prueba social (fuente única)
   ------------------------------------------------------------
   ⚠️  DATOS DE EJEMPLO — NO SON REALES ⚠️
   Todas las cifras de la web salen de aquí. Antes de publicar,
   sustitúyelas por datos verificables y guarda evidencia de cada
   métrica: una cifra que un cliente no pueda confirmar es un
   problema, no un argumento de venta.

   Es un único archivo precisamente para eso: cuando lleguen los
   datos reales se corrige aquí y se actualiza toda la web.
   ========================================================= */

/* Métricas destacadas de la home y de /servicios */
module.exports.stats = [
  { count: 120, prefix: "+", label: "Proyectos entregados" },
  { count: 85, prefix: "+", label: "Clientes satisfechos" },
  { count: 8, suffix: " años", label: "De experiencia" },
  { count: 4.9, decimals: 1, prefix: "", suffix: "/5", label: "Valoración media" },
];

/* Bloque de resultados que comparten la home y /servicios */
module.exports.resultados = {
  titulo: "Lo que pasa después de publicar",
  lead: "Agregamos lo que ocurre tras el lanzamiento, no lo que se ve en una pantalla.",
  stats: [
    { count: 120, prefix: "+", label: "Proyectos entregados" },
    { count: 85, prefix: "+", label: "Clientes satisfechos" },
    { count: 40, prefix: "+", suffix: " %", label: "Conversión media" },
    { count: 4.9, decimals: 1, suffix: "/5", label: "Valoración media" },
  ],
  pills: ["Precio cerrado por escrito", "Entrega en plazo", "Soporte tras la entrega"],
};

/* Píldoras de resultado de la sección de proyectos (home) */
module.exports.resultPills = ["+40 % conversiones", "15 h/semana ahorradas", "−60 % llamadas de reserva"];

/* Prueba social del hero */
module.exports.heroProof = {
  rating: "4,9/5",
  claim: "+120 proyectos entregados",
  avatars: [
    { initials: "LM", variant: 1 },
    { initials: "RO", variant: 2 },
    { initials: "CV", variant: 3 },
  ],
  overflowLabel: "+80",
};

/* Disponibilidad mostrada bajo los CTA */
module.exports.disponibilidad =
  "Disponibles para 2 proyectos este mes · Respuesta en menos de 24 h";