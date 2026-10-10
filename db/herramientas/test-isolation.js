/* =========================================================
   Nexo Studio — Prueba de aislamiento entre clientes
   ------------------------------------------------------------
   Comprueba que las políticas RLS hacen su trabajo: un cliente
   solo ve lo suyo.

   POR QUÉ ESTA PRUEBA ES IMPORTANTE
   ---------------------------------
   Todo el portal de clientes descansa sobre RLS. Si una política
   está mal escrita, el síntoma NO es un error: es que un cliente
   ve la facturación de otro y nadie se entera. Esa clase de fallo
   no aparece en los tests habituales.

   Cómo funciona:
     1. El servidor crea dos empresas con un servicio cada una
        (con la secret key, que es lo único que puede)
     2. Se entra como el cliente de la empresa A con la clave
        PÚBLICA, que es la vía por la que entra un navegador
     3. Se pregunta por clientes y servicios usando esa sesión
     4. Se espera ver solo lo de A

   Uso:  node db/test-isolation.js
   ========================================================= */

const env = require("../../lib/env");
env.load();
env.require("SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_PUBLISHABLE_KEY");

const supabase = require("../../lib/supabase");
const admin = supabase.getAdmin();

const SUFIJO = "-test-aisla";
let fallos = 0;
let pruebas = 0;

const ok = (m) => console.log("  ✓ " + m);
const fail = (m) => {
  console.log("  ✗ " + m);
  fallos++;
};
const comprobar = (condicion, mensaje) => {
  pruebas++;
  if (condicion) ok(mensaje);
  else fail(mensaje);
};

