require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

/* =========================================================
   Shopcito — Borrar las cuentas y los datos de prueba
   ------------------------------------------------------------
   Uso:
     node db/borrar-pruebas.js            dry run: cuenta y no toca nada
     node db/borrar-pruebas.js --si       borra de verdad

   ── POR QUÉ HAY QUE PASAR `--si` ──

   Porque este script borra 138 clientes y 4 cuentas, y no hay vuelta
   atrás. Que haga falta decirlo a propósito es lo que evita el
   `node db/borrar-pruebas.js` con el dedo en el Enter.

   ── POR QUÉ NO SE USA EL CASCADE Y YA ──

   Porque el `CASCADE` de Postgres se lleva los hijos sí o sí, y sin
   contar. Aquí se cuenta antes y se dice después qué cayó de cada
   cosa. Un borrado que no informa de lo que borró es un borrado del
   que no se puede hablar después.

   ── LA SALVAGUARDA DE VERDAD ──

   `CONSERVAR`. El admin nuevo está ahí escrito a mano, y el script
   se niega a seguir si esa cuenta no existe. Borrar las pruebas y
   quedarse sin acceso al panel no es un borrado: es dejar la tienda
   cerrada y tirar la llave.

   ── EL ORDEN ──

   Primero las cuentas, después los datos. Al revés no pasa nada
   grave, pero así, si algo falla a medio camino, lo que queda es una
   base sin admin, que es la forma mala de quedarse sin nada.
   ========================================================= */

const CONSERVAR = ["niconqn.88@gmail.com"];

/** Lo que se responde a `--si`. */
const SEGURO = process.argv.includes("--si");

async function usuarios() {
  const todos = [];
  for (let pag = 1; pag <= 10; pag++) {
    const { data } = await db.auth.admin.listUsers({ page: pag, perPage: 200 });
    todos.push(...(data.users || []));
    if (!(data.users || []).length) break;
  }
  return todos;
}

(async () => {
  console.log("\n═══ Borrar las pruebas ═══\n");

  if (!SEGURO) {
    console.log("  ESTO ES UN SIMULACRO. No se borra nada.");
    console.log("  Para hacerlo de verdad, con el flag:");
    console.log("");
    console.log("      node db/borrar-pruebas.js --si");
    console.log("");
  } else {
    console.log("  ⚠ BORRADO REAL. No hay vuelta atrás.");
    console.log("");
  }

  /* ─────────────────────────────────────────────────────────
     LA COMPROBACIÓN QUE PARA TODO

     Se hace ANTES de borrar nada. Si el admin que hay que conservar no
     está, el script sale sin haber borrado ni una fila.
     ───────────────────────────────────────────────────────── */
  const todos = await usuarios();

  const quedan = todos.filter((u) =>
    CONSERVAR.includes(String(u.email || "").toLowerCase())
  );

  if (!quedan.length) {
    console.log("  × no está " + CONSERVAR[0] + ".");
    console.log("    Si se borrara todo, el panel se quedaría sin acceso.");
    console.log("    No se borra nada. Crea ese admin primero.");
    console.log("");
    process.exit(1);
  }

  const aBorrar = todos.filter(
    (u) => !CONSERVAR.includes(String(u.email || "").toLowerCase())
  );

  console.log("  Cuentas a borrar: " + aBorrar.length);
  for (const u of aBorrar) {
    const { data: perfil } = await db
      .from("profiles")
      .select("rol")
      .eq("id", u.id)
      .maybeSingle();
    console.log("    " + String(u.email).padEnd(34) + (perfil ? perfil.rol : "sin perfil"));
  }

  console.log("");
  console.log("  Se conserva:      " + quedan[0].email);

  /* ---------- Contar antes ---------- */
  const { data: antes } = await db.rpc("ejecutar_sql", {
    consulta:
      "select (select count(*) from clients) as clientes, " +
      "(select count(*) from services) as servicios, " +
      "(select count(*) from cobros) as cobros, " +
      "(select count(*) from profiles) as perfiles",
    args: [],
  });

  const c = antes && antes[0] ? antes[0] : {};

  console.log("");
  console.log("  Datos ahora:");
  console.log("    clientes:  " + (c.clientes || 0));
  console.log("    servicios: " + (c.servicios || 0));
  console.log("    cobros:    " + (c.cobros || 0));
  console.log("    perfiles:  " + (c.perfiles || 0));

  if (!SEGURO) {
    console.log("");
    console.log("  ──────────────────────────────────────────────");
    console.log("  Era un simulacro. No se ha borrado nada.");
    console.log("");
    return;
  }

  /* ---------- 1. Las cuentas ---------- */

  console.log("");
  console.log("  ── borrando cuentas ──");

  let cuentas = 0;

  for (const u of aBorrar) {
    /* El perfil va primero. Si se borra la cuenta y el perfil
       sobrevive, queda una fila huérfana que no dice a quién
       pertenecía y ocupa sitio para siempre. */
    const { error: ePerfil } = await db.from("profiles").delete().eq("id", u.id);
    if (ePerfil) {
      console.log("    × " + u.email + " — perfil: " + ePerfil.message);
      continue;
    }

    const { error } = await db.auth.admin.deleteUser(u.id);

    if (error) {
      console.log("    × " + u.email + " — " + error.message);
    } else {
      console.log("    ✓ " + u.email);
      cuentas++;
    }
  }

  console.log("    cuentas borradas: " + cuentas);

  /* ---------- 2. Los clientes ----------
     El `CASCADE` se lleva los hijos. Se borran de golpe porque
     `in()` con 138 ids es una sola llamada, y una por una serían
     138 viajes de ida y vuelta para lo mismo. */

  console.log("");
  console.log("  ── borrando clientes ──");

  const { data: ids } = await db.from("clients").select("id");

  const { error: eClientes } = await db
    .from("clients")
    .delete()
    .in("id", (ids || []).map((x) => x.id));

  if (eClientes) {
    console.log("    × " + eClientes.message);
    console.log("");
    console.log("  Las cuentas ya están borradas. Si esto falló, mira:");
    console.log("    db/ver-enganches.js   — qué cuelga de cada tabla");
    console.log("");
    process.exit(1);
  }

  console.log("    clientes borrados: " + (ids || []).length);

  /* ---------- 3. Contar después ---------- */

  const { data: despues } = await db.rpc("ejecutar_sql", {
    consulta:
      "select (select count(*) from clients) as clientes, " +
      "(select count(*) from services) as servicios, " +
      "(select count(*) from cobros) as cobros, " +
      "(select count(*) from profiles) as perfiles",
    args: [],
  });

  const d = despues && despues[0] ? despues[0] : {};

  console.log("");
  console.log("  ──────────────────────────────────────────────");
  console.log("  Queda:");
  console.log("    clientes:  " + (d.clientes || 0) + "   (antes " + (c.clientes || 0) + ")");
  console.log("    servicios: " + (d.servicios || 0) + "   (antes " + (c.servicios || 0) + ")");
  console.log("    cobros:    " + (d.cobros || 0) + "   (antes " + (c.cobros || 0) + ")");
  console.log("    perfiles:  " + (d.perfiles || 0) + "   (antes " + (c.perfiles || 0) + ")");
  console.log("");
  console.log("  Entra con: " + quedan[0].email);
  console.log("");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});
