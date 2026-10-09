/* =========================================================
   Shopcito — Qué clases del CSS se usan de verdad
   ------------------------------------------------------------
   Una sola definición, usada por la auditoría y por el limpiador.

   ── POR QUÉ UN MÓDULO Y NO DOS COPIAS ──

   Porque fue justo lo que pasó. `db/auditar-css.js` sabía que
   `.app-estado--aviso` se montaba a trozos y la dejaba en paz;
   `db/limpiar-css-muerto.js`, escrito después con la misma idea pero
   sin esa parte, proponía borrar 130 clases de las que 54 sí sobraban.

   Las dos herramientas tenían razón a su manera y se contradecían, y
   la que manda al borrar es la que no lo sabe. Con dos copias del
   mismo criterio, el que se equivoca es el que borra.

   ── EL CASO QUE MOTIVÓ ESTO ──

       class="app-estado app-estado--<%= s.estado.tono %>"

   En el código no está escrito `app-estado--aviso` en ninguna parte:
   lo pone `tono`, que vale `ok`, `aviso`, `peligro` o `neutro`. Un
   escaneo que busca el nombre entero dice que no se usan, y borrarlas
   deja la etiqueta de estado sin color. La pantalla sigue saliendo.
   No hay error, no hay aviso: solo deja de estar a color.
   ========================================================= */

const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..");

/** Dónde puede aparecer una clase y que cuente como uso. */
const DONDEN = ["views", "public/js", "routes", "content"];

/* ═══════════════════════════════════════════════════════════════
   CLASES QUE PONE UNA LIBRERÍA DE FUERA

   No aparecen escritas en el código porque no es nuestro código el que
   las escribe: las pone el JavaScript de la librería, que viene de un
   CDN.

   ── EL CASO ──

   Lenis, el scroll suave, se carga en `partials/footer.ejs` desde un
   CDN y se maneja en `public/js/motion.js`. Al arrancar, la librería
   añade `lenis` y `lenis-smooth` al `<html>`, y `lenis-stopped`
   mientras hace falta.

   En el repositorio no está escrito ninguna. Un escaneo dice que
   `html.lenis body { height: auto }` está muerta, y borrarla rompe el
   scroll suave de toda la web pública sin dar ningún error: la página
   sigue desplazándose, solo que a saltos.

   ── POR QUÉ ES UNA LISTA Y NO UNA BÚSQUEDA ──

   Porque no se puede detectar: la clase no está en ningún sitio del
   repositorio. Hay que saber que existe. Por eso lleva un comentario
   al lado: para que el que lea esto sepa qué pasa si la quita de la
   lista.

   ── Y POR QUÉ NO SE BUSCA EN EL HTML ──

   Porque en este momento no hay `<html class="lenis">` en ningún
   archivo: eso lo hace la librería al cargar, en el navegador. Un
   guardado al arrancar del servidor no lo contiene.
   ───────────────────────────────────────────────────────────── */
const DE_LIBRERIA = [
  // Lenis (scroll suave), desde el CDN. Ver partials/footer.ejs.
  "lenis",
  "lenis-smooth",
  "lenis-stopped",
  "lenis-scrolling",

  // GSAP deja aviso en el <html> cuando carga. Ver public/js/motion.js.
  "has-gsap",
];

/* ═══════════════════════════════════════════════════════════════
   LEER
   ═══════════════════════════════════════════════════════════════ */

function leerUsos() {
  const partes = [];

  const recorrer = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);

      if (f.isDirectory()) {
        if (f.name === "node_modules" || f.name.startsWith(".")) continue;
        recorrer(p);
        continue;
      }

      if (/\.(ejs|js)$/.test(f.name)) partes.push(fs.readFileSync(p, "utf8"));
    }
  };

  for (const d of DONDEN) {
    const p = path.join(RAIZ, d);
    if (fs.existsSync(p)) recorrer(p);
  }

  return partes.join("\n");
}

function leerHojas() {
  const dir = path.join(RAIZ, "public", "css");
  const hojas = {};

  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith(".css")) hojas[f] = fs.readFileSync(path.join(dir, f), "utf8");
  }

  return hojas;
}

/* ═══════════════════════════════════════════════════════════════
   SIN COMENTARIOS

   Un selector dentro de un comentario no existe. Si no se quitaran,
   el escaneo creería que hay reglas vivas donde no hay nada, y el
   limpiador borraría de menos. Eso no rompe nada; lo que rompe es lo
   contrario.
   ═══════════════════════════════════════════════════════════════ */

function sinComentarios(css) {
  let out = "";
  let dentro = false;

  for (let i = 0; i < css.length; i++) {
    const c2 = css.slice(i, i + 2);

    if (!dentro && c2 === "/*") {
      dentro = true;
      i++;
      continue;
    }

    if (dentro && c2 === "*/") {
      dentro = false;
      i++;
      out += " ";
      continue;
    }

    if (!dentro) out += css[i];
  }

  return out;
}

/* ═══════════════════════════════════════════════════════════════
   LAS REGLAS

   Se lleva la cuenta de llaves para saber en qué bloque se está. Solo
   bajan las de clase de primer nivel; lo que está dentro de un
   `@media` se deja para una pasada aparte, porque borrarlo exige
   quitarlo de su bloque y no de un rango suelto.
   ═══════════════════════════════════════════════════════════════ */

