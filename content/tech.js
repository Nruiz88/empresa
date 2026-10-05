/* =========================================================
   Nexo Studio — Tecnologías e integraciones
   ------------------------------------------------------------
   ⚠️  IMPORTANTE: ESTA ES UNA DECLARACIÓN DE CAPACIDAD ⚠️
   Publicar "trabajamos con Stripe" o "Somos expertos en Shopify"
   es una afirmación comercial. Si algo de esta lista no es cierto
   o no lo haces habitualmente:
     - bórralo
     - o márcalo como "a demanda"

   Estar en un competidor y no en tu web es normal. Inventar
   capacidades para llenar una sección es publicidad engañosa y
   además te exposurea en la primera reunión técnica.

   Para cambiarlo: edita este archivo. Ninguna vista lo tiene
   hardcodeado.

   Cada grupo:
     title {string}  Nombre del grupo
     items {string[]} Tecnologías del grupo
   ========================================================= */

module.exports = [
  {
    title: "Tiendas online",
    items: ["Shopify", "WooCommerce", "PrestaShop", "Tienda propia headless"],
  },
  {
    title: "Pagos",
    items: ["Stripe", "PayPal", "Bizum", "Redsys", "Mercado Pago"],
  },
  {
    title: "CRM y marketing",
    items: ["HubSpot", "Mailchimp", "Brevo", "Klaviyo", "Zoho CRM"],
  },
  {
    title: "Analítica",
    items: ["Google Analytics 4", "Plausible", "Microsoft Clarity", "GTM"],
  },
  {
    title: "Desarrollo",
    items: ["Node.js", "Laravel", "WordPress", "React", "Webflow"],
  },
  {
    title: "Infraestructura",
    items: ["Cloudflare", "Vercel", "Netlify", "DigitalOcean", "Amazon AWS"],
  },
];

/* Bloques de conocimiento quesolemos cubrir al auditar un proyecto.
   Sirven para mostrar que revisamos, sin prometer un stack concreto. */
module.exports.auditoria = [
  "Velocidad y Core Web Vitals",
  "SEO técnico y datos estructurados",
  "Accesibilidad WCAG 2.2 AA",
  "Analítica y eventos de conversión",
  "Seguridad y copias de respaldo",
];
