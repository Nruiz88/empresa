/* =========================================================
   Nexo Studio — Panel: catálogo de productos
   ------------------------------------------------------------
   Lo que se VENDE. No confundir con `services`, que es lo que cada
   cliente ha contratado:

     modules    el catálogo: qué existe y a qué precio
     services   los contratos: qué tiene cada cliente, y a qué precio

   ── POR QUÉ ESTA PANTALLA NO EXISTÍA ──

   Porque los precios se cambiaban con una cuenta atrás a mano, en
   `db/seed.js`. Es decir, cambiar el precio de un producto —lo más
   normal del mundo en un negocio— exigía editar código y acordarse
   de dejar el valor puesto.

   Y el resultado era peor que incómodo: como no había forma de
   cambiarlos desde la aplicación, nadie los cambiaba, y el catálogo
   seguía con los 49/79/39 en euros de cuando se hizo la demo. Eso es
   literalmente lo que el cliente veía en su portal.

   ── UN SOLO FORMULARIO PARA TODA LA TABLA ──

   Se podría hacer un formulario por fila. No, porque entonces hay N
   botones "Guardar" que compiten entre sí y hay que acertar cuál es
   el del módulo que estás editando. Con uno solo se edita y se
   guarda, que es como se rellena una hoja de cálculo.

   ── EL SERVIDOR DECIDE QUÉ PRODUCTOS EXISTEN ──

   El formulario manda campos con el nombre del módulo dentro:
   `precio_bot_whatsapp`. El POST NO recorre lo que le llegue, sino
   que pregunta a la base qué módulos hay y lee ese campo de cada uno.

   Recorrer el POST sería un agujero: cualquiera podría mandar
   `id=inventario&precio=0` para tocar un módulo que no existe, o
   inventar filas. Leyendo desde la lista de la base, un módulo que
   no existe es un campo que el formulario no tiene y el servidor no
   busca.

   ── LO QUE ESTA PANTALLA NO TOCA ──

   · Los servicios ya contratados. Cambiar el precio del catálogo no
     cambia lo que paga un cliente que ya lo tiene: para eso están
     `services.importe` y los cobros. Si se mezclara, cambiar el
     precio de un producto reescribiría la historia de las facturas.

   · La disponibilidad. `disponible` y `retirado` controlan si algo
     se vende y NO se editan aquí a propósito: poner algo a la venta
     es una decisión con más detrás que un precio —¿está el software
     desplegado?, ¿tiene url?—, y la pantalla de Salud avisa de
     justo esas incoherencias.
   ========================================================= */

const express = require("express");
const auth = require("../lib/auth");
const { vacioANull } = require("../lib/validate");