async function main() {
  console.log("\n── Preparando datos de prueba ──────────────────────");

  /* Limpieza de pruebas anteriores */
  const { data: viejos } = await admin.from("clients").select("id").ilike("empresa", "%" + SUFIJO);
  if (viejos && viejos.length) {
    await admin.from("services").delete().in("client_id", viejos.map((c) => c.id));
    await admin.from("profiles").delete().in("client_id", viejos.map((c) => c.id));
    await admin.from("clients").delete().in("id", viejos.map((c) => c.id));
  }

  /* Dos empresas independientes */
  const empresaA = "Empresa Alpha" + SUFIJO;
  const empresaB = "Empresa Beta" + SUFIJO;

  const { data: clientes, error: errCli } = await admin
    .from("clients")
    .insert([
      { nombre: "Ana Alpha", empresa: empresaA, email: "ana@test.local" },
      { nombre: "Beto Beta", empresa: empresaB, email: "beto@test.local" },
    ])
    .select();

  if (errCli) {
    console.error("\n✗ No se pudieron crear las empresas: " + errCli.message + "\n");
    process.exit(1);
  }

  const [cliA, cliB] = clientes;
  console.log(`  · ${empresaA} (id ${cliA.id.slice(0, 8)})`);
  console.log(`  · ${empresaB} (id ${cliB.id.slice(0, 8)})`);

  /* Un servicio para cada una. El de B tiene un importe alto, para
     que si se cuela lo veamos en el resultado. */
  const { data: servicios, error: errSvc } = await admin
    .from("services")
    .insert([
      {
        client_id: cliA.id,
        kind: "mantenimiento",
        estado: "activo",
        titulo: "Mantenimiento mensual",
        importe: 99,
      },
      {
        client_id: cliB.id,
        kind: "proyecto",
        estado: "en_curso",
        titulo: "SECRETO DE B — Importe 25.000",
        importe: 25000,
      },
    ])
    .select();

  if (errSvc) {
    console.error("\n✗ No se pudieron crear los servicios: " + errSvc.message + "\n");
    process.exit(1);
  }
  const [srvA, srvB] = servicios;
  console.log("  · un servicio por empresa");

  /* Usuario de la empresa A */
  const emailTest = "cliente-a@test.local";
  const claveTest = "PruebaAislada123";

  // Limpiar el usuario de Auth si existe de una prueba anterior
  const { data: lprev } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const previo = (lprev.users || []).find((u) => u.email === emailTest);
  if (previo) {
    await admin.from("profiles").delete().eq("id", previo.id);
    await admin.auth.admin.deleteUser(previo.id);
  }

  const { data: creado, error: errAuth } = await admin.auth.admin.createUser({
    email: emailTest,
    password: claveTest,
    email_confirm: true,
  });
  if (errAuth) {
    console.error("\n✗ No se pudo crear el usuario: " + errAuth.message + "\n");
    process.exit(1);
  }

  await admin.from("profiles").insert({
    id: creado.user.id,
    rol: "client",
    client_id: cliA.id,
    nombre: "Ana Alpha",
    activo: true,
  });
  console.log("  · usuario cliente creado para la empresa A");

  /* Cobros de las DOS empresas. Sin uno de la empresa B, la
     comprobación de que no ve los ajenos no probaría nada: no hay
     nada que ver. */
  const { data: cobrosTest } = await admin
    .from("cobros")
    .insert([
      {
        service_id: srvA.id,
        concepto: "COBRO PROPIO DE A",
        importe: 100,
        estado: "pendiente",
        periodo: "2026-01",
      },
      {
        service_id: srvB.id,
        concepto: "SECRETO DE B",
        importe: 99999,
        estado: "pendiente",
        periodo: "2026-01",
      },
    ])
    .select("id,concepto");

  console.log("  · 2 cobros de prueba (uno por empresa)");

  /* =========================================================
     Ahora sí: entrar como el cliente con la clave PÚBLICA.
     Esta es la vía por la que entra un navegador, donde RLS manda.
     ========================================================= */
  console.log("\n── Entrando como el cliente A (vía pública) ────────");

  const publico = supabase.getPublico();
  const { data: sesion, error: errLogin } = await publico.auth.signInWithPassword({
    email: emailTest,
    password: claveTest,
  });

  if (errLogin || !sesion || !sesion.session) {
    console.error("\n✗ No se pudo iniciar sesión: " + (errLogin ? errLogin.message : "sin sesión") + "\n");
    process.exit(1);
  }
  ok("sesión iniciada (la que usaría un navegador)");

  /* ¿Quién cree que ser? */
  const { data: yo } = await publico.auth.getUser();
  comprobar(yo && yo.user && yo.user.id === creado.user.id, "identidad correcta");

  /* ---------- clients ---------- */
  console.log("\n── RLS sobre 'clients' ─────────────────────────────");
  const { data: visiblesCli, error: errC } = await publico.from("clients").select("empresa");
  if (errC) fail("error al leer clients: " + errC.message);

  const empresas = (visiblesCli || []).map((c) => c.empresa);
  console.log("   ve: " + (empresas.length ? empresas.join(", ") : "(nada)"));

  comprobar(empresas.length === 1, "solo ve una empresa (hay 2 en la base)");
  comprobar(empresas[0] === empresaA, "es la SUYA, no la de otro");

  /* Intento de escritura: no debe poder crear clientes */
  const { error: errIns } = await publico
    .from("clients")
    .insert({ nombre: "Intruso", empresa: "Hack" + SUFIJO });
  comprobar(Boolean(errIns), "no puede crear clientes");

  /* ---------- services ---------- */
  console.log("\n── RLS sobre 'services' ───────────────────────────");
  const { data: visiblesSvc } = await publico.from("services").select("titulo,importe,client_id");

  const titulos = (visiblesSvc || []).map((s) => s.titulo);
  console.log("   ve: " + (titulos.length ? titulos.join(", ") : "(nada)"));

  comprobar(titulos.length === 1, "solo ve un servicio (hay 2 en la base)");
  comprobar(
    !titulos.some((t) => String(t).includes("SECRETO DE B")),
    "NO aparece el servicio de la otra empresa"
  );
  comprobar(
    (visiblesSvc || []).every((s) => s.client_id === cliA.id),
    "todos los servicios que ve son de su empresa"
  );

  /* No puede modificar servicios.
     OJO: aquí NO se mira que haya error. RLS no da error: filtra las
     filas en silencio y la operación "tiene éxito" sobre cero filas.
     Por eso hay que pedir el .select() y contar cuántas cambiaron.
     Un update sobre filas que RLS esconde devuelve [] sin error. */
  const { data: tocadas, error: errUpd } = await publico
    .from("services")
    .update({ importe: 0 })
    .eq("client_id", cliB.id)
    .select("id");

  if (errUpd) {
    comprobar(false, "no puede modificar servicios de otro (dio error: " + errUpd.message.slice(0, 40) + ")");
  } else {
    comprobar(
      (tocadas || []).length === 0,
      "no puede modificar servicios de otro (0 filas afectadas de " +
        "las 1 que hay: RLS filtró en silencio, sin error)"
    );
  }

  /* ---------- cobros ----------
     Esta tabla se creó SIN RLS y por eso se podía leer desde fuera
     con la clave publicable: importes de todos los clientes. Aquí se
     comprueba que ya no, que es lo que hizo falta la migración 005.
     También que el cliente no pueda decir que ha pagado. */
  console.log("\n── RLS sobre 'cobros' ─────────────────────────────");
  const { data: cobrosVistos, error: errCobro } = await publico.from("cobros").select("concepto,importe");

  if (errCobro) {
    ok("cobros bloqueado para clientes (" + errCobro.message.slice(0, 42) + ")");
  } else {
    comprobar(
      (cobrosVistos || []).length > 0,
      "ve sus propios cobros (si no, no vería su facturación)"
    );
    comprobar(
      (cobrosVistos || []).every(
        (c) => !String(c.concepto).includes("SECRETO DE B")
      ),
      "NO aparecen los cobros de la otra empresa"
    );
  }

  /* El cliente NO puede marcar un cobro como pagado: eso sería un
     agujero de negocio, no de seguridad.

     OJO con cómo se comprueba: RLS no da error al escribir, filtra en
     silencio y devuelve cero filas. Mirar `error` daría "correcto"
     aunque la escritura hubiera pasado. Hay que contar las filas. */
  const { data: pagados, error: errPagar } = await publico
    .from("cobros")
    .update({ estado: "pagado", pagado_en: new Date().toISOString().slice(0, 10) })
    .eq("estado", "pendiente")
    .select("id");

  if (errPagar) {
    ok("no puede marcarse un cobro como pagado (RLS lo rechazó: " + errPagar.message.slice(0, 38) + ")");
  } else {
    comprobar(
      (pagados || []).length === 0,
      "no puede marcarse un cobro como pagado (0 filas afectadas de " +
        "las que había: RLS filtró en silencio)"
    );
  }

  /* ---------- leads: los clientes no deben verlos nunca ---------- */
  console.log("\n── RLS sobre 'leads' ──────────────────────────────");
  const { data: leadsVistos, error: errL } = await publico.from("leads").select("id");
  if (errL) {
    ok("leads bloqueado para clientes (" + errL.message.slice(0, 40) + ")");
  } else {
    comprobar((leadsVistos || []).length === 0, "no ve ninguna consulta de otros");
  }

  /* ---------- auditoría: ni leer ni escribir ---------- */
  console.log("\n── RLS sobre 'audit_log' ──────────────────────────");
  const { data: auditVisto, error: errA } = await publico.from("audit_log").select("accion");
  if (errA) ok("auditoría bloqueada para clientes");
  else comprobar((auditVisto || []).length === 0, "no ve el registro de auditoría");

  const { error: errAI } = await publico.from("audit_log").insert({ accion: "inventada" });
  comprobar(Boolean(errAI), "no puede escribir en la auditoría");

  /* =========================================================
     Limpieza
     ========================================================= */
  console.log("\n── Limpiando ──────────────────────────────────────");
  await admin.from("services").delete().in("client_id", [cliA.id, cliB.id]);
  await admin.from("profiles").delete().eq("id", creado.user.id);
  await admin.auth.admin.deleteUser(creado.user.id);
  await admin.from("clients").delete().in("id", [cliA.id, cliB.id]);
  ok("datos de prueba borrados");

  console.log("\n───────────────────────────────────────────────────");
  if (fallos) {
    console.log(`\n✗ ${fallos} de ${pruebas} comprobaciones fallaron.\n`);
    console.log("  Si falló el aislamiento, NO publiques el portal de");
    console.log("  clientes: enseñaría datos de otros.\n");
    process.exit(1);
  }
  console.log(`\n✓ Las ${pruebas} comprobaciones pasan.\n`);
  console.log("  Un cliente solo ve lo suyo. Puedes construir encima.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("\n✗ " + err.message + "\n");
  process.exit(1);
});
