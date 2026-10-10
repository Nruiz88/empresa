/* Prepara datos para MIRAR el portal: activa el bot y lo da de alta
   al cliente de prueba, para que se vea la sección de aplicaciones.
   Es de un solo uso, para revisar el diseño a ojo. */
const supabase = require("../../lib/supabase");
require("../../lib/env").load();
const db = supabase.getAdmin();

(async () => {
  await db
    .from("modules")
    .update({ disponible: true, url: "http://127.0.0.1:3200" })
    .eq("id", "bot_whatsapp");

  const { data: clientes } = await db
    .from("clients")
    .select("id,email")
    .eq("email", "cliente@ejemplo.com");
  const c = clientes && clientes[0];
  if (!c) {
    console.log("No está el cliente de prueba. Ejecuta npm run seed.");
    process.exit(1);
  }

  const { data: ya } = await db
    .from("suscripciones")
    .select("id")
    .eq("client_id", c.id)
    .eq("module_id", "bot_whatsapp");

  if (!ya || !ya.length) {
    await db.from("suscripciones").insert({
      client_id: c.id,
      module_id: "bot_whatsapp",
      estado: "activo",
      inicia_en: "2026-01-01",
      termina_en: null,
    });
    console.log("Suscripción creada para el cliente de prueba.");
  } else {
    console.log("Ya tenía suscripción.");
  }

  /* Un segundo módulo, para que el catálogo se vea con contraste de
     "ya lo tiene" y "no lo tiene". */
  await db.from("modules").upsert(
    {
      id: "inventario",
      slug: "inventario",
      nombre: "Gestión de inventario",
      descripcion:
        "Control de stock, entradas y salidas, y avisos cuando algo se está acabando. Para tiendas y talleres.",
      precio: 79,
      periodicidad: "mensual",
      disponible: true,
      url: "https://inventario.midominio.com",
      componentes: ["productos", "movimientos", "proveedores", "avisos"],
    },
    { onConflict: "id" }
  );

  await db
    .from("modules")
    .update({ disponible: false })
    .eq("id", "bot_whatsapp");

  /* Un tercero, para ver la rejilla del catálogo con más de una
     tarjeta y comprobar que los precios se alinean.

     OJO con periodicidad: el CHECK de modules solo admite 'mensual',
     'trimestral' y 'anual'. Un 'unica' (pago único) NO cabe aquí: es
     trabajo a medida, que va por presupuesto, no por catálogo. Por eso
     este producto es mensual. */
  await db.from("modules").upsert(
    {
      id: "reservas_web",
      slug: "reservas-web",
      nombre: "Reservas online para tu web",
      descripcion:
        "Página de reservas conectada a tu web actual, con agenda, confirmación y recordatorio. Sin montar una tienda entera.",
      precio: 39,
      periodicidad: "mensual",
      disponible: true,
      url: null,
      componentes: ["agenda", "confirmacion", "recordatorios"],
    },
    { onConflict: "id" }
  );

  const { data: mods } = await db
    .from("modules")
    .select("id,nombre,disponible")
    .order("nombre");
  console.log("\nMódulos en el catálogo:");
  (mods || []).forEach((m) => {
    console.log("  " + (m.disponible ? "✓ a la venta" : "· oculto     ") + "  " + m.nombre);
  });
  console.log("");
  process.exit(0);
})().catch((e) => {
  console.error("✗ " + e.message);
  process.exit(1);
});
