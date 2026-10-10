const fs = require("fs");
const path = require("path");

/* ═══════════════════════════════════════════════════════════════
   EL ORDEN DE CARGA DE LOS MÓDULOS DEL PANEL

   ── POR QUÉ UN ARCHIVO PARA ESTO ──

   El orden de las hojas lo decide el manifiesto, y hay que leerlo
   en un solo sitio. Escrito en el parcial, el orden queda en un
   `<% for %>` dentro del HTML, que es donde alguien lo movería sin
   querer pensando que solo está ordenando unas etiquetas.

   Y hay un segundo motivo: leer un JSON en cada render son 12
   lecturas de disco por página, y el panel se abre muchas veces.
   Se lee una vez y se guarda en memoria.

   ── SI FALTA EL MANIFIESTO ──

   Se avisa y se carga un solo archivo, que es lo que había antes de
   dividir. No se lanza una excepción: un error de configuración del
   CSS no puede dejar el panel sin pantalla, porque el CSS es lo
   único que impide que se vea, pero el contenido sigue ahí y es
   perfectamente usable sin estilo.
   ═══════════════════════════════════════════════════════════════ */

const RUTA = path.join(__dirname, "..", "public", "css", "panel.orden.json");

let cache = null;

function modulosDelPanel() {
  if (cache) return cache;

  try {
    const orden = JSON.parse(fs.readFileSync(RUTA, "utf8"));

    /* ── QUE EXISTAN TODOS ──

       Un manifiesto que nombra una hoja que no está deja la pantalla
       sin esa parte del estilo, y no hay ningún error: el resto de
       las hojas cargan bien y la pantalla se ve a medio camino.

       Se comprueba aquí, una vez, para que el error se vea al
       arrancar y no en producción con un usuario delante. */
    const faltan = orden.filter((n) => !fs.existsSync(path.join(RUTA, "..", n)));

    if (faltan.length) {
      console.error(
        "[panel] el manifiesto nombra " + faltan.length + " hoja(s) que no existen: " + faltan.join(", ")
      );
      return (cache = ["panel.css"]);
    }

    return (cache = orden);
  } catch (err) {
    console.error("[panel] no se pudo leer panel.orden.json: " + err.message);
    return (cache = ["panel.css"]);
  }
}

module.exports = modulosDelPanel;