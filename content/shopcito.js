/* =========================================================
   Shopcito — Contenido de la portada
   ------------------------------------------------------------
   Los textos de la home de Shopcito viven aquí, y no en
   `views/index.ejs`, por la misma razón que el resto del
   contenido editorial: para cambiar una frase no hay que
   tocar una vista.

   ── POR QUÉ UN ARCHIVO NUEVO Y NO REESCRIBIR `precios.js` ──

   Porque los datos que se anuncian en la portada SON los
   planes que se contratan todos los meses, y eso no es lo
   mismo que lo que había antes:

     · `precios.js` → PROYECTOS (webs a medida, pago único,
       "desde 890 €") y MANTENIMIENTO (pago mensual).
     · este archivo  → los tres planes de Shopcito, que
       son mensuales y SIN precio publicado.

   Son dos comercializaciones distintas sobre la misma web
   durante el cambio de marca, y meter una dentro de la otra
   obliga a modelar un plan recurrente como si fuera un
   proyecto.

   ⚠️  HAY PRECIOS PENDIENTES
   ----------------------------
   Los tres planes salen "A consultar" porque no hay cifra
   confirmada. No es un adorno: si se cuela un número aquí,
   aparece en la home, en /precios y en el panel de cobros
   diciendo tres cosas distintas. `precio: null` es lo que
   hace que la vista pinte "A consultar" en vez de un 0.
   Cuando haya cifra, se pone `precio` y `periodo` en el
   plan y no hay que tocar ninguna vista.

   ── LOS DOMINIOS ──

   El texto habla de "shopcito.com.ar", pero `lib/site.js`
   sigue con los dominios viejos a propósito: los registros
   DNS todavía no existen y ponerlos antes de crearlos
   rompe los canonical y el og:url de toda la web. El
   cambio de dominio va con el cambio en Cloudflare, en un
   paso aparte. Ver COOLIFY.md.
   ========================================================= */

/* ─────────────────────────────────────────────────────────
   HERO
   ───────────────────────────────────────────────────────── */
const HERO = {
  etiqueta: "El copiloto digital para tu comercio",

  /* Se parte en líneas porque el título se arma con un
     degradado en una sola de ellas, y romperlo con un salto
     manual cambia dónde cae el degradado. */
  titulo: ["El copiloto digital", "para tu comercio", "o emprendimiento"],

  /* La palabra que lleva el degradado. Va separada del resto
     del título porque el efecto se aplica a UNA frase: si se
     aplicara al titular entero, el degradado lo recorre de
     punta a punta y deja de destacar nada. */
  destacado: "comercio",

  subtitulo:
    "Automatizá tus respuestas de WhatsApp, agendá turnos y vendé desde tu propio mini shop. " +
    "Todo conectado en un solo lugar.",

  cta: {
    texto: "Probar gratis por 14 días",
    href: "/cuenta/crear",
  },

  /* Lo que va debajo del botón. Sin precio y sin tarjeta: es
     lo único que se puede prometer hasta que haya una cifra
     y un cobro de verdad montados. */
  ctaNota: "Sin tarjeta. Sin instalación. Lo probás y, si no te sirve, no pasa nada.",

  /* Las tres promesas de cabecera. `texto` y `detalle` van
     separados porque el detalle es la línea chica de abajo:
     unirlos en un string obligaba a repetir el "sin
     comisiones" tres veces y a que las tres frases pesaran
     distinto. */
  promesa: [
    {
      icono: "reloj",
      texto: "Contesta solo, de noche y fines de semana",
      detalle: "Tu bot atiende mientras vos atendés otra cosa",
    },
    {
      icono: "turno",
      texto: "Turnos y ventas, no post-its en la heladera",
      detalle: "Te llega al celular y listo",
    },
    {
      icono: "sincomision",
      texto: "Sin comisiones por venta",
      detalle: "Ni de Mercado Pago ni de nadie",
    },
  ],
};

/* ─────────────────────────────────────────────────────────
   PROBLEMA Y SOLUCIÓN
   ─────────────────────────────────────────────────────────
   Van juntos y en dos columnas a propósito: separadas en dos
   secciones, el problema queda lejos de la solución y la
   página se lee como dos textos sin relación. Juntos, el ojo
   pasa de "esto te pasa" a "esto es lo que hay". */
