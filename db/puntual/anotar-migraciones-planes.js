/* ¿Las tres migraciones de planes están realmente aplicadas?
   ─────────────────────────────────────────────────────────────
   POR QUÉ HAY QUE COMPROBAR Y NO ANOTAR A BLAZ

   `schema_migrations` dice qué se ha aplicado. Si no está anotada, el
   panel avisa. La Tentación es anotar y_callar el aviso.

   Pero anotar es una afirmación: «esto está aplicado». Si no lo está,
   el panel deja de avisar y lo único que queda es el fallo, cuando
   alguien use `planes.cta_href` y la columna no exista. Un aviso
   equivocado molesta; un aviso que se calló a lo falso no molesta hasta
   que ya es caro.

   ── CÓMO SE COMPRUEBA ──

   Cada migración dejó una cosa que se puede mirar:

     023  la tabla `plans` con sus tres filas
     024  las columnas `cta_texto` y `cta_href`
     025  el RLS encendido y, sobre todo, que la clave del navegador
          NO pueda escribir

   Y al final se anotan, porque ya está comprobado. En ese orden: mirar
   primero, escribir después. */

require("../../lib/env").load();

const db = require("../../lib/supabase").getAdmin();

const supabase = require("../../lib/supabase");

const A_ANOTAR = ["023_planes.sql", "024_cta_planes.sql", "025_planes_rls.sql"];

async function columnasDe(PLAN) {
  const { data } = await db.rpc("ejecutar_sql", {
    consulta:
      "select column_name from information_schema.columns " +
      "where table_schema = 'public' and table_name = '" + PLAN + "'",
    args: [],
  });
  return new Set((data || []).map((c) => c.column_name));
}

(async () => {
  console.log("\n═══ ¿Están aplicadas? ═══\n");

  const pendientes = [];

  /* ---- 023: la tabla y sus tres filas ---- */
  console.log("  023_planes.sql");
  const { data: filas, error: eFilas } = await db.rpc("ejecutar_sql", {
    consulta: "select count(*) as c from plans",
    args: [],
  });

  if (eFilas) {
    console.log("     x la tabla no existe");
    pendientes.push("023_planes.sql");
  } else {
    const c = filas && filas[0] ? Number(filas[0].c) : 0;
    console.log("     " + (c === 3 ? "✓" : "!") + " la tabla plans tiene " + c + " filas (se esperaban 3)");
    if (c !== 3) pendientes.push("023_planes.sql");
  }

  /* ---- 024: las columnas del botón ---- */
  console.log("\n  024_cta_planes.sql");
  const cols = await columnasDe("plans");

  for (const c of ["cta_texto", "cta_href"]) {
    const ok = cols.has(c);
    console.log("     " + (ok ? "✓" : "!") + " columna " + c);
    if (!ok) pendientes.push("024_cta_planes.sql");
  }

  /* ---- 025: el RLS, y sobre todo que impide escribir ---- */
  console.log("\n  025_planes_rls.sql");

  const { data: rls } = await db.rpc("ejecutar_sql", {
    consulta: "select relrowsecurity from pg_class where relname = 'plans'",
    args: [],
  });

  const encendido = rls && rls[0] && rls[0].relrowsecurity === true;
  console.log("     " + (encendido ? "✓" : "!") + " RLS encendido");

  /* El RLS encendido dice que hay un marco. Lo que importa es que
     esté cerrado, y eso solo se sabe intentando escribir con la clave
     que va en el navegador. */
  const url = process.env.SUPABASE_URL;
  const clave = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !clave) {
    console.log("     ! no hay clave publicable con la que probar la escritura");
    pendientes.push("025_planes_rls.sql");
  } else {
    const { createClient } = require("@supabase/supabase-js");
    const publico = createClient(url, clave, { auth: { persistSession: false } });

    /* Se intenta escribir en un plan que no existe: si la política
       estuviera mal y concediera el insert, se crearía una fila basura.
       Por eso no se toca `inicial`. */
    const { data: creados, error: eInsert } = await publico
      .from("plans")
      .insert({ id: "__no_deberia_existir__", nombre: "x" })
      .select("id");

    if (eInsert) {
      console.log("     ✓ no deja insertar con la clave del navegador");
    } else if (!creados || !creados.length) {
      console.log("     ✓ no deja insertar con la clave del navegador (0 filas)");
    } else {
      /* Si se coló una fila, se borra con el cliente admin antes de
         nada: dejarían datos falsos en la tabla que se vende. */
      await supabase.getAdmin().from("plans").delete().eq("id", "__no_deberia_existir__");
      console.log("     x DEJÓ INSERTAR. fila falsa borrada.");
      pendientes.push("025_planes_rls.sql");
    }
  }

  console.log("");
  console.log("  ──────────────────────────────────────────────");

  if (pendientes.length) {
    console.log("  Faltan de verdad: " + pendientes.join(", "));
    console.log("  Se aplican con `node db/migrate.js`, no a mano.");
    console.log("  NO se anotan: anotar lo que no está aplicado hace que el");
    console.log("  panel calle un fallo que sigue ahí.\n");
    process.exit(1);
  }

  /* ---- Anotar, ya comprobado ---- */
  console.log("  Las tres están aplicadas. Se anotan.\n");

  const { error: eAnotar } = await db.rpc("ejecutar_sql", {
    consulta:
      "insert into schema_migrations (nombre) values " +
      A_ANOTAR.map((n) => "('" + n + "')").join(", ") +
      " on conflict do nothing",
    args: [],
  });

  if (eAnotar) {
    /* El RPC solo acepta SELECT, así que esto va a fallar. Y está bien
       que falle: escribir en el registro de migraciones por un atajo es
       justo lo que un registro no debería permitir. */
    console.log("  · el RPC no deja escribir en schema_migrations (solo SELECT)");
    console.log("    Es lo correcto. Se anotan con `node db/migrate.js`,");
    console.log("    que es quien debe hacerlo, y que es idempotente:");
    console.log("    estas tres son idempotentes, así que volver a pasarlas");
    console.log("    no cambia nada y solo las anota.\n");
    process.exit(2);
  }

  console.log("  ✓ anotadas\n");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});