/* =========================================================
   Shopcito — La moneda y el formateador de importes
   ------------------------------------------------------------
   Aquí queda lo que se usa: el símbolo y las tres funciones que
   ponen un número en pantalla.

   ── POR QUÉ ESTE ARCHIVO YA NO TIENE PLANES ──

   Tenía los tres planes de proyecto del estudio digital (con cifra
   en euros) y los tres de mantenimiento. Se retiraron con las páginas
   que los vendían, y con ellos desaparece el problema de la moneda:
   MONEDA estaba en EUR desde hacía años, y como la usaba el
   formateador, poner un precio a un plan de Shopcito imprimía euros.

   ── DÓNDE ESTÁN AHORA LOS PLANES ──

   Los de Shopcito, en `content/shopcito.js`, sin cifra todavía. Salen
   "A consultar" porque `precioDePlan()` devuelve ese texto cuando
   `precio` es null.

   ── POR QUÉ LA MONEDA ESTÁ EN UNA LÍNEA ──

   Es un cambio de negocio, no un detalle de formato: el mismo número
   con otro símbolo es otro precio, y hay que decidirlo una vez.
   ========================================================= */

   MONEDA = {
  codigo: "ARS",
  simbolo: "$",
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

module.exports = {
  MONEDA,

  BANDAS_PRESUPUESTO,
  importe,
  simbolo,
  precioDePlan,
};