/* =========================================================
   Nexo Studio — Tickets de soporte
   ------------------------------------------------------------
   node db/probar-tickets.mjs [--url http://127.0.0.1:3000]

   ── POR QUÉ ESTE ES CASI TODO CASOS NEGATIVOS ──

   Un ticket que se abre bien no dice nada de si está bien hecho.
   Lo que importa es lo que NO se puede hacer:

     · que un cliente vea el ticket de otro cliente
     · que un cliente escriba una nota interna
     · que un cliente lea una nota interna que escribió el equipo
     · que un cliente cierre su propio ticket
     · que un cliente escriba en el hilo de otro

   Esas cinco cosas son la diferencia entre un ticket y una fuga.
   Y las cinco se pueden comprobar sin que haya nada que instalar.

   ── EL ERROR QUE YA COMETI UNA VEZ ──

   La primera versión comprobaba que un cliente no pudiera crear
   una nota interna preguntando si el mensaje existía en la base.

   Existía, porque el mensaje se guarda siempre. La ruta pone
   `interno: false` a mano y no lee el campo del cuerpo, así que
   la nota se guardaba como PÚBLICA y la prueba daba verde por el
   motivo equivocado: por la respuesta buena, no por la razón
   buena.

   El caso era "el mensaje existe" cuando lo que se quiere saber
   es "el mensaje es interno". Son preguntas distintas, y la
   segunda es la que importa.

   Aquí se comprueba el VALOR. Y se mira también que el cliente no
   lo LEA, que es una defensa distinta: insertar y leer no fallan
   nunca a la vez.
   ========================================================= */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

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

let ok = 0;
let fallos = 0;

/* ── EL TEXTO EXTRA SOLO CUANDO FALLA ──

   `extra` es el detalle de POR QUÉ se ha fallado. Se escribía
   siempre, y eso imprimía, junto a un "OK" de la comprobación de
   que el cliente NO puede escribir notas internas, el texto "lo
   guardó con interno=true: el cliente puede escribir notas internas".

   Es un aviso de peligro pegado a un aprobado. Dentro de seis meses,
   alguien que mire el resultado de esta prueba lee esa frase, cree
   que hay una fuga y toca cosas que funcionan. La prueba que
   grita cuando no debe es tan inútil como la que llora siempre.

   Ahora el detalle solo sale si falla, y con la palabra FALLA. */
const comprobar = (txt, cond, extra) => {
  if (cond) {
    console.log("  OK     " + txt);
    ok++;
  } else {
    console.log("  FALLA  " + txt);
    if (extra) console.log("         ↳ " + extra);
    fallos++;
  }
};

const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const clave = env.SUPABASE_SECRET_KEY;

const db = createClient(url, clave, { auth: { persistSession: false } });

/* El cliente de administracion de `auth`. Necesario para crear el
   usuario real de la prueba de aislamiento: no basta con insertar
   una fila en `profiles`, porque su id tiene clave foránea a
   `auth.users`. */
const supabaseAdmin = createClient(url, clave, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: staffs } = await db.from("profiles").select("id").eq("rol", "staff").limit(1);
let { data: clientes } = await db.from("profiles").select("id,client_id").eq("rol", "client").limit(2);

if (!staffs || !staffs.length) {
  console.log("  hace falta 1 perfil de staff");
  process.exit(1);
}

/* ── EL SEGUNDO CLIENTE SE MONTA AQUÍ, Y SE BORRA AL FINAL ──

   Solo hay UN perfil de cliente en la base: Marina Soler, de
   Panadería La Espiga. Y sin dos clientes no se puede probar la
   cosa más importante de todas: que el cliente A no vea lo del
   cliente B.

   Esa prueba es la razón de existir de este archivo. Si hace falta
   montar un segundo cliente para poder hacerla, se monta y se
   borra.

   El usuario se crea en `auth.users` y no solo en `profiles`, porque
   `profiles.id` tiene clave foránea a `auth.users.id`. Insertar la
   fila a pelo falla con `profiles_id_fkey`, que es exactamente lo
   que pasó la primera vez.

   Se reutiliza una empresa que ya existe y a la que no apunta
   ningún perfil, para no crear ni borrar fichas de cliente: si el
   perfil queda sin borrar un día, no deja una empresa fantasma. */
