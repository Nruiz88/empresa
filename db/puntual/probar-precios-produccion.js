/* ¿Los precios de la web de producción salen de la tabla?
   ─────────────────────────────────────────────────────────────
   POR QUÉ HACE FALTA ESTA COMPROBAHCIÓN

   En local, `probar-precios.js` ya demuestra el camino entero. Pero
   entre el código y la web publicada hay tres cosas que pueden cortar
   la cadena sin que se note:

     · el despliegue no incluye el commit;
     · el contenedor no tiene credenciales de Supabase, y entra el
       respaldo sin decir nada;
     · la tabla existe pero la política deja leer al visitante, y no.

   Y el detalle que hace la prueba necesaria: el respaldo SIN precios y
   la tabla con los tres en NULL dan EXACTAMENTE la misma pantalla.
   «A consultar» en las tres tarjetas no distingue una cosa de la otra.

   Así que hay que poner un precio de verdad y mirar si aparece. Un
   número que sale significa que production lee la tabla.

   ── POR QUÉ NO ES DESTRUCTIVA ──

   Porque es el precio del plan Inicial, y un número absurdo que se ve
   en la web pública durante medio minuto. Se devuelve a NULL después.
   Si el script se corta antes de restaurar, el número se queda, y eso
   es un precio publicado sin que nadie lo haya decidido. Por eso el
   precio de prueba es inconfundible: 999999999. Si aparece, hay que
   vaciar el plan a mano y no cuesta mucho adivinar qué pasó. */

require("../../lib/env").load();

const db = require("../../lib/supabase").getAdmin();

const PLAN = "inicial";

/* Inconfundible a propósito: si aparece en la web, se sabe que es
   este y no un precio real. */
const PRECIO = 999999999;

const WEB = process.env.TEST_WEB || "https://shopcito.com.ar";

/* El caché de la web son veinte segundos. Se espera un poco más, para
   no mirar justo en la frontera y sacar una conclusión rara. */
const ESPERA_MS = 35000;

function numeroEn(html) {
  /* El formateador pone separador de miles: 999.999.999. Se buscan las
     dos formas porque el HTML puede venir con la entidad o sin ella, y
     un comprobador demasiado exacto daría un falso negativo justo
     cuando todo funciona. */
  const conPuntos = PRECIO.toLocaleString("es-AR");
  return [String(PRECIO), conPuntos].find((t) => html.includes(t)) || null;
}

(async () => {
  console.log("\n═══ ¿Producción lee la tabla? ═══\n");
  console.log("  web:  " + WEB);
  console.log("  plan: " + PLAN + "\n");

  /* ---- 1. Poner el precio ---- */
  const { error: ePoner } = await db.from("plans").update({ precio: PRECIO }).eq("id", PLAN);

  if (ePoner) {
    console.log("  x no se pudo poner el precio: " + ePoner.message);
    console.log("    La web seguirá con «A consultar».");
    process.exit(1);
  }
  console.log("  precio puesto: " + PRECIO);

  let salio = false;

  try {
    /* ---- 2. Esperar y mirar ---- */
    console.log("\n  esperando " + Math.round(ESPERA_MS / 1000) + " s a que caduque el caché...");
    await new Promise((r) => setTimeout(r, ESPERA_MS));

    for (const ruta of ["/precios", "/"]) {
      const html = await (await fetch(WEB + ruta, { signal: AbortSignal.timeout(30000) })).text();
      const visto = numeroEn(html);

      console.log("  " + ruta.padEnd(10) + (visto ? "✓ sale " + visto + "  ← viene de la tabla" : "x no sale"));

      if (visto) salio = true;
    }
  } finally {
    /* ---- 3. Devolverlo a NULL, pase lo que pase ---- */
    const { error: eRestaurar } = await db.from("plans").update({ precio: null }).eq("id", PLAN);

    console.log("");
    console.log(
      eRestaurar
        ? "  ! NO SE PUDO RESTAURAR: " + eRestaurar.message
        : "  precio devuelto a NULL (se publica «A consultar»)"
    );

    /* El caché del proceso local, por si algo de esto se miró. */
    try {
      require("../../lib/planes").olvidar();
    } catch (e) {
      /* da igual */
    }
  }

  console.log("");

  if (salio) {
    console.log("  ✓ producción lee la tabla `plans`\n");
    process.exit(0);
  }

  console.log("  x el precio NO sale en producción.\n");
  console.log("  Y eso NO significa que esté roto. Puede ser que la web esté");
  console.log("  enseñando el RESPALDO, que va sin precios a propósito.\n");
  console.log("  Para distinguirlo hay que mirar si el contenedor de producción");
  console.log("  tiene credenciales de Supabase. Un respaldo no es un fallo:");
  console.log("  es lo que evita que la portada caiga si la base no responde.");
  console.log("  Lo que sí sería un fallo es no poder distinguir las dos cosas.\n");
  process.exit(1);
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});