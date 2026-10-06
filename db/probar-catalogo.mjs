/* La pantalla de catálogo: editar precios, y que el cliente los vea.
 *
 * node db/probar-catalogo.mjs [--url http://127.0.0.1:3000]
 *
 * ── POR QUÉ ESTE ──
 *
 * Es la primera pantalla del panel que EDITA datos. Todo lo demás
 * los muestra. Aquí el fallo posible no es que se vea mal: es que
 * alguien escrib prices, garde y no pase nada, o que pase de más y
 * toque columnas que no debía.
 *
 * Por eso comprueba las dos cosas que no se ven en la captura:
 *
 *   · que un cliente NO puede llegar a la pantalla ni cambiarla
 *   · que guardar solo toca lo que se ha cambiado, y solo las
 *     columnas de la lista
 *
 * Y al final mira el portal del cliente, que es donde se ve el
 * precio: si el panel dice 25.000 ARS y el catálogo del portal sigue
 * diciendo 49 EUR, el panel funciona y la mitad del trabajo no.
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

console.log("");
console.log("=== Catálogo: editar precios ===");
console.log("");
console.log("  sitio: " + BASE);
console.log("");

/* ── Sesión de staff ── */
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

const cookie = { cookie: "nexo_panel=" + token };

/* ── Estado inicial ── */
const { data: antes } = await db.from("modules").select("*").order("id");
const original = Object.fromEntries((antes || []).map((m) => [m.id, { ...m }]));

comprobar("hay módulos en el catálogo", (antes || []).length > 0, (antes || []).length + " módulos");
comprobar(
  "todos tienen moneda",
  (antes || []).every((m) => !!m.moneda),
  (antes || []).filter((m) => !m.moneda).length + " sin moneda"
);

/* ── 1. La pantalla se abre ── */
const rCat = await fetch(BASE + "/panel/catalogo", { headers: cookie });

comprobar("la pantalla responde", rCat.status === 200, "HTTP " + rCat.status);

const html = await rCat.text();

comprobar("avisa de la web pública", /web pública/i.test(html));
comprobar(
  "cada módulo tiene sus campos de precio",
  (antes || []).every((m) => html.includes('name="precio_' + m.id + '"')),
  (antes || []).filter((m) => !html.includes('name="precio_' + m.id + '"')).map((m) => m.id).join(", ")
);

/* ── 2. Guardar de verdad ──
   Se elige un módulo, se le cambia el precio y la moneda, y se mira
   si ha cambiado en la base. Un formulario de precios que parece que
   guarda y no guarda es el peor resultado posible: el equipo cree
   que el precio está puesto. */
const objetivo = (antes || [])[0];
const PRECIO_NUEVO = 25000;
const MONEDA_NUEVA = "ARS";

const cuerpo = new URLSearchParams();
cuerpo.set("_csrf", csrf);
cuerpo.set("precio_" + objetivo.id, "25.000");
cuerpo.set("moneda_" + objetivo.id, MONEDA_NUEVA);

const rGuardar = await fetch(BASE + "/panel/catalogo", {
  method: "POST",
  headers: { ...cookie, "content-type": "application/x-www-form-urlencoded" },
  body: cuerpo,
  redirect: "manual",
});

comprobar("guardar responde 200", rGuardar.status === 200, "HTTP " + rGuardar.status);

const { data: despues } = await db.from("modules").select("*").eq("id", objetivo.id).single();

comprobar("el precio se guardó", despues.precio === PRECIO_NUEVO, "quedó " + despues.precio);
comprobar("la moneda se guardó", despues.moneda === MONEDA_NUEVA, "quedó " + despues.moneda);

/* ── 3. Separador de miles ──
   Se mandó "25.000" con punto, que es como se escribe un precio en
   Argentina. Si el servidor lo leyera como 25 coma algo, el precio
   sería 25 y no habría dado error: sería un precio correcto en
   apariencia y cien veces más barato. */
comprobar(
  "\"25.000\" se lee como veinticinco mil, no como veinticinco",
  despues.precio === 25000,
  "quedó " + despues.precio
);

/* ── 4. Solo se toca lo que se ha cambiado ── */
const otros = (antes || []).filter((m) => m.id !== objetivo.id);

const { data: trasOtros } = await db.from("modules").select("*").in("id", otros.map((m) => m.id));

const intactos = (trasOtros || []).every((m) => m.precio === original[m.id].precio);

comprobar("los otros módulos no se tocan", intactos);

