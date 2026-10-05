/* =========================================================
   Nexo Studio — Aislamiento del bot
   ------------------------------------------------------------
   Comprueba lo que hace falta para que un cliente no pueda tocar lo
   de otro, y que la base de datos (no el código) impida la doble
   reserva.

   LO MÁS IMPORTANTE DE AQUÍ
   -------------------------
   El caso de la Evolution API key compartida. En el diseño anterior
   (MariaDB) la url y la clave estaban en la misma fila que leía el
   cliente, y como varias instancias comparten servidor, un cliente
   podía leer la clave del servidor y manejar los bots de otros. Ese
   test es el primero del fichero, a propósito: si algún día alguien
   mueve la clave a `bots`, esto falla.

   No toca el servidor: es la base y la lógica. El flujo HTTP con
   ticket lo comprueba db/test-acceso-servicio.js.
   ========================================================= */

const supabase = require("../lib/supabase");
require("../lib/env").load();
const db = supabase.getAdmin();

let ok = 0;
let fallos = 0;
const MARCA = "-test-bot-";

/* Los slugs llevan un número de tirada.

   Motivo: bots.slug es UNIQUE a nivel de base (es una dirección
   pública), así que si una ejecución anterior se rompe a mitad y deja
   filas, la siguiente falla con 'duplicate key' en el primer insert y
   no se puede ni empezar a comprobar nada.

   Con sufijo aleatorio cada tirada usa slugs distintos y el test es
   repetible por muchas veces seguidas. La limpieza sigue estando (hay
   que dejar la base limpia), pero ya no es lo único que evita que la
   segunda ejecución reviente. */
const TIRADA = Math.random().toString(36).slice(2, 7);

/* El slug tiene su propio prefijo y NO puede reutilizar MARCA.

   bots.slug exige ^[a-z0-9][a-z0-9-]{1,40}$: el primer carácter tiene
   que ser alfanumérico, y MARCA empieza por guion. Con MARCA el slug
   sale "-test-bot-aa" y la restricción lo rechaza.

   Además el slug NO lleva mayúsculas, así que MARCA (con guion
   delante) serviría como marca de limpieza pero no como slug. */
const SLUG = "tbot" + TIRADA;

function comprobar(desc, cond) {
  if (cond) {
    console.log("  ✓ " + desc);
    ok++;
  } else {
    console.log("  ✗ " + desc);
    fallos++;
  }
}
const seccion = (t) => console.log("\n── " + t + " " + "─".repeat(Math.max(0, 46 - t.length)));

const sueltos = [];

async function cliente(sufijo) {
  const { data, error } = await db
    .from("clients")
    .insert({ nombre: "B" + MARCA + sufijo, empresa: "B" + MARCA + sufijo, email: MARCA + sufijo + "@ejemplo.com" })
    .select("id")
    .single();
  if (error) throw new Error("cliente: " + error.message);
  return data.id;
}

async function usuario(email, clientId, sufijo) {
  const { data, error } = await db.auth.admin.createUser({
    email, password: "PruebaBot123", email_confirm: true,
  });
  if (error) throw new Error("auth: " + error.message);
  sueltos.push(data.user.id);
  const { error: e2 } = await db.from("profiles").insert({
    id: data.user.id, rol: "client", client_id: clientId,
    nombre: "P" + sufijo, activo: true,
  });
  if (e2) throw new Error("perfil: " + e2.message);
  return data.user.id;
}

/** Sesión real de Supabase: es la que hace que RLS aplique. */
async function sesionDe(userId) {
  const { data: lista } = await db.auth.admin.listUsers({ perPage: 200 });
  const email = lista.users.find((u) => u.id === userId).email;
  const { data: link } = await db.auth.admin.generateLink({ type: "magiclink", email });
  const { data, error } = await supabase
    .getPublico()
    .auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (error) throw new Error("verifyOtp: " + error.message);
  return supabase.getClientForToken(data.session.access_token);
}

/* Fuera del IIFE a propósito: el bloque `finally` de la limpieza las
   necesita, y si estuvieran dentro no las vería. Con datos a medio
   crear, el `finally` tiene que poder borrar lo que se llegó a
   insertar, o el siguiente intento encuentra el email ya usado y
   peta con "already registered". */
let clientA = null;
let clientB = null;
let servidor = null;
let botA = null;
let botB = null;

