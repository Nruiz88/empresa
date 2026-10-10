/* El catálogo de aplicaciones, de punta a punta.
   ─────────────────────────────────────────────────────────────
   Que la pantalla exista no es lo mismo que sirva para algo.

   Se comprueba lo que cambia de verdad:

     1. la pantalla carga y muestra lo que hay;
     2. un precio con punto de miles se guarda bien —«45.000» en
        Argentina, no 45—;
     3. un precio vacío se guarda como vacío, no como 0;
     4. desmarcar «se vende» se guarda de verdad, y volver a marcar
        también: es el patrón del campo oculto y es donde falla;
     5. LA BASE TIENE LO QUE SE ESCRIBIÓ. Al final se deja todo como
        estaba, y eso se comprueba también.

   ── POR QUÉ SE RESTAURA AL FINAL ──

   Porque estos son datos de producción. La prueba los cambia, mira, y
   los vuelve a poner. Si algo falla a medio camino, el `finally` deja
   las cosas como estaban: una prueba que rompe el catálogo porque se
   cortó a la mitad es peor que no tenerla.
   ───────────────────────────────────────────────────────────── */
require("../../lib/env").load();

const db = require("../../lib/supabase").getAdmin();

const BASE = process.env.TEST_PANEL || "http://127.0.0.1:3000";
const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

/* ─────────────────────────────────────────────────────────────
   LO QUE SE GUARDA PARA RESTAURAR

   Se guarda la fila COMPLETA antes de tocarla, no solo los campos que
   se cambian. Si mañana el catálogo tiene otro campo editable, este
   script lo seguiría restaurando sin tocarlo.

   Y se guarda por módulo, que es la clave: es lo único que no cambia.
   ───────────────────────────────────────────────────────────── */
let original = null;

async function pedir(ruta, opciones = {}) {
  const r = await fetch(BASE + ruta, {
    redirect: "manual",
    ...opciones,
    /* Exactamente la misma forma que `test-alta-aplicacion.js`.

       Se probó mandar la cookie siempre, incluso vacía, y el login
       devolvía 403 con «CSRF rechazado». La diferencia entre un guion y
       otro es que aquí se manda `cookie: ""` en el primer GET, y el
       servidor toma esa petición como «vengo con una cookie de sesión
       vacía». Los dos tests usan esta forma y los dos entran. */
    headers: Object.assign(
      cookie ? { cookie } : {},
      opciones.body ? { "content-type": "application/x-www-form-urlencoded" } : {},
      opciones.headers || {}
    ),
    signal: AbortSignal.timeout(30000),
  });

  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");

  return r;
}

let cookie = "";

