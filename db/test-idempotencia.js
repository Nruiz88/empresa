/* =========================================================
   Nexo Studio — ¿Las migraciones se pueden aplicar dos veces?
   ------------------------------------------------------------
   Aplica TODAS las migraciones dos veces seguidas en un schema aparte
   (_prueba). Si son idempotentes, las dos pasadas tienen que salir
   bien y las tablas seguir con RLS.

   ⚠️  POR QUÉ ESTE FICHERO NECESITA TAN CUIDADO
   ------------------------------------------------
   Este test trabaja sobre la MISMA base de datos que la aplicación.
   Mal hecho, la borra. Y ya lo hizo: por usar
   `search_path = _prueba, public`, un `drop function if exists` de
   las migraciones no encontraba la función en `_prueba`, caía a
   `public` y la eliminaba de verdad. Así desapareció
   `modulos_del_cliente()` de la base real y el portal dejó de
   mostrar los módulos sin que ningún test lo dijera.

   Las tres defensas que hay ahora:

     1. `search_path = _prueba` SOLO. Sin `public` detrás, ningún
        objeto sin cualificar puede caer fuera del schema de prueba.
     2. Los objetos de public que las migraciones necesitan (los
        ENUM y `auth.users`) se copian a `_prueba` antes de empezar.
     3. Se guarda la definición de todas las funciones de `public`
        antes de empezar y se comprueba que siguen ahí al terminar.
        Si alguna falta, se restaura y el test falla.

   La 3 es la importante: si algún día una migración vuelve a hacer
   daño en `public`, este test lo detecta en vez de dejar la base
   coja en silencio.
   ========================================================= */

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
require("../lib/env").load();

const c = new Client({ connectionString: process.env.DATABASE_URL });
const SCHEMA = "_prueba";

/** Funciones de public que las migraciones crean. */
const FUNCIONES = [
  "es_staff",
  "es_cliente_de",
  "check_client_rol",
  "touch_actualizado",
  "tiene_modulo",
  "modulos_del_cliente",
  "perfil_completo",
];

async function guardarFunciones() {
  const { rows } = await c.query(
    "select p.proname, pg_get_functiondef(p.oid) as def " +
      "from pg_proc p join pg_namespace n on n.oid = p.pronamespace " +
      "where n.nspname = 'public' and p.proname = any($1)",
    [FUNCIONES]
  );
  return rows;
}

async function faltan() {
  const { rows } = await c.query(
    "select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace " +
      "where n.nspname = 'public' and proname = any($1)",
    [FUNCIONES]
  );
  return FUNCIONES.filter((f) => !rows.some((r) => r.proname === f));
}

