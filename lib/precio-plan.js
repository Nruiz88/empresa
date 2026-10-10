function precioPlan(bruto) {
  const texto = String(bruto).trim();
  if (!texto || !/^-?[\d.,]+$/.test(texto)) return null;

  const negativo = texto.startsWith("-");
  const valor = negativo ? texto.slice(1) : texto;
  const comas = [...valor.matchAll(/,/g)].map((m) => m.index);
  const puntos = [...valor.matchAll(/\./g)].map((m) => m.index);

  let entero;
  let decimal = "";

  if (comas.length && puntos.length) {
    const separadorDecimal = comas[comas.length - 1] > puntos[puntos.length - 1] ? "," : ".";
    const separadorMiles = separadorDecimal === "," ? "." : ",";
    const partes = valor.split(separadorDecimal);
    if (partes.length !== 2 || !/^\d+$/.test(partes[1])) return null;

    const grupos = partes[0].split(separadorMiles);
    if (!gruposValidos(grupos)) return null;
    entero = grupos.join("");
    decimal = partes[1];
  } else {
    const separador = comas.length ? "," : puntos.length ? "." : null;
    if (!separador) {
      entero = valor;
    } else {
      const partes = valor.split(separador);
      if (partes.some((parte) => !/^\d+$/.test(parte))) return null;

      if (partes.length === 2 && partes[1].length !== 3) {
        entero = partes[0];
        decimal = partes[1];
      } else if (gruposValidos(partes)) {
        entero = partes.join("");
      } else {
        return null;
      }
    }
  }

  const numero = Number((negativo ? "-" : "") + entero + (decimal ? "." + decimal : ""));
  return Number.isFinite(numero) ? numero : null;
}

function gruposValidos(grupos) {
  return grupos.length > 1 && /^[0-9]{1,3}$/.test(grupos[0]) &&
    grupos.slice(1).every((grupo) => /^\d{3}$/.test(grupo));
}

module.exports = precioPlan;
