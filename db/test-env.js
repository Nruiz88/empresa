/* Pruebas de lib/env.js: lectura del .env, y sobre todo que la
   aplicación arranca SIN fichero .env, que es como funciona en un
   contenedor.

   El fallo que motivó esto: en el primer despliegue en Coolify la app
   reventó con "Falta el .env: No se encuentra el archivo .env", con
   todas las variables correctamente puestas en el entorno del
   contenedor. El mensaje señalaba al fichero, que era justo lo que no
   debía existir: en un contenedor las credenciales no se hornean en la
   imagen, van en el entorno.

   Estas pruebas corren en un proceso hijo con el directorio del
   proyecto apuntando a un sitio sin .env, para poder comprobar que
   funciona sin tocar el .env de desarrollo. */

const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");

const LIB = path.join(__dirname, "..", "lib", "env.js");

let fallos = 0;
const ok = (c, n, extra) => {
  console.log(`  ${c ? "✓" : "✗"} ${n}${extra ? "  → " + extra : ""}`);
  if (!c) fallos++;
};

/* Copia el módulo a un directorio temporal SIN .env y lo carga desde
   ahí. Se copia el fichero en vez de symlink para que el `ROOT` que
   calcula apunte al temporal (ROOT es dirname/..). */
function cargarSinFichero(vars) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nexo-env-"));
  const lib = path.join(tmp, "lib");
  fs.mkdirSync(lib);
  fs.copyFileSync(LIB, path.join(lib, "env.js"));

  const hecho = {};
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  delete require.cache[path.join(lib, "env.js")];
  const env = require(path.join(lib, "env.js"));

  return {
    ok: env.load(),
    require: env.require,
    limpiar() {
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}

console.log("\n── sin .env, pero con variables en el entorno ──");

/* Este es el caso de producción: contenedor, sin fichero. */
{
  const r = cargarSinFichero({
    DATABASE_URL: "postgresql://x:y@host/db",
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SECRET_KEY: "clave",
    SESSION_SECRET: "secreto",
    SITE_URL: "https://ejemplo.com",
  });

  ok(r.ok.ok, "load() dice que OK sin fichero .env");
  ok(!r.ok.error, "y sin mensaje de error", r.ok.error);
  ok(r.require("SUPABASE_URL")[0] === "https://x.supabase.co", "require() lee del entorno");
  r.limpiar();
}

console.log("\n── sin .env y sin nada en el entorno ──");

{
  /* Todas las claves que mira EXPECTADAS vacías. */
  const antes = {};
  const vaciar = ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_SECRET_KEY", "SESSION_SECRET", "SITE_URL"];
  for (const k of vaciar) { antes[k] = process.env[k]; delete process.env[k]; }

  const r = cargarSinFichero({});
  ok(!r.ok.ok, "ahora sí avisa de que no hay configuración");
  ok(
    r.ok.error && r.ok.error.includes("No se encuentra el archivo .env"),
    "y el mensaje explica qué hacer",
    r.ok.error ? r.ok.error.split("\n")[0] : "(sin mensaje)"
  );
  r.limpiar();
  for (const k of vaciar) if (antes[k] !== undefined) process.env[k] = antes[k];
}

console.log("\n── el entorno gana sobre el .env ──");

{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nexo-env2-"));
  fs.mkdirSync(path.join(tmp, "lib"));
  fs.copyFileSync(LIB, path.join(tmp, "lib", "env.js"));
  fs.writeFileSync(
    path.join(tmp, ".env"),
    ["SITE_URL=https://del-fichero.example", "DATABASE_URL=postgresql://fichero", "SUPABASE_URL=https://fichero", "SUPABASE_SECRET_KEY=k", "SESSION_SECRET=s"].join("\n")
  );

  process.env.SITE_URL = "https://del-entorno.example";
  delete require.cache[path.join(tmp, "lib", "env.js")];
  const env = require(path.join(tmp, "lib", "env.js"));

  ok(env.load().ok, "carga el .env");
  ok(
    env.require("SITE_URL")[0] === "https://del-entorno.example",
    "la variable real gana sobre la del fichero",
    env.require("SITE_URL")[0]
  );

  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("\n── require avisa de lo que falta ──");

{
  /* OJO: hay que limpiar TODAS las que se van a pedir. La prueba
     anterior dejó SUPABASE_SECRET_KEY puesta en el entorno real, así
     que sin esto `require()` no fallaría y la prueba pasaría sin
     comprobar nada. Es el fallo clásico de una prueba que depende de
     lo que hizo la anterior. */
  const guardadas = {};
  const limpiar = ["SUPABASE_URL", "SUPABASE_SECRET_KEY"];
  for (const k of limpiar) {
    guardadas[k] = process.env[k];
    delete process.env[k];
  }

  const r = cargarSinFichero({ SUPABASE_URL: "https://x.co" });

  let mensaje = "";
  try {
    r.require("SUPABASE_URL", "SUPABASE_SECRET_KEY");
  } catch (e) {
    mensaje = e.message;
  }
  ok(mensaje.includes("SUPABASE_SECRET_KEY"), "dice qué variable falta", mensaje.split("\n")[0]);
  ok(
    !mensaje.includes("Falta el .env"),
    "y no culpa al fichero .env, que puede no existir"
  );
  ok(
    mensaje.includes("contenedor"),
    "y dice dónde se ponen en producción",
    mensaje.split("\n").filter((l) => l.includes("contenedor"))[0] || "(no lo dice)"
  );

  r.limpiar();
  for (const k of limpiar) if (guardadas[k] !== undefined) process.env[k] = guardadas[k];
}

console.log("\n── el parseo sigue igual ──");

{
  /* Sin tocar nada de esto: es lo que se usaba en desarrollo. */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nexo-env3-"));
  fs.mkdirSync(path.join(tmp, "lib"));
  fs.copyFileSync(LIB, path.join(tmp, "lib", "env.js"));
  fs.writeFileSync(
    path.join(tmp, ".env"),
    [
      "# comentario",
      "",
      "PLANA=valor",
      'CON_COMILLAS="con espacio"',
      "CON_COMILLAS_SIMPLE='otro'",
      "CON_COMENTARIO=valor  # esto no cuenta",
      "SIN_ESPACIOS =  con espacios alrededor  ",
    ].join("\n")
  );

  for (const k of ["PLANA", "CON_COMILLAS", "CON_COMILLAS_SIMPLE", "CON_COMENTARIO", "SIN_ESPACIOS"]) {
    delete process.env[k];
  }
  delete require.cache[path.join(tmp, "lib", "env.js")];
  const env = require(path.join(tmp, "lib", "env.js"));
  env.load();

  ok(env.require("PLANA")[0] === "valor", "clave simple");
  ok(env.require("CON_COMILLAS")[0] === "con espacio", "quita comillas dobles");
  ok(env.require("CON_COMILLAS_SIMPLE")[0] === "otro", "quita comillas simples");
  ok(env.require("CON_COMENTARIO")[0] === "valor", "quita el comentario final");
  ok(env.require("SIN_ESPACIOS")[0] === "con espacios alrededor", "recorta espacios");

  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(fallos ? `\n  ${fallos} fallo(s)\n` : "\n  Todo correcto\n");
process.exit(fallos ? 1 : 0);
