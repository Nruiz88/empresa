/* Lista los usuarios de Auth y su perfil/rol. Solo lectura. */
const supabase = require("../../lib/supabase");
require("../../lib/env").load();

(async () => {
  const admin = supabase.getAdmin();
  let todos = [];
  for (let p = 1; p <= 10; p++) {
    const { data, error } = await admin.auth.admin.listUsers({ page: p, perPage: 200 });
    if (error) {
      console.error("✗ " + error.message);
      process.exit(1);
    }
    todos = todos.concat(data.users || []);
    if (!(data.users || []).length) break;
  }

  console.log("\nUsuarios en Supabase Auth: " + todos.length);
  for (const u of todos) {
    const { data: perfil } = await admin
      .from("profiles")
      .select("rol, activo, client_id, nombre")
      .eq("id", u.id)
      .maybeSingle();

    let empresa = "";
    if (perfil && perfil.client_id) {
      const { data: c } = await admin
        .from("clients")
        .select("empresa")
        .eq("id", perfil.client_id)
        .maybeSingle();
      empresa = (c && c.empresa) || "";
    }

    console.log(
      "  " + String(u.email).padEnd(30) +
        ((perfil ? perfil.rol : "SIN PERFIL").padEnd(12)) +
        (perfil && perfil.activo === false ? "INACTIVO" : "activo") +
        (empresa ? "  → " + empresa : "")
    );
  }
  console.log("");
  process.exit(0);
})().catch((e) => {
  console.error("✗ " + e.message);
  process.exit(1);
});
