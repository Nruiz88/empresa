/* ¿Qué campo acepta Coolify para quitar dominios?
   ─────────────────────────────────────────────────────────────
   `fqdn` no se puede cambiar por API: HTTP 422, "This field is not
   allowed". Y los endpoints /domains y /fqdn dan 404.

   Se prueban los nombres plausibles, uno por uno, con una lista vacía.
   Un PATCH con `[]` no cambia nada aunque sea aceptado: es una prueba
   de qué campo existe, no un borrado. */
const fs = require("fs");
const path = require("path");

const E = fs.readFileSync(path.join(__dirname, "..", ".env.coolify"), "utf8");
const l = (k) => {
  const m = E.match(new RegExp("^" + k + "\\s*=\\s*(.+)$", "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
};

const BASE = l("COOLIFY_URL") || l("COOLIFY_BASE");
const T = l("COOLIFY_TOKEN");
const APP = "qdzppwwo50bs7bx3fnvfbvst";

const CAMPOS = [
  "custom_domains",
  "domains",
  "fqdns",
  "fqdn",
  "primary_domain",
  "service_name",
  "docker_registry_image_name",
];

(async () => {
  console.log("\n═══ ¿Qué campo acepta Coolify? ═══\n");

  for (const campo of CAMPOS) {
    let r;
    try {
      r = await fetch(BASE.replace(/\/$/, "") + "/api/v1/applications/" + APP, {
        method: "PATCH",
        headers: { Authorization: "Bearer " + T, "Content-Type": "application/json" },
        body: JSON.stringify({ [campo]: [] }),
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      console.log("  " + campo.padEnd(28) + "no respondió");
      continue;
    }

    const t = await r.text();
    const limpio = t.replace(/\s+/g, " ").slice(0, 130);

    console.log("  " + (r.status === 200 ? "✓" : "·") + " " + campo.padEnd(28) +
      "HTTP " + r.status + "  " + limpio);
  }

  console.log("");
  console.log("  Un 422 con «not allowed» quiere decir que ese campo no se puede");
  console.log("  tocar por API. Un 200 quiere decir que se acepta.\n");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});