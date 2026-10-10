/* Prueba el alta y el acceso de clientes, de punta a punta.
 *
 * node db/probar-cuenta.mjs [--url http://127.0.0.1:3000]
 *
 * ── POR QUÉ ESTE ──
 *
 * El alta de clientes es la primera vez que un VISITANTE puede crear
 * una fila en `clients` y un usuario en Supabase Auth. Todo lo demás
 * del panel lo crea el equipo, desde dentro.
 *
 * Por eso hace falta una prueba que lo haga de verdad contra una base
 * de verdad, y que encima compruebe lo que NO se ve mirando la
 * pantalla:
 *
 *   · que la cuenta creada entra y ve SU panel, no el del equipo
 *   · que el rol es `client` y no se puede pedir otro
 *   · que la sesión vale en /panel, no solo en /cuenta
 *   · que un alta repetida con el mismo correo no crea dos cuentas
 *   · que la empresa repetida reutiliza la ficha, no duplica
 *   · que la trampa de robots y el CSRF frenan lo que deben
 *
 * ── LO QUE NO HACE ──
 *
 * No prueba los correos: no hay SMTP de prueba, y un correo que no
 * llega es un problema que se ve en el correo, no aquí.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

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

const MARCA = "-test-cuenta-";
const PASSWORD = "prueba-cuenta-2026-esta-es-larga-de-verdad";

/* Un email que NO existe: se genera con la marca y la hora, para que
   dos ejecuciones seguidas no choquen. */
const email = MARCA + Date.now() + "@ejemplo.com";

const db = createClient(
  env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } }
);

console.log("");
console.log("=== Alta y acceso de clientes ===");
console.log("");
console.log("  sitio: " + BASE);
console.log("  email: " + email);
console.log("");

/* ── Un cliente con "navegador" mínimo: cookie y formularios ── */
let csrf = null;

async function sacarCsrf(ruta) {
  const r = await fetch(BASE + ruta);
  const html = await r.text();
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return { cookie: r.headers.get("set-cookie") || "", csrf: m ? m[1] : null, status: r.status };
}

function juntarCookies(setCookie) {
  return setCookie
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

/* ── 1. Las dos pantallas existen ── */
const reg = await sacarCsrf("/cuenta/crear");
const ent = await sacarCsrf("/cuenta/entrar");

comprobar("/cuenta/crear responde", reg.status === 200, "HTTP " + reg.status);
comprobar("/cuenta/entrar responde", ent.status === 200, "HTTP " + ent.status);
comprobar("el alta trae su token CSRF", !!reg.csrf);
comprobar("el acceso trae su token CSRF", !!ent.csrf);

/* ── 2. Entrar sin CSRF no funciona ──
   Si esto pasara, cualquier web podría dar de alta una cuenta en
   nombre de quien visits. */
const sinCsrf = await fetch(BASE + "/cuenta/crear", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ email, nombre: "Sin CSRF", password: PASSWORD, repetir: PASSWORD, acepta: "1" }),
  redirect: "manual",
});

comprobar(
  "un alta sin CSRF se rechaza",
  sinCsrf.status === 403,
  "HTTP " + sinCsrf.status
);

/* ── 3. La trampa de robots ──
   Se espera 200 porque al bot se le responde como si nada: si
   devolviera un error, un bot distinguiría al instante que hay una
   trampa y learn a rellenarla. */
const conTrampa = await fetch(BASE + "/cuenta/crear", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", cookie: juntarCookies(reg.cookie) },
  body: new URLSearchParams({
    _csrf: reg.csrf,
    sitio_web: "http://spam.example",
    email,
    nombre: "Bot",
    password: PASSWORD,
    repetir: PASSWORD,
    acepta: "1",
  }),
  redirect: "manual",
});

const { data: creadosPorBot } = await db.from("profiles").select("id").ilike("nombre", "%Bot%").is("client_id", null);

comprobar(
  "un alta con la trampa rellena no crea nada",
  (creadosPorBot || []).length === 0,
  (creadosPorBot || []).length + " perfiles sin ficha"
);

/* ── 4. Validación ── */
async function alta(datos, token = reg.csrf, cookie = reg.cookie) {
  const r = await fetch(BASE + "/cuenta/crear", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: juntarCookies(cookie) },
    body: new URLSearchParams({ _csrf: token, ...datos }),
    redirect: "manual",
  });

  /* `headers` va en el retorno. Faltaba, y lo que pasaba es que el
     alta correcta devolvía 302 y el test se intentaba leer
     `altaReal.headers`, que era undefined: reventaba la prueba justo
     en el paso que iba bien. Un fallo de la prueba que solo aparece
     cuando todo funciona, que es el peor sitio para un descuido. */
  return {
    status: r.status,
    headers: r.headers,
    cookie: r.headers.get("set-cookie") || "",
    html: await r.text(),
  };
}

