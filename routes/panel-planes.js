const express = require("express");
const auth = require("../lib/auth");
const planesLib = require("../lib/planes");
const { MONEDAS } = require("../lib/monedas");

module.exports = function rutasPlanes({ db, sitio, requiereStaff }) {
  const router = express.Router();

  // Public copy and CTA values are preserved; this form edits only plan settings.
  const EDITABLES = [
    "nombre",
    "precio",
    "moneda",
    "periodo",
    "destacado",
    "orden",
    "activo",
  ];

  async function leerMicroservicios() {
    const { data, error } = await db
      .from("microservicios")
      .select("modulo,nombre,vendible")
      .order("nombre", { ascending: true });

    if (error) {
      console.error("[planes] no se pudieron leer los microservicios: " + error.message);
      return [];
    }
    return data || [];
  }

  const PERIODOS = [
    { valor: "mes", label: "Cada mes" },
    { valor: "trimestre", label: "Cada tres meses" },
    { valor: "anio", label: "Cada año" },
    { valor: "", label: "Sin periodo" },
  ];

  const campo = (idPlan, nombre) => nombre + "_" + idPlan;

  async function leerPlanes() {
    const { data, error } = await db.from("plans").select("*").order("orden");

    if (error) {
      console.error("[planes] no se pudo leer:", error.message);
      return { planes: [], error: "No se pudieron leer los planes: " + error.message };
    }

    return { planes: data || [], error: null };
  }

  let microserviciosCache = null;

  async function microservicios() {
    if (!microserviciosCache) {
      microserviciosCache = await leerMicroservicios();
    }
    return microserviciosCache;
  }

  const vista = async (req, res, datos = {}) =>
    res.render("panel/planes", {
      title: "Planes",
      site: sitio,
      base: "/panel",
      current: "planes",
      noindex: true,
      csrf: req.sesion.csrf_token,
      monedas: MONEDAS,
      periodos: PERIODOS,
      microservicios: await microservicios(),
      campo,
      errores: {},
      ...datos,
    });

  router.get("/planes", requiereStaff, async (req, res) => {
    const { planes, error } = await leerPlanes();

    await vista(req, res, { planes, errores: error ? { general: error } : {} });
  });

  router.post("/planes", requiereStaff, async (req, res) => {
    const cuerpo = req.body || {};

    const { planes, error: errorLectura } = await leerPlanes();

    if (errorLectura) {
      return vista(req, res, { planes, errores: { general: errorLectura } });
    }

    const problemas = {};
    const cambiosPorPlan = new Map();

    const listaMicroservicios = await microservicios();
    const clavesValidas = new Set(listaMicroservicios.map((m) => m.modulo));

    for (const p of planes) {
      const cambios = {};
      const erroresFila = {};

      const nombreApps = campo(p.id, "aplicaciones");

      // Checkbox values repeat in the request and must match known microservices.
      if (nombreApps in cuerpo) {
        const bruto = cuerpo[nombreApps];
        const lista = Array.isArray(bruto) ? bruto : [bruto];

        const limpias = lista
          .map((x) => String(x).trim())
          .filter((x) => x !== "");

        const repetidas = [...new Set(limpias.filter((x, i) => limpias.indexOf(x) !== i))];
        const desconocidas = [...new Set(limpias.filter((x) => !clavesValidas.has(x)))];

        if (desconocidas.length) {
          erroresFila.aplicaciones =
            "Hay aplicaciones que no existen: " + desconocidas.join(", ") + ".";
        } else if (repetidas.length) {
          erroresFila.aplicaciones =
            "La misma aplicación está marcada dos veces: " + repetidas.join(", ") + ".";
        } else {
          cambios.aplicaciones = limpias;
        }
      }

      for (const nombre of EDITABLES) {
        if (!(campo(p.id, nombre) in cuerpo)) continue;

        const bruto = cuerpo[campo(p.id, nombre)];

        if (nombre === "precio") {
          const texto = String(bruto).trim();

          if (texto === "") {
            cambios.precio = null;
            continue;
          }

          // Normalize Argentine thousands and decimal separators.
          const limpio = texto.replace(/\./g, "").replace(",", ".");
          const numero = Number(limpio);

          if (limpio === "" || !Number.isFinite(numero)) {
            erroresFila.precio = "No es un número. O vacío, que es «A consultar».";
            continue;
          }
          if (numero < 0) {
            erroresFila.precio = "No puede ser negativo.";
            continue;
          }
          if (numero > 1000000000) {
            erroresFila.precio = "Eso parece una errata.";
            continue;
          }

          cambios.precio = numero;
          continue;
        }

        if (nombre === "moneda") {
          const val = String(bruto).trim().toUpperCase();
          if (!/^[A-Z]{3}$/.test(val)) {
            erroresFila.moneda = "Tres letras, como ARS.";
            continue;
          }
          cambios.moneda = val;
          continue;
        }

        if (nombre === "nombre") {
          const val = String(bruto).trim();
          if (val.length < 2 || val.length > 60) {
            erroresFila.nombre = "Entre 2 y 60 caracteres.";
            continue;
          }
          cambios.nombre = val;
          continue;
        }

        if (nombre === "destacado" || nombre === "activo") {
          // Hidden input and checkbox values can arrive as an array; the checkbox is last.
          const valor = Array.isArray(bruto) ? bruto[bruto.length - 1] : bruto;
          cambios[nombre] = valor === "1" || valor === "true" || valor === true;
          continue;
        }

        if (nombre === "orden") {
          const numero = Number(String(bruto).trim());
          if (!Number.isFinite(numero) || numero < 0 || numero > 999) {
            erroresFila.orden = "Un número del 0 al 999.";
            continue;
          }
          cambios.orden = Math.trunc(numero);
          continue;
        }

        cambios[nombre] = String(bruto === undefined || bruto === null ? "" : bruto).trim();
      }

      if (Object.keys(erroresFila).length) {
        problemas[p.id] = erroresFila;
        continue;
      }

      const diff = {};
      for (const k of Object.keys(cambios)) {
        const antes = Array.isArray(p[k]) ? p[k].join("\n") : p[k];
        const ahora = Array.isArray(cambios[k]) ? cambios[k].join("\n") : cambios[k];
        if (String(antes ?? "") !== String(ahora ?? "")) {
          diff[k] = { de: antes, a: ahora };
        }
      }

      if (Object.keys(diff).length) cambiosPorPlan.set(p.id, { cambios, diff });
    }

    // Keep the multi-plan save atomic when any submitted field is invalid.
    if (Object.keys(problemas).length) {
      return vista(req, res, {
        planes,
        errores: problemas,
        aviso: "No se guardó nada. Revisa lo marcado en rojo; lo demás se queda como estaba.",
      });
    }

    if (!cambiosPorPlan.size) {
      return vista(req, res, { planes, aviso: "No había nada que cambiar." });
    }

    const errores = {};

    for (const [id, { cambios, diff }] of cambiosPorPlan) {
      const { error } = await db.from("plans").update(cambios).eq("id", id);

      if (error) {
        console.error("[planes] no se pudo guardar " + id + ":", error.message);
        errores[id] = { general: "No se pudo guardar: " + error.message };
        continue;
      }

      await auth.auditar(db, {
        actor: { id: req.sesion.user_id, email: null },
        accion: "editar",
        entidad: "plans",
        entidadId: id,
        detalle: diff,
        req,
      });
    }

    planesLib.olvidar();

    const { planes: frescos } = await leerPlanes();
    const guardados = cambiosPorPlan.size - Object.keys(errores).length;

    await vista(req, res, {
      planes: frescos,
      errores,
      aviso:
        guardados > 0
          ? "Guardado: " + guardados + (guardados === 1 ? " plan." : " planes.") +
            " Ya se ve en la web pública."
          : "No se pudo guardar nada.",
    });
  });

  return router;
};