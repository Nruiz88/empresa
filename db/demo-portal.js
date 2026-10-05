/* =========================================================
   Nexo Studio — Datos de demostración del portal del cliente
   ------------------------------------------------------------
   Monta lo justo para PROBAR el flujo entero: la suscripción, la
   ficha, la facturación y el bot con contenido dentro, para que al
   abrir el panel haya algo que mirar y no cuatro pantallas vacías.

   Uso:  npm run demo
   Para deshacer:  npm run demo -- --limpiar

   ES IDEMPOTENTE
   --------------
   Se puede ejecutar las veces que haga falta: borra lo suyo y lo
   vuelve a poner. Importa porque si no, la segunda ejecución
   acumularía suscripciones duplicadas y el portal enseñaría el
   mismo servicio dos veces.

   ⚠️  TODO ESTO ES INVENTADO
   El CIF, el IBAN, la dirección y los enlaces son de mentira. Antes de
   enseñárselo a nadie hay que vaciarlo (--limpiar). Ver el aviso de
   content/*.js sobre por qué un dato inventado en una web comercial es
   un problema y no un detalle.

   ⚠️  LA INSTANCIA DE WHATSAPP
   El bot del demo se apunta a una instancia REAL de Evolution. Eso
   significa que los mensajes que llegan a ese número se guardan en el
   panel de este cliente de prueba.

   Con una instancia inventada el panel se vería igual de lleno y no
   habría ningún riesgo. Se usa una real porque es la única forma de
   probar de verdad el camino completo: Evolution -> webhook -> bot ->
   menú -> pedido.

   El riesgo es real y conviene tenerlo presente: en cuanto se dé de
   alta un cliente DE VERDAD con su propio número, habrá dos bots con
   la misma `instance_name` y el webhook, que hace
   `WHERE instance_name = ? LIMIT 1`, repartirá los mensajes entre
   ellos sin avisar. Antes de dar de alta al primer cliente real hay
   que darle su propia instancia en Evolution.
   ========================================================= */

const supabase = require("../lib/supabase");
require("../lib/env").load();
const db = supabase.getAdmin();

const EMAIL = "cliente@ejemplo.com";

/* El nombre de la instancia dentro de Evolution: es decir, el número de
   WhatsApp.

   NO SE VE EN NINGÚN SITIO de cara al cliente. Es un detalle interno:
   lo usa el webhook para encontrar el bot y el bot para enviar. Aquí sale
   porque esta instancia YA está conectada al número que tienes tú, y
   ponerla a mano es más rápido que pasar por el QR otra vez.

   En el alta normal este nombre sale solo del bot (su slug), y si ya
   estuviera pillado la base lo avisa: es único (migración 015). Por eso
   es exactamente este script el único sitio donde se escribe a mano. */
const INSTANCIA = process.env.DEMO_INSTANCIA || "Boti 1";

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

/* El bot y lo que lleva dentro. Todo inventado, y en el mismo tono
   tonto de una panadería, que es lo que hace fácil entender que es de
   mentira y no un fallo. */
const BOT = {
  name: "Bot de Panadería La Espiga",
  slug: "panaderia-la-espiga",
  status: "connected",
  welcome_message:
    "¡Hola! Soy el bot de Panadería La Espiga. Escribe *horario* para saber cuándo estamos, o *pedido* para hacer un encargo.",
  outside_hours_message:
    "Ahora mismo estamos cerrados. Mañana abrimos a las 7:00. ¡Hasta mañana!",
};

