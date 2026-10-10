/* Pruebas de lib/cobros-mensuales.js: qué cobros crearía el
   generador y cuáles dejaría fuera, y POR QUÉ.

   Es la parte donde un error sale caro de verdad: si el plan dice que
   crea 0 y crea 8, el cliente recibe facturas que no son suyas; si
   crea 8 y crea 0, se te olvidan doce mantenimientos al año. */

const cm = require("../../lib/cobros-mensuales");

const HOY = new Date(2026, 9, 2); // 2 oct 2026
let fallos = 0;
const ok = (c, n, extra) => {
  console.log(`  ${c ? "✓" : "✗"} ${n}${extra ? "  → " + extra : ""}`);
  if (!c) fallos++;
};

const activo = (extra) => ({
  id: "s1",
  titulo: "Mantenimiento",
  importe: 120,
  moneda: "EUR",
  periodicidad: "mensual",
  estado: "activo",
  clients: { empresa: "Acme" },
  ...extra,
});

const cobro = (extra) => ({
  service_id: "s1",
  periodo: "2026-09",
  estado: "pendiente",
  importe: 120,
  ...extra,
});

console.log("\n── periodo ──");

ok(cm.periodoValido("2026-10"), "2026-10 es válido");
ok(!cm.periodoValido("2026-13"), "2026-13 no vale: no hay mes 13");
ok(!cm.periodoValido("2026-00"), "2026-00 no vale");
ok(!cm.periodoValido("octubre"), "no vale un nombre de mes");
ok(!cm.periodoValido(""), "periodo vacío no vale");
ok(cm.periodoActual(HOY) === "2026-10", "el periodo actual es 2026-10", cm.periodoActual(HOY));
ok(cm.periodoActual(new Date(2026, 0, 5)) === "2026-01", "enero con cero a la izquierda");
ok(cm.periodosAnteriores(HOY, 3).join() === "2026-09,2026-08,2026-07", "periodos anteriores hacia atrás",
  cm.periodosAnteriores(HOY, 3).join());
/* Cruzar de año: diciembre atrás es noviembre del año anterior. */
ok(cm.periodosAnteriores(new Date(2026, 0, 15), 2).join() === "2025-12,2025-11", "cruza el año bien",
  cm.periodosAnteriores(new Date(2026, 0, 15), 2).join());

console.log("\n── el plazo de pago ──");

/* El plazo son 20 días contados desde la EMISIÓN, no el día 20 del
   mes. Esto es lo que se decidió: "20 días de plazo" significa 20
   días desde que se le manda la factura. */
ok(cm.DIAS_VENCIMIENTO === 20, "el plazo es de 20 días", String(cm.DIAS_VENCIMIENTO));

ok(cm.fechaVence(new Date(2026, 9, 2)) === "2026-10-22",
  "emitido el 2 oct vence el 22 oct (2 + 20 días)", cm.fechaVence(new Date(2026, 9, 2)));

ok(cm.fechaVence(new Date(2026, 9, 11)) === "2026-10-31",
  "emitido el 11 oct vence el 31 oct, cruza de mes bien", cm.fechaVence(new Date(2026, 9, 11)));

ok(cm.fechaVence(new Date(2026, 11, 20)) === "2027-01-09",
  "emitido el 20 dic vence el 9 ene, cruza de año bien", cm.fechaVence(new Date(2026, 11, 20)));

/* El fallo que motivó cambiar el criterio: generar tarde. Con el
   día fijo del mes, los cobros de octubre emitidos en noviembre ya
   nacían vencidos y el cliente quedaba bloqueado sin margen. */
ok(cm.fechaVence(new Date(2026, 10, 3)) === "2026-11-23",
  "emitido tarde (3 nov) vence 20 días después, no ya vencido",
  cm.fechaVence(new Date(2026, 10, 3)));

ok(new Date(cm.fechaVence(new Date(2026, 10, 3))) > new Date(2026, 10, 3),
  "el vencimiento SIEMPRE cae después de la emisión");

