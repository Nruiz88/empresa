/* =========================================================
   Shopcito — Los planes, y de dónde salen
   ------------------------------------------------------------
   La web pública NO pinta los planes de un fichero: los lee de la
   tabla `plans`, que edita el panel.

   ── POR QUÉ ──

   Porque un precio escrito en el código es un precio que no se puede
   cambiar sin editar un fichero y desplegar. Y eso, en la práctica,
   significa que no se cambia nunca.

   ── POR QUÉ HAY UNA COPIA EN `content/shopcito.js` ──

   Porque esta función necesita poder devolver algo aunque la base no
   responda. Un fichero de contenido no se cae nunca; una tabla, sí.

   Y el respaldo NO lleva precios: los tres planes de respaldo salen sin
   cifra, que es exactamente como están hoy. Así que si la base falla,
   la portada sigue en pie y sin inventar un número.

   Esa es la diferencia entre un respaldo y una segunda fuente de
   verdad: el respaldo no puede contradecir a la principal. Si el
   respaldo tuviera precios, un fallo de la base mostraría cifras
   viejas sin que nadie lo notara, que es la forma más difícil de
   detectar de tener dos fuentes.

   ── POR QUÉ NO SE LEE EN CADA Petición ──

   Porque la portada y /precios piden los mismos datos y eso son dos
   idas a la base por visita. Se cachean unos segundos.

   El caché NO es un lujo: si la base está lenta, la web pública se
   arrastra. Y un plan que se ve con treinta segundos de retraso no es
   un fallo raro, es un fallo constante.
   ========================================================= */

const supabase = require("./supabase");

/* Los tres planes tal como están en el código, sin precio.
   NO son la fuente de verdad: son lo que se ve si la base no
   responde. Ver la nota de arriba. */
const RESPALDO = [
  {
    id: "inicial",
    nombre: "Inicial",
    descripcion: "Para el que recién arranca y quiere dejar de responder a mano.",
    precio: null,
    moneda: "ARS",
    periodo: "mes",
    incluye: [
      "Bot de WhatsApp en tu número",
      "Respuestas automáticas 24/7",
      "Listado de preguntas frecuentes",
    ],
    nota: "Para empezar a dejar de perder consultas.",
    destacado: false,
  },
  {
    id: "comercio",
    nombre: "Comercio",
    descripcion: "El plan que usa la mayoría: el bot, y además vender o agendar.",
    precio: null,
    moneda: "ARS",
    periodo: "mes",
    incluye: [
      "Todo lo del plan Inicial",
      "Mini shop / catálogo web con fotos y precios",
      "O Agenda de Turnos, si lo que necesitás es reservar",
    ],
    nota: "Elegís una de las dos: vendés productos o agendás horarios.",
    destacado: true,
  },
  {
    id: "full",
    nombre: "Full / Pro",
    descripcion: "Para el que quiere las dos cosas y cobrar por los dos lados.",
    precio: null,
    moneda: "ARS",
    periodo: "mes",
    incluye: [
      "Todo lo del plan Comercio",
      "Mini shop y Agenda de Turnos juntos",
      "Links de pago de Mercado Pago",
      "Módulos ilimitados",
    ],
    nota: "Sin comisiones por venta, ni de Mercado Pago ni de Shopcito.",
    destacado: false,
  },
];

/* Cuánto se aguanta la respuesta de la base. Diez segundos es mucho
   para una consulta de tres filas, y si tarda más es que algo va mal: es
   preferible enséar el respaldo antes que dejar la portada esperando. */
const TIMEOUT_MS = 10000;

/* ─────────────────────────────────────────────────────────────
   EL BOTÓN DE CADA PLAN

   La tabla guarda el texto del botón y a dónde lleva en dos columnas
   (`cta_texto`, `cta_href`). Las vistas piden un objeto `p.cta` con
   tres cosas: texto, href y clase.

   Antes de la migración 024 la base no traía ninguna de las dos, y las
   vistas seguían leyendo `p.cta.href` de un objeto que ya no existía:
   un 500 en toda la web pública, no en una tarjeta.

   ── POR QUÉ SE NORMALIZA AQUÍ Y NO EN LAS VISTAS ──

   Porque son dos vistas (portada y /precios) más el respaldo en código,
   y si el arreglo va en cada una hay que acordarse de las tres.

   ── POR QUÉ LA CLASE NO SE GUARDA ──

   Sale de `destacado`, que es lo que además resalta la tarjeta. Si el
   botón fuera de otro color que la tarjeta, el visitante vería dos
   cosas distintas donde hay una sola decisión. Y guardar la clase
   abriría la puerta a que alguien ponga una clase arbitraria desde el
   panel y rompa el estilo de la página.
   ───────────────────────────────────────────────────────────── */