const RESPUESTAS = [
  {
    keyword: "horario",
    response_text:
      "Abrimos de lunes a viernes de 7:00 a 20:00, y los sábados de 8:00 a 14:00. Los domingos cerrados.",
    priority: 10,
  },
  {
    keyword: "pedido",
    response_type: "menu",
    /* Un menú de verdad, con botones, porque es lo que de verdad se
       quiere ver: que el bot reconozca la palabra y mande las
       opciones en vez de un texto.

       La forma es la que espera el bot: `buttons` con `id`, `text` y
       `target_id`, NO `opciones` con `etiqueta` y `descripcion`. Con el
       formato inventado, el bot reventaba con un TypeError al pintar
       el menú —`b.text` de un undefined— y la respuesta se quedaba a
       medias: el evento llegaba, se registraba, y no pasaba nada.

       `target_id` es a dónde lleva la opción. Con `null` es una opción
       de texto: el usuario la elige escribiendo el número, y de eso se
       ocupa el manejador de menús. */
    menu_config: {
      title: "¿Qué quieres pedir?",
      description: "Elegí con el número",
      footer: "Panadería La Espiga · demo",
      buttons: [
        { id: "pedir_pan", text: "Pan", target_id: null },
        { id: "pedir_bolleria", text: "Bollería", target_id: null },
        { id: "pedir_pasteleria", text: "Pastelería", target_id: null },
      ],
    },
    response_text: "Aquí tienes lo que tenemos:",
    priority: 20,
  },
  {
    keyword: "pedir",
    response_text:
      "¡Perfecto! Dime qué quieres y en cuántos minutos lo recoges y se lo dejo preparado. (Esto es una demo: no se cobra nada.)",
    priority: 20,
  },
  {
    keyword: "humano",
    response_text:
      "Ahora mismo no hay nadie al otro lado, pero déjame tu mensaje y te escribimos en cuanto abramos.",
    priority: 30,
  },
];

const HORARIO = [
  /* day_of_week: 0 es domingo en Postgres, así que la semana empieza
     el lunes (1) y el domingo es el 0, al final. */
  { day_of_week: 1, start_time: "07:00", end_time: "20:00" },
  { day_of_week: 2, start_time: "07:00", end_time: "20:00" },
  { day_of_week: 3, start_time: "07:00", end_time: "20:00" },
  { day_of_week: 4, start_time: "07:00", end_time: "20:00" },
  { day_of_week: 5, start_time: "07:00", end_time: "20:00" },
  { day_of_week: 6, start_time: "08:00", end_time: "14:00" },
  /* El domingo no se pone fila, no se pone una desactiva: así el bot
     sabe que está cerrado y no que le falta el dato. */
];

const CATALOGO = [
  { label: "Barra del día", description: "La de siempre, hecha esta mañana", price_cents: 320, category: "Pan" },
  { label: "Hogaza de masa madre", description: "Grande, de 800 g", price_cents: 450, category: "Pan" },
  { label: "Croissant de mantequilla", description: " recien hecho", price_cents: 130, category: "Bollería" },
  { label: "Magdalenas (6)", description: "Paquete de seis", price_cents: 480, category: "Bollería" },
  { label: "Tarta de la casa", description: "La del día, entera", price_cents: 2800, category: "Pastelería" },
];

async function clienteDePrueba() {
  const { data, error } = await db
    .from("clients")
    .select("id,nombre,empresa")
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

async function servidorDeEvolution() {
  const { data, error } = await db
    .from("evolution_servers")
    .select("id,name")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error(
      "No hay ningún servidor de Evolution en la base, y el bot necesita uno " +
        "(es donde están la URL y la clave). Revisa db/crear-servidor-evolution.js"
    );
  }
  return data;
}

async function limpiar(cliente) {
  /* El bot primero, y con cascada: sus respuestas, horarios y catálogo
     cuelgan de él y se van con él. Si se borrara el cliente sin borrar
     el bot, `bots.client_id` lo impediría igual, pero el error sería
     menos claro. */
  await db.from("bots").delete().eq("client_id", cliente.id);

  await db.from("suscripciones").delete().eq("client_id", cliente.id);
  await db.from("fichas").delete().eq("client_id", cliente.id);
  await db.from("facturacion").delete().eq("client_id", cliente.id);

  for (const m of MODULOS) {
    await db.from("modules").update({ disponible: false }).eq("id", m.id);
  }
}

