/* =========================================================
   Nexo Studio — Comportamiento del panel
   ------------------------------------------------------------
   Solo lo que el HTML no puede resolver por sí solo. Cuatro cosas:

     1. El menú lateral en móvil (se abre, se cierra, se cierra solo).
     2. Copiar la contraseña temporal al portapapeles.
     3. Confirmar antes de lo que no se puede deshacer con un clic.
     4. El tema visual, que no lo tenía.

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

  /* ---------- 1 bis. El menú de «Nuevo» ----------
     El `<details>` se abre y se cierra con HTML, y eso basta para
     usarlo. Lo que HTML no sabe hacer es cerrarlo cuando se pulsa
     FUERA, y un menú que se queda abierto tapando la pantalla
     mientras se sigue trabajando es molesto de verdad.

     Tres líneas: clic fuera, Escape y Escape también devuelve el
     foco al botón, para no perderlo en el body. */
  document.addEventListener("click", function (ev) {
    document.querySelectorAll(".panel-rapido[open], .panel-user-menu[open]").forEach(function (d) {
      if (!d.contains(ev.target)) d.removeAttribute("open");
    });
  });

  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape") return;
    const abierto = document.querySelector(".panel-rapido[open], .panel-user-menu[open]");
    if (!abierto) return;
    abierto.removeAttribute("open");
    const resumen = abierto.querySelector("summary");
    if (resumen) resumen.focus();
  });

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
    if (aviso && !window.confirm(aviso)) {
      ev.preventDefault();
      return;
    }

    /* Bloquear el reenvío.

       En una conexión lenta el botón sigue vivo entre el clic y la
       respuesta, y dos clics seguidos crean el cobro dos veces. Se
       desactiva en cuanto el formulario se envía y se vuelve a
       activar a los cinco segundos por si el envío no llegó a
       navegar (por ejemplo, si el servidor responde con errores). */
    const b = ev.target.querySelector('button[type="submit"]:not([disabled])');
    if (b) {
      /* Se desactiva en el siguiente turno, no ahora.

         Desactivar el botón DENTRO del evento de envío puede dejar
         fuera su `name`/`value` del formulario que se manda, porque el
         navegador recoge los datos después. Con el `setTimeout(…, 0)`
         ya se ha ido y solo entonces se apaga. */
      window.setTimeout(function () {
        b.disabled = true;
        b.setAttribute("aria-busy", "true");
        window.setTimeout(function () {
          b.disabled = false;
          b.removeAttribute("aria-busy");
        }, 5000);
      }, 0);
    }
  });

  /* ---------- 3 bis. Un cambio de estado, sin botón ----------
     Los `select` con `data-auto` envían su formulario al cambiar.

     Es lo que faltaba en el listado de servicios: se elegía otro
     estado y no pasaba nada, porque el formulario no tenía botón ni
     nada que lo enviara. El estado sí se podía cambiar desde la ficha
     del cliente, que sí tiene su botón «Cambiar»; aquí no. */
  document.addEventListener("change", function (ev) {
    const s = ev.target.closest("select[data-auto]");
    if (s && s.form) s.form.submit();
  });

  /* ---------- 3 ter. Los avisos flotantes ----------
     Un «guardado» que empuja toda la página hacia abajo es un salto
     en cada acción. Los avisos marcados con `data-toast` se sacan de
     la página, se muestran abajo a la derecha y se van solos.

     Las alertas que no llevan la marca (las de Salud, por ejemplo)
     se quedan donde están: esas explican un estado y hay que poder
     leerlas con calma. */
  (function toasts() {
    const avisos = document.querySelectorAll(".panel-alert--ok[data-toast]");
    if (!avisos.length) return;

    const capa = document.createElement("div");
    capa.className = "panel-toasts";
    capa.setAttribute("role", "status");
    capa.setAttribute("aria-live", "polite");
    document.body.appendChild(capa);

    avisos.forEach(function (aviso, i) {
      const texto = aviso.textContent.replace(/^[\s✓]+/, "").trim();
      aviso.remove();

      const t = document.createElement("div");
      t.className = "panel-toast";
      t.textContent = texto;
      capa.appendChild(t);

      window.setTimeout(function () {
        t.classList.add("panel-toast--fuera");
        window.setTimeout(function () { t.remove(); }, 300);
      }, 4200 + i * 400);
    });
  })();

  /* ---------- 3 quáter. La densidad ----------
     Alterna entre cómoda y compacta y lo recuerda. El atributo va en
     `<html>`; el script del <head> lo aplica antes de pintar para
     que no haya un salto de densidad al cargar la página. */
  (function densidad() {
    const raiz = document.documentElement;
    const boton = document.querySelector("[data-densidad-toggle]");
    if (!boton) return;

    function pintar() {
      const compacta = raiz.getAttribute("data-densidad") === "compacta";
      boton.setAttribute("aria-pressed", compacta ? "true" : "false");
      boton.setAttribute("title", compacta ? "Densidad cómoda" : "Densidad compacta");
    }

    boton.addEventListener("click", function () {
      const compacta = raiz.getAttribute("data-densidad") === "compacta";
      if (compacta) raiz.removeAttribute("data-densidad");
      else raiz.setAttribute("data-densidad", "compacta");
      try {
        localStorage.setItem("nexo-densidad", compacta ? "comoda" : "compacta");
      } catch (e) {
        /* Sin localStorage el ajuste dura la sesión; no merece un
           error en pantalla. */
      }
      pintar();
    });

    pintar();
  })();

  })();
  /* =========================================================
     SOMBRA DE LA CABECERA PEGADA
     ------------------------------------------------------------
     Cuando la cabecera de una tabla deja de verse entera, se le
     pone una sombra. Cuando vuelve a verse, se le quita.

     ── POR QUE NO EN CSS ──

     Porque en CSS no se puede saber cuanto ha bajado la pagina. Se
     podria con `animation-timeline: scroll()`, que existe, pero no
     esta en todos los navegadores y el panel no esta para eso.

     ── POR QUE NO EN CADA EVENTO DE SCROLL ──

     Porque un manejador de `scroll` salta decenas de veces por
     segundo, y hacer trabajo —leer una geometria con
     `getBoundingClientRect`, que fuerza reflow— en cada uno
     bloquea el hilo y se nota como tirones en la barra de scroll.

     El arreglo: se marca el scroll, y el trabajo se hace UNICAMENTE
     en el siguiente fotograma con `requestAnimationFrame`. Si
     llegan diez eventos antes de ese fotograma, se ejecutan el
     codigo una vez, no diez. Esto es lo que llama "throttling por
     fotograma" y es la diferencia entre un panel fluido y uno que
     se queda pegado mientras se baja una tabla larga.

     Y se mide con `getBoundingClientRect().top` de la cabecera
     contra el alto de la barra: si ya se solapan, la sombra. Un
     numero, sin categorias ni casos raros. */
  (function sombraCabecera() {
    const wraps = document.querySelectorAll(".panel-table-wrap");
    if (!wraps.length) return;

    /* En movil el modo tarjeta no tiene cabecera pegada: los `th`
       estan en `display: none` y medirian cualquier cosa. */
    if (window.matchMedia("(max-width: 720px)").matches) return;

    const barra = document.querySelector(".panel-topbar");
    const tope = barra ? barra.getBoundingClientRect().height : 0;

    let pendiente = false;

      function medir() {
        pendiente = false;

        wraps.forEach(function (wrap) {
          const tabla = wrap.querySelector(".panel-table");
          if (!tabla) return;

          /* Se mide LA TABLA, no la cabecera.

             Lo primero que se puso fue mirar el `top` del `th`, y
             no puede funcionar: la barra superior y la cabecera
             estan las dos fijas, asi que el `th` se queda clavado en
             60 para siempre y comparar su posicion no dice nada. Da
             igual que se bajen mil pixeles: sigue en 60.

             Lo que si baja es la tabla. Cuando su borde superior
             pasa de la barra, la cabecera ya esta pegada del todo, y
             ahi es cuando hace falta la sombra: a partir de ese
             momento, lo que va por debajo es una fila de datos.

             Medido: al bajar 900px la tabla pasa de estar en 264 a
             tener el borde superior muy por encima de la barra. */
          wrap.classList.toggle(
            "panel-table-wrap--scrolled",
            tabla.getBoundingClientRect().top < tope - 1
          );
        });
      }

    function pedir() {
      if (pendiente) return;
      pendiente = true;
      window.requestAnimationFrame(medir);
    }

    window.addEventListener("scroll", pedir, { passive: true });
    window.addEventListener("resize", pedir);

    medir();
  })();