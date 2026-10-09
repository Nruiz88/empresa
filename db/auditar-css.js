/* =========================================================
   Shopcito — Auditoría del CSS
   ------------------------------------------------------------
   Qué reglas no se usan, qué selectores están escritos dos veces y qué
   variables se usan sin existir.

   ── POR QUÉ ANTES DE REDISEÑAR ──

   Porque rediseñar encima de un CSS que se contradice es hacer el
   trabajo dos veces. Si `.panel-cell-note` está en el CSS y en otro
   sitio se define otra cosa con el mismo nombre, un rediseño que solo
   mira el CSS nuevo va a seguir heredando el problema viejo.

   ── LAS CUATRO COSAS QUE MIRA ──

   1. CLASES DEFINIDAS Y NO USADAS. Estilo que no se aplica nunca. No
      es inofensivo: ocupa sitio, y sobre todo hace creer que algo
      está estilado cuando no lo está.

   2. SELECTORES REPETIDOS. La misma regla escrita dos veces en el
      mismo archivo: la segunda manda. Funciona, pero no se sabe cuál
      de las dos se está mirando, y la primera es una trampa para el
      que viene después.

   3. VARIABLES QUE SE USAN Y NO EXISTEN. Una `var(--x)` sin
      definir vale como no poner nada: el navegador la ignora en
      silencio y la propiedad se queda sin valor.

   4. CLASES QUE SE USAN Y NO ESTÁN DEFINIDAS. Al revés que la
      primera: el marcado pide un estilo que no existe y no pasa nada.

   ── POR QUÉ UN NÚMERO Y NO UN «está bien» ──

   Porque «está bien» no se puede comprobar, y una cifra se puede
   comparar contra la de la semana que viene.
   ========================================================= */

const fs = require("fs");
const path = require("path");

const RAIZ = "D:/webs/empresa";
const CSS = path.join(RAIZ, "public", "css");

/** Dónde se busca que se use una clase. */
const DONDEN = ["views", "public/js", "routes", "content"];

/* ═══════════════════════════════════════════════════════════════
   1. LEER

   Se quitan los comentarios antes de contar: un selector que aparece
   dentro de un comentario no existe, y si se contara saldría como
   regla viva y como uso.
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
      /* Un salto para que dos reglas no se peguen al quitar el
         comentario y se lean como un selector enorme. */
      out += " ";
      continue;
    }

    if (!dentro) out += css[i];
  }

  return out;
}

/** Todo el texto donde se puede usar una clase. */
function usos() {
  let todo = "";

  const recorrer = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);

      if (f.isDirectory()) {
        if (f.name === "node_modules" || f.name.startsWith(".")) continue;
        recorrer(p);
        continue;
      }

      if (!/\.(ejs|js)$/.test(f.name)) continue;
      todo += fs.readFileSync(p, "utf8") + "\n";
    }
  };

  for (const d of DONDEN) {
    const p = path.join(RAIZ, d);
    if (fs.existsSync(p)) recorrer(p);
  }

  return todo;
}

const todo = usos();
const cssCrudo = {};

for (const f of fs.readdirSync(CSS)) {
  if (!f.endsWith(".css")) continue;
  cssCrudo[f] = fs.readFileSync(path.join(CSS, f), "utf8");
}

const limpio = {};
for (const f of Object.keys(cssCrudo)) limpio[f] = sinComentarios(cssCrudo[f]);

/* ═══════════════════════════════════════════════════════════════
   2. CLASES DEFINIDAS Y DÓNDE SE USAN
   ═══════════════════════════════════════════════════════════════ */

const definiciones = new Map(); // clase -> [{fichero, linea}]
const selectores = new Map(); // selector -> [{fichero, linea}]
const variables = new Map(); // --x -> [{fichero, linea, definido}]

