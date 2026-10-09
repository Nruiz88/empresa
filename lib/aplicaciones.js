/* =========================================================
   Shopcito — Aplicaciones: quién tiene qué, y hasta cuándo
   ------------------------------------------------------------
   Las dos maneras de darle a un cliente acceso a un microservicio:

     · suelta    compró UNA aplicación y la paga por separado;
     · por plan  compró un plan, que le da varias de una vez.

   ── POR QUÉ ES UNA FUNCIÓN Y NO UNA CONSULTA SUELTA ──

   Porque el cálculo del estado se usa en tres sitios —la lista, la
   ficha del cliente y la alerta— y si se escribe tres veces, un día se
   cambia en uno y no en los otros. Tres versiones del "está vencido"
   que dan tres respuestas distintas.

   ── EL ESTADO, Y POR QUÉ NO ESTÁ GUARDADO ──

   Un servicio tiene `termina_en`, una fecha. De ahí sale su estado, y
   ese estado cambia solo con que pase el tiempo. Guardarlo sería
   guardar algo que hay que volver a calcular todos los días, y el día
   que se olviden, la lista dice que algo está vigente cuando venció
   hace un mes.

   ── LOS QUINCE DÍAS ──

   Al vencer sigue andando quince días. No es un detalle de cortesía:
   si cortara en seco, un cliente que se olvidó de pagar un mes perdía
   el número de golpe, y el que pierde el número no vuelve.

   Y en esos quince días tampoco se corta automáticamente: eso
   significaría tocar el webhook de Evolution, que es de un tercero y
   puede fallar. Si falla, el cliente pagó y quedó sin bot, que es peor
   que no cobrar a tiempo. Se avisa, y lo corta una persona.

   ── EL PRECIO ──

   Si el acceso viene de un plan, lo que se factura es el plan, una
   sola vez. Si viene suelto, la aplicación. Nunca la suma de las
   aplicaciones del plan: ya se pagó el plan, y cobrar dos veces por lo
   mismo es la forma más rápida de perder un cliente.
   ========================================================= */

/** Días de gracia después de la fecha de fin. */
const DIAS_DE_MARGEN = 15;

/** Días de margen para recordar un cobro que vence. */
const DIAS_DE_AVISO = 7;

/**
 * El estado de un servicio, según las fechas y el día de hoy.
 *
 * @param {{termina_en: string|null}} s
 * @param {Date} [hoy]
 * @returns {{clave: string, etiqueta: string, tono: string, dias: number|null}}
 */
function estadoDe(s, hoy = new Date()) {
  if (!s || !s.termina_en) {
    return { clave: "sin_fecha", etiqueta: "Sin fecha de fin", tono: "neutro", dias: null };
  }

  /* ── DÍAS CALENDARIO, NO HORAS ──
     La primera versión comparaba instantes, y por eso "vence mañana"
     dependía de la hora del día: un cobro que vencía ayer a las 23:59
     marcaba quince días de atraso en vez de dieciséis, porque a las
     doce del día todavía no se cumplieron las veinticuatro.

     Y eso no era un detalle theoretical: en el límite exacto, el margen
     de quince días mostraba «sigue activo 0 más», que es un mensaje que
     no significa nada. El que lo tenía que leer entendía que el
     servicio estaba apagado, o entendía que le quedaba un día.

     Se comparan DÍAS: se tira la hora de las dos fechas y se resta.
     Con eso un cobro que vence hoy es «vence hoy» a las 00:01 y a las
     23:59, que es lo que espera alguien que lee una fecha. */

  const aMedianoche = (d) => {
    const x = new Date(d);
    return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  };

  const fin = aMedianoche(s.termina_en);
  const ahora = aMedianoche(hoy);
  const MS = 24 * 60 * 60 * 1000;

  /* Entero exacto: no hay horas que redondear. */
  const dias = Math.round((fin - ahora) / MS);

  if (dias > DIAS_DE_AVISO) {
    return { clave: "activo", etiqueta: "Activo", tono: "ok", dias };
  }

  /* El día del vencimiento todavía es del período pagado. Decir «vence
     hoy» y no «vencido»: si alguien lee el panel a las ocho de la
     mañana, el servicio está pagando hasta medianoche, y un cartel de
     vencido es un error de un día entero.

     El día siguiente recién ahí empieza el margen. */
  if (dias === 0) {
    return { clave: "por_vencer", etiqueta: "Vence hoy", tono: "aviso", dias };
  }

  if (dias > 0) {
    return {
      clave: "por_vencer",
      etiqueta: dias === 1 ? "Vence mañana" : "Vence en " + dias + " días",
      tono: "aviso",
      dias,
    };
  }

  /* Pasó el fin, pero sigue el margen. */
  const pasado = -dias;

  if (pasado < DIAS_DE_MARGEN) {
    /* Con `<` y no con `<=`: en el día quince ya no queda margen, y decir
       «sigue activo 1 más» cuando queda cero es peor que no decirlo. */
    return {
      clave: "en_margen",
      etiqueta:
        "Vencido hace " + pasado + " " + (pasado === 1 ? "día" : "días") +
        " · sigue activo " + (DIAS_DE_MARGEN - pasado) +
        (DIAS_DE_MARGEN - pasado === 1 ? " día más" : " días más"),
      tono: "aviso",
      dias,
    };
  }

  return {
    clave: "vencido",
    etiqueta: "Vencido hace " + pasado + " días · debería estar apagado",
    tono: "peligro",
    dias,
  };
}

