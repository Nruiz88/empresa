/* =========================================================
   Nexo Studio — Lectura de .env sin dependencias
   ------------------------------------------------------------
   Node 24 admite `node --env-file=.env`, pero prefiero este
   archivo porque:
     - da mensajes de error claros si falta el .env
     - no falla si se ejecuta sin la flag
     - normaliza comillas y espacios

   EL FICHERO NO ES OBLIGATORIO
   ----------------------------
   El .env es una comodidad para DESARROLLO. En un contenedor las
   variables llegan ya puestas en el entorno (Docker, Coolify,
   systemd...), y el proyecto no lleva ningún .env dentro de la
   imagen, porque las credenciales no se hornean en la imagen.

   Antes, si el fichero no estaba, `load()` devolvía { ok: false } y
   todo lo que llamara a `env.require()` reventaba con "Falta el
   .env". La primera vez que se desplegó, el contenedor arrancó, dio
   error yCoolify hizo rollback, con un mensaje que señalaba al
   fichero cuando el problema era justo que no debía existir.

   Ahora, si no hay fichero pero las variables ya están en el
   entorno, se sigue adelante sin quejar. El error solo aparece
   cuando además falta lo que de verdad hace falta.

   Regla: este módulo NUNCA imprime el valor de una variable.
   Solo dice qué falta, nunca qué contiene.
   ========================================================= */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");

/** Convierte "clave=valor" en objeto, respetando comillas y comentarios */
function parse(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // Quita comillas envolventes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Comentario al final de una línea con valor
    value = value.replace(/\s+#.*$/, "").trim();

    if (key) out[key] = value;
  }
  return out;
}

let loaded = false;

/**
 * Carga el .env una sola vez.
 *
 * Devuelve { ok, faltan, error }.
 *
 * `ok: false` solo cuando NO hay fichero .env Y además no hay
 * ninguna variable definida en el entorno. Con una sola de las dos
 * fuentes vale: si hay variables reales, ya tenemos lo que hace
 * falta y el fichero es un extra.
 *
 * @param {string[]}~\tips Variables que se sabe que hacen falta. Si se
 *   pasan, `ok` comprueba también que estén, para poder avisar en el
 *   arranque en vez de reventar en la primera petición.
 */
function load(tips = []) {
  if (loaded) return comprobar(tips);

  const hayFichero = fs.existsSync(ENV_PATH);

  if (hayFichero) {
    const parsed = parse(fs.readFileSync(ENV_PATH, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      /* Una variable ya definida en el entorno real gana sobre el
         .env. Esto es lo que permite tener un .env de desarrollo con
         valores por defecto y que producción los sobreescriba todos
         sin tocar el fichero. */
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }

  loaded = true;
  return comprobar(tips);
}

/**
 * ¿Están puestas las variables que hacen falta?
 *
 * Separado de `load()` porque el resultado depende del entorno, no de
 * si el fichero existe: cargarlo dos veces, o cargarlo con distintas
 * listas de tips, tiene que dar respuestas coherentes.
 */
function comprobar(tips = []) {
  const faltan = tips.filter((n) => !process.env[n] || !String(process.env[n]).trim());

  /* Sin fichero y sin nada en el entorno: no hay por dónde empezar.
     Este es el caso de desarrollo, y el mensaje dice cómo arreglarlo. */
  if (!fs.existsSync(ENV_PATH) && !Object.keys(process.env).some((k) => EXPECTADAS.includes(k))) {
    return {
      ok: false,
      faltan,
      error:
        "No se encuentra el archivo .env ni hay variables en el entorno.\n" +
        "  En desarrollo:  cp .env.example .env  (Windows: copy .env.example .env)\n" +
        "  En producción: las variables van en el entorno del contenedor.",
    };
  }

  return { ok: faltan.length === 0, faltan, error: faltan.length ? "Faltan: " + faltan.join(", ") : null };
}

/**
 * Variables que, si ninguna está puesta, delatan que la configuración
 * no ha llegado a ninguna parte.
 *
 * No es la lista de todas las que se necesitan (eso lo comprueba
 * `require` en cada punto), sino una muestra para distinguir "¿no hay
 * configuración de ninguna manera?" de "me falta una concreta".
 */
const EXPECTADAS = [
  "DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "SESSION_SECRET",
  "SITE_URL",
];

/**
 * Devuelve el valor, o lanza si falta.
 * `requiere` acepta varias y las comprueba todas antes de fallar,
 * para no tener que adivinar cuál falta.
 */
function require_(...names) {
  load();
  const faltan = names.filter((n) => !process.env[n] || !String(process.env[n]).trim());
  if (faltan.length) {
    throw new Error(
      "Faltan variables de entorno: " +
        faltan.join(", ") +
        "\n  En desarrollo van en .env (plantilla en .env.example)." +
        "\n  En producción las pone el contenedor, no un fichero."
    );
  }
  return names.map((n) => String(process.env[n]).trim());
}

module.exports = { load, comprobar, require: require_, ROOT, ENV_PATH };
