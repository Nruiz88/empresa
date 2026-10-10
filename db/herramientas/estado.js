/* =========================================================
   Nexo Studio — Estado real del proyecto
   ------------------------------------------------------------
   Uso:  npm run estado

   Imprime lo que HAY ahora, leyéndolo del código y de la base de
   datos. No es un documento que alguien escribe a mano y se queda
   viejo: si mañana se añade una ruta o una tabla, sale aquí sin que
   nadie se acuerde de actualizar un papel.

   Comprueba también dos cosas que se han roto alguna vez:
     - Que las claves de .env.example coincidan con las que pide el
       código. Si no coinciden, una instalación nueva falla al
       arrancar y no se sabe por qué.
     - Que toda tabla tenga RLS (si tiene secret key, ver db/rls.js).
   ========================================================= */

const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..", "..", );
const soloTexto = (archivo) => (fs.existsSync(archivo) ? fs.readFileSync(archivo, "utf8") : "");

const linea = (c = "-") => console.log("  " + c.repeat(58));

function titulo(t) {
  console.log("\n" + t.toUpperCase());
  linea();
}

/** Ficheros .js de una carpeta, con su ruta COMPLETA.
    Con solo el nombre no vale: luego no se encuentra al leerlos. */
function jsDe(dir) {
  const p = path.join(RAIZ, dir);
  if (!fs.existsSync(p)) return [];
  return fs
    .readdirSync(p, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".js"))
    .map((e) => path.join(dir, e.name));
}

/** Cuenta ficheros de forma recursiva, incluyendo subcarpetas */
function contar(dir, filtro = /\.(js|ejs|css|json|sql|md)$/) {
  const p = path.join(RAIZ, dir);
  if (!fs.existsSync(p)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    if (e.isDirectory()) n += contar(path.join(dir, e.name), filtro);
    else if (filtro.test(e.name)) n++;
  }
  return n;
}

/** Conecta una sola vez y lo recuerda: lo usan dos secciones (migraciones
    aplicadas y base de datos) y abrir dos conexiones sería de más. */
let _db = null;
async function db() {
  if (_db) return _db;
  require("../../lib/env").load();
  const { Client } = require("pg");
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  _db = c;
  return c;
}

/** Nombres de tabla entre comillas, por si alguno fuera una palabra
    reservada o trajera comillas dentro. */
