const fs = require("fs");
const path = require("path");

/* ═══════════════════════════════════════════════════════════════
   LA ESCALA DE PROFUNDIDAD DEL PANEL

   ── POR QUÉ HAY QUE QUITAR LOS COMENTARIOS ANTES DE CONTAR ──

   Porque el CSS de este panel está comentado, y los comentarios
   talked de `border-radius: 12px` con la palabra «sombra» al lado.
   La primera vez que conté, cada «12px» que salía era de un
   comentario y no de una regla, y el resultado era 118 bordes
   distintos y 45 sombras, cuando el archivo tiene muchos menos.

   Cualquier medición sobre CSS comentado da números inventados si no
   se quitan los comentarios primero. Es el mismo error que busco
  buscar los `require`: contar cosas que no existen.

   ── LA PREGUNTA QUE MIDE ESTO ──

   No «¿tiene sombra?», sino «¿cuántas sombras distintas hay?».

   Una hoja con dos o tres sombras es un sistema: la tarjeta, la que
   flota y la que está presionada. Una hoja con veinte es veinte
   decisiones tomadas una por una, y por eso la página no se lee como
   un conjunto sino como un montón de cajas parecidas entre las que
   no se sabe qué va con qué.

   Lo mismo con los bordes y los radios. El plano se prepara aquí y
   se aplica en `00-base.css`; esto solo dice qué falta.
   ═══════════════════════════════════════════════════════════════ */

const CSS = "D:/webs/empresa/public/css";

function sinComentarios(t) {
  return t.replace(/\/\*[\s\S]*?\*\//g, "");
}

console.log("\n═══ La escala, sin contar comentarios ═══\n");

const sombras = new Map();
const bordes = new Map();
const radios = new Map();
const fondos = new Map();

let lineasReales = 0;

for (const f of fs.readdirSync(CSS).filter((x) => x.endsWith(".css"))) {
  const t = sinComentarios(fs.readFileSync(path.join(CSS, f), "utf8"));
  lineasReales += t.split("\n").filter((l) => l.trim()).length;

  const cuenta = (re, mapa) => {
    for (const m of t.matchAll(re)) {
      const v = m[1].trim();
      if (v === "none" || v === "0") continue;
      mapa.set(v, (mapa.get(v) || 0) + 1);
    }
  };

  cuenta(/box-shadow:\s*([^;]+);/g, sombras);
  cuenta(/border(?:-[a-z]+)?:\s*([^;]+);/g, bordes);
  cuenta(/border-radius:\s*([^;]+);/g, radios);
  cuenta(/background(?:-color)?:\s*([^;]+);/g, fondos);
}

function linea(etiqueta, mapa, tope) {
  const valores = [...mapa.entries()].sort((a, b) => b[1] - a[1]);
  console.log(
    "  " + etiqueta.padEnd(10) +
    String(valores.length).padStart(4) + " distintos   " +
    String(valores.reduce((s, v) => s + v[1], 0)).padStart(4) + " usos"
  );
  for (const [v, n] of valores.slice(0, tope)) {
    console.log("      " + String(n).padStart(4) + "×  " + v.slice(0, 58));
  }
  console.log("");
}

console.log("  (líneas de CSS reales: " + lineasReales + ")\n");

linea("sombras", sombras, 12);
linea("bordes", bordes, 10);
linea("radios", radios, 10);
linea("fondos", fondos, 12);

/* ── EL VEREDICTO ──

   El número que importa es el de sombras distintas. Dos o tres es un
   sistema. Más de diez significa que cada componente decidió su
   sombra, y entonces nada se relaciona con nada. */

const nSombras = sombras.size;

console.log("═══ Lo que dice el número ═══\n");
if (nSombras <= 4) {
  console.log("  " + nSombras + " sombras: es un sistema. No hay nada que arreglar aquí.");
} else {
  console.log("  " + nSombras + " sombras distintas para un panel de 22.000 líneas.");
  console.log("");
  console.log("  Con dos o tres, la tarjeta, la que flota y la que está");
  console.log("  presionada se distinguen por su sombra, y eso hace que");
  console.log("  una tarjeta dentro de otra se lea al instante.");
  console.log("");
  console.log("  Con veinte, cada componente eligió la suya, y por eso las");
  console.log("  cajas se parecen entre sí sin que se sepa cuál está más");
  console.log("  arriba. No es que falte sombra: es que sobran sombras");
  console.log("  distintas.");
}
console.log("");