(async () => {
  await c.connect();

  /* ---- 0. Foto de las funciones de public ---- */
  const definiciones = await guardarFunciones();
  console.log("Funciones de public antes: " + definiciones.map((f) => f.proname).join(", "));

  /* ---- 1. Schema de prueba, con SUS PROPIOS tipos ---- */
  await c.query("drop schema if exists " + SCHEMA + " cascade");
  await c.query("create schema " + SCHEMA);

  /* Los ENUM que las migraciones usan. Se copian aquí, con TODAS sus
     etiquetas de golpe: crear el tipo etiqueta a etiqueta falla en la
     segunda, porque el tipo ya existe. */
  const enums = await c.query(
    "select t.typname, array_agg(e.enumlabel order by e.enumsortorder) as labels " +
      "from pg_type t " +
      "join pg_namespace n on n.oid = t.typnamespace " +
      "join pg_enum e on e.enumtypid = t.oid " +
      "where n.nspname = 'public' and t.typname in " +
      "  ('service_kind','service_status','lead_estado','user_role'," +
      "   'cobro_estado','suscripcion_estado') " +
      "group by t.typname order by t.typname"
  );

  for (const e of enums.rows) {
    /* node-postgres devuelve los arrays de Postgres como cadena
       "{a,b,c}", no como array de JavaScript. Hay que parsearlo o
       .map() peta. */
    const crudo = Array.isArray(e.labels)
      ? e.labels
      : String(e.labels || "").replace(/^\{|\}$/g, "").split(",").filter(Boolean);

    const etiquetas = crudo
      .map((l) => "'" + String(l).replace(/'/g, "''").trim() + "'")
      .join(", ");

    if (!etiquetas) continue;

    try {
      await c.query(
        "create type " + SCHEMA + "." + e.typname + " as enum (" + etiquetas + ")"
      );
      console.log("  tipo copiado: " + e.typname + " (" + crudo.length + ")");
    } catch (err) {
      console.log("  ✗ no se pudo copiar " + e.typname + ": " + err.message);
    }
  }

  /* auth.users: la referencia cruzada de 001. Se hace un auth en miniatura
     DENTRO de _prueba, para no depender de que exista en public ni de
     tocarlo. */
  await c.query("create schema if not exists " + SCHEMA + "_auth");
  await c.query("create table if not exists " + SCHEMA + "_auth.users (id uuid primary key)");

  /* La tabla de control. No la crea ninguna migración (la crea
     db/migrate.js), pero 006 le pone RLS, así que sin ella falla. */
  await c.query(
    "create table if not exists " + SCHEMA + ".schema_migrations " +
      "(nombre text primary key, aplicada_en timestamptz not null default now())"
  );

  /* search_path SOLO con el schema de prueba. Sin `public` detrás: es lo
     que impide que un `drop if exists` caiga en la base real. */
  await c.query("set search_path to " + SCHEMA);

  /* Las migraciones referencian `auth.users`. Se sustituye por la tabla
     del schema de prueba, porque `auth` está en public y ya no está en
     el search_path. */
  const dir = path.join(__dirname, "migrations");
  const ficheros = fs.readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const preparar = (sql) =>
    sql
      /* `set search_path = public` de las funciones security definer:
         en el test apunta al schema de prueba. */
      .replace(/set search_path = public/g, "set search_path to " + SCHEMA)
      /* `references auth.users` → la tabla de prueba. */
      .replace(/references auth\.users/g, "references " + SCHEMA + "_auth.users")
      /* `auth.uid()` / `auth.uid` dentro de los cuerpos. */
      .replace(/auth\.uid\(\)/g, "null")
      /* COMMENT y drop sobre auth. */
      .replace(/on auth\./g, "on " + SCHEMA + "_auth.");

  let fallos = 0;

  for (let vuelta = 1; vuelta <= 2; vuelta++) {
    console.log("\n=== PASADA " + vuelta + " ===");
    for (const f of ficheros) {
      const sql = preparar(fs.readFileSync(path.join(dir, f), "utf8"));
      try {
        await c.query(sql);
        console.log("  ok    " + f);
      } catch (e) {
        fallos++;
        console.log("  FALLO " + f + " -> " + e.message);
        const pos = Number(e.position || 0);
        if (pos) {
          const texto = fs.readFileSync(path.join(dir, f), "utf8");
          const linea = texto.slice(0, pos).split("\n").length;
          console.log("  línea " + linea + ": " + texto.split("\n")[linea - 1]);
        }
        break;
      }
    }
    if (fallos) break;
  }

  /* ---- 2. RLS en el schema de prueba ---- */
  let sinRls = 0;
  if (!fallos) {
    const rls = await c.query(
      "select relname, relrowsecurity from pg_class t " +
        "join pg_namespace n on n.oid = t.relnamespace " +
        "where n.nspname = $1 and t.relkind = 'r' order by relname",
      [SCHEMA]
    );
    console.log("\nTablas tras 2 pasadas:");
    for (const r of rls.rows) {
      if (!r.relrowsecurity) sinRls++;
      console.log("  " + r.relname.padEnd(20) + (r.relrowsecurity ? "RLS" : "SIN RLS  <-- MAL"));
    }
    if (sinRls) fallos++;
  }

  /* ---- 3. Limpiar y COMPROBAR que public está intacto ---- */
  await c.query("set search_path to public");
  await c.query("drop schema if exists " + SCHEMA + " cascade");
  await c.query("drop schema if exists " + SCHEMA + "_auth cascade");

  const perdidas = await faltan();
  if (perdidas.length) {
    console.log("\n✗ ESTE TEST ROMPIÓ LA BASE REAL: faltan " + perdidas.join(", "));
    console.log("  Se restauran ahora desde la copia de seguridad de arriba.");

    const copia = new Map(definiciones.map((d) => [d.proname, d.def]));
    for (const nombre of perdidas) {
      const def = copia.get(nombre);
      if (!def) {
        console.log("  ✗ no tengo copia de " + nombre + ": hay que crearla a mano");
        continue;
      }
      try {
        /* pg_get_functiondef devuelve el cuerpo con `search_path = public`
           (o el que tuviera). Se deja tal cual: es lo que había. */
        await c.query(def);
        console.log("  ✓ restaurada " + nombre);
      } catch (e) {
        console.log("  ✗ no se pudo restaurar " + nombre + ": " + e.message);
      }
    }
    fallos++;
  } else {
    console.log("\n✓ Las funciones de public siguen ahí. La base real está intacta.");
  }

  await c.end();
  console.log("");
  console.log(
    fallos
      ? "✗ El test de idempotencia ha fallado."
      : "✓ Las migraciones son idempotentes y la base real no se ha tocado."
  );
  process.exit(fallos ? 1 : 0);
})().catch((e) => {
  console.error("Error: " + e.message);
  process.exit(1);
});
