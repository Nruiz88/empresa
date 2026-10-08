require("../lib/env").load();

/* Pone el registro de microservicios al día con el dominio oficial.
   ─────────────────────────────────────────────────────────────
   POR QUÉ ESTO SE HABÍA QUEDADO VIEJO

   Hay dos sitios donde vive la dirección de un servicio, y no se
   hablan entre sí:

     · `modules.url`         el catálogo: la dirección que ve el
                             cliente cuando compra
     · `microservicios.url_base`  el registro: la dirección a la que
                             la pantalla de Salud va a preguntar si el
                             servicio está vivo

   Al cambiar los dominios se actualizó el catálogo y el registro se
   quedó en el duckdns. La pantalla de Salud avisaba, con razón.

   ── POR QUÉ SE COMPARA Y NO SE COPIA ──

   Porque copiar el catálogo a ciegas sería escribir el mismo error en
   los dos sitios, que es justo lo que hace que un aviso de este tipo
   deje de servir para nada. Aquí se comparan contra lo que REALMENTE
   responde, y se avisa de las diferencias sin tocarlas.

   ── POR QUÉ `reservas_web` NO SE TOCA ──

   Porque está marcado como inactivo y su url está vacía a propósito:
   no hay software detrás y se sacó de la venta. Los clientes que ya lo
   tienen contratado siguen entrando, y eso lo decide `tiene_modulo()`.
   Ponerle una url ahí sería inventar un servicio. */

const db = require("../lib/supabase").getAdmin();

/* Lo que responde de verdad ahora mismo. Se pregunta antes de
   escribir, no después: escribir una dirección sin comprobar que
   contesta es como repetir el mismo aviso que se vino a arreglar. */
const A_VERIFICAR = [
  { modulo: "bot_whatsapp", esperado: "https://bot.shopcito.com.ar", rutaSalud: "/api/salud" },
  { modulo: "inventario", esperado: "https://inventario.shopcito.com.ar", rutaSalud: "/api/salud" },
];

async function responde(url, ruta) {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), 8000);
  try {
    const r = await fetch(url.replace(/\/+$/, "") + ruta, {
      headers: { accept: "application/json" },
      signal: control.signal,
    });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, status: 0, error: e.name === "AbortError" ? "tardó más de 8 s" : e.message };
  } finally {
    clearTimeout(reloj);
  }
}

(async () => {
  console.log("\n═══ Lo que responde ahora ═══\n");

  const comprobaciones = [];

  for (const v of A_VERIFICAR) {
    const r = await responde(v.esperado, v.rutaSalud);

    /* El resultado de la comprobación se guarda en el MISMO objeto que
       el servicio, y no en uno aparte.

       La primera versión hacía `comprobaciones.push({ ...v, ...r })` y
       luego miraba `v.ok`. Pero `v` es el objeto del array `A_VERIFICAR`
       y nunca se modifica: el resultado se guardaba en el objeto nuevo,
       que no se volvía a leer. Así que la comprobación decía "ok" y tres
       líneas más el script decidía que no respondía.

       Un script que comprueba y luego no usa lo que ha comprobado es peor
       que uno que no comprueba: da la sensación de que está verificado y
       no lo está. Por eso se escribe en `v` y se lee de `v`. */
    v.ok = r.ok;
    v.status = r.status;
    v.error = r.error;
    comprobaciones.push(v);
    console.log(
      "  " + (r.ok ? "ok  " : "x   ") + v.modulo.padEnd(14) +
      v.esperado + v.rutaSalud + "   HTTP " + (r.status || (r.error || "sin respuesta"))
    );
  }

  /* ── El registro ── */
  const { data: micros, error } = await db.from("microservicios").select("*");

  if (error) {
    console.log("\n  x no se pudo leer el registro: " + error.message + "\n");
    process.exit(1);
  }

  console.log("\n═══ Cambios ═══\n");

  let cambios = 0;

  for (const v of A_VERIFICAR) {
    const fila = micros.find((m) => m.modulo === v.modulo);
    if (!fila) {
      console.log("  ! " + v.modulo + ": no está en el registro");
      continue;
    }

    const actual = String(fila.url_base || "").replace(/\/+$/, "");
    const nuevo = v.esperado;

    if (actual === nuevo) {
      console.log("  = " + v.modulo.padEnd(14) + "ya apunta a " + nuevo);
      continue;
    }

    /* Solo se escribe si la comprobación de antes respondió. Un registro
       que apunta a un sitio que no contesta es peor que uno que apunta al
       duckdns viejo: el duckdns al menos responde, y el aviso dice
       "uno de los dos está viejo", que es información. */
    if (!v.ok) {
      console.log("  ! " + v.modulo + ": NO se cambia, porque " + nuevo + " no responde.");
      console.log("    Se deja " + (actual || "(vacía)") + ". Arregla el despliegue antes.");
      continue;
    }

    const { error: eUpd } = await db
      .from("microservicios")
      .update({ url_base: nuevo, actualizado_en: new Date().toISOString() })
      .eq("modulo", v.modulo);

    if (eUpd) {
      console.log("  x " + v.modulo + ": no se pudo guardar: " + eUpd.message);
      continue;
    }

    cambios++;
    console.log("  > " + v.modulo.padEnd(14) + (actual || "(vacía)") + "  ->  " + nuevo);
  }

  /* Relectura desde la base: releer el objeto en memoria comprobaría
     que la asignación funcionó, y lo que importa es que llegara a la
     columna. */
  console.log("\n═══ Releído de la base ═══\n");
  const { data: frescos } = await db.from("microservicios").select("modulo,url_base,activo").order("modulo");
  frescos.forEach((m) => {
    console.log("  " + String(m.modulo).padEnd(14) + String(m.url_base || "(vacía)").padEnd(46) +
      (m.activo ? "activo" : "inactivo"));
  });

  console.log("");
  console.log(cambios ? "cambios guardados: " + cambios : "no había nada que cambiar.");
})();