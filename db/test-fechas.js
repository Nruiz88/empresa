/* Pruebas de lib/fechas.js: leer y escribir fechas sin que la zona
   horaria te cuele un día.

   Es el módulo más boring del proyecto y el que más caro sale si
   falla. Ningún error lanza: una fecha simplemente sale mal un día y
   el efecto es que un cliente pierde el acceso de su panel el día
   que le toca pagar. */

const { aFecha, iso, aDia, vencio, sumarDias } = require("../lib/fechas");

let fallos = 0;
const ok = (c, n, extra) => {
  console.log(`  ${c ? "✓" : "✗"} ${n}${extra ? "  → " + extra : ""}`);
  if (!c) fallos++;
};

/* Zonas donde el fallo se ve de verdad. UTC NO vale para probar esto:
   allí `new Date('2026-10-22')` es exactamente la medianoche del 22 y
   no hay error que detectar. Las pruebas tienen que correr en las
   puntas del planeta, o no están probando nada.

   -11 (Pago_Pago) es el peor caso; -3 (Buenos_Aires, la zona de esta
   máquina) es el habitual. +14 (Kiritimati) sirve para el error
   simétrico al escribir. */
const ZONAS = ["Pacific/Pago_Pago", "America/Buenos_Aires", "Pacific/Kiritimati", "UTC"];

/**
 * Ejecuta la función en cada zona y devuelve los resultados.
 *
 * Cambiar process.env.TZ solo surte efecto en los procesos de Node
 * que aún no han cacheado la zona; por eso se relanza nada y se
 * comprueba que la zona cambiara de verdad. Si un dia Node deja de
 * respectarlo, `comprobada` dirá "no" y habrá que montar esto con
 * procesos hijo.
 */
function enCadaZona(fn) {
  const real = process.env.TZ;
  const salida = [];
  for (const zona of ZONAS) {
    process.env.TZ = zona;
    const nueva = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (nueva !== zona && zona !== "UTC") {
      throw new Error(
        "Este Node ignora process.env.TZ: no se puede probar la zona horaria. " +
          "Hay que montar estas pruebas con procesos hijo (ver la nota del módulo)."
      );
    }
    salida.push({ zona, valor: fn() });
  }
  process.env.TZ = real;
  return salida;
}

console.log("\n── aFecha: 'YYYY-MM-DD' es un día del calendario ──");

/* El caso que lo motivó: en zona -11, '2026-10-22' son las 00:00 UTC
   del 22, que en esa zona son las 13:00 del 21. Partiéndolo a mano, es
   el 22 a las 00:00 locales. Y en zona +14, el error es al revés: el
   22 a las 00:00 UTC son las 14:00 del 22, así que ahí `new Date()`
   acierta el día pero `toISOString()` de una fecha local del 22
   devolvería el 21. */
{
  const leidas = enCadaZona(() => iso(aFecha("2026-10-22")));
  ok(
    leidas.every((r) => r.valor === "2026-10-22"),
    "lee el día 22 en cualquier zona",
    leidas.map((r) => `${r.zona}=${r.valor}`).join("  ")
  );

  /* Y el clásico: `new Date()` directo SÍ falla. Está aquí para dejar
     escrito por qué existe este módulo, y para que si alguien lo
     "simplifica" se vea al caer la prueba. */
  const directas = enCadaZona(() => new Date("2026-10-22").getDate());
  ok(
    directas.some((r) => r.valor === 21),
    "con new Date() directo sí cae al día 21 en zonas negativas",
    directas.map((r) => `${r.zona}=día${r.valor}`).join("  ")
  );
}

console.log("\n── aFecha: lo que acepta y lo que no ──");

ok(aFecha(null) === null, "null");
ok(aFecha("") === null, "cadena vacía");
ok(aFecha(undefined) === null, "undefined");
ok(aFecha("basura") === null, "basura", String(aFecha("basura")));
ok(aFecha(new Date("nope")) === null, "un Date inválido");
ok(aFecha(new Date(2026, 9, 2)) instanceof Date, "un Date se devuelve tal cual");

/* Acepta ISO completo, que es lo que puede devolver la API. */
const isoCompleto = aFecha("2026-10-02T15:30:00Z");
ok(isoCompleto instanceof Date, "acepta un ISO completo con hora");

console.log("\n── iso: al revés, escribir ──");

/* El error simétrico: toISOString().slice(0,10) da el día ANTERIOR
   al que se le pidió, en cualquier zona que no esté en UTC. Aquí se
   comprueba que `iso()` no lo comete. */
{
  const escritos = enCadaZona(() => iso(new Date(2026, 9, 22, 12, 0)));
  ok(
    escritos.every((r) => r.valor === "2026-10-22"),
    "escribe el 22 en cualquier zona",
    escritos.map((r) => `${r.zona}=${r.valor}`).join("  ")
  );

  /* El clásico: `new Date(...).toISOString().slice(0,10)` sobre una
     fecha LOCAL. Falla en las zonas adelantadas: un Date del 22 a
     mediodía en UTC+14 son las 22:00 UTC del 21, y al escribirlo
     sale "2026-10-21".

     Esto no es hipotético: era lo que hacía la ruta que genera los
     cobros. En un servidor en UTC+14 (o en cualquier zona por
     encima de UTC+12 al mediodía) los cobros se emitían con un día
     de fecha atrasado, y su vencimiento, calculado 20 días después
     de esa fecha equivocada, también. Por eso `iso()` existe. */
  const porISO = enCadaZona(() => new Date(2026, 9, 22, 12, 0).toISOString().slice(0, 10));
  ok(
    porISO.some((r) => r.valor === "2026-10-21"),
    "toISOString() sí se equivoca de día en zonas adelantadas (y por eso existe iso())",
    porISO.map((r) => `${r.zona}=${r.valor}`).join("  ")
  );

  /* A las 23:00 el error va al revés: son las 00:00 UTC del 23, así
     que en zonas negativas escribe el 23 cuando la fecha local era el
     22. O sea, se equivoca en las dos puntas del planeta, y no
     siempre por el mismo lado. */
  const porISO23 = enCadaZona(() => new Date(2026, 9, 22, 23, 0).toISOString().slice(0, 10));
  ok(
    porISO23.some((r) => r.valor !== "2026-10-22"),
    "a las 23:00 también falla, y hacia el otro lado",
    porISO23.map((r) => `${r.zona}=${r.valor}`).join("  ")
  );
}

