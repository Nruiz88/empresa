const fs = require("fs");
const path = require("path");

/* ═══════════════════════════════════════════════════════════════
   QUÉ PANTALLA SUFRE MÁS

   ── POR QUE NO ESCOJO YO A OJO ──

   Porque «la que más sufra» es una opinión, y si elijo mal
   enseño el resultado sobre una pantalla que no era la que quería
   ver. Con un conteo se elige la que tiene más superficie en
   pantalla, que es donde se nota la falta de separación.

   ── LO QUE CUENTA ──

     tarjetas   las cajas de contenido, donde la sombra decide si
                una está encima de otra.
     métricas   los números grandes del inicio, que son las piezas
                más separadas y las que más se parecen entre sí.

   La pantalla con más de las dos es donde el problema se ve peor,
   y por tanto la que mejor sirve para probar si la escala nueva
   funciona.
   ═══════════════════════════════════════════════════════════════ */

const V = "D:/webs/empresa/views/panel";

const cuenta = (t, re) => (t.match(re) || []).length;

const filas = [];

for (const f of fs.readdirSync(V).filter((x) => x.endsWith(".ejs"))) {
  const t = fs.readFileSync(path.join(V, f), "utf8");

  const tarjetas = cuenta(t, /class="[^"]*\bcard\b/g);
  const metricas = cuenta(t, /class="[^"]*\b(metrica|metric|kpi|stat)\b/g);
  const cajas = cuenta(t, /class="[^"]*\b(caja|panel-caja|tarjeta)\b/g);

  filas.push({ f, tarjetas, metricas, cajas, lineas: t.split("\n").length });
}

filas.sort((a, b) => b.tarjetas + b.metricas - (a.tarjetas + a.metricas));

console.log("\n═══ Las pantallas, por superficie ═══\n");
console.log("  " + "vista".padEnd(26) + "tarjetas".padStart(9) + "métricas".padStart(10) + "líneas".padStart(8));
console.log("");

for (const x of filas.slice(0, 14)) {
  console.log(
    "  " + x.f.padEnd(26) +
    String(x.tarjetas).padStart(9) +
    String(x.metricas).padStart(10) +
    String(x.lineas).padStart(8)
  );
}

const mejor = filas[0];
console.log("\n  ── la que más superficie tiene ──");
console.log(
    "  " + mejor.f + "  (" + mejor.tarjetas + " tarjetas, " +
    mejor.metricas + " métricas, " + mejor.lineas + " líneas)"
);
console.log("");