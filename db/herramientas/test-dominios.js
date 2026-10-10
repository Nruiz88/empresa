/* Pruebas de la deduccion de subdominios (lib/site.js).

   El bot tiene que vivir en bot.<el dominio que tengas>, no en un
   dominio escrito a mano. Si esto se rompe, el bot sigue arrancando
   bien y el fallo aparece un dia en que un cliente pulsa "Abrir" y
   aterriza en un sitio que no existe. Es de los fallos que no se ven
   hasta que ya han pasado. */

const path = require("path");

/* `lib/site.js` lee el .env AL CARGARSE, así que para probarlo con
   dominios distintos hay que cargarlo otra vez cada vez, vaciando su
   caché antes (y la de `lib/env`, que es la que lee el fichero).

   Por eso esto es un script suelto y no una prueba dentro del
   `npm test` normal: cambiar process.env.SITE_URL a mitad de la
   sesión dejaría el resto de pruebas con el dominio equivocado. Por
   eso la última línea sale con process.exit: el .env ya se cargó
   varias veces y no interesa arrastrarlo. */
const LIB = path.join(__dirname, "..", "..", "lib");

function cargar(siteUrl, extra = {}) {
  /* Solo los módulos del proyecto. node_modules no se toca. */
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(LIB + path.sep) || k.startsWith(LIB + "/")) {
      delete require.cache[k];
    }
  }

  const anterior = {};
  const claves = ["SITE_URL", "PANEL_URL", "BOT_URL", ...Object.keys(extra)];
  for (const k of claves) {
    anterior[k] = process.env[k];
    delete process.env[k];
  }
  if (siteUrl) process.env.SITE_URL = siteUrl;
  for (const [k, v] of Object.entries(extra)) process.env[k] = v;

  const site = require("../../lib/site");
  return {
    site,
    restaurar() {
      for (const k of claves) {
        if (anterior[k] === undefined) delete process.env[k];
        else process.env[k] = anterior[k];
      }
    },
  };
}

let fallos = 0;
const ok = (c, n, extra) => {
  console.log(`  ${c ? "✓" : "✗"} ${n}${extra ? "  → " + extra : ""}`);
  if (!c) fallos++;
};

console.log("\n── el subdominio se saca del dominio que haya ──");

{
  const { site, restaurar } = cargar("https://nexoestudio.es");
  ok(site.dominio === "nexoestudio.es", "de un dominio pelado sale el mismo", site.dominio);
  ok(
    site.urlDeServicio("bot", "", 3200) === "https://bot.nexoestudio.es",
    "el bot va a bot.nexoestudio.es",
    site.urlDeServicio("bot", "", 3200)
  );
  ok(
    site.urlDeServicio("inventario", "", 3300) === "https://inventario.nexoestudio.es",
    "otro servicio va a su propio subdominio"
  );
  restaurar();
}

{
  /* Con www delante sale el dominio pelado, que es lo que se quiere:
     www.nexoestudio.es y nexoestudio.es son el mismo sitio. */
  const { site, restaurar } = cargar("https://www.nexoestudio.es");
  ok(site.dominio === "nexoestudio.es", "quita el www", site.dominio);
  ok(
    site.urlDeServicio("bot", "", 3200) === "https://bot.nexoestudio.es",
    "y el bot sigue detrás, sin www delante",
    site.urlDeServicio("bot", "", 3200)
  );
  restaurar();
}

{
  const { site, restaurar } = cargar("https://www.panaderialaespiga.es");
  ok(site.dominio === "panaderialaespiga.es", "otro dominio distinto", site.dominio);
  ok(
    site.urlDeServicio("bot", "", 3200) === "https://bot.panaderialaespiga.es",
    "el bot sigue siendo bot.panaderialaespiga.es"
  );
  restaurar();
}

console.log("\n── http se respeta ──");

{
  const { site, restaurar } = cargar("http://nexoestudio.es");
  ok(
    site.urlDeServicio("bot", "", 3200) === "http://bot.nexoestudio.es",
    "si la web va en http, el bot también (no se inventa https)",
    site.urlDeServicio("bot", "", 3200)
  );
  restaurar();
}

console.log("\n── sin dominio real, se usa el puerto ──");

{
  /* En desarrollo no hay subdominios: "http://127.0.0.1:3000" no
     resuelve "bot." en ningún navegador. El puerto es lo único que
     funciona. */
  const { site, restaurar } = cargar("http://127.0.0.1:3000");
  ok(
    site.urlDeServicio("bot", "", 3200) === "http://127.0.0.1:3200",
    "con 127.0.0.1 va al puerto del servicio",
    site.urlDeServicio("bot", "", 3200)
  );
  restaurar();
}

{
  const { site, restaurar } = cargar("http://localhost:3000");
  ok(
    site.urlDeServicio("bot", "", 3200) === "http://127.0.0.1:3200",
    "con localhost igual",
    site.urlDeServicio("bot", "", 3200)
  );
  restaurar();
}

{
  /* El marcador "midominio.com" sigue sin ser un dominio real. Si se
     publica sin cambiarlo, lo derivado tiene que seguir siendo local
     y no "bot.midominio.com", que no va a ningún sitio. */
  const { site, restaurar } = cargar(null);
  ok(site.dominioDeEjemplo === true, "sigue reconociendo el marcador");
  ok(
    site.urlDeServicio("bot", "", 3200) === "http://127.0.0.1:3200",
    "sin dominio, no inventa un subdominio que no existe",
    site.urlDeServicio("bot", "", 3200)
  );
  restaurar();
}

