/* =========================================================
   Nexo Studio — Generar los cobros del mes
   ------------------------------------------------------------
   Un mantenimiento de 120 €/mes son doce cobros al año. Hechos a
   mano son doce filas y doce veces que acordarte de hacerlo. Este
   módulo dice cuáles tocarían y, con confirmación, los crea.

   POR QUÉ ESTÁ EN UN MÓDULO APARTE, CON PRUEBAS
   ---------------------------------------------
   Este cálculo AHORA MISMO no crea nada: dice qué crearía. Que
   exista por separado y esté probado es lo que permite enseñar la
   vista previa sin miedo: si el plan dice que va a crear 7 cobros,
   va a crear 7. Si el plan se calculase dentro de la ruta, la
   vista previa y lo que ocurre al confirmar serían dos
   implementaciones de la misma idea, y acabarían discrepando.

   LAS REGLAS, Y POR QUÉ CADA UNA
   ------------------------------
     1. Periodicidad mensual, trimestral o anual.
        "unica" es un pago único: no se renueva. Sin periodicidad no
        hay nada que renovar.

     2. Solo servicios en estado "activo".
        Un servicio pausado o cancelado no se cobra: si se cobra, el
        cliente va a pedir la devolución. Un proyecto "en curso" no
        es recurrente aunque se le ponga periodicidad.

     3. Importe mayor que cero.
        Un cobro de 0 € es ruido que luego hay que anular.

     4. No duplicar (servicio, periodo).
        Hay un UNIQUE en la base de datos, así que esto es una red de
        seguridad además: poder darle al botón dos veces el mismo día
        no puede crear dos cobros de lo mismo.

     5. No facturar a quien ya debe.
        Si el servicio tiene un cobro VENCIDO, no se emite otro. Es
        una decisión de negocio (acumular deuda o no), y no la toma
        un botón por sorpresa: se salta y se avisa. Si lo que
        quieres es apilar meses, es una pregunta para el cliente,
        no para el generador.

   LA FECHA DE VENCIMIENTO
   ----------------------
   Vence a los 20 días de la FECHA DE EMISIÓN. Es un plazo de pago
   en días, no un día fijo del mes: se cuenta desde el día que se
   emite, que es cuando al cliente le llega la factura.

   POR QUÉ NO ES "EL DÍA 20 DEL MES"
   --------------------------------
   Antes vencía el día 10 del mes del periodo, y eso tenía un fallo
   que solo se veía cuando se generaba tarde: si los cobros de
   octubre se emiten el 3 de noviembre (y se emiten tarde, porque
   cualquiera se olvidó de pulsar el botón en su día), la fecha
   límite ya estaba pasada. El cliente entraba bloqueado el mismo
   día en que se le emitía la factura, sin haber tenido tiempo
   siquiera a verla.

   Con un plazo de días desde la emisión eso no puede pasar: la
   fecha límite siempre cae después de la de emisión, se genere
   cuando se genere.

   LA REGLA DE NEGOCIO ADJUNTA
   ---------------------------
   Pasado el plazo, se bloquea el acceso (ver lib/acceso.js), pero
   NO se cobra ningún interés ni recargo por retraso: el importe es
   el mismo indefinidamente hasta que se marca pagado. El bloqueo
   es para que el pendiente se vea y se pague, no una penalización.
   ========================================================= */

const L = require("./labels");
const { sumarDias, iso, vencio } = require("./fechas");

/**
 * Días de plazo para pagar, contados desde la emisión.
 *
 * Veinte días es lo habitual en servicios a pequeña empresa. Está
 * en UNA constante para que cambiarla sea tocar una línea.
 */
const DIAS_VENCIMIENTO = 20;

/** Periodicidades que se renuevan solas */
const RENOVABLES = ["mensual", "trimestral", "anual"];

/** El día 1 del mes del periodo, como fecha local */
function inicioDePeriodo(periodo) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(periodo || ""));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, 1);
}

/** ¿Es un periodo con forma AAAA-MM y un mes real? */
function periodoValido(periodo) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(periodo || ""))) return false;
  const d = inicioDePeriodo(periodo);
  /* Nada de 2026-13: el regex ya lo rechaza, pero por si acaso. */
  return Boolean(d) && d.getMonth() === Number(periodo.split("-")[1]) - 1;
}

/** El periodo actual en AAAA-MM */
function periodoActual(hoy = new Date()) {
  return (
    hoy.getFullYear() + "-" + String(hoy.getMonth() + 1).padStart(2, "0")
  );
}

/** Los dos periodos anteriores, para proposes empezar por atrás */
function periodosAnteriores(hoy = new Date(), cuantos = 6) {
  const salida = [];
  for (let i = 1; i <= cuantos; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    salida.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"));
  }
  return salida;
}

/** Un cobro está vencido si su fecha de pago ya pasó */
function estaVencido(c, hoy = new Date()) {
  if (c.estado === "impagado") return true;
  if (c.estado !== "pendiente") return false;
  return vencio(c.vence_en, hoy);
}

