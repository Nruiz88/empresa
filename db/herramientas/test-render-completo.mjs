/* Que los dos caminos de render de una pantalla lleven lo mismo.
 *
 * node db/test-render-completo.mjs
 *
 * ── POR QUÉ ESTE ──
 *
 * Una pantalla que se renderiza en dos sitios, con dos juegos de
 * variables distintos, se rompe en cuanto una de las dos listas se
 * queda corta. Y EJS no avisa: si una variable no existe, la
 * plantilla revienta con un 500 y un nombre de variable en el cuerpo.
 *
 * Pasó con mis-servicios:
 *
 *   esStaff is not defined       (línea 179)
 *   nombreCliente is not defined  (línea 40)
 *
 * Las dos estaban solo en el camino "tengo token". El otro camino
 * —el de "no tengo token", que sale cuando caduca el access_token—
 * no las llevaba.
 *
 * Y ese camino no lo prueba nadie, porque para probarlo hay que
 * tener una sesión SIN token, que es justo lo que no pasa en el uso
 * normal. El error sale a los clientes, una vez cada hora.
 *
 * ── QUÉ COMPRUEBA ──
 *
 * Que los dos render de `mis-servicios` pasen el MISMO conjunto de
 * variables. Se lee el código, se saca la lista de cada uno, y se
 * comparan. Si mañana alguien añade una variable a la plantilla y
 * se olvida del render de error, esto falla.
 */
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");
const NL = String.fromCharCode(10);

const RUTA = path.join(RAIZ, "routes", "panel-portal.js");
const PLANTILLA = path.join(RAIZ, "views", "panel", "mis-servicios.ejs");

let ok = 0;
let fallos = 0;

const comprobar = (txt, cond, extra) => {
  console.log("  " + (cond ? "OK  " : "FALLA") + "  " + txt + (extra ? "  " + extra : ""));
  if (cond) ok++;
  else fallos++;
};

console.log("");
console.log("=== Los dos renders de una pantalla, con las mismas variables ===");
console.log("");

const ruta = fs.readFileSync(RUTA, "utf8");
const plantilla = fs.readFileSync(PLANTILLA, "utf8");

/* ── 1. Qué variables usa la plantilla ──
 * Se buscan las que aparecen en `<%=` o `<%-` sin haber sido
 * definidas en el propio fichero. El comentario de cabecera de la
 * plantilla los declara todos; esa lista es la referencia. */
const cabecera = plantilla.slice(0, plantilla.indexOf("*/"));

/* Las que la plantilla usa de verdad: los identificadores que salen
 * en las expresiones, menos los que son funciones de EJS. */
const ENTRADA = /<%[-=]?\s*([A-Za-z_$][\w$]*)/g;
const usadas = new Set();
let m;
while ((m = ENTRADA.exec(plantilla)) !== null) {
  const id = m[1];
  /* No son variables de la vista. */
  if (["if", "forEach", "for", "else", "each", "true", "false", "null", "undefined"].includes(id)) continue;
  usadas.add(id);
}

/* ── 2. Los dos renders ──
 * Se saca el objeto literal que se le pasa a cada res.render de
 * esta plantilla, y de dentro, las claves de primer nivel. */
