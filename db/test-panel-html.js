/* Mira el HTML que genera el panel y comprueba que la estructura
   nueva (lateral, menú, capa) está donde debe. */
const fs = require("fs");
const path = require("path");
const env = require("../lib/env");
env.load();
const supabase = require("../lib/supabase");
const { staff, staffOParar } = require("../lib/staff");
const db = supabase.getAdmin();
const crypto = require("crypto");

const CSRF = "pruebacsrf";
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");

const COMPROBAR = [
  [/<aside class="panel-side"/, "lateral presente"],
  [/panel-menu-item is-active/, "sección actual marcada"],
  [/class="panel-scrim"/, "capa del cajón"],
  [/data-panel-abrir/, "botón de menú (móvil)"],
  [/panel-skip/, "enlace de salto"],
  [/<svg viewBox="0 0 20 20"/, "iconos del menú"],
  [/\/js\/panel\.js/, "script del panel"],
  [/gsap/i, "NO debe cargar GSAP"],
  [/class="panel-topbar"/, "barra superior"],
];

(async () => {
  const { data: usuarios } = await supabase.getAdmin().auth.admin.listUsers({ perPage: 200 });
  const staff = await staffOParar();
  const cliente = usuarios.users.find((u) => u.email === "cliente@ejemplo.com");

  const token = crypto.randomBytes(24).toString("hex");
  await db.from("sessions").insert({
    token_hash: hash(token),
    user_id: staff.id,
    rol: "staff",
    csrf_token: CSRF,
    expira_en: new Date(Date.now() + 3600e3).toISOString(),
  });

  const html = await (
    await fetch("http://127.0.0.1:3000/panel/cobros", { headers: { cookie: "nexo_panel=" + token } })
  ).text();

  console.log("\n  Panel del equipo:");
  let fallos = 0;
  for (const [re, nombre] of COMPROBAR) {
    const mal = re.source.includes("NO") ? re.test(html) : !re.test(html);
    if (mal) fallos++;
    console.log(`  ${mal ? "✗" : "✓"} ${nombre}`);
  }

  /* El cliente NO debe ver lateral: tiene una sola sección. */
  await db.from("sessions").delete().eq("csrf_token", CSRF);
  const t2 = crypto.randomBytes(24).toString("hex");
  await db.from("sessions").insert({
    token_hash: hash(t2),
    user_id: cliente.id,
    rol: "client",
    csrf_token: CSRF,
    expira_en: new Date(Date.now() + 3600e3).toISOString(),
  });
  const htmlCli = await (
    await fetch("http://127.0.0.1:3000/panel/mis-servicios", { headers: { cookie: "nexo_panel=" + t2 } })
  ).text();

  const sinLateral = !/<aside class="panel-side"/.test(htmlCli);
  const sinClientes = !htmlCli.includes("Cobros");
  console.log(`  ${sinLateral ? "✓" : "✗"} el cliente no ve el lateral de gestión`);
  console.log(`  ${sinClientes ? "✓" : "✗"} el cliente no ve los enlaces de cobros`);
  if (!sinLateral || !sinClientes) fallos++;

  await db.from("sessions").delete().eq("csrf_token", CSRF);

  /* Los filtros tienen que sobrevivir al cambio de página.

     No hace falta pedir la página por HTTP: lo que importa es el
     enlace que genera la vista, y eso está en el .ejs. Mirarlo
     directamente evita depender del servidor para una comprobación
     de plantilla.

     Sin esto, buscar algo y pasar a la página 2 deja la lista sin
     filtro y parece que el buscador no funciona. */
  console.log("\n  Los filtros sobreviven a la paginación:");
  const paginas = ["clientes", "servicios", "cobros", "consultas"];
  let fallosFiltro = 0;
  for (const p of paginas) {
    const fuente = fs.readFileSync(
      path.join(__dirname, "..", "views", "panel", p + ".ejs"),
      "utf8"
    );
    const bloque = (fuente.match(/<nav class="panel-pager"[\s\S]*?<\/nav>/) || [""])[0];

    /* Se mira el CÓDIGO de la vista, no el HTML generado, y por un
       motivo concreto: con pocos registros no hay página 2, así que
       el bloque ni siquiera se renderiza y no habría nada que
       comprobar. Habría que sembrar 26 clientes para verlo.

       Se acepta cualquiera de las dos formas correctas: arrastrar la
       búsqueda en línea, o acumular los filtros en una variable.
       Lo que no vale es no mencionarla. */
    const arrastra =
      bloque.includes("encodeURIComponent(q)") || /var\s+conserva/.test(bloque);

    if (!arrastra) fallosFiltro++;
    console.log(
      `  ${arrastra ? "✓" : "✗"} ${p}: el enlace de página arrastra la búsqueda`
    );
  }

  const total = fallos + fallosFiltro;
  console.log(total ? `\n  ${total} fallo(s)\n` : "\n  Todo correcto\n");
  process.exit(total ? 1 : 0);
})().catch((e) => {
  console.error("error: " + e.message);
  process.exit(1);
});
