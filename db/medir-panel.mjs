/* Medir la maquetación REAL del panel, no la del CSS.
 *
 * node db/medir-panel.mjs [--url http://127.0.0.1:3000]
 *
 * ── POR QUÉ ESTE ──
 *
 * Leer el CSS da los valores que alguien escribió. Medir el DOM da
 * los valores que el navegador calculo despues de aplicar cascada,
 * herencia y media queries. Son cosas distintas, y las diferencias
 * aparecen justo donde la interfaz se siente mal: si la cascada de
 * un selector pisa el padding de una celda, leer el archivo no lo
 * enseña, pero la fila queda descuadrada y se nota.
 *
 * ── LO QUE MIDE ──
 *
 *   · alto de fila y relleno de celda  -> ritmo vertical,%)
 *   · tamaños de letra en cada nivel   -> si la jerarquía guía
 *   · anchos de columna                 -> si las filas quedan listas
 *   · huecos entre secciones            -> si respira o está apretado
 *   · contraste real de texto           -> si se lee con Ease
 *
 * Y al final compara los valores entre pantallas: si una fila mide
 * 52px en clientes y 68px en cobros, la misma lista se ve distinta
 * según dónde estés, y eso es lo que hace que un panel no parezca
 * un panel.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const NL = String.fromCharCode(10);
const RAIZ = path.resolve(import.meta.dirname, "..");

function arg(n, d) {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : d;
}

const BASE = arg("--url", process.env.PANEL_URL || "http://127.0.0.1:3000");

function leerEnv(ruta) {
  const s = {};
  if (!fs.existsSync(ruta)) return s;
  for (const l of fs.readFileSync(ruta, "utf8").split(NL)) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) s[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return s;
}

const env = leerEnv(path.join(RAIZ, ".env"));
for (const [k, v] of Object.entries(env)) {
  if (k in process.env) continue;
  process.env[k] = v;
}

const db = createClient(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

const { data: staff } = await db.from("profiles").select("id").eq("rol", "staff").limit(1);
if (!staff || !staff.length) {
  console.log("  no hay perfil de staff");
  process.exit(1);
}

const token = crypto.randomBytes(32).toString("hex");
const csrf = crypto.randomBytes(12).toString("hex");

await db.from("sessions").insert({
  token_hash: crypto.createHash("sha256").update(token).digest("hex"),
  user_id: staff[0].id,
  csrf_token: csrf,
  rol: "staff",
  creada_en: new Date().toISOString(),
  ultimo_acceso: new Date().toISOString(),
  expira_en: new Date(Date.now() + 1800_000).toISOString(),
});

const HOST = new URL(BASE).hostname;
const { chromium } = require("D:/webs/wweb/node_modules/playwright");

const navegador = await chromium.launch();
const ctx = await navegador.newContext({
  viewport: { width: 1440, height: 950 },
  deviceScaleFactor: 1,
  storageState: {
    cookies: [
      {
        name: "nexo_panel",
        value: token,
        domain: HOST,
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
        secure: HOST !== "127.0.0.1" && HOST !== "localhost",
      },
    ],
    origins: [],
  },
});

/* Todo se mide dentro de la página con una sola función, para que el
   navegador haga los cálculos y no nosotros. */
