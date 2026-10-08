/* ¿La instancia está en un bucle de reconexión?
   ─────────────────────────────────────────────────────────────
   POR QUÉ ESTA SOSPECHA

   El contador de mensajes de la instancia subió de 36.347 a 81.580 en
   pocos minutos, sin que nadie escribiera. Eso no es tráfico: es la
   sesión releyéndose sola.

   Y hay una causa conocida de eso, que no es un fallo del bot: cuando
   WhatsApp sube su versión web, las sesiones Baileys viejas se
   desconectan a la fuerza. La instancia puede quedar con el estado
   «open» mientras el socket ya no sirve para nada.

   Con eso encaja todo lo que se vio:
     · el estado dice «open», y el panel de Salud lo daba en verde;
     · los mensajes llegan pero el webhook no se dispara;
     · el contador se dispara solo.

   ── QUÉ SE COMPRUEBA ──

   Si Evolution dice que la sesión está desconectada por versión, lo
   dice con un código concreto (401 / 403 / «client version out of
   date»). Si no lo dice, se mira si el estado se mueve: una instancia
   sana no cambia de estado ni sube el contador sola. */
require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

const RUTAS = [
  ["GET", "/instance/connectionState/{i}"],
  ["GET", "/instance/fetchConnectionState/{i}"],
  ["GET", "/instance/connectionState"],
  ["GET", "/manager/health"],
  ["GET", "/instance/fetchInstances"],
];

(async () => {
  const { data: srv } = await db
    .from("evolution_servers")
    .select("url, api_key")
    .limit(1)
    .single();

  const { data: bot } = await db.from("bots").select("instance_name").limit(1).single();
  const inst = encodeURIComponent(bot.instance_name);

  console.log("\n═══ ¿Está sana la instancia? ═══\n");

  /* ---- 1. Estado de conexión, por donde se pueda ---- */
  for (const [metodo, ruta] of RUTAS) {
    const real = ruta.replace("{i}", inst);
    try {
      const r = await fetch(srv.url + real, {
        headers: { apikey: srv.api_key },
        signal: AbortSignal.timeout(25000),
      });
      const t = await r.text();

      if (r.status === 404) {
        console.log("  · " + ruta.padEnd(42) + "no existe");
        continue;
      }

      console.log("  ✓ " + ruta.padEnd(42) + "HTTP " + r.status);
      console.log("    " + t.replace(/\s+/g, " ").slice(0, 260));
      console.log("");
    } catch (e) {
      console.log("  ! " + ruta.padEnd(42) + e.message.split("\n")[0]);
    }
  }

  /* ---- 2. El estado, cuatro veces seguidas ----
     Una instancia sana no cambia de estado en veinte segundos. Una que
     se está reconectando pasa por «connecting», «open», «connecting»…
     y eso se ve sin tener que interpretar nada. */
  console.log("  ── el estado, cuatro veces cada 5 s ──\n");

  let cambios = 0;
  let anterior = null;

  for (let i = 0; i < 4; i++) {
    const r = await fetch(srv.url + "/instance/fetchInstances", {
      headers: { apikey: srv.api_key },
      signal: AbortSignal.timeout(25000),
    });
    const lista = await r.json();
    const yo = (Array.isArray(lista) ? lista : []).find((x) => x.name === bot.instance_name);

    if (!yo) {
      console.log("  " + i + ": la instancia no está en la lista");
      continue;
    }

    const estado = yo.connectionStatus;
    const cuenta = yo._count?.Message;

    if (anterior !== null && estado !== anterior) cambios++;

    console.log(
      "  " + i + ":  " + String(estado).padEnd(12) +
      "  mensajes: " + String(cuenta).padStart(7) +
      (anterior !== null && cuenta !== anterior
        ? "   (subió " + (cuenta - anterior) + ")"
        : "")
    );

    anterior = cuenta;
    if (i < 3) await new Promise((x) => setTimeout(x, 5000));
  }

  console.log("");
  console.log("  cambios de estado: " + cambios);
  console.log("");

  /* ---- 3. La versión de WhatsApp que dice la caja ---- */
  const raiz = await fetch(srv.url + "/", {
    headers: { apikey: srv.api_key },
    signal: AbortSignal.timeout(25000),
  });
  const info = await raiz.json().catch(() => ({}));

  console.log("  ── versiones ──");
  console.log("    Evolution:          " + info.version);
  console.log("    WhatsApp web:       " + info.whatsappWebVersion);
  console.log("    cliente:            " + info.clientName);
  console.log("");

  console.log("  ──────────────────────────────────────────────");
  console.log("\n  Cómo leer esto:\n");
  console.log("    · estado estable y contador quieto  → la sesión está sana,");
  console.log("      y el problema es otro.");
  console.log("    · estado que oscila, o contador que sube solo  → la sesión");
  console.log("      se está reconectando. Eso es incompatible con recibir");
  console.log("      mensajes de forma fiable, y hay que reloguear la instancia.");
  console.log("    · número 401 o 403 por la sesión  → WhatsApp la cerró por");
  console.log("      versión. Reloguear con el QR y, si sigue, actualizar Evolution.\n");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});