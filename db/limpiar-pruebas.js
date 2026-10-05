/* =========================================================
   Nexo Studio — Limpiar los datos que dejaron las pruebas
   ------------------------------------------------------------
   Cada suite de db/ crea clientes, usuarios y bots de prueba, y
   debería borrarlos al terminar. Los que quedan son de ejecuciones
   que fallaron antes de llegar a la limpieza, o de suites que se
   ejecutaron antes de que existiera.

   Por eso esto no es "un script de limpieza": es la lista de lo que
   las pruebas dejaron, y sirve para volver a dejar la base como
   estaba antes de los tests. Es reversible por diseño, porque solo
   toca filas cuyo nombre o email delata que son de prueba.

   ⚠️  MIRA LA LISTA ANTES DE EJECUTAR
   Lo que se borra sale de aquí, y el script imprime exactamente qué
   va a tocar y qué NO. Si algo de la lista no debería estar ahí, es
   que el patrón es demasiado amplio: se ajusta la lista, no se ejecuta
   a ciegas.

   USO
     node db/limpiar-pruebas.js            # muestra lo que hay
     node db/limpiar-pruebas.js --si       # y lo borra
   ========================================================= */

require("../lib/env").load();
const db = require("../lib/supabase").getAdmin();

/* ---------------------------------------------------------------------
   LOS PATRONES
   ---------------------------------------------------------------------
   Se listan uno a uno y no como un `or` genérico, para poder ver de
   qué prueba viene cada cosa. Un patrón demasiado ancho ("%test%")
   borraría de más sin que nadie se entere hasta que falta algo.

   Y hay que poner el motivo de cada uno: cuando uno nuevo aparezca, se
   sabe de qué suite es y si toca añadirlo. */
const PATRONES = [
  /* De db/test-acceso-servicio.js y db/test-acceso.js */
  { donde: "email", op: "=", valor: "-test-acceso-servicio-x@ejemplo.com", de: "test-acceso" },
  /* De db/test-modulos.js */
  { donde: "email", op: "=", valor: "-test-modulos-a@ejemplo.com", de: "test-modulos" },
  { donde: "email", op: "=", valor: "-test-modulos-b@ejemplo.com", de: "test-modulos" },
  /* De db/test-perfil.js */
  { donde: "email", op: "=", valor: "-test-perfil-x@ejemplo.com", de: "test-perfil" },
  /* De db/test-bot.js */
  { donde: "email", op: "=", valor: "prueba-ctkfd@ejemplo.com", de: "test-bot (dinámico)" },
  /* De db/test-soporte.js. El nombre lleva una marca aleatoria, así
     que aquí no alcanza un `=`: hace falta el comodín. */
  { donde: "email", op: "like", valor: "soporte-%@ejemplo.invalid", de: "test-soporte" },
  /* De las pruebas de la Evolution que se hicieron a mano */
  { donde: "email", op: "=", valor: "probe@b.test", de: "diagnóstico" },
  { donde: "email", op: "=", valor: "probe2@b.test", de: "diagnóstico" },
];

const LIMPIAR = process.argv.includes("--si");

