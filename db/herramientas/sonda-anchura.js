/* =========================================================
   Sonda de desbordamiento horizontal
   ------------------------------------------------------------
   Uso:  node db/captura.js /panel/cobros cobros
         node db/sonda-anchura.js

   Añade a la captura un texto en pantalla con los elementos que se
   salen del ancho de la ventana. Sirve para localizar de dónde viene
   un desbordamiento en móvil, en vez de suponerlo.

   CUIDADO CON LOS NÚMEROS
   -----------------------
   Edge en modo headless NO baja de unos 490 px de ancho: si pides
   --window-size=390 te va a decir ventana=492 y además guarda una
   imagen de 390 px recortada. El recorte parece un desbordamiento y
   no lo es. Comprobado: a 492 px body.scrollWidth es igual a la
   ventana, o sea que no había nada roto.

   Para mirar móvil de verdad hay que pedir 500 px o más y fiarse del
   número que dice la sonda, no del ancho del PNG.
   ========================================================= */
const fs = require("fs");
const path = require("path");

const destino = path.join(__dirname, "..", "..", "public", "_captura.html");
let html = fs.readFileSync(destino, "utf8");

const sonda = `
<script>
window.addEventListener("load", function () {
  var limite = document.documentElement.clientWidth;
  var culpables = [];
  document.querySelectorAll("*").forEach(function (el) {
    var r = el.getBoundingClientRect();
    if (r.width > limite + 1 || r.right > limite + 1) {
      culpables.push(
        el.tagName.toLowerCase() +
        (el.className && typeof el.className === "string"
          ? "." + el.className.trim().split(/\\s+/).slice(0, 3).join(".")
          : "") +
        "  ancho=" + Math.round(r.width) +
        "  right=" + Math.round(r.right)
      );
    }
  });
  var pre = document.createElement("pre");
  pre.id = "informe";
  pre.textContent =
    "ventana=" + limite + "  body.scrollWidth=" + document.body.scrollWidth +
    "  desbordan=" + culpables.length + "\\n" +
    culpables.slice(0, 14).join("\\n");
  /* Estilo aparte para que se lea en la captura: si no, se pierde
     entre el fondo oscuro del panel. */
  pre.setAttribute(
    "style",
    "position:fixed;inset:0;z-index:9999;margin:0;padding:10px;" +
      "background:#fff;color:#000;font:11px monospace;white-space:pre-wrap;overflow:auto"
  );
  document.body.appendChild(pre);
});
</script>
`;

html = html.replace("</body>", sonda + "</body>");
fs.writeFileSync(destino, html, "utf8");
console.log("  sonda añadida a la captura");