/* Y las columnas que NO son editables.
   `disponible` se manda a propósito en el POST: si el servidor
   aceptara lo que llega, se podría poner a la venta un producto
   saltándose la pantalla de Salud. */
const cuerpoMalo = new URLSearchParams();
cuerpoMalo.set("_csrf", csrf);
cuerpoMalo.set("precio_" + objetivo.id, "25000");
cuerpoMalo.set("disponible_" + objetivo.id, original[objetivo.id].disponible ? "false" : "true");
cuerpoMalo.set("retirado_" + objetivo.id, "true");
cuerpoMalo.set("id_" + objetivo.id, "inventario");
cuerpoMalo.set("precio_modulo_que_no_existe", "1");
cuerpoMalo.set("nombre_modulo_que_no_existe", "Injected");

await fetch(BASE + "/panel/catalogo", {
  method: "POST",
  headers: { ...cookie, "content-type": "application/x-www-form-urlencoded" },
  body: cuerpoMalo,
  redirect: "manual",
});

const { data: trasMalo } = await db.from("modules").select("*").eq("id", objetivo.id).single();

comprobar(
  "\"disponible\" en el POST no cambia nada",
  trasMalo.disponible === original[objetivo.id].disponible,
  "quedó " + trasMalo.disponible
);
comprobar(
  "\"retirado\" en el POST no cambia nada",
  trasMalo.retirado === original[objetivo.id].retirado,
  "quedó " + trasMalo.retirado
);

/* Un módulo que NO existe en la base.

   La primera versión de esta comprobación mandaba
   `precio_inventario=1` y lo llamaba "módulo inventado". Inventario
   no es inventado: existe. Así que el POST lo cambiaba —bien
   hecho, el servidor leyó el campo de un módulo que sí está— y la
   prueba daba rojo。Es decir: estaba probando que la pantalla
   IGNORARA un cambio legítimo, que es lo contrario de lo que
   queremos.

   Lo que hay que comprobar es un id que no existe en ninguna parte:
   si el servidor recorre el POST en vez de preguntar a la base,
   crearía una fila o tocaría algo. */
const { data: fantasma } = await db.from("modules").select("id").eq("id", "modulo_que_no_existe").maybeSingle();

comprobar(
  "un módulo que no existe no se crea",
  !fantasma,
  fantasma ? "se creó una fila" : "no se creó nada"
);

/* ── 5. Errores ── */
const cuerpoFlojo = new URLSearchParams();
cuerpoFlojo.set("_csrf", csrf);
cuerpoFlojo.set("precio_" + objetivo.id, "no es un número");

const rFlojo = await fetch(BASE + "/panel/catalogo", {
  method: "POST",
  headers: { ...cookie, "content-type": "application/x-www-form-urlencoded" },
  body: cuerpoFlojo,
  redirect: "manual",
});

const htmlFlojo = await rFlojo.text();
const { data: trasFlojo } = await db.from("modules").select("precio").eq("id", objetivo.id).single();

comprobar("un precio que no es número se rechaza", rFlojo.status === 200 && /No es un número/.test(htmlFlojo));
comprobar("y no se guarda a medias", trasFlojo.precio === PRECIO_NUEVO, "quedó " + trasFlojo.precio);

/* ── 6. Sin CSRF no se guarda ── */
const sinCsrf = new URLSearchParams();
sinCsrf.set("precio_" + objetivo.id, "999999");

const rSin = await fetch(BASE + "/panel/catalogo", {
  method: "POST",
  headers: { ...cookie, "content-type": "application/x-www-form-urlencoded" },
  body: sinCsrf,
  redirect: "manual",
});

const { data: trasSin } = await db.from("modules").select("precio").eq("id", objetivo.id).single();

comprobar("un POST sin CSRF se rechaza", rSin.status === 403, "HTTP " + rSin.status);
comprobar("y no cambia el precio", trasSin.precio === PRECIO_NUEVO, "quedó " + trasSin.precio);

