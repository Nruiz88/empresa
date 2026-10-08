require("../lib/env").load();
const supabase = require("../lib/supabase");
const db = supabase.getAdmin();
const crypto = require("crypto");
const BASE = "http://127.0.0.1:3000";
const COOKIE = "nexo_panel";
const CSRF = "csrdmanchas";
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");

const RUTAS = [
  "/panel", "/panel/clientes", "/panel/clientes/nuevo", "/panel/servicios",
  "/panel/servicios/nuevo", "/panel/consultas", "/panel/cobros",
  "/panel/cobros/nuevo", "/panel/accesos", "/panel/accesos/nuevo",
  "/panel/tickets", "/panel/catalogo", "/panel/salud",
  "/panel/bots", "/panel/bots?estado=sin-conectar", "/panel/bots/nuevo",
  "/panel/servidores", "/panel/servidores/nuevo",
];

/* Manchas que delatan una variable que no llegó a la vista. Salen
   cuando un router pasa un objeto donde la vista espera un número, o
   cuando se le pasa un helper que nadie inyectó. */
const MANCHAS = ["[object Object]", "undefined", "NaN", "null", "&lt;%"];

(async () => {
  const { data: usuarios } = await supabase.getAdmin().auth.admin.listUsers({ perPage: 200 });
  const staffId = (usuarios.users.find((u) => u.email === "admin@nexostudio.es") || {}).id;
  const token = crypto.randomBytes(24).toString("hex");
  await db.from("sessions").insert({
    token_hash: hash(token), user_id: staffId, rol: "staff",
    csrf_token: CSRF, expira_en: new Date(Date.now() + 3600e3).toISOString(),
  });

  let fallos = 0;
  for (const r of RUTAS) {
    const res = await fetch(BASE + r, { headers: { cookie: COOKIE + "=" + token } });
    const html = await res.text();

    const encontradas = [];
    for (const m of MANCHAS) {
      /* Se busca solo dentro del contenido: los atributos como
         value="undefined" también son un fallo, pero el HTML tiene
         scripts quetalk contain words like "undefined" legitimately. */
      const cuerpo = html.replace(/<script[\s\S]*?<\/script>/g, "");
      const re = new RegExp(">" + m.replace(/[[\]]/g, "\\$&") + "<");
      if (re.test(cuerpo)) encontradas.push(m);
    }

    if (encontradas.length) {
      fallos++;
      console.log("  ✗ " + r + "  sale con " + encontradas.join(", "));
      for (const m of encontradas) {
        const i = html.indexOf(">" + m + "<");
        console.log("      " + html.slice(Math.max(0, i - 160), i + 40).replace(/\s+/g, " "));
      }
    } else {
      console.log("  ✓ " + r);
    }
  }

  await db.from("sessions").delete().eq("csrf_token", CSRF);
  console.log(fallos ? "\n  ✗ " + fallos + " pantalla(s) con manchas" : "\n  ✓ ninguna pantalla sale con manchas");
  process.exit(fallos ? 1 : 0);
})();