(async () => {
  const limpiarDemo = process.argv.includes("--limpiar");
  const cliente = await clienteDePrueba();
  console.log("\nCliente: " + (cliente.empresa || cliente.nombre));

  /* El bot se borra SIEMPRE, también sin --limpiar.

     Es lo que hace que esto se pueda ejecutar otra vez. Con el slug
     único en `bots`, un segundo intento fallaba con
     `duplicate key value violates unique constraint "bots_slug_key"` a
     medias: las suscripciones ya estaban puestas y el bot no, dejando
     el cliente sin bot y con la suscripción cobrada.

     O sea: el fallo no era del primer intento, sino del segundo. Y
     quien lo nota es quien lo ejecuta dos veces, que es exactamente
     cuando ya no se está pensando en el script. */
  const { data: botsPrevios } = await db
    .from("bots")
    .select("id")
    .eq("client_id", cliente.id);

  if (botsPrevios && botsPrevios.length) {
    await db.from("bots").delete().eq("client_id", cliente.id);
    console.log("✓ bot anterior fuera (" + botsPrevios.length + ")");
  }

  if (limpiarDemo) {
    await limpiar(cliente);
    console.log("✓ suscripciones, ficha y facturación borradas");
    console.log("  Los módulos siguen en la tabla, pero no a la venta.\n");
    process.exit(0);
  }

  /* ---------- Catálogo de módulos ----------

     `url` se pone con el dominio REAL de este despliegue.

     Lo contrario parecía mejor (no guardar direcciones, deducirlas del
     SITE_URL) y resulted equivocado: al dejar `url` vacía, el panel la
     dedujo como "bot." + SITE_URL, que con SITE_URL siendo
     empresa.panel-... da "bot.empresa.panel-...". Funciona, porque ese
     subdominio también enruta, pero es el dominio equivocado y no hace
     falta depender de esa deducción para algo que se puede escribir
     bien.

     Lo que sí NO se hace es volver al dominio de ejemplo
     ("bot.midominio.com"), que es lo que había antes. Ese no enruta. */
  const BOT_URL =
    process.env.BOT_URL || "https://bot.panel-niconqn.duckdns.org";

  for (const m of MODULOS) {
    const { error } = await db.from("modules").upsert(
      {
        ...m,
        disponible: true,
        url: m.id === "bot_whatsapp" ? BOT_URL : null,
        retirado: false,
      },
      { onConflict: "id" }
    );
    if (error) throw new Error("módulo " + m.id + ": " + error.message);
  }
  console.log("✓ " + MODULOS.length + " módulos a la venta");
  console.log("  el bot apunta a " + BOT_URL);

  /* ---------- Suscripciones ----------
     Las tres, con periodos distintos para ver en el portal los tres
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

  /* ---------- El bot ----------
     Sin esta fila el portal del bot abre a 200 pero no enseña nada:
     todas sus pantallas buscan primero el bot de la sesión y, si no
     hay, pintan un panel vacío sin decir por qué. Es un 200 que
     parece que funciona. */
  const servidor = await servidorDeEvolution();

  const { data: bot, error: eBot } = await db
    .from("bots")
    .insert({
      client_id: cliente.id,
      server_id: servidor.id,
      instance_name: INSTANCIA,
      ...BOT,
    })
    .select("id")
    .single();
  if (eBot) throw new Error("bot: " + eBot.message);
  console.log("✓ bot creado, en la instancia '" + INSTANCIA + "'");

  /* ---------- Contenido del bot ---------- */
  const { error: eRes } = await db.from("bots_responses").insert(
    RESPUESTAS.map((r) => ({
      bot_id: bot.id,
      keyword: r.keyword,
      response_text: r.response_text,
      response_type: r.response_type || "text",
      menu_config: r.menu_config || null,
      is_active: true,
      priority: r.priority,
    }))
  );
  if (eRes) throw new Error("respuestas: " + eRes.message);
  console.log("✓ " + RESPUESTAS.length + " respuestas automáticas (una es un menú)");

  const { error: eHor } = await db.from("bots_business_hours").insert(
    HORARIO.map((h) => ({ bot_id: bot.id, ...h, slot_duration_min: 30, is_active: true }))
  );
  if (eHor) throw new Error("horario: " + eHor.message);
  console.log("✓ horario de lunes a sábado");

  const { error: eCat } = await db.from("bots_catalog_items").insert(
    CATALOGO.map((p, i) => ({ bot_id: bot.id, ...p, active: true, sort_order: i * 10 }))
  );
  if (eCat) throw new Error("catálogo: " + eCat.message);
  console.log("✓ " + CATALOGO.length + " productos en el catálogo");

  console.log("\n⚠️  TODO INVENTADO: CIF, IBAN, dirección y enlaces son de");
  console.log("    mentira. Para vaciarlo:  npm run demo -- --limpiar");
  console.log("\n⚠️  El bot usa la instancia real '" + INSTANCIA + "'. Antes de dar de");
  console.log("    alta a un cliente de verdad, dale su propia instancia en");
  console.log("    Evolution: con dos bots en la misma, el webhook reparte los");
  console.log("    mensajes entre los dos sin avisar (LIMIT 1 sobre instance_name).\n");
  process.exit(0);
})().catch((e) => {
  console.error("\n✗ " + e.message + "\n");
  process.exit(1);
});