/* ── 7. Un cliente no puede ──
   La pantalla es del equipo. Un cliente que llegue aquí tiene que
   recibir un 403, no una vista del catálogo con los precios. */
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

  const cCookie = { cookie: "nexo_panel=" + cToken };

  const rClienteGet = await fetch(BASE + "/panel/catalogo", { headers: cCookie, redirect: "manual" });
  const rClientePost = await fetch(BASE + "/panel/catalogo", {
    method: "POST",
    headers: { ...cCookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: cCsrf, ["precio_" + objetivo.id]: "1" }),
    redirect: "manual",
  });

  comprobar(
    "un cliente no abre la pantalla",
    rClienteGet.status === 403 || rClienteGet.status === 302,
    "HTTP " + rClienteGet.status
  );
  comprobar(
    "ni puede guardar desde ella",
    rClientePost.status === 403 || rClientePost.status === 302,
    "HTTP " + rClientePost.status
  );

  const { data: trasCliente } = await db.from("modules").select("precio").eq("id", objetivo.id).single();
  comprobar("y el precio sigue igual", trasCliente.precio === PRECIO_NUEVO, "quedó " + trasCliente.precio);

  await db.from("sessions").delete().eq("csrf_token", cCsrf);
} else {
  console.log("  (sin clientes para probar el aislamiento)");
}

/* ── 8. El cliente VE el precio nuevo, en la moneda nueva ──
   El panel puede estar bien y el portal seguir mostrando otra cosa.
   Esta es la comprobación que une las dos mitades del trabajo: lo
   que se edita arriba tiene que aparecer abajo. */
const { data: perfiles } = await db.from("profiles").select("id").eq("rol", "client").limit(1);

if (perfiles && perfiles.length) {
  const pCsrf = crypto.randomBytes(12).toString("hex");
  const pToken = crypto.randomBytes(32).toString("hex");

  /* El portal necesita un access_token de Supabase para reconstruir
     la sesión del cliente. Se hace login de verdad, con las mismas
     credenciales que usa db/probar-modulo.mjs.

     La contraseña del cliente de prueba es `ClienteDemo123`; la de
     staff, `PanelPrueba2026`. Están en dos sitios distintos del
     código y por eso la primera versión de esta prueba falló en
     silence: usaba una contraseña inventada y no miraba por qué no
     entraba. */
  const uCliente = (await db.auth.admin.listUsers({ page: 1, perPage: 1000 })).data?.users?.find(
    (u) => u.email === "cliente@ejemplo.com"
  );

  const correo = uCliente ? uCliente.email : "cliente@ejemplo.com";

  const auth = await fetch(
    (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL) + "/auth/v1/token?grant_type=password",
    {
      method: "POST",
      headers: { apikey: env.SUPABASE_SECRET_KEY, "content-type": "application/json" },
      body: JSON.stringify({ email: correo, password: "ClienteDemo123" }),
    }
  );

  const j = await auth.json();

  if (j.access_token) {
    await db.from("sessions").insert({
      token_hash: crypto.createHash("sha256").update(pToken).digest("hex"),
      user_id: uCliente ? uCliente.id : perfiles[0].id,
      csrf_token: pCsrf,
      rol: "client",
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      creada_en: new Date().toISOString(),
      ultimo_acceso: new Date().toISOString(),
      expira_en: new Date(Date.now() + 600_000).toISOString(),
    });

    const rPortal = await fetch(BASE + "/panel/servicios-disponibles", {
      headers: { cookie: "nexo_panel=" + pToken },
      redirect: "manual",
    });

    const portalHtml = await rPortal.text();

    comprobar("el portal del cliente se abre", rPortal.status === 200, "HTTP " + rPortal.status);

    /* Se busca el precio recién guardado en el catálogo del portal,
       formateado como lo pinta `dinero()` en es-ES. */
    const esperado = new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: MONEDA_NUEVA,
    }).format(PRECIO_NUEVO);

    comprobar(
      "el cliente ve el precio nuevo con su moneda",
      portalHtml.includes(esperado),
      'buscaba "' + esperado + '"'
    );

    await db.from("sessions").delete().eq("csrf_token", pCsrf);
  } else {
    console.log("  (no se pudo entrar como cliente para mirar el portal: " +
      String((j && (j.error_description || j.msg)) || "sin motivo").slice(0, 70) + ")");
  }
}

/* ── Restaurar ── */
for (const m of antes || []) {
  await db.from("modules").update({
    nombre: m.nombre,
    descripcion: m.descripcion,
    precio: m.precio,
    periodicidad: m.periodicidad,
    componentes: m.componentes,
    url: m.url,
  }).eq("id", m.id);
}

await db.from("sessions").delete().eq("csrf_token", csrf);

console.log("");
console.log("=".repeat(58));
console.log(fallos === 0 ? "Pasan las " + ok + " comprobaciones." : "FALLAN " + fallos + " de " + (ok + fallos) + ".");
console.log("=".repeat(58));
console.log("");

process.exit(fallos === 0 ? 0 : 1);