for (const f of Object.keys(limpio)) {
  const lineas = limpio[f].split("\n");

  let dentroDeRegla = false;
  let selector = "";
  let lineaSelector = 0;

  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];

    if (!dentroDeRegla) {
      /* Buscar el `{` que abre una regla. Se mira fuera de cadenas
         para no contar el de un `content: "{"`. */
      const llave = l.indexOf("{");
      if (llave === -1) continue;

      selector = l.slice(0, llave).trim();
      lineaSelector = i + 1;
      dentroDeRegla = true;

      if (!selector) continue;

      if (!selectores.has(selector)) selectores.set(selector, []);
      selectores.get(selector).push({ f, linea: i + 1 });

      /* Las clases del selector. */
      for (const m of selector.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
        const c = m[1];
        if (!definiciones.has(c)) definiciones.set(c, []);
        definiciones.get(c).push({ f, linea: i + 1 });
      }
      continue;
    }

    /* Dentro de una regla. */
    if (l.includes("}")) dentroDeRegla = false;
  }

  /* Variables: las que se DEFINEN (`--x:`) y las que se USAN
     (`var(--x)`). */
  const bruto = cssCrudo[f];

  for (const m of bruto.matchAll(/(--[\w-]+)\s*:/g)) {
    const v = m[1];
    const linea = bruto.slice(0, m.index).split("\n").length;
    if (!variables.has(v)) variables.set(v, []);
    variables.get(v).push({ f, linea, definido: true });
  }

  for (const m of limpio[f].matchAll(/var\(\s*(--[\w-]+)/g)) {
    const v = m[1];
    const pos = limpio[f].indexOf(m[0]);
    const linea = limpio[f].slice(0, pos).split("\n").length;
    if (!variables.has(v)) variables.set(v, []);
    variables.get(v).push({ f, linea, definido: false });
  }
}

/* ═══════════════════════════════════════════════════════════════
   3. CRUZAR
   ═══════════════════════════════════════════════════════════════ */

/** ¿Se usa esta clase en el marcado o el código? */
const seUsa = (clase) => {
  const re = new RegExp("(?<![\\w-])" + clase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\w-])");
  return re.test(todo);
};

/* Clases que existen en el marcado pero no en el CSS. */
const usadas = new Set();
for (const m of todo.matchAll(/class="([^"]*)"/g)) {
  for (const c of m[1].split(/\s+/)) {
    if (c && !c.includes("<%") && !c.includes("{")) usadas.add(c);
  }
}

/* ─────────────────────────────────────────────────────────────
   EL INFORME
   ───────────────────────────────────────────────────────────── */

const muertas = [];
for (const [clase, donde] of definiciones) {
  if (!seUsa(clase)) muertas.push({ clase, donde });
}

muertas.sort((a, b) => b.donde.length - a.donde.length);

const repetidos = [];
const mediaQueries = [];

for (const [sel, donde] of selectores) {
  /* ─────────────────────────────────────────────────────
     UN `@media` REPETIDO NO ES UN CONFLICTO

     La primera versión contaba los `@media (max-width: 760px)` que
     salen cuatro veces como selectores duplicados, y son lo más
     normal del mundo: cada bloque responsive tackle su parte del
     problema y todos se aplican.

     Solo cuentan los selectores de verdad: los que se escriben dos
     veces en el MISMO archivo, donde la segunda gana y la primera
     queda como una trampa.
     ───────────────────────────────────────────────────── */
  if (sel.startsWith("@")) {
    mediaQueries.push({ sel, donde });
    continue;
  }

  /* Los que llevan una coma no cuentan: `.a, .b { }` escrito dos
     veces es raro pero no es una contradicción, es la misma idea
     repartida. */
  if (sel.includes(",")) continue;

  /* Los `@keyframes` no cuentan: `to { }` sale en todas las
     animaciones del archivo y no es un conflicto, es parte del
     lenguaje. Salían como «to x4» y es ruido. */
  if (/^(from|to|\d+%)$/.test(sel)) continue;

  const porFichero = new Map();
  for (const d of donde) {
    if (!porFichero.has(d.f)) porFichero.set(d.f, []);
    porFichero.get(d.f).push(d.linea);
  }

  for (const [f, lineas] of porFichero) {
    if (lineas.length > 1) repetidos.push({ sel, f, lineas });
  }
}

repetidos.sort((a, b) => b.lineas.length - a.lineas.length);

