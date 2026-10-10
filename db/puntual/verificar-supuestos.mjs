/* Comprobar dos cosas antes de decir que estan rotas.
 *
 * node db/verificar-supuestos.mjs
 *
 * ── PARA QUÉ ESTE ──
 *
 * Al mirar el panel salen tres cosas que PARECEN fallos:
 *
 *   · un cobro vencido que muestra "?" en vez del nombre del cliente
 *   · el módulo del bot apuntando a un dominio inventado
 *   · una pantalla entera de accesos con la tabla vacía
 *
 * La primera puede ser culpa del script que pregunta, no del panel.
 * Un informe que da datos malos hace peor que no dar ninguno, así
 * que antes de decir "esto está roto" se comprueba de dónde sale.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(import.meta.dirname, "..");
const NL = String.fromCharCode(10);

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

const { createClient } = require("@supabase/supabase-js");
const db = createClient(
  env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } }
);

const linea = (t) => {
  console.log("");
  console.log("  " + t);
};

/* ── 1. ¿De dónde sale el nombre del cliente en un cobro? ── */
linea("1. el cobro vencido y su cliente");

const { data: cobros } = await db.from("cobros").select("*");

if (cobros?.length) {
  const columnas = Object.keys(cobros[0]);
  console.log("  columnas de cobros: " + columnas.join(", "));
  console.log("  tiene client_id: " + (columnas.includes("client_id") ? "si" : "NO"));

  const vencido = cobros.find((c) => c.estado === "pendiente" && c.vence_en < new Date().toISOString().slice(0, 10));

  if (vencido) {
    console.log("");
    console.log("  el vencido: " + vencido.concepto + "  " + vencido.importe);
    console.log("  vencio el: " + vencido.vence_en);

    /* El nombre sale del servicio, no del cobro. */
    if (vencido.service_id) {
      const { data: srv } = await db
        .from("services")
        .select("id,titulo,clients(nombre,empresa)")
        .eq("id", vencido.service_id)
        .maybeSingle();

      console.log("");
      if (srv) {
        const nombre = srv.clients?.nombre || srv.clients?.empresa || "(sin cliente)";
        console.log("  su servicio: " + srv.titulo);
        console.log("  su cliente:  " + nombre);
        console.log("");
        console.log("  CONCLUSIÓN: el panel sí puede mostrar el nombre. El '?' era");
        console.log("  MI script buscando cobros.client_id, una columna que no existe.");
        console.log("  El panel lo saca bien, por el service_id.");
      } else {
        console.log("  su servicio: NO SE ENCONTRO (service_id " + vencido.service_id + ")");
        console.log("");
        console.log("  CONCLUSIÓN: aquí sí hay un problema real. Un cobro sin servicio");
        console.log("  no tiene cliente posible, y el panel no lo puede pintar.");
      }
    } else {
      console.log("  no tiene service_id: un cobro suelto, sin servicio detrás.");
    }
  }
}

/* ── 2. Las urls de los módulos ── */
linea("2. las urls de los modulos");

const { data: modulos } = await db.from("modules").select("*").order("id");

for (const m of modulos || []) {
  const url = m.url || "";
  let estado;

  if (!url) {
    estado = "SIN URL: el boton 'Abrir' no lleva a ninguna parte";
  } else if (url.includes(".example")) {
    estado = "URL DE EJEMPLO: no existe en internet";
  } else {
    estado = "url real";
  }

  console.log("  " + String(m.id).padEnd(16) + estado);
  if (url) console.log("                   " + url);
}

/* ── 3. La tabla de accesos, que aparece vacía ── */
linea("3. la tabla de accesos");

const { data: accesos, error: eAcc } = await db.from("accesos").select("*");

if (eAcc) {
  console.log("  error: " + eAcc.message);
} else {
  console.log("  filas: " + (accesos || []).length);
  console.log("");
  if ((accesos || []).length === 0) {
    console.log("  CONCLUSIÓN: la pantalla existe pero no hay nada. Hay dos");
    console.log("  opciones: que sobre hasta que la necesites, o que algo");
    console.log("  falle al crearlos. Con 17 clientes y 0 accesos, es probable");
    console.log("  que la segunda.");
  }
}

console.log("");
console.log("=".repeat(56));
console.log("");
process.exit(0);