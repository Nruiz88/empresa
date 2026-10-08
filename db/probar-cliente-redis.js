/* ¿Funciona el cliente de Redis que usa el bot?
   ─────────────────────────────────────────────────────────────
   El bot usa `@upstash/redis`, no un fetch a mano. Son cosas distintas:

     · mi prueba anterior usó fetch directo al endpoint REST, y dio PONG;
     · el bot usa la librería, que construye las peticiones de otra
       forma.

   Y el resultado difiere: con Redis puesto, «turno» seguido de «1» da
   `no_match`. Antes, con el Map de memoria, daba `[turno hoy]`. O sea:
   activar Redis ROMPIÓ el flujo.

   Eso no se arregla suponiendo. Se ejecuta el mismo cliente con las
   mismas variables y se ve qué contesta.

   ── LA SOSPECHA ──

   El token que se puso en Coolify no es un token: es una CADENA DE
   CONEXIÓN. Base64 de un JSON con la url y el token adentro:

       gQAAAAAAA0PaAAIgcDFkZTU0OWEzMzlmMzg0YTQwYWUxMmZjYzNjNWQ0M2M2Mw
       -> {"url":"https://ample-ferret-213978.upstash.io",
           "token":"p1de549a339f384a40ae12fcc3c5d43c63"}

   Y el endpoint REST acepta las dos formas, que es por eso que mi
   comprobación dio verde y el bot sigue roto. La librería puede ser más
   estricta.

   ── EL ERROR DE FONDO ──

   Con Redis mal configurado, `markAgendaActive` falla al escribir y
   `isAgendaActive` falla al leer. Si esos errores se tragan y se
   devuelve `false`, el bot cree que nadie está en ningún menú: no hay
   lista vacía, hay silencio. Y nada dice que Redis esté roto. */
require("../lib/env").load();

const { Redis } = require("@upstash/redis");

const URL = process.env.UP_URL;
const TOKEN = process.env.UP_TOKEN;

/* Lo que se puso en Coolify: la cadena de conexión, tal cual. */
const CADENA =
  "gQAAAAAAA0PaAAIgcDFkZTU0OWEzMzlmMzg0YTQwYWUxMmZjYzNjNWQ0M2M2Mw";

/* Y el token de verdad, que está decodificado adentro de ella. */
function tokenDeCadena(cadena) {
  try {
    const crudo = Buffer.from(cadena, "base64").toString("utf8");
    const i = crudo.indexOf("{");
    if (i < 0) return null;
    return JSON.parse(crudo.slice(i)).token || null;
  } catch (e) {
    return null;
  }
}

async function probar(que, url, token) {
  console.log("  ── " + que + " ──");
  console.log("    url:   " + (url || "(ninguna)").slice(0, 46));
  console.log("    token: " + (token ? token.length + " caracteres" : "(ninguno)"));

  if (!url || !token) {
    console.log("    × falta alguno\n");
    return false;
  }

  const r = new Redis({ url, token });

  try {
    const pong = await r.ping();
    console.log("    ping:  " + pong);

    const k = "prueba:cliente:" + Date.now();
    await r.set(k, "hola", { ex: 60 });
    const v = await r.get(k);
    await r.del(k);
    console.log("    set/get: " + JSON.stringify(v));
    console.log("    ✓ este sirve\n");
    return true;
  } catch (e) {
    /* El error se imprime entero. Un «falló» sin decir por qué obliga a
       probar variantes a ciegas, y ya se probaron varias. */
    console.log("    × ERROR: " + (e && e.message ? e.message : String(e)));
    console.log("    " + (e && e.name ? "(" + e.name + ")" : ""));
    console.log("");
    return false;
  }
}

(async () => {
  console.log("\n═══ ¿Sirve el cliente que usa el bot? ═══\n");

  const tokenReal = tokenDeCadena(CADENA);

  console.log("  ──────────────────────────────────────────────");
  console.log("  Lo que hay en Coolify ahora mismo es la CADENA,");
  console.log("  que no es lo mismo que el token suelto.\n");
  console.log("  El token de verdad, decodificado de adentro:");
  console.log("    " + (tokenReal ? tokenReal.length + " caracteres: " + tokenReal.slice(0, 8) + "…" : "no se pudo decodificar"));
  console.log("");

  const conCadena = await probar("CON LA CADENA (lo que hay puesto)", URL, CADENA);
  const conToken = await probar("CON EL TOKEN SUELTO", URL, tokenReal);

  console.log("  ──────────────────────────────────────────────\n");

  if (conToken && !conCadena) {
    console.log("  ✓ La causa está encontrada.\n");
    console.log("    La librería necesita el token suelto, y lo que está en");
    console.log("    Coolify es la cadena de conexión. Con la cadena, todas las");
    console.log("    operaciones fallan y el bot, sin avisar, cree que no hay");
    console.log("    ningún menú activo.\n");
    console.log("    El arreglo es cambiar UPSTASH_REDIS_REST_TOKEN por el token");
    console.log("    suelto y redesplegar.\n");
  } else if (conCadena && conToken) {
    console.log("  Las dos formas funcionan, así que el token NO es la causa.\n");
    console.log("  Habría que mirar si el bot se está comiendo el error al");
    console.log("  escribir o al leer.\n");
  } else {
    console.log("  × Ninguna de las dos formas funciona.\n");
    console.log("    Si el token suelto tampoco, el problema no es el formato: es");
    console.log("    la base, la url, o que la cuenta esté mal.\n");
  }
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});