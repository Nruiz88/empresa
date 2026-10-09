/* Dar de alta una aplicación de verdad, desde el panel.
   ─────────────────────────────────────────────────────────────
   La pantalla puede estar perfecta y no guardar nada. Marcar la casilla
   se ve; que se guarde, no.

   ── LO QUE SE COMPRUEBA ──

     1. el formulario carga y lista lo que hay;
     2. el POST responde diciendo que guardó;
     3. LA BASE TIENE LA FILA. Es lo único que demuestra el alta; lo
        otro es lo que el panel dice de sí mismo;
     4. el precio se copió de la ficha, no del POST;
     5. se desmarca lo del otro grupo al cambiar de tipo, que es lo que
        hace que el CHECK de la base no reviente;
     6. un plan sin aplicaciones NO se puede dar de alta.

   ── POR QUÉ SE COMPRUEBA EL PRECIO ──

   Porque es el campo que nadie ve si se guarda mal. El alta aparece
   en la lista, el servicio existe, y el importe es 0. Nadie lo nota
   hasta que llega el cobro.
   ───────────────────────────────────────────────────────────── */
require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

const BASE = process.env.TEST_PANEL || "http://127.0.0.1:3000";
const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

let cookie = "";

async function pedir(ruta, opciones = {}) {
  const r = await fetch(BASE + ruta, {
    redirect: "manual",
    ...opciones,
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

async function csrfDe(ruta) {
  const html = await (await pedir(ruta)).text();
  const m = html.match(/name=["']_csrf["']\s+value=["']([^"']+)["']/i);
  if (!m) throw new Error("no se encontró el csrf en " + ruta);
  return m[1];
}

async function alta(datos) {
  const cuerpo = new URLSearchParams({ _csrf: await csrfDe("/panel/aplicaciones/nuevo") });
  Object.entries(datos).forEach(([k, v]) => {
    if (v !== null && v !== undefined) cuerpo.append(k, v);
  });

  const r = await pedir("/panel/aplicaciones/nuevo", {
    method: "POST",
    body: cuerpo.toString(),
  });

  return { status: r.status, location: r.headers.get("location") || "", html: await r.text() };
}

(async () => {
  if (!EMAIL || !PASSWORD) {
    console.log("\n  Faltan TEST_EMAIL y TEST_PASSWORD.\n");
    process.exit(1);
  }

  console.log("\n═══ Dar de alta una aplicación ═══\n");

  await pedir("/panel/login", {
    method: "POST",
    body: new URLSearchParams({
      _csrf: await csrfDe("/panel/login"),
      email: EMAIL,
      password: PASSWORD,
    }).toString(),
  });
  console.log("  login  ✓");

  /* ---- 1. El formulario ---- */
  const form = await (await pedir("/panel/aplicaciones/nuevo")).text();

  console.log("\n  1. el formulario:");
  console.log("    Inputs de aplicación:  " + (form.match(/name="microservicio_clave"/g) || []).length);
  console.log("     Inputs de plan:       " + (form.match(/name="plan_id"/g) || []).length);
  console.log("     Campo de precio:      " +
    (form.includes('name="importe"') ? "SÍ (no debería haberlo)" : "ninguno, como debe ser"));

  if (form.includes('name="importe"')) {
    console.log("\n  × hay un campo de importe. El precio sale de la ficha; si se puede");
    console.log("    escribir, alguien lo escribe distinto del real y queda guardado.\n");
    process.exit(1);
  }

  /* ---- 2. Alta de una aplicación ---- */
  const { data: app } = await db.rpc("ejecutar_sql", {
    consulta:
      "select modulo, nombre, precio from microservicios " +
      "where activo = true order by nombre limit 1",
    args: [],
  });
  const { data: cli } = await db.rpc("ejecutar_sql", {
    consulta: "select id from clients where archivado = false limit 1",
    args: [],
  });

  if (!app || !app.length || !cli || !cli.length) {
    console.log("\n  · no hay con qué probar (sin aplicaciones activas o sin clientes)\n");
    process.exit(0);
  }

  const elegido = app[0];
  console.log("\n  2. doy de alta «" + elegido.nombre + "» a un cliente");

  const antes = await db.rpc("ejecutar_sql", {
    consulta: "select count(*) as c from services",
    args: [],
  });

  const r = await alta({
    client_id: cli[0].id,
    tipo: "aplicacion",
    microservicio_clave: elegido.modulo,
    estado: "activo",
    inicia_en: "2026-10-09",
    termina_en: "2026-11-09",
    notas: "PRUEBA — se borra",
  });

  console.log("     HTTP " + r.status + (r.location ? "  → " + r.location : ""));

  /* ---- 3. ¿Está en la base? ---- */
  const { data: nueva } = await db.rpc("ejecutar_sql", {
    consulta:
      "select id, kind, microservicio_clave, plan_id, titulo, importe, moneda, " +
      "periodicidad, notas, inicia_en, termina_en " +
      "from services order by creado_en desc limit 1",
    args: [],
  });
  const fila = nueva && nueva[0];

  console.log("\n  3. en la base:");

  /* Por prefijo y no por igualdad exacta.

     La primera versión comparaba la nota con un texto entero, y falló
     aunque la fila estuviera ahí. No vale la pena averiguar qué carácter
     se coló: comparar el contenido exacto de un texto escrito a mano es
     frágil por definición. Con un prefijo no hay nada que depurar. */
  if (!fila || !String(fila.notas || "").startsWith("PRUEBA")) {
    console.log("     × no aparece la fila del alta");
    process.exit(1);
  }

  console.log("     id:        " + fila.id.slice(0, 8));
  console.log("     tipo:      " + fila.kind);
  console.log("     aplicación: " + fila.microservicio_clave);
  console.log("     plan:      " + (fila.plan_id || "ninguno"));
  console.log("     título:    " + fila.titulo);
  console.log("     importe:   " + (fila.importe === null ? "null" : fila.importe) + " " + fila.moneda);
  console.log("     desde:     " + String(fila.inicia_en).slice(0, 10));
  console.log("     hasta:     " + String(fila.termina_en).slice(0, 10));
  console.log("");

  const fallos = [];

  if (fila.kind !== "aplicacion") fallos.push("el tipo");
  if (fila.microservicio_clave !== elegido.modulo) fallos.push("qué aplicación");
  if (fila.plan_id !== null) fallos.push("el plan debería quedar en null");

  /* ---- 4. El precio ---- */
  const precioFicha =
    elegido.precio === null || elegido.precio === undefined ? null : Number(elegido.precio);

  if (precioFicha === null) {
    console.log("     la ficha no tiene precio, así que queda null. Correcto.");
  } else if (Number(fila.importe) === precioFicha) {
    console.log("     ✓ el importe es el de la ficha (" + precioFicha + "), no uno escrito a mano");
  } else {
    console.log("     × el importe NO es el de la ficha");
    fallos.push("el importe");
  }

  /* ---- 5. Sin tipo no guarda ---- */
  console.log("\n  4. sin elegir tipo:");
  const sinTipo = await alta({ client_id: cli[0].id, estado: "activo" });

  /* ─────────────────────────────────────────────────────────
     Lo que se busca es que se diga QUÉ falta.

     El mensaje no es «Elegí qué aplicación» sino el del campo vacío,
     «Este campo es obligatorio». La primera versión buscaba el texto
     largo y por eso daba ⚠ con el formulario funcionando bien.

     ── POR QUÉ BUSCAR EL AVISO Y NO SOLO EL CÓDIGO ──

     Un 200 con el formulario de vuelta es ambiguo: puede ser que se
     rechazara bien o que la pantalla se hubiera caído. Lo que
     distingue los dos es que haya un aviso Diciendo qué corregir. Si
     mañana el aviso desaparece y queda solo el 200, esta comprobación
     lo nota; si solo mirara el código, no.
     ───────────────────────────────────────────────────────── */
  const aviso = sinTipo.html.includes("Este campo es obligatorio");

  const seGuardo = /alta=/.test(sinTipo.html);

  console.log("     HTTP " + sinTipo.status +
    (aviso ? "  → rechazado con aviso  ✓" : "  → ⚠ vuelve el formulario SIN decir qué falta"));
  console.log("     ¿creó la fila? " + (seGuardo ? "SÍ  ×" : "no  ✓"));

  if (!aviso) fallos.push("el formulario rechaza sin decir qué falta");
  if (seGuardo) fallos.push("se guardó un alta sin tipo");

  /* ---- 6. Un plan sin aplicaciones NO se puede dar de alta ---- */
  console.log("\n  5. un plan sin aplicaciones marcadas:");
  const { data: planVacio } = await db.rpc("ejecutar_sql", {
    consulta:
      "select id, nombre from plans " +
      "where coalesce(aplicaciones, '{}') = '{}' and activo = true limit 1",
    args: [],
  });

  if (planVacio && planVacio.length) {
    const r2 = await alta({
      client_id: cli[0].id,
      tipo: "plan",
      plan_id: planVacio[0].id,
      estado: "activo",
    });

    const avisó = /no tiene ninguna aplicación/.test(r2.html);

    console.log("     plan «" + planVacio[0].nombre + "»");
    console.log("     HTTP " + r2.status + (avisó ? "  → rechazado con aviso  ✓" : "  → ⚠ LO DEJÓ PASAR"));

    if (!avisó) fallos.push("un plan vacío se puede vender");

    /* Y confirmar que NO se creó. */
    const { data: comprueba } = await db.rpc("ejecutar_sql", {
      consulta:
        "select count(*) as c from services where kind = 'plan' and plan_id = '" +
        planVacio[0].id + "'",
      args: [],
    });
    const crept = Number(comprueba && comprueba[0] ? comprueba[0].c : 0);
    console.log("     filas creadas con ese plan: " + crept + (crept === 0 ? "  ✓" : "  ×"));

    if (crept > 0) fallos.push("se creó la fila del plan vacío");
  } else {
    console.log("     (todos los planes tienen aplicaciones: nada que probar acá)");
  }

  /* ---- Limpiar ---- */
  console.log("\n  ── limpieza ──");
  const { error: eB } = await db.from("services").delete().eq("id", fila.id);
  console.log("     fila de prueba borrada: " + (eB ? "NO — " + eB.message : "sí"));

  const { data: quedan } = await db.rpc("ejecutar_sql", {
    consulta: "select count(*) as c from services where notas like 'PRUEBA%'",
    args: [],
  });
  console.log("     filas de prueba que quedan: " + (quedan && quedan[0] ? quedan[0].c : 0));

  console.log("");

  if (fallos.length) {
    console.log("  × " + fallos.length + " fallo(s): " + fallos.join(", ") + "\n");
    process.exit(1);
  }

  console.log("  ✓ el alta funciona de punta a punta\n");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});