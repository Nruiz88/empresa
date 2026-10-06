/* La paleta de comandos (Ctrl+K) y los contadores del lateral.
 *
 * node db/probar-paleta.mjs [--url http://127.0.0.1:3000]
 *
 * ── POR QUÉ ESTE ──
 *
 * La paleta es la primera cosa del panel que depende de una tecla, y
 * eso no se comprueba con `curl`: hace falta un teclado de verdad.
 *
 * Con ATENCIÓN a lo que no falla por verse:
 *
 *   · Con Ctrl+K se abre, y con Escape se cierra
 *   · Con dos letras busca DE VERDAD, no pinta un marco vacío
 *   · Con las flechas se mueve la marca y con Enter se abre lo marcado
 *   · La opción marcada es la que se ve marcada, para el ojo y para el
 *     lector de pantalla a la vez
 *   · Un cliente NO puede usar el buscador: la ruta es del equipo
 *
 * Y una comprobación de teclado que suele olvidarse: si el elemento
 * marcado se sale de la lista visible, con Enter se abre algo que no
 * se ve. Aquí hay más resultados que visibles a propósito.
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

let ok = 0;
let fallos = 0;
const comprobar = (txt, cond, extra) => {
  console.log("  " + (cond ? "OK   " : "FALLA") + "  " + txt + (extra ? "  " + extra : ""));
  if (cond) ok++;
  else fallos++;
};

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

const HOST = new URL(BASE).hostname;
const { chromium } = require("D:/webs/wweb/node_modules/playwright");

const navegador = await chromium.launch();
const ctx = await navegador.newContext({
  viewport: { width: 1440, height: 950 },
  storageState: {
    cookies: [
      { name: "nexo_panel", value: token, domain: HOST, path: "/", httpOnly: true, sameSite: "Lax",
        secure: HOST !== "127.0.0.1" && HOST !== "localhost" },
    ],
    origins: [],
  },
});

const pagina = await ctx.newPage();

console.log("");
console.log("=== Paleta de comandos y contadores ===");
console.log("");
console.log("  sitio: " + BASE);
console.log("");

const errores = [];
pagina.on("pageerror", (e) => errores.push(String(e.message).slice(0, 90)));

await pagina.goto(BASE + "/panel", { waitUntil: "networkidle", timeout: 25000 });

/* ── Esperar a que la lista se ASIENTE ──
   No a dormir un tiempo fijo.

   La paleta pide al servidor, con un retardo de 180 ms antes de
   salir. Esperar 700 ms funcionaba casi siempre y fallaba cuando la
   red iba peor: la comprobación se hacía antes de que llegara la
   respuesta y daba rojo sin que hubiera pasado nada.

   Un fallo que depende de la velocidad de la red no es una prueba,
   es una prueba que sale verde o roja según el día. */
async function asentar(selector, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await pagina.$(selector)) return true;
    await pagina.waitForTimeout(80);
  }
  return false;
}

/* ── 1. El botón está, y con el atajo correcto ── */
const boton = await pagina.$(".panel-buscar");

comprobar("el botón de buscar está en la barra", !!boton);

if (boton) {
  const texto = await boton.textContent();
  comprobar("enseña el atajo", /Ctrl K|⌘ K/.test(texto), texto.trim());
}

/* ── 2. Ctrl+K abre ── */
await pagina.keyboard.press("Control+k");
await pagina.waitForTimeout(250);

comprobar("Ctrl+K abre la paleta", await pagina.isVisible(".cmd-capa"));
comprobar("el foco entra en el campo", await pagina.evaluate(() =>
  document.activeElement && document.activeElement.classList.contains("cmd-input")));

/* ── 3. Vacía muestra las secciones ── */
const seccionesVacias = await pagina.$$eval(".cmd-item", (n) => n.length);

comprobar("sin escribir ya muestra destinos", seccionesVacias > 5, seccionesVacias + " opciones");

/* ── 4. Filtrar ── */
await pagina.fill(".cmd-input", "cob");
await pagina.waitForTimeout(350);

const filtrado = await pagina.$$eval(".cmd-item-titulo", (n) => n.map((x) => x.textContent.trim()));

comprobar(
  "escribir filtra",
  filtrado.length > 0 && filtrado.some((t) => /cobro/i.test(t)),
  filtrado.slice(0, 3).join(" | ")
);