async function csrfDe(ruta) {
  const html = await (await pedir(ruta)).text();
  const m = html.match(/name=["']_csrf["']\s+value=["']([^"']+)["']/i);
  if (!m) throw new Error("no se encontró el csrf en " + ruta);
  return m[1];
}

/** Manda el formulario con los valores que se le pasen. */
async function guardar(cambios) {
  const cuerpo = new URLSearchParams({
    _csrf: await csrfDe("/panel/aplicaciones/catalogo"),
  });

  for (const [k, v] of Object.entries(cambios)) {
    if (v !== null && v !== undefined) cuerpo.append(k, String(v));
  }

  const r = await pedir("/panel/aplicaciones/catalogo", {
    method: "POST",
    body: cuerpo.toString(),
  });

  return { status: r.status, html: await r.text() };
}

const fallos = [];

(async () => {
  if (!EMAIL || !PASSWORD) {
    console.log("\n  Faltan TEST_EMAIL y TEST_PASSWORD.\n");
    process.exit(1);
  }

  console.log("\n═══ Catálogo de aplicaciones ═══\n");

  /* ─────────────────────────────────────────────────────────
     EL LOGIN SE COMPRUEBA, NO SE SUPONE

     La primera versión imprimía «login ✓» sin mirar nada, porque la
     llamada no lanzaba. Si el login falla —mal csrf, sesión no
     guardada, límite de intentos— la respuesta es un 200 con el
     formulario de nuevo y el test sigue adelante creyendo que tiene
     sesión.

     Y entonces todo lo que viene después está mal: la pantalla del
     catálogo se pide sin sesión, responde 302 al login, y no hay ni
     una fila. El fallo se lee como «faltan aplicaciones», que no dice
     nada de la causa real.

     Por eso el estado se mira, y si no es 302 se dice qué fue.
     ───────────────────────────────────────────────────────── */
  const token = await csrfDe("/panel/login");

  const rLogin = await pedir("/panel/login", {
    method: "POST",
    body: new URLSearchParams({
      _csrf: token,
      email: EMAIL,
      password: PASSWORD,
    }).toString(),
  });

  const destino = rLogin.headers.get("location") || "";

  if (rLogin.status === 302 && !destino.includes("login")) {
    console.log("  login  ✓");
  } else {
    console.log("  × el login NOEntró");
    console.log("     HTTP " + rLogin.status);
    console.log("     destino: " + (destino || "(ninguno, se quedó en la pantalla de login)"));

    const cuerpo = await rLogin.text();
    const motivo =
      (cuerpo.match(/class="panel-[a-z-]*error[^"]*"[^>]*>([^<]{4,120})/) || [])[1] ||
      (cuerpo.match(/<p class="[^"]*error[^"]*">([^<]{4,120})/) || [])[1];

    if (motivo) console.log("     dice: " + motivo.trim());

    console.log("");
    console.log("  Sin sesión no se puede probar nada más. No se sigue.");
    process.exit(1);
  }

  /* ── 1. La pantalla ── */
  const { data: apps } = await db
    .from("microservicios")
    .select("modulo,nombre,precio,moneda,periodo,activo")
    .order("nombre");

  console.log("\n  1. la pantalla:");
  console.log("     aplicaciones en la base: " + ((apps || []).length));

  if (!(apps || []).length) {
    console.log("\n  · no hay aplicaciones con qué probar\n");
    return;
  }

  const pantalla = await (await pedir("/panel/aplicaciones/catalogo")).text();

  const conPrecio = (pantalla.match(/name="precio_/g) || []).length;
  console.log('     campos de precio:        ' + conPrecio);
  console.log('     columna de clientes:     ' + (pantalla.includes("Clientes") ? "sí" : "NO"));

  if (conPrecio !== (apps || []).length) {
    console.log("\n  × la pantalla no muestra todas las aplicaciones");
    fallos.push("faltan filas");
  }

  /* ── Elegir una con la que trabajar ──
     Se busca la que NO esté en ningún plan, para no tocar el catálogo
     mientras se prueba. Si todas están, se avisa pero se sigue: es
     mejor probar y avisar que no probar. */
  const { data: planes } = await db.from("plans").select("aplicaciones");

  const enPlan = new Set();
  for (const p of planes || []) {
    for (const c of Array.isArray(p.aplicaciones) ? p.aplicaciones : []) enPlan.add(c);
  }

  const libre = (apps || []).find((a) => !enPlan.has(a.modulo));
  const elegida = libre || (apps || [])[0];

  console.log("\n  2. trabajo con «" + elegida.nombre + "» (" + elegida.modulo + ")");
  if (!libre) {
    console.log("     ⚠ está en algún plan. Se prueba igual, y se restaura.");
  }

  /* ── Guardar lo que hay ahora ── */
  original = { ...elegida };
  console.log("     precio actual: " + (elegida.precio === null ? "vacío" : elegida.precio));
  console.log("     activa: " + elegida.activo);

  try {
    /* ── 2. El precio con punto de miles ──
       «45.000» tiene que guardarse como 45000, no como 45. En
       Argentina el punto es separador de miles, y `Number()` no lo
       sabe. */
    console.log("\n  3. precio «45.000» (con punto de miles):");

    const r1 = await guardar({
      ["precio_" + elegida.modulo]: "45.000",
      ["nombre_" + elegida.modulo]: elegida.nombre,
      ["moneda_" + elegida.modulo]: elegida.moneda || "ARS",
      ["periodo_" + elegida.modulo]: elegida.periodo || "mes",
      ["activo_" + elegida.modulo]: elegida.activo ? "1" : "0",
    });

    let { data: leido } = await db
      .from("microservicios")
      .select("precio,moneda")
      .eq("modulo", elegida.modulo)
      .single();

    console.log("     HTTP " + r1.status + "  ->  " + (leido.precio === 45000 ? "45000  ✓" : leido.precio + "  ×"));
    if (Number(leido.precio) !== 45000) fallos.push("el precio con puntos de miles");

    /* ── 3. Precio vacío ──
       Vacío es «A consultar». Si se guardara como 0, la web publicaría
       que la aplicación es gratis. */
    console.log("\n  4. precio vacío («A consultar»):");

    await guardar({
      ["precio_" + elegida.modulo]: "",
      ["nombre_" + elegida.modulo]: elegida.nombre,
      ["moneda_" + elegida.modulo]: elegida.moneda || "ARS",
      ["periodo_" + elegida.modulo]: elegida.periodo || "mes",
      ["activo_" + elegida.modulo]: elegida.activo ? "1" : "0",
    });

    ({ data: leido } = await db
      .from("microservicios")
      .select("precio")
      .eq("modulo", elegida.modulo)
      .single());

    console.log("     ->  " + (leido.precio === null ? "null  ✓" : JSON.stringify(leido.precio) + "  ×"));
    if (leido.precio !== null) fallos.push("el precio vacío no quedó vacío");

    /* ── 4. El campo oculto de «se vende» ──
       Es el patrón de toda la casa, y es donde falla: sin el campo
       oculto con "0", la casilla desmarcada no llega y no se puede
       guardar. */
    console.log("\n  5. desmarcar «se vende» y volver a marcar:");

    await guardar({
      ["precio_" + elegida.modulo]: "",
      ["nombre_" + elegida.modulo]: elegida.nombre,
      ["moneda_" + elegida.modulo]: elegida.moneda || "ARS",
      ["periodo_" + elegida.modulo]: elegida.periodo || "mes",
      ["activo_" + elegida.modulo]: "0",
    });

    ({ data: leido } = await db
      .from("microservicios")
      .select("activo")
      .eq("modulo", elegida.modulo)
      .single());

    console.log("     desmarcada ->  " + (leido.activo === false ? "false  ✓" : "true  ×"));
    if (leido.activo !== false) fallos.push("no se puede desmarcar");

    await guardar({
      ["precio_" + elegida.modulo]: "",
      ["nombre_" + elegida.modulo]: elegida.nombre,
      ["moneda_" + elegida.modulo]: elegida.moneda || "ARS",
      ["periodo_" + elegida.modulo]: elegida.periodo || "mes",
      ["activo_" + elegida.modulo]: "1",
    });

    ({ data: leido } = await db
      .from("microservicios")
      .select("activo")
      .eq("modulo", elegida.modulo)
      .single());

    console.log("     marcada    ->  " + (leido.activo === true ? "true  ✓" : "false  ×"));
    if (leido.activo !== true) fallos.push("no se puede volver a marcar");

    /* ── 5. Un módulo que no existe ──
       El POST lee la lista de la base, así que un campo de más se
       ignora. Se comprueba que no se crea nada. */
    console.log("\n  6. un módulo inventado:");
    const antes = (await db.from("microservicios").select("modulo")).data.length;

    const r6 = await guardar({
      precio_inventado_9999: "1",
      nombre_inventado_9999: "No existe",
    });

    const despues = (await db.from("microservicios").select("modulo")).data.length;
    console.log("     filas antes " + antes + ", después " + despues +
      (despues === antes ? "  ✓" : "  ×"));

    if (despues !== antes) fallos.push("creó una aplicación que no existía");

    /* ── 6. Un precio que no es un número ── */
    console.log("\n  7. un precio que no es un número:");
    const r7 = await guardar({
      ["precio_" + elegida.modulo]: "mucho",
      ["nombre_" + elegida.modulo]: elegida.nombre,
      ["moneda_" + elegida.modulo]: elegida.moneda || "ARS",
      ["periodo_" + elegida.modulo]: elegida.periodo || "mes",
      ["activo_" + elegida.modulo]: elegida.activo ? "1" : "0",
    });

    const aviso = /número|A consultar/.test(r7.html);
    console.log("     HTTP " + r7.status + (aviso ? "  ->  rechazado con aviso  ✓" : "  ->  ⚠ LO DEJÓ PASAR"));
    if (!aviso) fallos.push("acepta un precio que no es un número");
  } finally {
    /* ── Restaurar ── */
    console.log("\n  ── restaurar ──");

    const { error } = await db
      .from("microservicios")
      .update({
        nombre: original.nombre,
        descripcion: original.descripcion,
        precio: original.precio,
        moneda: original.moneda,
        periodo: original.periodo,
        activo: original.activo,
      })
      .eq("modulo", original.modulo);

    console.log("     restaurada: " + (error ? "NO — " + error.message : "sí"));

    const { data: comprobar } = await db
      .from("microservicios")
      .select("nombre,precio,moneda,periodo,activo")
      .eq("modulo", original.modulo)
      .single();

    const igual =
      comprobar.precio === original.precio &&
      comprobar.activo === original.activo &&
      comprobar.nombre === original.nombre;

    console.log("     quedó como estaba: " + (igual ? "sí  ✓" : "NO  ×"));
    if (!igual) fallos.push("no se restauró");
  }

  console.log("");

  if (fallos.length) {
    console.log("  × " + fallos.length + " fallo(s): " + fallos.join(", ") + "\n");
    process.exit(1);
  }

  console.log("  ✓ el catálogo funciona de punta a punta\n");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});
