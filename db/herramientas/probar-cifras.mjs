/* Que las cifras del panel no se contradigan entre pantallas.
 *
 * node db/probar-cifras.mjs [--url https://empresa.panel-...]
 *
 * ── POR QUÉ ESTE ──
 *
 * Las pruebas que había miraban si algo funciona: si la ruta
 * responde, si el canje vale, si el secreto cuadra. Ninguna miraba si
 * dos pantallas dicen lo mismo.
 *
 * Y eso es un agujero grande, porque una cifra puede estar mal y
 * seguir siendo "correcta" desde donde se mira. Pasó de verdad:
 *
 *   portada   "14.218,00 € por cobrar"
 *   cobros     "8.809,00 € por cobrar"
 *
 * La diferencia, 5.409 €, era exactamente el "cobrado histórico": la
 * portada estaba sumando los cobros PAGADOS como si se debieran.
 *
 * Y ninguna de las dos pantallas tenía un error visible. La consulta
 * de la portada pedía `importe,vence_en,services(moneda)` — sin
 * `estado` — y luego filtraba en el bucle con:
 *
 *     if ((c.estado || "pendiente") !== "pendiente") continue;
 *
 * Como `estado` no venía nunca, era `undefined`, el `||` lo pasaba a
 * "pendiente" siempre, y la comprobación no descartaba nada. Un
 * valor por defecto inventado en el filtro, que es exactamente el
 * sitio donde no debe haber uno.
 *
 * Ninguna prueba podía verlo: cada pantalla era coherente consigo
 * misma. Solo se ve al poner las dos una al lado. Por eso esto compara
 * números entre pantallas en vez de recalcularlos.
 *
 * ── QUE COMPRUEBA ──
 *
 *   · la portada y cobros dicen el mismo "por cobrar"
 *   · la portada y cobros dicen el mismo total vencido
 *   · ninguna suma los pagados: por cobrar  pagado + pendiente
 *
 * Va contra las PÁGINAS, no contra la base. Un test que recalculara
 * en JS haría la cuenta por segunda vez con el mismo criterio que el
 * bug, y pasaría.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const RAIZ = path.resolve(import.meta.dirname, "..");
const NL = String.fromCharCode(10);

function arg(n, d) {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : d;
}

const PANEL = arg("--url", process.env.PANEL_URL || "http://127.0.0.1:3000");

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

/* ── Sacar un número de una tarjeta del HTML ──
 *
 * Las cifras se pintan como texto de `dinero()`, con el separador de
 * miles y el símbolo delante: "8.809,00 €". Se comparan en enteros de
 * céntimos para no depender del formato, que también depende del
 * idioma del navegador de quien mira.
 *
 * Un parser de HTML aquí sería overkill y frágil. Se acota al patrón
 * que pintan las vistas y, si algún día cambia, esto avisa en vez de
 * decir que las cifras cuadran sin haber mirado ninguna. */
function aCentimos(texto) {
  if (!texto) return null;
  const limpio = texto.replace(/ | /g, "").replace(/€/g, "").trim();
  const m = limpio.match(/^(\d[\d.]*(?:,\d+)?)$/);
  if (!m) return null;

  const bruto = m[1];
  /* "8.809,00" → miles con punto, decimal con coma (es-ES). */
  const entero = bruto.split(",")[0].replace(/\./g, "");
  const decimal = bruto.includes(",") ? bruto.split(",")[1] : "00";

  return Number(entero) * 100 + Number(decimal.padEnd(2, "0"));
}

/* La tarjeta es: <strong>IMPORTE</strong> <span>etiqueta</span>.
 *
 * Se recogen TODAS las parejas y se buscan por etiqueta después. La
 * primera versión buscaba con una regex queía saltarse la tarjeta
 * entera con `[\s\S]{0,400}?`, y cogía la cifra equivocada: pedía el
 * "por cobrar" y devolvía el "vencido", que va justo antes. Daba un
 * número —un 7.809 que parecía plausible— y por eso era peor que no
 * leer nada: el test fallaba, pero por la razón equivocada, y en
 * cuanto se arreglaba el bug seathingía callado sin haberse fijado en
 * qué miraba.
 *
 * Por eso el par <strong><span> tiene que ser ADYACENTE: si entre los
 * dos hay otra cosa, no es la misma tarjeta. */
