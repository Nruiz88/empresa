/* =========================================================
   Nexo Studio — Datos de demostración del portal del cliente
   ------------------------------------------------------------
   Monta lo justo para MAQUETAR el portal: tres módulos en el
   catálogo, una suscripción a cada uno, y la ficha y la facturación
   del cliente de prueba rellenas.

   Uso:  node db/demo-portal.js
   Para deshacer:  node db/demo-portal.js --limpiar

   ⚠️  TODO ESTO ES INVENTADO
   El CIF, el IBAN, la dirección y los enlaces son de mentira. Antes de
   enseñárselo a nadie hay que vaciarlo (--limpiar). Ver el aviso de
   content/*.js sobre por qué un dato inventado en una web comercial es
   un problema y no un detalle.
   ========================================================= */

const supabase = require("../lib/supabase");
require("../lib/env").load();
const db = supabase.getAdmin();

const EMAIL = "cliente@ejemplo.com";

/* Los tres productos de demo.
   - `bot_whatsapp` e `inventario` ya existen de la migración 007 y de
     pruebas anteriores; se hace upsert para dejar siempre los mismos.
   - `reservas_web` es de probar el grid de dos columnas. */
const MODULOS = [
  {
    id: "bot_whatsapp",
    slug: "bot-whatsapp",
    nombre: "Bot de WhatsApp con agenda de turnos",
    descripcion:
      "Responde solo los mensajes de siempre y reserva citas sin que tengas que contestar cada uno.",
    precio: 49,
    periodicidad: "mensual",
    componentes: ["bot", "turnos"],
  },
  {
    id: "inventario",
    slug: "inventario",
    nombre: "Gestión de inventario",
    descripcion:
      "Control de stock, entradas y salidas, y aviso cuando algo se está acabando. Para tiendas y talleres.",
    precio: 79,
    periodicidad: "mensual",
    componentes: ["productos", "movimientos", "proveedores", "avisos"],
  },
  {
    id: "reservas_web",
    slug: "reservas-web",
    nombre: "Reservas online para tu web",
    descripcion:
      "Página de reservas conectada a tu web actual, con agenda, confirmación y recordatorio.",
    precio: 39,
    periodicidad: "mensual",
    componentes: ["agenda", "confirmacion", "recordatorios"],
  },
];

const FICHA = {
  cif: "B12345678",
  direccion: "Calle Mayor 12, 3º B",
  codigo_postal: "28013",
  ciudad: "Madrid",
  provincia: "Madrid",
  pais: "España",
  sector: "Panadería y pastelería",
  web: "https://panaderialaespiga.example",
  instagram: "@panaderialaespiga",
  facebook: "panaderialaespiga",
  whatsapp: "34600111222",
  enlaces: [
    { etiqueta: "Google Business", url: "https://example.com/negocio" },
    { etiqueta: "Nuestra carta", url: "https://panaderialaespiga.example/carta" },
  ],
};

const FACTURACION = {
  razon_social: "Panadería La Espiga S.L.",
  nif: "B12345678",
  direccion: "Avenida de la Industria 4, nave 2",
  codigo_postal: "28021",
  ciudad: "Madrid",
  provincia: "Madrid",
  pais: "España",
  email: "facturacion@panaderialaespiga.example",
  iban: "ES91 2100 0418 4502 0005 1332",
  regimen_iva: "general",
  notas: "Enviar también una copia a la administración.",
};

async function clienteDePrueba() {
  const { data, error } = await db
    .from("clients")
    .select("id,empresa")
    .eq("email", EMAIL)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error(
      "No está el cliente de prueba. Ejecuta primero:  npm run seed"
    );
  }
  return data;
}

(async () => {
  const limpiar = process.argv.includes("--limpiar");
  const cliente = await clienteDePrueba();
  console.log("\nCliente: " + cliente.empresa);

  if (limpiar) {
    await db.from("suscripciones").delete().eq("client_id", cliente.id);
    await db.from("fichas").delete().eq("client_id", cliente.id);
    await db.from("facturacion").delete().eq("client_id", cliente.id);
    for (const m of MODULOS) {
      await db.from("modules").update({ disponible: false }).eq("id", m.id);
    }
    console.log("✓ suscripciones, ficha y facturación borradas");
    console.log("  Los módulos siguen en la tabla, pero no a la venta.\n");
    process.exit(0);
  }

  /* ---------- Catálogo ---------- */
  for (const m of MODULOS) {
    const { error } = await db.from("modules").upsert(
      {
        ...m,
        disponible: true,
        url: m.id === "bot_whatsapp" ? "https://bot.midominio.com" : null,
        retirado: false,
      },
      { onConflict: "id" }
    );
    if (error) throw new Error("módulo " + m.id + ": " + error.message);
  }
  console.log("✓ " + MODULOS.length + " módulos a la venta");

  /* ---------- Suscripciones ---------- */
  /* Las tres, con periodos distintos para ver en el portal los tres
     casos de la vista: sin fecha (se renueva), con fecha (caduca) y en
     prueba. Es la única forma de maquetar el resto de estados. */
  const periodos = [
    { termina_en: null, estado: "activo" },
    /* Caduca dentro de 9 días: sale el aviso naranja. */
    {
      termina_en: new Date(Date.now() + 9 * 86400000)
        .toISOString()
        .slice(0, 10),
      estado: "activo",
    },
    { termina_en: null, estado: "prueba" },
  ];

  await db.from("suscripciones").delete().eq("client_id", cliente.id);

  for (let i = 0; i < MODULOS.length; i++) {
    const { error } = await db.from("suscripciones").insert({
      client_id: cliente.id,
      module_id: MODULOS[i].id,
      estado: periodos[i].estado,
      inicia_en: "2026-01-01",
      termina_en: periodos[i].termina_en,
    });
    if (error) throw new Error("suscripción: " + error.message);
  }
  console.log("✓ 3 suscripciones (activa, caduca en 9 días y en prueba)");

  /* ---------- Ficha y facturación ---------- */
  await db.from("fichas").upsert(
    { ...FICHA, client_id: cliente.id },
    { onConflict: "client_id" }
  );
  await db.from("facturacion").upsert(
    { ...FACTURACION, client_id: cliente.id },
    { onConflict: "client_id" }
  );
  console.log("✓ ficha del negocio y datos de facturación");

  console.log("\n⚠️  TODO INVENTADO: CIF, IBAN, dirección y enlaces son de");
  console.log("    mentira. Para vaciarlo:  node db/demo-portal.js --limpiar\n");
  process.exit(0);
})().catch((e) => {
  console.error("\n✗ " + e.message + "\n");
  process.exit(1);
});