function conCta(p) {
  const destacado = p.destacado === true || p.destacado === "1";

  return Object.assign({}, p, {
    cta: {
      texto: p.cta_texto || "Quiero este plan",
      href: p.cta_href || "/contacto",
      clase: destacado ? "btn btn-primary" : "btn btn-ghost",
    },
  });
}

/**
 * Normaliza una lista entera de planes.
 *
 * Existe para no repetir el `.map(conCta)` en tres sitios, que es donde
 * un día se olvidaría uno y volvería el 500 solo en la ruta del error.
 *
 * @param {object[]} lista
 * @returns {object[]}
 */
function conCtaTodos(lista) {
  return (lista || []).map(conCta);
}

/* El caché, y cuándo caduca. */
let cache = null;
let cacheHasta = 0;
const TTL_MS = 20 * 1000;

/**
 * Los planes para pintar, en orden.
 *
 * Nunca lanza: si la base falla, devuelve el respaldo y avisa por
 * consola. La web pública no puede caerse porque un precio no se haya
 * podido leer.
 *
 * @returns {Promise<{planes: object[], deRespaldo: boolean}>}
 */
async function planes() {
  const ahora = Date.now();

  if (cache && ahora < cacheHasta) {
    return { planes: cache, deRespaldo: false };
  }

  if (!supabase.disponible()) {
    // Sin credenciales no es un fallo: es desarrollo. No se avisa, o el
    // servidor local llenaría el log de una línea por visita.
    return { planes: conCtaTodos(RESPALDO), deRespaldo: true };
  }

  try {
    const { data, error } = await Promise.race([
      supabase.getPublico().from("plans").select("*").eq("activo", true).order("orden"),
      new Promise((_, rechazar) =>
        setTimeout(() => rechazar(new Error("la consulta tardó más de " + TIMEOUT_MS + " ms")), TIMEOUT_MS)
      ),
    ]);

    if (error) throw error;
    if (!data || !data.length) throw new Error("la tabla está vacía");

    cache = conCtaTodos(data);
    cacheHasta = ahora + TTL_MS;

    return { planes: cache, deRespaldo: false };
  } catch (e) {
    console.warn("[planes] se usa el respaldo: " + e.message);

    // El respaldo se cachea un momento, para no castigar la base con una
    // consulta por visita mientras está caída. Poco tiempo: en cuanto se
    // recupere, el precio real tiene que volver deprisa.
    cache = conCtaTodos(RESPALDO);
    cacheHasta = ahora + 5000;

    return { planes: cache, deRespaldo: true };
  }
}

/**
 * Un plan por su id, o null.
 *
 * @param {string} id
 * @returns {Promise<object|null>}
 */
async function plan(id) {
  const { planes: lista } = await planes();
  return lista.find((p) => p.id === id) || null;
}

/**
 * Cómo se pinta un plan en la tarjeta.
 *
 * `precio: null` es "A consultar" y NO es un cero. Un cero aquí
 * publicaría que el producto es gratis, que es peor que no publicar
 * nada: quien lo ve se lleva la impresión de que le mentimos.
 *
 * El separador de millares y el símbolo salen del propio plan, no de un
 * sitio global: cada fila lleva su moneda, que es lo que permite tener
 * un plan en pesos y otro en dólares sin tocar código.
 *
 * @param {object} plan
 * @returns {string}
 */
function precioDe(plan) {
  if (!plan) return "";

  if (plan.precio === null || plan.precio === undefined) {
    return "A consultar";
  }

  const numero = Number(plan.precio);
  if (!isFinite(numero)) return "A consultar";

  const miles = String(Math.trunc(numero)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  return plan.periodo ? miles + " " + plan.moneda + " / " + plan.periodo : miles + " " + plan.moneda;
}

/** Vacía el caché. Lo usa la pantalla del panel al guardar. */
function olvidar() {
  cache = null;
  cacheHasta = 0;
}

module.exports = {
  planes,
  plan,
  precioDe,
  olvidar,
  conCta,
  conCtaTodos,
  RESPALDO,
  /* Se exporta para probar, no para usar desde las vistas. Que una vista
     pueda leer la copia de respaldo es justo lo que este módulo
     pretende evitar. */
  _respaldo: RESPALDO,
};