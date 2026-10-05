/* =========================================================
   Nexo Studio — Perfil del cliente: ficha y facturación
   ------------------------------------------------------------
   Lo que el cliente escribe sobre su negocio y sobre a quién se le
   factura.

   POR QUÉ EL CLIENTE PUEDE EDITARLO
   ---------------------------------
   Porque son sus datos. Si el banco le cambia la cuenta o se equivoca
   al escribir el IBAN, no debería tener que llamarnos. Enseñar datos
   que no puede corregir es peor que no enseñarlos.

   LO QUE NO PUEDE TOCAR: `regimen_iva`
   ------------------------------------
   Si un cliente se cambia a 'exento', se está quitando el IVA a sí
   mismo. Eso lo pone el equipo. No se puede hacer con una política RLS
   (el RLS no distingue columnas dentro de un UPDATE), así que se
   comprueba aquí: si viene un regimen_iva y el que lo manda no es
   staff, se ignora en silencio y se avisa.

   Ignorar y avisar, y no devolver 403: el cliente está rellenando su
   dirección en el mismo formulario, y perder todo lo escrito por un
   campo que no le toca sería una falta de respeto.

   ========================================================= */

const supabase = require("../lib/supabase");

/* Lo que un cliente puede escribir de la ficha. Lista explícita: si
   mañana alguien manda un campo de más, se ignora en vez de guardarse
   en la base. */
const CAMPOS_FICHA = [
  "cif",
  "direccion",
  "codigo_postal",
  "ciudad",
  "provincia",
  "pais",
  "sector",
  "web",
  "instagram",
  "facebook",
  "linkedin",
  "whatsapp",
];

/* Lo mismo para facturación. `regimen_iva` NO está: lo controla la
   ruta según el rol. */
const CAMPOS_FACTURACION = [
  "razon_social",
  "nif",
  "direccion",
  "codigo_postal",
  "ciudad",
  "provincia",
  "pais",
  "email",
  "iban",
  "notas",
];

/** Lo que llega del formulario, quedándose solo con lo permitido. */
function soloCampos(entrada, permitidos) {
  const salida = {};
  for (const campo of permitidos) {
    const v = entrada[campo];
    if (v === undefined || v === null) continue;
    salida[campo] = String(v).trim() || null;
  }
  return salida;
}

/**
 * Normaliza un número de WhatsApp a dígitos con prefijo.
 *
 * Por qué: para abrir el chat hace falta un formato único. "600 111
 * 222", "+34 600111222" y "34600111222" son el mismo número, y si se
 * guardan tal cual el enlace wa.me no funciona en unos casos y en
 * otros abre el número equivocado.
 *
 * Casos que hay que cubrir, y que no cubren solo con quitar los no
 * dígitos:
 *   "600 111 222"        → 34600111222   (9 dígitos, es español)
 *   "+34 600 111 222"    → 34600111222
 *   "0034 600 111 222"   → 34600111222   (el 00 es prefijo internacional)
 *   "34 600 111 222"     → 34600111222   (prefijo pegado)
 *   "+44 20 7123 4567"   → 442071234567  (extranjero, NO lleva 34)
 */
function whatsappLimpio(v) {
  if (!v) return null;

  let digitos = String(v).replace(/\D/g, "");
  if (!digitos) return null;

  /* El prefijo internacional '00' (o el '+', que ya no está) sobra
     siempre. Sin este paso, '0034600111222' se guardaba con 00 delante
     y el enlace wa.me abría un número inexistente. */
  if (digitos.startsWith("00")) digitos = digitos.slice(2);

  /* Sin prefijo y de longitud española: se lo ponemos. */
  if (digitos.length === 9) return "34" + digitos;

  /* Ya trae prefijo (34..., 44..., 34 6...). Se quita el 34 si viene
     duplicado por un error de tecleo: '3434600111222'. */
  if (digitos.startsWith("34") && digitos.length === 13) {
    digitos = digitos.slice(2);
  }

  return digitos;
}

/** ¿Parece una URL? Muy básica a propósito: es para dar error pronto,
    no para validar de verdad (ver PENDIENTES.md). */
function pareceUrl(v) {
  if (!v) return true;
  return /^(https?:\/\/|www\.)?[^\s]+\.[a-z]{2,}/i.test(String(v));
}

const ERRORES_URL = {
  web: "La web no parece una dirección válida.",
  instagram: "El perfil de Instagram no parece válido.",
  facebook: "El perfil de Facebook no parece válido.",
  linkedin: "El perfil de LinkedIn no parece válido.",
};

/**
 * Valida los enlaces y devuelve {datos, errores}.
 * @returns {{datos: object, errores: object}}
 */
