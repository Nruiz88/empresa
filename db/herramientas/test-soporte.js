const { createClient } = require("@supabase/supabase-js");

/* =========================================================
   Nexo Studio — El acceso de soporte, contra la base real
   ---------------------------------------------------------
   ESTA PRUEBA NO ES DE CÓDIGO, ES DE LA BASE DE DATOS.

   Todo lo que hace soporte pasa por RLS, y RLS no se puede probar
   con el cliente de siempre: la secret key salta las políticas, que
   es justo lo que hay que comprobar. Por eso aquí se entra de verdad
   con un access_token de un usuario real de auth.users, y se lee y
   se escribe con ese token.

   Por qué está aparte de db/test-bot.js: aquel levanta dos
   servidores y prueba la lógica de las rutas. Este prueba LO QUE NO
   SE PUEDE PROBAR EN LOCAL: que las políticas de la base digan
   ahora lo que dicen en el SQL. Se puede cambiar el TypeScript,
   dejar todo verde en local, y que en la base el staff siga sin ver
   nada (o peor, que un staff vea todos los bots).

   Los fallos que esto destapa son los que de verdad duelen:
   "staff ve el bot de todos los clientes" y "staff no puede cambiar
   el servidor del bot". El segundo parece unlikely y es real.

   USO
     npm run test:soporte
   ========================================================= */

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

/* Filas de prueba: un staff, dos clientes, un bot para cada uno.

   TODAS se crean aquí y se borran al final. No se usa nada de la base
   real, y no por limpieza sino por otra cosa: una prueba que usa
   clientes reales depende de que haya dos, de que sus nombres sirvan
   para distinguirlos en la salida y de que su contraseña se sepa.
   Ninguna de las tres es una propiedad del código, y el día que falla
   una se busca un bug donde no lo hay. */
async function sembrar() {
  const marca = Math.random().toString(36).slice(2, 7);

  /* El staff es de prueba, no el real. La razón está en crearUsuario():
     con el real, esta prueba dependería de una contraseña que alguien
     tiene guardada. */
  const staff = await crearUsuario(
    `soporte-staff-${marca}@ejemplo.invalid`,
    "PruebaSoporte2026!",
    "Staff de prueba " + marca
  );

  await admin.from("profiles").insert({
    id: staff.id,
    rol: "staff",
    activo: true,
  });

  /* Dos clientes distintos, para comprobar que soporte no sale del que
     eligió. Con uno solo esa comprobación no se puede hacer. */
  const clients = [];
  for (const letra of ["A", "B"]) {
    /* Con el cliente encadenado, no con `ejecutar_sql`: esa función es
       solo SELECT a propósito, para que ninguna ruta pueda escribir
       saltándose RLS. Crear filas de prueba es exactamente el caso para
       el que existe la secret key. */
    const { data, error } = await admin
      .from("clients")
      .insert({
        nombre: "Soporte prueba " + letra + " " + marca,
        email: `soporte-${letra}-${marca}@ejemplo.invalid`,
      })
      .select("id, nombre")
      .single();
    if (error) throw new Error("no se pudo crear el cliente de prueba: " + error.message);
    clients.push(data);
  }

  const { data: servers, error: eServ } = await admin.rpc("ejecutar_sql", {
    consulta: "select id from evolution_servers limit 1",
    args: [],
  });
  if (eServ) throw new Error("no se pudo leer evolution_servers: " + eServ.message);
  if (!servers || !servers.length) throw new Error("no hay servidor de Evolution en la base");
  const server = servers[0];

  const hechos = [];
  for (const c of clients) {
    const { data: bot, error: eBot } = await admin
      .from("bots")
      .insert({
        client_id: c.id,
        server_id: server.id,
        name: "bot de prueba " + c.nombre,
        slug: "prueba-" + Math.random().toString(36).slice(2, 8),
        /* La instancia se inventa: estos bots no se conectan a nadie.
           Es NOT NULL en la tabla, pero es solo el dato que guarda con
           qué instancia de Evolution habla este bot. */
        instance_name: "prueba-" + Math.random().toString(36).slice(2, 8),
      })
      .select("id")
      .single();
    if (eBot) throw new Error("no se pudo crear el bot de prueba: " + eBot.message);
    hechos.push({ client: c, bot: bot.id });
  }
  return { staff, clients, hechos, marca };
}