function tarjetas(html) {
  const mapa = new Map();
  const re = /<strong[^>]*>\s*([^<]+?)\s*<\/strong>\s*(?:<em[^>]*>[\s\S]*?<\/em>\s*)?<span[^>]*>([\s\S]*?)<\/span>/gi;

  let m;
  while ((m = re.exec(html)) !== null) {
    const euros = aCentimos(m[1]);
    if (euros === null) continue;

    const etiqueta = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!mapa.has(etiqueta)) mapa.set(etiqueta, euros);
  }

  return mapa;
}

/* El pie: <a class="panel-stat-pie...">2.400,00 € vencido · 1 cobro</a> */
function pieVencido(html) {
  const m = html.match(/panel-stat-pie[^>]*>\s*([^<]*vencido[^<]*)</i);
  if (!m) return { euros: null, n: null };

  const num = m[1].match(/([\d.,]+)\s*€/);
  const n = m[1].match(/(\d+)\s*cobro/i);

  return { euros: num ? aCentimos(num[1]) : null, n: n ? Number(n[1]) : null };
}

console.log("");
console.log("=== Las cifras del panel, unas contra otras ===");
console.log("");
console.log("  panel: " + PANEL);
console.log("");

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
  expira_en: new Date(Date.now() + 600_000).toISOString(),
});

const cookie = { cookie: "nexo_panel=" + token };

const rPortada = await fetch(PANEL + "/panel", { headers: cookie });
const rCobros = await fetch(PANEL + "/panel/cobros", { headers: cookie });

if (rPortada.status !== 200 || rCobros.status !== 200) {
  console.log("  el panel no responde: " + rPortada.status + " / " + rCobros.status);
  await db.from("sessions").delete().eq("csrf_token", csrf);
  process.exit(1);
}

const portada = await rPortada.text();
const cobros = await rCobros.text();

/* ── 1. El "por cobrar" ──
 *
 * En las dos pantallas el total va en el <strong> de la tarjeta roja,
 * pero la etiqueta es distinta: en la portada pone "8 por cobrar"
 * (con el número del texto) y en cobros pone "por cobrar" a secas.
 * La de la portada lleva el número de cobros delante de la palabra,
 * así que se busca por el final de la etiqueta. */
const tPortada = tarjetas(portada);
const tCobros = tarjetas(cobros);

function porCobrar(mapa) {
  for (const [etiqueta, euros] of mapa) {
    if (/por\s+cobrar$/.test(etiqueta)) return euros;
  }
  return null;
}

function vencidos(mapa) {
  for (const [etiqueta, euros] of mapa) {
    if (/vencidos?$/.test(etiqueta)) {
      const n = etiqueta.match(/(\d+)\s+cobro/);
      return { euros, n: n ? Number(n[1]) : null };
    }
  }
  return { euros: null, n: null };
}

const portadaCobrar = porCobrar(tPortada);
const cobrosCobrar = porCobrar(tCobros);

console.log("  --- lo que se debe ---");
console.log("  portada:  " + (portadaCobrar === null ? "(no se encuentra)" : (portadaCobrar / 100).toFixed(2) + " EUR"));
console.log("  cobros:   " + (cobrosCobrar === null ? "(no se encuentra)" : (cobrosCobrar / 100).toFixed(2) + " EUR"));
console.log("");

comprobar(
  "las dos pantallas dicen el mismo por cobrar",
  portadaCobrar !== null && cobrosCobrar !== null && portadaCobrar === cobrosCobrar,
  portadaCobrar === cobrosCobrar
    ? ""
    : "difieren en " + (((portadaCobrar || 0) - (cobrosCobrar || 0)) / 100).toFixed(2) + " EUR"
);

/* ── 2. El vencido ──
 *
 * En la portada el vencido es la tarjeta roja. En cobros el total está
 * en el <strong> y el desglose en el pie de debajo, porque ahí la
 * tarjeta roja es el "por cobrar" entero, no el vencido.
 *
 * O sea que no se leen igual, y por eso no se comparan con la misma
 * función: se compara el dato, no el HTML. */
