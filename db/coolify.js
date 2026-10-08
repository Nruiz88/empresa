/* =========================================================
   Nexo Studio — Coolify (API)
   ------------------------------------------------------------
   Hablar con la API de Coolify para ver y tocar lo que hay
   desplegado: qué proyectos y servicios existen, qué dominios tienen
   puesto cada uno y qué variables de entorno lleva.

   Lee la URL y el token de `.env.coolify`, que está en el
   .gitignore. Si no están, avisa y sale sin hacer nada.

   ── POR QUÉ UN SCRIPT Y NO UNAS CLAVES EN EL CÓDIGO ──

   Un token de API da acceso a todo el proyecto: leer variables de
   entorno (que tienen claves de Supabase), redesplegar y borrar. Si
   está en una constante del código, sube a git con el siguiente
   `git add`, y desde ahí vive en el historial para siempre. Borrarlo
   después del fichero no lo saca del historial.

   ── POR QUÉ ESTE FICHERO NO IMPRIME SECRETOS ──

   Las variables de entorno de Coolify traen claves de Supabase. Este
   script las muestra solo con el VALOR tapado, y solo cuando se pide
   explícitamente con `--ver-valores`. Un `--listar` normal no puede
   dejar una clave en un log que luego se copia a un chat.

   Uso:
     node db/coolify.js                          qué hay
     node db/coolify.js proyecto <uuid>          un proyecto con sus apps
     node db/coolify.js app <uuid>               una app, sus dominios y vars
     node db/coolify.js Dominios <uuid> <dominio>
                                                  pone un dominio (escribe)
     node db/coolify.js var <uuid> <NOMBRE>=<valor>
                                                  pone una variable (escribe)
     node db/coolify.js redesplegar <uuid>       relanza (escribe)

   `--ver-valores` con `app` imprime los valores de las variables.
   ========================================================= */

const fs = require("fs");
const path = require("path");

const FICHERO = path.join(__dirname, "..", ".env.coolify");

