require("../../lib/env").load();

const { createRequire } = require("module");
const req = createRequire("file:///D:/webs/empresa/db/ver-desborde.js");
const { chromium } = req("D:/webs/wweb/node_modules/playwright");
const { createClient } = require("@supabase/supabase-js");

/* ─────────────────────────────────────────────────────────
   LAS VARIABLES DEL ENTORNO

   `require("../../lib/env")` devuelve una función que hay que LLAMAR,
   y además otra cosa: `load()` deja lo que lee en `process.env`, que
   es de donde lo saca el resto del proyecto.

   La primera versión hacía `require("../../lib/env")()` y falló con «not
   a function»: lo que se exporta no es la función de leer, es lo que
   devuelve. Un archivo que exporta dos cosas y una de ellas es una
   función es una trampa; aquí se deja dicho para que el que vuelva a
   tocar esto no la pise.
   ───────────────────────────────────────────────────────── */
const env = process.env;

const BASE = process.env.TEST_PANEL || "http://127.0.0.1:3000";
const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

/* ─────────────────────────────────────────────────────────────
   TEXTO FUERA DE SU CAJA, EN TODO EL PANEL

   La primera versión miraba TRES rutas: la cartera, el alta y el
   catálogo. Dio cero, y la respuesta fue «arreglado». No lo estaba:
   el panel tiene treinta y cinco pantallas y solo se miraron tres.

   Y el fallo que había era de las que se ven a simple vista en móvil —
   el texto encima del de al lado— en una pantalla que no se miró.

   ── POR QUÉ `db/ver-css.js` NO LO DETECTA ──

   Porque pregunta si la PÁGINA desborda. Una celda de tabla puede
   tener el texto más ancho que su celda sin que la página desborde,
   porque la tabla vive dentro de un contenedor con scroll. Son dos
   preguntas distintas.

   ── LO QUE SE MIDE ──

   Para cada elemento con texto DIRECTO se compara `scrollWidth` con
   `clientWidth`. Si el contenido es más ancho que la caja, el texto se
   sale o se recorta.

   Los hijos de un contenedor con scroll NO se cuentan: ahí el
   desbordamiento es lo esperado, y mirar dentro solo da ruido.
   ───────────────────────────────────────────────────────────── */

const ANCHOS = [
  { nombre: "escritorio 1440", ancho: 1440 },
  { nombre: "portátil 1280", ancho: 1280 },
  { nombre: "tablet 900", ancho: 900 },
  { nombre: "móvil 390", ancho: 390 },
];

/** Las rutas fijas, sin id. */
const FIJAS = [
  "/panel",
  "/panel/accesos",
  "/panel/accesos/nuevo",
  "/panel/aplicaciones",
  "/panel/aplicaciones/catalogo",
  "/panel/aplicaciones/nuevo",
  "/panel/bots",
  "/panel/bots/nuevo",
  "/panel/catalogo",
  "/panel/clientes",
  "/panel/clientes/nuevo",
  "/panel/cobros",
  "/panel/cobros/generar",
  "/panel/cobros/nuevo",
  "/panel/consultas",
  "/panel/mi-cuenta",
  "/panel/planes",
  "/panel/salud",
  "/panel/servicios",
  "/panel/servicios/nuevo",
  "/panel/servidores",
  "/panel/servidores/nuevo",
  "/panel/tickets",
];

/** Las que necesitan un id real de la base. */
async function conId() {
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false },
  });

  const salida = {};

  const uno = async (tabla, etiqueta, sufijo) => {
    const { data } = await db.from(tabla).select("id").limit(1);
    if (data && data.length) salida[etiqueta] = tabla === "clients" ? "/panel/clientes/" + data[0].id : sufijo.replace(":id", data[0].id).replace(":moduleId", data[0].id);
  };

  await uno("clients", "cliente", "/panel/clientes/:id");
  await uno("services", "servicio", "/panel/servicios/:id/editar");
  await uno("tickets", "ticket", "/panel/tickets/:id");
  await uno("instances", "servidor", "/panel/servidores/:id/editar");

  return salida;
}

