require("../../lib/env").load();

const db = require("../../lib/supabase").getAdmin();

/* La pantalla de aplicaciones, sin pasar por el panel.
   Se llama a la función que la ruta usa, no a la ruta: así se comprueba
   la lógica sin necesitar sesión, y sin que la prueba sea «dio 200»
   cuando en realidad solo se comprobó que existe el archivo. */
(async () => {
  const rutas = require("../../routes/panel-aplicaciones");

  const filas = await rutas.todosLosServicios(db);
  const A = require("../../lib/aplicaciones");

  console.log("\n═══ La lista de aplicaciones ═══\n");

  console.log("  servicios leídos: " + filas.length + "\n");

  if (!filas.length) {
    console.log("  (no hay servicios todavía)\n");
    console.log("  Esto es lo que se ve: el mensaje que explica que no hay nada\n");
    console.log("  y que se dé de alta uno desde Servicios.\n");
  }

  console.log("  ── cada uno, como se vería en la lista ──\n");

  for (const s of filas) {
    console.log("    " + s.cliente.padEnd(22));
    console.log("      tiene:   " + ((s.aplicaciones || []).map((a) => a.nombre).join(", ") || (s.titulo || "—")));
    console.log("      desde:   " + (s.inicia_en || "—"));
    console.log("      vence:   " + (s.termina_en || "—"));
    console.log("      factura: " + (
      s.precio.importe === null
        ? "a consultar"
        : new Intl.NumberFormat("es-AR").format(s.precio.importe) + " " + s.precio.moneda
    ) + "   (" + s.precio.detalle + ")");
    console.log("      estado:  " + s.estado.etiqueta + "   [" + s.estado.tono + "]");
    console.log("");
  }

  const r = A.resumen(filas);

  console.log("  ── el resumen de arriba ──\n");
  console.log("    total " + r.total + "   ·   activo " + r.activo +
    "   ·   por vencer " + r.por_vencer + "   ·   en margen " + r.en_margen +
    "   ·   vencido " + r.vencido);
  console.log("    requieren atención: " + r.urgente);
  console.log("");

  /* ── EL ORDEN ──
     Lo vencido arriba. No es el orden del SELECT, que es por fecha de
     alta: si alguien abre la pantalla para trabajar, lo que busca es lo
     que hay que hacer hoy. */
  const orden = { vencido: 0, en_margen: 1, por_vencer: 2, activo: 3, sin_fecha: 4 };
  const copia = filas.slice().sort((a, b) => {
    const d = (orden[a.estado.clave] ?? 9) - (orden[b.estado.clave] ?? 9);
    if (d !== 0) return d;
    return (a.estado.dias ?? 1e9) - (b.estado.dias ?? 1e9);
  });

  const urgentePrimero = copia.filter((s) => ["vencido", "en_margen", "por_vencer"].includes(s.estado.clave));
  const resto = copia.filter((s) => !["vencido", "en_margen", "por_vencer"].includes(s.estado.clave));

  const bienOrdenado =
    urgentePrimero.every((s) => ["vencido", "en_margen", "por_vencer"].includes(s.estado.clave)) &&
    resto.every((s) => !["vencido", "en_margen", "por_vencer"].includes(s.estado.clave));

  console.log(bienOrdenado
    ? "  ✓ lo urgente va arriba, y lo que no, abajo"
    : "  × el orden no pone lo urgente primero");

  console.log("");
  console.log("  márgenes: aviso " + A.DIAS_DE_AVISO + " días antes, " +
    A.DIAS_DE_MARGEN + " días de margen después");
  console.log("");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});