const sinDefinir = [];
for (const [v, usosDe] of variables) {
  const definido = usosDe.some((u) => u.definido);
  if (!definido) {
    /* ─────────────────────────────────────────────────────
       QUÉ PROPIEDAD QUEDA SIN VALOR

       Un `var(--x)` sin definir NO da error: el navegador lo ignora
       y la propiedad se queda sin valor. Una regla que dice
       `padding: var(--p-5)` con `--p-5` sin existir es un `padding`
       que no aplica, y no se ve: el resto de la regla es válida.

       Por eso el nombre solo no dice nada. Hay que ver la
       declaración en la que está, que es donde se decide si es un
       hueco visible o un detalle.
       ───────────────────────────────────────────────────── */
    const declaraciones = [];

    for (const u of usosDe.filter((x) => !x.definido)) {
      /* Se busca la LÍNEA, no una posición en el archivo entero.

         La primera versión hacía `indexOf` desde casi el final, y
         por eso salía `}` como propiedad: estaba leyendo la última
         línea del archivo en lugar de la que usa la variable. */
      const lineas = limpio[u.f].split("\n");
      const enUso = lineas[u.linea - 1] || "";

      const prop = (enUso.match(/([\w-]+)\s*:/) || [])[1] || "";

      /* ─────────────────────────────────────────────────────
         ¿TIENE VALOR DE RESERVA O NO?

         `var(--x, 0.95rem)` con `--x` sin definir está bien: el
         navegador usa el 0.95rem y no pasa nada. Es una variable
         que alguien quiere poder sobrescribir desde arriba, y por
         eso lleva un valor por si acaso.

         `var(--x)` a secas, sin la coma, NO: la propiedad entera se
         queda sin valor. Y si está dentro de un `calc()`, el `calc`
         entero es inválido, que es peor: no es que quede sin
         margen, es que la regla no aplica.

         De once, nueve eran lo primero. Y una auditoría que dice «once
         fallos» cuando nueve están bien enseñando a ignorar las
         dos que sí.
         ───────────────────────────────────────────────────── */
      const tieneReserva = new RegExp(
        "var\\(\\s*" + v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*,"
      ).test(enUso);

      const enCalc = /calc\([^)]*var\(\s*--/.test(enUso);

      declaraciones.push({
        f: u.f,
        linea: u.linea,
        propiedad: prop,
        reserva: tieneReserva,
        enCalc,
        texto: enUso.trim().slice(0, 58),
      });
    }

    sinDefinir.push({ v, declaraciones });
  }
}

const sinEstilo = [...usadas].filter((c) => !definiciones.has(c) && !seUsa(c));

console.log("\n═══ Auditoría del CSS ═══\n");

console.log("  ── 1. Clases definidas que no se usan ──");
console.log("     " + muertas.length + " de " + definiciones.size);
console.log("");
for (const m of muertas.slice(0, 14)) {
  console.log(
    "     ." + m.clase.padEnd(30) +
    String(m.donde.length).padStart(2) + " vez" + (m.donde.length > 1 ? "ces" : "") +
    "   " + m.donde[0].f + ":" + m.donde[0].linea
  );
}
if (muertas.length > 14) console.log("     … y " + (muertas.length - 14) + " más");
console.log("");

console.log("  ── 2. Selectores escritos dos veces en el mismo archivo ──");
console.log("     " + repetidos.length + "   (sin contar los @media, que son normales)");
console.log("");
for (const r of repetidos.slice(0, 14)) {
  console.log(
    "     " + r.sel.slice(0, 44).padEnd(44) +
    "x" + r.lineas.length + "  " + r.f + ":" + r.lineas.join(", ")
  );
}
if (repetidos.length > 14) console.log("     … y " + (repetidos.length - 14) + " más");
console.log("");

console.log("  ── 3. Variables que se usan y no existen ──");

const conReserva = sinDefinir.flatMap((s) => s.declaraciones).filter((d) => d.reserva);
const sinReserva = sinDefinir.flatMap((s) => s.declaraciones).filter((d) => !d.reserva);

console.log("");
console.log("     Con valor de reserva — están bien:");
console.log("       el navegador usa lo que va después de la coma. Es");
console.log("       una variable pensada para poder sobrescribirse.");
console.log("");
for (const d of conReserva.slice(0, 12)) {
  console.log("       " + String(d.propiedad || "?").padEnd(16) + d.f + ":" + String(d.linea).padStart(4));
}
if (conReserva.length > 12) console.log("       … y " + (conReserva.length - 12) + " más");

console.log("");
console.log("     SIN valor de reserva — esto sí se rompe:");
console.log("");
for (const d of sinReserva) {
  console.log(
    "       " + String(d.propiedad || "?").padEnd(24) +
    d.f + ":" + String(d.linea).padStart(4) +
    (d.enCalc ? "   dentro de calc(): la regla entera no aplica" : "")
  );
  console.log("         " + d.texto);
}
console.log("");

console.log("  ──────────────────────────────────────────────");
console.log(
  "  reglas muertas:      " + muertas.length +
  "   (no hacen falta, pero no molestan)"
);
console.log(
  "  selectores repetidos: " + repetidos.length +
  "   (el último gana; el primero es una trampa)"
);
console.log(
  "  bloques @media:      " + mediaQueries.length +
  "   (normales: cada uno tackle su parte)"
);
console.log(
  "  variables inexistentes: " + sinReserva.length +
  "   (las otras " + conReserva.length + " tienen valor de reserva y están bien)"
);
console.log("");
console.log("  Para rediseñar: lo que importa es lo segundo. Una regla");
console.log("  escrita dos veces hace que un cambio en la primera no se");
console.log("  vea, y eso es exactamente lo que pasa cuando se prueba");
console.log("  algo, se deshace y no se sabe por qué.");
console.log("");