const MEDIR = () => {
  const nodos = document.evaluate(
    "//text()[normalize-space(.) != '']",
    document,
    null,
    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
    null
  );

  const salida = [];

  /* ─────────────────────────────────────────────────────
     EL TEXTO SE SALE DE SU CAJA — Y DE LA CAJA DE SU PADRE

     La primera versión solo miraba `scrollWidth > clientWidth` del
     propio elemento. Con eso se le escapó el caso de las tarjetas de
     dinero de `/panel/cobros`: el pie «4.336.800,00 € vencido · 1
     cobro» cabía de sobra en su propia caja de 95px —por eso no
     saltaba— pero esa caja estaba 67px más allá del borde de la
     tarjeta.

     Lo que se veía en pantalla era el texto encima del de al lado, y
     la comprobación decía cero.

     Ahora se miran las dos cosas: que el texto quepa en su elemento, Y
     que el elemento quepa dentro del padre. La segunda es la que
     encuentra los hijos de una fila que no caben.
     ───────────────────────────────────────────────────── */

  const sobraDeSuPadre = (el) => {
    const padre = el.parentElement;
    if (!padre) return 0;

    const c = getComputedStyle(padre);
    if (c.display === "none" || c.visibility === "hidden") return 0;

    /* Si el padre deja salir, no hay nada que avisar. */
    if (c.overflow !== "visible" || c.overflowX !== "visible" || c.overflowY !== "visible") {
      return 0;
    }

    /* Un padre en fila reparte el ancho entre sus hijos; si al hijo no
       le toca nada, no es que se salga, es que no hay sitio, y eso es
       un problema de la fila, no del hijo. */
    const cp = getComputedStyle(padre);
    if (cp.display === "flex" || cp.display === "inline-flex") {
      if (cp.flexWrap && cp.flexWrap !== "nowrap") return 0;
    }

    const rp = padre.getBoundingClientRect();
    const re = el.getBoundingClientRect();

    if (rp.width === 0 || re.width === 0) return 0;

    /* Cuánto se sale por la derecha o por la izquierda. */
    return Math.max(Math.round(re.right - rp.right), Math.round(rp.left - re.left));
  };

  for (let i = 0; i < nodos.snapshotLength; i++) {
    const nodo = nodos.snapshotItem(i);
    const padre = nodo.parentElement;
    if (!padre) continue;

    const c = getComputedStyle(padre);

    if (c.display === "none" || c.visibility === "hidden") continue;

    /* Lo que no se ve o se corta a propósito no es un fallo. */
    if (c.overflow === "hidden" || c.overflowX === "hidden") continue;
    if (c.overflowY === "hidden") continue;
    if (c.textOverflow === "ellipsis") continue;
    if (c.whiteSpace === "nowrap") continue;

    /* Si un ancestro tiene scroll, el desbordamiento es lo que se
       pidió. Mirar dentro solo da ruido. */
    let enScroll = false;
    for (let a = padre; a; a = a.parentElement) {
      const ca = getComputedStyle(a);
      if (ca.overflowX === "auto" || ca.overflowX === "scroll" || ca.overflow === "auto" || ca.overflow === "scroll") {
        enScroll = true;
        break;
      }
    }
    if (enScroll) continue;

    const sobra = padre.scrollWidth - padre.clientWidth;
    const fuera = sobraDeSuPadre(padre);

    if (sobra > 1 || fuera > 1) {
      salida.push({
        clase: padre.tagName.toLowerCase() + "." + (padre.className || "(sin clase)"),
        ancho: padre.clientWidth,
        necesita: padre.scrollWidth,
        sobra,
        fuera,
        texto: nodo.textContent.trim().replace(/\s+/g, " ").slice(0, 40),
      });
    }
  }

  return {
    salida,
    paginaDesborda: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
};

(async () => {
  if (!EMAIL || !PASSWORD) {
    console.log("\n  Faltan TEST_EMAIL y TEST_PASSWORD.\n");
    process.exit(1);
  }

  const ids = await conId();
  const rutas = FIJAS.concat(Object.values(ids));

  const navegador = await chromium.launch();

  console.log("\n═══ Texto fuera de su caja, en todo el panel ═══\n");
  console.log("  " + rutas.length + " pantallas x " + ANCHOS.length + " anchos\n");

  /* ─────────────────────────────────────────────────────────
     UNA SOLA PÁGINA, Y SOLO SE CAMBIA EL ANCHO

     La primera versión abría un contexto nuevo por pantalla y por
     ancho: veinticinco por cuatro, cien contextos. El servidor se
     caía a mitad de la ronda, sin dejar nada en el log.

     Con una página que se le cambia el viewport son veinticinco
     navegaciones, que es lo que hace un humano: abrir la pantalla y
     estrechar la ventana.

     Y las cookies se escriben una vez, con el contexto. Con cien
     contextos había que copiar la sesión a cada uno, y un forgetting
     de uno solo producía cuarenta líneas de «ERR_CONNECTION_REFUSED»
     que tapaban el fallo real.
     ───────────────────────────────────────────────────────── */
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 } });

  const login = await ctx.newPage();
  await login.goto(BASE + "/panel/login");
  await login.fill('input[name="email"]', EMAIL);
  await login.fill('input[name="password"]', PASSWORD);
  await login.click('button[type="submit"]');
  await login.waitForLoadState("domcontentloaded");

  const p = await ctx.newPage();

  let totalPantallas = 0;
  let totalFallos = 0;

  for (const ruta of rutas) {
    const linea = [];

    for (const v of ANCHOS) {
      let r = null;
      let d = { salida: [], paginaDesborda: false };

      try {
        await p.setViewportSize({ width: v.ancho, height: 900 });
        r = await p.goto(BASE + ruta, { waitUntil: "domcontentloaded", timeout: 25000 });
        await p.waitForTimeout(300);
        d = await p.evaluate(MEDIR);
      } catch (e) {
        linea.push({ v, error: e.message.split("\n")[0] });

        /* Si el servidor se fue, no tiene sentido seguir: todas las
           pantallas siguientes darían lo mismo y taparían el primer
           fallo con sesenta líneas de error de conexión. */
        if (/ECONNREFUSED|ECONNRESET|socket hang up/.test(e.message)) {
          console.log("");
          console.log("  × el servidor dejó de responder en " + ruta);
          console.log("    Se para aquí: las siguientes líneas serían todas error");
          console.log("    de conexión y taparían los fallos de maquetación.");
          console.log("    Mira logs/error.log y el stderr del servidor.");
          await navegador.close();
          process.exit(1);
        }

        continue;
      }

      linea.push({
        v,
        status: r ? r.status() : 0,
        n: d.salida.length,
        salida: d.salida,
        desborda: d.paginaDesborda,
      });
    }

    const malas = linea.filter((x) => x.n > 0);
    const errores = linea.filter((x) => x.error || (x.status && x.status >= 400));

    const hayAlgo = malas.length || errores.length;
    if (hayAlgo) totalPantallas++;

    console.log(
      "  " + (hayAlgo ? "FALLA" : "OK   ") + " " + ruta.padEnd(34) +
      linea.map((x) => {
        if (x.error) return "ERR";
        if (x.status >= 400) return "HTTP" + x.status;
        return String(x.n).padStart(2);
      }).join(" ")
    );

    if (errores.length) {
      for (const e of errores) {
        console.log("        ⚠ " + e.v.nombre + ": " + (e.error || "HTTP " + e.status));
      }
    }

    for (const m of malas) {
      for (const x of m.salida.slice(0, 3)) {
        console.log(
          "        " + m.v.nombre.padEnd(17) +
          x.clase.slice(0, 32).padEnd(32) +
          "caja " + String(x.ancho).padStart(4) +
          (x.sobra > 1 ? "  necesita " + String(x.necesita).padStart(4) : "            ") +
          (x.fuera > 1 ? "  FUERA de su padre " + String(x.fuera).padStart(3) + "px" : "") +
          "  «" + x.texto + "»"
        );
      }
      if (m.salida.length > 3) {
        console.log("        " + m.v.nombre.padEnd(17) + "… y " + (m.salida.length - 3) + " más");
      }
      totalFallos += m.salida.length;
    }
  }

  await ctx.close();
  await navegador.close();

  console.log("");
  console.log("  ──────────────────────────────────────────────");
  console.log("  pantallas con problema: " + totalPantallas + " de " + rutas.length);
  console.log("  textos fuera de caja:   " + totalFallos);
  console.log("");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});
