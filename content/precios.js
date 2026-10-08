/* =========================================================
   Nexo Studio — Los precios públicos, en UN solo sitio
   ------------------------------------------------------------
   Antes estos números vivían en cuatro archivos:

     views/index.ejs      los 3 planes de proyecto
     views/precios.ejs    los 3 de proyecto + los 3 de mantenimiento
     content/faq.js       el texto que dice "desde 890 €"
     content/posts.js     el texto que dice "entre 890 € y 5.000 €"

   Ocho cifras repetidas a mano. Para cambiar un precio había que
   editar cuatro archivos, y olvidar uno es tener dos precios
   distintos en la propia web —el peor sitio posible para que pase,
   porque en la portada y en /precios, que es donde se mira antes de
   escribir, se ven los dos.

   ── ESTO NO ES EL CATÁLOGO DE MÓDULOS ──

   Y hay que decirlo, porque se confunden y no es lo mismo:

     · ESTE archivo: precios de PROYECTO y mantenimiento que se
       anuncian en la web pública. "Una web cuesta X".
     · `modules`: los servicios RECURRENTES que se contratan por
       mensual —el bot de WhatsApp, el inventario, las reservas—.

   Son productos distintos, con precios distintos. Por eso los
   precios públicos NO salen de `modules` y por eso cambiar el
   catálogo no cambia esta página. Se Sunderstood que es lo que
   decía el catálogo y no: eso era un error.

   ── POR QUÉ NO SALE DE `modules` ──

   Porque un precio "desde" de proyecto no es una fila de catálogo.
   `modules.precio` es el precio de un módulo recurrente concreto;
   "una web desde X" es una oferta comercial que agrupa horas de
   trabajo. Meter una en la otra obligaría a modelar las ofertas
   como si fueran módulos, y el panel de catálogo enseñaría cosas
   que no se venden así.

   Lo que se puede —y es lo que se ha hecho— es que no haya ni un
   solo número escrito a mano fuera de este archivo.


   ── LA MONEDA ──

   ⚠️  PENDIENTE, Y NO SE ARREGLA CAMBIANDO UNA LÍNEA.

   Hay dos comercializaciones conviviendo en el sitio:

     · ESTA (PROYECTOS + MANTENIMIENTO): los planes del estudio
       digital de antes, con cifras que SON euros (890, 1990,
       4500) y páginas que siguen vivas: /precios, /servicios,
       /proyectos y los excerpts del blog, que leen de aquí.

     · LOS PLANES DE SHOPCITO (`content/shopcito.js`): pesos
       argentinos. Nadie presupuesta un bot en euros.

   Poner `simbolo: "$"` arregla los nuevos y rompe los viejos,
   que pasarían a decir "890 $" siendo euros. Arreglar los dos
   exige cambiar las cifras viejas también, y eso ya es un
   recorte de contenido —el negocio ya no vende webs— que
   arrastra al FAQ y a los artículos.

   Por eso no se tocó. Se resuelve con el resto del rebranding.

   LO QUE HAY QUE HACER ANTES DE PONERLE PRECIO A UN PLAN DE
   SHOPCITO:

     `precioDePlan()` formatea con este mismo símbolo, así que
     escribir `precio: 25000` en un plan de Shopcito HOY
     imprimiría "25.000 €". Es un error de un carácter que no
     va a ver nadie hasta que lo lea un cliente.

   ── EL FORMATO ──

   `importe()` pone el separador de millares con punto, como se
   escribe en español: 4500 -> "4.500". Sin esto, cada sitio que
   imprima el número elige su propio formato y se acaba viendo
   "1990" en un sitio y "1.990" en otro, para el mismo plan. */

const MONEDA = {
  codigo: "EUR",
  simbolo: "€",
  sufijo: "",
};

/* Los tres planes de proyecto.

   `plazo` va APARTE de `nota` a propósito.

   La primera versión sacaba el plazo de la nota con
   `nota.split("·").pop()` y salía mal: el plan Esencial pintaba
   "Entrega en 2-3 semanas" y el de A medida "8-14 semanas", porque
   uno lleva prefijo y el otro no. Los dos textos son correctos; lo
   que estaba mal era sacar el dato partiendo una frase.

   Un dato que se obtiene parseando una cadena es un dato que se
   rompe el día que alguien reescribe la frase sin querer. `plazo` es
   el plazo, y `nota` es la frase.

   `precio` es un NÚMERO, no un texto:
   escrito como texto no se puede sumar ni comparar, y alguien acaba
   haciendo aritmética a mano. El formato lo pone `importe()`. */
