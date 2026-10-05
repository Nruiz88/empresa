/* =========================================================
   Nexo Studio — Vencimientos y renovaciones
   ------------------------------------------------------------
   Lo que un mantenimiento necesita para saber cuándo va a caducar
   y cuándo toca facturarlo de nuevo.

   POR QUÉ ESTÁ EN UN MÓDULO APARTE
   -------------------------------
   Este cálculo es el que más fácil se equivoca sin que se note:
   un día de más o de menos y dejas de avisar a un cliente antes de
   que se caiga su web. Por eso vive solo, con sus pruebas, y no
   enterrado en una ruta.

   CÓMO SE CALCULA UNA RENOVACIÓN
   -----------------------------
   Un servicio tiene dos fechas posibles:

     - Si tiene `termina_en`: esa es la fecha en que caduca, y la
       renovación es la siguiente por periodicidad.

     - Si NO tiene `termina_en` pero sí `periodicidad` e `inicia_en`:
       es un servicio recurrente que nunca "termina" (un hosting
       mensual, por ejemplo). Entonces la fecha que importa no es la
       última, sino la PRÓXIMA: la última cuota pagada más un
       periodo. Si nunca se ha calculado, se supone que la última
       cuota cae hoy y se proyecta un periodo hacia delante.

   Sin esto, un mantenimiento mensual sin fecha de fin se perdería
   del panel y nadie se enteraría de que hay que renovarlo.
   ========================================================= */

/**
 * Periodicidad en MESES, no en días.
 *
 * Importa, y mucho. Si "mensual" fueran 30 días fijos, una cuota que
 * cae el 31 de enero se renovaría el 2 de marzo, y en dos semanas más
 * el desfase ya es visible. Quien firma "al mes" entiende "el mismo
 * día del mes siguiente", que es lo que se calcula aquí.
 *
 * Los meses no duran lo mismo: febrero son 28, marzo 31. Sumar
 * meses sobre la fecha conserva el día y deja que la librería
 * ajuste los meses cortos, que es lo que espera un cliente.
 */
const PERIODOS = {
  mensual: { meses: 1 },
  trimestral: { meses: 3 },
  anual: { meses: 12 },
  unica: { meses: 0 },
};

/** Días aproximados, solo para ordenar y para textos vagos */
const PERIODO_DIAS = {
  mensual: 30,
  trimestral: 91,
  anual: 365,
  unica: 0,
};

/** Estados en los que un servicio sigue vivo y merece aviso */
const VIVOS = ["activo", "en_curso", "pendiente", "pausado"];

/** Cuántos días antes de caducar conviene empezar a avisar */
const DIAS_AVISO = 30;

/* OJO con las fechas: '2026-09-02' se parsea como UTC, y en una zona
   como GMT-3 eso cae en el día ANTERIOR (31 de agosto a las 21:00).
   Con un día de desfase, "caduca en 5 días" se convierte en "caduca
   en 6" y los avisos se van un día tarde, que es justo el fallo que
   este módulo existe para evitar.

   Esa lectura por partes vive ahora en lib/fechas.js, junto al resto
   de conversiones de fecha del proyecto. Antes estaba aquí duplicada;
   tenerla en dos sitios era una forma segura de que una se quedara
   vieja sin que nadie lo notara. */
const { aFecha, sumarDias: sumar, DIA } = require("./fechas");

/**
 * Avanza n meses conservando el día.
 *
 * El detalle que se suele olvidar: si sumas 1 mes a un 31 de enero,
 * `setMonth` se pasa a marzo (febrero no tiene 31). Un cliente que
 * paga el día 31 expects que la siguiente sea el último día de
 * febrero, no el 3 de marzo. Por eso se recorta al último día del
 * mes destino.
 */
function sumarMeses(fecha, meses) {
  const dia = fecha.getDate();
  const destino = new Date(fecha.getFullYear(), fecha.getMonth() + meses, 1);

  /* Último día del mes destino */
  const ultimo = new Date(destino.getFullYear(), destino.getMonth() + 1, 0).getDate();

  destino.setDate(Math.min(dia, ultimo));
  return destino;
}

/** Suma lo que corresponda a la periodicidad */
function avanzar(fecha, periodicidad) {
  const p = PERIODOS[periodicidad];
  return p && p.meses ? sumarMeses(fecha, p.meses) : null;
}

/** ¿Hoy es este día o más tarde? Compara por día natural. */
function esHoyOMas(date, hoy) {
  const a = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const b = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return a.getTime() >= b.getTime();
}

/**
 * Calcula cuándo caduca un servicio y cuándo toca renovarlo.
 *
 * @param {object} s     Fila de `services`
 * @param {Date}   hoy   Referencia (se pasa para poder probar)
 * @returns {{proxima: Date|null, caduca: Date|null, texto: string,
 *            nivel: string, dias: number|null}}
 */