const idsBorrar = [];

if (!clientes || clientes.length < 2) {
  const real = clientes && clientes[0] ? clientes[0].client_id : null;

  const { data: ocupados } = await db.from("profiles").select("client_id").not("client_id", "is", null);
  const enUso = new Set((ocupados || []).map((p) => p.client_id));

  const { data: candidatos } = await db
    .from("clients")
    .select("id,empresa")
    .neq("id", real || "00000000-0000-0000-0000-000000000000")
    .limit(20);

  const libre = (candidatos || []).find((c) => !enUso.has(c.id));

  if (!libre) {
    console.log("  hace falta una empresa sin perfil para probar el aislamiento");
    process.exit(1);
  }

  const email = "prueba-tickets-" + Date.now() + "@ejemplo.com";

  const { data: creado, error: errorAuth } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: crypto.randomBytes(18).toString("hex"),
    email_confirm: true,
  });

  if (errorAuth || !creado || !creado.user) {
    console.log("  no se pudo crear el usuario de prueba: " + (errorAuth ? errorAuth.message : "?"));
    process.exit(1);
  }

  const idPerfil = creado.user.id;
  idsBorrar.push({ perfil: idPerfil, correo: email });

  const { error } = await db.from("profiles").insert({
    id: idPerfil,
    rol: "client",
    client_id: libre.id,
    nombre: "Cliente de prueba",
    activo: true,
    creado_en: new Date().toISOString(),
  });

  if (error) {
    await supabaseAdmin.auth.admin.deleteUser(idPerfil);
    console.log("  no se pudo crear el perfil de prueba: " + error.message);
    process.exit(1);
  }

  clientes = [
    { id: (clientes && clientes[0] && clientes[0].id) || idPerfil, client_id: real },
    { id: idPerfil, client_id: libre.id },
  ];
}

const csfrs = [];

async function sesion(perfil, rol) {
  const token = crypto.randomBytes(32).toString("hex");
  const csrf = crypto.randomBytes(12).toString("hex");
  csfrs.push(csrf);

  await db.from("sessions").insert({
    token_hash: crypto.createHash("sha256").update(token).digest("hex"),
    user_id: perfil.id,
    csrf_token: csrf,
    rol,
    creada_en: new Date().toISOString(),
    ultimo_acceso: new Date().toISOString(),
    expira_en: new Date(Date.now() + 1800_000).toISOString(),
  });

  return { token, csrf, id: perfil.id, client: perfil.client_id || null };
}

const staff = await sesion(staffs[0], "staff");
const clienteA = await sesion(clientes[0], "client");
const clienteB = await sesion(clientes[1], "client");

const pedir = (u, s, opt = {}) =>
  fetch(BASE + u, {
    redirect: "manual",
    ...opt,
    headers: { cookie: "nexo_panel=" + s.token, ...(opt.headers || {}) },
  });

const form = (s, datos) =>
  pedir(s.__ruta || "", s, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: s.csrf, ...datos }).toString(),
  });

/* ── Arranque ──────────────────────────────────────────── */

const ahora = new Date().toISOString();
const sello = Date.now();

/* Los asuntos se guardan aparte porque el `.select("id")` de abajo
   solo devuelve el id. Acordarse de que `tA.asunto` no existe
   cuesta un `TypeError` a mitad de la prueba, con datos ya
   creados en la base. */
const asuntoA = "Prueba " + sello + ": el bot no responde";
const asuntoB = "Prueba " + sello + ": aviso del otro cliente";

const { data: tA } = await db
  .from("soporte_tickets")
  .insert({
    cliente_id: clienteA.client,
    asunto: asuntoA,
    estado: "abierto",
    creado_en: ahora,
    actualizado_en: ahora,
  })
  .select("id")
  .single();

const { data: tB } = await db
  .from("soporte_tickets")
  .insert({
    cliente_id: clienteB.client,
    asunto: asuntoB,
    estado: "abierto",
    creado_en: ahora,
    actualizado_en: ahora,
  })
  .select("id")
  .single();