const PROBLEMA = {
  etiqueta: "El problema de hoy",

  titulo: "Perdés clientes por no responder a tiempo",

  texto:
    "Te mareás anotando turnos en cuadernos o perdiéndote en los chats, y mandar fotos sueltas " +
    "por WhatsApp es un desorden. Cuando alguien escribe fuera de horario, no le contesta nadie " +
    "y para cuando lo ves ya se fue a otro lado.",

  /* Los tres síntomas, no una descripción general. Cada uno
     dice algo que el comerciante reconoce en su propio día. */
  puntos: [
    {
      icono: "perdida",
      titulo: "Consultas que quedan sin respuesta",
      texto: "Escriben a las diez de la noche y al otro día ya compraron en otro lado.",
    },
    {
      icono: "cuaderno",
      titulo: "Turnos anotados en un cuaderno",
      texto: "Alguien llega, nadie lo tiene anotado, y se pierden la venta y la buena impresión.",
    },
    {
      icono: "fotos",
      titulo: "Fotos sueltas por WhatsApp",
      texto: "El precio vive en un chat de hace cuatro meses. Nadie lo encuentra.",
    },
  ],
};

const SOLUCION = {
  etiqueta: "La solución",
  titulo: "Tu bot atiende, vos vendés",

  texto:
    "Tu bot atiende las 24 horas con fotos y precios actualizados. El cliente elige en tu mini " +
    "shop o agenda su turno solo, y a vos te llega la venta organizada al celular.",

  /* Los tres módulos del producto, en el orden en que los
     entiende un comercio: primero le contestan, después
     elige, y al final se lleva la plata.

     Ese orden es también el de los planes: el Inicial es el
     paso 01, el Comercio agrega el 02, y el Full el 03. Por
     eso los tres bloques y las tres tarjetas dicen lo mismo
     con otras palabras, y no es casualidad. */
  pasos: [
    {
      numero: "01",
      titulo: "Responde por WhatsApp, siempre",
      texto:
        "Precio, horarios y disponibilidad contestados al instante, aunque el local esté " +
        "cerrado. Le habla con el tono de tu negocio, no con el de un robot de call center.",
    },
    {
      numero: "02",
      titulo: "Tu mini shop, dentro de WhatsApp",
      texto:
        "El cliente ve tus productos con fotos reales y paga sin salir del chat. Sin app que " +
        "bajar y sin cambiar la forma de comprar de siempre.",
    },
    {
      numero: "03",
      titulo: "A vos te llega todo al celular",
      texto:
        "Cada venta y cada turno reservado te aparece ordenado, con el contacto y el detalle. " +
        "No más perderse entre capturas de pantalla.",
    },
  ],
};

/* ─────────────────────────────────────────────────────────
   LOS TRES PLANES
   ─────────────────────────────────────────────────────────
   El mismo objeto que usarán la portada y /precios.
   `precio: null` es lo que hace que salga "A consultar". */
const PLANES = [
  {
    id: "inicial",
    nombre: "Inicial",
    destacado: false,
    precio: null,
    periodo: "mes",
    descripcion: "Para el que recién arranca y quiere dejar de responder a mano.",
    incluye: [
      "Bot de WhatsApp en tu número",
      "Respuestas automáticas 24/7",
      "Listado de preguntas frecuentes",
    ],
    nota: "Para empezar a dejar de perder consultas.",
    cta: { texto: "Empezar gratis", href: "/cuenta/crear", clase: "btn btn-ghost" },
  },
  {
    id: "comercio",
    nombre: "Comercio",
    destacado: true,
    precio: null,
    periodo: "mes",
    descripcion: "El plan que usa la mayoría: el bot, y además vender o agendar.",
    incluye: [
      "Todo lo del plan Inicial",
      "Mini shop / catálogo web con fotos y precios",
      "O Agenda de Turnos, si lo que necesitás es reservar",
    ],
    nota: "Elegís una de las dos: vendés productos o agendás horarios.",
    cta: { texto: "Probar 14 días", href: "/cuenta/crear", clase: "btn btn-primary" },
  },
  {
    id: "full",
    nombre: "Full / Pro",
    destacado: false,
    precio: null,
    periodo: "mes",
    descripcion: "Para el que quiere las dos cosas y cobrar por los dos lados.",
    incluye: [
      "Todo lo del plan Comercio",
      "Mini shop y Agenda de Turnos juntos",
      "Links de pago de Mercado Pago",
      "Módulos ilimitados",
    ],
    nota: "Sin comisiones por venta, ni de Mercado Pago ni de Shopcito.",
    cta: { texto: "Hablar con nosotros", href: "/contacto", clase: "btn btn-ghost" },
  },
];

/* ─────────────────────────────────────────────────────────
   CIERRE
   ───────────────────────────────────────────────────────── */
const CIERRE = {
  titulo: "Que tu negocio conteste solo mientras vos estás atendiendo",
  texto:
    "Lo conectás una vez y después es tu bot laburando. Probalo 14 días sin compromiso y, si " +
    "no te sirve, lo das de baja y no pasa nada.",
  cta: { texto: "Probar gratis por 14 días", href: "/cuenta/crear" },
  garantias: [
    "Sin tarjeta de crédito",
    "Sin instalación",
    "Sin permanencia",
    "Sin comisiones por venta",
  ],
};

module.exports = {
  HERO,
  PROBLEMA,
  SOLUCION,
  PLANES,
  CIERRE,
};