module.exports = function rutasCatalogo({ db, sitio, csrf, requiereStaff }) {
  const router = express.Router();

  /* Los campos que esta pantalla puede cambiar, y solo estos.

     Una lista y no "cualquier columna": si mañana alguien mete un
     `update(cuerpo)` por comodidad, editable desde el navegador y sin
     auditoría, es un agujero esperando. */
  const EDITABLES = ["nombre", "descripcion", "precio", "moneda", "periodicidad", "componentes", "url"];

  /* Las etiquetas del desplegable de moneda.

     Cortas a propósito: la primera versión ponía "ARS · pesos
     argentinos" y en la tabla se leía "ARS · peso," cortado a media
     palabra. Con tres columnas estrechas, un texto largo dentro de
     un select se corta y además varía con el ancho de la pantalla,
     así que aquí no cabe.

     El nombre largo va en el título de la opción, que es donde se
     consulta el detalle sin estorbar a la lectura. */
const { MONEDAS } = require("../lib/monedas");

  const PERIODOS = [
    { valor: "", label: "Sin periodicidad" },
    { valor: "mensual", label: "Cada mes" },
    { valor: "trimestral", label: "Cada tres meses" },
    { valor: "anual", label: "Cada año" },
    { valor: "unica", label: "Una sola vez" },
  ];

  /* El aviso sobre la web pública.

     Vive en la pantalla y no solo en un comentario de este archivo,
     porque el sitio donde alguien va a cambiar un precio para siempre
     es aquí. Sin este aviso, el primer "cambié el precio y la web
     sigue igual" se juega resolviendo mal: buscando un fallo que no
     existe. */
  const AVISO_PUBLICO =
    "Estos son los precios que ve el cliente en su portal. La página pública " +
    "/precios tiene los suyos escritos a mano, en euros, en content/faq.js y " +
    "content/posts.js: se cambian ahí, no desde aquí.";

  /** Nombre del campo en el formulario para un módulo y un campo */
  const campo = (idModulo, nombre) => nombre + "_" + idModulo;

  /** Los módulos, con cuántos clientes tienen cada uno */
  async function leerCatalogo() {
    const { data: modulos, error } = await db.from("modules").select("*").order("nombre");

    if (error) {
      console.error("[catalogo] no se pudo leer:", error.message);
      return { modulos: [], error: "No se pudo leer el catálogo: " + error.message };
    }

    /* Cuántos clientes tienen cada módulo.

       Va aquí porque es la pregunta que sale al mirar un precio:
       "¿esto lo tiene alguien?". Sin el número, un precio se cambia
       sin saber si detrás hay veinte clientes pagando otra cosa. */
    const { data: usos } = await db.from("suscripciones").select("modulo");

    const conteo = new Map();
    for (const u of usos || []) {
      conteo.set(u.modulo, (conteo.get(u.modulo) || 0) + 1);
    }

    return {
      modulos: (modulos || []).map((m) => ({ ...m, clientes: conteo.get(m.id) || 0 })),
      error: null,
    };
  }

  const vista = (req, res, datos = {}) =>
    res.render("panel/catalogo-admin", {
      title: "Catálogo",
      site: sitio,
      base: "/panel",
      current: "catalogo",
      noindex: true,
      csrf: req.sesion.csrf_token,
      monedas: MONEDAS,
      periodos: PERIODOS,
      avisoPublico: AVISO_PUBLICO,
      campo,
      errores: {},
      ...datos,
    });

  /* ============================ Ver ============================ */
  router.get("/catalogo", requiereStaff, async (req, res) => {
    const { modulos, error } = await leerCatalogo();
    vista(req, res, { modulos, errores: error ? { general: error } : {} });
  });

  /* ============================ Guardar ============================ */

  router.post("/catalogo", requiereStaff, async (req, res) => {
    const cuerpo = req.body || {};

    /* Qué hay en la base, no qué dice el formulario. Ver la nota del
       principio del archivo. */
    const { modulos, error: errorLectura } = await leerCatalogo();

    if (errorLectura) {
      return vista(req, res, { modulos, errores: { general: errorLectura } });
    }

    const problemas = {};
    const cambiosPorModulo = new Map();

    for (const m of modulos) {
      const cambios = {};
      const erroresFila = {};

      for (const nombre of EDITABLES) {
        /* Si el formulario no trae el campo, no se toca esa columna.
           Así, cambiar solo el precio no borra la descripción: es un
           formulario de "cambia lo que has tocado", no de "copia
           todo lo que hay". */
        if (!(campo(m.id, nombre) in cuerpo)) continue;

        const bruto = cuerpo[campo(m.id, nombre)];

        if (nombre === "precio") {
          /* Acepta "49", "49,50", "1.500" y "1234.56".

             Los puntos se quitan antes de convertir, porque si no
             "1.500" se lee como uno coma cinco y un precio se
             convierte en un problema de aritmética. Y el separador
             de millares se quita siempre, porque en Argentina los
             precios se escriben con punto y el usuario va a escribir
             "25.000" queriendo decir veinticinco mil. */
          const texto = String(bruto).trim();
          const limpio = texto.replace(/\./g, "").replace(",", ".");
          const numero = Number(limpio);

          if (texto === "" || limpio === "" || !Number.isFinite(numero)) {
            erroresFila.precio = "No es un número.";
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
          if (val.length < 3 || val.length > 120) {
            erroresFila.nombre = "Entre 3 y 120 caracteres.";
            continue;
          }
          cambios.nombre = val;
          continue;
        }

        cambios[nombre] = vacioANull(bruto);
      }

      if (Object.keys(erroresFila).length) {
        problemas[m.id] = erroresFila;
        continue;
      }

      /* Solo se guarda lo que ha cambiado de verdad.

         Sin esto, abrir la pantalla y darle a Guardar sin tocar nada
         escribiría las mismas filas y llenaría la auditoría de
         entradas sin motivo, que es como un registro de auditoría
         deja de servir para nada. */
      const diff = {};
      for (const k of Object.keys(cambios)) {
        if (String(m[k] ?? "") !== String(cambios[k] ?? "")) {
          diff[k] = { de: m[k], a: cambios[k] };
        }
      }

      if (Object.keys(diff).length) cambiosPorModulo.set(m.id, { cambios, diff });
    }

    /* Si algo está mal, no se guarda NADA.

         Guardar las filas buenas y dejar las malas fuera deja la tabla
         a medias sin que nadie lo sepa: el precio de un producto
         cambia y el de otro no, y no hay señal de por qué. Se
         escribe todo o nada, que además es lo que espera alguien
         que está corrigiendo dos campos. */
    if (Object.keys(problemas).length) {
      return vista(req, res, {
        modulos,
        errores: problemas,
        aviso: "No se guardó nada. Revisa lo marcado en rojo; lo demás se queda como estaba.",
      });
    }

    if (!cambiosPorModulo.size) {
      return vista(req, res, { modulos, aviso: "No había nada que cambiar." });
    }

    /* Un UPDATE por módulo cambiado.

         Un único update con un array no existe en una API REST como
         esta, y meterlos todos en una llamada solo significa que o se
         guardan todos o no se guarda ninguno. Aquí, con pocos módulos
         y errores claros, uno a uno da un mensaje que dice qué módulo
         falló y por qué. */
    const errores = {};

    for (const [id, { cambios, diff }] of cambiosPorModulo) {
      const { error } = await db.from("modules").update(cambios).eq("id", id);

      if (error) {
        console.error("[catalogo] no se pudo guardar " + id + ":", error.message);
        errores[id] = { general: "No se pudo guardar: " + error.message };
        continue;
      }

      /* El diff guarda el valor ANTERIOR, que ya no está en la fila.

         Un cambio de precio es de los pocos que se nota meses
         después —"¿cuándo lo subimos?"— y sin el valor viejo en el
         registro no hay manera de saberlo. Por eso el detalle guarda
         `de`/`a` y no solo el valor nuevo. */
      await auth.auditar(db, {
        actor: { id: req.sesion.user_id, email: null },
        accion: "editar",
        entidad: "modules",
        entidadId: id,
        detalle: diff,
        req,
      });
    }

    const { modulos: frescos } = await leerCatalogo();

    const guardados = cambiosPorModulo.size - Object.keys(errores).length;

    vista(req, res, {
      modulos: frescos,
      errores,
      aviso:
        guardados > 0
          ? "Guardado: " + guardados + (guardados === 1 ? " producto." : " productos.")
          : null,
    });
  });

  return router;
};