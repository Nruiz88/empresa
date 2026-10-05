/* =========================================================
   Nexo Studio — Fechas de calendario
   ------------------------------------------------------------
   En este proyecto las fechas son DÍAS del calendario, no
   instantes: "vence el 22 de octubre" significa ese día entero,
   no un momento concreto de ese día.

   POR QUÉ ESTO ESTÁ APARTE
   ------------------------
   El fallo es silencioso y aparece justo cuando más daño hace:
   el día que un cliente deja de ver su panel.

   `new Date('2026-10-22')` no es el 22 de octubre en hora local: es
   el 22 de octubre a las 00:00 **UTC**. En una zona como GMT-3 eso
   es el 21 de octubre a las 21:00, y una fecha de vencimiento cae
   un día antes de lo debido. Con eso, el día que toca pagar ya
   cuenta como vencido y se bloquea el acceso antes de tiempo.

   Por eso aquí una fecha "YYYY-MM-DD" se parte a mano con un regex
   y se construye en hora local. Es la misma idea que ya se aplicaba
   en lib/vencimientos.js, que nació con el problema; ahora está en
   un sitio solo y lo usan todos.
   ========================================================= */

const DIA = 24 * 3600 * 1000;

/**
 * Lee un valor de fecha y devuelve un `Date` en hora local.
 *
 * Acepta lo que devuelve la base (string "YYYY-MM-DD" o ISO
 * completo), un `Date` ya hecho, o null.
 *
 * @param {string|Date|null} v
 * @returns {Date|null}  null si no hay fecha o no es recognizable
 */
function aFecha(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;

  /* Una fecha "YYYY-MM-DD" es un día del calendario. Se parte a
     mano para que ese día sea ESE en cualquier zona horaria. */
  const solo = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (solo) {
    return new Date(Number(solo[1]), Number(solo[2]) - 1, Number(solo[3]));
  }

  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Un `Date` -> "YYYY-MM-DD" en hora local.
 *
 * NO usar `toISOString().slice(0,10)` para esto: eso convierte a UTC
 * y en una zona negativa devuelve el día anterior. Es el mismo error
 * del revés, y por eso vive aquí y no suelto por el código.
 *
 * @param {Date} d
 * @returns {string}
 */
function iso(d) {
  const f = d instanceof Date && !isNaN(d.getTime()) ? d : new Date();
  return (
    f.getFullYear() +
    "-" +
    String(f.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(f.getDate()).padStart(2, "0")
  );
}

/** El día natural de una fecha, sin la hora. */
function aDia(v) {
  const f = aFecha(v);
  if (!f) return null;
  return new Date(f.getFullYear(), f.getMonth(), f.getDate());
}

/**
 * ¿La fecha `v` ya pasó, contando días naturales?
 *
 * Comparar instantes (`v < new Date()`) hace que algo que vence hoy
 * cuente como vencido a las 09:00 de ese mismo día. Con un plazo de
 * pago eso significa quitarle al cliente medio día, y a veces el
 * día entero si seComparan con horas distintas.
 *
 * Por defecto compara contra hoy, que es lo que se quiere al
 * preguntar "¿esto ya venció?". El segundo parámetro existe para las
 * pruebas, que necesitan un "hoy" fijo.
 *
 * @param {string|Date|null} v
 * @param {Date} hoy
 */
function vencio(v, hoy = new Date()) {
  const dia = aDia(v);
  const referencia = aDia(hoy);
  if (!dia || !referencia) return false;
  return dia.getTime() < referencia.getTime();
}

/**
 * Avanza n días naturales.
 *
 * Se usa `new Date(y, m, d + n)` en vez de sumar milisegundos: así
 * el cambio de hora de verano (un día de 23 o 25 horas) no descuadra
 * el resultado. Sumar 24h en el día que se adelanta el reloj salta
 * un día de más.
 *
 * @param {Date|string} fecha
 * @param {number} n
 * @returns {Date|null}
 */
function sumarDias(fecha, n) {
  const f = aFecha(fecha);
  if (!f) return null;
  return new Date(f.getFullYear(), f.getMonth(), f.getDate() + Number(n || 0));
}

module.exports = { aFecha, iso, aDia, vencio, sumarDias, DIA };