const PROYECTOS = [
  {
    id: "esencial",
    nombre: "Esencial",
    precio: 890,
    destacado: false,
    descripcion:
      "Para comercios y profesionales que necesitan una presencia online sólida.",
    nota: "Pago único · Entrega en 2-3 semanas",
    plazo: "2-3 semanas",
    incluye: [
      "Web de hasta 5 páginas",
      "Diseño responsive a medida",
      "Formulario de contacto y Google Maps",
      "SEO técnico básico",
      "Hosting y dominio el primer año",
    ],
    noIncluye: ["Tienda online", "Aplicación a medida"],
    cta: { texto: "Solicitar presupuesto", href: "/contacto", clase: "btn btn-ghost" },
  },
  {
    id: "negocio",
    nombre: "Negocio",
    precio: 1990,
    destacado: true,
    descripcion:
      "Para empresas que quieren captar clientes y vender online de forma seria.",
    nota: "Pago único · Entrega en 4-6 semanas",
    plazo: "4-6 semanas",
    incluye: [
      "Web de hasta 12 páginas + blog",
      "Tienda online o reservas online",
      "Textos y SEO on-page incluidos",
      "Analítica y objetivos configurados",
      "Integraciones (CRM, email, pagos)",
      "3 meses de soporte incluido",
    ],
    noIncluye: ["Aplicación a medida"],
    cta: { texto: "Solicitar presupuesto", href: "/contacto", clase: "btn btn-primary" },
  },
  {
    id: "a-medida",
    nombre: "A medida",
    precio: 4500,
    destacado: false,
    descripcion: "Web apps, aplicativos y plataformas con lógica de negocio compleja.",
    nota: "Presupuesto por fases · 8-14 semanas",
    plazo: "8-14 semanas",
    incluye: [
      "Arquitectura y diseño de producto",
      "Usuarios, roles y paneles privados",
      "API e integraciones con tu ERP",
      "App móvil o PWA",
      "Pruebas automatizadas y despliegue",
      "SLA de soporte y evolución",
      "Equipo dedicado",
    ],
    noIncluye: [],
    cta: { texto: "Hablemos del proyecto", href: "/contacto", clase: "btn btn-ghost" },
  },
];

/* Los tres planes recurrentes. `periodo` va aparte del precio porque
   "89 €" y "89 €/mes" no son el mismo dato, y si el periodo está en
   el texto hay gente que lo lee como un pago único. */
const MANTENIMIENTO = [
  {
    id: "mantenimiento-basico",
    nombre: "Mantenimiento Básico",
    precio: 29,
    periodo: "mes",
    descripcion: "Actualizaciones, copias diarias y monitorización de tu web.",
    incluye: [
      "Copias de seguridad diarias",
      "Actualizaciones de seguridad",
      "Monitorización y alertas",
    ],
  },
  {
    id: "mantenimiento-pro",
    nombre: "Mantenimiento Pro",
    precio: 89,
    periodo: "mes",
    descripcion: "Todo lo anterior más horas de mejoras y soporte prioritario.",
    incluye: [
      "Todo lo del plan Básico",
      "4 horas de mejoras al mes",
      "Soporte prioritario en 24 h",
    ],
  },
  {
    id: "seo-contenidos",
    nombre: "SEO y contenidos",
    precio: 350,
    periodo: "mes",
    descripcion: "Estrategia, artículos y optimización continua para crecer en Google.",
    incluye: [
      "4 artículos optimizados al mes",
      "Informe mensual de posiciones",
      "SEO local para comercios",
    ],
  },
];

/**
 * Las bandas de presupuesto del formulario de contacto.
 *
 * ── POR QUÉ ESTÁN AQUÍ Y NO ESCRITAS EN LA VISTA ──
 *
 * Porque son las que ve el cliente justo cuando va a escribir, y
 * es el ÚNICO precio que lee alguien que todavía no te ha
 * contratado. Un selector de presupuesto en euros en una web
 * argentina no es un detalle de formato: es que el cliente ve un
 * número que no le dice nada sobre lo que va a costarle.
 *
 * La escala está alineada con los rangos de mercado del artículo
 * "cuánto cuesta una web": web básica hasta 550.000, corporativa
 * hasta 1.200.000, web app hasta 3.500.000. Si esas bandas
 * quedaran muy lejos de los rangos que publica el artículo, el
 * cliente leería dos cifras incompatibles en la misma web.
 *
 * `valor` es lo que se guarda y llega al equipo. Lleva PREFIJO de
 * moneda a propósito: en la base `1000-3000` no se sabe si son
 * pesos o dólares, y un número sin unidad en un campo de dinero es
 * una pregunta que se repite en cada consulta.
 *
 * La opción "Prefiero comentarlo" NO está aquí: no es una banda de
 * precio sino una preferencia, y va escrita en la vista. Meterla en
 * los datos sería tenerla en dos sitios.
 *
 * @type {{valor: string, etiqueta: string}[]}
 */
