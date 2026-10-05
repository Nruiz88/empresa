/* =========================================================
   Nexo Studio — Etiquetas y estados
   ------------------------------------------------------------
   Los mismos estados y tipos aparecen en el listado, en la ficha
   y en el portal del cliente. Si cada vista guardara su propia
   copia, en dos semanas una diría "En curso" y la otra "En
   progreso", y no sabrías cuál es la buena.

   Se comparan con los ENUM de la base de datos:
     service_kind    → TIPO
     service_status  → ESTADO
     lead_estado     → ESTADO_LEAD
     cobro_estado    → ESTADO_COBRO
   Si añades un valor en la base, añádelo también aquí.

   POR QUÉ ESTE ARCHIVO ES EL ÓNICO LUGAR
   ----------------------------------------
   Antes de esto, routes/panel-cobros.js y routes/panel-consultas.js
   tenían sus propios mapas ETIQUETA, y routes/panel-servicios.js
   usaba los de aquÍ. Tres nombres para la misma función. Salió bien
   por casualidad: logs/error.log tenía tres
   TypeError: etiqueta is not a function, uno por vista, todos por
   llamar a un helper que la ruta no había pasado.

   La regla: si un texto se muestra en más de una pantalla, vive
   aquí. Ni en la vista, ni en el router.
   ========================================================= */

const TIPO = {
  mantenimiento: "Mantenimiento",
  proyecto: "Proyecto",
  presupuesto: "Presupuesto",
};

const ESTADO = {
  pendiente: "Pendiente",
  activo: "Activo",
  en_curso: "En curso",
  pausado: "Pausado",
  finalizado: "Finalizado",
  cancelado: "Cancelado",
};

const ESTADO_LEAD = {
  nuevo: "Nueva",
  contactado: "Contactado",
  presupuestado: "Presupuestado",
  ganado: "Ganado",
  descartado: "Descartado",
};

/** Estado de un cobro. El ENUM cobro_estado (004_cobros.sql).
    Ojo: `pagado` e `impagado` describen dinero que YA se ha cobrado o
    que YA se ha pasado de fecha. Un cobro pendiente con fecha futura
    no es ninguno de los dos: sigue siendo `pendiente`. */
const ESTADO_COBRO = {
  pendiente: "Pendiente",
  pagado: "Pagado",
  impagado: "Impagado",
  anulado: "Anulado",
};

const PERIODICIDAD = {
  mensual: "Mensual",
  trimestral: "Trimestral",
  anual: "Anual",
  unica: "Pago único",
};

/** Etiqueta de tipo con reserva: si aparece algo nuevo, se ve la clave */
const etiquetaTipo = (k) => TIPO[k] || k || "—";
const etiquetaEstado = (e) => ESTADO[e] || e || "—";
const etiquetaLead = (e) => ESTADO_LEAD[e] || e || "—";
const etiquetaCobro = (e) => ESTADO_COBRO[e] || e || "—";

/** Los ENUM, para los <select> de los formularios */
const OPCIONES_TIPO = Object.entries(TIPO).map(([valor, label]) => ({ valor, label }));
const OPCIONES_ESTADO = Object.entries(ESTADO).map(([valor, label]) => ({ valor, label }));
const OPCIONES_LEAD = Object.entries(ESTADO_LEAD).map(([valor, label]) => ({ valor, label }));
const OPCIONES_COBRO = Object.entries(ESTADO_COBRO).map(([valor, label]) => ({ valor, label }));
const OPCIONES_PERIODICIDAD = [
  { valor: "", label: "— sin periodicidad —" },
  ...Object.entries(PERIODICIDAD).map(([valor, label]) => ({ valor, label })),
];

/**
 * Lo que se pasa a las vistas del panel.
 *
 * Se llama UNA vez en routes/panel.js y viaja en `comunes`, así que
 * todas las vistas lo tienen sin que cada ruta se acuerde. Antes cada
 * router pasaba sus helpers a mano y se olvidaba: de ahí los
 * `etiqueta is not a function` de logs/error.log.
 *
 * Las vistas lo usan con `typeof etiqueta !== "undefined" ? ... : ...`
 * por si acaso, pero eso es el red de seguridad, no la manera normal.
 */
const helpers = () => ({
  etiquetaTipo,
  etiquetaEstado,
  etiquetaLead,
  etiquetaCobro,
  OPCIONES_TIPO,
  OPCIONES_ESTADO,
  OPCIONES_LEAD,
  OPCIONES_COBRO,
  OPCIONES_PERIODICIDAD,
  PERIODICIDAD,
});

module.exports = {
  TIPO,
  ESTADO,
  ESTADO_LEAD,
  ESTADO_COBRO,
  PERIODICIDAD,
  etiquetaTipo,
  etiquetaEstado,
  etiquetaLead,
  etiquetaCobro,
  OPCIONES_TIPO,
  OPCIONES_ESTADO,
  OPCIONES_LEAD,
  OPCIONES_COBRO,
  OPCIONES_PERIODICIDAD,
  helpers,
};
