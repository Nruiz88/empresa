/* ¿El sitio habla en español de Argentina o de España?
   ─────────────────────────────────────────────────────────────
   El sitio es de Argentina: shopcito.com.ar, pesos, teléfono. Y buena
   parte de los textos venía del estudio en España.

   ── POR QUÉ ESTA COMPROBACIÓN NO ES PURISMO ──

   Porque hay palabras que no son «menos correctas» en un lado: son
   otra cosa. «Abonado» en Argentina no es quien paga una cuota, es
   quien está suscrito a un servicio. Ponerlo en las condiciones de
   hire—donde se habla de que el cliente paga— dice literalmente que
   el cliente es una persona suscripta a televisión.

   Y hay una diferencia más seria: el voseo. «Tenés», «escribinos»,
   «buscás» son de Argentina. Con «ustedes» o con el tuteo de España,
   el sitio suena a folleto traducido, y en un negocio que atiende por
   WhatsApp eso se nota.

   ── LO QUE SE BUSCA ──

   Solo lo que cambia de significado o que suena claramente foráneo.
   Palabras iguales en ambos países no se tocan: «servicio», «precio»,
   «cliente» y «contrato» son los mismos y escribirlos distinto sería
   inventar. */
const fs = require("fs");
const path = require("path");

/* Palabras y expresiones que delatan español de España. */
const DE_ESPANA = [
  { patron: /\babonado?\b|\babonar\b|\bsuscripci[óo]n al\b/i, que: "abonado — en Argentina es una persona suscripta a un servicio" },
  { patron: /\bvosotros\b/i, que: "vosotros — no se usa; es 'ustedes' o voseo" },
  { patron: /\bm[óo]vil(es)?\b/i, que: "móvil — acá es 'celular'" },
  { patron: /\bordenador(es)?\b/i, que: "ordenador — acá es 'computadora'" },
  { patron: /\balbar[áa]n\b/i, que: "albarán — no se usa" },
  {
    /* Mayúsculas y palabra completa: el campo de la base se llama
       `site.nif` y eso no lo lee nadie. La etiqueta dice CUIT. */
    patron: /\bNIF\b/,
    que: "NIF — en Argentina es CUIT",
  },
  { patron: /\bP\.?\s?IVA\b/i, que: "P.IVA — español" },
  { patron: /\bn[úu]cleo?\b/i, que: "nucleo — no se usa" },
  { patron: /\bfactura electr[óo]nica\b/i, que: "factura electrónica — es un término español" },
  { patron: /\bse?[ñn]or\b|\bse[ñn]ora\b/i, que: "señor/señora — acá no se usa" },
  { patron: /\bvosotr[óo]s\b/i, que: "vosotros — no se usa" },
  { patron: /\bc[óo]digo postal\b.*\bC\.P\./i, que: "código postal con CP — español" },
  { pattern: null },
];

const VIEJOS = {
  patron: /Nexo Studio/i,
  que: "el nombre del estudio viejo",
};

function recorrer(dir, salida) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) recorrer(p, salida);
    else if (/\.(ejs|js|jsx|tsx|ts)$/.test(e.name)) salida.push(p);
  }
}

const raiz = process.cwd();
const archivos = [];
recorrer(path.join(raiz, "views"), archivos);
recargar(archivos);
recorrer(path.join(raiz, "content"), archivos);
recargar(archivos);

function recargar() {}

const hallazgos = [];

for (const archivo of archivos) {
  const texto = fs.readFileSync(archivo, "utf8");
  const lineas = texto.split(/\r?\n/);

  lineas.forEach((linea, i) => {
    for (const regla of DE_ESPANA) {
      if (!regla.patron) continue;
      if (regla.patron.test(linea)) {
        hallazgos.push({
          donde: archivo.replace(raiz + path.sep, ""),
          linea: i + 1,
          que: regla.que,
          texto: linea.trim(),
        });
      }
    }
    if (VIEJOS.patron.test(linea)) {
      hallazgos.push({
        donde: archivo.replace(raiz + path.sep, ""),
        linea: i + 1,
        que: VIEJOS.que,
        texto: linea.trim(),
      });
    }
  });
}

console.log("\n═══ ¿Español de España en el sitio? ═══\n");

/* Lo público importa más que lo interno: un texto legal en Castilla
   la lee un cliente; un comentario no lo lee nadie. */
const publicos = hallazgos.filter((h) => !h.donde.startsWith("panel") && !h.donde.startsWith("views/panel"));

console.log("  en lo PÚBLICO (" + publicos.length + "):\n");
publicos.forEach((h) => {
  console.log("    " + h.donde + ":" + h.linea);
  console.log("      " + h.que);
  console.log("      " + h.texto.slice(0, 100));
  console.log("");
});

const internos = hallazgos.length - publicos.length;
console.log("  en el panel y contenido (" + internos + ")\n");

if (!hallazgos.length) {
  console.log("  ✓ No quedó español de España.\n");
} else {
  console.log("  ──────────────────────────────────────────────\n");
  console.log("  Esto no se arregla con un reemplazo de palabras.\n");
  console.log("  Lo que hay que decidir es el registro general: si el sitio\n");
  console.log("  habla de voseo, tiene que hacerlo en todas partes, no solo\n");
  console.log("  en las páginas legales. Un sitio a medio camino se nota.\n");
}