/* =========================================================
   Shopcito — Servicios de automatización e IA
   ------------------------------------------------------------
   ⚠️  ESTE BLOQUE ES EL MÁS PELIGROSO DE LA WEB ⚠️

   Las automatización B no son "diseño web": son integración con
   APIs externas y servicios de terceros. Si prometes algo aquí que no
   puedes entregar hoy, se rompe en la primera reunión y el daño
   es mayor que en cualquier otro servicio, porque estás
   asumes una dependencia externa (WhatsApp, pasarelas, CRM).

   Antes de publicar, revisa `status` en cada servicio:

     "listo"    → lo hacéis y lo soportáis. Publícalo normal.
     "proximo"  → lo estáis montando. Publícalo, pero di cuándo.
     "no"       → no lo offered. NO lo publiques (ponlo a false).

   Particularmente sobre los bots de WhatsApp: requieren
   verificación de empresa en Meta Business y pasar por un
   proveedor (BSP) o solicitar acceso directo. Las plantillas de
   mensaje las aprueba Meta. No es un trabajo de una tarde.

   Para desactivar uno sin tocar la vista: pon status: "no".
   ========================================================= */

module.exports = [
  {
    slug: "bot-whatsapp",
    status: "proximo",
    icon: "whatsapp",
    title: "Bot de WhatsApp",
    lead: "Tu negocio atiende por WhatsApp aunque estés en una reunión. El bot responde, recoge el pedido y te avisa.",
    items: [
      "Reservas y pedidos automáticamente",
      "Estado de envío y horarios sin escribir",
      "Recordatorios de cita con opción de confirmar",
      "Traspaso a una persona cuando toca",
    ],
    note: "En preparación: requiere verificación de empresa en Meta.",
  },
  {
    slug: "ia-conversacional",
    status: "listo",
    icon: "brain",
    title: "IA conversacional con tus datos",
    lead: "Un asistente que responde con tu catálogo, tus precios y tu documentación real. No inventa: cita tus fuentes.",
    items: [
      "Responde con la ficha técnica o el catálogo",
      "Cualifica al visitante antes de pasarle el lead",
      "Aprende de tus PDFs, no de internet",
      "Traspaso a humano con el contexto de la conversación",
    ],
    note: null,
  },
  {
    slug: "automatizacion-lead",
    status: "listo",
    icon: "bolt",
    title: "Automatización de presupuestos y leads",
    lead: "Cada contacto te llega con toda la ficha rellenada y asignado a la persona correcta. Sin hojas de cálculo.",
    items: [
      "Lead a tu CRM o a tu correo con contexto",
      "Asignación automática por zona o tipo de proyecto",
      "Aviso cuando un presupuesto no se acepta",
      "Seguimiento automático sin que nadie se acuerde",
    ],
    note: null,
  },
  {
    slug: "pagos",
    status: "listo",
    icon: "card",
    title: "Pago fraccionado y pasarelas",
     lead: "Quitar la barrera de entrada sin tocar tu margen: que cualquiera pueda pagar poco a poco.",
    items: [
      "Mensualidades para reducir la fricción de compra",
      "Pasarelas locales además de tarjeta",
      "Pago con Apple Pay, Google Pay y Bizum",
      "Conciliación y facturación automática",
    ],
    note: null,
  },
];

/* Diagrama del flujo: explica el producto sin texto largo.
   Es el hilo conductor de la sección en la home. */
module.exports.flujo = [
  { step: "01", icon: "chat", title: "El cliente escribe", text: "Por WhatsApp o desde la web, a las 3 de la mañana." },
  { step: "02", icon: "bot", title: "Responde solo", text: "Consulta tu catálogo y tus condiciones reales." },
  { step: "03", icon: "filter", title: "Filtra y guarda", text: "Guarda el lead con su ficha completa en tu CRM." },
  { step: "04", icon: "bell", title: "Te avisa", text: "Solo te interrumpe cuando hay una oportunidad real." },
];
