/* =========================================================
   Shopcito — Preguntas frecuentes por página
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

/* Preguntas frecuentes de la home (objetivo SEO y objeciones).
   Escritas alrededor de las dos búsquedas que interesan: "bot de
   WhatsApp" y "sistema de inventario" para comercios. */
module.exports.home = [
  {
    q: "¿Qué es Shopcito?",
    a: "Shopcito es el copiloto digital de tu comercio: un bot de WhatsApp que atiende solo las 24 horas y un sistema de inventario para controlar el stock. Se conecta a tu número de siempre, sin que tus clientes instalen nada.",
  },
  {
    q: "¿Cómo funciona el bot de WhatsApp?",
    a: "El bot responde las consultas de siempre —precios, horarios, disponibilidad— con el tono de tu negocio, vende desde tu mini shop y agenda turnos. Contesta al instante, aunque el local esté cerrado.",
  },
  {
    q: "¿Qué hace el sistema de inventario?",
    a: "Lleva el stock de tu comercio en tiempo real: registra lo que entra y lo que sale, te avisa cuando un producto se está acabando y guarda tus proveedores. Reemplaza las planillas y las cuentas a mano.",
  },
  {
    q: "¿Cuánto cuesta Shopcito?",
    a: "Los planes son mensuales, sin permanencia y sin comisiones por venta. Hay tres planes y se diferencian por lo que incluyen. Escribinos y te decimos cuál te sirve y su precio.",
  },
  {
    q: "¿Necesito instalar algo?",
    a: "No. Funciona sobre tu WhatsApp de siempre, sin que tus clientes tengan que bajar ninguna aplicación. Vos tampoco instalás nada: se conecta una vez y queda funcionando.",
  },
  {
    q: "¿Puedo probarlo antes de pagar?",
    a: "Sí. Probás 14 días sin tarjeta de crédito y sin compromiso. Si no te sirve, lo das de baja y no pasa nada.",
  },
];