/* ── 5. Con dos letras busca de verdad ──
   Con tres letras ("pan") encuentra clientes reales, que es lo que
   separa una paleta que funciona de una que solo filtra un menú. */
await pagina.fill(".cmd-input", "pan");

const llegaron = await asentar(".cmd-grupo");

const conResultados = await pagina.$$eval(".cmd-grupo", (n) => n.map((x) => x.textContent.trim()));

comprobar(
  "con dos letras busca en la base y no solo en el menú",
  llegaron && conResultados.length > 0,
  llegaron ? conResultados.join(" | ") : "no llegó nada en 4 s"
);

/* ── 6. Flechas y Enter ──

   El foco se pone a mano antes de las teclas.

   No es un detalle: `fill()` enfoca el campo, pero entre el relleno y
   la pulsación hay varias esperas, y si algo lo quita del foco las
   teclas van al `<body>` y no pasan por el manejador. Entonces
   ArrowDown no movería nada —y el test lo daba por bueno
   igualmente—, porque "no se movió" y "no había nada marcado" se
   parecen desde fuera.

   Focusing a mano convierte esa duda en una respuesta: si aun así no
   navega, el problema es de la aplicación; si navega, era la prueba. */
await pagina.focus(".cmd-input");
await pagina.keyboard.press("ArrowDown");
await pagina.waitForTimeout(150);

const marcada1 = await pagina.getAttribute(".cmd-item.es-marcada", "aria-selected");

comprobar("la flecha mueve la marca", marcada1 === "true");

/* Lo que va a abrir Enter, según el DOM. Se lee JUSTO antes de
   pulsar, porque el marcado lo decide el navegador y no el código. */
const urlMarcada = await pagina.getAttribute(".cmd-item.es-marcada", "href");

await pagina.keyboard.press("Enter");

/* Y aquí se ESPERA a la navegación, no se supone que ya ha pasado.

   Con `waitForTimeout(600)` y leyendo la URL a continuación, la
   prueba leía la anterior y daba rojo: la navegación no había
   terminado. Es el mismo descuido que se corrigió antes al esperar
   los resultados de la búsqueda, reintroducido al comprobar la
   navegación —y por eso el fallo parecía de la aplicación cuando era
   de la prueba.

   `waitForURL` con la condición de "cualquiera que no sea esta" es
   explícito y no depende del reloj. */
let navRealizada = false;

try {
  await pagina.waitForFunction(
    (origen) => window.location.href !== origen,
    pagina.url(),
    { timeout: 8000 }
  );
  navRealizada = true;
} catch {
  navRealizada = false;
}

const urlTrasEnter = pagina.url();

/* Se comparan LAS DOS NORMALIZADAS: sin query, sin origen y sin
   barra final.

   La normalización hace falta porque las dos no tienen la misma
   forma: `pagina.url()` devuelve la URL absoluta y el `href` del
   elemento es relativo. Sin quitar el origen, dan perpetually
   distintas y la comparación falla siempre.

   Y quitar la query porque el formulario es GET y lleva el texto de
   la búsqueda: `?q=pan` encima del destino es lo correcto y no
   forma parte de a dónde se ha ido. */
const rutaLimpia = (u) =>
  String(u)
    .split("?")[0]
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/\/$/, "");

comprobar(
  "Enter abre lo que estaba marcado",
  navRealizada && Boolean(urlMarcada) && rutaLimpia(urlTrasEnter) === rutaLimpia(urlMarcada),
  "fue a " + urlTrasEnter.replace(BASE, "") + ", marcado era " + String(urlMarcada).replace(BASE, "")
);

/* Y que la página de destino sea la de verdad, no la pantalla de
   error del panel. Con la ruta bien puesta, un destino equivocado se
   vería aquí y no en la comparación de arriba. */
const tituloDestino = await pagina.title();

comprobar(
  "la página de destino carga de verdad",
  !/no encontrado|error/i.test(tituloDestino),
  tituloDestino.slice(0, 50)
);

/* ── 7. Lo marcado está a la vista ──
   Con más opciones de las que caben, la marcada tiene que haber
   entrado en pantalla. Si no, Enter abre algo que el ojo no ve. */
await pagina.goto(BASE + "/panel/clientes", { waitUntil: "networkidle" });
await pagina.keyboard.press("Control+k");
await pagina.waitForTimeout(200);
await pagina.fill(".cmd-input", "a");
await pagina.waitForTimeout(500);