console.log("\n── BOT_URL manda sobre lo deducido ──");

{
  /* Para un servicio que no va en el subdominio del dominio
     principal, o que está en otro dominio entero. */
  const { site, restaurar } = cargar("https://nexoestudio.es", {
    BOT_URL: "https://proveedor-externo.net",
  });
  ok(
    site.urlDeServicio("bot", process.env.BOT_URL, 3200) === "https://proveedor-externo.net",
    "con BOT_URL puesta gana esa",
    site.urlDeServicio("bot", process.env.BOT_URL, 3200)
  );
  restaurar();
}

{
  /* Sin https delante se añade. */
  const { site, restaurar } = cargar("https://nexoestudio.es", { BOT_URL: "api.ejemplo.com" });
  ok(
    site.urlDeServicio("bot", process.env.BOT_URL, 3200) === "https://api.ejemplo.com",
    "una URL sin protocolo pone https",
    site.urlDeServicio("bot", process.env.BOT_URL, 3200)
  );
  restaurar();
}

{
  /* Una barra al final no rompe el subdominio. */
  const { site, restaurar } = cargar("https://nexoestudio.es/", { BOT_URL: "https://api.ejemplo.com/" });
  ok(
    site.urlDeServicio("bot", process.env.BOT_URL, 3200) === "https://api.ejemplo.com",
    "quita la barra del final",
    site.urlDeServicio("bot", process.env.BOT_URL, 3200)
  );
  restaurar();
}

{
  const { site, restaurar } = cargar("https://nexoestudio.es", { BOT_URL: "   " });
  ok(
    site.urlDeServicio("bot", process.env.BOT_URL, 3200) === "https://bot.nexoestudio.es",
    "BOT_URL vacía no pisa nada",
    site.urlDeServicio("bot", process.env.BOT_URL, 3200)
  );
  restaurar();
}

console.log("\n── NO se coge solo el dominio pelado ──");

/* Este bloque existe por un fallo del primer despliegue. La deducción
   se quedaba con las dos últimas etiquetas del host, así que:

     empresa.panel-niconqn.duckdns.org → duckdns.org → bot.duckdns.org

   y el botón "Abrir" mandaba a un subdominio de DuckDNS que no es
   nuestro. Las pruebas de arriba pasaban porque todas usaban
   dominios de dos etiquetas, que es justo el caso donde el recorte
   acierta.

   Con más de dos niveles hay que anteponer el subdominio al host
   ENTERO, quitando solo el www. */
{
  const { site, restaurar } = cargar("https://empresa.panel-niconqn.duckdns.org");
  ok(site.dominio === "empresa.panel-niconqn.duckdns.org", "conserva todos los niveles", site.dominio);
  ok(
    site.urlDeServicio("bot", "", 3200) === "https://bot.empresa.panel-niconqn.duckdns.org",
    "el bot va detrás, con la cadena entera",
    site.urlDeServicio("bot", "", 3200)
  );
  ok(
    !site.urlDeServicio("bot", "", 3200).includes("https://bot.duckdns.org"),
    "y NO a un dominio ajeno que casualmente comparte sufijo"
  );
}

{
  /* .co.uk y .com.ar son de lo más normal. */
  const { site, restaurar } = cargar("https://empresa.ejemplo.co.uk");
  ok(site.dominio === "empresa.ejemplo.co.uk", "con .co.uk", site.dominio);
  ok(
    site.urlDeServicio("bot", "", 3200) === "https://bot.empresa.ejemplo.co.uk",
    "el bot también",
    site.urlDeServicio("bot", "", 3200)
  );
}

{
  const { site, restaurar } = cargar("https://www.empresa.nexoestudio.es");
  ok(site.dominio === "empresa.nexoestudio.es", "quita el www y nada más", site.dominio);
  ok(
    site.urlDeServicio("bot", "", 3200) === "https://bot.empresa.nexoestudio.es",
    "y el bot sale bien",
    site.urlDeServicio("bot", "", 3200)
  );
}

{
  /* Con subdominio de servicio ya presente, se antepone el suyo: no
     se come el que hay. */
  const { site, restaurar } = cargar("https://panel.nexoestudio.es");
  ok(site.dominio === "panel.nexoestudio.es", "con panel delante", site.dominio);
  ok(
    site.urlDeServicio("bot", "", 3200) === "https://bot.panel.nexoestudio.es",
    "el bot delante, sin comerse el panel",
    site.urlDeServicio("bot", "", 3200)
  );
}

{
  /* El marcador de ejemplo no sirve para deducir nada: es un
     placeholder, no un dominio. Aunque se le anteponga el subdominio
     sale un sitio que no existe, así que cae al puerto local. */
  const { site, restaurar } = cargar("https://panel.midominio.com");
  ok(
    site.urlDeServicio("bot", "", 3200) === "http://127.0.0.1:3200",
    "con el marcador no inventa bot.panel.midominio.com",
    site.urlDeServicio("bot", "", 3200)
  );
  restaurar();
}

console.log(fallos ? `\n  ${fallos} fallo(s)\n` : "\n  Todo correcto\n");
process.exit(fallos ? 1 : 0);