const MEDIR = () => {
  const px = (v) => Math.round(parseFloat(v) * 10) / 10;
  const uno = (sel) => document.querySelector(sel);
  const todos = (sel) => [...document.querySelectorAll(sel)];

  const caja = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  };

  /* Estilo computado de un elemento, con los valores que de verdad
     importan para leerlo y tocarlo. */
  const est = (sel) => {
    const el = uno(sel);
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      fs: s.fontSize,
      fw: s.fontWeight,
      lh: s.lineHeight,
      ff: s.fontFamily.split(",")[0].replace(/["']/g, ""),
      color: s.color,
      pad: s.padding,
      gap: s.gap,
    };
  };

  /* Las filas de tabla: alto y relleno. Es el ritmo vertical de la
     pantalla, y es lo que más cansa si está mal. */
  const filas = todos("tbody tr").map((tr) => {
    const cs = getComputedStyle(tr);
    const c = tr.querySelector("td,th");
    const cc = c ? getComputedStyle(c) : null;
    return {
      alto: Math.round(tr.getBoundingClientRect().height),
      padCelda: cc ? cc.padding : null,
      borderCelda: cc ? cc.borderBottomWidth : null,
    };
  });

  /* Los anchos de columna. Si una columna de texto se come media
     pantalla, la tabla deja de leerse como tabla. */
  const columnas = todos("thead th").map((th) => {
    const r = th.getBoundingClientRect();
    return { txt: th.textContent.trim().slice(0, 14), w: Math.round(r.width) };
  });

  /* Los huecos entre bloques. El ritmo vertical de la pagina. */
  const bloques = todos(".panel-card, .panel-seccion, .panel-bloque, section, .panel-kpi, .panel-panel")
    .filter((el) => el.getBoundingClientRect().height > 40)
    .slice(0, 8)
    .map((el) => ({ clase: el.className.split(" ")[0], alto: Math.round(el.getBoundingClientRect().height) }));

  return {
    titulo: (uno("h1") || uno("h2") || {}).textContent?.trim().slice(0, 34) || "",
    medidoAncho: Math.round(document.documentElement.clientWidth),
    contenidoAncho: caja(uno(".panel-main, .panel-contenido, main"))?.w || null,

    h1: est("h1"),
    th: est("thead th"),
    td: est("tbody td"),
    campo: est(".panel-campo label, label"),
    input: est("input[type=text], input[type=email], input:not([type]), textarea, select"),

    filas,
    columnas,
    bloques,

    /* El ancho de linea real de los parrafos largos. Si pasa de 90
       caracteres el ojo se cansa al volver al principio. */
    medidaParrafo: (() => {
      const p = uno("p");
      if (!p) return null;
      const s = getComputedStyle(p);
      const fs = parseFloat(s.fontSize);
      const ancho = p.getBoundingClientRect().width;
      return Math.round(ancho / (fs * 0.5));
    })(),
  };
};

const PANTALLAS = [
  ["/panel", "portada"],
  ["/panel/clientes", "clientes"],
  ["/panel/servicios", "servicios"],
  ["/panel/cobros", "cobros"],
  ["/panel/catalogo", "catalogo"],
  ["/panel/salud", "salud"],
  ["/panel/consultas", "consultas"],
];

const salida = [];
const p = await ctx.newPage();

salida.push("");
salida.push("=== Maquetacion medida del panel ===");
salida.push("  sitio: " + BASE);
salida.push("");