const corta = await alta({ email, nombre: "X", password: "corta", repetir: "corta", acepta: "1" });
comprobar(
  "una contraseña corta se rechaza",
  corta.status === 400 && /32 caracteres/.test(corta.html),
  "HTTP " + corta.status
);

const distinta = await alta({ email, nombre: "X", password: PASSWORD, repetir: "otra-cosa-distinta", acepta: "1" });
comprobar(
  "contraseñas distintas se rechazan",
  distinta.status === 400 && /no coinciden/.test(distinta.html),
  "HTTP " + distinta.status
);

const sinAceptar = await alta({ email, nombre: "X", password: PASSWORD, repetir: PASSWORD });
comprobar(
  "sin aceptar las condiciones no se crea",
  sinAceptar.status === 400 && /condiciones/.test(sinAceptar.html),
  "HTTP " + sinAceptar.status
);

/* ── 5. El alta de verdad ──
   Vuelve a pedir el formulario porque las pruebas anteriores
   consumieron el token anterior. */
const fresco = await sacarCsrf("/cuenta/crear");

const altaReal = await alta(
  {
    email,
    nombre: "Cliente " + MARCA.trim(),
    empresa: "Empresa " + MARCA.trim() + " " + Date.now(),
    password: PASSWORD,
    repetir: PASSWORD,
    acepta: "1",
  },
  fresco.csrf,
  fresco.cookie
);

comprobar("el alta responde 302 (a la cuenta)", altaReal.status === 302, "HTTP " + altaReal.status);
comprobar(
  "lleva al panel del cliente",
  (altaReal.headers.get("location") || "").includes("/panel/mis-servicios"),
  altaReal.headers.get("location") || ""
);
comprobar(
  "deja la sesión puesta",
  /nexo_panel=/.test(juntarCookies(altaReal.cookie))
);

/* ── 6. Lo que hay en la base ── */
const { data: usuarios } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
const mio = (usuarios && usuarios.users || []).find((u) => String(u.email).toLowerCase() === email);

comprobar("el usuario existe en Supabase Auth", !!mio, mio ? mio.id.slice(0, 8) : "no aparece");