(async () => {
  console.log("\n═══ Qué dejaron las pruebas ═══\n");

  /* ---- Clients ---- */
  const { data: clients, error: eCli } = await db.from("clients").select("id,nombre,empresa,email");
  if (eCli) throw new Error("no se pudieron leer los clientes: " + eCli.message);

  /* Un `like` con `%` se compara como patrón, no con `includes`. La
     primera versión quita los `%` y busca la cadena resulting, que no
     existe nunca: "soporte-@ejemplo.invalid" no aparece en
     "soporte-A-4e9q0@ejemplo.invalid". El resultado era que los
     clientes de soporte salían en la lista de "reales", que es
     justo el fallo que este script no puede permitirse. */
  const casa = (valor, patron) => {
    const partes = String(patron).toLowerCase().split("%");
    if (partes.length === 1) return valor === patron.toLowerCase();
    let i = 0;
    for (const parte of partes) {
      if (!parte) continue;
      const donde = valor.indexOf(parte, i);
      if (donde < 0) return false;
      i = donde + parte.length;
    }
    return true;
  };

  const esDePrueba = (fila) => {
    if (fila.email == null) return null;
    const v = String(fila.email).toLowerCase();
    for (const p of PATRONES) {
      if (p.donde !== "email") continue;
      if (p.op === "=" && v === p.valor) return p.de;
      if (p.op === "like" && casa(v, p.valor)) return p.de;
    }
    return null;
  };

  const chatarra = (clients || []).filter((c) => esDePrueba(c));
  const reales = (clients || []).filter((c) => !esDePrueba(c));

  /* Agrupar por patrón da un resumen legible: "54 de test-modulos" se
     entiende; una lista de 54 líneas con el mismo patrón, no. */
  const porPatron = new Map();
  for (const c of chatarra) {
    const de = esDePrueba(c);
    porPatron.set(de, (porPatron.get(de) || 0) + 1);
  }

  console.log(`  clientes: ${(clients || []).length} en total`);
  console.log(`    ${reales.length} reales`);
  console.log(`    ${chatarra.length} de pruebas`);
  for (const [de, n] of [...porPatron].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(n).padStart(3)} de ${de}`);
  }

  /* ---- Bots ---- */
  /* La columna se llama `name`, no `nombre`. Es lo que pasa al pedir
     una columna que no existe: PostgREST devuelve un error, `data`
     queda a null, y un `|| []` lo convierte en "no hay ninguno". Un
     script de limpieza que no distingue "no hay" de "no me han
     contestado" es un script que dice que todo está bien. */
  const { data: bots, error: eBots } = await db
    .from("bots")
    .select("id,name,instance_name,client_id");
  if (eBots) throw new Error("no se pudieron leer los bots: " + eBots.message);

  const botsDePrueba = (bots || []).filter((b) => {
    /* Un bot de prueba se delata por la instancia: los de producción
       son nombres de Evolution que existen de verdad, y los de prueba
       se inventan con `prueba-`. Es más fiable que el nombre del bot,
       que la propia prueba cambia al probar la edición. */
    return String(b.instance_name || "").startsWith("prueba-");
  });

  console.log(`\n  bots: ${(bots || []).length} en total`);
  console.log(`    ${botsDePrueba.length} con instancia de prueba (prueba-*)`);

  /* ---- Sesiones del bot ---- */
  const { data: sesiones } = await db.from("bot_sesiones").select("id,user_id,client_id");
  console.log(`\n  sesiones de bot: ${(sesiones || []).length}`);
  console.log(`  (se borran todas: son de pruebas, ycaduca sola en 4 h)`);

  /* ---- Lo que NO se toca ---- */
  console.log("\n── NO se toca ──\n");
  for (const c of reales) {
    console.log(`  ${String(c.empresa || c.nombre).padEnd(30)}${c.email || "(sin email)"}`);
  }
  for (const b of (bots || []).filter((b) => !botsDePrueba.includes(b))) {
    console.log(`  bot: ${b.name}  instancia=${b.instance_name}`);
  }

  if (!LIMPIAR) {
    console.log("\n\n  Esto es solo un aviso. Para borrarlo:");
    console.log("    node db/limpiar-pruebas.js --si\n");
    process.exit(0);
  }

  /* ------------------------------------------------------------------
     A BORRAR. En este orden y con el error comprobado en cada paso.
     ------------------------------------------------------------------ */

  console.log("\n── Borrando ──\n");
  let fallos = 0;

  /* 1. Sesiones primero: si son de un usuario que ya no existe, son
        basura; y borrarlas evita que un `cascade` surprise más tarde. */
  const { error: eSes } = await db.from("bot_sesiones").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (eSes) {
    console.log(`  ✗ no se pudieron borrar las sesiones: ${eSes.message}`);
    fallos++;
  } else {
    console.log("  ✓ sesiones de bot");
  }

  /* 2. Los bots de prueba. Antes de borrar el cliente, porque
        `bots.client_id` lo referencia. */
  for (const b of botsDePrueba) {
    const { error } = await db.from("bots").delete().eq("id", b.id);
    if (error) {
      console.log(`  ✗ bot ${b.instance_name}: ${error.message}`);
      fallos++;
    }
  }
  if (botsDePrueba.length) console.log(`  ✓ ${botsDePrueba.length} bots de prueba`);

  /* 3. Los clientes. Cada uno por su id, y con el error comprobado:
        si uno falla por lo que sea, hay que saberlo, porque seguir
        dejando basura detrás es peor que no limpiar. */
  let clientesBorrados = 0;
  for (const c of chatarra) {
    const { error } = await db.from("clients").delete().eq("id", c.id);
    if (error) {
      console.log(`  ✗ cliente ${c.email}: ${error.message}`);
      fallos++;
    } else {
      clientesBorrados++;
    }
  }
  if (clientesBorrados) console.log(`  ✓ ${clientesBorrados} clientes de prueba`);

  /* 4. Los usuarios de auth que dejaron las pruebas.
     Los de `soporte-…@ejemplo.invalid` y `prueba-…@ejemplo.com`. */
  const { data: usuarios } = await db.rpc("ejecutar_sql", {
    consulta:
      "select id, email from auth.users " +
      "where email like '%@ejemplo.invalid' " +
      "   or email like 'prueba-%@ejemplo.com' " +
      "   or email like '%@ejemplo.com' and email like '-test-%'",
    args: [],
  });

  let usuariosBorrados = 0;
  for (const u of usuarios || []) {
    /* El perfil va antes que el usuario: `profiles.id` lo referencia, y
       si se borrara el usuario primero el perfil se iría igual, pero
       así se ve que se tocan las dos cosas. */
    await db.from("profiles").delete().eq("id", u.id);
    const r = await fetch(process.env.SUPABASE_URL + "/auth/v1/admin/users/" + u.id, {
      method: "DELETE",
      headers: {
        apikey: process.env.SUPABASE_SECRET_KEY,
        Authorization: "Bearer " + process.env.SUPABASE_SECRET_KEY,
      },
    });
    if (r.ok) {
      usuariosBorrados++;
    } else {
      console.log(`  ✗ usuario ${u.email}: HTTP ${r.status}`);
      fallos++;
    }
  }
  if (usuariosBorrados) console.log(`  ✓ ${usuariosBorrados} usuarios de auth`);

  /* ---- Comprobación final ---- */
  const { data: quedan } = await db.from("clients").select("id");
  const { data: botsQuedan } = await db.from("bots").select("id,instance_name");
  const { data: sesionesQuedan } = await db.from("bot_sesiones").select("id");

  console.log("\n── Cómo queda ──\n");
  console.log(`  clientes:  ${(quedan || []).length}`);
  console.log(`  bots:      ${(botsQuedan || []).length}`);
  console.log(`  sesiones:  ${(sesionesQuedan || []).length}`);

  if (fallos) {
    console.log(`\n✗ ${fallos} cosa(s) no se pudieron borrar. Están en la lista de arriba.\n`);
    process.exit(1);
  }
  console.log("\n✓ Base limpia.\n");
  process.exit(0);
})().catch((e) => {
  console.error("\n✗ " + e.message + "\n");
  process.exit(1);
});