/* El plan usa la fecha que se le pasa como emisión. */
let p = cm.plan("2026-10", [activo()], [], new Date(2026, 10, 3));
ok(p.crear[0].vence_en === "2026-11-23",
  "el plan vence a 20 días de la emisión que se le pasó", p.crear[0].vence_en);

/* La emisión es hoy, entonces hoy no está vencido ni bloquea. */
ok(cm.plan("2026-10", [activo()], [], new Date(2026, 9, 2)).bloqueados.length === 0,
  "un cobro emitido hoy no bloquea el plan");

console.log("\n── estaVencido: el día del vencimiento cuenta entero ──");

/* El día de la fecha límite todavía se puede pagar. Esto no es un
   detalle: bloqueando el mismo día, el cliente pierde medio día (o
   el día entero) de un plazo que se le acaba de dar. */
const limite = cm.fechaVence(HOY);
ok(!cm.estaVencido(cobro({ vence_en: limite }), HOY),
  "el día del vencimiento NO está vencido todavía");

/* Y al día siguiente, ya. OJO: el "hoy" de referencia es el del
   límite, no el HOY del principio del fichero; comparar contra el 2
   de octubre no probaría nada, porque el 21 de octubre aún no ha
   llegado. */
const manana = new Date(2026, 9, 23);
ok(cm.estaVencido(cobro({ vence_en: limite }), manana),
  "al día siguiente sí está vencido");
ok(cm.estaVencido(cobro({ estado: "impagado", vence_en: limite }), HOY),
  "marcado impagado bloquea aunque no haya pasado la fecha");
ok(!cm.estaVencido(cobro({ estado: "pagado", vence_en: "2026-01-01" }), HOY),
  "un cobro pagado no está vencido nunca, por muy antigua que sea la fecha");
ok(!cm.estaVencido(cobro({ estado: "anulado", vence_en: "2026-01-01" }), HOY),
  "un cobro anulado tampoco");
ok(!cm.estaVencido(cobro({ vence_en: null }), HOY),
  "sin fecha de vencimiento no se inventa que venció");

console.log("\n── lo que crea ──");

p = cm.plan("2026-10", [activo()], [], HOY);
ok(p.total === 1, "un mantenimiento activo con importe se cobra");
ok(p.crear[0].importe === 120, "copia el importe del servicio");
ok(p.crear[0].periodo === "2026-10", "con el periodo pedido");
ok(p.crear[0].concepto.includes("2026-10"), "el concepto dice el periodo", p.crear[0].concepto);
ok(p.crear[0].vence_en === cm.fechaVence(HOY),
  "vence a 20 días de la emisión", p.crear[0].vence_en);
ok(p.importe === 120, "suma el importe total");

/* Trimestral y anual también: la periodicidad manda, no el tipo. */
for (const per of ["trimestral", "anual"]) {
  ok(cm.plan("2026-10", [activo({ periodicidad: per })], [], HOY).total === 1, per + " también se renueva");
}

console.log("\n── lo que NO crea ──");

/* Sin periodicidad no hay nada que renovar. */
p = cm.plan("2026-10", [activo({ periodicidad: "" })], [], HOY);
ok(p.total === 0 && p.saltar.length === 1, "sin periodicidad no se cobra");
ok(p.saltar[0].motivo.includes("se renueve"), "y lo explica", p.saltar[0].motivo);

/* Pago único. */
p = cm.plan("2026-10", [activo({ periodicidad: "unica" })], [], HOY);
ok(p.total === 0, "un pago único no se renueva");

/* Estados que no se cobran. */
for (const [est, motivo] of [["pausado", "pausado"], ["cancelado", "cancelado"], ["finalizado", "finalizado"], ["en_curso", "curso"]]) {
  p = cm.plan("2026-10", [activo({ estado: est })], [], HOY);
  ok(p.total === 0, "estado " + est + " no se cobra");
  ok(p.saltar[0].motivo.includes(motivo), "y lo explica: " + p.saltar[0].motivo);
}

