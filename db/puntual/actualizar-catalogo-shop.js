/* Poner el catálogo al día: el Mini Shop ya está y Reservas no.
   ─────────────────────────────────────────────────────────────
   Situación: `mini-shop` existía en `modules` (con url y precio)
   pero NO en `microservicios`, y el panel vende leyendo
   `microservicios`. Por eso el shop no aparecía para venderlo.
   Y `reservas_web` sigue en el plan Full aunque no hay software
   detrás (no responde, no tiene url).

   Qué hace, sin tocar nada más:
     1. da de alta el microservicio del shop (vendible, $30.000/mes);
     2. retira `reservas_web` del catálogo;
     3. en el plan Full cambia `reservas_web` por `mini-shop`;
     4. en el plan Comercio cambia `inventario` por `mini-shop`;
     5. imprime el estado final para revisarlo.

   Es idempotente: repetirlo no duplica ni rompe nada. */
require("../../lib/env").load();
const db = require("../../lib/supabase").getAdmin();

(async () => {
  console.log("\n═══ Catálogo: el shop sí, reservas no ═══\n");

  /* 1. El microservicio del shop. Es lo que lo hace vendible. */
  const shop = {
    modulo: "mini-shop",
    nombre: "Mini Shop",
    descripcion: "Tienda online: catálogo con fotos y precios, carrito y pedidos.",
    url_base: "https://tienda.shopcito.com.ar",
    activo: true,
    vendible: true,
    precio: 30000,
    moneda: "ARS",
    periodo: "mes",
  };

  const { error: eShop } = await db.from("microservicios").upsert(shop, { onConflict: "modulo" });
  console.log(
    eShop
      ? "  x mini-shop: " + eShop.message
      : "  ✓ microservicio mini-shop (vendible, $30.000/mes)"
  );

  /* 2. Reservas web: sin software, fuera del catálogo. */
  const { error: eRes } = await db
    .from("modules")
    .update({ retirado: true })
    .eq("id", "reservas_web");
  console.log(
    eRes ? "  x reservas_web: " + eRes.message : "  ✓ reservas_web retirado (ya no se ofrece)"
  );

  /* 3. El plan Full prometía reservas: se cambia por el shop. */
  const { data: full } = await db
    .from("plans")
    .select("id,nombre,aplicaciones")
    .eq("id", "full")
    .maybeSingle();

  if (!full) {
    console.log("  · no hay plan «full». No se toca.");
  } else {
    const apps = (full.aplicaciones || []).filter((a) => a !== "reservas_web");
    if (!apps.includes("mini-shop")) apps.push("mini-shop");

    const { error } = await db.from("plans").update({ aplicaciones: apps }).eq("id", "full");
    console.log(
      error
        ? "  x plan Full: " + error.message
        : "  ✓ plan Full ahora incluye: " + apps.join(", ")
    );
  }

  /* 4. El plan Comercio anunciaba el mini shop en su texto («Mini shop /
     catálogo web con fotos y precios») pero en `aplicaciones` daba
     `inventario`, que el plan no anuncia en ninguna parte. Se deja con
     lo que dice su propio texto: el bot y la tienda. */
  const { data: comercio } = await db
    .from("plans")
    .select("id,nombre,aplicaciones")
    .eq("id", "comercio")
    .maybeSingle();

  if (!comercio) {
    console.log("  · no hay plan «comercio». No se toca.");
  } else {
    const apps = ["bot_whatsapp", "mini-shop"];
    const { error } = await db.from("plans").update({ aplicaciones: apps }).eq("id", "comercio");
    console.log(
      error
        ? "  x plan Comercio: " + error.message
        : "  ✓ plan Comercio ahora incluye: " + apps.join(", ")
    );
  }

  /* 5. Estado final, para revisar de un vistazo. */
  const micro = await db
    .from("microservicios")
    .select("modulo,nombre,vendible,activo,url_base,precio")
    .order("nombre");
  console.log("\n  microservicios:");
  (micro.data || []).forEach((m) =>
    console.log(
      "    " + String(m.modulo).padEnd(16) + " vendible=" + m.vendible +
      " activo=" + m.activo + "  $" + (m.precio == null ? "—" : m.precio)
    )
  );

  const mods = await db.from("modules").select("id,nombre,disponible,retirado").order("id");
  console.log("\n  modules:");
  (mods.data || []).forEach((m) =>
    console.log("    " + String(m.id).padEnd(16) + " disponible=" + m.disponible + " retirado=" + m.retirado)
  );

  const planes = await db.from("plans").select("id,nombre,aplicaciones,activo").order("id");
  console.log("\n  planes:");
  (planes.data || []).forEach((p) =>
    console.log("    " + String(p.id).padEnd(12) + " activo=" + p.activo + "  [" + (p.aplicaciones || []).join(", ") + "]")
  );

  console.log("");
})().catch((e) => {
  console.error("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});
