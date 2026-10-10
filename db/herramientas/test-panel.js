/* Prueba del panel sin usar contraseñas: se inserta una sesión
   temporal en la base de datos y se navega por HTTP con esa cookie. */
const env = require("../../lib/env");
env.load();
const supabase = require("../../lib/supabase");
const { staff, staffOParar } = require("../../lib/staff");
const db = supabase.getAdmin();
const crypto = require("crypto");

const BASE = "http://127.0.0.1:3000";
const COOKIE = "nexo_panel";
const CSRF = "pruebacsrf";
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");

async function sesionDePrueba(userId, rol, accessToken = null) {
  const token = crypto.randomBytes(24).toString("hex");
  const { error } = await db.from("sessions").insert({
    token_hash: hash(token),
    user_id: userId,
    rol,
    csrf_token: CSRF,
    access_token: accessToken,
    expira_en: new Date(Date.now() + 3600e3).toISOString(),
  });
  if (error) throw new Error(error.message);
  return token;
}

async function pedir(ruta, token, metodo = "GET", cuerpo = null) {
  const res = await fetch(BASE + ruta, {
    method: metodo,
    redirect: "manual",
    headers: {
      cookie: COOKIE + "=" + token,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: cuerpo,
  });
  return { status: res.status, texto: await res.text() };
}

function motivo(texto) {
  const m =
    texto.match(/<h1[^>]*>([\s\S]{0,140}?)<\/h1>/) ||
    texto.match(/(ReferenceError[\s\S]{0,120})/) ||
    texto.match(/(Cannot read[\s\S]{0,120})/);
  return m ? m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "";
}

(async () => {
  const { data: usuarios } = await supabase.getAdmin().auth.admin.listUsers({ perPage: 200 });
  const idDe = (mail) => (usuarios.users.find((u) => u.email === mail) || {}).id;

  const staffId = (await staff()).id;
  const clientId = idDe("cliente@ejemplo.com");
  if (!staffId) throw new Error("no se encuentra el usuario staff");

  const staff = await sesionDePrueba(staffId, "staff");

  let fallos = 0;
  const comprobar = async (ruta, esperado) => {
    const { status, texto } = await pedir(ruta, staff);
    const ok = status === esperado;
    if (!ok) fallos++;
    console.log(`  ${ok ? "✓" : "✗"} ${ruta.padEnd(28)} ${status}${ok ? "" : "  (esperaba " + esperado + ")"}`);
    if (!ok && motivo(texto)) console.log("      " + motivo(texto));
    return texto;
  };

  console.log("\n── Rutas del panel (staff) ─────────────────────────");
  await comprobar("/panel", 200);
  await comprobar("/panel/clientes", 200);
  await comprobar("/panel/clientes/nuevo", 200);
  await comprobar("/panel/servicios", 200);
  await comprobar("/panel/servicios/nuevo", 200);
  await comprobar("/panel/consultas", 200);
  await comprobar("/panel/cobros", 200);
  await comprobar("/panel/cobros/nuevo", 200);
  await comprobar("/panel/accesos", 200);
  await comprobar("/panel/accesos/nuevo", 200);

  /* Bots y cajas. Van aparte porque no existían antes y son las rutas
     que más se pueden romper en silencio: una vista con una variable que
     falta devuelve 500 y el error sale en el log, no en la pantalla. */
  await comprobar("/panel/bots", 200);
  await comprobar("/panel/bots/nuevo", 200);
  await comprobar("/panel/servidores", 200);
  await comprobar("/panel/servidores/nuevo", 200);

  const { data: caja } = await db.from("evolution_servers").select("id").limit(1).maybeSingle();
  if (caja) await comprobar("/panel/servidores/" + caja.id + "/editar", 200);

  const { data: bot } = await db.from("bots").select("id").limit(1).maybeSingle();
  if (bot) {
    await comprobar("/panel/bots?q=" + encodeURIComponent("panaderia"), 200);
    await comprobar("/panel/bots?estado=sin-conectar", 200);
  }

  /* Una caja que no existe NO da un 404 del panel: la ruta redirige a la
     lista con el motivo en la URL, que es lo que hace el resto del panel
     (ver routes/panel-clientes.js con una ficha inexistente). Lo que se
     comprueba es que no revienta con un 500, que es el fallo que de
     verdad duele: se vería solo en el log. */
  {
    const res = await fetch(BASE + "/panel/servidores/no-existe/editar", {
      redirect: "manual",
      headers: { cookie: COOKIE + "=" + staff },
    });
    const ok = res.status === 302 && String(res.headers.get("location")).includes("error=servidor:no-existe");
    if (!ok) fallos++;
    console.log(`  ${ok ? "✓" : "✗"} /panel/servidores/no-existe  ${res.status} -> ${res.headers.get("location")}`);
  }

  const { data: cli } = await db.from("clients").select("id,empresa").limit(1).maybeSingle();
  if (cli) await comprobar("/panel/clientes/" + cli.id, 200);

  const { data: srv } = await db.from("services").select("id").limit(1).maybeSingle();
  if (srv) await comprobar("/panel/servicios/" + srv.id + "/editar", 200);

  console.log("\n── Un cliente NO puede tocar gestión (403) ──────────");
  const { data: staffPerfil } = await db.from("profiles").select("id").eq("id", staffId).maybeSingle();
  const { data: clientePerfil } = clientId
    ? await db.from("profiles").select("id,rol").eq("id", clientId).maybeSingle()
    : { data: null };

  if (clientePerfil) {
    const cliToken = await sesionDePrueba(clientePerfil.id, clientePerfil.rol);
    /* Bots y cajas en la lista. Lo que hay que comprobar aquí es que las
       llaves de las cajas no se leen desde el portal: `evolution_servers`
       no tiene RLS a propósito (migración 011) y el panel es el único que
       debe leerla. Un cliente que llegara a /panel/servidores vería
       nombres de cajas, urls y, en el peor caso, claves. */
    for (const r of [
      "/panel/clientes",
      "/panel/servicios",
      "/panel/consultas",
      "/panel/cobros",
      "/panel/accesos",
      "/panel/bots",
      "/panel/bots/nuevo",
      "/panel/servidores",
      "/panel/servidores/nuevo",
    ]) {
      const { status } = await pedir(r, cliToken);
      const ok = status === 403;
      if (!ok) fallos++;
      console.log(`  ${ok ? "✓" : "✗"} ${r.padEnd(28)} ${status}${ok ? "" : "  (esperaba 403)"}`);
    }

    console.log("\n── Sin sesión, todo redirige al login ──────────────");
    const res = await fetch(BASE + "/panel/clientes", { redirect: "manual" });
    const ok = res.status === 302 && String(res.headers.get("location")).includes("/panel/login");
    if (!ok) fallos++;
    console.log(`  ${ok ? "✓" : "✗"} /panel/clientes           ${res.status} -> ${res.headers.get("location")}`);
  } else {
    console.log("  (no hay cliente de prueba)");
  }

  console.log(fallos ? `\n  ${fallos} fallo(s)\n` : "\n  Todo correcto\n");
  await db.from("sessions").delete().eq("csrf_token", CSRF);
  process.exit(fallos ? 1 : 0);
})().catch((e) => {
  console.error("error: " + e.message);
  process.exit(1);
});
