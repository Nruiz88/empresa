const P = "https://empresa.panel-niconqn.duckdns.org";

/* Login con la cookie de CSRF, que es lo que hace un navegador. Sin
   ella el panel responde "la sesión del formulario caducó" y no se llega
   ni al insert. */

const cookies = new Map();
const guardar = (r) => {
  for (const cruda of r.headers.getSetCookie?.() || []) {
    const par = cruda.split(";")[0];
    const eq = par.indexOf("=");
    if (eq > 0) cookies.set(par.slice(0, eq), par.slice(eq + 1));
  }
};
const cabecera = () => [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

(async () => {
  let r = await fetch(P + "/panel/login", { redirect: "manual" });
  guardar(r);
  const csrf = ((await r.text()).match(/name="_csrf" value="([^"]+)"/) || [])[1] || "";
  console.log("  GET   " + r.status + "   csrf=" + (csrf ? "sí" : "NO"));

  r = await fetch(P + "/panel/login", {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cabecera() },
    body: new URLSearchParams({
      email: process.env.TEST_EMAIL || "cliente@ejemplo.com",
      password: process.env.TEST_PASSWORD || "ClienteDemo123",
      _csrf: csrf,
    }).toString(),
  });

  const nombres = (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0].split("=")[0]);
  console.log("  POST  " + r.status + "   cookies: " + (nombres.join(", ") || "(ninguna)"));

  const cuerpo = await r.text();
  const alerta = (cuerpo.match(/panel-alert[^>]*>([\s\S]*?)<\/div>/) || [])[1];
  if (alerta) console.log("  aviso: " + alerta.replace(/<[^>]+>/g, "").trim());

  process.exit(0);
})();