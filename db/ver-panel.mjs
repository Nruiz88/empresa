/* Ver el panel de verdad, con un Chromium de verdad.
 *
 * node db/ver-panel.mjs [--url http://127.0.0.1:3000] [--salida capturas]
 *
 * ── PARA QUÉ ESTE ──
 *
 * No se puede rediseñar algo que no se ha mirado. Y mirarlo leyendo
 * el CSS no sirve: el CSS dice qué reglas hay, no cómo queda.
 *
 * La primera versión de este trabajo cambió tokens de color y el orden
 * de las fuentes. Son correcciones reales, pero NO se ven: solo se
 * notan al cambiar de tema. Y el resultado fue que quien lo pidió dijo
 * que no veía nada, con razón.
 *
 * Así que antes de tocar un solo píxel: captura, mirar, y a partir de
 * ahí decidir.
 *
 * Captura las pantallas del EQUIPO, que es donde hace falta el rediseño:
 * la portada es la que se mira todos los días.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(import.meta.dirname, "..");
const NL = String.fromCharCode(10);

function arg(n, d) {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : d;
}

const PANEL = arg("--url", process.env.PANEL_URL || "http://127.0.0.1:3000");
const SALIDA = path.resolve(RAIZ, arg("--salida", "capturas"));
const TEMA = arg("--tema", "");

/* El ancho de la ventana. A 390 px es un movil y las capturas teachen
 * cosas que a 1440 no se ven: si la tabla cabe, si la barra lateral
 * se esconde, si un boton se sale. */
const ANCHO = Number(arg("--ancho", "1440"));
const ALTO = Number(arg("--alto", ANCHO < 700 ? "844" : "950"));

/* Playwright vive en el proyecto del bot. */
const RUTA_PLAYWRIGHT = "D:/webs/wweb/node_modules/playwright";

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

const { createClient } = await import("@supabase/supabase-js");
const db = createClient(
  env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } }
);

/* Sesión de staff, como la que hace login el panel. */
const { data: staff } = await db.from("profiles").select("id,nombre").eq("rol", "staff").limit(1);
if (!staff || !staff.length) {
  console.log("  no hay perfil de staff");
  process.exit(1);
}

const csrf = crypto.randomBytes(12).toString("hex");
const token = crypto.randomBytes(32).toString("hex");
const hash = crypto.createHash("sha256").update(token).digest("hex");

await db.from("sessions").insert({
  token_hash: hash,
  user_id: staff[0].id,
  csrf_token: csrf,
  rol: "staff",
  creada_en: new Date().toISOString(),
  ultimo_acceso: new Date().toISOString(),
  expira_en: new Date(Date.now() + 1800_000).toISOString(),
});

fs.mkdirSync(SALIDA, { recursive: true });

/* Las pantallas del equipo. La primera es la que se mira a diario. */
const PANTALLAS = [
  ["portada", "/panel"],
  ["clientes", "/panel/clientes"],
  ["servicios", "/panel/servicios"],
  ["cobros", "/panel/cobros"],
  ["salud", "/panel/salud"],
];

let chromium;
try {
  ({ chromium } = require(RUTA_PLAYWRIGHT));
} catch {
  console.log("  no se encuentra playwright en " + RUTA_PLAYWRIGHT);
  process.exit(1);
}

/* El dominio de la cookie sale de la URL que se está mirando.
 *
 * Con la cookie puesta a pelo en "127.0.0.1" y navegando por
 * empresa.panel-niconqn.duckdns.org, el navegador la ignoraba: se veía
 * el LOGIN y todas las rutas contestaban 200, porque lo que responde
 * es la redirección al login. Las cinco capturas salieron del login y
 * seemed correctas: mismo código, misma captura.
 *
 * Por eso además se comprueba que la página que sale sea la que se
 * pidió, y no la que redirigió. Un 200 no dice que sesa la pantalla
 * correcta. */
const HOST = new URL(PANEL).hostname;

const navegador = await chromium.launch();
const ctx = await navegador.newContext({
  viewport: { width: ANCHO, height: ALTO },
  deviceScaleFactor: ANCHO < 700 ? 2 : 2,
  isMobile: ANCHO < 700,
  hasTouch: ANCHO < 700,
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
  /* El tema se guarda en localStorage, no en el HTML. Y el panel, que
     no carga main.js, no lo lee nunca: asi que aparte de guardar la
     preferencia hay que forzar la clase en el <html>. Por eso los dos. */
  await ctx.addInitScript(
    (t) => {
      try {
        localStorage.setItem("nexo-theme", t);
      } catch {}
      document.addEventListener("DOMContentLoaded", () => {
        document.documentElement.className = t === "dark" ? "" : "theme-" + t;
      });
    },
    TEMA
  );
}

const pagina = await ctx.newPage();

console.log("");
console.log("=== Capturas del panel ===");
console.log("");
console.log("  panel:  " + PANEL);
console.log("  ancho:  " + ANCHO + " x " + ALTO + (ANCHO < 700 ? "  (movil)" : ""));
if (TEMA) console.log("  tema:   " + TEMA);
console.log("");

for (const [nombre, ruta] of PANTALLAS) {
  /* El tema va en el nombre del fichero. Sin esto, capturar claro y
 * color seguidas deja un solo PNG: la segunda pasada pisa a la
 * primera y no hay forma de comparar sin volver a capturar. */
const sufijo = (ANCHO < 700 ? "-movil" : "") + (TEMA ? "-" + TEMA : "");

const destino = path.join(SALIDA, `panel-${nombre}${sufijo}.png`);

  try {
    const r = await pagina.goto(PANEL + ruta, { waitUntil: "networkidle", timeout: 20000 });
    await pagina.waitForTimeout(600);

    const html = await pagina.content();
    const urlFinal = pagina.url();

    /* Si acabó en el login, lo que se capturó es el login. Hay que
     * decirlo, no guardar cinco capturas iguales del login creyendo
     * que son el panel. */
    const esLogin = /\/panel\/login/.test(urlFinal) || /Acceso al panel/.test(html);

    await pagina.screenshot({ path: destino, fullPage: true });

    const marca = esLogin ? "  !! ES EL LOGIN" : "";
    console.log(
      "  " + String(r.status()).padEnd(4) + ruta.padEnd(22) + "-> " + path.basename(destino) + marca
    );

    if (esLogin) {
      console.log("        (la sesion no se acepto: " + urlFinal.replace(PANEL, "") + ")");
    }
  } catch (e) {
    console.log("  ERR  " + ruta.padEnd(22) + "-> " + e.message.slice(0, 60));
  }
}

await navegador.close();
await db.from("sessions").delete().eq("csrf_token", csrf);

console.log("");
console.log("  en " + SALIDA);
console.log("");