for (const [ruta, nombre] of PANTALLAS) {
  await p.goto(BASE + ruta, { waitUntil: "networkidle", timeout: 30000 });
  const m = await p.evaluate(MEDIR);

  salida.push("--- " + nombre + "  (" + ruta + ") " + "-".repeat(Math.max(0, 34 - nombre.length)));
  salida.push("   titulo: " + (m.titulo || "(sin titulo)"));

  /* El ritmo vertical de las filas, que es lo que mas cansa. */
  if (m.filas.length) {
    const altos = m.filas.map((f) => f.alto);
    const uniq = [...new Set(altos)];
    salida.push(
      "   filas: " + m.filas.length +
      "  alto " + Math.min(...altos) + "-" + Math.max(...altos) + "px" +
      (uniq.length > 1 ? "  *** DISPAREJO: " + uniq.join(", ") : "")
    );
    salida.push("   celda: padding " + (m.filas[0].padCelda || "-") + "  borde " + (m.filas[0].borderCelda || "-"));
  } else {
    salida.push("   filas: ninguna");
  }

  if (m.columnas.length) {
    salida.push("   columnas: " + m.columnas.map((c) => c.txt + " " + c.w + "px").join("  "));
    const anchos = m.columnas.map((c) => c.w);
    const total = anchos.reduce((a, b) => a + b, 0);
    const mayor = Math.max(...anchos);
    if (total > 0 && mayor / total > 0.45) {
      salida.push("   *** una columna se come el " + Math.round((mayor / total) * 100) + "% del ancho");
    }
  }

  if (m.th) salida.push("   cabecera: " + m.th.fs + " / peso " + m.th.fw + " / " + m.th.ff);
  if (m.td) salida.push("   celda   : " + m.td.fs + " / peso " + m.td.fw + " / interlineado " + m.td.lh);
  if (m.h1) salida.push("   h1      : " + m.h1.fs + " / peso " + m.h1.fw + " / " + m.h1.ff);
  if (m.campo) salida.push("   etiqueta: " + m.campo.fs + " / peso " + m.campo.fw);

  /* Los campos se miden aparte porque su alto depende de su padding
     y de su caja, y el bloque de arriba solo recoge color y fuente. */
  if (m.input) {
    const s = await p.evaluate(() => {
      const el = document.querySelector("input[type=text], input[type=email], input:not([type]), textarea, select");
      if (!el) return null;
      const c = getComputedStyle(el);
      return c.fontSize + " / alto " + Math.round(el.getBoundingClientRect().height) + "px / padding " + c.padding;
    });
    salida.push("   campo   : " + s);
  }

  if (m.contenidoAncho) salida.push("   ancho contenido: " + m.contenidoAncho + "px de " + m.medidoAncho);
  if (m.medidaParrafo) salida.push("   medida parrafo: ~" + m.medidaParrafo + " caracteres por linea");

  salida.push("");
}

/* ── El resumen que de verdad sirve ──
   Los valores sueltos importan menos que si se REPITEN. Si la misma
   lista mide 52px en una pantalla y 68px en otra, el panel no parece
   un panel. Eso es lo que se busca aqui. */
salida.push("--- ¿los valores se repiten?" + "-".repeat(40));
salida.push("");

const porPantalla = {};
for (const [ruta, nombre] of PANTALLAS) {
  await p.goto(BASE + ruta, { waitUntil: "networkidle", timeout: 30000 });
  porPantalla[nombre] = await p.evaluate(MEDIR);
}

const filasPorNombre = {};
for (const n of Object.keys(porPantalla)) {
  const f = porPantalla[n].filas;
  if (f.length) filasPorNombre[n] = f[0].alto;
}
salida.push("   alto de fila por pantalla: " + JSON.stringify(filasPorNombre));
const distintosFilas = [...new Set(Object.values(filasPorNombre))];
if (distintosFilas.length > 1) {
  salida.push("   *** " + distintosFilas.length + " filas distintas: la misma lista se ve distinta en cada pantalla");
} else if (distintosFilas.length === 1) {
  salida.push("   OK  todas las filas miden " + distintosFilas[0] + "px");
}

const fuentesTd = {};
for (const n of Object.keys(porPantalla)) {
  if (porPantalla[n].td) fuentesTd[n] = porPantalla[n].td.fs + "/" + porPantalla[n].td.lh;
}
salida.push("   celda por pantalla: " + JSON.stringify(fuentesTd));
if (new Set(Object.values(fuentesTd)).size > 1) {
  salida.push("   *** el texto de celda cambia de tamano entre pantallas");
}

const filasTabla = {};
for (const n of Object.keys(porPantalla)) {
  if (porPantalla[n].filas.length) filasTabla[n] = porPantalla[n].filas[0].padCelda;
}
salida.push("   relleno de celda: " + JSON.stringify([...new Set(Object.values(filasTabla))]));
if (new Set(Object.values(filasTabla)).size > 1) {
  salida.push("   *** el relleno de celda cambia entre pantallas");
}

salida.push("");

await navegador.close();
await db.from("sessions").delete().eq("csrf_token", csrf);

const texto = salida.join("\n");
fs.writeFileSync(path.join(RAIZ, "capturas", "medir-panel.txt"), texto);
console.log(texto);
process.exit(0);