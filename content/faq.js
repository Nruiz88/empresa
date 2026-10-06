/* =========================================================
   Nexo Studio — Preguntas frecuentes por página
   ------------------------------------------------------------
   SeLxieren de un solo sitio. Las respuestas están escritas para
   Se guardan de un solo sitio. Las respuestas están escritas para
   garantía de algo que no dais, es un problema.

   Usado por partials/faq.ejs
   ========================================================= */

/* Los importes de las respuestas salen de `content/precios.js`, no
   escritos dentro del texto.

   Motivo: una respuesta que dice "desde 890 €" es un número en un
   sitio donde nadie lo va a buscar si hay que cambiarlo. Y hay que
   cambiarlo: el precio de la web es lo más volátil del negocio.

   La respuesta ahora se COMPUE con los datos de los planes, así que
   si el precio cambia en `precios.js` el texto de la FAQ cambia
   solo. No puede quedar desactualizado, porque no está escrito. */
const precios = require("./precios.js");
const esencial = precios.precioDe(precios.plan("esencial"));
const negocio = precios.precioDe(precios.plan("negocio"));
const aMedida = precios.precioDe(precios.plan("a-medida"));
module.exports.servicios = [
  {
    q: "¿Cuánto tarda un proyecto de diseño web?",
    a: "Una web corporativa suele llevar entre 2 y 4 semanas, una tienda online entre 4 y 6, y una aplicación a medida entre 8 y 14. El plazo va por escrito en el presupuesto y no cambia sin que lo acordemos contigo.",
  },
  {
    q: "¿Cómo sé si mi web necesita un rediseño?",
    a: "Si tu web tarda más de 3 segundos en cargar, no aparece en Google o no genera contactos, casi seguro sí. Puedes pedirnos una auditoría gratuita y te decimos qué está fallando, aunque no trabajemos juntos.",
  },
  {
    q: "¿El código y el dominio son míos?",
    a: "Sí. Todo el código, el dominio y el alojamiento quedan a tu nombre desde el primer día. Si en el futuro dejamos de trabajar juntos, te lo entregamos y te ayudamos a migrarlo donde quieras.",
  },
  {
    q: "¿Necesito contratar mantenimiento al terminar?",
    a: "No es obligatorio, pero es recomendable: sin actualizaciones, un plugin sin parchear puede comprometer la web. Todos los proyectos incluyen tres meses de garantía por errores.",
  },
  {
    q: "¿Trabajáis con clientes fuera de Argentina?",
    a: "Trabajamos desde Argentina con clientes de toda la región. Nos adaptamos a su huso horario y facturamos en la moneda que corresponda a cada caso.",
  },
  {
    q: "¿Puedo editar el contenido yo mismo?",
    a: "Por supuesto. Entregamos la web con un gestor de contenidos para que publiques textos e imágenes sin tocar código, y te damos una formación de una hora por videollamada.",
  },
];

/* Preguntas frecuentes de la home (objetivo SEO y objeciones) */
module.exports.home = [
  {
    q: "¿Cuánto cuesta una web?",
    a: `Desde ${esencial} para una web de hasta 5 páginas. Una tienda online parte de ${negocio} y una aplicación a medida de ${aMedida}. El precio se cierra por escrito antes de empezar.`,
  },
  {
    q: "¿Trabajáis con clientes fuera de Argentina?",
    a: "Trabajamos desde Argentina con clientes de toda la región. Nos adaptamos a su huso horario y facturamos en la moneda que corresponda a cada caso.",
  },
  {
    q: "¿Cada cuánto necesito renovar la web?",
    a: "Una web bien hecha aguanta entre 3 y 5 años sin tocar el diseño. Lo que sí hay que renovar son las actualizaciones y el contenido, y eso se gestiona con el mantenimiento mensual.",
  },
  {
    q: "¿Y si no me gusta el resultado final?",
    a: "Pagas por fases y ves cada entrega en un entorno de pruebas. En las dos primeras fases puedes pedir cambios sin coste. No se factura nada hasta que apruebes el diseño.",
  },
];