function calcular(s, hoy = new Date()) {
  const fin = aFecha(s.termina_en);
  const inicio = aFecha(s.inicia_en);
  const periodo = PERIODOS[s.periodicidad];

  /* Un pago único caduca en su fecha y no se renueva. */
  if (s.periodicidad === "unica") {
    if (!fin) return { proxima: null, caduca: null, texto: "", nivel: "nada", dias: null };
    const dias = Math.round((fin - hoy) / DIA);
    return {
      proxima: null,
      caduca: fin,
      dias,
      nivel: nivel(dias),
      texto: dias >= 0 ? `caduca en ${dias} día${dias === 1 ? "" : "s"}` : `caducó hace ${-dias} día${dias === -1 ? "" : "s"}`,
    };
  }

  /* Con fecha de fin: la renovación es el siguiente periodo. */
  if (fin) {
    const proxima = avanzar(fin, s.periodicidad);
    const dias = Math.round((fin - hoy) / DIA);
    return {
      proxima,
      caduca: fin,
      dias,
      nivel: nivel(dias),
      texto: proxima
        ? `caduca ${corta(fin)} · renueva ${corta(proxima)}`
        : `caduca ${corta(fin)}`,
    };
  }

  /* Sin fecha de fin pero recurrente: la próxima cuota es la que
     manda, y aquí hay que ser honesto sobre lo que se sabe.

     Un servicio recurrente sin `termina_en` (un hosting, un
     mantenimiento que se renueva solo) no tiene guardada la fecha de
     su última cuota. Podríamos suponerla, pero cualquier suposición
     aquí es una fecha de renovación inventada, y una fecha
     inventada en un aviso es peor que no avisar.

     Lo que sí sabemos: hoy vence el periodo en curso. Si se está
     renovando, toca cobrar hoy. Así que se proyecta un periodo desde
     HOY, no desde el inicio. El panel lo marcará como "renovación
     pendiente" para que el equipo lo confirme en vez de confiar en
     una fecha calculada. */
  if (periodo && inicio) {
    const proxima = avanzar(hoy, s.periodicidad);
    const dias = Math.round((proxima - hoy) / DIA);
    return {
      proxima,
      caduca: proxima,
      dias,
      nivel: "pendiente",
      texto: `renovación pendiente · se renueva ${corta(proxima)} (cada ${s.periodicidad})`,
    };
  }

  return { proxima: null, caduca: null, dias: null, nivel: "nada", texto: "" };
}

/** Traduce días restantes a un nivel de urgencia */
function nivel(dias) {
  if (dias === null) return "nada";
  if (dias < 0) return "vencido";
  if (dias <= 7) return "urgente";
  if (dias <= DIAS_AVISO) return "aviso";
  return "tranquilo";
}

/** Nivel para algo que depende de que alguien lo confirme */
const NIVEL_PENDIENTE = "pendiente";

/** "15 mar 2027" */
function corta(f) {
  return f.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Toma servicios vivos y devuelve los que hay que mirar, ordenados
 * por urgencia.
 *
 * @param {Array} servicios  Filas de `services` con `clients(...)`
 * @param {Date}  hoy
 * @param {number} ventana   Días hacia adelante que se listan (por defecto 60)
 */
function proximos(servicios, hoy = new Date(), ventana = 60) {
  const fuera = [];

  for (const s of servicios || []) {
    if (!VIVOS.includes(s.estado)) continue;

    const info = calcular(s, hoy);

    /* Sin fecha no hay nada que avisar. */
    if (info.proxima === null && info.caduca === null) continue;

    /* Solo entra si caduca dentro de la ventana o ya pasó.
       Un proyecto que acaba en 2028 no necesita estar en pantalla. */
    const dias = info.dias === null ? 9999 : info.dias;
    if (dias > ventana) continue;

    const cli = s.clients || {};
    fuera.push({
      id: s.id,
      titulo: s.titulo,
      kind: s.kind,
      estado: s.estado,
      empresa: cli.empresa || cli.nombre || "Sin empresa",
      importe: s.importe,
      moneda: s.moneda,
      texto: info.texto,
      nivel: info.nivel,
      dias: info.dias,
      caduca: info.caduca,
      proxima: info.proxima,
    });
  }

  /* Primero lo vencido, luego lo más cercano. Los pendientes de
     confirmar se quedan arriba: son los que necesitan una decisión
     del equipo, no solo una mirada. */
  const peso = { vencido: 0, pendiente: 1, urgente: 2, aviso: 3, tranquilo: 4, nada: 9 };
  fuera.sort((a, b) => (peso[a.nivel] - peso[b.nivel]) || (a.dias - b.dias));

  return fuera;
}

module.exports = { calcular, proximos, DIAS_AVISO, VIVOS, PERIODOS, sumarMeses };