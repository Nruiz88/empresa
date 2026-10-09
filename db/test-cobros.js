/* Prueba la vista de cobros con datos reales, simulando sesión de
   staff (se inserta la sesión en la base, sin usar contraseñas). */
const env = require("../lib/env");
env.load();
const supabase = require("../lib/supabase");
const { staff, staffOParar } = require("../lib/staff");
const db = supabase.getAdmin();
const crypto = require("crypto");

const CSRF = "pruebacsrf";
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");

(async () => {
  const { data: usuarios } = await supabase.getAdmin().auth.admin.listUsers({ perPage: 200 });
  const staff = await staffOParar();

  const token = crypto.randomBytes(24).toString("hex");
  await db.from("sessions").insert({
    token_hash: hash(token),
    user_id: staff.id,
    rol: "staff",
    csrf_token: CSRF,
    expira_en: new Date(Date.now() + 3600e3).toISOString(),
  });

  const res = await fetch("http://127.0.0.1:3000/panel/cobros", {
    headers: { cookie: "nexo_panel=" + token },
  });
  const html = await res.text();

  console.log("\n  cobros -> " + res.status);

  const sacar = (re) => {
    const m = html.match(re);
    return m ? m[1].replace(/\s+/g, " ").trim() : null;
  };

  console.log("  por cobrar      " + (sacar(/por cobrar[\s\S]{0,80}?<\/strong>([\s\S]{0,40}?)<\/div>/) || "?"));
  console.log("  filas de cobro  " + (html.match(/panel-chip--cobro-/g) || []).length);
  console.log("  hay 'Marcar pagado' -> " + html.includes("Marcar pagado"));
  console.log("  hay 'Deshacer'      -> " + html.includes("Deshacer"));
  console.log("  meses listados      " + (html.match(/periodoLargo|octubre|septiembre|agosto/gi) || []).slice(0, 4).join(", "));

  await db.from("sessions").delete().eq("csrf_token", CSRF);
  process.exit(res.ok ? 0 : 1);
})();
