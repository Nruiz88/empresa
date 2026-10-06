/* =========================================================
   Nexo Studio — Monedas
   ------------------------------------------------------------
   La lista de monedas que se pueden poner a un precio.

   ── POR QUÉ ESTE ARCHIVO Y NO LA LISTA DENTRO DE UNA RUTA ──

   Estaba definida dentro de `routes/panel-catalogo.js`, porque el
   catálogo fue lo primero que tuvo un selector de moneda. Al
   meterle moneda al servicio, si se copiaba la lista, habría dos
   copias.

   Dos copias se desincronizan: alguien añade el peso chileno a una y
   se olvida de la otra, y el formulario de catálogo ofrece una
   moneda que el de servicio no acepta. Falla una vez cada muchas,
   que es la peor forma de fallar.

   Es el mismo motivo por el que `lib/client-id.js` salio de
   `panel-portal.js`: una lista de valores tiene que vivir en un
   sitio, o la primera copia que se quede vieja es la que rompe.

   ── POR QUÉ SOLO TRES ──

   El negocio cobra en pesos. Se ofrecen euros porque quedan
   clientes de antes que facturaban en esa moneda, y dólares porque
   un cliente los pidió.

   No es pereza: se ofrece lo que hace falta. No se añade una moneda
   `modules.moneda` admita cualquier código de tres letras. Añadir
   una moneda es añadir una línea aquí.
   ========================================================= */

/**
 * Monedas que se pueden poner a un precio.
 *
 * `valor` es lo que va al campo `moneda` de la base. `label` es lo
 * corto, para el desplegable. `largo` y `titulo` son para las
 * etiquetas donde el código solo no se entiende.
 *
 * @type {{valor: string, label: string, largo: string, titulo: string}[]}
 */
const MONEDAS = [
  { valor: "ARS", label: "ARS", largo: "Pesos argentinos", titulo: "ARS — pesos argentinos" },
  { valor: "EUR", label: "EUR", largo: "Euros", titulo: "EUR — euros" },
  { valor: "USD", label: "USD", largo: "Dólares", titulo: "USD — dólares" },
];

/** La moneda por defecto del negocio. */
const MONEDA_POR_DEFECTO = "ARS";

/**
 * ¿Es una moneda que este panel sabe ofrecer?
 *
 * `modules.moneda` tiene un CHECK que admite cualquier ISO de tres
 * letras, así que la base puede tener algo que esta lista no
 * conoce —un peso chileno, puesto a mano por consola—. Este helper
 * no lo declara inválido: solo dice si hay una etiqueta para él.
 *
 * @param {string} valor
 * @returns {boolean}
 */
function esMonedaConocida(valor) {
  return MONEDAS.some((m) => m.valor === valor);
}

/**
 * La etiqueta de una moneda, o el propio código si no la conocemos.
 *
 * Que caiga al código en vez de a "—" es a propósito: si aparece una
 * moneda que no está en la lista, el usuario tiene que ver ALGO
 * legible. Un guion le haría pensar que el precio no tiene moneda.
 *
 * @param {string} valor
 * @returns {string}
 */
function etiquetaMoneda(valor) {
  const m = MONEDAS.find((x) => x.valor === valor);
  return m ? m.largo : String(valor || "");
}

module.exports = { MONEDAS, MONEDA_POR_DEFECTO, esMonedaConocida, etiquetaMoneda };