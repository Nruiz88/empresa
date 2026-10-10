/* Prueba de que la vuelta desde el bot apunta al PANEL y no al propio
   bot.

   El fallo que comprueba: al entrar desde el portal, el ticket se
   verificaba bien, la cookie se montaba, y acto seguido el navegador
   caia en el 404 del bot ("esta pagina no existe") porque la vuelta
   era "/panel/mis-servicios", una ruta RELATIVA que en otro host no
   significa nada.

   Esto no prueba el canje entero (eso lo hace test-acceso-servicio.js
   con el servidor de verdad), sino que en las tres rutas por las que
   el bot manda al usuario al panel, la URL es ABSOLUTA.
 */
const http = require("http");

const BOT = process.env.BOT_URL_TEST || "http://127.0.0.1:3200";

let fallos = 0;
const ok = (c, n, extra) => {
  console.log(`  ${c ? "✓" : "✗"} ${n}${extra ? "  → " + extra : ""}`);
  if (!c) fallos++;
};

const pedir = (ruta) =>
  new Promise((res) => {
    http
      .get(BOT + ruta, (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => res({ status: r.statusCode, headers: r.headers, cuerpo: d }));
      })
      .on("error", () => res({ status: 0, headers: {}, cuerpo: "" }));
  });

(async () => {
  console.log("\n── la pagina de entrada ──");

  const { status, cuerpo } = await pedir("/entrar");
  ok(status === 200, "GET /entrar responde", String(status));

  /* El panel tiene que venir embebido como URL completa. */
  const embebido = cuerpo.match(/var panel = ("[^"]*")/);
  ok(!!embebido, "la pagina lleva el panel embebido");
  if (embebido) {
    const panel = JSON.parse(embebido[1]);
    ok(/^https?:\/\//.test(panel), "y es una URL completa, no una ruta", panel);
    ok(!panel.includes("midominio"), "sin el marcador de dominio inventado", panel);
  }

  /* Y el enlace de "volver a entrar" tiene que usar esa variable, que
     ya se comprobó arriba que es una URL completa. Se busca el
     código literal (`' + panel + '`) y no una URL: la plantilla
     concatena en tiempo de ejecución, así que en el HTML enviado solo
     hay texto. Buscar una URL aquí no encontraría nada. */
  ok(
    cuerpo.includes("/panel/login"),
    "el boton de volver a entrar apunta al login del panel"
  );
  ok(
    !cuerpo.includes('href="/panel/login"'),
    "y lo hace por la variable panel, no con una ruta escrita a mano"
  );

  /* Lo que NO debe quedar: una ruta relativa que en este host no
     lleva a ninguna parte. */
  ok(
    !cuerpo.includes('href="/panel'),
    "no queda ninguna ruta relativa /panel suelta",
    cuerpo.includes('href="/panel') ? "QUEDA UNA" : "ninguna"
  );

  console.log("\n── sin sesion, a donde manda ──");

  /* /mi-bot sin cookie. Debe redirigir al login DEL PANEL, con URL
     completa. Con el dominio local, el panel se sirve desde el mismo
     127.0.0.1, pero con el puerto del servidor web, no el 3200: por
     eso se mira el puerto de destino, no solo el host. */
  const { status: s2, headers: h2 } = await pedir("/mi-bot");
  const location = h2.location || "";

  if (s2 === 302) {
    ok(!!location, "redirige a alguna parte", location);
    ok(/^https?:\/\//.test(location), "la redirección es una URL completa", location);
    ok(location.includes("/panel/login"), "y va al login", location);
    ok(!location.includes(":3200"), "y NO al puerto del propio bot", location);
  } else {
    ok(false, "sin sesión debería redirigir (fue " + s2 + ")");
  }

  console.log(fallos ? `\n  ${fallos} fallo(s)\n` : "\n  Todo correcto\n");
  process.exit(fallos ? 1 : 0);
})();
