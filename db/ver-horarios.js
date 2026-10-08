/* ¿Hay horarios libres para hoy?
   ─────────────────────────────────────────────────────────────
   El usuario escribió «turno», recibió el menú, y el «1» —que debería
   dar lo libre hoy— no trajo nada.

   Hay dos causas muy distintas y conviene no mezclarlas:

     · el bot no entendió el «1»  → estado perdido (memoria, reinicio);
     · el bot lo entendió pero no hay horarios → la consulta a la base
       devuelve nada.

   Con el primero ya se comprobó que el código funciona. Este script mira
   el segundo: qué hay en la tabla de horarios y qué devolvería hoy.

   ── POR QUÉ ES DISTINTO ──

   El estado del menú es memoria y se puede perder. Los horarios libres
   salen de la base, y la base no se reinicia con el bot. Si no hay
   horarios, es que no hay: punto. No hay nada que depurar. */
require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

/* El mismo criterio que usa el bot para "hoy": la fecha en la zona del
   negocio. Argentina va tres horas por delante de UTC, y comparar
   fechas en UTC es la forma habitual de que un turno de la mañana
   aparezca como si fuera de mañana. */
const ZONA = "America/Argentina/Buenos_Aires";

function hoyEnArgentina() {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const p = {};
  partes.forEach((x) => (p[x.type] = x.value));
  return p.year + "-" + p.month + "-" + p.day;
}

(async () => {
  const hoy = hoyEnArgentina();

  console.log("\n═══ ¿Hay horarios para hoy? ═══\n");
  console.log("  hoy, en Argentina: " + hoy);
  console.log("  hoy, en UTC:       " + new Date().toISOString().slice(0, 10) + "\n");

  /* ---- 1. Los horarios de atención ---- */
  console.log("  ── horarios de atención ──\n");

  /* ── LOS NOMBRES DE LAS COLUMNAS ──
     La primera versión de este script pidió `dia_semana`, `hora_inicio`,
     `hora_fin` y `activo`, que NO existen. La consulta devolvió error,
     el script no lo miró, yLd{l como lista vacía: «NO HAY HORARIOS DE
     ATENCIÓN configurados».

     Había siete franjas, seis activas. Era un invento mío, y de los
     feos: afirmaba que faltaba una configuración cuando lo que faltaba
     era que supiera el nombre de las columnas.

     Por eso aquí el error se mira. Una comprobación que no puede
     leer tiene que decirlo, porque si no se lee como una que miró y no
     encontró nada, que es lo contrario. */
  const { data: horarios, error: eHoras } = await db.rpc("ejecutar_sql", {
    consulta:
      "select day_of_week, start_time, end_time, is_active, slot_duration_min " +
      "from bots_business_hours order by day_of_week, start_time",
    args: [],
  });

  if (eHoras) {
    console.log("  x no se pudo leer la tabla de horarios: " + eHoras.message + "\n");
    console.log("    Esto NO es lo mismo que que no haya horarios. Una consulta");
    console.log("    que falla y una que no encuentra filas se parecen en la");
    console.log("    pantalla si no se mira el error, y significan lo contrario.\n");
    process.exit(1);
  }

  if (!horarios || !horarios.length) {
    console.log("  × NO HAY HORARIOS DE ATENCIÓN configurados.\n");
    console.log("    Con esta tabla vacía, el bot no tiene nada que ofrecer: no");
    console.log("    hay franjas de las que sacar huecos. El menú puede aparecer");
    console.log("    bien y la lista debajo, vacía, y eso es exactamente lo que ve");
    console.log("    el usuario.\n");
  } else {
    console.log("    día  desde    hasta    cada    activo");
    horarios.forEach((h) => {
      console.log(
        "    " + String(h.day_of_week).padEnd(5) +
        String(h.start_time || "?").slice(0, 5).padEnd(9) +
        String(h.end_time || "?").slice(0, 5).padEnd(9) +
        String(h.slot_duration_min == null ? "?" : h.slot_duration_min).padEnd(8) +
        String(h.is_active === undefined ? "?" : h.is_active)
      );
    });
    console.log("");
  }

  /* ---- 2. Los turnos ya reservados ---- */
  console.log("  ── turnos reservados ──\n");

  const { data: turnos } = await db.rpc("ejecutar_sql", {
    consulta:
      "select fecha, hora, estado from bots_appointments order by fecha, hora limit 20",
    args: [],
  });

  if (!turnos || !turnos.length) {
    console.log("    (ninguno)\n");
  } else {
    turnos.forEach((t) => {
      const marca = String(t.fecha).startsWith(hoy) ? "  ← es hoy" : "";
      console.log("    " + String(t.fecha).slice(0, 16) + "  " +
        String(t.hora).slice(0, 5) + "  " + (t.estado || "") + marca);
    });
    console.log("");
  }

  /* ---- 3. Qué haría el bot con esta información ---- */
  const diaSemana = new Date(hoy + "T12:00:00Z").getUTCDay();

  const delDia = (horarios || []).filter(
    (h) => Number(h.day_of_week) === diaSemana
  );

  console.log("  ──────────────────────────────────────────────\n");
  console.log("  hoy es día " + diaSemana + " de la semana.");
  console.log("  Franjas configuradas para ese día: " + delDia.length + "\n");

  if (delDia.length) {
    delDia.forEach((h) => {
      console.log("    " + String(h.start_time).slice(0, 5) + " a " + String(h.end_time).slice(0, 5) +
        (h.is_active === false ? "   (pero está INACTIVA)" : ""));
    });
    console.log("");
  }

  /* Si hay franjas pero todas inactivas, el menú sale vacío y parece un
     fallo del bot cuando lo único que pasa es que nadie las activó. */
  const algunaActiva = delDia.some((h) => h.is_active !== false);

  if (delDia.length && !algunaActiva) {
    console.log("  · Hay franjas para hoy pero NINGUNA está activa.\n");
    console.log("    El menú puede aparecer y la lista salir vacía. Para quien");
    console.log("    escribe es indistinguible de que el bot esté roto, y no lo");
    console.log("    está: los horarios simplemente no están activados.\n");
  } else if (!delDia.length) {
    console.log("  · No hay ninguna franja para el día de hoy.\n");
    console.log("    Si el panadero no atiende hoy, el bot está bien y la lista");
    console.log("    vacía es la respuesta correcta. Pero conviene que el bot lo");
    console.log("    diga, en vez de dejar un menú vacío: un cliente que escribe");
    console.log("    «turno» y no ve nada no vuelve.\n");
  }
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});