function clienteDe(userId, token) {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/* Crea un usuario en auth.users y devuelve su id y su access_token.

   Hace falta un token DE VERDAD porque RLS no se puede probar con la
   secret key: esa salta las políticas, que es justo lo que hay que
   comprobar. Un token de mentira daría un resultado que no significa
   nada.

   Por eso se crean usuarios de prueba con contraseña conocida, en vez
   de usar los reales. Con los reales la prueba dependería de una
   contraseña que alguien tiene en su cabeza, y el día que se cambie
   la prueba falla por eso y no por el código. */
async function crearUsuario(email, clave, nombre) {
  const r = await fetch(process.env.SUPABASE_URL + "/auth/v1/admin/users", {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SECRET_KEY,
      Authorization: "Bearer " + process.env.SUPABASE_SECRET_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password: clave, email_confirm: true, user_metadata: { full_name: nombre } }),
  });
  const creado = await r.json();
  if (!creado.id) {
    throw new Error("no se pudo crear el usuario " + email + ": " + JSON.stringify(creado).slice(0, 160));
  }

  const rToken = await fetch(process.env.SUPABASE_URL + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password: clave }),
  });
  const cuerpo = await rToken.json();
  if (!cuerpo.access_token) {
    throw new Error("no se pudo iniciar sesión de " + email + ": " + JSON.stringify(cuerpo).slice(0, 160));
  }

  return { id: creado.id, accessToken: cuerpo.access_token };
}

let ok = 0, fallos = 0;

function comprobar(desc, cond, extra) {
  console.log(`  ${cond ? "✓" : "✗"} ${desc}${extra ? "  → " + extra : ""}`);
  cond ? ok++ : fallos++;
}