ok(iso(new Date(2026, 0, 5)) === "2026-01-05", "enero con ceros a la izquierda", iso(new Date(2026, 0, 5)));
ok(iso(new Date(2026, 9, 2)) === "2026-10-02", "octubre bien");
ok(iso(new Date(2026, 11, 31)) === "2026-12-31", "fin de año");
ok(iso(new Date("nope")) !== null, "un Date inválido no revienta, devuelve hoy");
ok(/^\d{4}-\d{2}-\d{2}$/.test(iso(new Date())), "siempre el formato", iso(new Date()));

console.log("\n── vencio: por días, no por instantes ──");

/* Un cobro que vence hoy se puede pagar HOY. Comparando instantes,
   bastaba con que fueran las 09:00 para que contara como vencido. */
ok(!vencio("2026-10-02", new Date(2026, 9, 2, 23, 59)), "hoy a las 23:59 no ha vencido");
ok(!vencio("2026-10-02", new Date(2026, 9, 2, 0, 0)), "hoy a las 00:00 tampoco");
ok(vencio("2026-10-01", new Date(2026, 9, 2, 0, 1)), "ayer sí, aunque sea por un minuto");

/* El caso límite de verdad: el mismo día, un minuto antes. */
ok(!vencio("2026-10-02", new Date(2026, 9, 2, 9, 0)),
  "a las 09:00 del día del vencimiento aún se puede pagar");

ok(!vencio("2026-10-30", new Date(2026, 9, 2)), "una fecha futura no ha vencido");
ok(!vencio(null, new Date()), "sin fecha no dice que venció");
ok(!vencio("", new Date()), "una fecha vacía tampoco");
ok(!vencio("basura", new Date()), "ni una fecha basura");
ok(vencio("2026-10-02", new Date(2026, 9, 2).getTime() + 86400000),
  "pasado un día sí");

console.log("\n── sumarDias ──");

ok(iso(sumarDias(new Date(2026, 9, 2), 20)) === "2026-10-22", "2 oct + 20 días = 22 oct",
  iso(sumarDias(new Date(2026, 9, 2), 20)));
ok(iso(sumarDias(new Date(2026, 9, 11), 20)) === "2026-10-31", "11 oct + 20 = 31 oct");
ok(iso(sumarDias(new Date(2026, 11, 20), 20)) === "2027-01-09", "20 dic + 20 = 9 ene");
ok(iso(sumarDias(new Date(2026, 9, 2), 0)) === "2026-10-02", "sumar 0 no cambia nada");
ok(iso(sumarDias(new Date(2026, 9, 2), -2)) === "2026-09-30", "sumar negativos resta");
ok(iso(sumarDias(new Date(2026, 0, 31), 1)) === "2026-02-01", "31 ene + 1 = 1 feb");

/* Acepta strings, que es como llegan de la base. */
ok(iso(sumarDias("2026-10-02", 20)) === "2026-10-22", "también acepta un string");

/* El plazo de 20 días tiene que dar el MISMO día esté donde esté
   el servidor. Es lo que impide que un cliente vea su bloqueo un día
   antes en un continents que en otro. */
{
  const plazos = enCadaZona(() => iso(sumarDias("2026-10-02", 20)));
  ok(
    plazos.every((r) => r.valor === "2026-10-22"),
    "el plazo de 20 días da el mismo día en las dos puntas del planeta",
    plazos.map((r) => `${r.zona}=${r.valor}`).join("  ")
  );
}

/* Y el salto de hora de verano: en Europa el 25 de octubre se
   atrasa el reloj. Sumar 24h en milisegundos cruzando ese día da
   23 horas de más o de menos, y el resultado se va un día. Por eso
   sumarDias() construye la fecha en lugar de sumar. */
{
  const antes = enCadaZona(() => iso(sumarDias("2026-10-24", 1)));
  ok(
    antes.every((r) => r.valor === "2026-10-25"),
    "sumar un día cruzando el cambio de hora de Europa sale bien",
    antes.map((r) => `${r.zona}=${r.valor}`).join("  ")
  );
}

console.log("\n── aDia ──");

ok(aDia("2026-10-02T18:45:00Z") instanceof Date, "acepta ISO completo");
ok(aDia("2026-10-02").getHours() === 0, "devuelve la medianoche local");
ok(aDia("basura") === null, "basura devuelve null");

console.log(fallos ? `\n  ${fallos} fallo(s)\n` : "\n  Todo correcto\n");
process.exit(fallos ? 1 : 0);
