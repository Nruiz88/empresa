/* =========================================================
   Nexo Studio — Reinicio del servidor local
   ------------------------------------------------------------
   Uso:  node db/restart.js

   POR QUÉ ESTE SCRIPT
   -------------------
   Reiniciar el servidor a mano (matar el proceso y arrancarlo de
   nuevo) se ha convertsido en un bucle: el arranque tarda unos
   segundos, la herramienta espera, se agota el tiempo y REINTENTA
   sola, y cada reintento mata el proceso que acababa de arrancar.

   Este script lo resuelve en un solo paso:
     1. Mata el servidor anterior (si lo hay).
     2. Espera a que el puerto quede libre de verdad.
     3. Arranca uno nuevo.
     4. Espera a que responda HTTP.
     5. Termina con éxito o con un código de error claro.

   Nunca reintenta solo, así que no puede quedarse colgado.

   USO REAL Y POR QUÉ ESTÁ ASÍ
   ----------------------------
   Arrancar el servidor desde PowerShell con Start-Process se quedaba
   COLGADO en herramientas que esperan a los hijos. Motivo: el proceso
   hijo hereda los streams de la sesión, y un servidor web nunca los
   cierra, así que la espera no termina nunca.

   ⚠️  LO QUE DE VERDAD NO CUELGA
   ------------------------------
   Este script sirve para PARAR y para CONSULTAR:

       node db/restart.js --status    ¿vive?
       node db/restart.js --stop      pararlo

   Ambos terminan solos. Para ARRANCAR, usa el reinicio por HTTP en
   lugar de este script:

       curl http://127.0.0.1:3000/__reiniciar

   (definido en server.js: responde y se relanza). Esa es la única vía
   que no deja un proceso vivo colgando de la sesión, y por eso el
   `arrancar()` de más abajo existe pero casi nunca se usa: si el
   servidor ya está vivo, reinicia por HTTP y listo.

   Uso también:
     node db/restart.js --status  solo para ver si vive
     node db/restart.js --stop    solo para parar

   ⚠️  SI SE CUELGA AL ARRANCAR
   ----------------------------
   Si `node db/restart.js` (sin flags) se queda colgado, no es este
   script: es que el proceso hijo sigue vivo en la consola de la
   sesión y la herramienta espera a que se cierre.

   La salida es pedir el reinicio por HTTP, que no deja nada colgando:

       curl http://127.0.0.1:3000/__reiniciar

   El servidor responde, se relanza él mismo y el comando termina.
   Requiere que el servidor esté vivo; si está parado, `npm start` a
   mano en una terminal propia y ya.
   ========================================================= */

const { spawn, execSync } = require("child_process");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..");
const PUERTO = process.env.PORT || 3000;
const LOG = path.join(require("os").tmpdir(), "opencode", "srv.log");
const ERR = path.join(require("os").tmpdir(), "opencode", "srv.err");

const solo = process.argv[2];

/** ¿Responde el puerto?

    OJO con el AbortController: si se aborta el fetch (timeout), su
    timer queda pendiente. Con `process.exit()` inmediatamente después,
    en Windows eso revienta con

      Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)

    que no es un fallo del script sino de libuv al matar un handles
    que se está cerrando. Se ve en `--status`, que hacía fetch y
    salía acto seguido.

    Por eso el temporizador se guarda y se limpia en el `finally`, y
    el proceso NO se mata de golpe: se deja que el bucle de eventos
    vacíe solo. */
async function vive() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(`http://127.0.0.1:${PUERTO}/panel/login`, {
      signal: ctrl.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** Terminar este script.

    process.exitCode + return en vez de process.exit(): el proceso
    acaba cuando el bucle de eventos se vacía, sin matar handles a
    medias. Con exit() directo, en Windows, salía un

      Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)

    cada vez que quedaba un fetch o un timer sin cerrar.

    Y NO es setImmediate: eso es asíncrono, el código que viene
    después se seguiría ejecutando. Por eso es un return. */
function salir(codigo = 0) {
  process.exitCode = codigo;
  throw new Saliendo();
}

/** Se lanza para deshacer la pila de llamadas hasta el final. */
class Saliendo extends Error {}

function parar() {
  try {
    // /FI evita matar node de otras cosas (editores, etc).
    execSync('taskkill /F /IM node.exe /FI "WINDOWTITLE eq NexoServer*"', {
      stdio: "ignore",
    });
  } catch {
    /* Si no lo encuentra, no hay nada que parar. */
  }
  try {
    execSync(`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${PUERTO} ^| findstr LISTENING') do taskkill /F /PID %a`, {
      stdio: "ignore",
    });
  } catch {
    /* Puerto libre. */
  }
}

async function esperarLibre(segundos = 10) {
  const limite = Date.now() + segundos * 1000;
  while (Date.now() < limite) {
    if (!(await vive())) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function arrancar() {
  const hijo = spawn(process.execPath, ["server.js"], {
    cwd: RAIZ,
    detached: true,
    stdio: ["ignore", require("fs").openSync(LOG, "a"), require("fs").openSync(ERR, "a")],
  });
  hijo.unref();

  /* Espera a que responda, con tope. Si no responde, no reintenta:
     informa del error y deja que se mire el log. */
  const limite = Date.now() + 20000;
  while (Date.now() < limite) {
    if (await vive()) {
      console.log(`  Servidor arriba en http://127.0.0.1:${PUERTO}  (pid ${hijo.pid})`);
      return true;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

(async () => {
  if (solo === "--status") {
    console.log((await vive()) ? "  vivo" : "  parado");
    salir(0);
  }

  if (solo === "--stop") {
    parar();
    await esperarLibre();
    console.log("  Servidor parado.");
    salir(0);
  }

  console.log("  Parando el servidor anterior...");
  parar();
  const libre = await esperarLibre();
  if (!libre) {
    console.error("  El puerto sigue ocupado. Mira qué lo tiene:\n");
    console.error("  netstat -ano | findstr :" + PUERTO);
    salir(1);
  }

  console.log("  Arrancando...");
  if (!(await arrancar())) {
    console.error(`\n  No respondió en 20 s. Log de errores:\n`);
    try {
      console.error(require("fs").readFileSync(ERR, "utf8").split("\n").slice(-15).join("\n"));
    } catch {
      console.error("  (no hay log)");
    }
    salir(1);
  }

  salir(0);
})().catch((e) => {
  /* salir() lanza esto a propósito para salir desde cualquier
     profundidad. No es un error real. */
  if (!(e instanceof Saliendo)) {
    console.error("  " + e.message);
    process.exitCode = 1;
  }
});
