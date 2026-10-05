/* =========================================================
   Nexo Studio — Comportamiento del panel
   ------------------------------------------------------------
   Solo lo que el HTML no puede resolver por sí solo. Tres cosas:

     1. El menú lateral en móvil (se abre, se cierra, se cierra solo).
     2. Copiar la contraseña temporal al portapapeles.
     3. Confirmar antes de lo que no se puede deshacer con un clic.

   IMPORTANTE: aquí no se carga GSAP, Lenis ni motion.js. Esos son
   del sitio público. El panel es una aplicación de gestión: si
   algo necesita animación, se hace en CSS.

   Sin dependencias, sin build. Un archivo y ya.
   ========================================================= */

(function () {
  "use strict";

  /* ---------- 1. Menú lateral ----------
     Por debajo de 1000px el lateral es un cajón. En escritorio el
     botón no existe, así que todo esto es inocuo. */
  const lateral = document.getElementById("panel-side");
  const velo = document.querySelector(".panel-scrim");
  const botonAbrir = document.querySelector("[data-panel-abrir]");

  function abrirLateral() {
    if (!lateral) return;
    lateral.classList.add("is-open");
    if (velo) velo.classList.add("is-visible");
    if (botonAbrir) botonAbrir.setAttribute("aria-expanded", "true");
    /* El foco va al lateral para que quien navega con teclado no
       siga pulsando sobre el contenido que tiene debajo. */
    const primero = lateral.querySelector("a, button");
    if (primero) primero.focus();
  }

  function cerrarLateral() {
    if (!lateral) return;
    lateral.classList.remove("is-open");
    if (velo) velo.classList.remove("is-visible");
    if (botonAbrir) botonAbrir.setAttribute("aria-expanded", "false");
  }

  if (botonAbrir) botonAbrir.addEventListener("click", abrirLateral);

  document.addEventListener("click", function (ev) {
    /* Cualquier clic en "cerrar" cierra: el velo, la X del lateral o
       el propio botón. */
    if (ev.target.closest("[data-panel-cerrar]")) cerrarLateral();
  });

  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") cerrarLateral();
  });

  /* Al pulsar un enlace del menú en móvil, se cierra: si no, al
     llegar a la página nueva el cajón sigue abierto encima. */
  if (lateral) {
    lateral.addEventListener("click", function (ev) {
      if (ev.target.closest("a") && window.matchMedia("(max-width: 1000px)").matches) {
        cerrarLateral();
      }
    });
  }

  /* ---------- 2. Copiar al portapapeles ----------
     Se usa la API del navegador y no un input con el texto
     seleccionado: seleccionar para copiar obliga a pulsar Ctrl+C, y
     quien está en el móvil no puede. */
  document.addEventListener("click", function (ev) {
    const boton = ev.target.closest("[data-copiar]");
    if (!boton) return;

    const texto = boton.getAttribute("data-copiar");
    const original = boton.textContent;

    const avisar = (txt, restaurar) => {
      boton.textContent = txt;
      boton.disabled = true;
      setTimeout(function () {
        boton.textContent = original;
        boton.disabled = false;
        if (restaurar) restaurar.focus();
      }, 2200);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto)
        .then(function () { avisar("Copiado ✓"); })
        .catch(function () { avisar("No se pudo copiar"); });
      return;
    }

    /* Navegadores viejos, o sin contexto seguro (http en una IP). */
    try {
      const aux = document.createElement("textarea");
      aux.value = texto;
      aux.setAttribute("readonly", "");
      aux.style.position = "fixed";
      aux.style.left = "-9999px";
      document.body.appendChild(aux);
      aux.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(aux);
      avisar(ok ? "Copiado ✓" : "Selecciona y copia");
    } catch {
      avisar("Selecciona y copia");
    }
  });

  /* ---------- 3. Confirmar lo que no se puede deshacer ----------
     Desactivar el acceso de un cliente se revierte con un clic, pero
     mientras tanto esa persona no entra: preguntar sale más barato
     que el susto. */
  document.addEventListener("submit", function (ev) {
    const aviso = ev.target.getAttribute("data-confirmar");
    if (aviso && !window.confirm(aviso)) ev.preventDefault();
  });
})();
