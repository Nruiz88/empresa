const fs = require("fs");
const path = require("path");

const CSS = path.join("D:/webs/empresa", "public", "css");
const ORIGEN = path.join(CSS, "panel.css");

/* ═══════════════════════════════════════════════════════════════
   DIVIDIR `panel.css` EN MÓDULOS

   ── EL ORDEN ES LO ÚNICO IMPORTANTE ──

   En CSS el que gana es el último. Hay 28 selectores declarados más
   de una vez, y algunos hasta tres, así que si un módulo cambia de
   sitio, esos 28 cambian de valor sin dar ningún error.

   Por eso el manifiesto declara el orden de forma explícita, y
   `ver-modulos-css.js` comprueba que la concatenación da el mismo
   texto que el archivo de hoy. Si da el mismo, el aspecto es el
   mismo por definición, y no hay forma de que esto rompa nada.

   ── CÓMO SE CORTA ──

   Por los encabezados de sección que ya tiene el archivo, no por
   un número de línea fijo. Un número fijo se queda viejo en cuanto
   se edita algo, y un día corta por la mitad de una regla.

   Cada módulo se lleva los bloques que le tocan, en el orden en que
   estaban, y un encabezado al principio que dice qué lleva y por
   qué está separado.
   ═══════════════════════════════════════════════════════════════ */

/* Los módulos, en el orden en que se cargan.

   El orden NO es el del índice de aquí abajo: es el del archivo.
   Este listado dice a qué módulo va cada bloque, y los que se
   repiten caen en el que se indica. */
/* ── EL NÚMERO DEL MÓDULO ES SU POSICIÓN DE CARGA ──

   El prefijo no es decorativo: es el orden. `00` se carga primero y
   `12` el último, y como en CSS gana el último, ese número decide
   qué regla manda cuando dos compiten.

   Por eso el manifiesto sale en el ORDEN DEL ARCHIVO, no en el
   orden en que se escriben los módulos. La primera versión los
   escribía en el orden que aparecían en `A_DONDE`, y salía
   `09-comandos` antes que `08-movimiento`: el manifiesto decía una
   cosa y los archivos otra.

   Aquí se ordenan por el número, que es el que manda. */
const A_DONDE = [
  { hasta: "1. BASE Y MEDIDAS", modulo: "00-base" },
  { hasta: "2. ESTRUCTURA", modulo: "01-estructura" },
  { hasta: "4. BOTONES", modulo: "02-controles" },
  { hasta: "5. MÉTRICAS Y AVISOS", modulo: "03-datos" },
  { hasta: "7. ETIQUETAS DE ESTADO", modulo: "03-datos" },
  { hasta: "9. FORMULARIOS", modulo: "04-formularios" },
  { hasta: "11. ESTADOS VACÍOS, ALERTAS Y LOGIN", modulo: "04-formularios" },
  { hasta: "12. PORTAL DEL CLIENTE", modulo: "05-portal" },
  { hasta: "14. ACCESIBILIDAD", modulo: "06-responsive" },

  /* ── LOS BLOQUES GRANDES VAN SUELTOS ──

     Con los cortes por número de sección, todo lo que hay después
     del punto 14 —catálogo, comandos, tickets, movimiento,
     elevación, bots, planes— caía en un solo módulo de 3.400
     líneas.

     Un archivo de 3.400 líneas no se abre. Es el mismo problema que
     tenía el archivo único, pero en un sitio donde además hay que
     buscar entre módulos.

     Se cortan por su encabezado, que es lo que da nombre a cada
     bloque. */
  { hasta: "CATÁLOGO: editar productos y precios", modulo: "07-catalogo" },
  { hasta: "PALETA DE COMANDOS (Ctrl+K)", modulo: "08-comandos" },

  /* ── LOS TRES ÚLTIMOS ──

     `09-argon` es el vocabulario viejo de componentes, que convive
     con el sistema nuevo. `10-bots` y `11-planes` son las pantallas
     que se rediseñaron al final, y van cada una en su archivo
     porque son las dos que más han cambiado y las que más se van a
     tocar. */
  { hasta: "ARGON: EL VOCABULARIO DE COMPONENTES", modulo: "09-argon" },
  { hasta: "BOTS Y CAJAS DE EVOLUTION", modulo: "10-bots" },
  { hasta: "LOS PLANES, COMO TARJETAS", modulo: "11-planes" },
];

