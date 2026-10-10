/* Pruebas de lib/acceso.js: qué ve el cliente de cada servicio.
   Sin esto, un cambio en las reglas de bloqueo podría abrirle a un
   cliente el detalle de otro o dejarle sin ver su propia factura, y
   no se nota hasta que alguien reclama. */

const { accesoDe, agrupar } = require("../../lib/acceso");

const HOY = new Date(2026, 9, 2); // 2 oct 2026, fijo
let fallos = 0;
const ok = (c, n, extra) => {
  console.log(`  ${c ? "✓" : "✗"} ${n}${extra ? "  → " + extra : ""}`);
  if (!c) fallos++;
};

const svc = (extra) => ({
  id: "s1",
  kind: "mantenimiento",
  estado: "activo",
  titulo: "Mantenimiento",
  importe: 120,
  ...extra,
});

const cobro = (extra) => ({
  service_id: "s1",
  estado: "pendiente",
  importe: 120,
  descuento: 0,
  ...extra,
});

console.log("\n── activo ──");

let a = accesoDe(svc(), [], HOY);
ok(a.nivel === "activo", "al día y activo se ve entero");

a = accesoDe(svc({ estado: "en_curso" }), [], HOY);
ok(a.nivel === "activo", "en curso también es activo");

a = accesoDe(svc(), [cobro({ estado: "pagado" })], HOY);
ok(a.nivel === "activo", "con un cobro pagado se ve entero");

console.log("\n── bloqueado ──");

a = accesoDe(svc(), [cobro({ estado: "impagado", vence_en: "2026-09-20" })], HOY);
ok(a.nivel === "bloqueado", "cobro vencido bloquea");
ok(a.detalle.vencidos === 1, "cuenta los vencidos", a.motivo);

/* Lo importante: el importe SÍ sale. Sin él no puede pagar. */
ok(a.detalle.pendiente === 120, "y el importe se enseña para poder pagar");

/* El día de la fecha límite se puede pagar entero: bloqueando el
   mismo día, al cliente se le quita parte del plazo que se le acaba
   de dar. Solo se bloquea al día siguiente. */
a = accesoDe(svc(), [cobro({ estado: "pendiente", vence_en: "2026-10-02" })], HOY);
ok(a.nivel === "activo", "el día del vencimiento todavía no bloquea", a.nivel);
a = accesoDe(svc(), [cobro({ estado: "pendiente", vence_en: "2026-10-01" })], HOY);
ok(a.nivel === "bloqueado", "pasado el plazo sí bloquea", a.nivel);

a = accesoDe(svc(), [cobro({ estado: "pendiente", vence_en: "2026-10-30" })], HOY);
ok(a.nivel === "activo", "una factura que aún no vence NO bloquea");

/* Pero sí se le avisa del importe: es información, no un veto. */
ok(a.motivo.includes("factura"), "y se le avisa de la factura emitida", a.motivo);
ok(a.detalle.pendiente === 120, "con el importe a la vista");

/* Sin fecha de vencimiento tampoco se bloquea: no hay forma de
   saber si toca. */
a = accesoDe(svc(), [cobro({ estado: "pendiente", vence_en: null })], HOY);
ok(a.nivel === "activo", "un cobro sin fecha de vencimiento no bloquea");

/* Impagado bloquea aunque no tenga fecha: alguien ya lo ha dado por
   muerto y eso manda sobre cualquier plazo. */
a = accesoDe(svc(), [cobro({ estado: "impagado", vence_en: null })], HOY);
ok(a.nivel === "bloqueado", "marcado como impagado bloquea siempre");

a = accesoDe(
  svc(),
  [cobro({ estado: "pendiente", vence_en: "2026-09-01" }), cobro({ estado: "pendiente", importe: 80, vence_en: "2026-11-01" })],
  HOY
);
ok(a.nivel === "bloqueado", "vencido + pendiente = bloqueado");
/* Al bloquear, el importe es solo lo VENCIDO: lo que aún no toca no
   se suma a la deuda de ahora. */
ok(a.detalle.pendiente === 120, "la deuda que se muestra es la vencida", String(a.detalle.pendiente));

a = accesoDe(svc(), [cobro({ estado: "anulado", importe: 500 })], HOY);
ok(a.nivel === "activo", "un cobro anulado no bloquea: no debe nada");

a = accesoDe(svc(), [cobro({ estado: "pagado" }), cobro({ estado: "impagado", vence_en: "2026-09-01" })], HOY);
ok(a.nivel === "bloqueado", "pagado y vencido juntos = bloqueado");

