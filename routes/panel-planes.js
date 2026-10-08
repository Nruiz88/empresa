/* =========================================================
   Shopcito — Panel: los planes que se venden
   ------------------------------------------------------------
   Dónde se cambia un precio para que salga en la web pública.

   ── POR QUÉ ESTA PANTALLA EXISTE ──

   Porque los precios estaban en `content/shopcito.js`, y eso significa
   que subirlos era editar un fichero y desplegar. En la práctica, no se
   suben nunca: se queda el número viejo y nadie se acuerda de por qué.

   ── ES COPIA DEL CATÁLOGO, Y A PROPÓSITO ──

   `panel-catalogo.js` hace exactamente esto mismo con los módulos:
   un solo formulario para toda la tabla, el servidor pregunta a la base
   qué hay en vez de fiarse de lo que llega, y se escribe todo o nada.

   Es mejor copiar una pantalla que funciona que inventar una nueva. La
   nueva siempre tiene algún detalle peor: valida menos, o avisa menos, o
   guarda a medias.

   ── LO QUE ESTA PANTALLA NO ES ──

   No es la pantalla de los servicios que cada cliente tiene
   contratados (`panel-catalogo` y `services` son eso). Aquí se cambia lo
   que se ofrece; el contrato de un cliente ya hecho tiene su propia
   cifra, y no se toca porque alguien suba un precio.

   ── EL PRECIO PUEDE QUEDAR VACÍO A PROPÓSITO ──

   Vacío es "A consultar". Y hay un campo para eso, porque es un estado
   de verdad: no hay cifra confirmada y publicar un 0 sería decir que el
   producto es gratis.

   Escribir un 0 es tentador porque "vacío" da la impresión de que
   falta un dato. No falta: es la respuesta hasta que haya una cifra.
   ========================================================= */

const express = require("express");
const auth = require("../lib/auth");
const planesLib = require("../lib/planes");
const { MONEDAS } = require("../lib/monedas");