const t = fs.readFileSync(ORIGEN, "utf8");
const L = t.split("\n");

/* ── LOCALIZAR LOS CORTES ──

   Un corte es la línea del comentario `====` que precede a un
   encabezado. Se busca por el texto del encabezado, que es único,
   y no por su número. */
function lineaDelEncabezado(texto) {
  for (let i = 0; i < L.length; i++) {
    if (L[i + 1] && L[i + 1].trim() === texto) return i;
  }
  return -1;
}

const cortes = [];

for (const d of A_DONDE) {
  const i = lineaDelEncabezado(d.hasta);
  if (i < 0) {
    console.log("  ✗ no se encontró el encabezado: " + d.hasta);
    process.exit(1);
  }
  cortes.push({ linea: i, modulo: d.modulo, titulo: d.hasta });
}

cortes.sort((a, b) => a.linea - b.linea);
console.log("  límites encontrados: " + cortes.length);

/* ── REPARTIR ── */

const modulos = new Map();
for (const c of cortes) {
  if (!modulos.has(c.modulo)) modulos.set(c.modulo, { bloques: [], titulo: c.titulo });
}

for (let i = 0; i < cortes.length; i++) {
  const desde = cortes[i].linea;
  const hasta = i + 1 < cortes.length ? cortes[i + 1].linea : L.length;
  modulos.get(cortes[i].modulo).bloques.push(L.slice(desde, hasta).join("\n"));
}

/* ── LO QUE SE ESCRIBE ── */

/* El manifiesto se arma en el ORDEN DE CARGA, que es el número del
   nombre del módulo, y no el orden en que se han ido juntando los
   bloques. La primera versión los escribía en el orden de
   `A_DONDE` y salía `09-comandos` antes que `08-movimiento`: el
   manifiesto decía una cosa y los archivos otra. */
const ORDEN = [...modulos.keys()].sort();

ORDEN.forEach((nombre, i) => {
  const { bloques, titulo } = modulos.get(nombre);
  const archivo = nombre + ".css";

  const cabecera = [
    "/* =========================================================",
    "   " + nombre.toUpperCase().replace(/-/g, " "),
    "   =========================================================",
    "",
    "   Parte " + (i + 1) + " de " + ORDEN.length + " del CSS del panel.",
    "   Empieza en: " + titulo,
    "",
    "   ── EL ORDEN DE ESTAS HOJAS ES EL ORDEN DE CARGA ──",
    "",
    "   En CSS el que gana es el último, y en este panel hay",
    "   selectores declarados más de una vez. Mover una hoja de sitio",
    "   cambia el resultado sin dar ningún error.",
    "",
    "   El número del principio es su posición: 00 se carga",
    "   primero y el último, el último. El orden está en",
    "   panel.orden.json, que es lo que lee",
    "   views/partials/panel-head.ejs para armar los <link>.",
    "",
    "   Y db/ver-modulos-css.js comprueba que la concatenación da",
    "   el mismo texto que el archivo único de antes de la división.",
    "   Si eso dice que no, el aspecto va a cambiar.",
    "   ========================================================= */",
    "",
  ].join("\n");

  fs.writeFileSync(path.join(CSS, archivo), cabecera + bloques.join("\n"), "utf8");
  console.log("  " + archivo.padEnd(24) + bloques.join("\n").split("\n").length + " lineas");
});

fs.writeFileSync(
  path.join(CSS, "panel.orden.json"),
  JSON.stringify(ORDEN.map((n) => n + ".css"), null, 2) + "\n",
  "utf8"
);
console.log("\n  manifiesto: panel.orden.json");
console.log("  módulos:    " + ORDEN.length);

const total = ORDEN.reduce(
  (n, x) => n + fs.readFileSync(path.join(CSS, x), "utf8").split("\n").length,
  0
);
console.log("  total modular: " + total + " (el original tenía " + L.length + ")");
