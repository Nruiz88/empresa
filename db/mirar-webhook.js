/* Mirar el webhook en vivo mientras llega un mensaje de verdad.
   ─────────────────────────────────────────────────────────────
   Espera a que aparezca CUALQUIER entrada nueva, de quien sea. El
   número no importa: la pregunta es si Evolution avisa de algo.

   ── POR QUÉ NO FILTRAR POR NÚMERO ──

   Porque el número que escribió es el dato que puede estar mal — falta
   el código de país, o el mensaje fue a otro chat — y filtrar por él
   convierte un problema de dirección en un «no llegó nada».

   Mirando todo, no hay forma de que el número pueda hacer que esto
   falle. Si entra algo, se ve de quién es; si no entra nada, el
   problema no está del lado de quien escribió. */
require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

const MINUTOS = Number(process.env.ESPERA_MIN || 2);

(async () => {
  const { data: antes } = await db.rpc("ejecutar_sql", {
    consulta:
      "select created_at, payload->>'from' as remitente, payload->>'text' as texto, " +
      "payload->>'matched' as matched, payload->>'isLid' as is_lid, status, event_type " +
      "from bots_webhook_logs order by created_at desc limit 1",
    args: [],
  });

  const ultimo = antes && antes[0] ? new Date(antes[0].created_at) : null;

  /* El filtro es ESTRICTAMENTE mayor, sin margen.

     ESTO NO ES COSMÉTICO. La primera versión comparaba fechas en SQL,
     con texto:

         where created_at > '<fecha en ISO con Z>'

     Y la base guarda las suyas como «…19:32:01.556486+00:00». Al
     comparar dos textos, en la posición 24 uno tiene «4» y el otro «Z»,
     y «4» es mayor que «Z». O sea que la comparación daba verdadero
     SIEMPRE, y el script anunciaba movimiento con la fila de hace una
     hora.

     Y el arreglo con un margen de un segundo tampoco vale: la fila más
     reciente es justamente la que se usa de referencia, así que un
     margen la deja entrar de nuevo. Por eso el filtro va en código,
     con fechas de verdad, y estrictamente mayor: la fila de referencia
     es igual, no mayor, y queda fuera. */
  const desde = ultimo || new Date(0);

  console.log("\n═══ Mirando el webhook ═══\n");
  console.log("  última entrada antes de esperar: " + (ultimo ? ultimo.toISOString() : "no hay ninguna"));
  console.log("  espero " + MINUTOS + " minutos...\n");

  const pasos = MINUTOS * 20;

  for (let i = 1; i <= pasos; i++) {
    await new Promise((x) => setTimeout(x, 3000));

    const { data } = await db.rpc("ejecutar_sql", {
      consulta:
        "select created_at, payload->>'from' as remitente, payload->>'text' as texto, " +
        "payload->>'matched' as matched, payload->>'isLid' as is_lid, status, event_type, error " +
        "from bots_webhook_logs order by created_at desc limit 25",
      args: [],
    });

    /* El filtro va AQUÍ, en código, no en el SQL. Comparar fechas como
       texto fue el error que hizo que este script anunciara movimiento
       con una fila vieja. Ver la nota del margen, arriba. */
    const nuevos = (data || []).filter((l) => new Date(l.created_at) > desde);

    if (nuevos.length) {
      const data2 = nuevos;
      console.log("\n  ¡ENTRÓ ALGO a los " + i * 3 + " s!\n");

      for (const l of data2) {
        console.log("    " + l.created_at);
        console.log("      de:        " + (l.remitente || "(sin remitente)"));
        console.log("      texto:     " + String(l.texto || "(ninguno)").slice(0, 70));
        console.log("      coincidió: " + (l.matched || "-"));
        console.log("      lid:       " + l.is_lid);
        console.log("      estado:    " + l.status + "  evento: " + (l.event_type || "-"));
        if (l.error) console.log("      error:     " + String(l.error).slice(0, 160));
        console.log("");
      }

      const hayLid = data2.some((l) => l.is_lid === "true");
      const conTexto = data2.some((l) => l.texto);

      console.log("  ──────────────────────────────────────────────");
      if (hayLid) {
        console.log("\n  ! Vino como @lid. El identificador de cuenta, no un teléfono.");
        console.log("    El bot le quita el «@lid» y manda la respuesta a lo que");
        console.log("    queda, que NO es un número de teléfono. Eso es el fallo");
        console.log("    que se busca, y acaba de aparecer.\n");
      } else if (conTexto) {
        console.log("\n  Evolution avisó, y el mensaje entró como número normal.");
        console.log("  El webhook funcionó. Lo que no se sepa es si el WhatsApp");
        console.log("  llegó: eso lo ves vos en el teléfono.\n");
      } else {
        console.log("\n  Entró algo, pero sin texto de mensaje. Puede ser un evento");
        console.log("  de conexión u otro. Lo importante: Evolution ESTÁ hablando");
        console.log("  con el bot.\n");
      }

      process.exit(hayLid ? 1 : 0);
    }

    if (i % 10 === 0) console.log("  " + i * 3 + " s, nada todavía");
  }

  console.log("\n  ──────────────────────────────────────────────");
  console.log("\n  Pasaron " + MINUTOS + " minutos y no entró NADA.\n");
  console.log("  Ni del número nuevo, ni de nadie. Ni siquiera una entrada");
  console.log("  vacía.\n");
  console.log("  Eso dice una sola cosa, y es concluyente: que Evolution no");
  console.log("  está llamando al webhook. El bot no puede registrar lo que");
  console.log("  no le llega, y no hay nada que arreglar en el bot.\n");
  console.log("  Lo que hay que mirar en la caja:\n");
  console.log("    · si la instancia sigue conectada de verdad, o si «open» es");
  console.log("      un estado viejo que no se actualiza;");
  console.log("    · si Evolution sigue enviando MESSAGES_UPSERT: se");
  console.log("      puede forzar con un cambio de webhook y ver si llama.");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});