const fs = require("fs");
const path = require("path");

/* ═══════════════════════════════════════════════════════════════
   NORMALIZAR LA RAÍZ DEL PROYECTO, POR PROFUNDIDAD REAL

   ── POR QUÉ HACE FALTA ──

   Los dos pases anteriores (rutas sueltas y constantes `RAIZ`) se
   aplicaron uno encima del otro, y algunos archivos recibieron el
   nivel de más. `check.js` acabó con tres `..` en lugar de dos, que
   desde `db/herramientas/` apunta a `D:\webs`, un nivel por encima
   del proyecto.

   ── POR QUÉ AHORA ES robustO Y NO PARCHE ──

   Porque el número de niveles no se cuenta a mano: se lee de la
   carpeta donde está el archivo. Un archivo en `db/herramientas/`
   necesita dos niveles, uno en `db/` necesita uno, y uno en
   `db/a/b/` necesita tres. No hay forma de equivocarse salvo mover
   el archivo a otra carpeta, y entonces esto lo vuelve a arreglar.

   ── LO QUE TOCA ──

   Solo la lista que sube de `__dirname` al proyecto. Se reescribe
   entera al número correcto, haya 1 o los que haya, en vez de
   añadir uno.
   ═══════════════════════════════════════════════════════════════ */

const DB = "D:/webs/empresa/db";

/* Se recorren las subcarpetas y la raíz, y para cada archivo se
   calcula su profundidad real contando las carpetas de su ruta
   completa desde el proyecto. */
function profundidad(relativoCarpeta) {
  return relativoCarpeta.split("/").filter(Boolean).length + 1;
}

const SUBCARPETAS = ["", "herramientas", "diagnostico", "puntual"];

const tocados = [];
const muestras = [];

for (const sub of SUBCARPETAS) {
  const dir = path.join(DB, sub);
  if (!fs.existsSync(dir)) continue;

  const sube = Array(profundidad(sub)).fill("..").join('", "');

  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".js") && !f.endsWith(".mjs")) continue;

    const ruta = path.join(dir, f);
    const antes = fs.readFileSync(ruta, "utf8");

    /* Cualquier cantidad de `..` seguidos, dentro de la llamada a
       `path.resolve` o `path.join` que arranca en `__dirname`.

       El grupo captura el resto de la llamada para reescribir solo
       la parte de la ruta y no el argumento que viene detrás. */
    const re = /(path\.(?:resolve|join)\(__dirname,\s*)((?:"\.\.",?\s*)+)/g;

    const despues = antes.replace(re, (m, pre, niveles) => {
      /* Los niveles que sobran o faltan se ajustan al que toca. */
      return pre + '"' + sube + '"';
    });

    if (despues !== antes) {
      fs.writeFileSync(ruta, despues, "utf8");
      tocados.push((sub ? sub + "/" : "") + f);
      if (muestras.length < 10) {
        muestras.push((sub ? sub + "/" : "") + f + "  →  " + sube);
      }
    }
  }
}

console.log("\n═══ La raíz, normalizada ═══\n");
console.log("  scripts tocados: " + tocados.length + "\n");
for (const m of muestras) console.log("  " + m);
console.log("");