const ident = (n) => '"' + n.replace(/"/g, '""') + '"';

/**
 * Filas REALES de cada tabla, en una sola ida y vuelta.
 *
 * Antes usábamos pg_stat_user_tables.n_live_tup, que es la ESTIMACIÓN
 * del colector de estadísticas, no un count. Daba cifras inventadas:
 * schema_migrations aparecía con 82 filas cuando tenía 6, y por lo
 * mismo cualquier tabla recién insertada salía en 0. Para un comando
 * cuyo trabajo es decir la verdad, una estimación no vale.
 *
 * Si una tabla está viva con escrituras, el count(*) puede tardar: se
 * avisa en vez de mentir. Para eso está el ?. */
async function filasReales(c, nombres) {
  const out = new Map();
  if (!nombres.length) return out;
  const sel = nombres.map((n, i) => `(select count(*)::int from ${ident(n)}) as c${i}`).join(", ");
  try {
    const r = await c.query("select " + sel);
    nombres.forEach((n, i) => out.set(n, r.rows[0]["c" + i]));
  } catch {
    /* Una tabla que no responde no puede tumbar el informe entero. */
    nombres.forEach((n) => out.set(n, null));
  }
  return out;
}

(async () => {
  /* ---------- Scripts ---------- */
  titulo("Comandos");
  const scripts = require(path.join(RAIZ, "package.json")).scripts;
  for (const [k, v] of Object.entries(scripts)) {
    console.log("  npm run " + k.padEnd(16) + v);
  }

  /* ---------- Estructura ---------- */
  titulo("Estructura");
  const carpetas = [
    ["routes", "Rutas. web.js es lo público; panel*.js, el panel."],
    ["lib", "Lógica reutilizable, sin nada de Express."],
    ["db", "Migraciones, comprobaciones y datos de ejemplo."],
    ["views", "Plantillas EJS."],
    ["content", "Textos, casos y precios. Lo que se edita sin tocar código."],
    ["public", "CSS, JS y estáticos."],
  ];
  for (const [c, desc] of carpetas) {
    console.log("  " + c.padEnd(10) + String(contar(c)).padStart(4) + " ficheros  " + desc);
  }

  /* ---------- Rutas registradas ---------- */
  titulo("Rutas del panel");
  const panel = soloTexto(path.join(RAIZ, "routes", "panel.js"));
  const modulos = ["panel-clientes", "panel-servicios", "panel-consultas", "panel-cobros", "panel-accesos", "panel-portal"];
  for (const m of modulos) {
    const fuente = soloTexto(path.join(RAIZ, "routes", m + ".js"));
    const verbs = [...fuente.matchAll(/router\.(get|post)\("([^"]+)"/g)].map((x) => x[1].toUpperCase() + " " + x[2]);
    if (!verbs.length) continue;
    console.log("  " + m.replace("panel-", ""));
    verbs.forEach((v) => console.log("      " + v));
  }
  console.log("  (las del login, logout y raíz están en routes/panel.js: " +
    (panel.match(/router\.(get|post)\(/g) || []).length + " en total)");

  /* ---------- Migraciones ----------
     Ahora sí se contrasta el disco con la base de datos. Antes solo
     listaba los ficheros .sql y su primera línea, sin decir si estaban
     aplicadas: para eso está `npm run migrate --estado`, y saltarse
     esa comprobación hacía que este informe no distinguiera entre
     "escrito" y "en la base de datos". */
  titulo("Migraciones");
  const migs = fs.existsSync(path.join(RAIZ, "db", "migrations"))
    ? fs.readdirSync(path.join(RAIZ, "db", "migrations")).filter((f) => f.endsWith(".sql")).sort()
    : [];

  let aplicadas = null;
  try {
    const c = await db();
    const r = await c.query("select nombre, aplicada_en from schema_migrations");
    aplicadas = new Map(r.rows.map((x) => [x.nombre, x.aplicada_en]));
  } catch (err) {
    console.log("  (no se pudo consultar la base de datos: " + err.message + ")");
  }

  for (const m of migs) {
    const primera = soloTexto(path.join(RAIZ, "db", "migrations", m))
      .split("\n")
      .find((l) => l.trim() && !l.startsWith("--")) || "";
    let estado;
    if (aplicadas === null) estado = "· sin comprobar";
    else if (aplicadas.has(m)) {
      const d = new Date(aplicadas.get(m));
      estado = "✓ aplicada " + d.toISOString().slice(0, 10);
    } else estado = "✗ PENDIENTE";
    console.log("  " + estado.padEnd(22) + m.padEnd(28) + primera.trim().slice(0, 26));
  }

  /* Si el disco y la base de datos no coinciden, es lo primero que hay
     que saber: todo lo demás de este informe es secundario. */
  if (aplicadas) {
    const pend = migs.filter((m) => !aplicadas.has(m));
    const huerfanas = [...aplicadas.keys()].filter((n) => !migs.includes(n));
    if (pend.length) {
      console.log("  ✗ " + pend.length + " sin aplicar. Ejecuta: npm run migrate");
    } else {
      console.log("  ✓ la base de datos está al día con el disco");
    }
    if (huerfanas.length) {
      console.log("  · aplicadas pero el fichero no existe: " + huerfanas.join(", "));
    }
  }

  /* ---------- Base de datos ---------- */
  titulo("Base de datos");
  try {
    const c = await db();

    const tablas = await c.query(
      "select t.relname, t.relrowsecurity from pg_class t join pg_namespace n on n.oid=t.relnamespace " +
        "where n.nspname='public' and t.relkind='r' order by t.relname"
    );
    const vistas = await c.query(
      "select viewname from pg_views where schemaname='public' order by viewname"
    );

    const nDe = await filasReales(c, tablas.rows.map((t) => t.relname));

    console.log("  tablas:");
    for (const t of tablas.rows) {
      const n = nDe.get(t.relname);
      console.log(
        "      " + t.relname.padEnd(20) +
        (t.relrowsecurity ? "RLS" : "SIN RLS") + "   " +
        (n === null || n === undefined ? "? filas" : n + " filas")
      );
    }
    console.log("  vistas:");
    for (const v of vistas.rows) console.log("      " + v.viewname);

    /* Una tabla sin RLS es un agujero: con la publishable key se lee
       desde fuera. Se dice aquí, no solo en db/rls.js, porque este es
       el comando que se ejecuta al empezar. */
    const sinRls = tablas.rows.filter((t) => !t.relrowsecurity).map((t) => t.relname);
    if (sinRls.length) {
      console.log("");
      console.log("  ✗ SIN RLS: " + sinRls.join(", "));
      console.log("    Se pueden leer desde fuera con la clave publicable.");
      console.log("    Mira db/rls.js.");
    }

    await c.end();
  } catch (err) {
    console.log("  (no se pudo leer: " + err.message + ")");
  }

  /* ---------- Comprobación de claves ----------
     Ha pasado: el código pedía SUPABASE_PUBLISHABLE_KEY y
     .env.example anunciaba SUPABASE_ANON_KEY. Una instalación nueva
     fallaba al arrancar sin decir por qué. */
  titulo("Claves de entorno");
  /* Se revisan TODOS los .js del proyecto, no solo lib/routes/db:
     server.js y panel.js también las usan, y fue justo ahí donde se
     coló el fallo del .env. */
  const usadas = new Set();
  const recorrer = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const completo = path.join(dir, e.name);
      if (e.isDirectory()) {
        recorrer(completo);
        continue;
      }
      if (!e.name.endsWith(".js")) continue;

      const fuente = fs.readFileSync(completo, "utf8");
      for (const m of fuente.matchAll(/env\.require\(([^)]+)\)/g)) {
        m[1].split(",").forEach((k) => usadas.add(k.trim().replace(/["']/g, "")));
      }
      for (const m of fuente.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) {
        usadas.add(m[1]);
      }
    }
  };
  recorrer(RAIZ);

  const ejemplo = soloTexto(path.join(RAIZ, ".env.example"));
  const declaradas = new Set([...ejemplo.matchAll(/^([A-Z_][A-Z0-9_]*)=/gm)].map((m) => m[1]));

  /* Claves que las pone quien arranca el proceso y no tienen que ir
     obligatorias en el ejemplo.

     PANEL_HOST, BOT_HOST y los puertos van comentadas en .env.example
     a propósito: puestas sin comment, alguien las copiaría a ciegas y
     el panel se ataría a 127.0.0.1 sin querer. Las de los servicios
     aparte tampoco son obligatorias en el monolito: BOT_PORT solo lo
     lee bot.js, que solo arranca con `npm run start:bot`.

     TZ es un caso raro: no es una clave del .env sino de la máquina.
     La fija db/test-fechas.js al correr las pruebas en distintas zonas,
     pero en producción la pone el sistema. Está explicada en
     .env.example con la razón. */
  const opcionales = new Set([
    "PORT",
    "NODE_ENV",
    "PANEL_HOST",
    "BOT_HOST",
    "BOT_PORT",
    "BOT_URL",
    "SITE_URL",
    "PANEL_URL",
    "TZ",
  ]);

  const faltan = [...usadas].filter((k) => !declaradas.has(k) && !opcionales.has(k)).sort();
  const sobran = [...declaradas].filter((k) => !usadas.has(k)).sort();

  if (faltan.length) {
    console.log("  ✗ el código las usa pero NO están en .env.example:");
    faltan.forEach((k) => console.log("      " + k));
  } else {
    console.log("  ✓ el código no usa ninguna clave que falte en .env.example");
  }
  if (sobran.length) {
    console.log("  · declaradas en .env.example pero el código no las usa:");
    sobran.forEach((k) => console.log("      " + k));
    console.log("      (si es a propósito, mejor commented out y con nota)");
  }

  console.log("\n");
})().catch((e) => {
  console.error("error: " + e.message);
  process.exit(1);
});