function reglas(css) {
  const encontradas = [];
  const lineaDe = (pos) => css.slice(0, pos).split("\n").length;

  let i = 0;
  let profundidad = 0;
  let inicio = 0;

  while (i < css.length) {
    const c = css[i];

    if (c === "{") {
      const selector = css.slice(inicio, i).trim();

      if (selector && selector.startsWith(".") && !selector.includes("@")) {
        let nivel = 1;
        let j = i + 1;
        while (j < css.length && nivel > 0) {
          if (css[j] === "{") nivel++;
          else if (css[j] === "}") nivel--;
          j++;
        }

        encontradas.push({
          inicio,
          fin: j,
          linea: lineaDe(inicio),
          selector,
          profundidad,
        });

        i = j;
        inicio = i;
        continue;
      }

      profundidad++;
      i++;
      inicio = i;
      continue;
    }

    if (c === "}") {
      profundidad = Math.max(0, profundidad - 1);
      i++;
      inicio = i;
      continue;
    }

    if (c === ";") {
      i++;
      inicio = i;
      continue;
    }

    i++;
  }

  return encontradas;
}

/* ═══════════════════════════════════════════════════════════════
   LAS DOS PREGUNTAS
   ═══════════════════════════════════════════════════════════════ */

/**
 * ¿Aparece la clase escrita en el código?
 *
 * @param {string} clase sin el punto
 * @param {string} usos el resultado de `leerUsos()`
 * @returns {boolean}
 */
function escrita(clase, usos) {
  return new RegExp(
    "(?<![\\w-])" + clase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\w-])"
  ).test(usos);
}

/**
 * ¿Se monta a trozos, con un interpolado?
 *
 * Se parte el nombre en `--` o `__`, que es donde BEM separa el
 * modificador, y se busca la base seguida de un separador en el
 * código. Si aparece `app-estado-`, hay un `app-estado--` que se
 * construye en tiempo de render.
 *
 * ── POR QUÉ EL PRIMER SEPARADOR ──
 *
 * Partir en el primer guion suelto daba `app` en
 * `app-estado--aviso`, que no es una clase y no encuentra nada. Con
 * `--` la base es `app-estado`, que sí existe.
 *
 * ── POR QUÉ ES CONSERVADOR A PROPÓSITO ──
 *
 * Se equivoca de más, no de menos: una clase que se cree montada a
 * trozos y no lo era, se queda. Sobrar una regla no rompe nada;
 * borrarla de más, sí.
 *
 * @param {string} clase
 * @param {Set<string>} definidas todas las clases del CSS
 * @param {string} usos
 * @returns {string|null} la base que la construye, o null
 */
function montadaATrozos(clase, definidas, usos) {
  const bem = clase.search(/--|__/);
  const corte = bem !== -1 ? bem : clase.indexOf("-");

  if (corte <= 0) return null;

  const base = clase.slice(0, corte);

  /* La base tiene que existir como clase: si no, esto es un resto de
     un nombre y no una clase construida. */
  if (!definidas.has(base)) return null;

  const marca = new RegExp(
    "(?<![\\w-])" + base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[-_]{1,2}"
  );

  return marca.test(usos) ? base : null;
}

/* ═══════════════════════════════════════════════════════════════
   EL INFORME COMPLETO
   ═══════════════════════════════════════════════════════════════ */

/**
 * Las clases de cada hoja, con su veredicto.
 *
 * @returns {{uso: string, hojas: Object, porHoja: Object}}
 *   `uso` es el texto con todo lo que se busca;
 *   `hojas` es el CSS crudo por nombre de fichero;
 *   `porHoja` es {fichero, muertas: string[], montadas: string[]}
 */
function analizar() {
  const uso = leerUsos();
  const hojas = leerHojas();

  /* Todas las clases definidas, de todas las hojas: para comprobar
     si la base de una montada a trozos existe en el CSS. */
  const todas = new Set();

  const porHoja = {};

  for (const f of Object.keys(hojas)) {
    const limpio = sinComentarios(hojas[f]);
    const definidas = new Set();

    for (const r of reglas(limpio)) {
      for (const m of r.selector.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
        definidas.add(m[1]);
        todas.add(m[1]);
      }
    }

    porHoja[f] = { limpio, definidas, muertas: [], montadas: [] };
  }

  /* Dos pasadas: primero se juntan todas las definidas, porque una
     clase montada a trozos puede estar en una hoja y su base en otra. */
  for (const f of Object.keys(porHoja)) {
    const h = porHoja[f];

    for (const c of [...h.definidas]) {
      if (DE_LIBRERIA.includes(c)) continue;
      if (escrita(c, uso)) continue;

      if (montadaATrozos(c, todas, uso)) {
        h.montadas.push(c);
        continue;
      }

      h.muertas.push(c);
    }

    h.montadas.sort();
    h.muertas.sort();
  }

  return { uso, hojas, porHoja, todas };
}

module.exports = {
  analizar,
  reglas,
  sinComentarios,
  escrita,
  montadaATrozos,
  DE_LIBRERIA,
  RAIZ,
};
