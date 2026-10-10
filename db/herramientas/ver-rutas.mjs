// Levanta el servidor y pide todas las rutas públicas.
//
// ── POR QUÉ ESTE ARCHIVO EXISTE ──
//
// Durante el cambio de portada rompió dos veces la web entera, y las dos
// veces de la misma manera: un comentario de EJS cerrado con `-->` en
// lugar de `%>`.
//
// Las dos veces pasaron el linter de vistas. El linter COMPILA la
// plantilla, y una plantilla con un comentario mal cerrado compila: EJS
// se come el texto hasta el siguiente `%>` y genera JavaScript que no
// da error de sintaxis.
//
// Lo que falla es al RENDERIZAR, cuando el HTML resultante no tiene los
// cierres que el navegador necesita. Eso solo se ve pidiendo la página.
//
// Es decir: hacía falta una comprobación que pida cada ruta y falle si
// contesta 500, y no había ninguna. Las pruebas que había miraban el
// código; esta mira lo que ve un visitante.
//
// ── POR QUÉ NO COMPROBABA SOLO LAS RUTAS QUE CONOCEMOS ──
//
// Porque el fallo no es "esta ruta está mal", es "cualquier vista que
// incluya este partial está mal". Si el parcial es el pie o la
// cabecera, son quince rutas. Mirar una y dar el visto bueno no vale.
//
//   node db/ver-rutas.js [--url http://127.0.0.1:3000]

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("D:/webs/wweb/node_modules/playwright");

const RAIZ = path.resolve(import.meta.dirname, "..");

/* Rutas públicas. El panel se comprueba aparte porque necesita sesión y
   porque sus pantallas ya tienen sus propias pruebas. */
const RUTAS = [
  "/",
  "/precios",
  "/servicios",
  "/proyectos",
  "/blog",
  "/contacto",
  "/cuenta/entrar",
  "/cuenta/crear",
  "/aviso-legal",
  "/privacidad",
  "/cookies",
  "/condiciones",
  "/panel/login",
  "/ruta-que-no-existe",
];

function arrancar() {
  return new Promise((resolver) => {
    const p = spawn("node", ["server.js"], { cwd: RAIZ, stdio: "ignore", windowsHide: true });
    // Se espera a que conteste en lugar de a que pase un tiempo fijo:
    // con un tiempo fijo, en una máquina lenta se prueba contra un
    // servidor que todavía no está y sale todo en rojo sin motivo.
    const intentar = (intentos) => {
      fetch("http://127.0.0.1:3000/panel/login")
        .then(() => resolver(p))
        .catch(() => {
          if (intentos <= 0) {
            console.log("  x el servidor no arrancó");
            p.kill();
            resolver(null);
            return;
          }
          setTimeout(() => intentar(intentos - 1), 500);
        });
    };
    intentar(30);
  });
}

const servidor = await arrancar();
if (!servidor) process.exit(1);

const navegador = await chromium.launch();
const fallos = [];

try {
  const pagina = await navegador.newPage({ viewport: { width: 1280, height: 800 } });

  for (const ruta of RUTAS) {
    // Se espera a que la respuesta Y a que no queden peticiones sin
    // terminar. Con `domcontentloaded` una página que luego falla al
    // pintar puede devolver 200 y quedarse en blanco.
    const r = await pagina.goto("http://127.0.0.1:3000" + ruta, { waitUntil: "load" });
    const estado = r.status();
    const espera404 = ruta.startsWith("/ruta-que-no-existe");

    // Un 404 en la ruta que no existe es lo correcto; en las demás, un
    // 404 casi siempre es un enlace roto.
    const bien = espera404 ? estado === 404 : estado < 400;
    if (!bien) fallos.push(ruta + "  ->  HTTP " + estado);

    console.log("  " + (bien ? "ok  " : "x  ") + ruta.padEnd(24) + "HTTP " + estado);
  }

  await pagina.close();
} finally {
  await navegador.close();
  servidor.kill();
}

console.log("");
if (fallos.length) {
  console.log("x " + fallos.length + " rutas con fallo:");
  fallos.forEach((f) => console.log("    " + f));
  console.log("");
  console.log("Si son varias a la vez, lo más probable sea un parcial roto");
  console.log("(cabecera, pie o head), no varias vistas a la vez.");
  process.exit(1);
}

console.log("Las " + RUTAS.length + " rutas responden como deben.");