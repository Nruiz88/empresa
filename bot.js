/* =========================================================
   Nexo Studio — Entrada del MICROSERVICIO (proceso aparte)
   ------------------------------------------------------------
   Este es el patrón para bot.midominio.com, inventario.midominio.com
   y los que vengan.(server.js y panel.js hacen lo mismo con sus
   propios routers.)

   CÓMO FUNCIONA
   -------------
     panel.midominio.com/panel/servicios/bot_whatsapp/entrar
        → firma un ticket de 60 s y redirige aquí

     bot.midominio.com/entrar#ticket=...
        → GET  pinta una página cuyo JS canjea el ticket
        → POST verifica la firma, comprueba la suscripción y pone
           una cookie PROPIA (nexo_bot, host-only)

     A partir de ahí, las rutas usan req.db, que es un cliente de
     Supabase con el token del usuario: RLS decide.

   ⚠️  LAS REGLAS QUE NO SE ROMPEN
   --------------------------------
   1. Este proceso NUNCA usa getAdmin() para leer datos de cliente.
      Usa req.db (getClientForToken). Si algún día se cambia, un
      cliente pasa a ver los datos de todos. Está en mayúsculas por
      algo.

   2. La cookie es host-only. No se comparte con el panel ni con
      ningún otro subdominio: si se compartiera, un XSS en cualquier
      servicio se llevaría la sesión de todos.

   3. El acceso se comprueba en CADA petición, no solo al entrar.
      Si una suscripción caduca con el navegador abierto, deja de
      funcionar en la siguiente llamada.

   4. La suscripción se comprueba contra la tabla, no contra el
      ticket. Aunque la firma sea auténtica, si el cliente no tiene
      el módulo contratado, no entra.

   LO QUE HAY QUE CAMBIAR PARA EL BOT REAL
   ---------------------------------------
   Lo de abajo es un esqueleto que sirve para PROBAR el flujo de
   acceso de punta a punta. Cuando conectes el bot de verdad, esto se
   sustituye por las rutas del bot y el punto de entrada a Evolution
   API, pero /entrar y el middleware se quedan tal cual: son la
   pieza que resuelve la identidad.

   Variables:
     PORT        puerto de este servicio (por defecto 3200)
     BOT_HOST    interfaz de escucha; en producción, 127.0.0.1 tras
                 un reverse proxy
     SERVICE_SECRET  MISMO que en el panel y distinto de
                 SESSION_SECRET
   ========================================================= */

const express = require("express");
const path = require("path");
const cookieParser = require("./lib/cookieParser");

/* El .env ANTES de leer process.env, por lo mismo que en server.js:
   si se carga después, PORT y NODE_ENV salen vacíos y el servicio se
   ata al puerto por defecto sin avisar. */
const env = require("./lib/env");
env.load();

const supabase = require("./lib/supabase");
const acceso = require("./lib/acceso-servicio");
const webhook = require("./lib/webhook");

const app = express();

const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 3200;
const HOST = (process.env.BOT_HOST || "").trim();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("trust proxy", 1);

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieParser);

/* Cabeceras. Las mismas que el panel: esto también tiene datos de
   clientes, aunque sean los suyos. */
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
  next();
});

const db = supabase.disponible() ? supabase.getAdmin() : null;

/* ---------- El servicio en sí ----------
   nombre: identifica el servicio (cookie nexo_bot)
   exige : el módulo que el cliente tiene que tener contratado */
const bot = acceso.crear({
  db,
  nombre: "bot",
  cookie: "nexo_bot",
  exige: "bot_whatsapp",
  mostrar: "Bot de WhatsApp",
  /* Dónde cae el cliente al entrar. Antes esto devolvía al panel y el
     botón "Abrir" no abría nada: te devolvía al panel sin llegar a
     ver el bot nunca. */
  raiz: "/mi-bot",
});

app.get("/entrar", bot.entrar);
app.post("/entrar", bot.canjear);

/* ---------- Webhook de Evolution ----------

   OJO con por qué esta ruta NO lleva `bot.sesion` y por qué aquí sí
   se usa la secret key, cuando en todo lo demás está prohibido:

     · No hay sesión. La llama Evolution, un servidor nuestro, por su
       cuenta y sin cookie. El middleware de sesión la rechazaría.
     · No hay token de usuario que reconstruir, así que no hay forma
       de ir por RLS. Y no hace falta: lo que entra no son datos de
       un cliente, es un evento sobre una instancia. Lo escribe el
       servidor.
     · Lo que SÍ hay que proteger es quién puede llamar. De eso se
       ocupa el secreto de lib/webhook.js, en tiempo constante y con
       la puerta cerrada si no está configurado.

   La ruta está fuera de `bot.sesion` a propósito. Si algún día se
   cambiara, el bot entero dejaría de funcionar para el cliente. */
app.post("/webhook", webhookHandler);

