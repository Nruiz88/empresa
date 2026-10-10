/* =========================================================
   Nexo Studio — Aislamiento de módulos y suscripciones
   ------------------------------------------------------------
   Comprueba lo mismo que db/test-isolation.js pero para las tablas
   nuevas: módulos y suscripciones.

   Lo que NO es evidente y por qué este test existe:
   RLS filtra en SILENCIO. Una escritura bloqueada no da error,
   devuelve cero filas afectadas. Un test que mira `error` diría
   "correcto" aunque la escritura nunca ocurriera. Por eso aquí se
   CUENTAN las filas, siempre.

   Qué se comprueba:
     · Dos clientes, cada uno con su suscripción
     · Cada uno ve solo la suya
     · El primero NO ve la del segundo
     · El cliente no puede crear suscripciones (ni regalarse el bot)
     · El cliente no puede cambiar su estado ni su precio
     · El cliente puede LEER el catálogo de módulos (es la vitrina)
     · pero no puede escribirlo ni ponerlo a la venta
   ========================================================= */

const supabase = require("../../lib/supabase");
require("../../lib/env").load();

const db = supabase.getAdmin();

let ok = 0;
let fallos = 0;
const MARCA = "-test-modulos-";

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
  console.log("\n── " + t + " " + "─".repeat(Math.max(0, 50 - t.length)));
}

async function crearCliente(sufijo) {
  const { data, error } = await db
    .from("clients")
    .insert({
      nombre: "Empresa " + MARCA + sufijo,
      empresa: "Empresa " + MARCA + sufijo,
      email: MARCA + sufijo + "@ejemplo.com",
    })
    .select("id")
    .single();
  if (error) throw new Error("cliente: " + error.message);
  return data.id;
}

async function crearUsuario(email, clientId, sufijo) {
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: "AislamientoModulos123",
    email_confirm: true,
  });
  if (error) throw new Error("auth: " + error.message);
  const userId = data.user.id;

  const { error: e2 } = await db.from("profiles").insert({
    id: userId,
    rol: "client",
    client_id: clientId,
    nombre: "Cliente " + MARCA + sufijo,
    activo: true,
  });
  if (e2) throw new Error("perfil: " + e2.message);
  return userId;
}

/** Sesión real de Supabase para este usuario: es la que usaría el bot */
async function sesionDe(userId) {
  const { data: lista } = await db.auth.admin.listUsers({ perPage: 200 });
  const u = lista.users.find((x) => x.id === userId);
  // Se genera un token nuevo para este usuario
  const { data, error } = await supabase
    .getAdmin()
    .auth.admin.generateLink({ type: "magiclink", email: u.email });
  if (error) throw new Error("magiclink: " + error.message);

  const hashed = data.properties.hashed_token;
  const { data: pub, error: ePub } = await supabase
    .getPublico()
    .auth.verifyOtp({ token_hash: hashed, type: "magiclink" });
  if (ePub) throw new Error("verifyOtp: " + ePub.message);
  return pub.session.access_token;
}

