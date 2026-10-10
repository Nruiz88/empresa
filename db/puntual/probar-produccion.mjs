/* Flujo completo contra el servicio YA DESPLEGADO, con un cliente que
   tiene el modulo contratado.
 *
 * node db/probar-produccion.mjs
 * node db/probar-produccion.mjs --url https://otro-dominio
 *
 * Que se comprueba y por que cada cosa importa:
 *
 *   · La FIRMA. Un ticket firmado con el SERVICE_SECRET del panel, con
 *     el codigo del panel, canjeado contra el servicio desplegado.
 *     Si los dos secretos no coinciden, esto da 401 con "ese enlace
 *     no vale". Son dos .env distintos en dos carpetas distintas y
 *     nada obliga a que coincidan.
 *
 *   · La CONTRATACION. La regla es la funcion `tiene_modulo` del
 *     panel, la misma que llama el servicio. Si el cliente no lo tiene
 *     da 403 "no tiene este servicio contratado", que NO es un fallo
 *     del despliegue: es la respuesta correcta. Por eso se busca
 *     primero quien lo tiene contratado, en vez de probar clientes al
 *     azar y confuse un 403 legitimo con una firma mala.
 *
 *   · El RECORRIDO. Con sesion de verdad: las seis pantallas y sus
 *     APIs, leyendo datos de la base de verdad.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(import.meta.dirname, "..");

const iUrl = process.argv.indexOf("--url");
const DESTINO = iUrl > -1 ? process.argv[iUrl + 1] : "https://inventario.panel-niconqn.duckdns.org";

function leerEnv(ruta) {
  const s = {};
  if (!fs.existsSync(ruta)) return s;
  for (const l of fs.readFileSync(ruta, "utf8").split(/\r?\n/)) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) s[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return s;
}

/* Las variables del entorno mandan sobre el .env, no al reves.
 *
 * Al principio esto era al reves, y poner una contrasena desde la
 * consola no hacia nada: el script leia el .env y lo metia en
 * process.env, asi que al buscar la clave ya encontraba una que no
 * era la que se acababa de escribir. */
const env = leerEnv(path.join(RAIZ, ".env"));
for (const [k, v] of Object.entries(env)) {
  if (k in process.env) continue;
  process.env[k] = v;
}

const { firmar } = require(path.join(RAIZ, "lib", "tickets.js"));
const { createClient } = require("@supabase/supabase-js");

let ok = 0;
let fallos = 0;

const comprobar = (txt, cond, extra) => {
  console.log(`  ${cond ? "✓" : "✗"} ${txt}${extra ? "  → " + extra : ""}`);
  if (cond) ok++;
  else fallos++;
};

console.log("\n═══ El panel contra el servicio desplegado ═══\n");
console.log(`  destino: ${DESTINO}`);
console.log(`  secret:  ${(process.env.SERVICE_SECRET || "").length} chars\n`);

const db = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL,
  env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } }
);

/* --------------------------------------------------------------------
   1. Un cliente que tiene inventario contratado
   -------------------------------------------------------------------- */
const { data: clientes } = await db.from("clients").select("id,nombre").limit(100);

const contratan = [];
for (const c of clientes || []) {
  const { data } = await db.rpc("tiene_modulo", { cliente_uuid: c.id, modulo: "inventario" });
  if (data === true) contratan.push(c);
}

comprobar("el panel tiene SERVICE_SECRET", (process.env.SERVICE_SECRET || "").length > 0);
comprobar("hay clientes en la base", (clientes || []).length > 0, (clientes || []).length + " clientes");
comprobar(
  "algun cliente tiene inventario contratado",
  contratan.length > 0,
  contratan.length ? contratan.map((c) => c.nombre).join(", ") : "ninguno: el 403 seria correcto"
);

if (contratan.length === 0) {
  console.log("\n  Ningun cliente tiene el modulo. El 403 del canje no es un fallo.");
  console.log("  Para probarlo de punta a punta, contrata inventario a un cliente.\n");
  process.exit(1);
}

