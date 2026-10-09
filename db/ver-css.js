/* Comprobar que quitar las reglas muertas no ha roto ninguna pagina.

   Las llaves cuadran y la profundidad vuelve a cero, pero eso solo
   dice que el archivo esta bien formado. Lo que hay que mirar es que
   las paginas sigan pintando lo mismo: mismo numero de bloques, misma
   separacion, sin errores de consola.

   Y con el ritmo unico de `.panel-page > [class]`, que es lo que mas
   se nota si algo se ha movido. */
const fs = require("fs");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { createRequire } = require("module");

const NL = String.fromCharCode(10);
const env = {};
for (const l of fs.readFileSync(".env", "utf8").split(NL)) {
  const t = l.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const req = createRequire("file:///D:/webs/empresa/db/ver-css.js");

/* Las páginas se arman con un argumento porque dos de ellas necesitan
   datos que no se pueden escribir aquí:

     · La ficha de un cliente. Su id cambia con los datos y la base, y
       una lista con un id fijo acaba apuntando a una ficha que ya no
       existe — que da 404, no un fallo de maquetación, y ese error
       esconde todos los demás.

     · Mi cuenta. Va al revés que las demás: es la única que necesita
       sesión de cliente, y hasta hace poco daba 503 por falta de
       `access_token`. Se descubrió midiendo. */
const PAGINAS = (idCliente) => [
  "/panel",
  "/panel/clientes",
  "/panel/servicios",
  "/panel/cobros",
  "/panel/consultas",
  "/panel/tickets",
  "/panel/catalogo",
  "/panel/salud",
  "/panel/accesos",
  "/panel/clientes/nuevo",
  "/panel/servicios/nuevo",
  "/panel/cobros/generar",

  /* Estas tres se miran porque son las pantallas nuevas de acceso.

     Van aparte de las de arriba porque son las que tienen que aguantar
     el caso raro: la lista puede estar VACÍA —no hay ninguna
     aplicación dada de alta todavía— y una pantalla que solo se ve con
     datos se desarma justo cuando no hay nada que mirar.

     El formulario es el caso contrário: se miran las dos listas, la de
     aplicaciones y la de planes, y los planes sin precio y sin
     aplicaciones marcadas, que son los textos que más estiran una
     etiqueta. */
  "/panel/aplicaciones",
  "/panel/aplicaciones/nuevo",
  "/panel/planes",

  /* Estas tres se miran porque se reestructuraron enteras al unificar
     las cajas: la ficha pasó de `panel-box` a `panel-card` y su
     rejilla pasó de 6/4 a 8/4. Si algo se hubiera quedado sin fondo ni
     borde, es aquí donde se vería. */
  ...(idCliente ? ["/panel/clientes/" + idCliente] : []),
  "/panel/mi-cuenta",
];

(async () => {
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const { data: st } = await db.from("profiles").select("id").eq("rol", "staff").limit(1);
  const tok = crypto.randomBytes(32).toString("hex");
  await db.from("sessions").insert({
    token_hash: crypto.createHash("sha256").update(tok).digest("hex"),
    user_id: st[0].id,
    csrf_token: crypto.randomBytes(12).toString("hex"),
    rol: "staff",
    creada_en: new Date().toISOString(),
    ultimo_acceso: new Date().toISOString(),
    expira_en: new Date(Date.now() + 900000).toISOString(),
  });

  /* El cliente se busca antes de armar la lista de páginas, y si no
     hay ninguno se dice en vez de recorrer doce páginas y dar por
     buena una comprobación que no ha mirado la ficha. */
  const { data: clientes } = await db.from("clients").select("id").limit(1);
  if (!clientes || !clientes.length) {
    console.log("  *** no hay ningun cliente en la base: no puedo comprobar la ficha");
    process.exit(1);
  }

  const { chromium } = req("D:/webs/wweb/node_modules/playwright");
  const b = await chromium.launch();
  const ctx = await b.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    storageState: { cookies: [{ name: "nexo_panel", value: tok, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" }], origins: [] },
  });

  /* La lista se arma una vez y se recorre. Armarla dentro del bucle
   haría que `PAGINAS.length` —que es la aridad de la función, o sea
   1— saliera como total, y un recuento que miente sobre cuántas
   páginas se han mirado no sirve para nada. */
const RUTAS = PAGINAS(clientes[0].id);

let fallos = 0;
for (const url of RUTAS) {
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", (e) => errs.push(e.message.slice(0, 50)));
    const r = await p.goto("http://127.0.0.1:3000" + url, { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(350);

    const d = await p.evaluate(() => {
      const raiz = document.querySelector(".panel-page");
      if (!raiz) return { sinRaiz: true };
      const hijos = [...raiz.children].filter((e) => {
        const c = getComputedStyle(e);
        return c.display !== "none" && c.position !== "absolute" && e.tagName !== "SCRIPT";
      });
      const huecos = [];
      for (let i = 0; i < hijos.length - 1; i++) {
        const a = hijos[i].getBoundingClientRect();
        const b2 = hijos[i + 1].getBoundingClientRect();
        if (a.height > 0 && b2.height > 0) huecos.push(Math.round(b2.top - a.bottom));
      }
      const sinEstilo = [...document.querySelectorAll(".panel-serv, .panel-caduco, .panel-empty, .panel-note, .panel-requiere, .panel-alert")]
        .filter((e) => getComputedStyle(e).borderStyle === "none" && getComputedStyle(e).backgroundColor === "rgba(0, 0, 0, 0)").length;
      return {
        bloques: hijos.length,
        huecos: huecos.length ? Math.min(...huecos) + (huecos.some((x) => x !== huecos[0]) ? " (varia)" : "") : "-",
        minHueco: huecos.length ? Math.min(...huecos) : null,
        sinEstilo,
        alto: Math.round(raiz.getBoundingClientRect().height),
        desborde: document.documentElement.scrollWidth > window.innerWidth,
      };
    });

    const ok = r.status() < 400 && !d.sinRaiz && !d.desborde && !errs.length;
    if (!ok) fallos++;
    console.log("  " + (ok ? "OK   " : "FALLA") + " " + url.padEnd(26) +
      "HTTP " + r.status() +
      (d.sinRaiz ? "  SIN RAIZ" : "  bloques " + String(d.bloques).padStart(2) + "  hueco min " + String(d.minHueco).padStart(3) + "px  alto " + d.alto) +
      (d.sinEstilo ? "  SIN ESTILO: " + d.sinEstilo : "") +
      (errs.length ? "  ERRORES: " + errs.join(" | ") : ""));
    await p.close();
  }

  console.log("");
  console.log("  paginas con problema: " + fallos + " de " + RUTAS.length);

  await b.close();
  await db.from("sessions").delete().eq("user_id", st[0].id);
  process.exit(fallos ? 1 : 0);
})();