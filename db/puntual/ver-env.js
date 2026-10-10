const fs = require("fs");

/* ═══════════════════════════════════════════════════════════════
   POR QUÉ LA CAPTURA NO ARRANCA

   `ver-panel.mjs` lee el `.env` con su propio lector y se pasa a
   Supabase. El error es `supabaseUrl is required`, que significa que
   llegó vacío.

   Esto mira si de verdad está vacío o si el lector lo está cortando.
   ═══════════════════════════════════════════════════════════════ */

const NL = String.fromCharCode(10);

const s = {};
for (const l of fs.readFileSync("D:/webs/empresa/.env", "utf8").split(NL)) {
  const t = l.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i > 0) {
    s[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}

console.log("\n═══ Lo que hay en el .env ═══\n");
console.log("  claves leídas: " + Object.keys(s).length + "\n");

for (const k of ["SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_PUBLISHABLE_KEY"]) {
  const v = s[k];
  console.log(
    "  " + k.padEnd(28) +
    (v === undefined ? "NO ESTÁ" : v.length + " caracteres   " + v.slice(0, 24))
  );
}

console.log("");
console.log("  ── todas las claves ──");
for (const k of Object.keys(s).sort()) {
  console.log("    " + k);
}
console.log("");