/* =========================================================
   Nexo Studio — Validación de formularios del panel
   ------------------------------------------------------------
   Sin esto, el panel confía en lo que le manden por POST. Con
   esto, cada campo se comprueba en el servidor y se le vuelve a
   enseñar el formulario a la persona con el error marcado.

   Por qué validar SIEMPRE en el servidor: la validación del
   navegador (required, type=email) es una cortesía. Se puede
   saltar con curl en dos segundos.

   Cada regla devuelve un string (el error) o undefined (ok),
   y el resultado se pinta junto al campo correspondiente.
   ========================================================= */

const reglas = {
  requerido: (v) => (v && String(v).trim() ? undefined : "Este campo es obligatorio."),

  texto: (v, { max = 200, min = 0 } = {}) => {
    const s = String(v || "").trim();
    if (!s && min > 0) return "Este campo es obligatorio.";
    // Antes esto no miraba min cuando el campo venía relleno:
    // ponía 'X' con min:3 y pasaba el filtro.
    if (s && s.length < min) {
      return `Pon al menos ${min} caracteres (llevas ${s.length}).`;
    }
    if (s.length > max) return `Máximo ${max} caracteres (llevas ${s.length}).`;
    return undefined;
  },

  email: (v) => {
    const s = String(v || "").trim();
    if (!s) return undefined;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return "Este email no parece válido.";
    return undefined;
  },

  telefono: (v) => {
    const s = String(v || "").trim();
    if (!s) return undefined;
    if (!/^[+\d][\d\s().-]{6,20}$/.test(s)) return "Usa solo números, espacios y +.";
    return undefined;
  },

  /** Importe en euros: admite "1.234,56" y "1234.56" */
  importe: (v) => {
    const s = String(v || "").trim();
    if (!s) return undefined;
    const normalizado = s.replace(/\./g, "").replace(",", ".");
    const n = Number(normalizado);
    if (isNaN(n)) return "No parece un importe válido.";
    if (n < 0) return "No puede ser negativo.";
    if (n > 9999999) return "Demasiado alto. Repásalo.";
    return undefined;
  },

  fecha: (v) => {
    const s = String(v || "").trim();
    if (!s) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "Usa el formato AAAA-MM-DD.";
    if (isNaN(new Date(s).getTime())) return "Esa fecha no existe.";
    return undefined;
  },

  /** La fecha final no puede ser anterior a la inicial */
  rangoFechas: (fin, inicio) => {
    if (!fin || !inicio) return undefined;
    if (new Date(fin).getTime() < new Date(inicio).getTime()) {
      return "La fecha final no puede ser anterior a la inicial.";
    }
    return undefined;
  },

  unoDe: (v, opciones) => {
    const s = String(v || "").trim();
    if (!s) return undefined;
    if (!opciones.includes(s)) return "Valor no permitido.";
    return undefined;
  },
};

/**
 * Valida un objeto contra un esquema.
 *
 * @param {object} datos     Lo que viene del formulario
 * @param {object} esquema   { campo: [regla, ...opciones] }
 * @returns {{errores: object, datos: object}}
 *          errores = { campo: "mensaje" }, datos = valores limpios
 */
function validar(datos, esquema) {
  const errores = {};
  const limpios = {};

  for (const [campo, reglasCampo] of Object.entries(esquema)) {
    const valor = datos ? datos[campo] : "";
    const lista = Array.isArray(reglasCampo) ? reglasCampo : [reglasCampo];
    limpios[campo] = typeof valor === "string" ? valor.trim() : valor;

    for (const [regla, opciones] of lista) {
      const fn = typeof regla === "string" ? reglas[regla] : regla;
      if (typeof fn !== "function") continue;
      const error = fn.call(reglas, valor, opciones || {});
      if (error) {
        errores[campo] = error;
        break;
      }
    }
  }

  return { errores, datos: limpios };
}

/** Convierte "" en null, para no guardar cadenas vacías en la BD */
const vacioANull = (v) => {
  const s = String(v == null ? "" : v).trim();
  return s === "" ? null : s;
};

module.exports = { reglas, validar, vacioANull };
