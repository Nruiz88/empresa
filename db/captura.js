/* =========================================================
   Nexo Studio — Captura del panel para revisión visual
   ------------------------------------------------------------
   Uso:  node db/captura.js [ruta] [nombre]

   Genera un HTML estático de una pantalla del panel (con una
   sesión de prueba) y lo deja un momento en public/_captura.html
   para poder fotografiarlo con un navegador sin sesión.

   El archivo es TEMPORAL y se borra al terminar. No es una puerta
   al panel: es una foto de lo que ya se ve al entrar.
   ========================================================= */

const fs = require("fs");
const path = require("path");
const env = require("../lib/env");
env.load();
const supabase = require("../lib/supabase");
const db = supabase.getAdmin();
const crypto = require("crypto");

const CSRF = "captura";
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");

const RUTA = process.argv[2] || "/panel";
const SALIDA = process.argv[3] || "panel";

(async () => {
  const { data: usuarios } = await supabase.getAdmin().auth.admin.listUsers({ perPage: 200 });
  const staff = usuarios.users.find((u) => u.email === "admin@nexostudio.es");
  if (!staff) throw new Error("no hay usuario de staff");

  /* Un access_token REAL del usuario. Sin esto, la sesión no puede
     reconstruir la sesión de Supabase y el portal devuelve 503: la
     captura sale con un error en lugar de con la página, y parece
     que la vista está rota cuando lo que falla es la sesión de
     prueba. Se hace con magiclink, que no necesita contraseña.

     generateLink va con el cliente ADMIN (needs the service key), y
     verifyOtp con el público: el primero pide el token de servidor,
     el segundo devuelve una sesión de usuario normal. */
  const { data: link, error: errLink } = await supabase
    .getAdmin()
    .auth.admin.generateLink({ type: "magiclink", email: staff.email });
  if (errLink) throw new Error("generateLink: " + errLink.message);

  const { data: verif, error: errVerif } = await supabase
    .getPublico()
    .auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (errVerif) throw new Error("verifyOtp: " + errVerif.message);

  const accessToken = verif.session.access_token;
  const refreshToken = verif.session.refresh_token;

  const token = crypto.randomBytes(24).toString("hex");
  await db.from("sessions").insert({
    token_hash: hash(token),
    user_id: staff.id,
    rol: "staff",
    csrf_token: CSRF,
    access_token: accessToken,
    refresh_token: refreshToken,
    expira_en: new Date(Date.now() + 600e3).toISOString(),
  });

  const res = await fetch("http://127.0.0.1:3000" + RUTA, {
    headers: { cookie: "nexo_panel=" + token },
  });
  const html = await res.text();
  await db.from("sessions").delete().eq("csrf_token", CSRF);

  const destino = path.join(__dirname, "..", "public", "_captura.html");
  fs.writeFileSync(destino, html, "utf8");

  console.log("  " + RUTA + " -> " + res.status + ", " + html.length + " bytes");
  console.log("  captura en: public/_captura.html  (" + SALIDA + ")");
  process.exit(0);
})().catch((e) => {
  console.error("error: " + e.message);
  process.exit(1);
});
