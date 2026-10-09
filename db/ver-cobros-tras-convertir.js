require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

/* Que la conversión se pueda entender dentro de seis meses.

   Un importe sin rastro es un importe en el que nadie confía: si alguien
   ve 216.840 ARS en un cobro que era de 120 euros, tiene que poder
   saber de dónde salió ese número. Y no basta con que el script lo
   imprimiera al ejecutarse: eso desaparece con la terminal. */
(async () => {
  console.log("\n═══ Los cobros, ahora ═══\n");

  const { data, error } = await db.rpc("ejecutar_sql", {
    consulta:
      "select concepto, importe, moneda, estado, emitido_en, pagado_en, notas " +
      "from cobros order by emitido_en, concepto",
    args: [],
  });

  if (error) {
    console.log("  x " + error.message + "\n");
    process.exit(1);
  }

  for (const c of data || []) {
    console.log("  " + String(c.emitido_en).slice(0, 10) +
      "  " + String(Number(c.importe)).padStart(10) + " " + c.moneda +
      "  " + String(c.estado).padEnd(9) + "  " + String(c.concepto).slice(0, 42));

    if (c.notas) {
      console.log("      nota: " + c.notas.slice(0, 90));
    }
  }

  /* ── Las tres preguntas ── */

  const sinRastro = (data || []).filter((c) => c.moneda === "ARS" && !c.notas).length;

  const monedas = [...new Set((data || []).map((c) => c.moneda))];

  console.log("");
  console.log("  ──────────────────────────────────────────────\n");
  console.log("  monedas que quedan: " + monedas.join(", "));
  console.log("  cobros sin nota:   " + sinRastro);

  console.log("");

  if (monedas.length === 1 && monedas[0] === "ARS") {
    console.log("  ✓ Todos los cobros están en pesos. El euro no queda en ninguna\n");
    console.log("    fila de cobros: queda solo como código válido en la columna,\n");
    console.log("    para el caso de que algún cobro futuro venga de otra parte.\n");
  } else {
    console.log("  ! quedan monedas que no son ARS: " + monedas.join(", ") + "\n");
  }

  if (sinRastro) {
    console.log("  ! " + sinRastro + " cobro(s) sin la nota de conversión.\n");
  } else {
    console.log("  ✓ Todos tienen la nota de conversión, así que el importe se puede\n");
    console.log("    rastrear hasta el euro que estaba antes.\n");
  }
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});