(async () => {
  console.log("\n═══ Las reglas de RLS, contra la base real ═══\n");

  const { staff, clients, hechos, marca } = await sembrar();
  const A = hechos[0];
  const B = hechos[1];
  console.log(`  cliente A: ${A.client.nombre}`);
  console.log(`  cliente B: ${B.client.nombre}`);
  console.log("  staff:     staff de prueba " + marca + "\n");

  const db = clienteDe(staff.id, staff.accessToken);

  /* ---- Sin sesión de soporte: staff no ve NADA ---- */
  console.log("── staff SIN sesión de soporte ──\n");

  const antes = await db.from("bots").select("id");
  comprobar(
    "no ve ningún bot, ni el suyo",
    (antes.data || []).length === 0,
    "ve " + (antes.data || []).length
  );

  /* ---- Con sesión sobre A: ve A, NO ve B ---- */
  console.log("\n── staff CON sesión de soporte sobre el cliente A ──\n");

  const { data: sesion } = await admin
    .from("bot_sesiones")
    .insert({
      client_id: A.client.id,
      soporte_de: A.client.id,
      soporte_motivo: "prueba: el cliente dice que no le llegan los mensajes",
      soporte_abierto_en: new Date().toISOString(),
      token_hash: "prueba_" + Date.now(),
      user_id: staff.id,
      rol: "staff",
      csrf_token: "x",
      expira_en: new Date(Date.now() + 3600_000).toISOString(),
    })
    .select("id")
    .single();

  const durante = await db.from("bots").select("id, client_id");
  const vistos = durante.data || [];
  comprobar("ve el bot del cliente A", vistos.some((b) => b.id === A.bot),
    "ve " + vistos.length + " bot(s)");
  comprobar(
    "y NO ve el bot del cliente B",
    !vistos.some((b) => b.id === B.bot),
    vistos.some((b) => b.id === B.bot) ? "OJO: lo ve" : "correcto"
  );

  /* ---- La sesión caduca: vuelve a no ver nada ---- */
  console.log("\n── la misma sesión, ya caducada ──\n");

  /* Una sesión se cierra con `revocado_en`, NO bajando `expira_en`.

   Y no es preferencia: la tabla tiene `check (expira_en > creado_en)`,
   pensado para que nadie alargue su propia sesión con un UPDATE. Como
   el reloj no para, esa caducidad no se puede escribir nunca: es la
   regla, no un accidente. */
  await admin.from("bot_sesiones").update({
    revocado_en: new Date().toISOString(),
  }).eq("id", sesion.id);

  const tras = await db.from("bots").select("id");
  comprobar("ya revocada, no ve nada", (tras.data || []).length === 0,
    "ve " + (tras.data || []).length);

  /* ---- Motivo vacío: puede LEER pero no ESCRIBIR ---- */
  console.log("\n── sesión viva pero SIN motivo (solo lectura) ──\n");

  await admin.from("bot_sesiones").update({
    revocado_en: null,
    soporte_motivo: "   ",
  }).eq("id", sesion.id);

  const lee = await db.from("bots").select("id");
  comprobar("puede leer", (lee.data || []).some((b) => b.id === A.bot), "");

  const escribe = await db.from("bots").update({ name: "cambio sin motivo" }).eq("id", A.bot).select("id");
  comprobar("pero NO puede escribir",
    (escribe.data || []).length === 0,
    (escribe.data || []).length ? "OJO: escribiendo sin motivo" : "rechazado");

  /* ---- No puede mover el bot de sitio, ni con motivo ---- */
  console.log("\n── soporte con motivo, sobre un bot ajeno ──\n");

  const { data: server } = await admin.from("evolution_servers").select("id").limit(1).single();
  await admin.from("bot_sesiones").update({
    soporte_motivo: "prueba de movimiento",
  }).eq("id", sesion.id);

  /* Se edita un campo de contenido (el nombre), que es lo que soporte
     debe poder tocar. */
  const nuevoNombre = "editado por soporte " + Math.random().toString(36).slice(2, 7);
  const edita = await db.from("bots").update({ name: nuevoNombre }).eq("id", A.bot).select("id");
  comprobar("puede editar la configuración del bot",
    (edita.data || []).length === 1,
    (edita.data || []).length ? "" : "rechazado");

  /* Y NO puede moverlo de sitio. El `server_id` decide con qué
     instancia de Evolution habla, o sea, con qué número de WhatsApp:
     cambiarlo sería robarle el número a un cliente. Se comprueba con un
     servidor DISTINTO del que ya tiene, porque poner el mismo no
     cambiaría nada y la política no llegaría a activarse. */
  const { data: botA } = await admin.from("bots").select("server_id").eq("id", A.bot).single();
  const { data: todosServidores } = await admin.rpc("ejecutar_sql", {
    consulta: "select id from evolution_servers",
    args: [],
  });
  const otroServidor = (todosServidores || []).find((s) => s.id !== botA.server_id);

  if (otroServidor) {
    const mueve = await db.from("bots").update({ server_id: otroServidor.id }).eq("id", A.bot).select("id");
    comprobar("NO puede cambiar de servidor de Evolution",
      (mueve.data || []).length === 0,
      (mueve.data || []).length ? "OJO: lo movió" : "rechazado");
  } else {
    console.log("  (solo hay un servidor de Evolution, no se puede probar el movimiento)");
  }

  /* Tampoco puede cambiar de cliente. */
  const mueveCliente = await db.from("bots").update({ client_id: B.client.id }).eq("id", A.bot).select("id");
  comprobar("NO puede traspasar el bot a otro cliente",
    (mueveCliente.data || []).length === 0,
    (mueveCliente.data || []).length ? "OJO: lo traspasó" : "rechazado");

  /* ---- El cliente dueño no se ve afectado ---- */
  console.log("\n── el cliente sigue viendo lo suyo, sin tocar nada ──\n");

  /* Se crea un cliente de prueba con su usuario, para comprobar lo más
     importante de todo: que el cambio de RLS no ha roto al cliente de
     siempre.

     El usuario tiene que ser real en auth.users porque
     `es_dueno_de_bot()` mira `auth.uid()`, y su fila en `profiles` es
     lo que le da el cliente. Sin ninguna de las dos, existe pero no
     tiene nada. */
  const emailCliente = `soporte-cliente-${marca}@ejemplo.invalid`;
  const cliente = await crearUsuario(emailCliente, "PruebaSoporte2026!", "Cliente de prueba " + marca);

  await admin.from("profiles").insert({
    id: cliente.id,
    rol: "client",
    client_id: A.client.id,
    activo: true,
  });

  const dbC = clienteDe(cliente.id, cliente.accessToken);
  const suyo = await dbC.from("bots").select("id");
  comprobar("el cliente del A sigue viendo su bot",
    (suyo.data || []).some((b) => b.id === A.bot),
    "ve " + (suyo.data || []).length);
  comprobar("y no ve el del B",
    !(suyo.data || []).some((b) => b.id === B.bot), "");

  /* ---- Limpieza ----
     En este orden: primero las sesiones, luego los bots, luego los
     perfiles, luego los usuarios de auth, y por último los clientes.
     Los clientes van los últimos porque `bot_sesiones.client_id` los
     referencia y `ON DELETE CASCADE` los borraría en silencio. */
  await admin.from("bot_sesiones").delete().eq("id", sesion.id);
  for (const h of hechos) await admin.from("bots").delete().eq("id", h.bot);

  /* Los usuarios van después de sus perfiles, porque `profiles.id`
     referencia `auth.users.id`. Si se borrara antes el usuario, el
     perfil se iría en cascada solo y no habría problema. Al revés
     también funciona, pero este orden deja claro que se limpian las
     dos cosas. */
  for (const u of [staff.id, cliente.id]) {
    await admin.from("profiles").delete().eq("id", u);
    await fetch(process.env.SUPABASE_URL + "/auth/v1/admin/users/" + u, {
      method: "DELETE",
      headers: {
        apikey: process.env.SUPABASE_SECRET_KEY,
        Authorization: "Bearer " + process.env.SUPABASE_SECRET_KEY,
      },
    });
  }

  /* Los clientes los últimos: `bot_sesiones.client_id` los referencia
     con ON DELETE CASCADE, así que borrarlos antes se llevaría por
     delante las sesiones de prueba sin dejar rastro. */
  for (const c of clients) {
    await admin.from("bots").delete().eq("client_id", c.id);
    await admin.from("clients").delete().eq("id", c.id);
  }
  console.log("\n  datos de prueba borrados\n");

  console.log("─".repeat(54));
  if (fallos) {
    console.log(`✗ ${fallos} de ${ok + fallos} fallan.`);
    process.exit(1);
  }
  console.log(`✓ Las ${ok} comprobaciones pasan.`);
  process.exit(0);
})().catch((e) => {
  console.error("\n✗ " + e.message);
  process.exit(1);
});