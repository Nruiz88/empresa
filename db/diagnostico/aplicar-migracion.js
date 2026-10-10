// Aplica una migración y dice qué ha pasado con cada sentencia.
//
// ── POR QUÉ `pg` Y NO UN RPC DE SUPABASE ──
//
// `db/migrate.js` ya lo hace así, con el cliente `pg` contra la
// `DATABASE_URL`. La primera versión de este script usó un RPC
// `ejecutar_sql` que no existe en esta base, y falló con un 404 de
// PostgREST que no dice nada útil ("Searched for the function
// public.ejecutar_sql").
//
// Un RPC inventado que no existe da un error de cuatro líneas que
// habla de la caché de esquema y no del problema. Reutilizar lo que ya
// funciona es más rápido que adivinar.
//
// ── POR QUÉ IMPRIME CADA SENTENCIA ──
//
// Porque una migración tiene veinte sentencias y si una falla, un "ok"
// genérico no dice cuál. Con DDL, además, una sentencia a medias deja
// el esquema en un estado que nadie ha pedido: o se ve cuál falló, o
// hay que deshacer a ciegas.
//
// ── POR QUÉ COMPRUEBA EL RESULTADO AL FINAL ──
//
// Porque "aplicadas 12 de 12" no dice si la tabla existe ni si tiene las
// filas que se sembraron. Una sentencia puede ejecutarse y no hacer lo
// que parecía: un `on conflict do nothing` con una clave que no es la
// misma se lleva todas las filas.
//
//   node db/aplicar-migracion.js db/migrations/023_planes.sql

require("../../lib/env").load();

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

if (!process.env.DATABASE_URL) {
  console.log("\n  x falta DATABASE_URL\n");
  process.exit(1);
}

const fichero = process.argv[2];
if (!fichero || !fs.existsSync(fichero)) {
  console.log("\n  x no se encuentra la migración: " + (fichero || "(nada)") + "\n");
  process.exit(1);
}

const sql = fs.readFileSync(fichero, "utf8");

/* Se parte por ";" de final de línea, y se descartan los comentarios.

   Los comentarios tienen que salir ANTES de partir: si no, un ";" dentro
   de un comentario corta una sentencia por la mitad y el error que sale
   apunta a una línea que no es la del problema.

   Un ";" dentro de un texto (un nombre de plan que lo lleve) partiría
   mal, y por eso se cuenta: si aparece dentro de comillas avisa, en vez
   de cortar en silencio y producir un errorraro. */
const sinComentarios = sql
  .split("\n")
  .filter((l) => !/^\s*--/.test(l))
  .join("\n");

const comillas = (sinComentarios.match(/'/g) || []).length;
if (comillas % 2 !== 0) {
  console.log("\n  ! hay un número impar de comillas simples: algún texto no");
  console.log("    está cerrado y el reparto por ';' va a ser incorrecto.\n");
}

const sentencias = sinComentarios
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

console.log("");
console.log("migración: " + path.basename(fichero));
console.log("sentencias: " + sentencias.length);
console.log("");

(async () => {
  const cliente = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  let aplicadas = 0;
  const fallos = [];

  try {
    await cliente.connect();

    for (let i = 0; i < sentencias.length; i++) {
      const s = sentencias[i];
      const primera = s.split("\n")[0].slice(0, 64);

      try {
        await cliente.query(s);
        aplicadas++;
        console.log("  ok  " + String(i + 1).padStart(2) + "  " + primera);
      } catch (e) {
        fallos.push({ n: i + 1, sql: primera, error: e.message });
        console.log("  x   " + String(i + 1).padStart(2) + "  " + primera);
        console.log("      " + e.message);
      }
    }
  } finally {
    await cliente.end();
  }

  console.log("");
  console.log("aplicadas: " + aplicadas + " de " + sentencias.length);

  if (fallos.length) {
    console.log("");
    console.log("La migración queda a medias. Con DDL eso NO es transitorio: el");
    console.log("esquema se queda en un estado que nadie ha pedido. Hay que leer");
    console.log("los fallos de arriba antes de volver a intentarlo.");
    process.exit(1);
  }

  /* La comprobación que importa: no que las sentencias corrieran, sino
     que la tabla exista y tenga las filas que se sembraron. */
  const { Client: C2 } = require("pg");
  const c2 = new C2({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await c2.connect();
    const { rows } = await c2.query(
      "select id, nombre, precio, moneda, destacado, orden, activo from plans order by orden"
    );

    console.log("");
    console.log("la tabla plans tiene " + rows.length + " plan(es):");
    for (const p of rows) {
      console.log(
        "  " + String(p.orden).padStart(2) + "  " + String(p.nombre).padEnd(12) +
        "  precio=" + (p.precio === null ? "(a consultar)" : p.precio + " " + p.moneda) +
        "  activo=" + (p.activo ? "si" : "no") +
        (p.destacado ? "  <- destacado" : "")
      );
    }

    const sinPrecio = rows.filter((p) => p.precio === null).length;
    console.log("");
    console.log("sin precio (se pinte como \"A consultar\"): " + sinPrecio + " de " + rows.length);
  } catch (e) {
    console.log("");
    console.log("x  la tabla plans no se puede leer: " + e.message);
    process.exit(1);
  } finally {
    await c2.end();
  }
})();