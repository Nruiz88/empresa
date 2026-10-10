/* =========================================================
   Shopcito — Los selectores escritos dos veces
   ------------------------------------------------------------
   Uso:
     node db/ver-css-duplicados.js          dice qué falta, no toca nada
     node db/ver-css-duplicados.js --si     arregla

   ── POR QUÉ NO SE BORRA EL PRIMERO Y YA ──

   Porque el último gana, no el más largo ni el más reciente. Si el
   último declara cuatro de las seis propiedades del primero, borrar el
   primero se lleva dos que no están en ninguna otra parte: se pierden
   sin avisar.

   Una regla escrita dos veces siempre es una decisión: alguien ñapa
   algo al final. Lo que hay que hacer es mover esa ñapa al sitio
   donde se lee y borrar el resto.

   ── Y POR QUÉ UN SELECTOR DENTRO DE UN `@media` NO CUENTA ──

   Porque no es un duplicado: es una regla que solo aplica a partir de
   cierto ancho. `.panel-stat { }` arriba y `.panel-stat { }` dentro de
   `@media (max-width: 560px)` son la misma regla en dos sitios a
   propósito, y borrar la de arriba no «arregla» nada.

   ── EL CASO QUE SÍ ES UN DUPLICADO ──

   El mismo selector dos veces en el MISMO nivel y en el MISMO
   `@media`. Ahí no hay ancho que lo justifique: la segunda gana
   siempre y la primera no hace nada.

   ── QUÉ DICE CADA UNO ──

   Para cada bloque: cuántas propiedades declara y cuáles. Y para el
   que gana: cuáles de las del primero NO están en él. Eso es lo que
   hay que copiar antes de borrar.
   ========================================================= */

const fs = require("fs");
const path = require("path");

const CSS = path.resolve(__dirname, "../public/css");
const SEGURO = process.argv.includes("--si");

/* ═══════════════════════════════════════════════════════════════
   LEER

   Se quitan los comentarios para no trabajar sobre reglas que no
   existen.
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
   LAS REGLAS, CON SU CONTEXTO

   `contexto` es la cadena de `@media` en la que está la regla. Dos
   reglas con el mismo selector en contextos distintos NO son
   duplicados.

   `declaraciones` es el texto entre llaves, partido por `;`.
   ═══════════════════════════════════════════════════════════════ */