const BANDAS_PRESUPUESTO = [
  { valor: "<400000 ARS", etiqueta: "Menos de $400.000" },
  { valor: "400000-900000 ARS", etiqueta: "$400.000 - $900.000" },
  { valor: "900000-2000000 ARS", etiqueta: "$900.000 - $2.000.000" },
  { valor: "2000000-4000000 ARS", etiqueta: "$2.000.000 - $4.000.000" },
  { valor: ">4000000 ARS", etiqueta: "Más de $4.000.000" },
];

/**
 * Un importe con separador de millares: 4500 -> "4.500".
 *
 * Se hace a mano y no con `toLocaleString` porque el resultado de
 * ese depende del locale del SERVIDOR, no del del visitante: con un
 * contenedor en inglés, 4500 sale "4,500", que aquí se lee como
 * cuatro mil quinientos. Un número mal impreso en la portada es un
 * número que no vale.
 *
 * @param {number} n
 * @returns {string}
 */
function importe(n) {
  const entero = Math.trunc(Math.abs(Number(n) || 0));
  const miles = String(entero).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (Number(n) < 0 ? "-" : "") + miles;
}

/** El símbolo, de un solo sitio. */
function simbolo() {
  return MONEDA.simbolo;
}

/**
 * Cómo se pinta un plan SIN precio confirmado.
 *
 * ── POR QUÉ HACE FALTA ESTA FUNCIÓN ──
 *
 * Porque los tres planes de Shopcito (`content/shopcito.js`) no
 * tienen cifra todavía, y hay tres formas de jugar eso y solo una
 * es honesta:
 *
 *   · `precio: 0`   → "desde $0". Publica que el bot es gratis.
 *                     Peor: un cliente que se baja al bar y se
 *                     encuentra con la cifra real se lleva la
 *                     impresión de que le mentimos, y con
 *                     razón.
 *   · ocultar el    → la portada muestra tres tarjetas sin lo
 *     precio            único que el visitante fue a mirar. La
 *                     línea vacía es el hueco más visible de la
 *                     pantalla.
 *   · "A consultar" → dice la verdad y cumple la misma función
 *                     comercial: el CTA está al lado, a un clic.
 *
 * ── POR QUÉ NO BASTA CON PONERLO EN EL DATO ──
 *
 * Porque "A consultar" es una decisión de PANTALLA, no del
 * contenido: el mismo plan, en la portada, es un titular, y en
 * el panel de cobros es una fila con el número al lado. Si el
 * texto viviera en el dato, habría que cambiarlo en tres sitios
 * el día que haya cifra — que es exactamente el problema que
 * este archivo de precios existe para no tener.
 *
 * Con `precio === null` se decide en un solo sitio, y cuando la
 * cifra llegue esta función empieza a devolver el importe y las
 * vistas no se enteran.
 *
 * @param {{precio: number|null, periodo?: string}} plan
 * @returns {string}
 */
function precioDePlan(plan) {
  if (!plan) return "";
  if (plan.precio === null || plan.precio === undefined) {
    return plan.sinPrecio || "A consultar";
  }
  const base = importe(plan.precio) + " " + MONEDA.simbolo;
  return plan.periodo ? base + " / " + plan.periodo : base;
}

/**
 * El precio de un plan ya pintado, para los textos de `faq.js` y
 * `posts.js`.
 *
 * Se pasa el plan entero y no el número porque el texto que lo
 * rodea cambia: "desde 890 €", "entre 890 € y 5.000 €" y "89 €/mes"
 * son tres frases con formatos distintos. Lo que NO cambia es de
 * dónde sale el número, y eso es lo que importa.
 *
 * @param {{precio:number, periodo?:string}} plan
 * @returns {string}
 */
function precioDe(plan) {
  const base = importe(plan.precio) + " " + MONEDA.simbolo;
  return plan.periodo ? base + "/" + plan.periodo : base;
}

/** Busca un plan por id. Devuelve null si no existe. */
function plan(id) {
  return [...PROYECTOS, ...MANTENIMIENTO].find((p) => p.id === id) || null;
}

module.exports = {
  MONEDA,
  PROYECTOS,
  MANTENIMIENTO,
  BANDAS_PRESUPUESTO,
  importe,
  simbolo,
  precioDe,
  precioDePlan,
  plan,
};