await db.from("soporte_mensajes").insert([
  {
    ticket_id: tA.id,
    autor_id: clienteA.id,
    autor_rol: "cliente",
    cuerpo: "Mensaje publico del cliente A.",
    interno: false,
    creado_en: ahora,
  },
  {
    ticket_id: tA.id,
    autor_id: staff.id,
    autor_rol: "staff",
    cuerpo: "PALABRA_SECRETA: estamos mirando la plantilla de Evolution.",
    interno: true,
    creado_en: ahora,
  },
]);

console.log("");
/* =========================================================
   LA LIMPIEZA, Y POR QUE ESTA FUERA DEL CAMINO FELIZ
   =========================================================

   La primera versión de esta prueba limpiaba al final, en línea recta.
   Dos veces se quedó a medias: el `TypeError` de `tA.asunto` y el de
   `rows` saltaron DESPUÉS de crear los tickets, así que el `process.exit`
   nunca llegó y quedaron cuatro tickets de "Prueba 1791312..." en la base
   de PRODUCCIÓN. Aparecieron luego en el contador del lateral como
   trabajo pendiente que nadie había pedido.

   Es el mismo fallo que ya tuvo `db/test-acceso-servicio.js`, que se
   arregló envolviendo la limpieza. Aquí se hace igual, y con una
   diferencia que importa:

   La limpieza NO usa `tA`, `tB` ni `tNuevo`. Esas variables se crean
   DENTRO del `try`, y si el `try` peta a mitad puede que ni siquiera
   existan — y una limpieza que depende de variables que aún no existen
   es una limpieza que no se ejecuta justo cuando hace falta.

   Se borra por el PREFIJO del asunto, `Prueba <sello>`, que se conoce
   desde el principio. Con eso no importa en qué punto se pare: se
   lleva todo lo que este intento haya creado, y nada más.
   ========================================================= */
async function limpiar() {
  try {
    /* Los mensajes primero: los tickets tienen la referencia y con
       `cascade` tambien se irian, pero se borran explicitamente para
       que el borrado no dependa de que la FK tenga ON DELETE. */
    const { data: mios } = await db
      .from("soporte_tickets")
      .select("id")
      .like("asunto", "Prueba " + sello + "%");

    const ids = (mios || []).map((t) => t.id);
    if (ids.length) {
      await db.from("soporte_mensajes").delete().in("ticket_id", ids);
      await db.from("soporte_tickets").delete().in("id", ids);
    }

    for (const c of csfrs) await db.from("sessions").delete().eq("csrf_token", c);

    /* El segundo cliente se borra el último: mientras viva, cualquier
       petición posterior tiene un perfil real y da un 404 por
       aislamiento de verdad, no un 302 por sesión inválida. */
    for (const u of idsBorrar) {
      await db.from("sessions").delete().eq("user_id", u.perfil);
      await db.from("profiles").delete().eq("id", u.perfil);
      await supabaseAdmin.auth.admin.deleteUser(u.perfil);
    }

    if (ids.length) console.log("  (limpiados " + ids.length + " tickets de prueba)");
  } catch (e) {
    /* Que la limpieza falle no puede tapar el motivo del fallo, ni
       impedir que la prueba salga con código de error. */
    console.log("  AVISO: la limpieza falló: " + e.message);
    fallos++;
  }
}

let peto = null;

