require("../lib/env").load();

const fs = require("fs");
const path = require("path");

const { sinComentarios } = require("../lib/css-clases");

const CSS = path.resolve(__dirname, "../public/css");

/* ─────────────────────────────────────────────────────────────
   ¿SIGUE ESTANDO TODO?

   Borrar reglas es fácil. Lo difícil es no borrar de más: una regla
   agrupada mal partida se lleva por delante las clases que sí se
   usan, y el panel sigue arrancando —solo que sin borde, sin fondo y
   sin separación—.

   ── LO QUE COMPRUEBA ──

     1. Que las llaves cuadran. Un bloque sin cerrar hace que el
        navegador deje de leer CSS a partir de ahí, y todo lo que
        viene después se queda sin estilo sin decir nada.

     2. Que las clases que más se usan siguen teniendo regla. Se
        cuentan las apariciones en el código y se mira si las veinte
        más usadas siguen declaradas.

     3. Que las reglas agrupadas siguen agrupan. Si de
        `.a, .b, .c` se quita una, `.a` y `.c` tienen que seguir
        juntas: separarlas no rompe nada visible, pero duplica la
        regla y engaña a quien la lea después.

   ── POR QUÉ NO BASTA CON QUE LAS LLAVES CUADREN ──

   Porque el peor caso no es un error de sintaxis. Es un archivo
   válido al que le falta la mitad del estilo, que se ve como un
   panel «raro» y no como un fallo.
   ───────────────────────────────────────────────────────────── */

const css = {};
for (const f of fs.readdirSync(CSS)) {
  if (f.endsWith(".css")) css[f] = fs.readFileSync(path.join(CSS, f), "utf8");
}

let fallos = 0;

console.log("\n═══ ¿Quedó todo? ═══\n");

/* ── 0. Líneas partidas ──
   ESTA COMPROBACIÓN ES LA QUE FALTABA.

   Un archivo con las llaves cuadradas puede estar roto. Lo que pasó
   al borrar las reglas muertas:

       .price.precio-mensual .amount { … }
                                        }sual {

   La segunda línea es el final de una regla pegado al principio de la
   siguiente. Las llaves CUADRAN —una abre y una cierra— y el
   verificador daba verde.

   El archivo es válido, el navegador no protesta, y media regla deja
   de aplicarse. No hay ningún error: solo un panelraro.

   Y por eso aquí se mira el texto de las líneas, no el balance. */
console.log("  0. líneas partidas");

let partidas = 0;

for (const f of Object.keys(css)) {
  const lineas = css[f].split("\n");
  const malas = [];

  lineas.forEach((l, i) => {
    const t = l.trim();
    if (!t) return;

    /* Una llave que cierra pegada a texto: }algo */
    if (/^\}[^\s}]/.test(t)) malas.push({ i: i + 1, t });
    /* Una llave que abre pegada a texto al final de línea: algo{ */
    else if (/[^\s{]\{$/.test(t) && !/^[^{]*\{$/.test(t)) malas.push({ i: i + 1, t });
    /* Dos llaves en la misma línea sin nada entre medio. */
    else if (/\}[^\s;}]/.test(t) && !/\/\*/.test(t)) malas.push({ i: i + 1, t });
  });

  if (malas.length) {
    console.log("     × " + f);
    for (const m of malas.slice(0, 6)) {
      console.log("         L" + m.i + ": " + m.t.slice(0, 60));
    }
    if (malas.length > 6) console.log("         … y " + (malas.length - 6) + " más");
    partidas += malas.length;
    fallos += malas.length;
  } else {
    console.log("     ✓ " + f);
  }
}

/* ── 1. Las llaves ── */
console.log("");
console.log("  1. llaves por fichero");

for (const f of Object.keys(css)) {
  const limpio = sinComentarios(css[f]);

  let nivel = 0;
  let minimo = 0;
  for (const c of limpio) {
    if (c === "{") nivel++;
    else if (c === "}") {
      nivel--;
      if (nivel < minimo) minimo = nivel;
    }
  }

  const ok = nivel === 0 && minimo === 0;
  if (!ok) fallos++;

  console.log(
    "     " + (ok ? "✓" : "×") + " " + f.padEnd(24) +
    "abren " + nivel + "   " + (ok ? "" : "NO CUADRA")
  );
}

/* ── 2. Las clases más usadas ── */

const DONDEN = ["views", "public/js", "routes", "content"];
const RAIZ = path.resolve(__dirname, "..");

let usos = "";
const recorrer = (dir) => {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) {
      if (f.name === "node_modules" || f.name.startsWith(".")) continue;
      recorrer(p);
    } else if (/\.(ejs|js)$/.test(f.name)) {
      usos += fs.readFileSync(p, "utf8") + "\n";
    }
  }
};
for (const d of DONDEN) {
  const p = path.join(RAIZ, d);
  if (fs.existsSync(p)) recorrer(p);
}

const conteo = new Map();

for (const m of usos.matchAll(/class="([^"]*)"/g)) {
  for (const c of m[1].split(/\s+/)) {
    const limpio = c.trim();

    /* ─────────────────────────────────────────────────────
       SOLO CLASES DE VERDAD

       La primera versión quitaba los interpolados con una
       expresión regular y contaba lo que quedaba. De
       `class="btn <%= x %> btn--<%= y %>"` salían cosas como `%>` o
       `btn--`, y aparecían entre las más usadas sin regla.

       Una clase tiene letras, números, guiones y subrayados, y
       empieza por letra o guion bajo. Cualquier otra cosa es
       interpolado y se tira.
       ───────────────────────────────────────────────────── */
    if (!/^[a-zA-Z][\w-]*$/.test(limpio)) continue;

    conteo.set(limpio, (conteo.get(limpio) || 0) + 1);
  }
}

const declaradas = new Set();
const todoCSS = Object.values(css).map(sinComentarios).join("\n");
for (const m of todoCSS.matchAll(/\.([a-zA-Z][\w-]*)/g)) declaradas.add(m[1]);

const top = [...conteo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);

console.log("");
console.log("  2. las veinte clases más usadas");

let sinRegla = 0;
for (const [c, n] of top) {
  const tiene = declaradas.has(c);
  if (!tiene) sinRegla++;
  console.log(
    "     " + (tiene ? "✓" : "×") + " " + ("." + c).padEnd(28) +
    String(n).padStart(4) + " usos" +
    (tiene ? "" : "   SIN REGLA")
  );
}

if (sinRegla) {
  console.log("");
  console.log("     " + sinRegla + " de las veinte más usadas se quedaron sin regla.");
  fallos += sinRegla;
}

console.log("");
console.log("  ──────────────────────────────────────────────");
console.log(fallos ? "  × " + fallos + " problema(s)" : "  ✓ el CSS sigue entero");
console.log("");