function clavesDelRender(fuente, numero) {
  /* El camino de error escribe `return res.status(503).render(...)`,
   * y el normal `res.render(...)`. Se buscan los dos, asi que el
   * ancla es solo `.render("panel/mis-servicios", {`. */
  const ancla = '.render("panel/mis-servicios", {';
  let desde = 0;
  for (let i = 0; i < numero; i++) {
    desde = fuente.indexOf(ancla, desde);
    if (desde === -1) return null;
    desde += ancla.length;
  }

  /* Contar llaves hasta cerrar el objeto, teniendo en cuenta que
   * dentro hay comentarios y strings. Un conteo simple se equivoca
   * con cualquier llave dentro de un texto. */
  let nivel = 1;
  let i = desde;
  while (i < fuente.length && nivel > 0) {
    const c = fuente[i];
    const siguiente = fuente.slice(i, i + 2);

    if (siguiente === "//") {
      i = fuente.indexOf(NL, i);
      if (i === -1) break;
      continue;
    }
    if (siguiente === "/*") {
      i = fuente.indexOf("*/", i) + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const comilla = c;
      i++;
      while (i < fuente.length && fuente[i] !== comilla) {
        if (fuente[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    if (c === "{") nivel++;
    if (c === "}") nivel--;
    i++;
  }

  const cuerpo = fuente.slice(desde, i);

  /* Las claves de primer nivel: lo que está a dos espacios o a
   * cuatro dentro de un comentario, seguido de dos puntos. */
  const claves = new Set();
  for (const linea of cuerpo.split(NL)) {
    const t = linea.trim();
    const coincide = t.match(/^([A-Za-z_$][\w$]*)\s*:/);
    if (coincide) claves.add(coincide[1]);
  }
  /* El `...datos` se propaga entero, así que cuenta como todo. */
  const incluyeDatos = /\.\.\.datos/.test(cuerpo);
  return { claves, incluyeDatos, cuerpo };
}

/* ¿Esta clave viene en el objeto `datos`, que se reparte con ...datos? */
function enDatos(clave, fuente) {
  const i = fuente.indexOf("const datos = {");
  if (i === -1) return false;
  const cuerpo = fuente.slice(i, fuente.indexOf(NL + "    };", i));
  return new RegExp("(^|" + NL + ")\\s*" + clave + "\\s*:").test(cuerpo);
}

const primero = clavesDelRender(ruta, 1); /* el que tiene return, el 503 */
const segundo = clavesDelRender(ruta, 2); /* el normal */

comprobar("se encontraron los dos render de mis-servicios", !!primero && !!segundo);

if (primero && segundo) {
  /* El primero se lleva `...datos`, el segundo tambien. Las claves
   * que se pasan a mano son las que se pueden olvidar. */
  const propiasPrimero = new Set([...primero.claves].filter((k) => k !== "error"));
  const propiasSegundo = new Set([...segundo.claves].filter((k) => k !== "error"));

  console.log("");
  console.log("  el camino de error pasa a mano: " + [...propiasPrimero].sort().join(", "));
  console.log("  el camino normal pasa a mano:  " + [...propiasSegundo].sort().join(", "));
  console.log("");

  /* Lo que el primero NO lleva y el segundo si.
   *
   * Se descuenta `...datos`: lo que va en el spread llega a los dos
   * caminos, y el test tiene que saberlo o falla siempre. Antes de
   * tener en cuenta el spread comparaba claves a pelo y daba por
   * hecho que faltaban tres, siendo que ninguna faltaba. */
  const faltan = [...propiasSegundo].filter(
    (k) => !propiasPrimero.has(k) && !(segundo.incluyeDatos && primero.incluyeDatos && enDatos(k, ruta))
  );

  comprobar(
    "el camino de error lleva lo mismo que el normal",
    faltan.length === 0,
    faltan.length ? "le faltan: " + faltan.join(", ") : ""
  );

  /* Y lo que la plantilla usa, para tener una segunda opinion. */
  const conocidas = new Set([...propiasPrimero, ...propiasSegundo, ...usadas]);
  const sospechosas = [...usadas].filter(
    (v) => !conocidas.has(v) && !["base", "res", "helper", "icono"].includes(v)
  );

  comprobar(
    "la plantilla no usa variables que nadie pasa",
    sospechosas.length === 0,
    sospechosas.length ? sospechosas.slice(0, 5).join(", ") : ""
  );
}

console.log("");
console.log("=".repeat(54));
if (fallos) {
  console.log("FALLAN " + fallos + " de " + (ok + fallos));
  console.log("");
  process.exit(1);
}
console.log("Los " + ok + " caminos de render llevan lo mismo.");
console.log("");
process.exit(0);