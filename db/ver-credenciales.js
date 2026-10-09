/* ¿Dónde está la clave con la que se habla con la caja?
   ─────────────────────────────────────────────────────────────
   Las variables de Evolution que se leen de `evolution_servers` son
   tres:

     · url   — de qué caja se habla. Es del servidor.
     · api_key — la clave GLOBAL: ve todas las instancias.
     · webhook_secret — el de las llamadas que hace Evolution.

   Y hay un cuarto que no está en esa tabla, porque es de cada bot:
   `bots.instance_token`, que solo ve su instancia.

   ── LA REGLA ──

   Para LEER y ESCRIBIR de una instancia concreta: el token del bot.

   Para hablar de la CAJA (listar instancias, ver la salud): la clave
   global. Porque es la única que puede, y no hay alternativa.

   ── POR QUÉ IMPORTA ──

   Porque la global puede leer los chats de todos los bots de la caja.
   Con un cliente no hay diferencia. Con dos, un script de diagnóstico
   que usa la global está leyendo la conversación de un negocio que no
   es el suyo. No porque tenga mala intención: porque era lo más fácil.

   Este script existe para que eso no vuelva a pasar por descuido: dice
   dónde está cada cosa y qué se está usando. */
const fs = require("fs");
const path = require("path");

require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

/* Qué tiene que usar cada archivo, y con qué credencial.
   "token"  = el de la instancia del bot
   "global" = la clave global del servidor
   "ninguna" = no habla con la caja */
const REGLAS = {
  "probar-webhook-directo.js": "global",
  "probar-entrega-bot.js": "global",
  "test-webhook-bot.js": "global",
  "test-bot-real.js": "global",
  "probar-webhook-real.js": "global",
  "calibrar-findmessages.js": "global",
  "ver-tablas-bot.js": "ninguna",
  "ver-lid.js": "ninguna",
  "ver-campos-logs.js": "ninguna",
  "ver-telefonos-log.js": "ninguna",
  "ver-rutas-evolution.js": "global",
  "sondar-rutas.js": "global",
  "registrar-webhook.js": "global",
  "alinear-nombre-instancia.js": "global",
  "arreglar-webhook.js": "global",
  "copiar-token-instancia.js": "global",
  "probar-aislamiento.js": "global",
  "probar-envio-token.js": "global",
  "ver-chats.js": "token",
  "buscar-chat.js": "token",
  "ver-envio-real.js": "token",
  "probar-clave-nueva.js": "token",
  "ver-webhook-real.js": "token",
  "probar-flujo-turnos.js": "ninguna",
  "probar-estado-tras-reinicio.js": "ninguna",
  "probar-horarios-vacios.js": "ninguna",
  "ver-horarios.js": "ninguna",
  "ver-volumen.js": "ninguna",
  "ver-migraciones.js": "ninguna",
  "ver-restas.js": "ninguna",
};

/* Las operaciones que tocan la conversación de alguien. Con la global,
   estas ven los chats de TODOS los clientes de la caja. */
const TOCAN_CHATS = [
  { patron: /chat\/findChats/, que: "lista las conversaciones" },
  { patron: /message\/findMessages/, que: "lee los mensajes enviados" },
  { patron: /message\/fetchBase64/, que: "lee el contenido de un mensaje" },
  { patron: /chat\/search/, que: "busca en las conversaciones" },
];

(async () => {
  console.log("\n═══ Con qué credencial habla cada script ═══\n");

  /* Lo que hay en la tabla, para saber si el token existe. */
  const { data: bots } = await db.from("bots").select("name, instance_token");

  const hayToken = (bots || []).some((b) => b.instance_token);

  console.log("  bots con token de instancia: " +
    (hayToken ? (bots || []).filter((b) => b.instance_token).length + " de " + (bots || []).length
      : "NINGUNO"));
  console.log("");

  /* Se recorre el directorio de scripts. */
  const dir = __dirname;
  const archivos = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));

  const usosPeligrosos = [];

  for (const archivo of archivos.sort()) {
    const texto = fs.readFileSync(path.join(dir, archivo), "utf8");

    /* ¿Habla con la caja? */
    const hablaCaja = /fetchInstances|\/instance\/|\/webhook\/|\/chat\/|\/message\//.test(texto);

    /* ¿Lee conversaciones? */
    const chats = TOCAN_CHATS.filter((c) => c.patron.test(texto));

    /* ¿De dónde saca la clave? */
    const usaGlobal = /select\((["'])(url, api_key|api_key)\1/.test(texto) ||
      /\.select\("url, api_key"\)/.test(texto) ||
      /evolution_servers"[\s\S]{0,80}api_key/.test(texto);

    const usaToken = /instance_token/.test(texto);

    if (!hablaCaja) continue;

    if (chats.length && usaGlobal && !usaToken) {
      usosPeligrosos.push({ archivo, chats });
      console.log("  ! " + archivo.padEnd(30) + chats.map((c) => c.que).join(", ") +
        "  — con la clave GLOBAL");
    } else if (chats.length && usaToken) {
      console.log("  ✓ " + archivo.padEnd(30) + chats.map((c) => c.que).join(", ") +
        "  — con el token del bot");
    } else {
      console.log("  · " + archivo.padEnd(30) + "habla con la caja, pero no lee chats");
    }
  }

  console.log("");
  console.log("  ──────────────────────────────────────────────\n");

  if (usosPeligrosos.length) {
    console.log("  " + usosPeligrosos.length + " script(s) leen conversaciones con la\n" +
      "  clave global.\n");
    console.log("  Con un solo cliente no se nota: la global ve una instancia y\n" +
      "  no hay nada que cruzar.\n");
    console.log("  Con el segundo cliente, estos leerían los chats del otro. No\n" +
      "  por mala intención: por usar la credencial que había a mano.\n");
    console.log("  El arreglo es que SAE el token del bot y no el del servidor.\n");
  } else {
    console.log("  Ninguno lee conversaciones con la clave global.\n");
  }
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});