/* Convertir los cobros en euros a pesos.
   ─────────────────────────────────────────────────────────────
   Tipo de cambio: 1 EUR = 1.807 ARS, indicado por quien lleva el
   negocio. No se saca de la base porque no hay ninguno guardado, y no
   se busca en internet porque una factura se convierte con la tasa que
   dice quien la firma.

   ── LO QUE HACE, Y LO QUE NO ──

   Convierte el importe y cambia la moneda a ARS. NO toca:

     · la fecha de emisión. La factura se emitió en euros, y la fecha
       no cambia porque el número cambie.
     · el estado. Un cobro pagado sigue pagado.
     · el concepto. Sigue diciendo lo que decía.

   Y anota el cambio en `notas`, que es donde se puede ver después que
   ese número vino de una conversión. Un importe sin rastro es un
   importe en el que nadie confía.

   ── EL REDONDEO ──

   A dos decimales, porque el importe es `numeric` con decimales y un
   importe con muchos decimales es ruido. El redondeo se hace UNA vez
   al final, no en cada multiplicación: redondear 8 veces acumula
   diferencia.

   ── LO QUE NO SE TOCA ──

   Los cobros pagados se convierten igual, y eso hay que decirlo: el
   importe que figura deja de ser el que realmente se cobró. Se hizo
   porque se pidió, y queda anotado en cada fila para que se entienda
   al mirarlo dentro de seis meses. */
require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

/* El tipo de cambio. Va aquí arriba, a la vista, y no escondido en una
   función: es el número de un acuerdo comercial, y tiene que poder
   leerse sin ejecutar nada. */
const TIPO_DE_CAMBIO = 1807;

const APLICAR = process.argv.includes("--aplicar");

(async () => {
  console.log("\n═══ Euros a pesos ═══\n");
  console.log("  tipo de cambio:  1 EUR = " + TIPO_DE_CAMBIO + " ARS\n");

  const { data: cobros, error } = await db.rpc("ejecutar_sql", {
    consulta:
      "select id, concepto, importe, estado, emitido_en, pagado_en, notas " +
      "from cobros where moneda = 'EUR' order by emitido_en, concepto",
    args: [],
  });

  if (error) {
    console.log("  x no se pudieron leer: " + error.message + "\n");
    process.exit(1);
  }

  if (!cobros || !cobros.length) {
    console.log("  No queda ningún cobro en euros.\n");
    return;
  }

  console.log("  ── lo que hay ahora, y lo que quedaría ──\n");

  let totalEur = 0;
  let totalArs = 0;

  const plan = cobros.map((c) => {
    const eur = Number(c.importe);
    totalEur += eur;
    const ars = Math.round(eur * TIPO_DE_CAMBIO * 100) / 100;
    totalArs += ars;

    return {
      id: c.id,
      concepto: c.concepto,
      estado: c.estado,
      emitido: String(c.emitido_en || "").slice(0, 10),
      pagado: c.pagado_en ? String(c.pagado_en).slice(0, 10) : null,
      eur,
      ars,
      notas: c.notas || "",
    };
  });

  for (const p of plan) {
    console.log(
      "  " + p.emitido + "  " +
      String(p.eur).padStart(9) + " EUR  →  " +
      String(p.ars).padStart(12) + " ARS   " +
      p.estado.padEnd(9) +
      (p.pagado ? "pagado el " + p.pagado : "")
    );
    console.log("            " + String(p.concepto).slice(0, 58));
  }

  console.log("");
  console.log("  ──────────────────────────────────────────────");
  console.log("  total:  " + totalEur + " EUR  →  " + totalArs + " ARS");
  console.log("");

  const pagados = plan.filter((p) => p.estado === "pagado").length;

  if (pagados) {
    console.log("  ⚠ " + pagados + " de " + plan.length + " ya estaban PAGADOS.\n");
    console.log("    Al convertirlos, el importe que figura deja de ser el que se");
    console.log("    cobró de verdad. Se hace porque se pidió, y queda anotado en");
    console.log("    cada fila para que se entienda al mirarlo después.\n");
    console.log("    La alternativa era dejarlos en euros como histórico, que es lo");
    console.log("    que corresponde a una factura ya cobrada.\n");
  }

  if (!APLICAR) {
    console.log("  Esto es lo que se haría. Para aplicarlo de verdad:");
    console.log("    node db/convertir-cobros-eur.js --aplicar\n");
    return;
  }

  /* ── Aplicar ── */
  console.log("  aplicando...\n");

  let ok = 0;
  let fallos = [];

  for (const p of plan) {
    /* La nota dice de dónde salió el número. Sin eso, dentro de seis
       meses el importe es un número sin origen y no hay forma de saber
       que fue una conversión. */
    const marca = TIPO_DE_CAMBIO + " ARS/EUR";

    /* No se duplica la nota si se corre dos veces. */
    let nota = p.notas.trim();
    if (!nota.includes(marca)) {
      nota = (nota ? nota + " " : "") +
        "[Convertido de " + p.eur + " EUR a " + p.ars + " ARS a " + marca + "]";
    }

    /* Por el cliente de servicio, no por el RPC.

       `ejecutar_sql` solo admite SELECT, y eso es lo que debe: es lo que
       impide que un script con una consulta mal escrita vacíe una tabla.
       Para escribir hay que pasar por el cliente, que es quien sabe qué
       se puede tocar.

       La primera versión lo hizo por el RPC y falló las ocho filas. Un
       fallo limpio —no cambió nada—, pero del que no se habría enterado
       nadie si el script no imprimiera el error en vez de seguir. */
    const { error: e } = await db
      .from("cobros")
      .update({ importe: p.ars, moneda: "ARS", notas: nota })
      .eq("id", p.id);

    if (e) {
      fallos.push(p.concepto + ": " + e.message.split("\n")[0]);
      continue;
    }
    ok++;
    console.log("  ✓ " + String(p.eur).padStart(9) + " EUR → " + String(p.ars).padStart(12) + " ARS");
  }

  console.log("");
  console.log("  convertidos: " + ok + " de " + plan.length);

  if (fallos.length) {
    console.log("  fallos:");
    fallos.forEach((f) => console.log("    " + f));
  }

  /* ── Verificar ── */
  console.log("");
  console.log("  ── comprobación ──");

  const { data: quedan } = await db.rpc("ejecutar_sql", {
    consulta: "select count(*) as c from cobros where moneda = 'EUR'",
    args: [],
  });

  const { data: desglose } = await db.rpc("ejecutar_sql", {
    consulta: "select moneda, count(*) as c, sum(importe) as total from cobros group by moneda",
    args: [],
  });

  console.log("  cobros que quedan en euros: " + (quedan && quedan[0] ? quedan[0].c : 0));
  console.log("");
  console.log("  por moneda ahora:");
  (desglose || []).forEach((d) => {
    console.log("    " + String(d.moneda).padEnd(6) + String(d.c).padStart(3) + " cobros   " + Number(d.total).toLocaleString("es-AR"));
  });

  console.log("");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});