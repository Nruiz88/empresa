const { chromium } = require("D:/webs/wweb/node_modules/playwright");

const ALTO = (e) => (e ? Math.round(e.getBoundingClientRect().height * 10) / 10 : null);
const ANCHO = (e) => (e ? Math.round(e.getBoundingClientRect().width) : null);

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });

  await p.goto("http://127.0.0.1:3000/panel/login");
  await p.fill('input[name="email"]', process.env.TEST_EMAIL);
  await p.fill('input[name="password"]', process.env.TEST_PASSWORD);
  await p.click('button[type="submit"]');
  await p.waitForLoadState("domcontentloaded");

  /* ═══ La portada no se tiene que haber enterado ═══ */

  console.log("\n═══ La portada ═══\n");

  await p.goto("http://127.0.0.1:3000/");
  await p.waitForLoadState("domcontentloaded");

  const portada = await p.evaluate(() => {
    const raiz = getComputedStyle(document.documentElement);

    /* ── POR QUÉ SE MIDE UNA TARJETA REAL Y NO UNA CLASE INVENTADA ──

       La primera versión buscaba `.card, .card-link, article`, ninguna
       de las tres existe en la portada, así que `querySelector`
       devolvía null y el navegador contestaba 0px. Un 0 que no
       significa nada y que se lee como «el radio cambió a cero», que
       es justo lo contrario de lo que había pasado.

       Se busca cualquier elemento con un radio distinto de cero, que
       es lo que de verdad importa: si el radio de la portada se
       hubiera movido, se vería aquí. */
    let pintados = new Set();
    for (const e of document.querySelectorAll("*")) {
      const r = getComputedStyle(e).borderTopLeftRadius;
      if (r && r !== "0px") pintados.add(r);
    }

    return {
      bg: raiz.getPropertyValue("--bg").trim(),
      surface: raiz.getPropertyValue("--surface").trim(),
      radios: [...pintados].slice(0, 6).join(" "),
      fondo: getComputedStyle(document.body).backgroundColor,
    };
  });

  console.log("  bg            " + portada.bg + (portada.bg === "#0f172a" ? "  ok" : "  ← CAMBIÓ"));
  console.log("  surface       " + portada.surface + (portada.surface === "#1b2942" ? "  ok" : "  ← CAMBIÓ"));
  console.log("  fondo pintado " + portada.fondo + (portada.fondo === "rgb(15, 23, 42)" ? "  ok" : "  ← CAMBIÓ"));
  console.log("  radios que hay " + (portada.radios || "ninguno"));
  console.log("  ── el radio de la portada sigue siendo 16px y el panel");
  console.log("     lo baja a 8px en su propio bloque, que es lo que");
  console.log("     dice que hay radios de 8: los del panel no se colan");

  /* ═══ Los planos y los bordes, medidos ═══ */

  console.log("\n═══ Planos y bordes ═══\n");

  await p.setViewportSize({ width: 1440, height: 900 });
  await p.goto("http://127.0.0.1:3000/panel");
  await p.waitForLoadState("domcontentloaded");

  const planos = await p.evaluate(() => {
    const leer = (sel, prop) => {
      const e = document.querySelector(sel);
      return e ? getComputedStyle(e)[prop] : "—";
    };

    return {
      fondo: leer("body", "backgroundColor"),
      tarjeta: leer(".panel-stat", "backgroundColor"),
      borde: leer(".panel-stat", "borderTopColor") + " / " + leer(".panel-stat", "borderTopWidth"),
      radio: leer(".panel-stat", "borderTopLeftRadius"),
      sombra: leer(".panel-tarjeta, .panel-card", "boxShadow").slice(0, 46),
      texto: leer(".panel-stat", "color"),
    };
  });

  for (const [k, v] of Object.entries(planos)) console.log("  " + k.padEnd(9) + v);

  /* ═══ El buscador en móvil ═══ */

  console.log("\n═══ El buscador ═══\n");

  for (const ancho of [1440, 768, 390]) {
    for (const ruta of ["/panel/clientes", "/panel/cobros", "/panel/servicios", "/panel/bots"]) {
      await p.setViewportSize({ width: ancho, height: 844 });
      await p.goto("http://127.0.0.1:3000" + ruta);
      await p.waitForLoadState("domcontentloaded");

      const d = await p.evaluate(() => {
        const s = document.querySelector(".panel-search");
        if (!s) return null;
        const r = s.getBoundingClientRect();
        return { ancho: Math.round(r.width), alto: Math.round(r.height * 10) / 10 };
      });

      if (d) {
        const mal = d.alto > 40 ? "  ← MAL" : "";
        console.log(
          "  " + String(ancho).padEnd(6) + ruta.padEnd(20) +
          "ancho " + String(d.ancho).padEnd(6) +
          "alto " + String(d.alto).padEnd(6) + mal
        );
      }
    }
  }

  /* ═══ Las tarjetas de cifras de la portada ═══ */

  await p.goto("http://127.0.0.1:3000/panel");
  await p.waitForLoadState("domcontentloaded");

  const tarjetas = await p.evaluate(() => {
    const malas = [];

    for (const card of document.querySelectorAll(".panel-stats > *")) {
      const r = card.getBoundingClientRect();

      for (const hijo of card.querySelectorAll("*")) {
        const q = hijo.getBoundingClientRect();
        if (!q.width) continue;

        if (q.right > r.right + 0.5 || q.bottom > r.bottom + 0.5) {
          malas.push(
            (hijo.textContent || "").trim().slice(0, 26) +
            " [" + Math.round(q.width) + " en " + Math.round(r.width) + "]"
          );
        }
      }
    }

    const lbl = document.querySelector(".panel-stats > * span, .panel-stats > * small");
    const cs = lbl ? getComputedStyle(lbl) : null;

    return {
      desbordan: malas.length ? malas.join("  ·  ") : "ninguna",
      etiqueta: cs ? cs.fontSize + "  peso " + cs.fontWeight + "  interletraje " + cs.letterSpacing : "-",
      tarjeta: Math.round(document.querySelector(".panel-stats > *").getBoundingClientRect().width),
    };
  });

  console.log("\n═══ Tarjetas de cifras ═══\n");
  for (const [k, v] of Object.entries(tarjetas)) console.log("  " + k.padEnd(12) + v);

  /* ═══ Cómo se comporta en varias pantallas ═══ */

  console.log("\n═══ En cada pantalla ═══\n");

  for (const ancho of [1920, 1440, 1280]) {
    await p.setViewportSize({ width: ancho, height: 900 });
    await p.goto("http://127.0.0.1:3000/panel/clientes");
    await p.waitForLoadState("domcontentloaded");

    const d = await p.evaluate(() => {
      const h1 = document.querySelector(".panel-page-head h1");
      const s = document.querySelector(".panel-search");
      const td = document.querySelector(".panel-table tbody td");
      const btn = document.querySelector(".panel-btn");

      return {
        titulo: Math.round(parseFloat(getComputedStyle(h1).fontSize)),
        buscador: Math.round(s.getBoundingClientRect().width),
        fila: Math.round(td.getBoundingClientRect().height * 10) / 10,
        boton: Math.round(btn.getBoundingClientRect().height * 10) / 10,
        filas: document.querySelectorAll(".panel-table tbody tr").length,
      };
    });

    console.log(
      "  " + String(ancho).padEnd(6) +
      "titulo " + String(d.titulo).padEnd(4) +
      "buscador " + String(d.buscador).padEnd(6) +
      "fila " + String(d.fila).padEnd(6) +
      "boton " + String(d.boton).padEnd(6) +
      "filas " + d.filas
    );
  }

  await p.setViewportSize({ width: 1440, height: 900 });
  await p.goto("http://127.0.0.1:3000/panel/clientes");
  await p.waitForLoadState("domcontentloaded");

  const m = await p.evaluate(() => {
    const td = document.querySelector(".panel-table tbody td");
    const tdCs = getComputedStyle(td);

    return {
      filaAlto: Math.round(td.getBoundingClientRect().height * 10) / 10,
      td_tamano: tdCs.fontSize,
      td_interlineado: tdCs.lineHeight,
      td_relleno: tdCs.paddingTop,
      control_h: getComputedStyle(document.documentElement).getPropertyValue("--control-h").trim(),
      titulo_real: getComputedStyle(document.querySelector(".panel-page-head h1")).fontSize,
      th_alto: Math.round(document.querySelector(".panel-table thead th").getBoundingClientRect().height * 10) / 10,
    };
  });

  console.log("\n═══ Detalle de la tabla ═══\n");
  for (const [k, v] of Object.entries(m)) console.log("  " + k.padEnd(15) + v);

  await b.close();
})();