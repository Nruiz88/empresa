require("../lib/env").load();
const db = require("../lib/supabase").getAdmin();

/* Comprueba que el webhook NUEVO acepta la firma correcta, ANTES de
   apuntar la Evolution a el.

   ── POR QUE EN ESTE ORDEN ──

   Si se mueve la Evolution primero y el endpoint nuevo no acepta la
   firma, los mensajes dejan de llegar. Y el síntoma es malo: la
   Evolution contesta 200 al POST del webhook (esa es su respuesta al
   guardado, no al mensaje), el panel dice que todo esta bien, y lo
   unico que se ve es que el negocio dejo de contestar. Sin ningun error
   en ninguna parte.

   Con esta comprobacion, el orden correcto es: primero que el destino
   acepte (esto), y despues mover. Si aqui falla, no se ha movido nada
   y no se rompió nada.

   ── QUE SE COMPRUEBA ──

     1. Con la firma correcta -> tiene que responder 200 (o 2xx).
     2. Sin firma            -> tiene que responder 401.
     3. Con firma inventada  -> tiene que responder 401.

   El 3 importa: si el 2 falla pero el 3 pasa, el endpoint no está
   validando nada y aceptaria el mensaje de cualquiera. */

const DESTINO = process.argv[2];

if (!DESTINO) {
  console.log("\n  falta la URL de destino\n");
  process.exit(1);
}

(async () => {
  const { data: caja, error } = await db
    .from("evolution_servers")
    .select("name,webhook_secret,webhook_url")
    .limit(1)
    .maybeSingle();

  if (error || !caja) {
    console.log("\n  x " + (error ? error.message : "no hay cajas") + "\n");
    process.exit(1);
  }

  if (!caja.webhook_secret) {
    console.log("\n  x la caja no tiene secreto: no hay nada que comprobar\n");
    process.exit(1);
  }

  const secreto = caja.webhook_secret;

  console.log("\n═══ El destino antes de mover nada ═══\n");
  console.log("  caja:    " + caja.name);
  console.log("  ahora:   " + (caja.webhook_url || "(la deducida del dominio)"));
  console.log("  destino: " + DESTINO + "\n");

  const pedir = async (etiqueta, cabeceras) => {
    const r = await fetch(DESTINO, {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, cabeceras || {}),
      body: JSON.stringify({ evento: "prueba", instancia: "comprobacion" }),
      signal: AbortSignal.timeout(20000),
    });
    console.log("  " + etiqueta.padEnd(34) + "HTTP " + r.status);
    return r.status;
  };

  const conFirma = await pedir("con la firma correcta", { "x-webhook-secret": secreto });
  const sinFirma = await pedir("sin firma", {});
  const firmaMala = await pedir("con firma inventada", { "x-webhook-secret": "no-es-el-secreto" });

  console.log("");

  const problemas = [];

  if (!(conFirma >= 200 && conFirma < 300)) {
    problemas.push("con la firma correcta responde " + conFirma + ", y tiene que ser 2xx");
  }
  if (sinFirma !== 401) {
    problemas.push("sin firma responde " + sinFirma + ", y tiene que ser 401");
  }
  if (firmaMala !== 401) {
    problemas.push("con firma inventada responde " + firmaMala + ", y tiene que ser 401");
  }

  if (problemas.length) {
    console.log("  x NO se mueve el webhook:");
    problemas.forEach((p) => console.log("    - " + p));
    console.log("");
    console.log("    Moverlo ahora dejaría el bot sin mensajes y sin error\n");
    console.log("    en ninguna parte. La Evolution seguiría mostrando el\n");
    console.log("    webhook como bien configurado.\n");
    process.exit(1);
  }

  console.log("  ✓ el destino acepta la firma y rechaza lo que no lo es");
  console.log("");
  console.log("  Ya se puede mover con:  node db/mover-webhook.js " + DESTINO + "\n");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});