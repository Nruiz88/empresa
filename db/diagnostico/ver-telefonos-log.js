require("../../lib/env").load();

const db = require("../../lib/supabase").getAdmin();

/* ¿El historial de respuestas tiene teléfono?

   `handleWelcome` decide si alguien es nuevo con esto:

       SELECT id FROM bots_response_logs
        WHERE bot_id = ? AND incoming_phone = ?
        LIMIT 1

   Si `incoming_phone` está a NULL en todas las filas, esa comparación
   nunca da true — porque `NULL = '549...'` es NULL, no verdadero — y el
   bot DEDUCE que todo el mundo es nuevo. Entonces manda el mensaje de
   bienvenida en cada mensaje que le llega, para siempre.

   Y eso no falla: el webhook devuelve 200, Evolution acepta el envío, y
   el cliente recibe «¡Hola! Soy el bot» cada vez que escribe. Es el
   peor tipo de fallo, porque todo parece bien y lo único que se nota es
   que el bot es pesado.

   El aviso previo decía 18 conversaciones, pero la lista de teléfonos
   salió vacía. Eso es justo la forma que tendría el problema, así que
   se comprueba en vez de suponer. */
(async () => {
  console.log("\n═══ ¿El historial sabe QUIÉN escribió? ═══\n");

  const { data, error } = await db.rpc("ejecutar_sql", {
    consulta:
      "select count(*) as total, " +
      "count(incoming_phone) as con_telefono, " +
      "count(*) filter (where incoming_phone = '') as vacios, " +
      "count(distinct incoming_phone) as distintos " +
      "from bots_response_logs",
    args: [],
  });

  if (error) {
    console.log("  x " + error.message + "\n");
    process.exit(1);
  }

  const r = data[0];

  console.log("  filas en bots_response_logs:      " + r.total);
  console.log("  con teléfono puesto:             " + r.con_telefono);
  console.log("  con teléfono vacío (o espacios): " + r.vacios);
  console.log("  teléfonos distintos:             " + r.distintos);
  console.log("");

  if (Number(r.con_telefono) === 0) {
    console.log("  × EL HISTORIAL NO SABE QUIÉN ESCRIBIÓ.\n");
    console.log("  Con `incoming_phone` a NULL, la comprobación de bienvenida");
    console.log("  `WHERE incoming_phone = ?` nunca da verdadero. El bot cree");
    console.log("  que todo el mundo escribe por primera vez y manda la");
    console.log("  bienvenida SIEMPRE.\n");
    process.exit(1);
  }

  if (Number(r.distintos) <= 1 && Number(r.total) > 2) {
    console.log("  ! Todos los mensajes vienen del mismo teléfono.");
    console.log("    Puede ser lo normal si solo hay un cliente de prueba.");
    console.log("    También puede ser que el campo guarde siempre lo mismo.\n");
  }

  console.log("  ✓ El historial distingue teléfonos.\n");

  /* Y qué formato tienen, que es lo que tiene que coincidir con lo que
     manda el webhook (`remoteJid`, con el sufijo). */
  const { data: muestras } = await db.rpc("ejecutar_sql", {
    consulta:
      "select distinct incoming_phone, count(*) as n from bots_response_logs " +
      "group by incoming_phone order by n desc limit 6",
    args: [],
  });

  console.log("  teléfonos guardados:");
  (muestras || []).forEach((m) => {
    console.log("    " + String(m.n).padStart(3) + "  " + JSON.stringify(m.incoming_phone));
  });
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});