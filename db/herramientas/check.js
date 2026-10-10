/* =========================================================
   Nexo Studio — Comprobación de sintaxis de TODO el proyecto
   ------------------------------------------------------------
   Uso:  node db/check.js

   Por qué existe: durante el desarrollo, un error de sintaxis en una
   vista aparecía como un 500 en el navegador y había que adivinar
   el archivo. Con esto se ven todos los fallos de golpe, ANTES de
   arrancar el servidor.

   Comprueba tres cosas:
     1. Que cada .js parsea.
     2. Que cada .ejs compila (sin ejecutarlo).
     3. Que los requires pointed de verdad a archivos existentes.

   No toca la base de datos ni hace red: se puede ejecutar en
   cualquier momento.
   ========================================================= */

const fs = require("fs");
const path = require("path");
const ejs = require("ejs");
const vm = require("vm");

/* Ruta absoluta: __dirname puede ser relativo y resolver contra él
   produce rutas como '.\views\partials\head', que no existen. */
const RAIZ = path.resolve(__dirname, "..", "..", );

const IGNORAR = new Set(["node_modules", ".git", "data", ".cache", "tmp"]);
const problemas = [];

/** Todos los .js del proyecto, menos los ignorados */
function buscar(dir, ext, acc = []) {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR.has(entrada.name)) continue;
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) buscar(completo, ext, acc);
    else if (entrada.name.endsWith(ext)) acc.push(completo);
  }
  return acc;
}

const relativo = (p) => path.relative(RAIZ, p).replace(/\\/g, "/");

/* ---------- 1. Sintaxis de los .js ---------- */
const js = buscar(RAIZ, ".js");
for (const archivo of js) {
  const fuente = fs.readFileSync(archivo, "utf8");
  try {
    new vm.Script(fuente, { filename: archivo });
  } catch (err) {
    problemas.push({ tipo: "js", archivo: relativo(archivo), msg: err.message });
  }
}

/* ---------- 2. Compilación de los .ejs ---------- */
const vistas = buscar(path.join(RAIZ, "views"), ".ejs");
for (const vista of vistas) {
  const fuente = fs.readFileSync(vista, "utf8");
  try {
    ejs.compile(fuente, { filename: vista });
  } catch (err) {
    problemas.push({ tipo: "ejs", archivo: relativo(vista), msg: err.message });
  }
}

/* ---------- 3. Balance de llaves en los <% %> ----------
   EJS da un error confuso cuando falta un cierre: se queja del
   ÚLTIMO tag que vio, que suele ser un <%# innocent, y no de la
   línea donde falta la llave. Eso costó un rato de buscar el error
   en el sitio equivocado.

   Aquí se cuentan las llaves sobre el fichero entero (no línea a
   línea, que se salta los tags multilínea) y se dice cuál es el
   último tag que dejó la pila sin cerrar. El comentario <%# y el
   literal <%= se saltan: ahí las llaves no cuentan. */
function saldoDeLlaves(fuente) {
  let i = 0;
  let saldo = 0;
  let ultimoAbierto = null;
  const lineaDe = (pos) => fuente.slice(0, pos).split("\n").length;

  while (i < fuente.length) {
    const abre = fuente.indexOf("<%", i);
    if (abre === -1) break;

    /* <%#  comentario   <%=  literal   <%-  etiqueta   <%_  raw
       En los cuatro no cuentan las llaves. */
    const clase = fuente[abre + 2];
    if (clase === "#" || clase === "=" || clase === "-" || clase === "_") {
      i = fuente.indexOf("%>", abre) + 2;
      continue;
    }

    const cierra = fuente.indexOf("%>", abre);
    if (cierra === -1) break;

    const cuerpo = fuente.slice(abre + 2, cierra);
    const delta =
      (cuerpo.match(/\{/g) || []).length - (cuerpo.match(/\}/g) || []).length;

    saldo += delta;
    if (delta > 0) {
      ultimoAbierto = { linea: lineaDe(abre), texto: cuerpo.trim().slice(0, 50) };
    }

    i = cierra + 2;
  }

  return { saldo, ultimoAbierto };
}

for (const vista of vistas) {
  const fuente = fs.readFileSync(vista, "utf8");
  const { saldo, ultimoAbierto } = saldoDeLlaves(fuente);
  if (saldo !== 0) {
    const donde = ultimoAbierto
      ? ` último bloque abierto en la línea ${ultimoAbierto.linea}: ${ultimoAbierto.texto}`
      : "";
    problemas.push({
      tipo: "llaves",
      archivo: relativo(vista),
      msg:
        `las llaves de los <% %> no cuadran (saldo ${saldo}, ` +
        `faltan ${Math.abs(saldo)} de cierre).${donde}`,
    });
  }
}

/* ---------- 4. Includes que apuntan a archivos inexistentes ----------
     OJO: EJS resuelve los includes RELATIVOS A views/, no al archivo
     que incluye. Por eso en views/index.ejs se escribe
     'partials/head' y en views/panel/index.ejs '../../partials/panel-head',
     y ambos son correctos. Comprobarlo contra el directorio del
     archivo daría falsos positivos en casi todas las vistas. */
const CON_INCLUDE = /<%[-=]\s*include\(\s*['"]([^'"]+)['"]/g;
for (const vista of vistas) {
  const fuente = fs.readFileSync(vista, "utf8");
  const dirVista = path.dirname(vista);
  let m;
  CON_INCLUDE.lastIndex = 0;
  while ((m = CON_INCLUDE.exec(fuente))) {
    /* Igual que EJS: primero relativo a la vista, luego a views/.
       Y OJO: los includes van SIN extensión, EJS la añade. Hay que
       probarla también o nada aparece. */
    const conExt = (p) => fs.existsSync(p) || fs.existsSync(p + ".ejs");
    const candidatos = [
      path.resolve(dirVista, m[1]),
      path.resolve(RAIZ, "views", m[1]),
    ];
    if (!candidatos.some(conExt)) {
      problemas.push({
        tipo: "include",
        archivo: relativo(vista),
        msg: `no encuentra '${m[1]}'`,
      });
    }
  }
}

/* ---------- 5. Resultado ---------- */
console.log(`\n  ${js.length} ficheros .js y ${vistas.length} vistas comprobados`);

if (!problemas.length) {
  console.log("  Sin errores de sintaxis.\n");
  process.exit(0);
}

console.log("");
for (const p of problemas) {
  console.log(`  ✗ [${p.tipo}] ${p.archivo}`);
  console.log(`      ${p.msg.split("\n")[0]}`);
}
console.log(`\n  ${problemas.length} problema(s)\n`);
process.exit(1);
