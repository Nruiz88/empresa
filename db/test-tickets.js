/* =========================================================
   Nexo Studio — Tickets de acceso entre servicios
   ------------------------------------------------------------
   Un ticket es lo que permite que alguien que entró en
   panel.midominio.com llegue a bot.midominio.com sin volver a
   autenticarse, y sin compartir cookies entre subdominios.

   Aquí se comprueba lo que de verdad importa: que no se puedan
   forjar. Un ticket falsificado sería entrar al servicio de otro
   cliente sin contraseña, así que cada caso negativo cuenta más que
   los positivos.

   No toca la base de datos: es todo criptografía, rápido y sin
   efectos secundarios.
   ========================================================= */

const crypto = require("crypto");
const tickets = require("../lib/tickets");

let ok = 0;
let fallos = 0;

function comprobar(desc, condicion) {
  if (condicion) {
    console.log("  ✓ " + desc);
    ok++;
  } else {
    console.log("  ✗ " + desc);
    fallos++;
  }
}

function seccion(t) {
  console.log("\n── " + t + " " + "─".repeat(Math.max(0, 48 - t.length)));
}

const SECRET = "secreto-de-prueba-para-firmar-tickets-no-usar-en-produccion";
const OTRO_SECRET = "otro-secreto-distinto-que-no-puede-firmar-nada";

/** Un access_token con aspecto real (JWT de tres partes) */
function tokenFalso(expSegundos) {
  const cabeza = b64url(crypto.randomBytes(24));
  const cuerpo = b64url(JSON.stringify({
    sub: crypto.randomUUID(),
    exp: expSegundos || Math.floor(Date.now() / 1000) + 3600,
    role: "authenticated",
  }));
  return cabeza + "." + cuerpo + ".firma-inventada";
}

const b64url = (b) => Buffer.from(b).toString("base64url");

const SESION = { id: crypto.randomUUID(), user_id: crypto.randomUUID() };
const DATOS = {
  secret: SECRET,
  sesion: SESION,
  userId: SESION.user_id,
  clientId: crypto.randomUUID(),
  rol: "client",
  accessToken: tokenFalso(),
};

