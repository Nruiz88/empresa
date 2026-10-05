/* =========================================================
   Nexo Studio — Motor de motion (GSAP + ScrollTrigger + Lenis)
   ------------------------------------------------------------
   Se carga DESPUÉS de main.js y solo actúa si las librerías
   están disponibles (CDN). Si fallan, el sitio sigue siendo
   funcional con las animaciones CSS nativas.

   Motor responsible:
     - Scroll suave (Lenis) sincronizado con GSAP ticker
     - Revelado por líneas/palabras en titulares
     - Entradas en cascada de rejillas y tarjetas
     - Parallax del hero y de las imágenes de proyecto
     - Tilt 3D con brillo en tarjetas
     - Barra de progreso de lectura
     - Contadores numéricos
     - Cabecera que se encoge al hacer scroll
   ========================================================= */
(function () {
  "use strict";

  var gsap = window.gsap;
  var ScrollTrigger = window.ScrollTrigger;
  if (!gsap || !ScrollTrigger) return; // CDN no disponible: CSS ya cubre el caso

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var finePointer = window.matchMedia("(pointer: fine)").matches;

  gsap.registerPlugin(ScrollTrigger);

  /* Marca el documento para que el CSS desactive sus animaciones de entrada
     y no compitan con GSAP por las mismas propiedades. */
  document.documentElement.classList.add("has-gsap");

  /* ---------- ScrollTrigger notifica a Lenis del resize ---------- */
  ScrollTrigger.defaults({ markers: false });

  /* ---------- Scroll suave con Lenis ---------- */
  var lenis = null;
  if (window.Lenis && !reduceMotion) {
    lenis = new window.Lenis({
      duration: 1.1,
      easing: function (t) {
        return Math.min(1, 1.001 - Math.pow(2, -10 * t));
      },
      smoothWheel: true,
      touchMultiplier: 1.6,
    });

    // Un único ticker alimenta Lenis y GSAP: evita desincronización
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add(function (time) {
      lenis.raf(time * 1000);
    });
    gsap.ticker.lagSmoothing(0);

    // Intercepta el salto a los anclas para que use el scroll suave
    document.querySelectorAll('a[href^="#"]:not([href="#"])').forEach(function (link) {
      link.addEventListener("click", function (e) {
        var target = document.querySelector(link.getAttribute("href"));
        if (!target) return;
        e.preventDefault();
        lenis.scrollTo(target, { offset: -90, duration: 1.2 });
      });
    });
  }

  if (reduceMotion) {
    // Con movimiento reducido mostramos todo y no animamos nada
    gsap.set("[data-anim], .reveal, .hero-title .line > span", { clearProps: "all" });
    document.querySelectorAll("[data-count]").forEach(function (node) {
      var decimals = parseInt(node.getAttribute("data-decimals") || "0", 10);
      var prefix = node.getAttribute("data-prefix") || "";
      var suffix = node.getAttribute("data-suffix") || "";
      var value = parseFloat(node.getAttribute("data-count"));
      if (isNaN(value)) return;
      node.textContent = prefix + (decimals ? value.toFixed(decimals).replace(".", ",") : String(value)) + suffix;
    });
    ScrollTrigger.refresh();
    return;
  }

  /* ---------- Utilidades ---------- */
  var q = function (sel, ctx) {
    return Array.prototype.slice.call((ctx || document).querySelectorAll(sel));
  };

  /* Revela un titular línea a línea, partiéndolo si el HTML no lo trae hecho.
     Respeta el HTML existente (.hero-title .line) para no romper el hero. */
  var splitLines = function (el) {
    if (el.querySelector(".line")) return q(".line > span", el);
    // Envuelve cada hijo en una línea con overflow hidden para el efecto máscara
    var lines = [];
    Array.prototype.forEach.call(el.childNodes, function (node) {
      if (node.nodeType === 3 && !node.textContent.trim()) return;
      var wrap = document.createElement("span");
      wrap.className = "line";
      var inner = document.createElement("span");
      inner.innerHTML = node.outerHTML || node.textContent;
      wrap.appendChild(inner);
      el.replaceChild(wrap, node);
      lines.push(inner);
    });
    return lines;
  };

  /* =========================================================
     1. Entrada inicial del hero (al cargar, no al hacer scroll)
     ========================================================= */
  var heroTl = gsap.timeline({ defaults: { ease: "power3.out" } });

  if (document.querySelector(".hero-title")) {
    var heroLines = q(".hero-title .line > span");
    heroTl.from(heroLines, { yPercent: 108, duration: 1, stagger: 0.09 }, 0.05);

    heroTl.from(".eyebrow-pill", { y: -14, autoAlpha: 0, duration: 0.6 }, 0);
    heroTl.from(".hero-copy .lead", { y: 20, autoAlpha: 0, duration: 0.7 }, 0.5);
    heroTl.from(".hero-actions .btn", { y: 20, autoAlpha: 0, duration: 0.6, stagger: 0.08 }, 0.6);
    heroTl.from(".hero-proof", { y: 16, autoAlpha: 0, duration: 0.6 }, 0.75);
    heroTl.from(".hero-copy .hero-note", { autoAlpha: 0, duration: 0.6 }, 0.85);
    heroTl.from(".hero-showcase", { autoAlpha: 0, y: 48, rotateY: -10, duration: 1.1 }, 0.3);
    heroTl.from(".mock-bar", { yPercent: -100, duration: 0.7 }, 0.6);
    heroTl.from(".mock-body", { autoAlpha: 0, duration: 0.6 }, 0.7);
    heroTl.from(
      ".mock-chart span",
      { scaleY: 0, transformOrigin: "bottom", duration: 0.8, stagger: 0.05, ease: "power2.out" },
      0.95
    );
    heroTl.from(".float-card", { scale: 0.7, autoAlpha: 0, duration: 0.7, stagger: 0.12 }, 1.25);
    heroTl.from(".orbit", { scale: 0.8, autoAlpha: 0, duration: 0.8, stagger: 0.1 }, 1.3);
  } else {
    // Sin hero (páginas interiores): entrada del encabezado
    heroTl.from(".page-hero > *", { y: 24, autoAlpha: 0, duration: 0.7, stagger: 0.08 });
  }

  /* =========================================================
     2. Revelado de .reveal
     ------------------------------------------------------------
     NO lo anima GSAP a propósito. El CSS parte de opacity:0 y un
     gsap.from() sobre elementos que aún no han entrado en pantalla
     los deja invisibles de forma permanente (el batch solo dispara
     para los queCrossing el umbral). La visibilidad la controla
     main.js con IntersectionObserver + la clase .is-visible, que ya
     funciona; aquí solo añadimos el desplazamiento escalonado.
     ========================================================= */
  /* Sin gsap.set aquí a propósito: escribiría un transform inline que
     pisaría la transición CSS de .reveal y dejaría el bloque desplazado
     aunque ganara .is-visible. El escalonado lo pone main.js. */

  /* =========================================================
     3. Titulares de secciones: revelado por líneas
     ========================================================= */
  q(".section-head h2, .page-hero h1, .post-header h1, .cta-band h2").forEach(function (heading) {
    // No procesamos si ya tiene líneas (hero) o si es un solo texto corto
    if (heading.querySelector(".line")) return;
    var words = heading.textContent.trim().split(/\s+/);
    if (words.length < 2) return;

    gsap.from(heading, {
      opacity: 0,
      y: 26,
      duration: 0.8,
      ease: "power3.out",
      scrollTrigger: { trigger: heading, start: "top 88%", once: true },
    });
  });

  /* =========================================================
     4. Parallax del hero y de las texturas
     ========================================================= */
  if (document.querySelector(".hero-bg")) {
    gsap.to(".aurora-1", {
      yPercent: 18,
      xPercent: -6,
      ease: "none",
      scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: 1 },
    });
    gsap.to(".aurora-2", {
      yPercent: 26,
      xPercent: 8,
      ease: "none",
      scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: 1 },
    });
    gsap.to(".hero-grid", {
      yPercent: 12,
      ease: "none",
      scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: 1 },
    });
    // El mockup se eleva un poco al bajar, dando sensación de profundidad
    gsap.to(".hero-showcase", {
      yPercent: -8,
      ease: "none",
      scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: 1 },
    });
  }

  /* Parallax en las miniaturas de proyecto */
  q(".project-thumb").forEach(function (thumb) {
    var art = thumb.querySelector(".thumb-art");
    if (!art) return;
    gsap.fromTo(
      art,
      { yPercent: -6 },
      {
        yPercent: 6,
        ease: "none",
        scrollTrigger: { trigger: thumb, start: "top bottom", end: "bottom top", scrub: 1 },
      }
    );
  });

  /* =========================================================
     5. Tilt 3D + brillo en tarjetas (solo puntero fino)
     ========================================================= */
  if (finePointer) {
    var tiltTargets = q(".project-card, .price-card, .quote, .info-item, .blog-card");
    tiltTargets.forEach(function (card) {
      card.classList.add("tilt-3d");

      var shine = document.createElement("span");
      shine.className = "tilt-shine";
      shine.setAttribute("aria-hidden", "true");
      card.appendChild(shine);

      var move = function (e) {
        var r = card.getBoundingClientRect();
        var x = (e.clientX - r.left) / r.width;
        var y = (e.clientY - r.top) / r.height;
        gsap.to(card, {
          rotateY: (x - 0.5) * 9,
          rotateX: -(y - 0.5) * 9,
          duration: 0.45,
          ease: "power2.out",
          transformPerspective: 1000,
        });
        // El brillo se posiciona con las variables que lee el CSS
        gsap.to(shine, {
          "--shine-x": (x * 100).toFixed(1) + "%",
          "--shine-y": (y * 100).toFixed(1) + "%",
          duration: 0.45,
          ease: "power2.out",
        });
      };

      var leave = function () {
        gsap.to(card, { rotateY: 0, rotateX: 0, duration: 0.6, ease: "power3.out" });
        gsap.to(shine, { "--shine-x": "50%", "--shine-y": "50%", duration: 0.6 });
      };

      card.addEventListener("mousemove", move);
      card.addEventListener("mouseenter", move);
      card.addEventListener("mouseleave", leave);
    });
  }

  /* =========================================================
     6. Contadores numéricos al entrar en vista
     ========================================================= */
  q("[data-count]").forEach(function (node) {
    var target = parseFloat(node.getAttribute("data-count"));
    if (isNaN(target)) return;

    var decimals = parseInt(node.getAttribute("data-decimals") || "0", 10);
    var prefix = node.getAttribute("data-prefix") || "";
    var suffix = node.getAttribute("data-suffix") || "";
    var counter = { value: 0 };

    var render = function (value) {
      var n = decimals ? value.toFixed(decimals).replace(".", ",") : String(Math.round(value));
      node.textContent = prefix + n + suffix;
    };

    gsap.to(counter, {
      value: target,
      duration: 1.6,
      ease: "power2.out",
      onUpdate: function () {
        render(counter.value);
      },
      onComplete: function () {
        render(target);
      },
      scrollTrigger: { trigger: node, start: "top 92%", once: true },
    });
  });

  /* =========================================================
     7. Barra de progreso de lectura
     ========================================================= */
  var bar = document.createElement("div");
  bar.className = "scroll-progress";
  bar.setAttribute("aria-hidden", "true");
  document.body.appendChild(bar);

  gsap.to(bar, {
    scaleX: 1,
    ease: "none",
    scrollTrigger: {
      trigger: document.documentElement,
      start: "top top",
      end: "bottom bottom",
      scrub: 0.3,
    },
  });

  /* =========================================================
     8. Cabecera que se encoge al hacer scroll
     ------------------------------------------------------------
     DELIBERADAMENTE vacío. Aquí había un ScrollTrigger que hacía
     gsap.to(header, { className: "is-scrolled is-compact" }).

     Eso estaba en conflicto con main.js, que ya hacía
     classList.toggle("is-scrolled", ...) sobre el mismo elemento:

       - gsap.to() REEMPLAZA la cadena className entera
       - classList.toggle() solo añade o quita la clase indicada

     Resultado: GSAP dejaba "is-compact" puesta, y al volver arriba
     el toggle quitaba "is-scrolled" pero "is-compact" se quedaba.
     El header se quedaba encogido para siempre.

     Ahora main.js es el único que toca las clases del header.
     ========================================================= */

  /* =========================================================
     9. Servicios: reinicio del degradado en las tarjetas
     ========================================================= */
  q(".grid-3 .card").forEach(function (card) {
    var icon = card.querySelector(".icon");
    if (!icon) return;
    card.addEventListener("mouseenter", function () {
      gsap.fromTo(icon, { scale: 0.85 }, { scale: 1, duration: 0.5, ease: "back.out(2)" });
    });
  });

  /* =========================================================
     10. Enlaces con subrayado que se dibuja
     ========================================================= */
  if (finePointer) {
    q('a[href^="/"]').forEach(function (link) {
      if (link.classList.contains("btn") || link.closest(".footer-col, .nav, .footer-bottom, .theme-switch")) return;
      link.addEventListener("mouseenter", function () {
        gsap.to(link, { x: 3, duration: 0.25, ease: "power2.out" });
      });
      link.addEventListener("mouseleave", function () {
        gsap.to(link, { x: 0, duration: 0.25, ease: "power2.out" });
      });
    });
  }

  /* Recalcula posiciones cuando cambia el tamaño o cargan las fuentes */
  window.addEventListener("load", function () {
    ScrollTrigger.refresh();
  });
  window.addEventListener("resize", ScrollTrigger.refresh);
})();