/* ¿La pantalla de planes deja meter algo peligroso?
   ─────────────────────────────────────────────────────────────
   POR QUÉ ESTA PRUEBA

   `cta_href` acaba directamente en un `href` de la web pública. Un
   `href` puede ser `javascript:...`, que ejecuta código en el
   navegador de quien visite la página, y eso lo escribiría alguien con
   acceso al panel —que no es cualquiera, pero es alguien.

   El caso normal de este repositorio es el contrario: una pantalla
   administrativa bien hecha, y una que acepta cualquier cosa. La que
   acepta cualquier cosa no falla nunca sola; falla el día que alguien
   pega una URL copiada de otro sitio, y ya no es un error de código:
   es un enlace que lleva a otro sitio con el mismo aspecto.

   ── LO QUE SE PRUEBA ──

   Que el servidor RECHAACE, no que la vista lo oculte. Ocultar es
  decoración, y en algunos navegadores ni eso: el valor sigue guardado y sigue saliendo. Lo que protege es que no llegue a guardarse. */

require("../lib/env").load();

const BASE = process.env.TEST_PANEL || "http://127.0.0.1:3000";
const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

let cookie = "";

async function pedir(ruta, opciones = {}) {
  const r = await fetch(BASE + ruta, {
    redirect: "manual",
    ...opciones,
    headers: Object.assign(
      cookie ? { cookie } : {},
      opciones.body ? { "content-type": "application/x-www-form-urlencoded" } : {},
      opciones.headers || {}
    ),
    signal: AbortSignal.timeout(30000),
  });

  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  return r;
}

async function csrfDe(ruta) {
  const html = await (await pedir(ruta)).text();
  const m = html.match(/name=["']_csrf["']\s+value=["']([^"']+)["']/i);
  if (!m) throw new Error("no se encontró el csrf en " + ruta);
  return m[1];
}

/* Valores que NO deben poder guardarse, y por qué cada uno.
   No es una lista de casos raros: son las cuatro formas en que un href
   se sale del sitio. */
const RECHAZADOS = [
  ["javascript:alert(1)", "ejecuta código"],
  ["JaVaScRiPt:alert(1)", "ejecuta código, con otro calibre"],
  ["  javascript:alert(1)  ", "ejecuta código, con espacios alrededor"],
  ["//sitio-que-no-es-el-nuestro.com", "manda a otro sitio"],
  ["http://sitio-que-no-es-el-nuestro.com", "manda a otro sitio"],
  ["mailto:alguien@ejemplo.com", "abre el gestor de correo"],
  ["/contacto<script>", "no es una ruta, es una etiqueta"],
];

/* Y uno que SÍ debe pasar, para que la prueba no se conforme con
   rechazar todo: una ruta interna normal. */
const ACEPTADOS = ["/contacto", "/cuenta/crear", "/precios"];

(async () => {
  console.log("\n═══ ¿Qué href acepta la pantalla de planes? ═══\n");

  const csrfLogin = await csrfDe("/panel/login");
  await pedir("/panel/login", {
    method: "POST",
    body: new URLSearchParams({ _csrf: csrfLogin, email: EMAIL, password: PASSWORD }).toString(),
  });

  const csrfPlanes = await csrfDe("/panel/planes");
  let fallos = 0;

  for (const [valor, motivo] of RECHAZADOS) {
    const html = await (
      await pedir("/panel/planes", {
        method: "POST",
        body: new URLSearchParams({
          _csrf: csrfPlanes,
          cta_href_inicial: valor,
        }).toString(),
      })
    ).text();

    /* Se mira lo que el servidor DIJO, no lo que respondió. La pantalla
       devuelve 200 también cuando rechaza: es el mismo código de
       respuesta para "guardado" y "no guardado". Un HTTP 200 aquí no
       dice nada. */
    const rechazado = /No se guardó nada/.test(html);
    const guardado = /Guardado:/.test(html);

    if (rechazado && !guardado) {
      console.log("  ✓ rechaza  " + JSON.stringify(valor) + "   (" + motivo + ")");
    } else {
      console.log("  x ACEPTA   " + JSON.stringify(valor) + "   (" + motivo + ")");
      fallos++;
    }
  }

  console.log("");

  for (const valor of ACEPTADOS) {
    const html = await (
      await pedir("/panel/planes", {
        method: "POST",
        body: new URLSearchParams({
          _csrf: csrfPlanes,
          cta_href_inicial: valor,
        }).toString(),
      })
    ).text();

    if (/Guardado:/.test(html)) {
      console.log("  ✓ acepta   " + JSON.stringify(valor));
    } else {
      console.log("  x RECHAZA  " + JSON.stringify(valor) + "   (y esta es válida)");
      fallos++;
    }
  }

  /* Se deja el botón como estaba. */
  await pedir("/panel/planes", {
    method: "POST",
    body: new URLSearchParams({ _csrf: csrfPlanes, cta_href_inicial: "/cuenta/crear" }).toString(),
  });

  console.log("");
  console.log(fallos
    ? "  x " + fallos + " de " + (RECHAZADOS.length + ACEPTADOS.length) + " casos se comporte mal\n"
    : "  ✓ los " + (RECHAZADOS.length + ACEPTADOS.length) + " casos se comportan bien\n");

  process.exit(fallos ? 1 : 0);
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});