/* `import`, no `require`: este archivo usa `await` en el nivel
   superior, y Node no deja mezclar las dos formas. Con `require`
   dentro de un `.mjs` el error es «no se puede determinar el formato
   del módulo», que no señala que falte una línea de importa. */
import fs from "node:fs";
import path from "node:path";

/* ═══════════════════════════════════════════════════════════════
   LO QUE OCUPA Y LO QUE DEBERÍA OCUPAR

   ── POR QUÉ MEDIR Y NO OPINAR ──

   Porque «la tabla se ve muy ancha» es una impresión. Lo que hace
   falta saber es cuántos píxeles hay entre la última columna y el
   borde, y cuántas filas entran en una pantalla. Con esos números se
   decide el ancho de columna y el alto de fila, que es lo que cambia
   el aspecto.

   ── LO QUE SE MIDE ──

     el ancho de la tabla       y cuánto de ese ancho no lo ocupa nada
     el alto de fila            y cuántas filas caben en 950 px
     la tipografía              el tamaño real de lo que se lee
     los planos                 si las cuatro superficies se distinguen

   ── POR QUÉ EL NAVEGADOR Y NO EL CSS ──

   Porque el CSS dice cuántas reglas hay; el navegador dice cómo
   queda. El ancho de una columna depende de su contenido, y eso no
   está en ningún archivo: se calcula.
   ═══════════════════════════════════════════════════════════════ */

const RAIZ = "D:/webs/empresa";
const NL = String.fromCharCode(10);

/* Playwright es un paquete CommonJS, y un CommonJS no se importa con
   `import()`: hay que cargarlo con `require`. Como este archivo es un
   módulo ES y `require` no existe ahí, se usa `createRequire`, que
   devuelve un `require` que funciona.

   Probarlo con `import()` da dos errores por el camino —primero que
   Windows interpreta `D:/…` como el protocolo `d:`, después que los
   módulos ES no importan carpetas— y luego uno que no dice nada
   útil: `chromium` llega `undefined`, porque el paquete se cargó
   como un módulo CommonJS en lugar de como el que es. */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const RUTA_PLAYWRIGHT = "D:/webs/wweb/node_modules/playwright";
const { chromium } = require(RUTA_PLAYWRIGHT);

function leerEnv(ruta) {
  const s = {};
  if (!fs.existsSync(ruta)) return s;
  for (const l of fs.readFileSync(ruta, "utf8").split(NL)) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) {
      s[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
  return s;
}

const env = leerEnv(path.join(RAIZ, ".env"));
for (const [k, v] of Object.entries(env)) {
  if (k in process.env) continue;
  process.env[k] = v;
}

const URL_PANEL = process.argv.includes("--url")
  ? process.argv[process.argv.indexOf("--url") + 1]
  : "http://127.0.0.1:3000";

const RUTA = process.argv.includes("--ruta")
  ? process.argv[process.argv.indexOf("--ruta") + 1]
  : "/panel/clientes";

const navegador = await chromium.launch();
const pagina = await navegador.newPage({ viewport: { width: 1440, height: 950 } });

/* Sesión de staff, igual que en ver-panel.mjs. */
const { createClient } = require(path.join(RAIZ, "node_modules/@supabase/supabase-js"));
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

const { data: sesion, error } = await sb.auth.admin.generateLink({ type: "magiclink" });
if (error) {
  console.log("  no se pudo abrir sesión: " + error.message);
  process.exit(0);
}

const token = sesion.properties.hashed_token;
await pagina.goto(URL_PANEL + "/entrar?token=" + token, { waitUntil: "networkidle" });
await pagina.goto(URL_PANEL + RUTA, { waitUntil: "networkidle" });

/* ═══════════════════════════════════════════════════════════════
   LAS MEDIDAS
   ═══════════════════════════════════════════════════════════════ */

const m = await pagina.evaluate(() => {
  const caja = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return {
      w: Math.round(r.width),
      h: Math.round(r.height),
      x: Math.round(r.left),
      y: Math.round(r.top),
    };
  };

  /* Los fondos de cada zona, que es lo que hace que dos superficies
     se lean como distintas o como la misma. */
  const fondo = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    return getComputedStyle(e).backgroundColor;
  };

  const tabla = document.querySelector("table");
  const filas = tabla ? [...tabla.querySelectorAll("tbody tr")] : [];

  /* Qué tan llena está la tabla: dónde acaba la última celda con
     contenido, y cuánto queda hasta el borde. */
  const celdas = tabla ? [...tabla.querySelectorAll("thead th")] : [];

  return {
    ventana: { w: window.innerWidth, h: window.innerHeight },

    tabla: caja("table"),
    contenidoTabla: caja("table") ? caja("table").w : 0,
    filas: filas.length,
    altoFila: filas[0] ? Math.round(filas[0].getBoundingClientRect().height) : 0,
    filasEnPantalla: filas[0]
      ? Math.floor(
          (window.innerHeight - filas[0].getBoundingClientRect().top) /
            filas[0].getBoundingClientRect().height
        )
      : 0,

    columnas: celdas.map((c) => ({
      texto: c.textContent.trim().slice(0, 14),
      w: Math.round(c.getBoundingClientRect().width),
    })),

    /* La última columna con contenido, y el hueco que queda. */
    huecoDerecha: celdas.length
      ? Math.round(
          tabla.getBoundingClientRect().right -
            celdas[celdas.length - 1].getBoundingClientRect().right
        )
      : 0,

    cuerpos: {
      pagina: fondo("html[data-panel]"),
      lateral: fondo(".panel-sidebar, .panel-nav"),
      tabla: fondo("table"),
      cabeceraTabla: fondo("thead tr, thead th"),
      tarjeta: fondo(".panel-card"),
      stat: fondo(".panel-stat"),
      campo: fondo("input[type=text]"),
    },

    tipografia: {
      cuerpo: getComputedStyle(document.body).fontSize,
      tabla: tabla ? getComputedStyle(tabla).fontSize : null,
      titulo: document.querySelector("h1")
        ? getComputedStyle(document.querySelector("h1")).fontSize
        : null,
    },
  };
});

/* ═══════════════════════════════════════════════════════════════
   DECIRLO EN CASTELLANO
   ═══════════════════════════════════════════════════════════════ */

console.log("\n═══ La tabla de clientes ═══\n");

console.log("  ventana:        " + m.ventana.w + " × " + m.ventana.h);
console.log("  tabla:          " + m.tabla.w + " px de ancho");
console.log("  filas:          " + m.filas + "  ·  " + m.altoFila + " px cada una");
console.log("  caben en pantalla: " + m.filasEnPantalla + " filas");
console.log("  hueco a la derecha: " + m.huecoDerecha + " px\n");

console.log("  ── las columnas ──");
for (const c of m.columnas) {
  console.log("    " + c.texto.padEnd(16) + String(c.w).padStart(5) + " px");
}
const ancho = m.columnas.reduce((s, c) => s + c.w, 0);
console.log("    " + "SUMAN".padEnd(16) + String(ancho).padStart(5) + " px");
console.log("    " + "VACÍO".padEnd(16) + String(m.tabla.w - ancho).padStart(5) + " px");
console.log("");

console.log("  ── los planos, que es lo que no se distingue ──\n");
for (const [k, v] of Object.entries(m.cuerpos)) {
  console.log("    " + k.padEnd(16) + (v || "(nada)"));
}
console.log("");

console.log("  ── la tipografía ──\n");
for (const [k, v] of Object.entries(m.tipografia)) {
  console.log("    " + k.padEnd(16) + (v || "(nada)"));
}
console.log("");

await navegador.close();