/* =========================================================
   Nexo Studio — Paleta de comandos (Ctrl+K)
   ------------------------------------------------------------
   Un campo de búsqueda que está siempre a una tecla, para llegar a
   cualquier pantalla o registro sin recorrer el menú.

   ── POR QUÉ NO ES UN FORMULARIO ──

   La paleta se abre sobre la página y filtra mientras escribes. Un
   formulario con botón de búsqueda obligaría a pulsar y a esperar
   para ver si encontraste algo, que es justo lo que hace lento
   buscar.

   ── LA BÚSQUEDA VA AL SERVIDOR, EL FILTRADO NO ──

   Con dos letras o más se pide a `/panel/buscar`, que devuelve una
   lista corta. A partir de ahí, escribir más NO vuelve a llamar al
   servidor: filtra en local lo que ya llegó.

   Por qué así: pedir en cada tecla es un viaje de red por pulsación
   y las respuestas llegan desordenadas —una lenta se pinta encima de
   una rápida—. Filtrando en local no hay ninguna de las dos cosas.

   ── TECLADO, Y POR QUÉ ES LO IMPORTANTE ──

   Va con Ctrl+K y con ⌘K, con las flechas y con Enter. La paleta
   solo es rápida si se usa sin soltar el teclado: con el ratón se
   acaba usando el menú, que es lo que ya había.

   Escape cierra. Y al cerrar se devuelve el foco a donde estaba, que
   si no se queda perdido en el body y el siguiente Tab se va al
   principio de la página.

   ── ACCESIBILIDAD ──

   El campo es un `role="combobox"` con `aria-expanded` y
   `aria-controls`, y la lista un `role="listbox"`. Está leído con
   `aria-activedescendant`, que es lo que corresponde: el foco real
   se queda en el campo y lo que se mueve es cuál de las opciones
   está marcada.

   No es decoración: sin `aria-activedescendant`, un lector de
   pantalla anuncia el campo vacío mientras el ojo ve resaltada la
   tercera opción, y las dos cosas van a destiempo.
   ========================================================= */