function prepararFicha(entrada) {
  const datos = soloCampos(entrada, CAMPOS_FICHA);
  const errores = {};

  if (datos.whatsapp) datos.whatsapp = whatsappLimpio(datos.whatsapp);

  for (const [campo, mensaje] of Object.entries(ERRORES_URL)) {
    if (datos[campo] && !pareceUrl(datos[campo])) errores[campo] = mensaje;
  }

  /* Los enlaces libres llegan como texto: uno por línea, "texto|url".
     Es más fácil de escribir a mano en un textarea que un JSON, y aquí
     los escribe una persona, no una API. */
  const crudo = entrada.enlaces;
  const enlaces = [];

  if (Array.isArray(crudo)) {
    enlaces.push(...crudo);
  } else if (typeof crudo === "string" && crudo.trim()) {
    for (const linea of crudo.split(/\r?\n/)) {
      const t = linea.trim();
      if (!t) continue;
      const i = t.indexOf("|");
      if (i === -1) {
        errores.enlaces = "Cada enlace va como «texto|dirección», separados por líneas.";
        break;
      }
      const etiqueta = t.slice(0, i).trim();
      const url = t.slice(i + 1).trim();
      if (!etiqueta || !url) {
        errores.enlaces = "Hay un enlace sin texto o sin dirección.";
        break;
      }
      if (!pareceUrl(url)) {
        errores.enlaces = "«" + url + "» no parece una dirección válida.";
        break;
      }
      enlaces.push({ etiqueta, url });
    }
  }

  if (!errores.enlaces) datos.enlaces = enlaces;

  /* Sin esto, un textarea con 500 líneas guardaría 500 enlaces y la
     página se volvería lenta sin avisar. */
  if (enlaces.length > 20) {
    errores.enlaces = "Máximo 20 enlaces. Quita los que no Uses.";
  }

  return { datos, errores };
}

/** Facturación. Devuelve lo mismo que prepararFicha. */
function prepararFacturacion(entrada, esStaff) {
  const datos = soloCampos(entrada, CAMPOS_FACTURACION);
  const errores = {};
  let aviso = null;

  if (!datos.razon_social) errores.razon_social = "Pon la razón social (el nombre legal).";
  if (!datos.email) {
    errores.email = "Pon un email: ahí es donde llegan las facturas.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(datos.email)) {
    errores.email = "Ese email no parece válido.";
  }

  if (datos.codigo_postal && !/^\d{5}$/.test(datos.codigo_postal)) {
    errores.codigo_postal = "El código postal son 5 números.";
  }

  /* El régimen de IVA: solo staff. */
  const regimen = String(entrada.regimen_iva || "").trim();
  const VALIDOS = ["general", "reducido", "superreducido", "exento", "equivalencia"];
  if (regimen && VALIDOS.includes(regimen)) {
    if (esStaff) {
      datos.regimen_iva = regimen;
    } else {
      /* Se ignora en vez de rechazar: el cliente está rellenando más
         campos en el mismo formulario. */
      aviso =
        "El régimen de IVA lo pone el equipo. Guarda el resto y avísanos si esto está mal.";
    }
  }

  return { datos, errores, aviso };
}

/**
 * Guarda la ficha. Inserta o actualiza según exista.
 *
 * upsert y no "if (!existe) insert else update": entre el if y el
 * insert hay una ventana en la que otra petición puede crear la fila,
 * y entonces el update no cambia nada y el usuario cree que sí.
 */
async function guardarFicha(db, clientId, datos) {
  const { error } = await db.from("fichas").upsert(
    { ...datos, client_id: clientId },
    { onConflict: "client_id" }
  );
  if (error) throw new Error(error.message);
}

async function guardarFacturacion(db, clientId, datos) {
  const { error } = await db.from("facturacion").upsert(
    { ...datos, client_id: clientId },
    { onConflict: "client_id" }
  );
  if (error) throw new Error(error.message);
}

/** Qué falta por rellenar, para el aviso del panel. Un solo sitio. */
function pendientes(perfil) {
  const f = (perfil && perfil.ficha) || {};
  const fa = (perfil && perfil.facturacion) || {};

  const faltan = [];

  if (!f.cif) faltan.push("el CIF");
  if (!f.direccion) faltan.push("la dirección");
  if (!f.ciudad) faltan.push("la ciudad");
  if (!f.web) faltan.push("la web");

  if (!fa.razon_social) faltan.push("la razón social");
  if (!fa.email) faltan.push("el email de facturación");
  if (!fa.iban) faltan.push("la cuenta o IBAN");

  return faltan;
}

module.exports = {
  prepararFicha,
  prepararFacturacion,
  guardarFicha,
  guardarFacturacion,
  pendientes,
  whatsappLimpio,
  pareceUrl,
  CAMPOS_FICHA,
  CAMPOS_FACTURACION,
};