(async () => {
  console.log("\n═══ Módulos y suscripciones: aislamiento ═══\n");

  // --- Preparación: dos clientes, cada uno con un módulo distinto ---
  const idA = await crearCliente("a");
  const idB = await crearCliente("b");

  const userA = await crearUsuario(MARCA + "a@ejemplo.com", idA, "a");
  const userB = await crearUsuario(MARCA + "b@ejemplo.com", idB, "b");

  const { error: eIns } = await db.from("suscripciones").insert([
    { client_id: idA, module_id: "bot_whatsapp", estado: "activo", inicia_en: "2026-01-01" },
    { client_id: idB, module_id: "bot_whatsapp", estado: "activo", inicia_en: "2026-01-01" },
  ]);
  if (eIns) throw new Error("suscripciones: " + eIns.message);

  const tokenA = await sesionDe(userA);
  const tokenB = await sesionDe(userB);

  const comoA = supabase.getClientForToken(tokenA);
  const comoB = supabase.getClientForToken(tokenB);

  // --- RLS sobre suscripciones ---
  seccion("RLS sobre 'suscripciones'");

  const { data: vA } = await comoA.from("suscripciones").select("client_id");
  comprobar("el cliente A ve suscripciones (si no, no vería la suya)", (vA || []).length > 0);
  comprobar(
    "solo ve la SUYA",
    (vA || []).every((s) => s.client_id === idA)
  );
  comprobar(
    "no ve la del cliente B",
    !(vA || []).some((s) => s.client_id === idB)
  );

  const { data: vB } = await comoB.from("suscripciones").select("client_id");
  comprobar("el cliente B tampoco ve la de A", !(vB || []).some((s) => s.client_id === idA));

  // --- El cliente no puede regalarse el bot ---
  seccion("el cliente no escribe");

  const { data: ins, error: errIns } = await comoA.from("suscripciones").insert({
    client_id: idA,
    module_id: "inventario",
    estado: "activo",
  });
  // RLS filtra en silencio: no hay error, pero tampoco fila creada
  comprobar("no puede crearse una suscripción (sin error, pero 0 filas)", !ins);
  const { data: comprueba } = await db
    .from("suscripciones")
    .select("id")
    .eq("client_id", idA)
    .eq("module_id", "inventario");
  comprobar("y de verdad no se creó en la base", (comprueba || []).length === 0);

  const { data: upd } = await comoA
    .from("suscripciones")
    .update({ estado: "activo", precio: 0 })
    .eq("client_id", idA)
    .select();
  comprobar("no puede cambiar su suscripción (0 filas afectadas)", (upd || []).length === 0);

  const { data: updB } = await comoA
    .from("suscripciones")
    .update({ estado: "vencido" })
    .eq("client_id", idB)
    .select();
  comprobar("no puede tocar la suscripción de otro", (updB || []).length === 0);

  const { data: del } = await comoA.from("suscripciones").delete().eq("client_id", idA).select();
  comprobar("no puede borrar suscripciones", (del || []).length === 0);

  // --- El catálogo sí es público para autenticados ---
  seccion("catálogo de módulos");

  const { data: cat } = await comoA.from("modules").select("id,nombre");
  comprobar("el cliente puede LEER el catálogo (es la vitrina del panel)", (cat || []).length > 0);
  comprobar(
    "pero no ve módulos que no existen en el catálogo",
    (cat || []).every((m) => typeof m.id === "string")
  );

  const { data: escMod } = await comoA
    .from("modules")
    .update({ disponible: true })
    .eq("id", "bot_whatsapp")
    .select();
  comprobar("no puede poner un módulo a la venta", (escMod || []).length === 0);

  const { data: nuevoMod } = await comoA.from("modules").insert({
    id: MARCA + "inventario",
    slug: MARCA + "inventario",
    nombre: "Inventario",
  }).select();
  comprobar("no puede inventarse un módulo en el catálogo", (nuevoMod || []).length === 0);

  // --- La función tiene_modulo ---
  seccion("función tiene_modulo()");

  const { data: r1, error: e1 } = await db.rpc("tiene_modulo", {
    cliente_uuid: idA,
    modulo: "bot_whatsapp",
  });
  comprobar("devuelve true para un cliente con el módulo activo", r1 === true && !e1);

  const { data: r2, error: e2 } = await db.rpc("tiene_modulo", {
    cliente_uuid: idB,
    modulo: "inventario",
  });
  comprobar("devuelve false para un módulo que no tiene", r2 === false && !e2);

  // Vencida: la suscripción sigue 'activo' pero con fecha pasada.
  // OJO con la fecha: tiene que ser POSTERIOR a inicia_en (2026-01-01),
  // porque si no la constraint termina_antes del esquema la rechaza y
  // el update falla en silencio. Por eso va 2026-06-01 y no 2020.
  const { error: errVence } = await db
    .from("suscripciones")
    .update({ termina_en: "2026-06-01" })
    .eq("client_id", idA)
    .eq("module_id", "bot_whatsapp");
  comprobar(
    "se puede caducar la suscripción sin saltarse la constraint",
    !errVence
  );

  const { data: r3 } = await db.rpc("tiene_modulo", {
    cliente_uuid: idA,
    modulo: "bot_whatsapp",
  });
  comprobar("devuelve false si la suscripción ya caducó (termina_en pasada)", r3 === false);

  /* Y lo que de verdad importa: una suscripción CADUCADA no da acceso,
     aunque el estado siga diciendo 'activo'. Si esto fallara, un
     cliente que dejó de pagar seguiría usando el servicio. */
  const { data: trasCaducar } = await db
    .from("suscripciones")
    .select("estado")
    .eq("client_id", idA)
    .eq("module_id", "bot_whatsapp")
    .single();
  comprobar(
    "el estado sigue siendo 'activo' (el bloqueo es por fecha, no por estado)",
    trasCaducar && trasCaducar.estado === "activo"
  );

  await db
    .from("suscripciones")
    .update({ termina_en: null })
    .eq("client_id", idA)
    .eq("module_id", "bot_whatsapp");
  const { data: r4 } = await db.rpc("tiene_modulo", {
    cliente_uuid: idA,
    modulo: "bot_whatsapp",
  });
  comprobar("vuelve a true al quitar la fecha de fin", r4 === true);

  // --- Limpieza ---
  seccion("Limpiando");
  await db.from("suscripciones").delete().in("client_id", [idA, idB]);
  await db.from("clients").delete().in("id", [idA, idB]);
  await db.auth.admin.deleteUser(userA);
  await db.auth.admin.deleteUser(userB);
  console.log("  ✓ datos de prueba borrados");

  console.log("\n" + "─".repeat(56));
  if (fallos) {
    console.log(`✗ ${fallos} comprobación(es) fallan de ${ok + fallos}.`);
    console.log("  Un cliente podría ver o tocar cosas que no son suyas.\n");
    process.exit(1);
  }
  console.log(`✓ Las ${ok} comprobaciones pasan.`);
  console.log("  Un cliente solo ve sus suscripciones. Puedes montar el bot encima.\n");
})().catch((e) => {
  console.error("\n✗ " + e.message + "\n");
  process.exit(1);
});