/* Importe cero o nulo. */
ok(cm.plan("2026-10", [activo({ importe: 0 })], [], HOY).total === 0, "importe 0 no genera cobro");
ok(cm.plan("2026-10", [activo({ importe: null })], [], HOY).total === 0, "importe nulo no genera cobro");

console.log("\n── no duplica ──");

/* El caso que hace seguro darle al botón dos veces. */
p = cm.plan("2026-10", [activo()], [cobro({ periodo: "2026-10" })], HOY);
ok(p.total === 0, "si ya tiene cobro de ese periodo, no crea otro");
ok(p.saltar[0].motivo.includes("ya tiene cobro"), "y lo dice", p.saltar[0].motivo);

/* Cobro de otro mes no estorba. */
ok(cm.plan("2026-10", [activo()], [cobro({ periodo: "2026-09" })], HOY).total === 1, "cobro de otro mes no estorba");

/* Dos servicios distintos: cada uno el suyo. */
p = cm.plan("2026-10", [activo({ id: "s1" }), activo({ id: "s2" })], [cobro({ service_id: "s1", periodo: "2026-10" })], HOY);
ok(p.total === 1 && p.crear[0].service_id === "s2", "crea solo el que falta");

console.log("\n── no factura a quien ya debe ──");

p = cm.plan("2026-10", [activo()], [cobro({ periodo: "2026-09", estado: "impagado" })], HOY);
ok(p.total === 0, "con un cobro impagado no genera otro");
ok(p.bloqueados.length === 1, "lo avisa en vez de callar");
ok(p.bloqueados[0].motivo.includes("vencido"), "diciendo por qué", p.bloqueados[0].motivo);

/* Vencido por fecha, sin marcar como impagado. */
p = cm.plan("2026-10", [activo()], [cobro({ periodo: "2026-09", vence_en: "2026-09-20" })], HOY);
ok(p.total === 0 && p.bloqueados.length === 1, "cobro pendiente ya pasado de fecha también bloquea");

/* Pendiente que aún no vence NO bloquea: se sigue facturando. */
p = cm.plan("2026-10", [activo()], [cobro({ periodo: "2026-09", vence_en: "2026-11-20" })], HOY);
ok(p.total === 1, "pendiente sin vencer no bloquea el mes siguiente");

/* Pagado o anulado no bloquean. */
ok(cm.plan("2026-10", [activo()], [cobro({ estado: "pagado" })], HOY).total === 1, "un cobro pagado no bloquea");
ok(cm.plan("2026-10", [activo()], [cobro({ estado: "anulado" })], HOY).total === 1, "un cobro anulado no bloquea");

console.log("\n── casos límite ──");

ok(cm.plan("2026-10", [], [], HOY).total === 0, "sin servicios no inventa nada");
ok(cm.plan("2026-10", null, null, HOY).total === 0, "sin lista de servicios no revienta");
ok(cm.plan("", [activo()], [], HOY).total === 0, "periodo inválido no crea nada");
ok(cm.plan("basura", [activo()], [], HOY).total === 0, "periodo basura no crea nada");

/* El plan tiene que devolver filas insertables. */
p = cm.plan("2026-10", [activo()], [], HOY);
const filas = cm.aFilas(p);
ok(filas.length === 1, "aFilas devuelve una fila por cobro");
ok(filas[0].estado === "pendiente", "nace pendiente, no pagado");
ok(filas[0].emitido_en === null, "la fecha de emisión la pone quien lo inserta");
ok(!("service_id" in filas[0] && !filas[0].service_id), "cada fila lleva su service_id");
ok(cm.aFilas({ crear: [] }).length === 0, "aFilas con plan vacío no devuelve nada");

console.log(fallos ? `\n  ${fallos} fallo(s)\n` : "\n  Todo correcto\n");
process.exit(fallos ? 1 : 0);
