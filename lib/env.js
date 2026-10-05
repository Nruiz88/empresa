/* =========================================================
   Nexo Studio — Lectura de .env sin dependencias
   ------------------------------------------------------------
   Node 24 admite `node --env-file=.env`, pero prefiero este
   archivo porque:
     - da mensajes de error claros si falta el .env
     - no falla si se ejecuta sin la flag
     - normaliza comillas y espacios

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
 * Devuelve { ok: boolean, faltan: string[] }
 */
function load() {
  if (loaded) return { ok: true, faltan: [] };

  if (!fs.existsSync(ENV_PATH)) {
    return {
      ok: false,
      faltan: [],
      error:
        "No se encuentra el archivo .env.\n" +
        "  Cópialo con:  cp .env.example .env  (Windows: copy .env.example .env)\n" +
        "  y rellena DATABASE_URL y SESSION_SECRET.",
    };
  }

  const parsed = parse(fs.readFileSync(ENV_PATH, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    // Una variable ya definida en el entorno real gana sobre el .env
    if (process.env[key] === undefined) process.env[key] = value;
  }
  loaded = true;
  return { ok: true, faltan: [] };
}

/**
 * Devuelve el valor, o lanza si falta.
 * `requiere` acepta varias y las comprueba todas antes de fallar,
 * para no tener que adivinar cuál falta.
 */
function require_(...names) {
  const faltan = names.filter((n) => !process.env[n] || !process.env[n].trim());
  if (faltan.length) {
    throw new Error(
      "Faltan variables de entorno: " +
        faltan.join(", ") +
        "\n  Edítalas en .env (plantilla en .env.example)."
    );
  }
  return names.map((n) => process.env[n].trim());
}

module.exports = { load, require: require_, ROOT, ENV_PATH };