/* --------------------------------------------------------------------
   2. Firmar con el codigo del panel
   --------------------------------------------------------------------
   El user_id TIENE que existir de verdad. `inventario_sesiones` tiene
   clave foranea a un usuario, asi que un id inventado no da un error
   de autenticacion: pasa la firma, pasa la contratacion, y revienta
   al crear la sesion con

     violates foreign key constraint "servicio_sesiones_user_id_fkey"

   que es un 500 y no dice nada de usuarios. Por eso se busca el
   usuario real en vez de inventar uno. */
const cliente = contratan[0];

const { data: usuarios } = await db.auth.admin.listUsers({ page: 1, perPage: 100 });

/* El usuario de cliente es el que no es staff. El panel solo guarda
   sesiones de staff en su tabla, asi que el de cliente se
   distingue por no ser el admin. */
const staffIds = new Set(
  (
    await db
      .from("sessions")
      .select("user_id,rol")
      .eq("rol", "staff")
  ).data?.map((s) => s.user_id) || []
);

const usuarioCliente = usuarios?.users?.find((u) => !staffIds.has(u.id));

comprobar(
  "hay un usuario de cliente real",
  !!usuarioCliente,
  usuarioCliente ? `${usuarioCliente.email}  ${usuarioCliente.id}` : "no hay usuarios de cliente"
);

if (!usuarioCliente) {
  console.log("\n  Sin un usuario de cliente no se puede probar el canje de punta a");
  console.log("  punta: la sesion necesita una clave foranea a un usuario real.\n");
  process.exit(1);
}

/* El access_token TIENE que ser de verdad, no una cadena inventada.
 *
 * El servicio, al canjear, reconstruye la sesion con ese token y
 * llama a Supabase. Con un token falso, todo lo de antes pasa —la
 * firma, la contratacion, la cookie— y despues cada API responde:
 *
 *   [resumen] no se pudo leer el stock: JWT cryptographic operation failed
 *
 * O sea: el canje da 200 y la app esta "sana", y no hay ni una sola
 * pantalla que funcione. El 500 no habla de tokens, asi que parece
 * un fallo de la base o de la secret key, y se acaba mirando el
 * md5 de SUPABASE_SECRET_KEY, que esta perfectamente bien.
 *
 * La forma de tener uno real es iniciar sesion con el usuario de
 * cliente. Las credenciales van en las variables del panel. */
const ANON = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL,
  env.SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false } }
);

/* Se lee de process.env y no de `env`: `env` es la copia que se hizo
   del fichero, y las variables que llegan de la consola no estan
   ahi. Por eso, aun con la regla de arriba, la contrasena no se
   encontraba. */
const email = process.env.DEMO_CLIENT_EMAIL || process.env.CLIENT_EMAIL || "cliente@ejemplo.com";
const clave =
  process.env.DEMO_CLIENT_PASSWORD || process.env.CLIENT_PASSWORD || process.env.DEMO_PASSWORD;

let accessToken = null;

if (clave) {
  const { data, error } = await ANON.auth.signInWithPassword({ email, password: clave });
  accessToken = data?.session?.access_token || null;
  if (error) console.log(`  (no se pudo iniciar sesion: ${error.message})`);
}

comprobar(
  "hay un access_token real de cliente",
  !!accessToken,
  accessToken ? `${accessToken.slice(0, 24)}...` : `falta la contrasena de ${email}`
);

if (!accessToken) {
  console.log("\n  Sin un access_token real el canje no se puede comprobar de punta a");
  console.log("  punta: la app responde 200 y despues todas las APIs dan 500.");
  console.log("  Ponlo en el .env del panel:");
  console.log("    DEMO_CLIENT_EMAIL / DEMO_CLIENT_PASSWORD\n");
  process.exit(1);
}

const ticket = firmar({
  userId: usuarioCliente.id,
  clientId: cliente.id,
  rol: "client",
  accessToken,
  segundos: 300,
});

comprobar("el panel firma un ticket", typeof ticket === "string" && ticket.includes("."), ticket.length + " chars");

/* --------------------------------------------------------------------
   3. Canjearlo en el servicio desplegado
   -------------------------------------------------------------------- */
