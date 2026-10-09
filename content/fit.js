/* =========================================================
   Shopcito — Encaje del cliente ("¿es para mí?")
   ------------------------------------------------------------
   Bloque de auto-cualificación. Sirve para que alguien se
   identifique rápido Y para que los que no encajan se autodetecten:
   filtrar mal es más barato que razonar un presupuesto a un
   cliente que íbamos a poder satisfacer igualmente.

   Las frases describen un servicio real. Revísalas: si no es
   exactamente cómo trabajáis, ajústalas.

   Para un bloque por servicio, duplica la estructura y pasa el
   array correspondiente:
     <%- include('partials/fit', { fit: fitsPorServicio.web }) %>
   ========================================================= */

/* Bloque general, para /servicios */
module.exports = {
  title: "Antes de escribirnos",
  lead: "Para ahorrarte tiempo (y el nuestro), comprueba si encajamos.",
  fits: {
    title: "Encaja si…",
    items: [
      "Necesitas una web, una tienda o una aplicación y aún no la tienes.",
      "Ya tienes web, pero no genera los contactos ni las ventas que necesitas.",
      "Quieres saber cuánto cuesta antes de comprometerte.",
      "Valoras que quien te entrega el proyecto entienda de negocio, no solo de código.",
      "Necesitas el trabajo entregado en plazos concretos.",
    ],
  },
  notFits: {
    title: "Mejor no si…",
    items: [
      "Buscas la web más barata del mercado sin fase de descubrimiento: te va a salir cara igual.",
      "La necesitas publicada esta misma semana.",
      "Quieres copiar el diseño de otra web tal cual, sin adaptarlo.",
      "No tienes presupuesto reservado para el mantenimiento posterior.",
    ],
  },
};
