/* Prueba de verdad del generador de cobros: lo ejecuta contra el
   servidor dos veces y comprueba que la segunda no crea nada.

   No sirve de nada probar que el plan está bien en aislamiento: lo
   que importa es que lo que enseña la pantalla sea lo que se crea,
   y que darle dos veces no duplique la facturación de nadie. */
const env = require("../../lib/env");
env.load();
const cm = require("../../lib/cobros-mensuales");
const { iso, sumarDias, aDia } = require("../../lib/fechas");
const supabase = require("../../lib/supabase");
const { staff, staffOParar } = require("../../lib/staff");
const db = supabase.getAdmin();
const crypto = require("crypto");

const BASE = "http://127.0.0.1:3000";
const CSRF = "pruebagenerar";

let fallos = 0;
const ok = (c, n, extra) => {
  console.log(`  ${c ? "✓" : "✗"} ${n}${extra ? "  → " + extra : ""}`);
  if (!c) fallos++;
};

(async () => {
  const { data: usuarios } = await supabase.getAdmin().auth.admin.listUsers({ perPage: 200 });
  const staff = await staffOParar();

  const token = crypto.randomBytes(24).toString("hex");
  await db.from("sessions").insert({
    token_hash: crypto.createHash("sha256").update(token).digest("hex"),
    user_id: staff.id,
    rol: "staff",
    csrf_token: CSRF,
    expira_en: new Date(Date.now() + 900e3).toISOString(),
  });

  const cookies = { cookie: "nexo_panel=" + token };

  /* ---------- Vista previa ---------- */

  /* Se usa un periodo lejano y de prueba, y se borra al terminar.
     Motivo: si el test usara el mes real, la segunda ejecución no
     tendría nada que crear (porque la primera ya lo creó) y fallaría
     sin que hubiera ningún fallo real. Un periodo propio lo hace
     repetible, y además no pisa cobros de verdad si algún día hay
     datos de producción aquí. */
  const PERIODO = "2031-03";

  await db.from("cobros").delete().eq("periodo", PERIODO);

  const previo = await (await fetch(BASE + "/panel/cobros/generar?periodo=" + PERIODO, { headers: cookies })).text();
  const anunciados = Number((previo.match(/Generar (\d+) cobros?/) || [0, 0])[1]);

  console.log("\n── vista previa ──");
  ok(previo.toLowerCase().includes("cobros a crear"), "la pantalla dice cuántos crearía");
  ok(anunciados > 0, "hay al menos un servicio que facturar en el periodo de prueba", "anuncia " + anunciados);
  ok(
    previo.includes("No se facturan") || !previo.includes("con deuda pendiente"),
    "avisa de a quién no va a facturar"
  );

  const { data: antes } = await db.from("cobros").select("id,periodo,service_id");
  console.log(`   · cobros en la base antes: ${antes.length}`);
  console.log(`   · la pantalla anuncia: ${anunciados}`);

  /* ---------- Generar ---------- */
  console.log("\n── primera vez ──");
  const r1 = await fetch(BASE + "/panel/cobros/generar", {
    method: "POST",
    redirect: "manual",
    headers: { ...cookies, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: CSRF, periodo: PERIODO }).toString(),
  });
  const hechos = Number(new URL(r1.headers.get("location"), BASE).searchParams.get("hecho") || 0);

  const { data: despues } = await db.from("cobros").select("id,periodo,service_id");
  const nuevos = despues.length - antes.length;

  ok(nuevos === hechos, "se crean tantos cobros como decía la pantalla", `${anunciados} -> ${hechos} creados`);
  ok(nuevos === anunciados, "y coinciden con el anuncio", `${anunciados} vs ${nuevos}`);

  /* Todos los nuevos son del periodo pedido. */
  const nuevos10 = despues.filter((c) => !antes.some((a) => a.id === c.id));
  ok(nuevos10.length > 0, "se ha creado al menos uno", nuevos10.length + " creados");
  ok(nuevos10.every((c) => c.periodo === PERIODO), "los nuevos son del periodo pedido");

  /* ---------- El plazo de pago, contra la base ----------
     Esto es lo que no se puede comprobar en `db/test-cobros-mensuales.js`:
     que la fila que entra de verdad lleva el vencimiento a 20 días de SU
     fecha de emisión. Si la ruta calculara el plan con una fecha y
     escribiera otra, aquí se vería, porque se leen los dos campos de la
     misma fila y se comparan. */
  console.log("\n── el plazo en la base ──");

  const { data: conFechas } = await db
    .from("cobros")
    .select("emitido_en,vence_en")
    .in("id", nuevos10.map((c) => c.id));

  ok(
    conFechas.every((c) => !!c.emitido_en && !!c.vence_en),
    "todos los cobros nuevos tienen fecha de emisión y de vencimiento"
  );

  const mal = conFechas
    .map((c) => {
      const esperado = iso(sumarDias(c.emitido_en, cm.DIAS_VENCIMIENTO));
      return c.vence_en === esperado
        ? null
        : `${c.emitido_en} -> ${c.vence_en} (esperado ${esperado})`;
    })
    .filter(Boolean);

  ok(
    mal.length === 0,
    `el vencimiento son ${cm.DIAS_VENCIMIENTO} días después de la emisión, en cada fila`,
    mal.join("; ")
  );

  /* Y que el vencimiento nunca sea anterior a la emisión: si lo fuera,
     el cliente nacería bloqueado, y además la vista "no puede vencerse
     antes de emitirse" no lo habría parado porque esta fila no pasa por
     el formulario. */
  ok(
    conFechas.every((c) => aDia(c.vence_en).getTime() >= aDia(c.emitido_en).getTime()),
    "ningún cobro nace ya vencido"
  );

  /* ---------- Generar otra vez ---------- */
  console.log("\n── segunda vez, sin hacer nada nuevo ──");
  const r2 = await fetch(BASE + "/panel/cobros/generar", {
    method: "POST",
    redirect: "manual",
    headers: { ...cookies, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: CSRF, periodo: PERIODO }).toString(),
  });
  const hechos2 = Number(new URL(r2.headers.get("location"), BASE).searchParams.get("hecho") || 0);

  const { data: final } = await db.from("cobros").select("id,service_id,periodo");

  ok(hechos2 === 0, "la segunda vez no crea nada", "hechos=" + hechos2);
  ok(final.length === despues.length, "el total de cobros no cambia", `${despues.length} -> ${final.length}`);

  /* Duplicados reales: mismo servicio, mismo periodo. */
  const pares = new Set();
  let duplicados = 0;
  for (const c of final.filter((x) => x.periodo === PERIODO)) {
    const k = c.service_id + "|" + c.periodo;
    if (pares.has(k)) duplicados++;
    pares.add(k);
  }
  ok(duplicados === 0, "no hay dos cobros del mismo servicio y periodo", `duplicados=${duplicados}`);

  /* ---------- Periodo sucio: no debe crear nada ----------
     Poner un periodo que no existe no debe colar. */
  const r3 = await fetch(BASE + "/panel/cobros/generar", {
    method: "POST",
    redirect: "manual",
    headers: { ...cookies, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: CSRF, periodo: "basura" }).toString(),
  });
  const { data: trasBasura } = await db.from("cobros").select("id");
  ok(trasBasura.length === final.length, "un periodo inválido no crea nada", `total=${trasBasura.length}`);

  /* ---------- Limpiar ----------
     Se borra lo del periodo de prueba para no dejar basura de test en
     la base, y para que la siguiente ejecución empiece igual. */
  await db.from("cobros").delete().eq("periodo", PERIODO);
  await db.from("sessions").delete().eq("csrf_token", CSRF);

  console.log(fallos ? `\n  ${fallos} fallo(s)\n` : "\n  Todo correcto\n");
  process.exit(fallos ? 1 : 0);
})().catch((e) => {
  console.error("error: " + e.message);
  process.exit(1);
});
