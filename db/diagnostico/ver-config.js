require("../../lib/env").load();
const db = require("../../lib/supabase").getAdmin();

/* Imprime, de lo que hay, qué está en Supabase y qué es variable de
   entorno. Es la pregunta que más se repite al desplegar, y tener la
   respuesta a mano evita medio rato de buscarlo en el código. */

const EN_SUPABASE = {
  "Cajas (evolution_servers)": "nombre, url, clave, plan, cupos, activa, notas, secreto del webhook y URL del webhook",
  "Bots (bots)": "cliente, caja, nombre, instancia, slug, estado y cuándo se comprobó",
  "Sesiones": "las del panel, las del bot y las de cada cliente",
  "Clientes, servicios, cobros, tickets, leads, catálogo": "todo lo de gestión",
  "Auditoría": "qué hizo el equipo y desde qué IP",
};

const EN_EL_ENTORNO = {
  SITE_URL: "el dominio de la web. De ahí se deducen panel y bot",
  PANEL_URL: "el dominio del panel, si es distinto del deducido",
  BOT_URL: "el dominio del bot, SOLO si no es bot.<dominio>",
  SESSION_SECRET: "firma de la cookie del panel",
  SERVICE_SECRET: "firma de los tickets entre servicios",
  BOT_WEBHOOK_SECRET: "NO: el secreto del webhook se guarda en cada caja (ver más abajo)",
  WEBHOOK_SECRET: "solo en el servicio del bot (wweb), tiene que coincidir con el de la caja",
  NODE_ENV: "production activa las cookies Secure",
  PORT: "puerto de escucha",
};

(async () => {
  console.log("\n═══ Qué está en Supabase y qué no ═══\n");

  const { data: cajas, error } = await db.from("evolution_servers").select("*");
  if (error) {
    console.log("  ✗ no se pudieron leer las cajas: " + error.message + "\n");
    process.exitCode = 1;
    return;
  }

  console.log("  ── Supabase (se cambia desde el panel) ──\n");
  for (const [que, como] of Object.entries(EN_SUPABASE)) {
    console.log("    " + que);
    console.log("      " + como);
  }

  console.log("\n  ── Variables de entorno (se cambian en Coolify, no en el panel) ──\n");
  for (const [que, para] of Object.entries(EN_EL_ENTORNO)) {
    console.log("    " + que.padEnd(20) + para);
  }

  console.log("\n  ── Las cajas, ahora mismo ──\n");
  for (const c of cajas) {
    console.log("    " + c.name);
    console.log("      url                " + c.url);
    console.log("      clave               " + (c.api_key ? c.api_key.length + " caracteres" : "—"));
    console.log("      plan                " + (c.plan || "(sin decir)"));
    console.log("      cupos               " + c.max_instances + (c.activo ? "" : "  (desactivada)"));
    console.log("      secreto webhook     " + (c.webhook_secret ? "puesto" : "FALTA"));
    console.log("      url del webhook     " + (c.webhook_url || "(la deducida del dominio)"));
  }

  /* Sin `process.exit()`: el cliente de Supabase deja conexiones
     keep-alive y matarlo en mitad deja el handle a medias, que en
     Windows revienta con "Assertion failed: !(handle->flags &
     UV_HANDLE_CLOSING)". Salir con exitCode y dejar que el bucle
     termine es lo que hacen los demás scripts de esta carpeta. */
  process.exitCode = 0;
})();