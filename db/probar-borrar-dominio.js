/* Probar si el endpoint de borrar dominios existe, en un dominio solo. */
const fs = require("fs");
const path = require("path");

const E = fs.readFileSync(
  path.join(__dirname, "..", ".env.coolify"),
  "utf8"
);

function l(k) {
  const m = E.match(new RegExp("^" + k + "\\s*=\\s*(.+)$", "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}

const BASE = l("COOLIFY_URL") || l("COOLIFY_BASE");
const T = l("COOLIFY_TOKEN");
const APP = "qdzppwwo50bs7bx3fnvfbvst";

/* Los cinco, tal como están. */
const TODOS = [
  "https://qdzppwwo50bs7bx3fnvfbvst.panel-niconqn.duckdns.org",
  "https://bot.panel-niconqn.duckdns.org",
  "https://www.bot.panel-niconqn.duckdns.org",
  "https://bot.tucormercio.com.ar",
  "https://bot.shopcito.com.ar",
];

const sinHttps = (d) => d.replace(/^https?:\/\//, "").replace(/\/$/, "");

(async () => {
  console.log("");

  for (const ruta of [
    "/api/v1/applications/" + APP + "/domains",
    "/api/v1/applications/" + APP + "/fqdn",
  ]) {
    const r = await fetch(BASE.replace(/\/$/, "") + ruta, {
      headers: { Authorization: "Bearer " + T },
      signal: AbortSignal.timeout(30000),
    });
    console.log("  GET " + ruta + "  HTTP " + r.status);
    const t = await r.text();
    if (r.status === 200) console.log("    " + t.slice(0, 300));
  }

  console.log("");
  console.log("  ──────────────────────────────────────────────");
  console.log("");
  console.log("  Para quitar un dominio, Coolify acepta PATCH /applications/{id}");
  console.log("  con el campo fqdn entero. Se prueba con el campo puesto solo con");
  console.log("  los cuatro que sobran, dejando el bueno dentro.\n");

  const nuevos = TODOS.filter((d) => d === "https://bot.shopcito.com.ar");

  const r = await fetch(BASE.replace(/\/$/, "") + "/api/v1/applications/" + APP, {
    method: "PATCH",
    headers: {
      Authorization: "Bearer " + T,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fqdn: nuevos.join(",") }),
    signal: AbortSignal.timeout(30000),
  });

  console.log("  PATCH fqdn  HTTP " + r.status);
  const t = await r.text();
  console.log("  " + t.slice(0, 300));
  console.log("");

  /* Reler: el PATCH puede decir que fue bien y no haber cambiado nada,
     que es lo habitual en estas APIs. */
  const check = await fetch(BASE.replace(/\/$/, "") + "/api/v1/applications/" + APP, {
    headers: { Authorization: "Bearer " + T },
    signal: AbortSignal.timeout(30000),
  });
  const j = await check.json();
  console.log("  ── fqdn ahora ──");
  console.log("  " + (j.fqdn || "(vacío)"));
  console.log("");

  const quedan = String(j.fqdn || "").split(",").filter(Boolean);
  console.log("  dominios ahora: " + quedan.length);
  quedan.forEach((d) => console.log("    " + d));

  const sigue = quedan.some((d) => d.includes("bot.shopcito.com.ar"));
  console.log("");
  console.log(sigue
    ? "  ✓ bot.shopcito.com.ar sigue en pie. El bot tiene puerta."
    : "  × bot.shopcito.com.ar DESAPARECIÓ. Hay que arreglarlo ya.");
  console.log("");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});