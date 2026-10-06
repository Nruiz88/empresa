/* =========================================================
   Nexo Studio — Demo del bot de WhatsApp
   ------------------------------------------------------------
   La conversación de demostración de la sección de WhatsApp.

   ── LO QUE NO ES ──

   Esto NO es el bot. No abre ninguna conexión, no hay ningún
   WhatsApp detrás y nadie escribe al otro lado. Es un guion de
   respuesta por palabra clave, escrito aquí.

   Está rotulado como demostración en la propia página, en tres
   sitios. Eso no es prudencia por si acaso: es que si alguien cree que
   está hablando con un bot real, puede tomar una decisión de compra
   —o dejar datos personales— sobre una conversación inventada.

   ── POR QUÉ LAS REGLAS ESTÁN DUPLICADAS ──

   El bot de verdad vive en el proyecto wweb, no aquí. Estas reglas
   son una copia de cómo se comporta, y esa copia puede
   desincronizarse: si el bot aprende una palabra nueva, esta
   página no se entera.

   Se acepta porque esto es una demo de venta, no una pieza del
   producto. Si algún día esta demo pasa a ser el bot —o alguien la
   toma como referencia de las reglas— hay que leerlas de la fuente
   o pedirle al bot que las devuelva. Está anotado aquí para que el
   que lo lea dentro de un año lo sepa antes de confiarse.

   ── POR QUÉ SIN DEPENDENCIAS ──

   El sitio ya carga main.js y motion.js. Un archivo más para esto,
   cargado solo desde la sección que lo necesita, para que quien entra
   a leer el blog no descarge el guion de un bot.
   ========================================================= */

(function () {
  "use strict";

  /* ── Las reglas ──
     En el orden que se comprueban: gana la primera que coincide.
     Todas en minúsculas y sin acentos, porque quien escribe desde el
     móvil no lleva tildes casi nunca y "precios" tiene que encontrar
     lo mismo que "precios".

     `nada` es la comodín: la última, la que se aplica cuando no ha
     entrado ninguna. Se pone al final a propósito. */
  const REGLAS = [
    {
      palabras: ["horario", "horarios", "abren", "abierto", "cerrado"],
      respuesta:
        "Estamos de lunes a sábado de 7:00 a 20:30. El domingo cerramos.",
    },
    {
      palabras: ["cita", "citas", "turno", "turnos", "reservar", "reserva", "agenda"],
      respuesta:
        "Claro. Mañana quedan libres a las 10:30 y a las 13:00. ¿Cuál te va mejor?",
    },
    {
      palabras: ["pedido", "pedidos", "encargo", "reparto"],
      respuesta:
        "Dime el número de pedido y te digo en qué está. El último salió ayer a las 18:20.",
    },
    {
      palabras: ["precio", "precios", "cuanto", "cuesta", "tarifa"],
      respuesta:
        "El pan de cada día va de 1,20 € a 8 €. Las tartas se piden bajo pedido, desde 18 €.",
    },
    {
      palabras: ["direccion", "donde", "ubicacion", "ubicación", "mapa"],
      respuesta: "Estamos en la Calle Real 14, esquina con la plaza. Hay parking enfrente.",
    },
    {
      palabras: ["hola", "buenas", "hey"],
      respuesta: "¡Hola! Dime qué necesitas y te lo digo al momento.",
    },
    {
      palabras: ["gracias", "genial", "perfecto"],
      respuesta: "¡A la orden! Aquí me pones cuando quieras.",
    },
  ];

  const RESPUESTA_NADA =
    "No te he entendido del todo. Prueba con «horario», «quiero una cita» o «mi pedido».";

  /* ── Normalización ──
     Es lo que hace un bot de verdad: comparar en minúsculas y sin
     tildes, porque nadie escribe con tildes en un chat. Si aquí se
     comparara en crudo, «Precios» no encontraría «precios» y la
     demo parecería más tonta de lo que es. */
  function normalizar(texto) {
    return texto
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function responder(texto) {
    const limpio = normalizar(texto.trim());

    for (const regla of REGLAS) {
      for (const palabra of regla.palabras) {
        if (limpio.includes(normalizar(palabra))) return regla.respuesta;
      }
    }

    return RESPUESTA_NADA;
  }

  const contenedor = document.querySelector("[data-demo-chat]") ||
    document.querySelector(".wa-chat");
  if (!contenedor) return;

  const entrada = document.getElementById("demo-entrada");
  const formulario = document.querySelector("[data-demo-form]");

  /* ── Pintar un mensaje ──
     `aria-hidden="true"` en la burbuja porque el contenedor ya es un
     `role="log"` con `aria-live`, que anuncia lo que se añade. Sin
     esto, el lector de pantalla lee la burbuja dos veces: una por el
     texto nuevo y otra por el anuncio del live region. */
  function mensaje(texto, de) {
    const div = document.createElement("div");
    div.className = "wa-msg wa-msg--" + de;
    div.setAttribute("aria-hidden", "true");
    div.textContent = texto;

    const hora = document.createElement("span");
    hora.className = "wa-hora";
    hora.textContent = "Ahora";
    div.appendChild(hora);

    contenedor.appendChild(div);
    contenedor.scrollTop = contenedor.scrollHeight;
  }

  /* ── El retardo ──
     Este bot real tarda un poco en contestar. La demo lo hace
     también, y a propósito: si contestara al instante, parecería
     un formulario con respuestas preescritas en vez de una
     conversación.

     Y es lo que avisa de que no hay nadie al otro lado. */
  let esperando = false;

  function preguntar(texto) {
    if (!texto || esperando) return;
    esperando = true;

    mensaje(texto, "user");

    const entradaLive = entrada;
    if (entradaLive) entradaLive.disabled = true;

    setTimeout(() => {
      mensaje(responder(texto), "bot");
      esperando = false;
      if (entradaLive) {
        entradaLive.disabled = false;
        entradaLive.focus();
      }
    }, 650);
  }

  /* ── Los botones de ejemplo ──
     No son adorno: son el camino corto para alguien que no quiere
     escribir. Con teclado se llega igual que a cualquier botón. */
  for (const chip of document.querySelectorAll("[data-demo]")) {
    chip.addEventListener("click", () => {
      preguntar(chip.getAttribute("data-demo"));
    });
  }

  if (formulario) {
    formulario.addEventListener("submit", (ev) => {
      ev.preventDefault();

      const texto = entrada ? entrada.value.trim() : "";
      if (!texto) return;

      entrada.value = "";
      preguntar(texto);
    });
  }
})();