/**
 * Las aplicaciones de un plan.
 *
 * Lee de `plans.aplicaciones`, que es un array de claves. No se copia a
 * los servicios: si se copiara, cambiar un plan obligaría a recorrer
 * todos los clientes y alguno se quedaría atrás sin que nadie lo viera.
 *
 * @param {string} planId
 * @param {Array} microservicios
 * @returns {Array}
 */
function aplicacionesDelPlan(planId, microservicios) {
  const plan = (microservicios && microservicios.planes || []).find((p) => p.id === planId);
  if (!plan) return [];

  const claves = Array.isArray(plan.aplicaciones) ? plan.aplicaciones : [];

  return claves
    .map((c) => (microservicios.porClave || {})[c])
    .filter(Boolean);
}

/**
 * Lo que se factura por un acceso.
 *
 * @param {{kind: string, plan_id?: string|null, microservicio_clave?: string|null}} s
 * @param {object} microservicios
 * @returns {{importe: number|null, moneda: string, origen: string, detalle: string}}
 */
function precioDe(s, microservicios) {
  if (!s) return { importe: null, moneda: "ARS", origen: "—", detalle: "" };

  /* Acceso por plan: se paga el plan, una vez. */
  if (s.kind === "plan" && s.plan_id) {
    const plan = (microservicios.planes || []).find((p) => p.id === s.plan_id);
    return {
      importe: plan && plan.precio !== null && plan.precio !== undefined
        ? Number(plan.precio)
        : null,
      moneda: (plan && plan.moneda) || "ARS",
      origen: "plan",
      detalle: (plan ? plan.nombre : s.plan_id) + " — incluye sus aplicaciones",
    };
  }

  /* Acceso suelto: se paga la aplicación. */
  if (s.kind === "aplicacion" && s.microservicio_clave) {
    const m = (microservicios.porClave || {})[s.microservicio_clave];
    return {
      importe: m && m.precio !== null && m.precio !== undefined ? Number(m.precio) : null,
      moneda: (m && m.moneda) || "ARS",
      origen: "aplicacion",
      detalle: (m ? m.nombre : s.microservicio_clave) + " — por separado",
    };
  }

  /* Los tipos viejos. */
  return {
    importe: s.importe !== null && s.importe !== undefined ? Number(s.importe) : null,
    moneda: s.moneda || "ARS",
    origen: "servicio",
    detalle: s.titulo || "",
  };
}

/**
 * Todos los servicios de un cliente, con su estado y su precio ya
 * calculados.
 *
 * @param {object} serviciosFilas
 * @param {object} microservicios
 * @param {Date} [hoy]
 * @returns {Array}
 */
function paraCliente(serviciosFilas, microservicios, hoy = new Date()) {
  return (serviciosFilas || []).map((s) => {
    const estado = estadoDe(s, hoy);
    const precio = precioDe(s, microservicios);

    /* Un plan se despliega en las aplicaciones que da, para poder
       mostrarlas. No se facturan: eso ya lo cubre el precio del plan. */
    const aplicaciones =
      s.kind === "plan" && s.plan_id
        ? aplicacionesDelPlan(s.plan_id, microservicios)
        : s.kind === "aplicacion" && s.microservicio_clave
        ? [((microservicios.porClave || {})[s.microservicio_clave] || {})].filter(Boolean)
        : [];

    return Object.assign({}, s, { estado, precio, aplicaciones });
  });
}

/** Un resumen para arriba de la lista: cuántos y cuántos urgentemente. */
function resumen(lista) {
  const porClave = { activo: 0, por_vencer: 0, en_margen: 0, vencido: 0, sin_fecha: 0 };

  for (const s of lista || []) {
    if (s.estado && s.estado.clave in porClave) porClave[s.estado.clave]++;
  }

  /* Lo que hay que mirar HOY: lo que vence pronto y lo que ya está en
     margen. Son los dos únicos grupos en los que hay que hacer algo. */
  const urgente = porClave.por_vencer + porClave.en_margen + porClave.vencido;

  return Object.assign({ total: (lista || []).length, urgente }, porClave);
}

module.exports = {
  DIAS_DE_MARGEN,
  DIAS_DE_AVISO,
  estadoDe,
  aplicacionesDelPlan,
  precioDe,
  paraCliente,
  resumen,
};