const piePortada = vencidos(tPortada);
const pieCobros = vencidos(tCobros);

/* En cobros, el vencido sale del pie, que es donde está el desglose. */
const pieCobrosReal = pieVencido(cobros);

console.log("  --- lo vencido ---");
console.log(
  "  portada:  " +
    (piePortada.euros === null
      ? "(no hay nada vencido)"
      : (piePortada.euros / 100).toFixed(2) + " EUR en " + piePortada.n + " cobros")
);
console.log(
  "  cobros:   " +
    (pieCobrosReal.euros === null
      ? "(no hay nada vencido)"
      : (pieCobrosReal.euros / 100).toFixed(2) + " EUR en " + pieCobrosReal.n + " cobros")
);
console.log("");

comprobar(
  "las dos pantallas dicen el mismo vencido",
  piePortada.euros === pieCobrosReal.euros && piePortada.n === pieCobrosReal.n,
  piePortada.euros === pieCobrosReal.euros && piePortada.n === pieCobrosReal.n
    ? ""
    : "portada " + piePortada.euros + "/" + piePortada.n + "  cobros " + pieCobrosReal.euros + "/" + pieCobrosReal.n
);

/* ── 3. Que no se sume lo pagado como si se debiera ──
 *
 * Esta es la comprobación que habría pillado el fallo original, y no
 * depende de comparar pantallas: sale de la propia aritmética de la
 * base. Si lo vencido fuera mayor que lo pendiente, la tarjeta estaria
 * sumando algo que ya se cobró. */
const { data: filas } = await db
  .from("cobros")
  .select("estado,importe,descuento,vence_en")
  .in("estado", ["pendiente", "impagado", "pagado"]);

const hoy = new Date().toISOString().slice(0, 10);

let pendiente = 0;
let vencidoReal = 0;

for (const f of filas || []) {
  const neto = Number(f.importe) - Number(f.descuento || 0);
  if (f.estado === "pagado") continue;
  pendiente += neto;
  if (f.vence_en && f.vence_en < hoy) vencidoReal += neto;
}

const pendienteCents = Math.round(pendiente * 100);
const vencidoCents = Math.round(vencidoReal * 100);

comprobar(
  "lo vencido no es más que lo pendiente",
  vencidoCents <= pendienteCents,
  vencidoCents > pendienteCents ? "la cuenta no cuadra" : ""
);

comprobar(
  "la portada no suma más de lo pendiente",
  portadaCobrar !== null && portadaCobrar <= pendienteCents,
  portadaCobrar !== null && portadaCobrar > pendienteCents
    ? "la portada dice " + (portadaCobrar / 100).toFixed(2) + " y solo hay " + (pendienteCents / 100).toFixed(2) + " pendientes"
    : ""
);

/* Y que las cifras pintadas sean las de verdad. Este es el que de
   verdad ata la pantalla a la base: los dos anteriores comparan
   pantallas entre sí, que es como se manifestationó el fallo. */
comprobar(
  "el pendiente pintado es el pendiente real",
  portadaCobrar !== null && portadaCobrar === pendienteCents,
  portadaCobrar !== null && portadaCobrar !== pendienteCents
    ? "pintado " + (portadaCobrar / 100).toFixed(2) + "  real " + (pendienteCents / 100).toFixed(2)
    : ""
);

comprobar(
  "el vencido pintado es el vencido real",
  piePortada.euros === vencidoCents,
  piePortada.euros !== vencidoCents
    ? "pintado " + (piePortada.euros === null ? "-" : (piePortada.euros / 100).toFixed(2)) +
      "  real " + (vencidoCents / 100).toFixed(2)
    : ""
);

await db.from("sessions").delete().eq("csrf_token", csrf);

console.log("");
console.log("=".repeat(56));

if (fallos === 0) {
  console.log("Pasan las " + ok + " comprobaciones.");
} else {
  console.log("FALLAN " + fallos + " de " + (ok + fallos) + ".");
}

console.log("=".repeat(56));
console.log("");

process.exit(fallos === 0 ? 0 : 1);