module.exports = function rutasPlanes({ db, sitio, csrf, requiereStaff }) {
  const router = express.Router();

  /* Lo que esta pantalla puede cambiar, y nada más.

     Una lista, no "cualquier columna": si mañana alguien mete un
     `update(cuerpo)` por comodidad, eso es editable desde el navegador
     y sin auditoría. Un agujero esperando. */
  const EDITABLES = [
    "nombre",
    "descripcion",
    "precio",
    "moneda",
    "periodo",
    "incluye",
    "nota",
    "destacado",
    "orden",
    "activo",
    "cta_texto",
    "cta_href",
  ];

  const PERIODOS = [
    { valor: "mes", label: "Cada mes" },
    { valor: "trimestre", label: "Cada tres meses" },
    { valor: "anio", label: "Cada año" },
    { valor: "", label: "Sin periodo" },
  ];

  /** El nombre del campo en el formulario para un plan y un campo */
  const campo = (idPlan, nombre) => nombre + "_" + idPlan;

  async function leerPlanes() {
    const { data, error } = await db.from("plans").select("*").order("orden");

    if (error) {
      console.error("[planes] no se pudo leer:", error.message);
      return { planes: [], error: "No se pudieron leer los planes: " + error.message };
    }

    return { planes: data || [], error: null };
  }

  const vista = (req, res, datos = {}) =>
    res.render("panel/planes", {
      title: "Planes",
      site: sitio,
      base: "/panel",
      current: "planes",
      noindex: true,
      csrf: req.sesion.csrf_token,
      monedas: MONEDAS,
      periodos: PERIODOS,
      campo,
      errores: {},
      ...datos,
    });

  /* ============================ Ver ============================ */
  router.get("/planes", requiereStaff, async (req, res) => {
    const { planes, error } = await leerPlanes();
    vista(req, res, { planes, errores: error ? { general: error } : {} });
  });

  /* ============================ Guardar ============================ */

  router.post("/planes", requiereStaff, async (req, res) => {
    const cuerpo = req.body || {};

    /* Qué hay en la base, no qué dice el formulario.

       Recorrer el POST sería un agujero: cualquiera podría mandar
       `precio_inventario` para tocar algo que no existe. Leyendo desde
       la base, un plan que no existe es un campo que el formulario no
       tiene y el servidor no busca. */
    const { planes, error: errorLectura } = await leerPlanes();

    if (errorLectura) {
      return vista(req, res, { planes, errores: { general: errorLectura } });
    }

    const problemas = {};
    const cambiosPorPlan = new Map();

    for (const p of planes) {
      const cambios = {};
      const erroresFila = {};

      for (const nombre of EDITABLES) {
        /* Si el formulario no trae el campo, no se toca esa columna.

           Cambiar solo el precio no puede borrar la descripción: es un
           formulario de "cambia lo que has tocado", no de "copia todo
           lo que hay". */
        if (!(campo(p.id, nombre) in cuerpo)) continue;

        const bruto = cuerpo[campo(p.id, nombre)];

        if (nombre === "precio") {
          /* VACÍO ES "A CONSULTAR", Y NO ES UN ERROR.

             Es lo que hay hoy, y es un estado legítimo. Si estuviera en
             la lista de errores, la única forma de dejarlo vacío sería
             no tocar el campo, que es justo lo contrario de lo que
             alguien quiere al vaciarlo.

             Y es distinto de un 0: un 0 publicaría que el bot es
             gratis. */
          const texto = String(bruto).trim();

          if (texto === "") {
            cambios.precio = null;
            continue;
          }

          /* Acepta "25000", "25.000" y "25.000,50".

             Los puntos se quitan antes de convertir: en Argentina los
             precios se escriben con punto, y si no se quitaran
             "25.000" se leería como veinticinco y se acabaría
             publicando un precio 1000 veces más pequeño del que se
             quiso. */
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

        if (nombre === "cta_href") {
          /* ESTE VALOR ACABA EN UN `href`. Por eso no se acepta
             cualquier cosa.

             Un `href` puede ser `javascript:alert(1)`, y eso es una vía
             directa a ejecutar código en la página de todos los que la
             vean. También puede ser `//sitio.com`, que manda al
             visitante a otro sitio con el mismo aspecto.

             Solo se permiten rutas internas que empiezan por `/`. Una
             barra y ya: relativo es relativo, y `//` —que parece una
             ruta interna— es en realidad un protocolo heredado que lleva
             a otro dominio. */
          const val = String(bruto).trim();

          /* Y además solo caracteres que existen en una ruta.

             `/contacto<script>` no es peligroso: al pintarlo EJS
             escapa el `<` y sale como texto. Pero sería un enlace
             roto, y una ruta interna no lleva etiquetas. Admitir solo
             lo que una ruta puede llevar hace que el error se vea al
             escribirlo, en vez de aparecer días después como un botón
             que no lleva a ninguna parte. */
          if (!/^\/(?!\/)/.test(val) || !/^[/A-Za-z0-9\-._~?&=%#]*$/.test(val)) {
            erroresFila.cta_href =
              "Una ruta interna: una sola «/» al principio y solo letras, números y los signos de una ruta.";
            continue;
          }
          if (val.length > 200) {
            erroresFila.cta_href = "Demasiado larga.";
            continue;
          }
          cambios.cta_href = val;
          continue;
        }

        if (nombre === "moneda") {
          /* En mayúsculas: `ars` y `ARS` son la misma moneda, y si no se
             normalizara el listado de precios acabaría con dos formas
             de escribir lo mismo. */
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

        if (nombre === "incluye") {
          /* Una línea por elemento.

             Se parte por saltos de línea y se quitan las vacías. Con un
             solo texto con saltos, la lista dependería del formato, y un
             espacio de más al final de una línea se convierte en una
             viñeta suelta en la tarjeta. */
          const lineas = String(bruto)
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(0, 20);

          if (!lineas.length) {
            erroresFila.incluye = "Pon al menos una línea, o deja claro que no incluye nada.";
            continue;
          }

          cambios.incluye = lineas;
          continue;
        }

        if (nombre === "destacado" || nombre === "activo") {
          /* Una casilla sin marcar NO LLEGA en el cuerpo del POST, así
             que la vista pone un campo oculto con el mismo nombre y
             valor "0" justo antes de la casilla. Marcada llegan los dos
             ("0" y "1"); desmarcada, solo el "0".

             Y por eso se mira el ÚLTIMO y no se pregunta si es "on":
             con dos campos del mismo nombre, el parser de Express —que
             usa `qs`— devuelve un ARRAY. Si se comprobara `=== "on"`,
             nunca sería verdad y ninguna casilla se podría marcar
             jamás.

             Es el fallo más difícil de ver de esta pantalla: la casilla
             acepta el clic, la página responde "Guardado", y no cambia
             nada. Nadie lo denuncia porque parece que la web va lenta. */
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

      /* Solo se guarda lo que ha cambiado de verdad.

         Sin esto, abrir la pantalla y darle a Guardar sin tocar nada
         escribiría las mismas filas y llenaría la auditoría de entradas
         sin motivo, que es como un registro de auditoría deja de
         servir. */
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

    /* Si algo está mal, no se guarda NADA.

       Guardar las filas buenas y dejar las malas fuera deja la tabla a
       medias sin que nadie lo sepa: un plan cambia de precio y otro no, y
       no hay señal de por qué. Se escribe todo o nada, que además es lo
       que espera alguien que está corrigiendo dos campos. */
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

      /* El diff guarda el valor ANTERIOR, que ya no está en la fila.

         Un cambio de precio es de los pocos que se nota meses después
         —"¿cuándo lo subimos?"— y sin el valor viejo no hay manera de
         saberlo. */
      await auth.auditar(db, {
        actor: { id: req.sesion.user_id, email: null },
        accion: "editar",
        entidad: "plans",
        entidadId: id,
        detalle: diff,
        req,
      });
    }

    /* El caché de la web pública.

         Sin esto, el precio nuevo no se ve en la portada hasta que
         caducan los veinte segundos. Y alguien que acaba de guardar va a
         mirar la web a los dos segundos: si no ve el cambio, va a
         guardar otra vez, y otra, creyendo que no funciona. */
    planesLib.olvidar();

    const { planes: frescos } = await leerPlanes();
    const guardados = cambiosPorPlan.size - Object.keys(errores).length;

    vista(req, res, {
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