(async () => {
  console.log("\n═══ Bot: aislamiento ═══\n");

  /* ---------- Montaje ---------- */
  clientA = await cliente("a");
  clientB = await cliente("b");
  const userA = await usuario(MARCA + "a@ejemplo.com", clientA, "A");
  const userB = await usuario(MARCA + "b@ejemplo.com", clientB, "B");

  /* UN servidor de Evolution compartido por los dos bots: es el caso
     real y el que hace peligroso tener la clave a la vista. */
  const { data: servidor, error: eServ } = await db
    .from("evolution_servers")
    .insert({
      name: "Servidor de pruebas " + MARCA,
      url: "https://evolution.example",
      api_key: "CLAVE-QUE-NO-DEBE-LEERSE-" + Math.random().toString(36).slice(2),
    })
    .select("id")
    .single();
  if (eServ) throw new Error("servidor: " + eServ.message);

  const { data: botA, error: eBotA } = await db
    .from("bots")
    .insert({ client_id: clientA, server_id: servidor.id, name: "Bot A", instance_name: "inst-a", slug: SLUG + "aa" })
    .select("id").single();
  if (eBotA) throw new Error("botA: " + eBotA.message);

  const { data: botB, error: eBotB } = await db
    .from("bots")
    .insert({ client_id: clientB, server_id: servidor.id, name: "Bot B", instance_name: "inst-b", slug: SLUG + "bb" })
    .select("id").single();
  if (eBotB) throw new Error("botB: " + eBotB.message);

  await db.from("suscripciones").insert({
    client_id: clientA, module_id: "bot_whatsapp", estado: "activo", inicia_en: "2026-01-01",
  });

  const comoA = await sesionDe(userA);
  const comoB = await sesionDe(userB);

  /* ---------- LA LLAVE ---------- */
  seccion("la clave de Evolution es solo del servidor");

  const { data: srvA } = await comoA.from("evolution_servers").select("id,url,api_key");
  comprobar("el cliente A NO lee los servidores de Evolution", (srvA || []).length === 0);

  const { data: srvB } = await comoB.from("evolution_servers").select("id");
  comprobar("tampoco el B", (srvB || []).length === 0);

  /* Y la comprobación de que la clave NO está en bots, que es de donde
     sí se puede leer. Si algún día alguien mete la clave ahí, esto
     falla aunque el test de arriba pase. */
  const { data: botA_visto } = await comoA.from("bots").select("*").eq("id", botA.id).maybeSingle();
  const columnas = Object.keys(botA_visto || {});
  comprobar(
    "la tabla bots no tiene ninguna columna de clave",
    !columnas.some((c) => /key|clave|token|secret/i.test(c))
  );

  /* ---------- Ver su bot y no el otro ---------- */
  seccion("cada cliente ve lo suyo");

  const { data: botsA } = await comoA.from("bots").select("id,name,slug");
  comprobar("A ve su bot", (botsA || []).length === 1);
  comprobar("y es el suyo", botsA && botsA[0].id === botA.id);

  const { data: botsB_sobre_A } = await comoA.from("bots").select("id").eq("id", botB.id);
  comprobar("A NO ve el bot de B", (botsB_sobre_A || []).length === 0);

  const { data: botsB } = await comoB.from("bots").select("id");
  comprobar("B ve el suyo", (botsB || []).length === 1 && botsB[0].id === botB.id);

  /* ---------- Escribir en lo suyo sí ---------- */
  seccion("sí puede configurar lo suyo");

  const { data: resp } = await comoA.from("bots_responses").insert({
    bot_id: botA.id, keyword: "horario", response_text: "De 9 a 18", is_active: true,
  }).select();
  comprobar("crea respuestas automáticas", (resp || []).length === 1);

  const { data: hor } = await comoA.from("bots_business_hours").insert({
    bot_id: botA.id, day_of_week: 1, start_time: "09:00", end_time: "18:00", slot_duration_min: 30,
  }).select();
  comprobar("crea horarios", (hor || []).length === 1);

  const { data: art } = await comoA.from("bots_catalog_items").insert({
    bot_id: botA.id, label: "Croissant", price_cents: 250,
  }).select();
  comprobar("crea artículos de catálogo", (art || []).length === 1);

  const { data: edicion } = await comoA
    .from("bots").update({ name: "Bot de Marina" }).eq("id", botA.id).select();
  comprobar("renombra su bot", (edicion || []).length === 1);

  /* ---------- Y NO en lo ajeno ---------- */
  seccion("pero no toca lo de nadie");

  const { data: intrusa } = await comoA.from("bots_responses").insert({
    bot_id: botB.id, keyword: "malo", response_text: "no debería",
  }).select();
  comprobar("no crea respuestas en el bot de B", (intrusa || []).length === 0);

  const { data: citaAjena } = await comoA.from("bots_appointments").insert({
    bot_id: botB.id, customer_phone: "600000000", appointment_date: "2026-11-02", appointment_time: "10:00", duration_min: 30,
  }).select();
  comprobar("no crea citas en el bot de B", (citaAjena || []).length === 0);

  const { data: roba } = await comoA.from("bots_responses").delete().eq("bot_id", botB.id).select();
  comprobar("no borra respuestas de B", (roba || []).length === 0);

  /* El UPDATE con WITH CHECK: puede cambiar su nombre pero no
     apropiarse del bot de B cambiando el client_id. */
  const { data: secuestro } = await comoA
    .from("bots").update({ client_id: clientB }).eq("id", botA.id).select();
  comprobar("no puede cambiar de dueño su bot", (secuestro || []).length === 0);

  const { data: trasSecuestro } = await db.from("bots").select("client_id").eq("id", botA.id).single();
  comprobar("y el dueño sigue siendo el mismo", trasSecuestro.client_id === clientA);

  /* No puede crearse un bot propio apuntando al servidor de otro. */
  const { data: nuevoBot } = await comoA.from("bots").insert({
    client_id: clientA, server_id: servidor.id, name: "Intruso", instance_name: "x",
    slug: SLUG + "nuevo1",
  }).select();
  comprobar("no puede darse de alta bots a sí mismo", (nuevoBot || []).length === 0);

  const { data: nuevoBot2 } = await comoA.from("bots").insert({
    client_id: clientA, server_id: servidor.id, name: "Intruso", instance_name: "x",
    slug: SLUG + "nuevo3",
  }).select();
  comprobar("ni aunque loruegue por el slug", (nuevoBot2 || []).length === 0);

  /* ---------- Borrar ---------- */
  seccion("no puede borrar su bot");

  const { data: borrado } = await comoA.from("bots").delete().eq("id", botA.id).select();
  comprobar("el DELETE está bloqueado", (borrado || []).length === 0);

  const { data: sigue } = await db.from("bots").select("id").eq("id", botA.id).maybeSingle();
  comprobar("el bot sigue ahí", Boolean(sigue));

  /* ---------- La doble reserva ---------- */
  seccion("la base impide la doble reserva");

  await db.from("bots_appointments").insert({
    bot_id: botA.id, customer_phone: "600111111", appointment_date: "2026-11-02", appointment_time: "10:00",
    duration_min: 30, status: "confirmed",
  });

  const solapada = await db.from("bots_appointments").insert({
    bot_id: botA.id, customer_phone: "600222222", appointment_date: "2026-11-02", appointment_time: "10:15",
    duration_min: 30, status: "confirmed",
  });

  comprobar(
    "una cita que pisa el hueco es rechazada por la base",
    Boolean(solapada.error)
  );
  comprobar("y el error es de exclusión, no un crash",
    solapada.error && /no_doble_reserva|conflicting key|exclusion/i.test(solapada.error.message || ""));

  /* Justo al lado sí vale: 11:00 no pisa el hueco de 10:00-10:30. */
  const justa = await db.from("bots_appointments").insert({
    bot_id: botA.id, customer_phone: "600333333", appointment_date: "2026-11-02", appointment_time: "11:00",
    duration_min: 30, status: "confirmed",
  });
  comprobar("una cita justo al lado sí se puede", !justa.error);

  /* Otro bot el mismo día y hora sí: el hueco es por bot. */
  const otro = await db.from("bots_appointments").insert({
    bot_id: botB.id, customer_phone: "600444444", appointment_date: "2026-11-02", appointment_time: "10:00",
    duration_min: 30, status: "confirmed",
  });
  comprobar("y otro bot el mismo día y hora también", !otro.error);

  /* Cancelar libera el hueco.

     Filtra por `status`: sin ese filtro el `.maybeSingle()` encuentra
     varias filas y devuelve null, porque a esa hora puede haber más de
     una cita (la confirmada y la pendiente de una pasada anterior si
     el test se repite sobre datos vivos). Se pide la que sigue
     pendiente, que es la que realmente ocupa el hueco. */
  const { data: cita } = await db
    .from("bots_appointments").select("id")
    .eq("bot_id", botA.id)
    .eq("appointment_time", "10:00")
    .eq("status", "confirmed")
    .maybeSingle();
  comprobar("encuentra la cita pendiente de las 10:00", Boolean(cita));

  await db.from("bots_appointments").update({ status: "canceled" }).eq("id", cita.id);
  const reutilizado = await db.from("bots_appointments").insert({
    bot_id: botA.id, customer_phone: "600555555", appointment_date: "2026-11-02", appointment_time: "10:00",
    duration_min: 30, status: "pending",
  });
  comprobar("cancelar una cita libera el hueco", !reutilizado.error);

  /* El historial no se puede reescribir. */
  seccion("el historial no se borra desde el cliente");

  const { data: registro } = await db.from("bots_response_logs").insert({
    bot_id: botA.id, incoming_phone: "600999999", incoming_message: "hola", sent_at: new Date().toISOString(),
  }).select();
  comprobar("el webhook registra el mensaje", (registro || []).length === 1);

  const { data: borraRegistro } = await comoA.from("bots_response_logs").delete().eq("bot_id", botA.id).select();
  comprobar("el cliente no puede borrar el registro", (borraRegistro || []).length === 0);

  const { data: logInterno } = await comoA.from("bots_webhook_logs").select("id");
  comprobar("el cliente no ve el log interno de webhooks", (logInterno || []).length === 0);

  /* ---------- Un cliente por bot ---------- */
  seccion("de momento, un bot por cliente");

  const { data: segundo, error: eSegundo } = await db.from("bots").insert({
    client_id: clientA, server_id: servidor.id, name: "Segundo",
    instance_name: "inst-a2", slug: SLUG + "aa2",
  }).select();

  comprobar("no puede tener dos bots", Boolean(eSegundo));
  comprobar("y el error es la restricción, no un fallo raro",
    eSegundo && /un_bot_por_cliente|duplicate key/i.test(eSegundo.message || ""));

  console.log("\n" + "─".repeat(54));
  if (fallos) {
    console.log(`✗ ${fallos} de ${ok + fallos} fallan.\n`);
    process.exitCode = 1;
  } else {
    console.log(`✓ Las ${ok} comprobaciones pasan.`);
    console.log("  Un cliente solo ve lo suyo y no puede leer ninguna clave.\n");
  }
})()
  .catch((e) => {
    console.error("\n✗ " + e.message + "\n");
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      /* Cada borrado dice si falló en vez de seguir como si nada.

         Antes el bloque iba entero en un try y el primer error
         abortaba el resto, así que un fallo al principio dejaba TODO lo
         demás sin borrar y el siguiente intento moría con
         'duplicate key'. Ahora cada paso va suelto y avisa, para que un
         fallo de limpieza se vea en vez de descubrirse en la ejecución
         siguiente. */
      /* Si falta el id, no se intenta nada.

         Un `.match({ id: undefined })` se traduce en un DELETE sin
         WHERE, y Supabase lo rechaza ("DELETE requires a WHERE
         clause"). Peor: si en algún momento se colara un filtro vacío
         contra la secret key, intentaría vaciar la tabla entera. */
      const paso = async (tabla, filtro, etiqueta) => {
        if (!filtro || Object.values(filtro).some((v) => v === undefined || v === null)) return;
        const { error } = await db.from(tabla).delete().match(filtro);
        if (error) console.error("  (limpieza: no se pudo borrar " + etiqueta + " -> " + error.message + ")");
      };

      const ids = [botA?.id, botB?.id].filter(Boolean);
      for (const id of ids) {
        await paso("bots_appointments", { bot_id: id }, "citas de " + id.slice(0, 8));
        await paso("bots_responses", { bot_id: id }, "respuestas de " + id.slice(0, 8));
        await paso("bots_business_hours", { bot_id: id }, "horarios de " + id.slice(0, 8));
        await paso("bots_catalog_items", { bot_id: id }, "catálogo de " + id.slice(0, 8));
        await paso("bots_response_logs", { bot_id: id }, "registro de " + id.slice(0, 8));
        await paso("bots_orders", { bot_id: id }, "pedidos de " + id.slice(0, 8));
      }
      await paso("bots", { id: ids[0] }, "bot A");
      await paso("bots", { id: ids[1] }, "bot B");
      await paso("evolution_servers", { id: servidor?.id }, "servidor de Evolution");
      await paso("suscripciones", { client_id: clientA }, "suscripción de A");
      await paso("suscripciones", { client_id: clientB }, "suscripción de B");
      await paso("profiles", { client_id: clientA }, "perfil de A");
      await paso("profiles", { client_id: clientB }, "perfil de B");
      await paso("clients", { id: clientA }, "cliente A");
      await paso("clients", { id: clientB }, "cliente B");
      for (const id of sueltos) {
        await db.auth.admin.deleteUser(id).catch(() => {});
      }
    } catch (e) {
      console.error("(limpieza: " + e.message + ")");
    }
  });