console.log("\n── oferta ──");

a = accesoDe(svc({ kind: "presupuesto", estado: "pendiente" }), [], HOY);
ok(a.nivel === "oferta", "un presupuesto sin aceptar es oferta");

/* El precio de una oferta se ve: si no, no puede decidir. */
ok(a.detalle.pendiente === undefined, "la oferta no se trata como deuda");

/* Si al presupuesto se le emitió un cobro que aún no vence, sigue
   siendo oferta: el bloqueo es por impago, no por haber facturado. */
a = accesoDe(svc({ kind: "presupuesto", estado: "pendiente" }), [cobro({ estado: "pendiente" })], HOY);
ok(a.nivel === "oferta", "factura sin vencer: sigue siendo oferta");

/* Pero si ese cobro se pasa de fecha, el bloqueo manda sobre la
   oferta: es una deuda vencida. */
a = accesoDe(
  svc({ kind: "presupuesto", estado: "pendiente" }),
  [cobro({ estado: "pendiente", vence_en: "2026-09-01" })],
  HOY
);
ok(a.nivel === "bloqueado", "pero si la factura está vencida, manda el bloqueo");

console.log("\n── inactivo ──");

for (const est of ["pausado", "finalizado", "cancelado"]) {
  a = accesoDe(svc({ estado: est }), [], HOY);
  ok(a.nivel === "inactivo", est + " se ve pero como inactivo", a.titulo);
  ok(a.motivo.length > 0, est + " explica por qué");
}

console.log("\n── el importe no crece por tarde que esté ──");

/* El bloqueo es para que el pendiente se vea y se pague. No es una
   penalización: se pasó el plazo y no se cobra ni un céntimo
   más. Si algún día se quisiera un recargo, este es el sitio donde
   se tendría que decidir, y aquí se deja escrito que hoy no lo hay. */
const tarde1 = accesoDe(svc(), [cobro({ estado: "impagado", importe: 120, vence_en: "2026-09-20" })], HOY);
const tarde2 = accesoDe(svc(), [cobro({ estado: "impagado", importe: 120, vence_en: "2026-09-20" })],
  new Date(2026, 11, 25));
ok(tarde1.detalle.pendiente === 120, "un mes de retraso no cambia el importe", String(tarde1.detalle.pendiente));
ok(tarde2.detalle.pendiente === 120, "dos meses tampoco", String(tarde2.detalle.pendiente));
ok(tarde1.detalle.pendiente === tarde2.detalle.pendiente,
  "el importe pendiente es el mismo haya pasado el tiempo que sea");

console.log("\n── agrupar ──");

const g = agrupar(
  [
    svc({ id: "a", estado: "activo" }),
    svc({ id: "b", estado: "activo" }),
    svc({ id: "c", estado: "pausado" }),
    svc({ id: "d", kind: "presupuesto", estado: "pendiente" }),
  ],
  [cobro({ service_id: "b", estado: "impagado", vence_en: "2026-09-01" })],
  HOY
);

ok(g.lista.length === 4, "devuelve los cuatro servicios");
ok(g.cuenta.bloqueado === 1 && g.cuenta.activo === 1 && g.cuenta.inactivo === 1 && g.cuenta.oferta === 1,
  "cuenta bien cada nivel", JSON.stringify(g.cuenta));
ok(g.lista[0].acceso.nivel === "bloqueado", "lo bloqueado va primero: requiere acción");
ok(g.pendiente === 120, "suma el pendiente total", String(g.pendiente));

/* Los cobros van con su servicio, no mezclados entre todos. */
const g2 = agrupar(
  [svc({ id: "x" }), svc({ id: "y" })],
  [cobro({ service_id: "y", estado: "impagado", vence_en: "2026-09-01" })],
  HOY
);
ok(g2.lista.find((s) => s.id === "x").acceso.nivel === "activo", "el cobro de y no bloquea a x");
ok(g2.lista.find((s) => s.id === "y").acceso.nivel === "bloqueado", "solo bloquea a y");

/* Casos límite */
ok(agrupar([], [], HOY).cuenta.activo === 0, "sin servicios no revienta");
ok(agrupar([svc()], null, HOY).lista.length === 1, "sin cobros no revienta");

console.log(fallos ? `\n  ${fallos} fallo(s)\n` : "\n  Todo correcto\n");
process.exit(fallos ? 1 : 0);
