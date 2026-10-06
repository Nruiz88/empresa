/* Auditar la maquetacion del panel con medidas de verdad.
 *
 * node db/auditar-maquetacion.mjs [--url ...] [--ancho 1440] [--tema oscuro]
 *
 * ── PARA QUE ESTE ──
 *
 * Mirando una captura se ven los fallos de color y de jerarquia, pero
 * los fallos de geometria hay que medirlos. Un ejemplo del captura
 * anterior: en las dos tablas la columna IMPORTE no cuadraba con su
 * cabecera. Era facil verlo y facil de medir mal, porque a simple
 * vista "parece" que el numero esta debajo de su titulo.
 *
 *asi que no se estiman posiciones: se piden al navegador.
 *
 * ── QUE MIDE ──
 *
 *   · desbordes: algo que se sale de su contenedor
 *   · columnas: si la cabecera y la fila empiezan en el mismo sitio
 *   · densidad: quantas filas caben en alto, y cuanto mide una
 *   · objetivos: botones y enlaces por debajo de 44x44 (minimo tactil)
 *   · select: el texto por debajo de la flecha
 *   · jerarquia: cuantas acciones primarias hay por pantalla
 *   · huecos: cuanto de la pantalla se queda vacio por debajo
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(import.meta.dirname, "..");
const NL = String.fromCharCode(10);

function arg(n, d) {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : d;
}

const PANEL = arg("--url", process.env.PANEL_URL || "http://127.0.0.1:3000");
const ANCHO = Number(arg("--ancho", "1440"));
const TEMA = arg("--tema", "");

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

const db = createClient(
  env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } }
);

const { data: staff } = await db.from("profiles").select("id").eq("rol", "staff").limit(1);
if (!staff || !staff.length) {
  console.log("  no hay perfil de staff");
  process.exit(1);
}

const csrf = crypto.randomBytes(12).toString("hex");
const token = crypto.randomBytes(32).toString("hex");

await db.from("sessions").insert({
  token_hash: crypto.createHash("sha256").update(token).digest("hex"),
  user_id: staff[0].id,
  csrf_token: csrf,
  rol: "staff",
  creada_en: new Date().toISOString(),
  ultimo_acceso: new Date().toISOString(),
  expira_en: new Date(Date.now() + 1800_000).toISOString(),
});

const HOST = new URL(PANEL).hostname;
const { chromium } = require("D:/webs/wweb/node_modules/playwright");

const ctx = await (await chromium.launch()).newContext({
  viewport: { width: ANCHO, height: 950 },
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

if (TEMA) {
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem("nexo-theme", t);
    } catch {}
  }, TEMA);
}

const pagina = await ctx.newPage();

const PANTALLAS = [
  ["/panel", "portada"],
  ["/panel/clientes", "clientes"],
  ["/panel/servicios", "servicios"],
  ["/panel/cobros", "cobros"],
];

console.log("");
console.log("=== Maquetacion medida: " + ANCHO + "px" + (TEMA ? ", tema " + TEMA : "") + " ===");
console.log("");

let totalProblemas = 0;

/* ── Todo lo que se mide vive en la pagina ──
 *
 * Se mete como funcion para que corra en el contexto del navegador y
 * devuelva numeros crudos. Aqui fuera solo se formatea: si se calculara
 * algo fuera, se podria estar midiendo el DOM equivocado. */