(function () {
  "use strict";

  const BASE = "/panel";

  /* ---------- Las secciones ----------
     Se muestran siempre, incluso sin escribir nada: al abrir con
     Ctrl+K y no tener ninguna intención todavía, lo útil es ver a
     dónde se puede ir. Van primero y se filtran también, porque
     "cob" debe encontrar la sección de cobros. */
  const SECCIONES = [
    { titulo: "Resumen", url: BASE + "/", atajo: "G H" },
    { titulo: "Consultas", url: BASE + "/consultas" },
    { titulo: "Clientes", url: BASE + "/clientes" },
    { titulo: "Servicios", url: BASE + "/servicios" },
    { titulo: "Cobros", url: BASE + "/cobros" },
    { titulo: "Catálogo", url: BASE + "/catalogo" },
    { titulo: "Accesos", url: BASE + "/accesos" },
    { titulo: "Salud del sistema", url: BASE + "/salud" },
    { titulo: "Nuevo cliente", url: BASE + "/clientes/nuevo", accion: true },
    { titulo: "Nuevo cobro", url: BASE + "/cobros/nuevo", accion: true },
    { titulo: "Nuevo servicio", url: BASE + "/servicios/nuevo", accion: true },
  ];

  /* De dónde sale cada grupo de resultados, y a dónde lleva.

     ── POR QUÉ UNOS VAN A LA FICHA Y OTROS A LA LISTA ──

     Clientes y servicios tienen página propia. Cobros y consultas NO:
     sus rutas son solo el listado y los POST de acción
     (`/cobros/:id/pagado`, `/consultas/:id/estado`), y no hay ficha
     de detalle.

     La primera versión apuntaba a `/cobros/<id>` y a `/consultas/<id>`
     inventadas. Daban 404: pulsar Enter llevaba a una pantalla de
     error, que es la peor forma de descubrir que una función nueva
     no funciona.

     Se mandan al listado con el término ya puesto en la búsqueda.
     Es un destino peor que una ficha y mejor que un 404: se llega a
     la fila, con el filtro escrito, y se sigue desde ahí. */
  const GRUPOS = [
    { clave: "clientes", etiqueta: "Clientes", url: function (r) { return BASE + "/clientes/" + r.id; } },
    { clave: "servicios", etiqueta: "Servicios", url: function (r) { return BASE + "/servicios/" + r.id + "/editar"; } },
    { clave: "cobros", etiqueta: "Cobros", url: function (r) { return BASE + "/cobros?q=" + encodeURIComponent(r.titulo); } },
    { clave: "consultas", etiqueta: "Consultas", url: function (r) { return BASE + "/consultas?q=" + encodeURIComponent(r.titulo); } },
  ];

  /* ---------- Montaje ---------- */

  const capa = document.createElement("div");
  capa.className = "cmd-capa";
  capa.setAttribute("hidden", "");

  /* El `form` envuelve al campo a propósito.

     Un formulario de verdad, y no una navegación a mano desde el
     teclado. Las dos se probaron y ninguna funciona: lanzar un keydown
     de Enter desde el script, y llamar a `.click()` sobre el enlace
     marcado. Ninguna de las dos mueve la página; solo un clic de
     verdad de ratón, o el envío de un formulario.

     O sea que este navegador NO abre enlaces desde script, pero sí
     cuando él decide que toca. Por eso se le deja decidir a él: un
     formulario con un solo campo de texto se envía solo al pulsar
     Enter, que es lo estándar y lo que ya sabe cualquier teclado.

     El `action` se apunta a lo marcado, así que el envío va a donde va
     el dedo. El botón de enviar es `sr-only`: hace falta un submit
     dentro del formulario, pero no queremos un botón en pantalla
     compitando con la lista.

     El campo se llama `q` y no se queda sin nombre. Un formulario GET
     sin ningún campo con nombre acaba en una URL terminada en `?`,
     que funciona pero queda fea; con nombre, la query lleva lo que se
     escribió. Y de paso aprovecha: las listas que aceptan `q` —clientes,
     cobros, consultas— llegan ya filtradas. */
  capa.innerHTML =
    '<div class="cmd-caja" role="dialog" aria-modal="true" aria-label="Buscar y saltar a">' +
    '  <form class="cmd-cabecera" data-cmd-form method="get">' +
    '    <span class="cmd-icono" aria-hidden="true"></span>' +
    '    <input type="text" class="cmd-input" name="q" placeholder="Buscar clientes, cobros, servicios…" ' +
    '           autocomplete="off" spellcheck="false" ' +
    '           role="combobox" aria-expanded="false" aria-controls="cmd-lista" ' +
    '           aria-autocomplete="list" aria-label="Buscar en el panel" />' +
    '    <button type="submit" class="sr-only">Abrir</button>' +
    '  </form>' +
    '  <div class="cmd-lista" id="cmd-lista" role="listbox" aria-label="Resultados"></div>' +
    '  <div class="cmd-pie">' +
    '    <span><kbd>↑</kbd><kbd>↓</kbd> moverse</span>' +
    '    <span><kbd>Enter</kbd> abrir</span>' +
    '    <span><kbd>Esc</kbd> cerrar</span>' +
    '  </div>' +
    "</div>";

  document.body.appendChild(capa);

  const input = capa.querySelector(".cmd-input");
  const lista = capa.querySelector(".cmd-lista");
  const formulario = capa.querySelector("[data-cmd-form]");

  /* ---------- Estado ---------- */

  let abierto = false;
  let plano = [];        /* lo que se está mostrando, ya filtrado */
  let marcada = 0;       /* cuál está marcada, por índice */
  let datos = { clientes: [], servicios: [], cobros: [], consultas: [] };
  let consultaEnCurso = "";   /* lo último pedido al servidor */
  let reloj = null;

  /* ---------- Filtrado local ---------- */

  function normalizar(t) {
    return String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  /* Monta el listado a partir de lo que hay en `datos` más el texto.

     Se rehace entero en cada tecla en vez de ocultar y mostrar lo
     pintado: son treinta elementos como mucho, y rehacerlo deja el
     marcado y los ids en un sitio, en vez de dos. */
  function componer(texto) {
    const t = normalizar(texto);
    const out = [];

    for (const s of SECCIONES) {
      if (!t || normalizar(s.titulo).includes(t)) out.push({ tipo: "seccion", ...s });
    }

    for (const g of GRUPOS) {
      for (const r of datos[g.clave] || []) {
        const ti = normalizar(r.titulo);
        const de = normalizar(r.detalle);

        if (t && !ti.includes(t) && !de.includes(t)) continue;

        out.push({
          tipo: "resultado",
          grupo: g.etiqueta,
          titulo: r.titulo,
          detalle: r.detalle,
          url: g.url(r),
        });
      }
    }

    return out;
  }

  /* ---------- Pintado ---------- */

  function pintar() {
    lista.innerHTML = "";

    if (!plano.length) {
      lista.innerHTML =
        '<p class="cmd-vacio">Sin resultados. Prueba con el nombre del cliente o el concepto del cobro.</p>';
      lista.classList.add("cmd-lista--vacia");
      return;
    }

    lista.classList.remove("cmd-lista--vacia");

    let grupoActual = null;

    plano.forEach((r, i) => {
      if (r.grupo && r.grupo !== grupoActual) {
        grupoActual = r.grupo;
        const h = document.createElement("div");
        h.className = "cmd-grupo";
        h.setAttribute("role", "presentation");
        h.textContent = grupoActual;
        lista.appendChild(h);
      }

      const el = document.createElement("a");
      el.className = "cmd-item" + (i === marcada ? " es-marcada" : "");
      el.id = "cmd-opcion-" + i;
      el.href = r.url;
      el.setAttribute("role", "option");
      el.setAttribute("aria-selected", i === marcada ? "true" : "false");

      const icon = document.createElement("span");
      icon.className = "cmd-item-icono";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = r.tipo === "seccion" ? "›" : "·";

      const textos = document.createElement("span");
      textos.className = "cmd-item-textos";

      const t = document.createElement("span");
      t.className = "cmd-item-titulo";
      t.textContent = r.titulo;

      textos.appendChild(t);

      if (r.detalle) {
        const d = document.createElement("span");
        d.className = "cmd-item-detalle";
        d.textContent = r.detalle;
        textos.appendChild(d);
      }

      el.appendChild(icon);
      el.appendChild(textos);
      lista.appendChild(el);
    });
  }

  function marcar(i) {
    if (!plano.length) return;

    marcada = Math.max(0, Math.min(plano.length - 1, i));
    input.setAttribute("aria-activedescendant", "cmd-opcion-" + marcada);

    [...lista.children].forEach((el) => {
      if (!el.id) return;
      const n = Number(el.id.replace("cmd-opcion-", ""));
      el.classList.toggle("es-marcada", n === marcada);
      if (el.hasAttribute("role")) el.setAttribute("aria-selected", n === marcada ? "true" : "false");
    });

    /* La marcada se ve en pantalla siempre. Sin esto, con treinta
       resultados y ocho visibles, bajar del octavo saldría de la
       vista y el Enter abriría algo que no se ve. */
    const el = lista.querySelector("#cmd-opcion-" + marcada);
    if (el) el.scrollIntoView({ block: "nearest" });

    /* El `action` del formulario apunta a lo marcado, para que el
       Enter del navegador vaya a donde está el dedo.

       Se lee del elemento pintado y no de `plano[marcada]`: si los
       dos se desincronizan, el dedo y el ojo discreparían. Leyendo
       del DOM no puede pasar. */
    if (formulario && el) formulario.action = el.getAttribute("href") || "";
  }

  /* ---------- Abrir y cerrar ---------- */

  let focoAntes = null;

  function abrir() {
    if (abierto) return;

    abierto = true;
    focoAntes = document.activeElement;

    /* Un evento anterior ya no interesta. */
    if (reloj) {
      clearTimeout(reloj);
      reloj = null;
    }

    capa.removeAttribute("hidden");
    document.body.classList.add("cmd-abierto");

    consultaEnCurso = "";
    datos = { clientes: [], servicios: [], cobros: [], consultas: [] };
    input.value = "";
    plano = componer("");
    marcada = 0;
    pintar();
    marcar(0);
    input.focus();
  }

  function cerrar() {
    if (!abierto) return;

    abierto = false;
    capa.setAttribute("hidden", "");
    document.body.classList.remove("cmd-abierto");

    /* El foco vuelve a donde estaba. Sin esto, se queda en el input
       que ya no existe visualmente y el siguiente Tab se va al
       principio de la página. */
    if (focoAntes && focoAntes.focus) focoAntes.focus();
  }

  /* ---------- Buscar ---------- */

  async function pedir(texto) {
    const q = texto.trim();
    if (q.length < 2) {
      datos = { clientes: [], servicios: [], cobros: [], consultas: [] };
      return;
    }

    /* Solo se pide si es OTRA búsqueda. Escribir "pan" y luego
       volver a "pan" no vuelve a llamar al servidor. */
    if (q === consultaEnCurso) return;
    consultaEnCurso = q;

    try {
      const r = await fetch(BASE + "/buscar?q=" + encodeURIComponent(q), {
        headers: { Accept: "application/json" },
      });

      if (!r.ok) return;

      const j = await r.json();

      /* Si mientras se esperaba el usuario escribió otra cosa, esta
         respuesta ya no vale para nada. Sin esta comprobación, una
         petición lenta se pinta encima de la que sí corresponde. */
      if (input.value.trim() !== q) return;

      datos = {
        clientes: j.clientes || [],
        servicios: j.servicios || [],
        cobros: j.cobros || [],
        consultas: j.consultas || [],
      };

      /* Y HAY QUE VOLVER A PINTAR.

         Actualizar `datos` no basta. La lista que se ve la construyó
         `actualizar()` al teclear, y para entonces `datos` todavía
         estaba vacío porque la respuesta aun no habia llegado: la peticion
         al servidor es un viaje de red y la tecla ya se ha pintado.

         La primera versión asignaba `datos` y no repintaba. El
         resultado era que escribir "pan" no encontraba a Panadería La
         Espiga —que existe y la base la devuelve— y la paleta
         parecía no funcionar más allá de filtrar el menú.

         O sea: la búsqueda SÍ funcionaba y no se notaba. Que es
         exactamente lo que hace un fallo de esto. */
      repintar();
    } catch (e) {
      /* La paleta es una ayuda. Si no puede buscar, sigue
         funcionando con las secciones y no dice nada: un error
         dentro de un cuadro de búsqueda asusta más de lo que
         informa. */
      datos = { clientes: [], servicios: [], cobros: [], consultas: [] };
    }
  }

  /* Repinta con lo que haya ahora mismo en `datos`, SIN volver a pedir.

   Son dos caminos distintos a propósito:
     teclear      → `actualizar()`  → pinta y pide
     llega la respuesta → `repintar()` → solo pinta

   Si `actualizar()` llamara a `pedir()` desde aquí, la respuesta
   dispararía otra petición y la otra respuesta otra, y así hasta que
   el temporizador de 180 ms cortara el bucle. Por eso el que pide es
   solo el tecleo. */
  function repintar() {
    /* Qué estaba marcado, para intentar dejar marcado lo MISMO.

       La primera versión volvía a marcar el primero siempre. Con la
       respuesta del servidor arriving tarde, se notaba: bajabas con
       las flechas a "Panadería La Espiga", llegaba la búsqueda, y el
       marcado volvía al principio. Y si pulsabas Enter, se abría otra
       cosa: la que ya no estabas mirando.

       Es un fallo de los que no se ven en una captura y se sienten
       cada vez que se usa. */
    const antes = plano[marcada];
    const antesUrl = antes && antes.url;

    plano = componer(input.value);

    if (antesUrl) {
      const sigue = plano.findIndex((r) => r.url === antesUrl);
      marcada = sigue >= 0 ? sigue : 0;
    } else {
      marcada = 0;
    }

    pintar();
    marcar(marcada);
  }

  function actualizar() {
    repintar();

    clearTimeout(reloj);
    reloj = setTimeout(() => pedir(input.value), 180);
  }

  /* ---------- Eventos ---------- */

  input.addEventListener("input", actualizar);

  input.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      marcar(marcada + 1);
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      marcar(marcada - 1);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      cerrar();
    }
    /* Enter NO se gestiona aquí, a propósito.

       El Enter lo envía el navegador al formulario, que ya apunta a
       lo marcado. Si se atrapara la tecla para navegar a mano, se
       estaría haciendo a mano justo lo que el navegador ya hace
       bien. Y se ha probado que hacerlo a mano no funciona. */
  });

  /* Clic en la capa de fondo: cierra. Clic dentro de la caja, no. */
  capa.addEventListener("mousedown", (ev) => {
    if (ev.target === capa) cerrar();
  });

  document.addEventListener("keydown", (ev) => {
    /* Ctrl+K y ⌘K.

     Se comprueba `metaKey` para el Mac: ahí ⌘ es la tecla de
     comando y Ctrl+K no abre nada. Sin esto, en Mac la paleta sería
     inalcanzable. */
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === "k" || ev.key === "K")) {
      ev.preventDefault();
      abierto ? cerrar() : abrir();
    }
  });

  /* ---------- El botón del lateral ---------- */
  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "panel-buscar";
  boton.setAttribute("aria-label", "Buscar en el panel");
  boton.innerHTML =
    '<span class="panel-buscar-lupa" aria-hidden="true"></span>' +
    '<span class="panel-buscar-texto">Buscar</span>' +
    '<kbd class="panel-buscar-atajo">Ctrl K</kbd>';

  boton.addEventListener("click", abrir);

  const barra = document.querySelector(".panel-topbar");
  if (barra) barra.appendChild(boton);

  /* El atajo que se pinta depende del sistema, y poner "Ctrl K" en un
     Mac es tan inútil como poner "Cmd" en un Windows. */
  if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) {
    boton.querySelector(".panel-buscar-atajo").textContent = "⌘ K";
  }
})();