const r = await fetch(DESTINO + "/api/entrar", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ticket }),
});
const texto = await r.text();

console.log(`\n  canje: HTTP ${r.status}`);
if (r.status !== 200) console.log(`  respuesta: ${texto.slice(0, 160)}\n`);

if (r.status === 401 && /ese enlace no vale/i.test(texto)) {
  console.log("  ------------------------------------------------------------------");
  console.log("  La firma NO cuadra. El SERVICE_SECRET del panel y el del servicio");
  console.log("  son distintos. Es el fallo que mas ratos cuesta, porque todo lo");
  console.log("  demas parece bien y el unico sintoma es un 401.");
  console.log("  Se comprueba con el md5 del SERVICE_SECRET en cada .env.");
  console.log("  ------------------------------------------------------------------\n");
}

comprobar("el servicio acepta el ticket del panel", r.status === 200, "HTTP " + r.status);

/* --------------------------------------------------------------------
   4. Con sesion de verdad
   -------------------------------------------------------------------- */
let cookie = "";

if (r.status === 200) {
  const sc = r.headers.get("set-cookie") || "";
  cookie = sc
    .split(/,(?=\s*[^;=]+=)/)
    .map((c) => c.trim().split(";")[0])
    .join("; ");

  console.log("\n── Con sesion ──\n");

  comprobar("la cookie es inv_sesion", cookie.includes("inv_sesion"));
  comprobar("va con secure en https", /;\s*secure/i.test(sc));
  comprobar("es host-only, sin Domain", !/\bDomain=/i.test(sc));

  const H = { "Content-Type": "application/json", Cookie: cookie };

  const resumen = await fetch(DESTINO + "/api/resumen", { headers: H });
  const rj = await resumen.json();
  comprobar("/api/resumen responde 200", resumen.status === 200, "HTTP " + resumen.status);
  comprobar(
    "y lee la base de verdad",
    Array.isArray(rj.data?.stock?.lista),
    (rj.data?.stock?.total ?? "?") + " presentaciones"
  );

  for (const api of ["productos", "ventas", "compras", "caja", "arqueo", "cuentas"]) {
    const rr = await fetch(`${DESTINO}/api/${api}`, { headers: H });
    comprobar(`/api/${api} responde 200`, rr.status === 200, "HTTP " + rr.status);
  }

  for (const pagina of ["/", "/ventas", "/productos", "/compras", "/caja", "/cuentas"]) {
    const rr = await fetch(DESTINO + pagina, { headers: H, redirect: "manual" });
    comprobar(`${pagina} responde 200 con sesion`, rr.status === 200, "HTTP " + rr.status);
  }
}

/* --------------------------------------------------------------------
   5. Sin sesion
   -------------------------------------------------------------------- */
console.log("\n── Sin sesion ──\n");

const sinCookie = await fetch(DESTINO + "/api/resumen");
comprobar("sin sesion responde 401 y no 500", sinCookie.status === 401, "HTTP " + sinCookie.status);

const pagina = await fetch(DESTINO + "/entrar");
comprobar("/entrar responde 200 sin sesion", pagina.status === 200, "HTTP " + pagina.status);

const raiz = await fetch(DESTINO + "/", { redirect: "manual" });
comprobar("/ redirige a /entrar", raiz.status === 307 || raiz.status === 302, "HTTP " + raiz.status);

const manipulado = ticket.slice(0, -6) + "AAAAAA";
const rMalo = await fetch(DESTINO + "/api/entrar", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ticket: manipulado }),
});
comprobar("un ticket manipulado se rechaza", rMalo.status === 401, "HTTP " + rMalo.status);

/* -------------------------------------------------------------------- */
console.log("\n" + "═".repeat(54));

if (fallos) {
  console.log(`✗ ${fallos} de ${ok + fallos} fallan.\n`);
  process.exit(1);
}

console.log(`✓ Las ${ok} comprobaciones pasan contra el servicio desplegado.`);
console.log(`  Cliente usado: ${cliente.nombre}\n`);
process.exit(0);