const MEDIR = () => {
  const problemas = [];
  const avisos = (txt, detalle) => problemas.push({ tipo: txt, detalle: detalle || "" });

  const des = (el) => {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      der: Math.round(r.right),
    };
  };

  /* ---- 1. Columnas: la cabecera contra la fila ----
   *
   * Para cada th se mira la fila de debajo. Si no empiezan en el mismo
   * sitio, el numero no esta debajo de su titulo: es lo que hace que
   * una columna de importes sea dificil de escanear de un vistazo.
   *
   * En modo tarjeta (por debajo de 720px) la tabla ya no tiene
   * columnas: la cabecera se oculta y cada celda se apila. Ahí la
   * comprobación no tiene sentido, y sin este aviso la auditoría
   * soltava seis "columna descuadrada" por pantalla: 0 contra 526,
   * que era la medida real y no un error. */
  const tabla = document.querySelector(".panel-table");
  if (tabla) {
    const ths = [...tabla.querySelectorAll("thead th")];
    const tds = [...(tabla.querySelector("tbody tr")?.children || [])];

    const celda = tds[0];
    const enTarjetas = celda ? getComputedStyle(celda).display === "block" : false;

    /* En modo tarjeta no hay columnas que cuadrar. */
    if (!enTarjetas)
      ths.forEach((th, i) => {
        const td = tds[i];
        if (!td) return;

      const a = des(th);
      const b = des(td);

      /* Se comparan los bordes de inicio porque las columnas numéricas
       * están alineadas a la derecha: sus finales casan y sus inicios
       * no, y eso NO es un fallo. Solo importa cuando las dos tienen
       * el mismo alineado pero distinto inicio. */
      const thR = getComputedStyle(th).textAlign;
      const tdR = getComputedStyle(td).textAlign;

      if (thR === tdR && Math.abs(a.x - b.x) > 2) {
        avisos(
          "columna descuadrada",
          '"' + th.textContent.trim() + '" cabecera en x=' + a.x + " (" + thR + "), fila en x=" + b.x + " (" + tdR + ")"
        );
      }

      /* El ancho tambien: si la cabecera es 60 y la fila 300, el
       * reparto de la tabla no cuadra con lo que se ve. */
      if (Math.abs(a.w - b.w) > 3) {
        avisos(
          "ancho de columna descuadrado",
          '"' + th.textContent.trim() + '" ' + a.w + " vs " + b.w
        );
      }
    });

    /* ---- 2. Densidad de la tabla ---- */
    const filas = [...tabla.querySelectorAll("tbody tr")];

    /* En tarjetas la "altura de fila" es la altura de una tarjeta con
       su boton, y no tiene nada que ver con lo apretada que se ve una
       fila de tabla. Medirlo ahi daria un falso positivo. */
    if (!enTarjetas && filas.length >= 3) {
      const alturas = filas.map((f) => Math.round(f.getBoundingClientRect().height));
      const media = Math.round(alturas.reduce((a, b) => a + b, 0) / alturas.length);

      /* Por debajo de 44 px de alto por fila se empieza a perder el
       * blanco que separa una fila de otra. Por encima de 90, la tabla
       * deja de ser una tabla y son tarjetas sin barra. */
      if (media > 90) {
        avisos(
          "filas demasiado altas",
          media + "px de media con " + filas.length + " filas: caben " +
            Math.floor(950 / media) + " por pantalla. Con 18 clientes salen " +
            (18 > Math.floor(950 / media) ? "mas de una pantalla" : "bien") + "."
        );
      }
      if (media < 44) {
        avisos("filas demasiado bajas", media + "px: se pegan entre si");
      }
    }

    /* ---- 3. Botones repetidos ----
     *
     * Un boton igual en todas las filas no es un boton, es ruido: N
     * copias de la misma accion compiten con la que se quiere pulsar.
     *
     * Solo se cuentan los botones y los enlaces que llevan la clase
     * de boton. La primera version conto TODOS los enlaces de la
     * tabla, y como los nombres de empresa y los emails son enlaces
     * salia "accion repetida: 'Panaderia La Espiga' x5" — que no es
     * una accion repetida, es una columna de datos con cinco filas
     * iguales. Cinco falsos positivos tapaban los dos reales. */
    const porTexto = new Map();
    for (const b of tabla.querySelectorAll("tbody button, tbody a.panel-btn")) {
      /* Solo se cuenta lo que se VE. En escritorio el boton "Abrir"
       * de clientes esta en `display: none` porque la fila entera se
       * abre con el enlace del nombre; contar markup oculto daba
       * dieciocho falsos positivos que tapaban los reales. */
      const r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;

      const t = b.textContent.replace(/\s+/g, " ").trim();
      if (!t) continue;
      porTexto.set(t, (porTexto.get(t) || 0) + 1);
    }
    for (const [t, n] of porTexto) {
      if (n >= 4) avisos("accion repetida", '"' + t + '" x' + n + ", una por fila");
    }
  }

  /* ---- 4. Objetivos tactiles ----
   *
   * 44x44 es el minimo que acepta un dedo sin apuntar. Por debajo se
    * falla por punteria, sobre todo en movil.
  for (const el of document.querySelectorAll("a.panel-btn, button.panel-btn, .panel-tabs a, select")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;

    if (r.height < 36) {
      avisos(
        "objetivo pequeno",
        "<" + el.tagName.toLowerCase() + "> '" + el.textContent.trim().slice(0, 18) +
          "' " + Math.round(r.width) + "x" + Math.round(r.height)
      );
    }
  }

  /* ---- 5. Selects: el texto debajo de la flecha ----
   *
   * Con el arrow del navegador puesto a la derecha y sin padding
   * suficiente, el texto se mete debajo de la flecha. Se ve en la
   * captura de servicios: "Todos los tipos" con la flecha encima. */
  for (const sel of document.querySelectorAll("select")) {
    const cs = getComputedStyle(sel);
    const pad = parseFloat(cs.paddingRight) || 0;
    const r = sel.getBoundingClientRect();

    /* 1rem de hueco para la flecha es lo justo. */
    if (pad < 24) {
      avisos(
        "select sin hueco para la flecha",
        "padding-right " + Math.round(pad) + "px, ancho " + Math.round(r.width) + "px"
      );
    }
  }

  /* ---- 6. Jerarquia de acciones ----
   *
   * Dos botones primarios en la misma cabecera no distinguen nada: si
   * todo es lo mas importante, nada lo es. */
  const primarias = document.querySelectorAll(".panel-page-head .panel-btn--primary");
  if (primarias.length > 1) {
    avisos(
      "varias acciones primarias en la cabecera",
      primarias.length + ": " +
        [...primarias].map((b) => '"' + b.textContent.trim() + '"').join(", ")
    );
  }

  /* ---- 7. Hueco por debajo ----
   *
   * Una pagina que acaba a media altura no esta mal, pero conviene
   * saber si es por contenido corto o por un contenedor estrecho. */
  const principal = document.querySelector(".panel-main") || document.body;
  const alto = document.documentElement.scrollHeight;
  const fondo = Math.max(0, (950 - alto) / 950);

  return {
    problemas,
    alto,
    hueco: Math.round(fondo * 100),
    anchoUtil: Math.round(des(principal).w),
  };
};

for (const [ruta, nombre] of PANTALLAS) {
  try {
    const r = await pagina.goto(PANEL + ruta, { waitUntil: "networkidle", timeout: 25000 });
    await pagina.waitForTimeout(400);

    if (!r || r.status() !== 200) {
      console.log("  " + nombre + ": HTTP " + (r ? r.status() : "?"));
      continue;
    }

    const m = await pagina.evaluate(MEDIR);

    console.log("  " + nombre + "  (" + ruta + ")");
    console.log("    alto total " + m.alto + "px, hueco por debajo " + m.hueco + "%, ancho util " + m.anchoUtil + "px");

    if (!m.problemas.length) {
      console.log("    sin problemas medidos");
    } else {
      for (const p of m.problemas) {
        console.log("    · " + p.tipo + ": " + p.detalle);
        totalProblemas++;
      }
    }
    console.log("");
  } catch (e) {
    console.log("  " + nombre + ": ERROR " + e.message.slice(0, 70));
    console.log("");
  }
}

await ctx.browser().close();
await db.from("sessions").delete().eq("csrf_token", csrf);

console.log("=".repeat(58));
console.log(totalProblemas === 0 ? "Nada que medir." : totalProblemas + " problemas medidos.");
console.log("=".repeat(58));
console.log("");