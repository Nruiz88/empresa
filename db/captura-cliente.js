/* Captura del PORTAL DEL CLIENTE, con su sesión real.
   Uso: node db/captura-cliente.js [ruta]
   Por defecto /panel/mis-servicios.

   La diferencia con db/captura.js: ese entra como STAFF y por eso
   muestra el lateral de gestión. Para revisar el portal del cliente
   hay que usar este, o la captura sale con la pantalla equivocada.

   Hace falta un access_token REAL de Supabase (RLS), y una cookie de
   sesión propia con ese token dentro. Por eso no vale un token
   inventado. */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const env = require("../lib/env");
env.load();
const supabase = require("../lib/supabase");
const db = supabase.getAdmin();

const CSRF = "captura-cliente";
const RUTA = process.argv[2] || "/panel/mis-servicios";

const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");

(async () => {
  const { data: usuarios } = await db.auth.admin.listUsers({ perPage: 200 });
  const cliente = usuarios.users.find((u) => u.email === "cliente@ejemplo.com");
  if (!cliente) throw new Error("no está el cliente de ejemplo; ejecuta npm run seed");

  /* Access_token real del usuario: el portal lo usa para reconstruir
     la sesión y que sea RLS quien filtre. */
  const { data: sesion, error } = await supabase.getPublico().auth.signInWithPassword({
    email: "cliente@ejemplo.com",
    password: "ClienteDemo123",
  });
  if (error) throw new Error("login: " + error.message);

  const { data: perfil } = await db
    .from("profiles")
    .select("id,rol")
    .eq("id", cliente.id)
    .maybeSingle();
  if (!perfil) throw new Error("el cliente no tiene perfil");

  const token = crypto.randomBytes(24).toString("hex");
  await db.from("sessions").insert({
    token_hash: hash(token),
    user_id: cliente.id,
    rol: perfil.rol,
    csrf_token: CSRF,
    access_token: sesion.session.access_token,
    refresh_token: sesion.session.refresh_token,
    expira_en: new Date(Date.now() + 600e3).toISOString(),
  });

  const BASE = process.env.PANEL_URL || "http://127.0.0.1:3000";

  const res = await fetch(BASE + RUTA, {
    headers: { cookie: "nexo_panel=" + token },
  });
  const html = await res.text();

  await db.from("sessions").delete().eq("csrf_token", CSRF);

  fs.writeFileSync(path.join(__dirname, "..", "public", "_captura.html"), html, "utf8");

  console.log("  " + BASE + RUTA + " -> " + res.status + ", " + html.length + " bytes");
  if (res.status >= 400) {
    console.error("  Ojo: la página devolvió error. Mira el error.log antes de fiarte del diseño.");
  }

  /* Los enlaces de cada servicio. Es lo que comprueba que el botón
   * "Abrir" lleva al microservicio y no a un 404: el enlace se
   * construye en la plantilla y sin verlo no hay forma de saber si
   * apunta bien. */
  const enlaces = [...html.matchAll(/href="(\/panel\/(?:servicios|soporte)[^"]*)"/g)].map((m) => m[1]);
  if (enlaces.length) {
    console.log("  enlaces de servicio:");
    for (const e of enlaces) console.log("    " + e);
  }

  console.log("  abre " + BASE + "/_captura.html");
  process.exit(res.ok ? 0 : 1);
})().catch((e) => {
  console.error("error: " + e.message);
  process.exit(1);
});