function reglas(css) {
  const encontradas = [];
  const lineaDe = (pos) => css.slice(0, pos).split("\n").length;

  let i = 0;
  const pila = [];
  let inicio = 0;
  let lineaInicio = 1;

  while (i < css.length) {
    const c = css[i];

    if (c === "{") {
      const antes = css.slice(inicio, i);
      const esAt = antes.trim().startsWith("@");

      if (esAt) {
        pila.push({ selector: antes.trim(), linea: lineaDe(inicio), inicio });
        i++;
        inicio = i;
        continue;
      }

      /* Buscar la llave que cierra. */
      let nivel = 1;
      let j = i + 1;
      while (j < css.length && nivel > 0) {
        if (css[j] === "{") nivel++;
        else if (css[j] === "}") nivel--;
        j++;
      }

      const selector = antes.trim();

      if (selector && !selector.startsWith("@")) {
        encontradas.push({
          selector,
          contexto: pila.map((p) => p.selector).join(" > ") || "(nivel superior)",
          declaraciones: css.slice(i + 1, j - 1),
          inicio: inicio,
          fin: j,
          linea: lineaDe(inicio),
        });
      }

      i = j;
      inicio = i;
      continue;
    }

    if (c === "}") {
      if (pila.length) pila.pop();
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
   LAS PROPIEDADES

   Se parte por `;` a nivel de paréntesis, para no partir un
   `background: linear-gradient(...)` en tres trozos.
   ═══════════════════════════════════════════════════════════════ */

function propiedades(texto) {
  const out = [];
  let nivel = 0;
  let actual = "";

  for (const c of texto) {
    if (c === "(") nivel++;
    else if (c === ")") nivel--;

    if (c === ";" && nivel === 0) {
      const t = actual.trim();
      if (t) out.push({ texto: t, propiedad: (t.match(/^([\w-]+)/) || [])[1] || t });
      actual = "";
      continue;
    }

    actual += c;
  }

  const t = actual.trim();
  if (t) out.push({ texto: t, propiedad: (t.match(/^([\w-]+)/) || [])[1] || t });

  return out;
}

/* ═══════════════════════════════════════════════════════════════
   AGRUPAR
   ═══════════════════════════════════════════════════════════════ */

const cambios = [];

for (const f of fs.readdirSync(CSS)) {
  if (!f.endsWith(".css")) continue;

  const ruta = path.join(CSS, f);
  const texto = fs.readFileSync(ruta, "utf8");
  const limpio = sinComentarios(texto);

  const todas = reglas(limpio);

  /* Se agrupa por selector Y por contexto. */
  const grupos = new Map();

  for (const r of todas) {
    /* Los selectores agrupados (`.a, .b`) se dejan: unirlos es otro
       trabajo y no aporta nada aquí. */
    if (r.selector.includes(",")) continue;

    const clave = r.contexto + "|" + r.selector;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(r);
  }

  for (const [clave, grupo] of grupos) {
    if (grupo.length < 2) continue;

    /* La última es la que gana. */
    const gana = grupo[grupo.length - 1];
    const pierden = grupo.slice(0, -1);

    const propsGana = new Set(propiedades(gana.declaraciones).map((p) => p.propiedad));

    /* Lo que hay que rescatar antes de borrar. */
    const rescate = [];

    for (const p of pierden) {
      for (const d of propiedades(p.declaraciones)) {
        if (!propsGana.has(d.propiedad)) rescate.push({ de: p, decl: d });
      }
    }

    cambios.push({
      f,
      ruta,
      clave,
      selector: gana.selector,
      contexto: gana.contexto,
      gana,
      pierden,
      rescate,
    });
  }
}

cambios.sort((a, b) => b.rescate.length - a.rescate.length);

/* ═══════════════════════════════════════════════════════════════
   DECIRLO
   ═══════════════════════════════════════════════════════════════ */

console.log("\n═══ Selectores escritos dos veces ═══\n");

const conRescate = cambios.filter((c) => c.rescate.length);
const sinRescate = cambios.filter((c) => !c.rescate.length);

console.log("  " + cambios.length + " selectores repetidos en el mismo sitio");
console.log("");
console.log("    " + sinRescate.length + " se pueden borrar los anteriores tal cual");
console.log("    " + conRescate.length + " tienen algo que hay que rescatar antes");
console.log("");

if (conRescate.length) {
  console.log("  ── hay que rescatar ──");
  console.log("");
  for (const c of conRescate) {
    console.log(
      "    " + c.selector.slice(0, 40).padEnd(40) +
      "x" + (c.pierden.length + 1) + "  " + c.f + ":" + c.gana.linea
    );
    for (const r of c.rescate.slice(0, 6)) {
      console.log("        + " + r.decl.texto.slice(0, 62));
    }
    if (c.rescate.length > 6) {
      console.log("        … y " + (c.rescate.length - 6) + " más");
    }
    console.log("      contexto: " + c.contexto.slice(0, 50));
    console.log("");
  }
}

console.log("  ──────────────────────────────────────────────");
console.log(
  "  a borrar sin más: " + sinRescate.length +
  "     con rescate: " + conRescate.length
);
console.log("");

if (!SEGURO) {
  console.log("  SIMULACRO. No se ha tocado nada.");
  console.log("");
  process.exit(0);
}

/* ═══════════════════════════════════════════════════════════════
   ARREGLAR

   Primero se añade lo que falta a la regla que gana, y solo después se
   borran las anteriores. Al revés se pierde lo que hay que rescatar,
   y no hay vuelta atrás.
   ═══════════════════════════════════════════════════════════════ */

const porFichero = new Map();

for (const c of cambios) {
  if (!porFichero.has(c.f)) porFichero.set(c.f, []);
  porFichero.get(c.f).push(c);
}

for (const [f, lista] of porFichero) {
  const ruta = path.join(CSS, f);
  let texto = fs.readFileSync(ruta, "utf8");

  /* De atrás hacia delante, para que las posiciones sigan valiendo. */
  const ordenadas = lista.slice().sort((a, b) => b.gana.inicio - a.gana.inicio);

  for (const c of ordenadas) {
    /* ── 1. Rescatar, si hace falta ──
       Se añade al final del bloque que gana. Es lo contrario de lo
       ideal —lo rescatado debería ir arriba, donde se lee— pero
       escribir en medio de un bloque obliga a recalcular todas las
       posiciones de las reglas siguientes, y eso es donde se
       corrompen los archivos. */
    if (c.rescate.length) {
      const anadido = c.rescate.map((r) => "\n  /* Rescatado de " + r.de.selector + " */\n  " + r.decl.texto + ";");
      const cierra = c.gana.fin - 1;
      texto = texto.slice(0, cierra) + anadido.join("") + "\n" + texto.slice(cierra);
    }

    /* ── 2. Borrar las anteriores ── */
    for (const p of c.pierden.slice().sort((a, b) => b.inicio - a.inicio)) {
      texto = texto.slice(0, p.inicio) + texto.slice(p.fin);
    }
  }

  fs.writeFileSync(ruta, texto, "utf8");
  console.log("  " + f + ": " + lista.length + " selectores");
}

console.log("");
console.log("  escrito.");
console.log("");