try {
console.log("=== Tickets de soporte ===");
console.log("");
console.log("  sitio: " + BASE);
console.log("");

/* ── 1. El equipo lo ve entero ─────────────────────────── */

{
  const lista = await pedir("/panel/tickets", staff);
  comprobar("el equipo ve la lista", lista.status === 200, "HTTP " + lista.status);

  const html = await lista.text();
  comprobar(
    "la lista trae el ticket",
    html.includes(asuntoA),
    "falta: " + asuntoA.slice(0, 40)
  );

  const detalle = await pedir("/panel/tickets/" + tA.id, staff);
  const dhtml = await detalle.text();
  comprobar("el equipo abre el detalle", detalle.status === 200, "HTTP " + detalle.status);

  /* La nota interna la ve el equipo. Tiene que: para eso existe. */
  comprobar(
    "el equipo ve la nota interna",
    dhtml.includes("PALABRA_SECRETA"),
    "una nota interna que no ve el equipo no sirve de nada"
  );

  const filtrado = await pedir("/panel/tickets?estado=abierto", staff);
  comprobar("el filtro de estado responde", filtrado.status === 200, "HTTP " + filtrado.status);

  const buscar = await pedir("/panel/tickets?q=" + encodeURIComponent(String(sello)), staff);
  const bhtml = await buscar.text();
  comprobar("el buscador encuentra por asunto", bhtml.includes("Prueba " + sello), "HTTP " + buscar.status);
}

/* ── 2. El cliente ve lo suyo y solo lo suyo ───────────── */

{
  const lista = await pedir("/panel/mis-tickets", clienteA);
  const lhtml = await lista.text();
  comprobar("el cliente ve su lista", lista.status === 200, "HTTP " + lista.status);
  comprobar("el cliente ve su ticket", lhtml.includes(asuntoA));

  /* ── EL CASO QUE IMPORTA ── */
  comprobar(
    "el cliente NO ve el ticket del otro",
    !lhtml.includes(asuntoB),
    "la lista del cliente A mentiona el asunto del cliente B"
  );

  const suyo = await pedir("/panel/mis-tickets/" + tA.id, clienteA);
  comprobar("el cliente abre su ticket", suyo.status === 200, "HTTP " + suyo.status);

  /* Cambiando el id en la URL. */
  const ajeno = await pedir("/panel/mis-tickets/" + tB.id, clienteA);
  comprobar(
    "con el id del otro por URL tampoco entra",
    ajeno.status === 404,
    "HTTP " + ajeno.status + " (esperaba 404)"
  );

  const nuevo = await pedir("/panel/mis-tickets/nuevo", clienteA);
  comprobar("el formulario de abrir existe", nuevo.status === 200, "HTTP " + nuevo.status);
}

/* ── 3. La nota interna no sale hacia el cliente ───────── */

{
  const suyo = await pedir("/panel/mis-tickets/" + tA.id, clienteA);
  const html = await suyo.text();

  comprobar(
    "el cliente NO ve la nota interna",
    !html.includes("PALABRA_SECRETA"),
    "el texto interno llego al HTML del cliente"
  );

  /* Y tampoco por la lista, ni por un buscador. */
  const lista = await pedir("/panel/mis-tickets", clienteA);
  const lhtml = await lista.text();
  comprobar("tampoco en su lista", !lhtml.includes("PALABRA_SECRETA"));

  /* El mensaje publico si tiene que estar. Si esto falla, lo de
     arriba pasaria por el motivo equivocado: que no se pinta NADA. */
  comprobar(
    "pero si ve el mensaje publico",
    html.includes("Mensaje publico del cliente A"),
    "si esto falla, la prueba anterior no vale: no se veria ni lo publico"
  );
}

/* ── 4. El cliente no puede escribir una nota interna ──── */

{
  await form(
    { ...clienteA, __ruta: "/panel/mis-tickets/" + tA.id + "/mensaje" },
    { cuerpo: "INTENTO nota interna desde el cliente", interno: "1" }
  );

  const { data: rows } = await db
    .from("soporte_mensajes")
    .select("interno")
    .eq("ticket_id", tA.id)
    .ilike("cuerpo", "%INTENTO nota interna desde el cliente%");

  /* El VALOR, no la existencia. Ver la cabecera: la primera versión
     preguntaba si existía y daba verde con el mensaje guardado
     como público. */
  const seGuardo = (rows || []).length > 0;
  const comoInterna = (rows || []).some((r) => r.interno === true);

  comprobar(
    "el mensaje se guarda como PUBLICO, no interno",
    !comoInterna,
    seGuardo ? "lo guardo con interno=true: el cliente puede escribir notas internas" : "no lo guardo"
  );

  /* Y no puede leer lo que acaba de escribir como si fuera
     interno: la vista del cliente filtra por interno=false. */
  const suyo = await pedir("/panel/mis-tickets/" + tA.id, clienteA);
  const html = await suyo.text();
  comprobar(
    "el cliente ve su propio mensaje (no se perderia)",
    html.includes("INTENTO nota interna desde el cliente") || !seGuardo
  );
}

/* ── 5. El cliente no puede tocar el estado ────────────── */

{
  const antes = await db.from("soporte_tickets").select("estado").eq("id", tA.id).single();

  await form(
    { ...clienteA, __ruta: "/panel/tickets/" + tA.id + "/estado" },
    { estado: "resuelto" }
  );

  const despues = await db.from("soporte_tickets").select("estado").eq("id", tA.id).single();

  comprobar(
    "el cliente no puede marcar su ticket como resuelto",
    despues.data.estado === antes.data.estado,
    "estado: " + antes.data.estado + " -> " + despues.data.estado
  );
}

/* ── 6. El cliente no escribe en el hilo de otro ───────── */

{
  await form(
    { ...clienteA, __ruta: "/panel/mis-tickets/" + tB.id + "/mensaje" },
    { cuerpo: "INTENTO escribir en el ticket de otro" }
  );

  const { data: intrusos } = await db
    .from("soporte_mensajes")
    .select("id")
    .eq("ticket_id", tB.id)
    .ilike("cuerpo", "%INTENTO escribir en el ticket de otro%");

  comprobar(
    "el cliente no escribe en el hilo de otro",
    (intrusos || []).length === 0,
    (intrusos || []).length + " mensajes intrusos"
  );
}

/* ── 7. Abrir un ticket, de verdad ─────────────────────── */

let tNuevo = null;
{
  const r = await form(
    { ...clienteA, __ruta: "/panel/mis-tickets" },
    { asunto: "Prueba " + sello + ": subject valido", cuerpo: "Cuerpo con suficiente longitud." }
  );

  const destino = r.headers.get("location") || "";
  comprobar("abrir un ticket redirige a su detalle", destino.includes("/panel/mis-tickets/"), destino.slice(0, 60));

  const id = destino.split("/").pop();
  if (id) {
    tNuevo = id;
    const { data: nuevo } = await db
      .from("soporte_tickets")
      .select("id,estado")
      .eq("id", id)
      .maybeSingle();

    comprobar("el ticket existe", !!nuevo);

    const { data: primerMensaje } = await db
      .from("soporte_mensajes")
      .select("cuerpo")
      .eq("ticket_id", id);

    comprobar(
      "el primer mensaje se guarda con el ticket",
      (primerMensaje || []).some((m) => m.cuerpo === "Cuerpo con suficiente longitud."),
      "un ticket sin texto no se puede contestar bien"
    );
  }

  /* Asunto demasiado corto: tiene que rebotar. */
  const corto = await form(
    { ...clienteA, __ruta: "/panel/mis-tickets" },
    { asunto: "ayuda", cuerpo: "Cuerpo con suficiente longitud." }
  );
  comprobar(
    "un asunto corto se rechaza",
    corto.status === 400 || (corto.headers.get("location") || "").endsWith("/mis-tickets"),
    "HTTP " + corto.status
  );
}

/* ── 8. Resolver y reabrir ─────────────────────────────── */

{
  await form({ ...staff, __ruta: "/panel/tickets/" + tA.id + "/estado" }, { estado: "resuelto" });

  const res = await db.from("soporte_tickets").select("estado,resuelto_en").eq("id", tA.id).single();
  comprobar("el equipo puede resolver", res.data.estado === "resuelto");
  comprobar("guarda cuando se resolvió", Boolean(res.data.resuelto_en));

  /* El equipo contesta a un resuelto: NO se reabre. */
  await form({ ...staff, __ruta: "/panel/tickets/" + tA.id + "/mensaje" }, { cuerpo: "Mensaje del equipo sobre un resuelto." });
  const trasEquipo = await db.from("soporte_tickets").select("estado").eq("id", tA.id).single();
  comprobar(
    "el equipo contestando NO reabre un resuelto",
    trasEquipo.data.estado === "resuelto",
    "quedo en " + trasEquipo.data.estado
  );

  /* El cliente responde: sí se reabre. */
  await form({ ...clienteA, __ruta: "/panel/mis-tickets/" + tA.id + "/mensaje" }, { cuerpo: "Sigue fallando, gracias." });
  const trasCliente = await db.from("soporte_tickets").select("estado,resuelto_en").eq("id", tA.id).single();
  comprobar(
    "el cliente escribiendo en un resuelto lo reabre",
    trasCliente.data.estado === "abierto",
    "quedo en " + trasCliente.data.estado
  );
  comprobar(
    "y se borra la fecha de resuelto",
    trasCliente.data.resuelto_en === null,
    "la fecha seguia puesta y 'resuelto hace X dias' seria mentira"
  );
}

/* ── 9. Contestar mueve de abierto a en curso ──────────── */

{
  const { data: tC } = await db
    .from("soporte_tickets")
    .insert({ cliente_id: clienteA.client, asunto: "Prueba " + sello + ": en curso", estado: "abierto", creado_en: ahora, actualizado_en: ahora })
    .select("id")
    .single();

  await form({ ...staff, __ruta: "/panel/tickets/" + tC.id + "/mensaje" }, { cuerpo: "Estamos en ello." });
  const tras = await db.from("soporte_tickets").select("estado").eq("id", tC.id).single();
  comprobar(
    "contestar pasa de abierto a en curso",
    tras.data.estado === "en_curso",
    "quedo en " + tras.data.estado
  );

  /* Una nota interna NO cuenta como respuesta: es para el equipo. */
  const { data: tD } = await db
    .from("soporte_tickets")
    .insert({ cliente_id: clienteA.client, asunto: "Prueba " + sello + ": solo interna", estado: "abierto", creado_en: ahora, actualizado_en: ahora })
    .select("id")
    .single();

  await form({ ...staff, __ruta: "/panel/tickets/" + tD.id + "/mensaje" }, { cuerpo: "Nota para nosotros.", interno: "1" });
  const trasNota = await db.from("soporte_tickets").select("estado").eq("id", tD.id).single();
  comprobar(
    "una nota interna NO cambia el estado",
    trasNota.data.estado === "abierto",
    "quedo en " + trasNota.data.estado
  );

  await db.from("soporte_tickets").delete().eq("id", tC.id);
  await db.from("soporte_tickets").delete().eq("id", tD.id);
}

/* ── 10. El contador del lateral ───────────────────────── */

{
  await db.from("soporte_tickets").insert({
    cliente_id: clienteA.client,
    asunto: "Prueba " + sello + ": para el contador",
    estado: "en_curso",
    creado_en: ahora,
    actualizado_en: ahora,
  });

  const hoy = new Date().toISOString().slice(0, 10);
  const { count: esperados } = await db
    .from("soporte_tickets")
    .select("id", { count: "exact", head: true })
    .in("estado", ["abierto", "en_curso"]);

  const html = await (await pedir("/panel", staff)).text();
  const badge = html.match(/title="(\d+) tickets? sin resolver"/);

  comprobar(
    "el contador del lateral coincide con la base",
    badge && Number(badge[1]) === (esperados || 0),
    "base " + (esperados || 0) + ", pintado " + (badge ? badge[1] : "nada")
  );

  void hoy;
}

} catch (e) {
  /* Un fallo unexpectedo NO se traga. Se anota y se sigue a la
     limpieza, para que el error real salga en pantalla y no se
     confunda con un fallo de comprobación. */
  peto = e;
  console.log("");
  console.log("  La prueba se ha parado a mitad: " + (e && e.message ? e.message : e));
} finally {
  await limpiar();
}

if (peto) {
  console.log("");
  console.log("=".repeat(58));
  console.log("La prueba no ha podido terminar. Se han limpiado los datos.");
  console.log("=".repeat(58));
  console.log("");
  process.exit(1);
}

console.log("");
console.log("=".repeat(58));
console.log(fallos === 0 ? "Pasan las " + ok + " comprobaciones." : "FALLAN " + fallos + " de " + (ok + fallos) + ".");
console.log("=".repeat(58));
console.log("");

process.exit(fallos === 0 ? 0 : 1);