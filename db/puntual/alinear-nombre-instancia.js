/* Que el nombre de la instancia en la base sea el de verdad.
   ─────────────────────────────────────────────────────────────
   El bot busca la instancia por NOMBRE, y compara ese nombre con el
   campo `instance` que Evolution manda en cada webhook. Si no coincide
   exactamente —con mayúsculas y con el espacio— responde 404 sin
   procesar nada, y no hay error visible: un 404 en un webhook es
   indistinguible de un webhook que nunca llegó.

   ── POR QUÉ SE CAMBIA LA BASE Y NO EL NOMBRE ──

   Las dos opciones funcionan:
     · renombrar la instancia en Evolution a «Boti 1»;
     · o cambiar en la base el nombre al que ahora se llama.

   Se cambia la base porque «Server 1» no significa nada y «Boti 1»
   dice qué es: es el bot de la panadería. Ese nombre viaja a todos
   lados —en los logs, en el panel, en las URL que llama a Evolution— y
   «Server 1» los llena de un nombre que no significa nada.

   Si el nombre se cambia alguna vez, esto hay que volver a correrlo. */
require("../../lib/env").load();

const db = require("../../lib/supabase").getAdmin();

(async () => {
  const { data: srv } = await db.from("evolution_servers").select("url, api_key").limit(1).single();

  const r = await fetch(srv.url + "/instance/fetchInstances", {
    headers: { apikey: srv.api_key },
    signal: AbortSignal.timeout(30000),
  });
  const existentes = (await r.json()) || [];

  console.log("\n═══ Alinear el nombre ═══\n");
  console.log("  en la caja:");

  if (!existentes.length) {
    console.log("    (no hay ninguna instancia)\n");
    process.exit(1);
  }

  existentes.forEach((i) => {
    console.log("    " + i.name.padEnd(18) + i.connectionStatus.padEnd(10) +
      String(i.ownerJid || "").replace("@s.whatsapp.net", ""));
  });

  const { data: bots, error } = await db.from("bots").select("instance_name, name");

  if (error) {
    console.log("\n  x no se pudo leer bots: " + error.message + "\n");
    process.exit(1);
  }

  console.log("\n  en la base:");
  (bots || []).forEach((b) => console.log("    " + b.instance_name.padEnd(18) + b.name));

  /* El nombre de verdad es el de la caja. Y si hay más de una
     instancia, no se sabe cuál es la del bot: eso hay que preguntarlo,
     no adivinarlo eligiendo la primera. */
  if (existentes.length > 1) {
    console.log("\n  × Hay " + existentes.length + " instancias. Con varias no se sabe");
    console.log("    cuál corresponde a este bot, y elegir una sería adivinar.");
    console.log("    Decime cuál es y la alineo.\n");
    process.exit(1);
  }

  const real = existentes[0].name;

  const cambiables = (bots || []).filter((b) => b.instance_name !== real);

  if (!cambiables.length) {
    console.log("\n  ✓ ya coinciden.\n");
    return;
  }

  console.log("\n  ── actualizando ──\n");

  for (const b of cambiables) {
    const { data: u, error: eU } = await db
      .from("bots")
      .update({ instance_name: real })
      .eq("instance_name", b.instance_name)
      .select("instance_name, name");

    if (eU) {
      console.log("  x " + b.name + ": " + eU.message);
      continue;
    }

    console.log("  ✓ " + b.name + ": «" + b.instance_name + "» → «" + real + "»");
  }

  console.log("");
  console.log("  ──────────────────────────────────────────────\n");

  /* Releyendo, porque la actualización se confirma releyendo. */
  const { data: finales } = await db.from("bots").select("instance_name, name");

  const bien = (finales || []).every((b) =>
    existentes.some((i) => i.name === b.instance_name)
  );

  console.log(bien
    ? "  ✓ el bot y la caja usan el mismo nombre.\n"
    : "  × sigue sin coincidir.\n");

  console.log("  Falta un paso que no es mío: que la instancia tenga número.");
  console.log("  Ahora está en «" + existentes[0].connectionStatus + "».\n");
  if (existentes[0].connectionStatus !== "open") {
    console.log("  Con el número enlazado, mandale un «horario» y miramos:\n");
    console.log("    node db/mirar-webhook.js\n");
  } else {
    console.log("  Ya está abierta. Mandale un «horario» y miramos:\n");
    console.log("    node db/mirar-webhook.js\n");
  }
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});