let saltoDeMas = false;
for (let i = 0; i < 25; i++) {
  await pagina.keyboard.press("ArrowDown");
}
await pagina.waitForTimeout(200);

const aLaVista = await pagina.evaluate(() => {
  const el = document.querySelector(".cmd-item.es-marcada");
  if (!el) return null;
  const caja = el.closest(".cmd-lista").getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return r.top >= caja.top - 1 && r.bottom <= caja.bottom + 1;
});

comprobar("la opción marcada queda a la vista", aLaVista === true, aLaVista === null ? "no hay ninguna" : "");

void saltoDeMas;

/* ── 8. Escape cierra ── */
await pagina.keyboard.press("Escape");
await pagina.waitForTimeout(250);

comprobar("Escape cierra", !(await pagina.isVisible(".cmd-capa")));

/* ── 9. El foco vuelve ──
   Sin esto, el foco se queda en un input que ya no se ve y el
   siguiente Tab se va al principio de la página. */
const focoVuelve = await pagina.evaluate(() => {
  const a = document.activeElement;
  return !a || !a.classList.contains("cmd-input");
});

comprobar("al cerrar, el foco no se queda en la paleta", focoVuelve);

/* ── 10. Los contadores del lateral ── */
const hoy = new Date().toISOString().slice(0, 10);

const { count: esperadosConsultas } = await db
  .from("leads").select("id", { count: "exact", head: true }).eq("estado", "nuevo");
const { count: esperadosVencidos } = await db
  .from("cobros").select("id", { count: "exact", head: true })
  .in("estado", ["pendiente", "impagado"]).lt("vence_en", hoy);

const badges = await pagina.$$eval(".panel-badge", (n) => n.map((x) => ({
  titulo: x.textContent.trim(),
  title: x.getAttribute("title") || "",
})));

const deConsultas = badges.find((b) => /consulta/.test(b.title));
const deVencidos = badges.find((b) => /fuera de plazo/.test(b.title));

comprobar(
  "el contador de consultas coincide con la base",
  Boolean(deConsultas) === (esperadosConsultas || 0) > 0 &&
    (!deConsultas || deConsultas.titulo === String(esperadosConsultas || 0)),
  "base " + (esperadosConsultas || 0) + ", pintado " + (deConsultas ? deConsultas.titulo : "nada")
);

comprobar(
  "el de cobros vencidos coincide con la base",
  Boolean(deVencidos) === (esperadosVencidos || 0) > 0 &&
    (!deVencidos || deVencidos.titulo === String(esperadosVencidos || 0)),
  "base " + (esperadosVencidos || 0) + ", pintado " + (deVencidos ? deVencidos.titulo : "nada")
);

comprobar("cada contador explica qué cuenta", badges.every((b) => b.title.length > 6), badges.length + " badges");

/* ── 11. Un cliente no busca ── */
const { data: clientes } = await db.from("profiles").select("id").eq("rol", "client").limit(1);

if (clientes && clientes.length) {
  const cCsrf = crypto.randomBytes(12).toString("hex");
  const cToken = crypto.randomBytes(32).toString("hex");

  await db.from("sessions").insert({
    token_hash: crypto.createHash("sha256").update(cToken).digest("hex"),
    user_id: clientes[0].id,
    csrf_token: cCsrf,
    rol: "client",
    creada_en: new Date().toISOString(),
    ultimo_acceso: new Date().toISOString(),
    expira_en: new Date(Date.now() + 600_000).toISOString(),
  });

  const rBuscar = await fetch(BASE + "/panel/buscar?q=pan", {
    headers: { cookie: "nexo_panel=" + cToken },
    redirect: "manual",
  });

  comprobar(
    "un cliente no puede usar el buscador",
    rBuscar.status === 403 || rBuscar.status === 302,
    "HTTP " + rBuscar.status
  );

  await db.from("sessions").delete().eq("csrf_token", cCsrf);
}

comprobar("la consola quedó limpia", errores.length === 0, errores.slice(0, 2).join(" | "));

await navegador.close();
await db.from("sessions").delete().eq("csrf_token", csrf);

console.log("");
console.log("=".repeat(58));
console.log(fallos === 0 ? "Pasan las " + ok + " comprobaciones." : "FALLAN " + fallos + " de " + (ok + fallos) + ".");
console.log("=".repeat(58));
console.log("");

process.exit(fallos === 0 ? 0 : 1);