/* ---------- El manejador del webhook ----------

   Va aquí y no dentro de lib/webhook.js para que ese módulo se pueda
   probar sin levantar Express. Este solo traduce HTTP a lo que
   lib/webhook.js entiende. */
async function webhookHandler(req, res) {
  /* Se responde SIEMPRE rápido y con 200 cuando el secreto cuadra.
     Si el evento es de una instancia que no es nuestra, también 200:
     Evolution reintenta lo que no responde con 2xx, y reintentar un
     evento que no nos pertenece solo genera ruido. El descarte queda
     en el registro, que es donde se mira después.

     Devolver 4xx a Evolution cuando el secreto NO cuadra sí es lo
     correcto: se le dice que no insista. */
  const verif = webhook.verificar(req);

  if (!verif.ok) {
    /* Se registra el intento. Que quede escrito quién llamó con qué
       es la mitad de por qué esto existe. */
    await webhook.registrar({
      event_type: "webhook_rechazado",
      payload: null,
      status: "skipped",
      error: verif.motivo,
    });

    /* 503 con el motivo exacto: si esto ocurre en producción, quien
       lo mire tiene que ver AL INSTANTE que falta el secreto, no un
       "forbidden" genérico que no dice nada. */
    console.error("[webhook] " + verif.motivo + ": " + (verif.explica || ""));
    return res.status(verif.motivo === "sin_secreto_configurado" ? 503 : 401).json({
      ok: false,
      error: verif.motivo,
      detalle: verif.explica,
    });
  }

  const payload = req.body || {};
  const instancia = webhook.instanciaDe(payload);
  const tipo = String(payload.type || payload.event || payload.eventType || "desconocido");

  const encontrado = await webhook.botDe(instancia);

  if (!encontrado.ok) {
    await webhook.registrar({
      event_type: tipo,
      payload,
      status: encontrado.motivo === "instance_not_found" ? "skipped" : "failed",
      error: encontrado.motivo + (instancia ? " (" + instancia + ")" : ""),
    });
    /* 200: ya está registrado y no es culpa de Evolution que el
       evento sea de otra instancia. */
    return res.status(200).json({ ok: true, descartado: encontrado.motivo });
  }

  const botRow = encontrado.bot;

  await webhook.registrar({
    event_type: tipo,
    payload,
    bot_id: botRow.id,
    status: "processed",
  });

  /* De aquí para adelante ya es trabajo del motor (lib/motor.js),
     que todavía no existe. Se responde ANTES de procesarlo: Evolution
     no debería reintentar porque tardemos en contestar. */

  res.status(200).json({ ok: true, bot_id: botRow.id });
}

/* ---------- Ruta de ejemplo ----------
   Esto es lo que haría el bot de verdad: lee con req.db, que va
   como el usuario, y por eso RLS le devuelve solo lo suyo. */
app.get("/mi-bot", bot.sesion, async (req, res) => {
  /* req.db = Supabase con el token del cliente. NO usar getAdmin(). */
  const { data: perfil } = await req.db
    .from("profiles")
    .select("nombre")
    .eq("id", req.sesion.user_id)
    .maybeSingle();

  /* Comprobación de negocio: ¿qué tiene contratado este cliente?
     Esto sí va con la secret key: es un sí/no sobre un cliente, no
     son sus datos. */
  const { data: clienteId } = await db
    .from("profiles")
    .select("client_id")
    .eq("id", req.sesion.user_id)
    .maybeSingle();

  const { data: modulos } = await db.rpc("modulos_del_cliente", {
    cliente_uuid: clienteId && clienteId.client_id,
  });

  res.render("servicio/bot-demo", {
    titulo: "Bot de WhatsApp",
    nombre: (perfil && perfil.nombre) || "cliente",
    modulos: modulos || [],
    /* Esto es lo que usaría el bot real: el cliente de RLS, para que
       cada cliente lea solo lo suyo. */
    tieneToken: Boolean(req.sesion.access_token),
  });
});

app.get("/salir", async (req, res) => {
  const token = req.cookies && req.cookies[bot.cookie];
  if (token) await require("./lib/auth").revocarSesion(db, token);
  res.clearCookie(bot.cookie, { path: "/" });
  res.json({ ok: true });
});

/* ---------- 404 ---------- */
app.use((req, res) => {
  res.status(404).render("servicio/sin-acceso", {
    titulo: "Bot de WhatsApp",
    motivo: "Esta página no existe en el bot.",
  });
});

app.listen(PORT, HOST || "0.0.0.0", () => {
  console.log(
    `Bot Nexo Studio escuchando en http://${HOST || "0.0.0.0"}:${PORT}` +
      (HOST ? "" : "  (sin BOT_HOST: escucha en todas las interfaces)")
  );

  if (!supabase.disponible()) {
    console.warn("  ⚠️  Sin Supabase: el acceso no funcionará.");
  }
  if (!process.env.SERVICE_SECRET) {
    console.warn("  ⚠️  Sin SERVICE_SECRET: no se pueden verificar los tickets.");
  }
});