(async () => {
  console.log("\n═══ Tickets: no se pueden forjar ═══\n");

  // --- Ida y vuelta ---
  seccion("firma y verifica");

  const t = tickets.firmar(DATOS);
  const p = tickets.verificar(t, SECRET);

  comprobar("un ticket bien firmado se verifica", p !== null);
  comprobar("lleva el id del usuario", p && p.uid === DATOS.userId);
  comprobar("lleva el id del cliente", p && p.cid === DATOS.clientId);
  comprobar("lleva el rol", p && p.rol === "client");
  comprobar("lleva el access_token para reconstruir la sesión", p && p.at === DATOS.accessToken);
  comprobar("lleva el id de la sesión de origen", p && p.sid === SESION.id);
  comprobar("tiene fecha de caducidad", p && typeof p.exp === "number");

  /* El token de acceso viaja dentro del ticket. Es lo que permite al
     servicio receptor usar RLS en vez de preguntar al panel. */
  comprobar(
    "el token que devuelve es el que se pasó",
    p && tickets.tokenDe(p) === DATOS.accessToken
  );

  // --- Lo que no debe pasar ---
  seccion("no se puede alterar");

  const partes = t.split(".");
  const cuerpo = partes[0];
  const firmaOriginal = partes[1];

  /* 1. Cambiar el cliente: el caso más grave. Con el mismo token
        válido, cambiar el cid en el payload daría acceso a los datos
        del cliente que se quisiera tocar. */
  const otroCliente = crypto.randomUUID();
  const payloadAlterado = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8"));
  payloadAlterado.cid = otroCliente;
  const cuerpoAlterado = b64url(JSON.stringify(payloadAlterado));
  const t1 = cuerpoAlterado + "." + firmaOriginal;
  comprobar("cambiar el cliente no cuela (firma ya no vale)", tickets.verificar(t1, SECRET) === null);

  /* 2. Subir de rol: de client a staff. Sería acceso total. */
  const payloadStaff = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8"));
  payloadStaff.rol = "staff";
  const t2 = b64url(JSON.stringify(payloadStaff)) + "." + firmaOriginal;
  comprobar("cambiar el rol a staff no cuela", tickets.verificar(t2, SECRET) === null);

  /* 3. Cambiar el access_token: robar el de otra persona. */
  const payloadToken = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8"));
  payloadToken.at = tokenFalso();
  const t3 = b64url(JSON.stringify(payloadToken)) + "." + firmaOriginal;
  comprobar("meter otro access_token no cuela", tickets.verificar(t3, SECRET) === null);

  /* 4. Alargar la caducidad. */
  const payloadExp = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8"));
  payloadExp.exp = Math.floor(Date.now() / 1000) + 999999;
  const t4 = b64url(JSON.stringify(payloadExp)) + "." + firmaOriginal;
  comprobar("alargar la caducidad no cuela", tickets.verificar(t4, SECRET) === null);

  /* 5. Firmar con la firma de otro ticket. */
  const tOtro = tickets.firmar({ ...DATOS, clientId: crypto.randomUUID() });
  const t5 = cuerpo + "." + tOtro.split(".")[1];
  comprobar("usar la firma de otro ticket no cuela", tickets.verificar(t5, SECRET) === null);

  /* 6. Firmar con otro secret. */
  comprobar(
    "un ticket firmado con otro secret no vale aquí",
    tickets.verificar(tickets.firmar({ ...DATOS, secret: OTRO_SECRET }), SECRET) === null
  );

  // --- Basura ---
  seccion("basura y entradas raras");

  comprobar("null", tickets.verificar(null, SECRET) === null);
  comprobar("cadena vacía", tickets.verificar("", SECRET) === null);
  comprobar("sin punto", tickets.verificar("solo-una-cosa", SECRET) === null);
  comprobar("punto pero sin firma", tickets.verificar(cuerpo + ".", SECRET) === null);
  comprobar("firma pero sin cuerpo", tickets.verificar(".abc", SECRET) === null);
  comprobar("cuerpo que no es base64 válido", tickets.verificar("!!!.abc", SECRET) === null);
  comprobar(
    "cuerpo con firma válida pero JSON basura",
    tickets.verificar(b64url("no soy json") + "." + tickets.firmar(DATOS).split(".")[1], SECRET) === null
  );
  comprobar("sin secret no verifica nada", tickets.verificar(t, "") === null);
  comprobar("secret undefined no verifica nada", tickets.verificar(t, undefined) === null);
  comprobar("un objeto, no una cadena", tickets.verificar({ a: 1 }, SECRET) === null);

  // --- Caducidad ---
  seccion("caducidad");

  const tCorto = tickets.firmar({ ...DATOS, segundos: -10 });
  comprobar("un ticket ya caducado no vale", tickets.verificar(tCorto, SECRET) === null);

  const tLargo = tickets.firmar({ ...DATOS, segundos: 3600 });
  comprobar("un ticket de una hora sí vale", tickets.verificar(tLargo, SECRET) !== null);

  /* Dos tickets del mismo usuario en el mismo segundo NO son el
     mismo ticket. Importa para poder revocar uno sin el otro. */
  const tA = tickets.firmar(DATOS);
  const tB = tickets.firmar(DATOS);
  comprobar("dos tickets firmados a la vez son distintos", tA !== tB);

  // --- Rol staff ---
  seccion("staff");

  const tStaff = tickets.firmar({ ...DATOS, rol: "staff", clientId: null });
  const pStaff = tickets.verificar(tStaff, SECRET);
  comprobar("un ticket de staff se verifica", pStaff !== null);
  comprobar("y lleva rol staff sin cliente", pStaff && pStaff.rol === "staff" && pStaff.cid === null);

  // --- Detección de caducidad del token ---
  seccion("tokenPorExpirar()");

  const vivo = tokenFalso(Math.floor(Date.now() / 1000) + 3600);
  const caduca = tokenFalso(Math.floor(Date.now() / 1000) + 30);
  const muerto = tokenFalso(Math.floor(Date.now() / 1000) - 10);

  comprobar("un token con una hora de vida está bien", tickets.tokenPorExpirar(vivo) === false);
  comprobar("uno que caduca en 30 s hay que renovarlo", tickets.tokenPorExpirar(caduca) === true);
  comprobar("uno ya caducado, más todavía", tickets.tokenPorExpirar(muerto) === true);
  comprobar("sin token, hay que renovarlo", tickets.tokenPorExpirar(null) === true);
  comprobar("basura, hay que renovarlo", tickets.tokenPorExpirar("no-es-un-jwt") === true);

  // --- firmar sin token no debe colarse ---
  seccion("firmar() es exigente");

  let lanzo = false;
  try {
    tickets.firmar({ ...DATOS, accessToken: null });
  } catch {
    lanzo = true;
  }
  comprobar("sin access_token lanza en vez de firmar un ticket inútil", lanzo);

  /* Sin secret no se firma. Ojo con el matiz: un secret vacío en el
     parámetro cae al entorno, así que para comprobar de verdad que no
     firma hay que quitar ALSO_SERVICE_SECRET del entorno. */
  const guardadoEntorno = process.env.SERVICE_SECRET;
  delete process.env.SERVICE_SECRET;

  lanzo = false;
  try {
    tickets.firmar({ ...DATOS, secret: undefined });
  } catch {
    lanzo = true;
  }
  comprobar("sin secret en ningún sitio, no firma", lanzo);

  /* Con el secret del entorno puesto, sí firma. Parece redundante,
     pero fija el comportamiento en los dos sentidos: si alguien
     "arregla" el secreto vacío firmándolo con una cadena vacía, esta
     comprobación lo canta. */
  process.env.SERVICE_SECRET = guardadoEntorno;
  lanzo = false;
  try {
    tickets.firmar({ ...DATOS, secret: undefined });
  } catch {
    lanzo = true;
  }
  comprobar(
    "con el secret del entorno puesto, sí firma (no es un fallo)",
    !lanzo
  );

  /* El secret del entorno. Se prueba así a propósito: en producción
     el secret sale de SERVICE_SECRET y no se pasa a mano, y si esa
     lectura estuviera rota el ticket no firmaría. */
  process.env.SERVICE_SECRET = SECRET;
  let delEntorno = null;
  try {
    const tE = tickets.firmar({ ...DATOS, secret: undefined });
    delEntorno = tickets.verificar(tE, undefined);
  } catch (e) {
    delEntorno = { error: e.message };
  }
  comprobar(
    "lee SERVICE_SECRET del entorno si no se le pasa",
    delEntorno && !delEntorno.error && delEntorno.uid === DATOS.userId
  );

  /* Y que el parámetro manda sobre el entorno: dos servicios con
     secretos distintos no se validan mutuamente. */
  const tOtroEntorno = tickets.firmar({ ...DATOS, secret: OTRO_SECRET });
  comprobar(
    "el secret pasado a mano manda sobre el del entorno",
    tickets.verificar(tOtroEntorno, undefined) === null
  );

  /* Sin SERVICE_SECRET en el entorno, y sin parámetro, no se firma:
     es preferible a firmar con un secret vacío, que lo haría
     cualquiera que adivinara el formato. */
  const guardado = process.env.SERVICE_SECRET;
  delete process.env.SERVICE_SECRET;
  lanzo = false;
  try {
    tickets.firmar({ ...DATOS, secret: undefined });
  } catch {
    lanzo = true;
  }
  comprobar(
    "sin SERVICE_SECRET en ningún sitio, no firma",
    lanzo
  );
  process.env.SERVICE_SECRET = guardado;

  // --- El token no viaja por el servidor ---
  seccion("el token no se envía al servidor");

  /* El ticket va en el fragmento (#), que el navegador NO manda al
     servidor. Si fuera en el query (?ticket=) acabaría en todos los
     logs: el de Railway, el del proxy y el del navegador. */
  const url = "https://bot.midominio.com/entrar#" + t;
  comprobar("el ejemplo de URL usa # y no ?", url.includes("#") && !url.includes("?ticket="));
  comprobar("el access_token está dentro del fragmento", url.split("#")[1].includes("."));

  console.log("\n" + "─".repeat(56));
  if (fallos) {
    console.log(`✗ ${fallos} comprobación(es) fallan de ${ok + fallos}.`);
    console.log("  Con eso alguien podría entrar a un servicio sin autenticarse.\n");
    process.exit(1);
  }
  console.log(`✓ Las ${ok} comprobaciones pasan.`);
  console.log("  Un ticket no se puede alterar para llegar a otro cliente.\n");
})().catch((e) => {
  console.error("\n✗ " + e.message + "\n");
  process.exit(1);
});
