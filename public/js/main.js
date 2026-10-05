/* =========================================================
   Nexo Studio — Comportamientos del sitio
   ========================================================= */
(function () {
  "use strict";

  /* ---------- Header: sombra y tamaño al hacer scroll ----------
     Único sitio que modifica las clases del header. Usa
     classList (añade/quita) y nunca className = "..." para no
     pisar el resto de clases del elemento. */
  var header = document.getElementById("siteHeader");
  if (header) {
    /* Umbrales separados: la sombra aparece casi al instante y el
       header se encoge un poco más abajo, para que el cambio se
       lea como dos gestos y no como un salto. */
    var SCROLLED_AT = 8;
    var COMPACT_AT = 140;

    var syncHeader = function () {
      var y = window.scrollY || document.documentElement.scrollTop || 0;
      header.classList.toggle("is-scrolled", y > SCROLLED_AT);
      header.classList.toggle("is-compact", y > COMPACT_AT);
    };

    syncHeader();
    window.addEventListener("scroll", syncHeader, { passive: true });
    window.addEventListener("resize", syncHeader, { passive: true });
    /* Al volver atrás con el navegador el evento puede no llegar */
    window.addEventListener("pageshow", syncHeader);
  }

  /* ---------- Menú móvil ---------- */
  var toggle = document.getElementById("navToggle");
  var nav = document.getElementById("mainNav");

  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
    });

    nav.addEventListener("click", function (e) {
      if (e.target.tagName === "A") {
        nav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Abrir menú");
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("is-open")) {
        nav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.focus();
      }
    });
  }

  /* ---------- Reveal on scroll + contadores ----------
     Única fuente de verdad de la visibilidad de .reveal: GSAP no los
     toca (ver motion.js) para evitar estados invisibles permanentes. */
  var revealEls = document.querySelectorAll(".reveal");
  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var animateCount = function (node) {
    var target = parseFloat(node.getAttribute("data-count"));
    if (isNaN(target)) return;

    var decimals = parseInt(node.getAttribute("data-decimals") || "0", 10);
    var prefix = node.getAttribute("data-prefix") || "";
    var suffix = node.getAttribute("data-suffix") || "";

    var format = function (value) {
      var n = decimals ? value.toFixed(decimals).replace(".", ",") : String(Math.round(value));
      return prefix + n + suffix;
    };

    if (prefersReduced) {
      node.textContent = format(target);
      return;
    }

    var duration = 1200;
    var start = null;
    var step = function (ts) {
      if (start === null) start = ts;
      var p = Math.min((ts - start) / duration, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      node.textContent = format(target * eased);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  if (revealEls.length) {
    // Cascada: las tarjetas de una misma rejilla entran en sequencia
    document.querySelectorAll(".grid, .steps, .price-grid, .stats").forEach(function (group) {
      Array.prototype.forEach.call(group.children, function (child, i) {
        if (child.classList && child.classList.contains("reveal")) {
          child.style.transitionDelay = (i % 3) * 90 + "ms";
        }
      });
    });

    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              var el = entry.target;
              el.classList.add("is-visible");

              el.querySelectorAll("[data-count]").forEach(animateCount);

              window.setTimeout(function () {
                el.style.transitionDelay = "";
              }, 900);

              io.unobserve(el);
            }
          });
        },
        { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
      );
      revealEls.forEach(function (el) {
        io.observe(el);
      });

      /* Red de seguridad: si el observer no ha reaccionado (contenido ya
         visible al cargar, o navegadores que no disparan la primera
         observación), lo mostramos igualmente tras un breve margen.
         Sin esto, un fallo del observer deja páginas en blanco. */
      window.setTimeout(function () {
        revealEls.forEach(function (el) {
          if (el.classList.contains("is-visible")) return;
          var rect = el.getBoundingClientRect();
          var inView = rect.top < window.innerHeight * 0.92 && rect.bottom > 0;
          if (inView) {
            el.classList.add("is-visible");
            el.style.transitionDelay = "";
            el.querySelectorAll("[data-count]").forEach(animateCount);
          }
        });
      }, 1200);
    } else {
      revealEls.forEach(function (el) {
        el.classList.add("is-visible");
        el.querySelectorAll("[data-count]").forEach(animateCount);
      });
    }
  }

  /* ---------- Filtros de proyectos ---------- */
  var filterBtns = document.querySelectorAll(".filter-btn");
  var projects = document.querySelectorAll("#projectGrid .project-card");
  var noResults = document.getElementById("noResults");

  if (filterBtns.length && projects.length) {
    filterBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var filter = btn.getAttribute("data-filter");

        filterBtns.forEach(function (b) {
          b.classList.toggle("is-active", b === btn);
        });

        var visible = 0;
        projects.forEach(function (card) {
          var match = filter === "all" || card.getAttribute("data-category") === filter;
          card.classList.toggle("is-hidden", !match);
          if (match) visible++;
        });

        if (noResults) {
          noResults.style.display = visible === 0 ? "block" : "none";
        }
      });
    });
  }

  /* ---------- Acordeón (FAQ) ---------- */
  var accTriggers = document.querySelectorAll(".acc-trigger");

  accTriggers.forEach(function (trigger) {
    trigger.addEventListener("click", function () {
      var item = trigger.closest(".acc-item");
      var panel = item.querySelector(".acc-panel");
      var isOpen = item.classList.contains("is-open");

      // Cierra los demás del mismo acordeón
      var siblings = item.parentElement.querySelectorAll(".acc-item.is-open");
      siblings.forEach(function (sib) {
        if (sib !== item) {
          sib.classList.remove("is-open");
          sib.querySelector(".acc-trigger").setAttribute("aria-expanded", "false");
          sib.querySelector(".acc-panel").style.maxHeight = null;
        }
      });

      item.classList.toggle("is-open", !isOpen);
      trigger.setAttribute("aria-expanded", String(!isOpen));
      panel.style.maxHeight = isOpen ? null : panel.scrollHeight + "px";
    });
  });

  /* ---------- Formulario de contacto ---------- */
  var form = document.getElementById("contactForm");

  if (form) {
    var successBox = document.getElementById("formSuccess");
    var errorBox = document.getElementById("formError");

    var setError = function (name, msg) {
      var field = form.querySelector('[name="' + name + '"]');
      if (!field) return;
      var wrap = field.closest(".field");
      var slot = wrap.querySelector(".error-msg");
      wrap.classList.toggle("has-error", Boolean(msg));
      if (slot) slot.textContent = msg || "";
    };

    var validateField = function (field) {
      var name = field.name;
      var isCheck = field.type === "checkbox";
      var value = (field.value || "").trim();
      var msg = "";

      if (isCheck) {
        if (field.hasAttribute("required") && !field.checked) {
          msg = "Debes aceptar la política de privacidad para enviar el formulario.";
        }
      } else if (field.hasAttribute("required") && !value) {
        msg = "Este campo es obligatorio.";
      } else if (name === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
        msg = "Introduce un email válido.";
      } else if (name === "phone" && value && !/^[+\d][\d\s().-]{6,20}$/.test(value)) {
        msg = "Introduce un teléfono válido.";
      } else if (name === "message" && value && value.length < 10) {
        msg = "Cuéntanos un poco más (mínimo 10 caracteres).";
      }

      setError(name, msg);
      return !msg;
    };

    var fields = form.querySelectorAll("input, select, textarea");

    fields.forEach(function (field) {
      field.addEventListener("blur", function () {
        validateField(field);
      });
      field.addEventListener("input", function () {
        var wrap = field.closest(".field");
        if (wrap && wrap.classList.contains("has-error")) {
          validateField(field);
        }
      });
      // Las casillas se validan al cambiar, sin esperar a salir del campo
      if (field.type === "checkbox") {
        field.addEventListener("change", function () {
          validateField(field);
        });
      }
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();

      var valid = true;
      var firstInvalid = null;

      fields.forEach(function (field) {
        var ok = validateField(field);
        if (!ok && !firstInvalid) firstInvalid = field;
        valid = valid && ok;
      });

      if (!valid) {
        if (firstInvalid) firstInvalid.focus();
        if (successBox) successBox.classList.remove("is-visible");
        return;
      }

      // Envío real al servidor de Node (POST /contacto)
      if (errorBox) errorBox.classList.remove("is-visible");

      var submitBtn = form.querySelector('button[type="submit"]');
      var originalLabel = submitBtn ? submitBtn.textContent : "";
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Enviando…";
      }

      var payload = {};
      fields.forEach(function (field) {
        payload[field.name] = field.type === "checkbox" ? field.checked : field.value;
      });

      var finish = function () {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalLabel;
        }
      };

      fetch(form.getAttribute("action"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { status: res.status, data: data };
          });
        })
        .then(function (r) {
          finish();

          if (r.status === 200 && r.data && r.data.ok) {
            form.reset();
            fields.forEach(function (field) {
              setError(field.name, "");
            });
            if (successBox) {
              successBox.classList.add("is-visible");
              successBox.scrollIntoView({ behavior: "smooth", block: "center" });
            }
            return;
          }

          var errs = (r.data && r.data.errors) || {};
          var first = null;
          Object.keys(errs).forEach(function (key) {
            setError(key, errs[key]);
            if (!first) first = form.querySelector('[name="' + key + '"]');
          });

          if (errs.general && errorBox) {
            errorBox.textContent = "✗ " + errs.general;
            errorBox.classList.add("is-visible");
          }
          if (first) first.focus();
        })
        .catch(function () {
          finish();
          if (errorBox) {
            errorBox.textContent = "✗ No se pudo conectar con el servidor. Inténtalo de nuevo o escríbenos a hola@nexostudio.es.";
            errorBox.classList.add("is-visible");
            errorBox.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        });
    });
  }

  /* ---------- Selector de tema visual ---------- */
  var themeBtns = document.querySelectorAll(".theme-btn");

  if (themeBtns.length) {
    var applyTheme = function (theme) {
      document.documentElement.className = theme === "dark" ? "" : "theme-" + theme;
      themeBtns.forEach(function (btn) {
        var active = btn.getAttribute("data-theme") === theme;
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-pressed", String(active));
      });
      try {
        localStorage.setItem("nexo-theme", theme);
      } catch (e) {}
    };

    var saved = "dark";
    try {
      saved = localStorage.getItem("nexo-theme") || "dark";
    } catch (e) {}
    if (saved !== "dark" && saved !== "light" && saved !== "colorful") saved = "dark";

    applyTheme(saved);

    themeBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        applyTheme(btn.getAttribute("data-theme"));
      });
    });
  }

  /* ---------- Hero: paralaje de fondo, tilt 3D y botones magnéticos ---------- */
  var hero = document.getElementById("hero");
  var showcase = document.querySelector(".hero-showcase");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (hero && showcase && !reduceMotion && window.matchMedia("(pointer: fine)").matches) {
    var fine = window.matchMedia("(pointer: fine)");
    // El tilt va sobre .mock-window: .hero-showcase tiene una animación de
    // entrada con fill-mode "both" que pisaría cualquier transform inline.
    var tiltTarget = showcase.querySelector(".mock-window") || showcase;

    // Inclinación 3D del mockup al mover el puntero
    var applyTilt = function () {
      if (!fine.matches) {
        tiltTarget.style.transform = "";
        return;
      }
      var rect = hero.getBoundingClientRect();
      var px = (window.innerWidth / 2 - (rect.left + rect.width / 2)) / (rect.width / 2);
      var py = (window.innerHeight / 2 - (rect.top + rect.height / 2)) / (rect.height / 2);
      tiltTarget.style.transform =
        "rotateY(" + (px * 6).toFixed(2) + "deg) rotateX(" + (-py * 5).toFixed(2) + "deg)";
    };

    // Las tarjetas flotantes se mueven un poco más que el conjunto
    var floats = showcase.querySelectorAll("[data-float]");
    var applyFloatDepth = function () {
      var rect = hero.getBoundingClientRect();
      var py = (window.innerHeight / 2 - (rect.top + rect.height / 2)) / (rect.height / 2);
      floats.forEach(function (card) {
        var depth = parseFloat(card.getAttribute("data-float")) || 1;
        card.style.setProperty("--float-shift", (py * -14 * depth).toFixed(2) + "px");
      });
    };

    var onHeroMove = function () {
      applyTilt();
      applyFloatDepth();
    };

    window.addEventListener("scroll", applyFloatDepth, { passive: true });
    window.addEventListener("resize", applyFloatDepth);
    hero.addEventListener("mousemove", onHeroMove);
    hero.addEventListener("mouseenter", onHeroMove);
  }

  /* ---------- Botones magnéticos ---------- */
  if (!reduceMotion && window.matchMedia("(pointer: fine)").matches) {
    document.querySelectorAll(".magnetic").forEach(function (btn) {
      btn.addEventListener("mousemove", function (e) {
        var r = btn.getBoundingClientRect();
        var x = (e.clientX - (r.left + r.width / 2)) / r.width;
        var y = (e.clientY - (r.top + r.height / 2)) / r.height;
        btn.style.transform = "translate(" + (x * 5).toFixed(2) + "px, " + (y * 4).toFixed(2) + "px)";
      });
      btn.addEventListener("mouseleave", function () {
        btn.style.transform = "";
      });
    });
  }

  /* ---------- Año actual en el footer ---------- */
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });
})();
