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

const PAGINAS = [
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

  const { chromium } = req("D:/webs/wweb/node_modules/playwright");
  const b = await chromium.launch();
  const ctx = await b.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    storageState: { cookies: [{ name: "nexo_panel", value: tok, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" }], origins: [] },
  });

  let fallos = 0;
  for (const url of PAGINAS) {
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
  console.log("  paginas con problema: " + fallos + " de " + PAGINAS.length);

  await b.close();
  await db.from("sessions").delete().eq("user_id", st[0].id);
  process.exit(fallos ? 1 : 0);
})();