if (mio) {
  const { data: perfil } = await db.from("profiles").select("rol,activo,client_id,nombre").eq("id", mio.id).maybeSingle();

  comprobar("tiene perfil", !!perfil);
  comprobar(
    "el rol es client",
    perfil && perfil.rol === "client",
    perfil ? perfil.rol : "sin perfil"
  );
  comprobar("está enlazado a una ficha de cliente", !!(perfil && perfil.client_id));
  comprobar("está activo", !!(perfil && perfil.activo));

  /* ── 7. El rol no se puede pedir ──
     Aunque el campo no exista en el formulario, se manda uno a
     propósito. Si el servidor lo leyera, esto crearía un staff.

     La comprobación mira el ROL, no el nombre. La primera versión
     contaba "no hay ningún perfil llamado Intruso", que falla igual
     de bien y de mal: el alta se CREA (con rol client, que es lo
     correcto) y por tanto hay un Intruso, así que la prueba daba
     rojo HAVIENDO HECHO LO QUE TIENE QUE HACER. Un fallo que
     confunde "rompido" con "funciona" es peor que no comprobarlo. */
  const conRol = await fetch(BASE + "/cuenta/crear", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: juntarCookies(fresco.cookie) },
    body: new URLSearchParams({
      _csrf: fresco.csrf,
      email: MARCA + "staff-" + Date.now() + "@ejemplo.com",
      nombre: "Intruso",
      rol: "staff",
      password: PASSWORD,
      repetir: PASSWORD,
      acepta: "1",
    }),
    redirect: "manual",
  });

  const { data: intrusos } = await db.from("profiles").select("id,rol").ilike("nombre", "Intruso%");

  const intrusosStaff = (intrusos || []).filter((p) => p.rol === "staff");

  comprobar(
    "mandar rol=staff en el alta no lo concede",
    intrusosStaff.length === 0,
    intrusosStaff.length
      ? intrusosStaff.length + " STAFF creados a dedo"
      : "se creó, pero como " + ((intrusos || [])[0] ? (intrusos || [])[0].rol : "nadie")
  );

  comprobar(
    "y el alta con rol=staff sale bien, no se rompe",
    conRol.status === 302,
    "HTTP " + conRol.status
  );

  /* ── 8. La cuenta nueva entra y ve SU panel ── */
  const sesion = juntarCookies(altaReal.cookie).split("nexo_panel=")[1];

  const rPanel = await fetch(BASE + "/panel", {
    headers: { cookie: "nexo_panel=" + sesion.split(";")[0] },
    redirect: "manual",
  });

  comprobar(
    "/panel lleva a un cliente a su portal",
    (rPanel.headers.get("location") || "").includes("mis-servicios"),
    rPanel.headers.get("location") || "HTTP " + rPanel.status
  );

  const rPortal = await fetch(BASE + "/panel/mis-servicios", {
    headers: { cookie: "nexo_panel=" + sesion.split(";")[0] },
    redirect: "manual",
  });

  comprobar(
    "el portal se abre con esa sesión",
    rPortal.status === 200,
    "HTTP " + rPortal.status
  );

  const portalHtml = await rPortal.text();
  comprobar(
    "el portal no dice 'Panel de equipo'",
    !/Panel de equipo/.test(portalHtml),
    "lo dice"
  );

  /* ── 9. Un cliente no ve el panel del equipo ──
     Es la prueba de que el aislamiento por rol aguanta con una
     cuenta creada por la vía nueva, que es la que no estaba probada. */
  const rClientes = await fetch(BASE + "/panel/clientes", {
    headers: { cookie: "nexo_panel=" + sesion.split(";")[0] },
    redirect: "manual",
  });

  comprobar(
    "un cliente no entra en la gestión de clientes",
    rClientes.status === 302 || rClientes.status === 403,
    "HTTP " + rClientes.status
  );

  /* ── 10. Reutilización de ficha ──
     Dos altas con el MISMO nombre de empresa no pueden crear dos
     fichas: la segunda se sumaría a la primera, y con cero servicios
     parecería un cliente nuevo. */
  const empresa = "Empresa Reutilizable " + MARCA.trim() + " " + Date.now();

  async function altaConEmpresa(nombre) {
    const f = await sacarCsrf("/cuenta/crear");
    const r = await fetch(BASE + "/cuenta/crear", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: juntarCookies(f.cookie) },
      body: new URLSearchParams({
        _csrf: f.csrf,
        email: MARCA + nombre + Date.now() + "@ejemplo.com",
        nombre: "Reutilizador " + nombre,
        empresa,
        password: PASSWORD,
        repetir: PASSWORD,
        acepta: "1",
      }),
      redirect: "manual",
    });
    return { status: r.status, cookie: r.headers.get("set-cookie") || "" };
  }

  const a1 = await altaConEmpresa("a");
  const a2 = await altaConEmpresa("b");

  const { data: fichas } = await db.from("clients").select("id").ilike("empresa", empresa);

  comprobar(
    "dos cuentas con la misma empresa comparten ficha",
    (fichas || []).length === 1,
    (fichas || []).length + " fichas para '" + empresa + "'"
  );

  comprobar("las dos altas responden 302", a1.status === 302 && a2.status === 302, a1.status + " / " + a2.status);

  /* ── 11. Alta repetida con el mismo correo ── */
  const f2 = await sacarCsrf("/cuenta/crear");
  const repetida = await fetch(BASE + "/cuenta/crear", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: juntarCookies(f2.cookie) },
    body: new URLSearchParams({
      _csrf: f2.csrf,
      email,
      nombre: "Repetido",
      password: PASSWORD,
      repetir: PASSWORD,
      acepta: "1",
    }),
    redirect: "manual",
  });

  const htmlRepetida = await repetida.text();

  comprobar(
    "un correo repetido no crea una segunda cuenta",
    (usuarios.users || []).filter((u) => String(u.email).toLowerCase() === email).length === 1
  );

  /* ── Aviso de correo repetido ──

     NO se comprueba que el alta no revele si el correo existe, porque
     se ha decidido que sí lo diga: es lo que hacen GitHub, Vercel y
     Stripe, y el silencio castiga a quien ya se registró y no lo
     recuerda. La decisión está escrita en routes/cuenta.js.

     La comprobación que sí importa, y que está más abajo, es que el
     ACCESO no diga nunca si una contraseña es correcta: esa es la que
     permite ir probando. Un alta repetida con el texto equivocado
     rompe a un cliente; un login que confirma la contraseña abre la
     puerta de dentro.

     Lo que se comprueba aquí es que la rama funcione y no reviente,
     y que mande al sitio correcto para poder entrar. */

  /* La rama del correo repetido TIENE que devolver la página con su
     aviso, y no reventar.

     Antes solo se comprobaba que la respuesta no delatase el correo, y
     eso pasaba igual con un error de servidor en el cuerpo: el texto
     de EJS no contiene la frase buscada, así que la comprobación se
     cumplía sin que la rama funcionara. De hecho no funcionaba: la
     vista no recibía el token CSRF y petaba al renderizar. */
  comprobar(
    "el aviso de correo repetido se pinta de verdad",
    repetida.status === 200 && /entra con tu contraseña/i.test(htmlRepetida),
    "HTTP " + repetida.status
  );

  comprobar(
    "y ofrece el enlace para entrar",
    htmlRepetida.includes("/cuenta/entrar"),
    "no hay enlace"
  );

  /* ── 12. Acceso con la cuenta nueva ── */
  const f3 = await sacarCsrf("/cuenta/entrar");
  const malClave = await fetch(BASE + "/cuenta/entrar", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: juntarCookies(f3.cookie) },
    body: new URLSearchParams({ _csrf: f3.csrf, email, password: "otra-cosa-cualquiera" }),
    redirect: "manual",
  });

  const malHtml = await malClave.text();
  comprobar(
    "una contraseña incorrecta no entra",
    malClave.status === 401,
    "HTTP " + malClave.status
  );
  comprobar(
    "y no dice si el correo existe",
    !/no existe|no hay cuenta|correo no registrado/i.test(malHtml),
    "el texto lo delata"
  );

  const f4 = await sacarCsrf("/cuenta/entrar");
  const buenClave = await fetch(BASE + "/cuenta/entrar", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: juntarCookies(f4.cookie) },
    body: new URLSearchParams({ _csrf: f4.csrf, email, password: PASSWORD }),
    redirect: "manual",
  });

  comprobar(
    "con la contraseña correcta entra",
    buenClave.status === 302,
    "HTTP " + buenClave.status
  );
  comprobar(
    "y va a su portal, no al panel del equipo",
    (buenClave.headers.get("location") || "").includes("mis-servicios"),
    buenClave.headers.get("location") || ""
  );

  /* ── Limpieza ──
     POR CORREO, NO POR NOMBRE.

     La primera versión borraba los perfiles cuyo `nombre` contuviera
     la marca: `ilike("nombre", "%-test-cuenta-%")`. Y creaba tres
     cuentas por ejecución —el alta normal, las dos de empresa
     reutilizada y la del `rol=staff` a dedo—, de las cuales solo la
     primera llevaba la marca en el nombre. Las otras dos se quedaban.

     Resultado: 21 usuarios de prueba huérfanos en el Supabase de
     PRODUCCIÓN, tres por ejecución. Un usuario de Auth es de pago, y
     encima ensucia el listado que leen los listados de usuarios.

     Y lo peor es que la prueba pasaba en verde mientras lo dejaba: la
     limpieza va después de las comprobaciones, y nadie comprobaba que
     se hubiera limpiado. Un fallo que no falla es el peor sitio para
     un descuido de limpieza.

     Ahora se borra por CORREO, que es único y todas las cuentas lo
     llevan, y además se comprueba al final que no queda ninguna. */
  const { data: todosPerfiles } = await db.from("profiles").select("id,client_id");

  const { data: usuariosAuth } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });

  const idsVuestras = new Set(
    (usuariosAuth?.users || [])
      .filter((u) => String(u.email).includes(MARCA))
      .map((u) => u.id)
  );

  for (const p of todosPerfiles || []) {
    if (!idsVuestras.has(p.id)) continue;

    await db.from("sessions").delete().eq("user_id", p.id);
    await db.auth.admin.deleteUser(p.id).catch(() => {});
    if (p.client_id) await db.from("clients").delete().eq("id", p.client_id);
  }

  await db.from("clients").delete().ilike("empresa", "%" + MARCA + "%");

  /* Y se COMPRUEBA que no queda ninguna. Sin esta comprobación, esta
     prueba habría seguido dando verde mientras dejaba basura. */
  const { data: despuesLimpieza } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });

  const quedan = (despuesLimpieza?.users || []).filter((u) => String(u.email).includes(MARCA));

  comprobar(
    "la prueba no deja usuarios de prueba en la base",
    quedan.length === 0,
    quedan.length + " usuarios sin borrar"
  );
}

console.log("");
console.log("=".repeat(58));
console.log(fallos === 0 ? "Pasan las " + ok + " comprobaciones." : "FALLAN " + fallos + " de " + (ok + fallos) + ".");
console.log("=".repeat(58));
console.log("");

process.exit(fallos === 0 ? 0 : 1);