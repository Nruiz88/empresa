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

   ── POR QUÉ SOLO UNA ──

   El negocio cobra en pesos. Se.Messages ofrece dólares porque un
   cliente lo pidió; el euro se retiró porque ya no queda ninguno
   cuando un cliente paga.

   No es pereza: se ofrece lo que hace falta, ni uno más ni uno menos.
   Una moneda que queda en la lista porque "por si acaso" es una
   moneda que alguien va a elegir sin querer, y entonces aparece un
   precio que el negocio no maneja.

   ── Y POR QUÉ NO SE BORRA `modules.moneda` ──

   `modules.moneda` sigue admitiendo `EUR` y `USD`. El catálogo guarda
   precios históricos, y un código que no está en esta lista no es un
   dato inválido: es un precio viejo que hay que poder mostrar tal
   como se emitió.

   Borrar el código de la tabla sería una pérdida de información; sacarlo
   del selector solo deja de ofrecerse. Son cosas distintas.
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
  /* El euro se retiró de la lista. La columna `moneda` de las tablas sigue
   admitiendo `EUR` porque hay precios históricos que se emitieron en esa
   moneda, y un código que no aparece en esta lista no es un dato
   inválido: es un precio viejo que hay que poder mostrar tal cual. Sacarlo
   del selector solo deja de ofrecerse para lo nuevo. */
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