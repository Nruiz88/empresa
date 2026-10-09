/* Los estados de una suscripción.
   ─────────────────────────────────────────────────────────────
   El cálculo de "cuántos días faltan" es de los que seem facile y
   tienen tres errores posibles:

     · redondear sin327 ceil, y decir "vence en 0 días" el día que vence;
     · comparar fechas sin hora, y que un cobro que vence hoy figure
       vencido desde anoche;
     · usar la hora del servidor, y que el estado cambie a distinta hora
       según quién mire.

   Por eso las pruebas pasan una fecha fija. Con `new Date()` real, la
   prueba pasa un día y falla otro, que es la peor forma de test. */
const assert = require("assert");

require("../lib/env").load();

const apps = require("../lib/aplicaciones");

/* Una fecha fija. Todas las pruebas usan esta. */
const HOY = new Date("2026-10-08T12:00:00");

/* Un día, en el formato que guarda la base. */
function dia(offset) {
  const d = new Date(HOY);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

/* ── Los cinco estados ── */

const CASOS = [
  {
    nombre: "un mes de margen por delante: activo",
    termina: dia(60),
    espera: "activo",
  },
  {
    nombre: "dentro de la ventana de aviso: por vencer",
    termina: dia(3),
    espera: "por_vencer",
  },
  {
    nombre: "el día que vence todavía NO está vencido",
    termina: dia(0),
    espera: "por_vencer",
  },
  {
    nombre: "un día antes: vence mañana",
    termina: dia(1),
    espera: "por_vencer",
  },
  {
    nombre: "un día después: en margen, y sigue andando",
    termina: dia(-1),
    espera: "en_margen",
  },
  {
    nombre: "el día catorce todavía le queda un día de margen",
    termina: dia(-14),
    espera: "en_margen",
  },
  {
    nombre: "en el día quince ya no queda margen: vencido",
    termina: dia(-15),
    espera: "vencido",
  },
  {
    nombre: "un día pasado el margen: vencido de verdad",
    termina: dia(-16),
    espera: "vencido",
  },
  {
    nombre: "sin fecha de fin: neutro, no vencido",
    termina: null,
    espera: "sin_fecha",
  },
];

const fallos = [];

for (const c of CASOS) {
  const e = apps.estadoDe({ termina_en: c.termina }, HOY);
  if (e.clave === c.espera) {
    console.log("  ✓ " + c.nombre);
  } else {
    console.log("  × " + c.nombre);
    console.log("      esperaba " + c.espera + ", dio " + e.clave + "  (" + e.etiqueta + ")");
    fallos.push(c.nombre);
  }
}

/* ── El día del año nuevo ──
   Un cálculo de días escrito con concatenación de meses se rompe el 31
   de diciembre: "diciembre tiene 31 días" y el 31 + 1 = 32 no existe.
   Con `setDate` no hay ese problema, pero se prueba igual. */

console.log("");

const finDeAnio = new Date("2026-12-31T12:00:00");
const trasFinDeAnio = new Date("2027-01-01T12:00:00");
const e1 = apps.estadoDe({ termina_en: "2026-12-31" }, trasFinDeAnio);

if (e1.clave === "en_margen") {
  console.log("  ✓ el 31/12 → 01/01 no rompe el cálculo de días");
} else {
  console.log("  × el 31/12 → 01/01 dio " + e1.clave + " en vez de en_margen");
  fallos.push("fin de año");
}

/* ── El precio: un plan no se factura dos veces ──
   Es la regla que más caro sale si se rompe. */

console.log("");

const MICROS = {
  porClave: {
    bot_whatsapp: { modulo: "bot_whatsapp", nombre: "Bot de WhatsApp", precio: 20000, moneda: "ARS" },
    inventario: { modulo: "inventario", nombre: "Inventario", precio: 15000, moneda: "ARS" },
  },
  planes: [
    {
      id: "comercio",
      nombre: "Comercio",
      precio: 35000,
      moneda: "ARS",
      aplicaciones: ["bot_whatsapp", "inventario"],
    },
  ],
};

/* Un plan da dos aplicaciones que suman 35.000. El plan cuesta 35.000.
   Si el precio del servicio fuera la suma, cobraría 70.000. */
const sumaDeLasApps = 20000 + 15000;

if (sumaDeLasApps === 35000) {
  console.log("  ⚠ el ejemplo no distingue: la suma da lo mismo que el plan.");
  console.log("    Se cambia el precio del plan para que la diferencia se vea.");
  MICROS.planes[0].precio = 30000;
} else {
  console.log("  el ejemplo distingue: suma " + sumaDeLasApps + " vs plan 35000");
}

const porPlan = apps.precioDe({ kind: "plan", plan_id: "comercio" }, MICROS);
const suelta = apps.precioDe({ kind: "aplicacion", microservicio_clave: "bot_whatsapp" }, MICROS);

console.log("  plan Comercio:          " + porPlan.importe + " " + porPlan.moneda + "   (" + porPlan.detalle + ")");
console.log("  aplicación suelta:      " + suelta.importe + " " + suelta.moneda + "   (" + suelta.detalle + ")");
console.log("");

if (porPlan.importe === 30000 && porPlan.origen === "plan") {
  console.log("  ✓ el plan se factura una vez, no la suma de sus aplicaciones");
} else {
  console.log("  × el precio del plan no es el del plan");
  fallos.push("precio del plan");
}

if (suelta.importe === 20000 && suelta.origen === "aplicacion") {
  console.log("  ✓ la aplicación suelta se factura su propio precio");
} else {
  console.log("  × la aplicación suelta no se factura bien");
  fallos.push("precio suelto");
}

/* Las dos aplicaciones del plan. */
const delPlan = apps.aplicacionesDelPlan("comercio", MICROS);
console.log("");
if (delPlan.length === 2) {
  console.log("  ✓ el plan da acceso a 2 aplicaciones: " + delPlan.map((a) => a.nombre).join(", "));
} else {
  console.log("  × el plan dio " + delPlan.length + " aplicaciones en vez de 2");
  fallos.push("aplicaciones del plan");
}

/* ── El resumen: lo urgente ── */

console.log("");

const lista = [
  apps.paraCliente([{ kind: "plan", plan_id: "comercio", termina_en: dia(60) }], MICROS, HOY)[0],
  apps.paraCliente([{ kind: "aplicacion", microservicio_clave: "bot_whatsapp", termina_en: dia(-3) }], MICROS, HOY)[0],
  apps.paraCliente([{ kind: "aplicacion", microservicio_clave: "bot_whatsapp", termina_en: dia(-40) }], MICROS, HOY)[0],
];

const r = apps.resumen(lista);

console.log("  resumen: total " + r.total + ", urgente " + r.urgente +
  "  (activo " + r.activo + ", por_vencer " + r.por_vencer +
  ", en_margen " + r.en_margen + ", vencido " + r.vencido + ")");
console.log("");

if (r.urgente === 2 && r.activo === 1) {
  console.log("  ✓ el resumen cuenta como urgente lo que hay que mirar hoy");
} else {
  console.log("  × el resumen no cuadra");
  fallos.push("resumen");
}

/* ── El resultado ── */

console.log("");

if (fallos.length) {
  console.log("  × " + fallos.length + " fallo(s): " + fallos.join(", ") + "\n");
  process.exit(1);
}

console.log("  ✓ todas las comprobaciones pasan\n");