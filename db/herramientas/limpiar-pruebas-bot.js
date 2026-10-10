/* Limpia los restos de los tests de bot que quedaron a medias.

   Una ejecución interrumpida deja usuarios de Supabase Auth y filas de
   `clients`/`bots`. La siguiente revienta al empezar con "a user with
   this email address has already been registered", que no dice que el
   problema es un resto de la prueba anterior.

   Solo toca lo que lleva la marca del test (test-bot / tbot), nunca
   datos de verdad.

   Cuándo hace falta: cuando un test se corta a mitad (se cae el
   servidor, se cierra la terminal) y deja usuarios de Auth y filas de
   `clients`. La siguiente ejecución revienta al empezar con "a user with
   this email address has already been registered", que no dice que el
   problema es un resto de la prueba anterior.

     node db/limpiar-pruebas-bot.js
*/

const supabase = require("../../lib/supabase");
const db = supabase.getAdmin();

const MARCAS = ["test-bot", "tbot"];

(async () => {
  console.log("\n═══ Restos de pruebas de bot ═══\n");

  const { data: usuarios, error } = await supabase.getAdmin().auth.admin.listUsers({ perPage: 200 });
  if (error) {
    console.log("  ✗ no se pudieron leer los usuarios: " + error.message + "\n");
    process.exitCode = 1;
    return;
  }

  const sobrantes = (usuarios.users || []).filter((u) =>
    MARCAS.some((m) => String(u.email || "").includes(m))
  );

  if (!sobrantes.length) {
    /* `process.exit()` aquí revienta con "Assertion failed:
       !(handle->flags & UV_HANDLE_CLOSING)" en Windows: el cliente de
       Supabase deja conexiones keep-alive abiertas y matar el proceso
       en mitad deja el handle a medias.

       Salir con `exitCode` y dejar que el bucle termine solo es lo
       correcto, y además es lo que hacen los demás scripts de esta
       carpeta. */
    console.log("  No hay usuarios de prueba sin borrar.\n");
    process.exitCode = 0;
    return;
  }

  console.log("  Usuarios de prueba encontrados: " + sobrantes.length);
  for (const u of sobrantes) console.log("    " + u.email);

  /* Primero las filas de la base, porque `clients` tiene ON DELETE
     CASCADE a `bots` y `profiles`, y borrando el usuario de Auth a
     ciegas el perfil se queda huérfano. */
  for (const u of sobrantes) {
    await db.from("profiles").delete().eq("id", u.id);
    await db.from("clients").delete().eq("email", u.email);
  }

  for (const u of sobrantes) {
    const r = await supabase.getAdmin().auth.admin.deleteUser(u.id);
    if (r.error) {
      /* "User not found" al borrar algo que `listUsers` acaba de
         devolver pasa: el listado de Auth está paginado y cacheado, y
         entre una llamada y otra el estado puede no coincidir. No es un
         fallo de este script, y decirlo como si lo fuera esconde que
         el resto sí se limpió.

         Lo que importa es el estado FINAL, y eso se comprueba después
         con una lista nueva. */
      console.log("  · " + u.email + ": " + r.error.message + " (se comprueba al final)");
    }
  }

  /* Y las cajas de prueba, que no tienen email. */
  const { data: cajas } = await db.from("evolution_servers").select("id,name").ilike("name", "%test%");
  for (const c of cajas || []) {
    const { count } = await db
      .from("bots")
      .select("id", { count: "exact", head: true })
      .eq("server_id", c.id);
    if (count) {
      console.log("  (la caja " + c.name + " tiene " + count + " bot(s): no se borra)");
      continue;
    }
    await db.from("evolution_servers").delete().eq("id", c.id);
    console.log("  caja de prueba borrada: " + c.name);
  }

  /* El estado final, con una lista nueva. Es lo único que cuenta: decir
     "limpio" sin comprobar que ya no queda nada es lo que hace que la
     siguiente ejecución siga fallando sin explicación. */
  const { data: despues } = await supabase.getAdmin().auth.admin.listUsers({ perPage: 200 });
  const quedan = (despues.users || []).filter((u) =>
    MARCAS.some((m) => String(u.email || "").includes(m))
  );

  const { data: clientesSobrantes } = await db.from("clients").select("id,email").ilike("email", "%test-bot%");
  const { data: botsSobrantes } = await db.from("bots").select("id,slug").ilike("slug", "tbot%");

  const pendientes = quedan.length + (clientesSobrantes || []).length + (botsSobrantes || []).length;

  if (pendientes) {
    console.log("\n  Queda " + pendientes + " cosa(s) sin borrar:");
    for (const u of quedan) console.log("    usuario  " + u.email);
    for (const c of clientesSobrantes || []) console.log("    cliente  " + c.email);
    for (const b of botsSobrantes || []) console.log("    bot      " + b.slug);
    console.log("\n  Vuelve a lanzarlo. Si insiste, el usuario está pillado en Auth\n");
    process.exitCode = 1;
    return;
  }

  console.log("\n  ✓ limpio, comprobado con una lista nueva\n");
  process.exitCode = 0;
})().catch((e) => {
  console.error("\n  ✗ " + (e && e.message ? e.message : e) + "\n");
  process.exitCode = 1;
});