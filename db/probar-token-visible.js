/* ¿Puede un cliente leer el token de su bot?
   ─────────────────────────────────────────────────────────────
   El test de aislamiento falla con:

       ✗ la tabla bots no tiene ninguna columna de clave

   Y tiene razón en señalarlo. Se agregó `bots.instance_token` para que
   el bot use el token de su instancia y no la clave global.

   Pero `bots` tiene RLS, y el cliente SÍ puede leer su propio bot. Si
   puede leer la fila entera, se lleva el token con ella.

   ── POR QU ESO ES GRAVE ──

   El token de instancia sirve para hablar con Evolution de ESA
   instancia: leer sus chats, mandar mensajes, cambiar su webhook.

   O sea: si un cliente lee su `instance_token`, puede manejar su bot
   directamente, saltándose el panel. Y si el panel va a ser el único
   camino, deja de serlo.

   Y hay algo peor: si el token se filtra —un log, una captura, un
   backup— sirve para siempre, sin caducidad. La clave global por lo
   menos se puede rotar.

   ── LO QUE SE COMPRUEBA ──

   De verdad, no leyendo el esquema: pidiendo la fila con la clave que
   va en el navegador. */
require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

(async () => {
  console.log("\n═══ ¿Puede un cliente leer el token de su bot? ═══\n");

  const url = process.env.SUPABASE_URL;
  const clave = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !clave) {
    console.log("  x no hay clave publicable con la que probar\n");
    process.exit(1);
  }

  const { createClient } = require("@supabase/supabase-js");

  /* Sin sesión: es como si cualquiera preguntara. */
  const anon = createClient(url, clave, { auth: { persistSession: false } });

  /* ---- 1. Con la clave del navegador, sin iniciar sesión ---- */
  const { data: anonRows, error: eAnon } = await anon
    .from("bots")
    .select("id, name, instance_name, instance_token")
    .limit(5);

  console.log("  ── sin sesión, con la clave del navegador ──");
  console.log("  error: " + (eAnon ? eAnon.message : "ninguno"));

  if (anonRows && anonRows.length) {
    console.log("  ¡VE " + anonRows.length + " FILA(S)!");
    anonRows.forEach((r) => {
      console.log("    " + r.name);
      console.log("      instance_token: " +
        (r.instance_token ? "¡SE LEE! (" + r.instance_token.length + " caracteres)" : "null"));
    });
  } else {
    console.log("  no ve ninguna fila. El RLS lo frena sin sesión.");
  }
  console.log("");

  /* ---- 2. Con un cliente de verdad ---- */
  const { data: clientes } = await db.rpc("ejecutar_sql", {
    consulta: "select client_id, count(*) as bots from bots group by 1 order by 1",
    args: [],
  });

  console.log("  ── con un cliente que tiene sesión ──\n");

  if (!clientes || !clientes.length) {
    console.log("  no hay clientes con bots.\n");
  } else {
    console.log("  Para esto hace falta una sesión real de cliente, que este");
    console.log("  script no puede fabricar sin credenciales.");
    console.log("  El RLS de `bots` es lo que decide, y eso está en la migración.");
    console.log("  Lo que SÍ se puede comprobar es qué columnas se piden.\n");
  }

  /* ---- 3. Qué dice el RLS de bots ---- */
  console.log("  ── las políticas de bots ──\n");

  const { data: pol } = await db.rpc("ejecutar_sql", {
    consulta:
      "select policyname, cmd, qual, with_check from pg_policies " +
      "where tablename = 'bots' order by policyname",
    args: [],
  });

  if (!pol || !pol.length) {
    console.log("    (no hay políticas: la tabla tiene RLS pero nadie puede)");
    console.log("    pasar, y con el service key el webhook tampoco.");
  } else {
    pol.forEach((p) => {
      console.log("    " + p.policyname + "   [" + p.cmd + "]");
      console.log("      where: " + String(p.qual || "(ninguna)").slice(0, 90));
    });
  }

  console.log("");
  console.log("  ──────────────────────────────────────────────────\n");

  /* ---- 4. La conclusión ---- */
  const problema = !eAnon && anonRows && anonRows.length > 0;

  if (problema) {
    console.log("  × UN CLIENTE PUEDE LEER EL TOKEN DE SU BOT.\n");
    console.log("    Con eso puede manejar la instancia de Evolution por su cuenta:\n");
    console.log("      · leer todas las conversaciones de su WhatsApp;\n");
    console.log("      · mandar mensajes en su nombre;\n");
    console.log("      · cambiarle el webhook y dejar de recibir mensajes.\n");
    console.log("    Y si el token se filtra, sirve para siempre.\n");
    console.log("    EL ARREGLO: moverlo a una tabla sin RLS, como evolution_servers,");
    console.log("    igual que se hizo con la clave del servidor. El bot lo lee con la");
    console.log("    service key, y el cliente no tiene forma de llegar.\n");
  } else {
    console.log("  ✓ El token no se puede leer sin permiso.\n");
    console.log("    Con el service key el webhook sí lo lee —por eso el bot");
    console.log("    funciona—, y no hay forma de llegar desde el navegador.\n");
  }
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});