function leerEnv(ruta) {
  const o = {};
  if (!fs.existsSync(ruta)) return o;
  for (const l of fs.readFileSync(ruta, "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) o[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return o;
}

/** Tapar un valor para poder escribirlo en un log sin filtrarlo.
 *
    Se ven los 4 primeros caracteres y la longitud. Con eso se
    distingue "apuntaba a la clave vieja" de "ya está cambiada", que
    es lo que hace falta para comprobar un despliegue, sin que el log
    sirva para conectar a nada. */
function tapar(v) {
  const s = String(v == null ? "" : v);
  if (!s) return "(vacía)";
  if (s.length <= 8) return "(" + s.length + " caracteres)";
  return s.slice(0, 4) + "…" + "(" + s.length + " caracteres)";
}

const env = leerEnv(FICHERO);
const URL_API = (env.COOLIFY_URL || "").replace(/\/+$/, "");
const TOKEN = env.COOLIFY_TOKEN || "";

if (!URL_API || !TOKEN) {
  console.log("\n  ✗ Falta el token de Coolify.\n");
  console.log("    Rellena COOLIFY_TOKEN en " + FICHERO + ".\n");
  console.log("    El token se crea en Coolify → Settings → Keys & Tokens, y");
  console.log("    tiene que tener permiso WRITE (los read no llegan para poner");
  console.log("    dominios ni variables).\n");
  console.log("    Ojo: si hay token pero la API contesta \"Unauthenticated\", lo");
  console.log("    que caducó es el token, no el script. Pasa en el anterior,");
  console.log("    que expiraba solo.\n");
  console.log("    El fichero está en el .gitignore, así que no se sube.\n");
  process.exitCode = 1;
  /* `process.exit(1)` y no un `return`.

     Un `return` aqui es de NIVEL SUPERIOR y Node lo tolera porque
     envuelve cada modulo CommonJS en una funcion. El linter del
     proyecto (`db/check.js`) compila con `vm.Script`, que no hace
     ese envoltorio, y lo rechaza con "Illegal return statement":
     el archivo pasaba al ejecutarlo y fallaba al pasar las pruebas,
     que es la peor forma de que se rompa algo.

     Por eso `process.exit(1)`, que corta igual de arriba y deja el
     mismo codigo de salida. */
  process.exit(1);
}

async function api(ruta, opciones = {}) {
  const res = await fetch(URL_API + "/api/v1" + ruta, {
    method: opciones.method || "GET",
    headers: {
      Authorization: "Bearer " + TOKEN,
      "Content-Type": "application/json",
      ...(opciones.headers || {}),
    },
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  });

  const crudo = await res.text();
  let datos = null;
  if (crudo) {
    try {
      datos = JSON.parse(crudo);
    } catch {
      datos = crudo;
    }
  }

  if (!res.ok) {
    const mensaje =
      datos && typeof datos === "object" && datos.message ? datos.message : "HTTP " + res.status;
    throw new Error(mensaje + "  (en " + (opciones.method || "GET") + ruta + ")");
  }
  return datos;
}

const args = process.argv.slice(2);
const verValores = args.includes("--ver-valores");

/* Lo que se ve de una app, sin los valores de las variables. */
function pintarApp(app) {
  console.log("");
  console.log("  " + app.name + "  (" + app.uuid + ")");
  console.log("    tipo: " + (app.type || "?") + "   estado: " + (app.status || "?"));

  const fqdn = String(app.fqdn || "");
  console.log("    fqdn: " + (fqdn || "(ninguno)"));

  const dominios = Array.isArray(app.custom_domains)
    ? app.custom_domains.map((d) => (typeof d === "string" ? d : d.host))
    : app.custom_domains || [];
  console.log("    dominios: " + (dominios.length ? dominios.join(", ") : "(ninguno)"));

  const vars = Array.isArray(app.envs) ? app.envs : [];
  console.log("    variables (" + vars.length + "):");
  for (const v of vars) {
    const nombre = v.name || v.key || "?";
    if (v.is_build_time) console.log("      " + nombre + "  (de build)");
    else if (v.is_preview) console.log("      " + nombre + "  (de preview)");
    else console.log("      " + nombre + " = " + (verValores ? v.value : tapar(v.value)));
  }
}

/* Todo lo de abajo va dentro de una función async y no en el cuerpo del
   fichero: `await` arriba del todo solo es válido en módulos ES, y este
   repo es CommonJS. */
(async function () {
try {
  const equipo = await api("/teams/current");

  /* El id del equipo viene como 0 en esta versión, que es un número de
     verdad y no un valor por defecto. Se aceptan los dos campos porque
     en otras versiones el identificador va en `uuid`.

     Va ANTES del primer console.log porque el mensaje lleva el id, y
     usarlo antes de declararlo es un ReferenceError que dice
     "Cannot access 'equipoId' before initialization" — que parece un
     fallo de permisos y es un `const` usado en la línea equivocada. */
  const equipoId = equipo.id != null ? equipo.id : equipo.uuid;

  console.log("\n═══ Coolify ═══\n");
  console.log("  " + (equipo.name || "equipo") + "  (id " + equipoId + ")\n");

  if (!args.length || args[0] === "equipo") {
    /* Se usa `GET /applications`, que devuelve todas de golpe, y no
       recorrer proyecto por proyecto.

       El camino por proyecto (`/projects/{uuid}/applications`) falla con
       "Environment not found" en esta versión: pide un ambiente que la
       ruta no lleva. Es un error de la ruta de la API que da la sensación
       de problema de permisos, y no lo es: el token va bien. */
    const [proyectos, aplicaciones] = await Promise.all([
      api("/projects?team_id=" + equipoId),
      api("/applications?team_id=" + equipoId),
    ]);

    const nombreDeProyecto = new Map((proyectos || []).map((p) => [p.uuid, p.name]));
    const porProyecto = new Map();

    for (const a of aplicaciones || []) {
      const p = nombreDeProyecto.get(a.project_uuid) || "(sin proyecto)";
      if (!porProyecto.has(p)) porProyecto.set(p, []);
      porProyecto.get(p).push(a);
    }

    /* Los proyectos sin ninguna aplicación se saltan: son plantillas o
       proyectos a medio montar, y listarlos con "(0 aplicaciones)" solo
       mete ruido en lo que se busca, que son las aplicaciones. */
    for (const [proyecto, apps] of porProyecto) {
      if (!apps.length) continue;

      console.log("  " + proyecto);
      for (const a of apps) {
        const dominios = String(a.fqdn || "")
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean);
        const salud = a.status === "running:healthy" ? "✓" : a.status || "?";

        console.log("    " + (salud + "  ").padEnd(21) + (a.name || "(sin nombre)").padEnd(20) + a.uuid);
        console.log("       " + (dominios.length ? dominios.join("\n       ") : "(sin dominio)"));
      }
      console.log("");
    }
  } else if (args[0] === "app") {
    if (!args[1]) throw new Error("falta el uuid de la app");
    pintarApp(await api("/applications/" + args[1]));
  } else if (args[0] === "proyecto") {
    if (!args[1]) throw new Error("falta el uuid del proyecto");
    const apps = await api("/applications?team_id=" + equipoId);
    for (const a of apps || []) if (a.project_uuid === args[1]) pintarApp(a);
  } else if (args[0] === "dominio") {
    const [, uuid, dominio] = args;
    if (!uuid || !dominio) throw new Error("uso: dominio <uuid-de-la-app> <dominio>");
    const app = await api("/applications/" + uuid);

    /* El campo se llama `domains` en la API, no `fqdn`. `fqdn` es la
       columna de la base donde se guarda, y mandarla en el PATCH no
       cambia nada: la petición se acepta con 200 y el dominio no se
       toca. Es un fallo silencioso, y de los que se descubren cuando
       el certificado nunca llega. */
    const actuales = String(app.fqdn || "")
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);

    const nuevo = dominio.startsWith("http") ? dominio : "https://" + dominio;

    if (actuales.includes(nuevo)) {
      console.log("\n  Ya tenía " + nuevo + ". No se toca nada.\n");
    } else {
      /* Se conservan TODOS los dominios que ya hay y se añade el nuevo.

       Antes el código se quedaba solo con los `.duckdns.org` y tiraba
       el resto, con la idea de "dejar el antiguo y cambiar el nuevo".
       El resultado fue que al añadir `panel.` se borraron
       `tucormercio.com.ar` y `www.tucormercio.com.ar`, que ya estaban
       bien: añadir un dominio nunca debe quitar otros.

       Para quitar hay un comando aparte, `dominios`, que se llama
       explícitamente con lo que se quiere fuera. Si al añadir una cosa
       desapareciera otra, el estado final sería distinto del pedido sin
       que nadie lo pidiera. */
      const nuevos = actuales.includes(nuevo) ? actuales : actuales.concat([nuevo]);

      /* `domains` va como TEXTO separado por comas, no como lista.

         Con una lista la API contesta 422 "The domains field must be a
         string" y no cambia nada. Es un fallo silencioso en el sentido
         de que el mensaje no menciona `domains` en ningún sitio donde
         uno mire primero: dice "Validation failed" a secas.

         Y atención al orden de lectura: `actuales` viene del `fqdn`,
         que SÍ es la lista en la base pero un texto en la API. */
      const r = await api("/applications/" + uuid, {
        method: "PATCH",
        body: { domains: nuevos.join(",") },
      });
      console.log("\n  " + (app.name || uuid) + ":");
      console.log("    añadidos: " + nuevo);
      console.log("    ahora:    " + String((r && r.fqdn) || nuevos.join(",")).replace(/,/g, "\n               ") + "\n");
      console.log("  ⚠  Coolify regenera el contenedor. El dominio sirve cuando arranque.\n");
    }
  } else if (args[0] === "dominios") {
    const [, uuid, quitar] = args;
    if (!uuid || !quitar) throw new Error("uso: dominios <uuid-de-la-app> <dominio-a-quitar>");

    const app = await api("/applications/" + uuid);
    const actuales = String(app.fqdn || "")
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);

    if (!actuales.includes(quitar)) {
      console.log("\n  No tenía " + quitar + ". No se toca nada.\n");
    } else {
      const nuevos = actuales.filter((d) => d !== quitar);
      const r = await api("/applications/" + uuid, {
        method: "PATCH",
        body: { domains: nuevos.join(",") },
      });
      console.log("\n  " + (app.name || uuid) + ":");
      console.log("    quitado: " + quitar);
      console.log("    ahora:   " + String((r && r.fqdn) || nuevos.join(",")).replace(/,/g, "\n              ") + "\n");
    }
  /* ---------- Variables ----------
     En ESTA versión de Coolify (4.4.2) la API NO deja escribir las
     variables de una aplicación: `envs` no está en la lista de campos
     permitidos del PATCH y la API contesta 422 "This field is not
     allowed".

     Lo que sí hay son los endpoints `/team/envs`, `/projects/{uuid}/envs`
     y compañía, pero son para variables COMPARTIDAS, no para las de una
     aplicación. Cambiar `SITE_URL` de una app concreta hay que hacerlo
     en el panel de Coolify.

     Se deja el comando `envs` como LECTURA, que sí funciona y es
     justamente lo que hace falta para comprobar que lo que se puso en el
     panel quedó bien. */
  } else if (args[0] === "envs") {
    if (!args[1]) throw new Error("falta el uuid");
    const lista = await api("/applications/" + args[1] + "/envs");
    const app = await api("/applications/" + args[1]);

    /* Solo se enseñan enteros los valores que son direcciones o puertos.
       El resto va tapado: son claves de Supabase y secretos de firma, y
       esta pantalla se copia a menudo y se acaba en un chat en un chat. */
    const ENSEÑAR = /^(SITE_URL|PANEL_URL|BOT_URL|APP_URL|NEXT_PUBLIC_PANEL_URL|PORT|NODE_ENV)$/;

    console.log("\n  " + (app.name || args[1]) + "  (" + lista.length + " variables)\n");
    for (const v of lista) {
      const nombre = v.name || v.key || "?";
      const valor = v.value == null ? "" : String(v.value);
      console.log(
        "    " + nombre.padEnd(23) +
          (ENSEÑAR.test(nombre) ? "= " + valor : "= (" + valor.length + " caracteres)")
      );
    }

    const repetidas = {};
    for (const v of lista) {
      const n = v.name || v.key;
      repetidas[n] = (repetidas[n] || 0) + 1;
    }
    const dupes = Object.keys(repetidas).filter((n) => repetidas[n] > 1);
    if (dupes.length) {
      console.log(
        "\n  ⚠  " + dupes.length + " variable(s) están repetidas: " + dupes.join(", ") +
          "\n     Coolify usa la última. No es un error, pero saber cuál"
      );
    }
    console.log("");
  } else if (args[0] === "redesplegar") {
    if (!args[1]) throw new Error("falta el uuid");
    const app = await api("/applications/" + args[1]);
    /* POST, no GET.

       Con GET la API responde 4xx con un mensaje que parece un fallo
       cualquiera ("This endpoint has changed to a POST request"), y lo
       peligroso es que el script lo cuenta como redespliegado: la
       aplicación se queda con el código viejo y todo parece bien. */
    const r = await api("/applications/" + args[1] + "/restart", { method: "POST" });
    const ok = r && !/changed to a POST|cannot GET|Method Not Allowed/i.test(String(r.message || r));
    if (!ok) {
      console.log("\n  x la API no acepto el redespliegue: " + JSON.stringify(r).slice(0, 160) + "\n");
      process.exit(1);
    }
    console.log("\n  ✓ " + (app.name || args[1]) + ": " + (r && r.message ? r.message : "redesplegado") + "\n");
  } else {
    console.log(
      "\n  Comandos:\n" +
        "    (sin nada)                       listar aplicaciones y sus dominios\n" +
        "    app <uuid>                       una app con sus dominios\n" +
        "    dominio <uuid> <dominio>         añadir un dominio\n" +
        "    dominios <uuid> <dominio>        quitar un dominio\n" +
        "    envs <uuid>                      ver las variables (los secretos, tapados)\n" +
        "    redesplegar <uuid> [force]       relanzar\n\n" +
        "  ⚠  Las VARIABLES no se pueden cambiar por la API en esta versión\n" +
        "     de Coolify: hay que hacerlo en el panel. Después se comprueba\n" +
        "     con `envs <uuid>`.\n\n"
    );
  }
} catch (err) {
  console.error("\n  ✗ " + (err && err.message ? err.message : err) + "\n");
  process.exitCode = 1;
}
})();