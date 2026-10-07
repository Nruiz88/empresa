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
const req = createRequire("file:///D:/webs/empresa/db/ver-srv.js");

(async () => {
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

  /* Login de verdad. La tabla sessions necesita access_token: no se
     guarda al crear la fila, lo emite Supabase Auth al entrar. Sin
     el, /panel/mis-servicios contesta 503 con "tu sesion no se pudo
     reconstruir" en vez de la pantalla — y una comprobacion hecha
     contra ese 503 mide la pagina de error y no la que se queria. */
  const usuarios = (await db.auth.admin.listUsers({ page: 1, perPerPage: 1000, perPage: 1000 })).data?.users || [];
  const u = usuarios.find((x) => x.email === "cliente@ejemplo.com");

  const auth = await fetch(env.SUPABASE_URL + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { apikey: env.SUPABASE_SECRET_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email: "cliente@ejemplo.com", password: "ClienteDemo123" }),
  });
  const j = await auth.json();

  if (!j.access_token) {
    console.log("  no he podido entrar: " + JSON.stringify(j).slice(0, 130));
    process.exit(1);
  }

  const token = crypto.randomBytes(32).toString("hex");
  await db.from("sessions").insert({
    token_hash: crypto.createHash("sha256").update(token).digest("hex"),
    user_id: u.id,
    csrf_token: crypto.randomBytes(12).toString("hex"),
    rol: "client",
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    creada_en: new Date().toISOString(),
    ultimo_acceso: new Date().toISOString(),
    expira_en: new Date(Date.now() + 600000).toISOString(),
  });

  const { chromium } = req("D:/webs/wweb/node_modules/playwright");
  const b = await chromium.launch();

  for (const w of [1280, 390]) {
    const ctx = await b.newContext({
      viewport: { width: w, height: w === 1280 ? 1000 : 844 },
      deviceScaleFactor: 1,
      storageState: { cookies: [{ name: "nexo_panel", value: token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" }], origins: [] },
    });
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", (e) => errs.push(e.message.slice(0, 60)));

    const r = await p.goto("http://127.0.0.1:3000/panel/mis-servicios", { waitUntil: "networkidle" });

    const d = await p.evaluate(() => {
      const filas = [...document.querySelectorAll(".portal-serv")];
      return {
        nFilas: filas.length,
        apps: document.querySelectorAll(".portal-app").length,
        chips: filas.map((f) => [...f.querySelectorAll(".panel-chip")].map((c) => c.textContent.trim()).join(" · ")),
        datos: filas.map((f) => [...f.querySelectorAll(".portal-serv-dato")].map((x) => x.textContent.trim().replace(/\s+/g, " ")).join(" | ")),
        franja: filas.map((f) => getComputedStyle(f, "::before").backgroundColor),
        colorChip: filas.map((f) => {
          const c = f.querySelector(".panel-chip--acceso-activo,.panel-chip--acceso-bloqueado,.panel-chip--acceso-oferta,.panel-chip--acceso-inactivo");
          return c ? getComputedStyle(c).color : "-";
        }),
        alturas: filas.map((f) => Math.round(f.getBoundingClientRect().height)),
        desborde: document.documentElement.scrollWidth > window.innerWidth,
      };
    });

    console.log("  " + w + "px  HTTP " + r.status() + "  filas: " + d.nFilas + "  aplicaciones: " + d.apps + "  desborde: " + d.desborde);
    for (let i = 0; i < d.nFilas; i++) {
      console.log("      chips  : " + d.chips[i]);
      console.log("      datos  : " + (d.datos[i] || "(ninguno)"));
      console.log("      franja : " + d.franja[i].slice(0, 30) + "   chip acceso: " + d.colorChip[i].slice(0, 24) + "   alto: " + d.alturas[i] + "px");
    }
    if (errs.length) console.log("      ERRORES: " + errs.join(" | "));
    await p.screenshot({ path: "capturas/srv-" + w + ".png", fullPage: true });
    await ctx.close();
  }

  await b.close();
  await db.from("sessions").delete().eq("user_id", u.id);
  process.exit(0);
})();