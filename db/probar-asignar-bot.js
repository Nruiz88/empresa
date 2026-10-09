require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

const BASE = process.env.TEST_PANEL || "http://127.0.0.1:3000";
const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;
const CORREO_CLIENTE = process.env.CLIENTE || "adri.ruiz.nqn@gmail.com";

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

(async () => {
  if (!EMAIL || !PASSWORD) {
    console.log("\n  Faltan TEST_EMAIL y TEST_PASSWORD.\n");
    process.exit(1);
  }

  console.log("\n═══ Asignar el bot a un cliente real ═══\n");
  console.log("  cliente: " + CORREO_CLIENTE);

  await pedir("/panel/login", {
    method: "POST",
    body: new URLSearchParams({
      _csrf: await csrfDe("/panel/login"),
      email: EMAIL,
      password: PASSWORD,
    }).toString(),
  });
  console.log("  login  ✓");

  const { data: cliente } = await db
    .from("clients")
    .select("id,empresa,nombre,email")
    .eq("email", CORREO_CLIENTE)
    .limit(1)
    .maybeSingle();

  if (!cliente) {
    console.log("\n  · no está ese cliente\n");
    return;
  }

  /* ── 1. ¿Dónde está el alta? ──
     Se prueban las DOS pantallas. La de servicios es la que se espera
     usar —es la que se llama «Servicios»— y si no ofrece aplicaciones,
     hay que decirlo con datos, no suponerlo. */
  console.log("\n  1. qué ofrece cada formulario:");

  const servicios = await (await pedir("/panel/servicios/nuevo")).text();
  const tiposServicios = [...servicios.matchAll(/<option value="([a-z_]+)"[^>]*>([^<]+)</g)]
    .map((m) => m[1])
    .filter((v) => ["mantenimiento", "proyecto", "presupuesto", "aplicacion", "plan"].includes(v));

  const cuerpo = servicios.match(/<textarea name="notas"[\s\S]{0,900}/);
  const tiposEnForm =
    tiposServicios.length ? tiposServicios : (cuerpo ? (cuerpo[0].match(/aplicacion|plan/) ? ["aplicacion"] : []) : []);

  console.log("     /panel/servicios/nuevo ofrece:   " + (tiposServicios.length ? tiposServicios.join(", ") : "(sin lista)"));
  console.log("     ¿aparece «aplicacion»?          " + (tiposServicios.includes("aplicacion") ? "sí" : "NO"));

  const apps = await (await pedir("/panel/aplicaciones/nuevo")).text();
  const ofreceApps = /name="microservicio_clave"/.test(apps);
  const ofrecePlanes = /name="plan_id"/.test(apps);
  const bots = [...apps.matchAll(/data-modulo|value="(bot_whatsapp|inventario|reservas_web)"/g)];

  console.log("     /panel/aplicaciones/nuevo ofrece: " +
    (ofreceApps ? "aplicaciones" : "—") + " / " + (ofrecePlanes ? "planes" : "—"));
  console.log("     ¿el bot aparece?                  " + (ofreceApps ? "sí" : "NO"));

  /* ── 2. Asignarlo de verdad ── */
  console.log("\n  2. doy de alta el bot para ese cliente:");

  const cuerpoPost = new URLSearchParams({
    _csrf: await csrfDe("/panel/aplicaciones/nuevo"),
    client_id: cliente.id,
    tipo: "aplicacion",
    microservicio_clave: "bot_whatsapp",
    estado: "activo",
    notas: "PRUEBA — se borra",
  });

  const r = await pedir("/panel/aplicaciones/nuevo", { method: "POST", body: cuerpoPost.toString() });
  console.log("     HTTP " + r.status + (r.headers.get("location") ? "  → " + r.headers.get("location") : ""));

  const { data: nuevo } = await db
    .from("services")
    .select("id,kind,microservicio_clave,plan_id,titulo,importe,estado")
    /* `notas` y no `notes`: la columna se llama en español.

       La primera versión la buscaba en `notes`, que no existe, y por
       eso daba «no se guardó» con un 302 delante y la fila
       guardada. Un filtro sobre una columna inexistente no da error:
       no devuelve nada, que es indistinguible de que no se haya
       guardado. */
    .eq("notas", "PRUEBA — se borra")
    .order("creado_en", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!nuevo) {
    const html = await r.text();
    const err = (html.match(/panel-cell-error[^>]*>([^<]{4,140})/) || [])[1];
    console.log("     × no se guardó" + (err ? ": " + err.trim() : ""));
    console.log("");

    console.log("  ──────────────────────────────────────────────");
    console.log("  El alta de aplicación NO funciona. Hay que mirar eso.");
    console.log("");
    process.exit(1);
  }

  console.log("     ✓ guardado: " + nuevo.kind + " / " + nuevo.titulo);
  console.log("       microservicio: " + nuevo.microservicio_clave);
  console.log("       importe:       " + (nuevo.importe === null ? "null (el bot no tiene precio todavía)" : nuevo.importe));

  /* ── 3. ¿Se le ve al cliente? ── */
  const { data: ficha } = await db
    .from("services")
    .select("id,microservicio_clave,titulo")
    .eq("client_id", cliente.id);

  console.log("\n  3. servicios del cliente ahora: " + (ficha || []).length);
  for (const s of ficha || []) {
    console.log("     " + String(s.microservicio_clave || "—").padEnd(18) + s.titulo);
  }

  /* ── Limpiar ── */
  await db.from("services").delete().eq("id", nuevo.id);
  console.log("\n  ── limpieza ──");
  console.log("     fila de prueba borrada: sí");

  console.log("");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});