/**
 * Fecha límite de pago de un cobro emitido hoy.
 *
 * Separado del `plan` a propósito: el plazo es una regla de negocio
 * y tiene que estar en un sitio comprobable, no repartido entre el
 * cálculo y la ruta.
 *
 * @param {Date|string} emitido
 * @param {number} dias
 * @returns {string}  "YYYY-MM-DD"
 */
function fechaVence(emitido = new Date(), dias = DIAS_VENCIMIENTO) {
  return iso(sumarDias(emitido, dias));
}

/**
 * Calcula qué cobros habría que crear. NO crea nada.
 *
 * @param {string} periodo   "AAAA-MM"
 * @param {Array}  servicios Servicios candidatos (con clients(...))
 * @param {Array}  cobros    Cobros ya existentes de esos servicios
 * @param {Date}   hoy       Fecha de emisión. El plazo de pago se
 *                           cuenta desde ella, así que es también la
 *                           que determina cuándo vence cada cobro.
 * @returns {{crear, saltar, bloqueados, total}}
 */
function plan(periodo, servicios, cobros, hoy = new Date()) {
  const inicio = inicioDePeriodo(periodo);

  const base = {
    crear: [],
    saltar: [],
    bloqueados: [],
    total: 0,
    importe: 0,
  };
  if (!inicio) return base;

  /* Un mapa periodo -> cobro, para no recorrer todos cada vez. */
  const yaExiste = new Set();
  const vencidosPor = new Map();
  for (const c of cobros || []) {
    if (c.periodo === periodo) yaExiste.add(c.service_id);
    if (estaVencido(c, hoy)) {
      vencidosPor.set(c.service_id, (vencidosPor.get(c.service_id) || 0) + 1);
    }
  }

  /* La fecha límite se calcula UNA vez para toda la tanda: todos los
     cobros de este plan se emiten el mismo día, así que vencen el
     mismo día. Si se calculara dentro del bucle, dos servicios con
     el mismo periodo pero fechas de emisión distintas acabarían con
     vencimientos distintos, y no habría forma de saber por qué. */
  const vence = fechaVence(hoy);

  for (const s of servicios || []) {
    const cli = s.clients || {};
    const item = {
      service_id: s.id,
      titulo: s.titulo,
      empresa: cli.empresa || cli.nombre || "Sin empresa",
      importe: Number(s.importe) || 0,
      moneda: s.moneda || "EUR",
      periodicidad: s.periodicidad,
    };

    /* --- 5. primero lo que bloquea, para poder avisar --- */
    if (vencidosPor.get(s.id)) {
      base.bloqueados.push({
        ...item,
        motivo:
          vencidosPor.get(s.id) === 1
            ? "ya tiene 1 cobro vencido"
            : "ya tiene " + vencidosPor.get(s.id) + " cobros vencidos",
      });
      continue;
    }

    /* --- 1. periodicidad --- */
    if (!RENOVABLES.includes(s.periodicidad)) {
      base.saltar.push({ ...item, motivo: "no es un servicio que se renueve" });
      continue;
    }

    /* --- 2. estado --- */
    if (s.estado !== "activo") {
      base.saltar.push({
        ...item,
        motivo: "está en estado " + (L.ESTADO[s.estado] || s.estado).toLowerCase(),
      });
      continue;
    }

    /* --- 4. ya facturado ese periodo --- */
    if (yaExiste.has(s.id)) {
      base.saltar.push({ ...item, motivo: "ya tiene cobro de " + periodo });
      continue;
    }

    /* --- 3. importe --- */
    if (!(item.importe > 0)) {
      base.saltar.push({ ...item, motivo: "no tiene importe" });
      continue;
    }

    base.crear.push({
      ...item,
      periodo,
      concepto: s.titulo + " · " + periodo,
      /* `vence` ya es un string "YYYY-MM-DD": lo devuelve
         fechaVence(). No volver a convertirlo aquí. */
      vence_en: vence,
    });
  }

  base.total = base.crear.length;
  base.importe = base.crear.reduce((t, x) => t + x.importe, 0);
  return base;
}

/** Filas para insertar en `cobros` */
function aFilas(p) {
  return p.crear.map((x) => ({
    service_id: x.service_id,
    periodo: x.periodo,
    concepto: x.concepto,
    importe: x.importe,
    moneda: x.moneda,
    estado: "pendiente",
    emitido_en: null, /* lo pone la ruta: la fecha de hoy */
    /* El plazo se cuenta desde la emisión, así que el vencimiento
       se calcula con la misma fecha que va en `emitido_en`. La ruta
       tiene que pasar AMBOS el mismo día, o el cobro nace con una
       fecha de emisión y otra de vencimiento que no cuadran. */
    vence_en: x.vence_en,
  }));
}

module.exports = {
  plan,
  aFilas,
  periodoActual,
  periodoValido,
  periodosAnteriores,
  inicioDePeriodo,
  estaVencido,
  fechaVence,
  DIAS_VENCIMIENTO,
  RENOVABLES,
};
