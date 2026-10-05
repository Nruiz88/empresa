const { calcular, proximos } = require("../lib/vencimientos");

const HOY = new Date(2026, 9, 2); // 2 oct 2026, fijo
let fallos = 0;
const ok = (c, n, extra) => {
  console.log(`  ${c ? "✓" : "✗"} ${n}${extra ? "  → " + extra : ""}`);
  if (!c) fallos++;
};

console.log("\n── calculate ──");

// Mantenimiento mensual que caduca en 5 días
let r = calcular(
  { periodicidad: "mensual", inicia_en: "2026-01-01", termina_en: "2026-10-07" },
  HOY
);
ok(r.dias === 5 && r.nivel === "urgente", "mensual caduca en 5 días → urgente", r.texto);

// Vencido: terminó la semana pasada
r = calcular({ periodicidad: "mensual", inicia_en: "2026-01-01", termina_en: "2026-09-25" }, HOY);
ok(r.nivel === "vencido" && r.dias === -7, "caducado hace 7 días → vencido", r.texto);

// Renovación: termina en oct, se renueva en nov (30 días)
r = calcular({ periodicidad: "mensual", inicia_en: "2026-01-01", termina_en: "2026-10-20" }, HOY);
ok(
  r.proxima.getFullYear() === 2026 && r.proxima.getMonth() === 10,
  "mensual renueva un periodo después",
  r.texto
);

// Trimestral = 3 meses naturales, no 91 días
r = calcular({ periodicidad: "trimestral", inicia_en: "2026-01-01", termina_en: "2026-10-01" }, HOY);
ok(
  r.proxima.getMonth() === 0 && r.proxima.getFullYear() === 2027,
  "trimestral avanza 3 meses naturales",
  r.texto
);

// Sin termina_en pero recurrente: hosting mensual.
// No se inventa la última cuota: se proyecta desde hoy y se marca
// como pendiente de confirmar.
r = calcular({ periodicidad: "mensual", inicia_en: "2026-09-02" }, HOY);
ok(
  r.proxima && r.proxima.getMonth() === 10 && r.proxima.getDate() === 2,
  "recurrente sin fin proyecta un periodo desde hoy",
  r.texto
);
ok(r.nivel === "pendiente", "y se marca como pendiente de confirmar");

// El caso que rompe los cálculos ingenuos: día 31 → mes corto.
// Un cliente que paga el 31 de enero no puede renovar el 3 de marzo.
const { sumarMeses } = require("../lib/vencimientos");
ok(
  sumarMeses(new Date(2026, 0, 31), 1).getMonth() === 1 &&
    sumarMeses(new Date(2026, 0, 31), 1).getDate() === 28,
  "31 ene + 1 mes cae el 28 de feb, no en marzo",
  sumarMeses(new Date(2026, 0, 31), 1).toDateString()
);
ok(
  sumarMeses(new Date(2026, 0, 15), 1).getDate() === 15,
  "un día que existe en ambos meses se conserva"
);
ok(
  sumarMeses(new Date(2026, 9, 2), 1).getDate() === 2 &&
    sumarMeses(new Date(2026, 9, 2), 1).getMonth() === 10,
  "2 oct + 1 mes = 2 nov (octubre tiene 31 días)"
);
ok(
  sumarMeses(new Date(2026, 0, 31), 3).getMonth() === 3 &&
    sumarMeses(new Date(2026, 0, 31), 3).getDate() === 30,
  "+3 meses desde el 31 ene cae el 30 abr (abril no tiene 31)",
  sumarMeses(new Date(2026, 0, 31), 3).toDateString()
);

// Pago único no se renueva
r = calcular({ periodicidad: "unica", inicia_en: "2026-01-01", termina_en: "2026-10-10" }, HOY);
ok(r.proxima === null, "pago único no genera renovación", r.texto);

// Sin periodicidad ni fechas: nada que avisar
r = calcular({ periodicidad: "", inicia_en: null, termina_en: null }, HOY);
ok(r.texto === "" && r.nivel === "nada", "sin datos no inventa avisos");

// Fecha final anterior a la inicial: la BD lo impide, pero no debe romperse
r = calcular({ periodicidad: "mensual", inicia_en: "2026-06-01", termina_en: "2026-01-01" }, HOY);
ok(typeof r.texto === "string", "fechas incoherentes no rompen nada");

console.log("\n── proximos ──");

const lista = proximos(
  [
    { id: 1, titulo: "Hosting", estado: "activo", periodicidad: "mensual", inicia_en: "2026-09-02", importe: 89, clients: { empresa: "Acme" } },
    { id: 2, titulo: "Caducado", estado: "activo", periodicidad: "mensual", inicia_en: "2026-01-01", termina_en: "2026-09-20", clients: { empresa: "Beta" } },
    { id: 3, titulo: "Largo plazo", estado: "activo", periodicidad: "anual", inicia_en: "2026-01-01", termina_en: "2028-01-01", clients: { empresa: "Gamma" } },
    { id: 4, titulo: "Cancelado", estado: "cancelado", periodicidad: "mensual", inicia_en: "2026-01-01", termina_en: "2026-10-01", clients: { empresa: "Delta" } },
    { id: 5, titulo: "Sin fecha", estado: "activo", periodicidad: "", inicia_en: null, termina_en: null, clients: { empresa: "Epsilon" } },
  ],
  HOY
);

ok(lista.length === 2, "solo avisa de 2 de 5 servicios", `entraron: ${lista.map((x) => x.titulo).join(", ")}`);
ok(lista[0] && lista[0].titulo === "Caducado", "el vencido va primero");
ok(lista.some((x) => x.titulo === "Hosting"), "incluye el recurrente sin fecha de fin");
ok(!lista.some((x) => x.titulo === "Largo plazo"), "descarta lo que caduca en 2028");
ok(!lista.some((x) => x.titulo === "Cancelado"), "ignora servicios cancelados");
ok(!lista.some((x) => x.titulo === "Sin fecha"), "ignora lo que no tiene fecha");

// Sin datos no revienta
ok(proximos(null, HOY).length === 0 && proximos([], HOY).length === 0, "aguanta lista vacía");

console.log(fallos ? `\n  ${fallos} fallo(s)\n` : "\n  Todo correcto\n");
process.exit(fallos ? 1 : 0);
