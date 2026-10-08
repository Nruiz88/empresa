/* ¿La clave nueva de Evolution deja ver las instancias?
   ─────────────────────────────────────────────────────────────
   La clave guardada en `evolution_servers` devuelve una lista VACÍA de
   instancias, con HTTP 200. Eso no es un error de permisos: es un 200
   con `[]`.

   Un 200 con lista vacía y una 401 se distinguen fácil, y la
   diferencia importa: la clave vale pero no ve ninguna instancia, o la
   clave ya no es la de este servidor.

   ── POR QUÉ NO SE IMPRIME LA CLAVE ──

   Va a quedar escrita en un fichero de este repositorio y en el
   historial de la conversación. No hace falta imprimirla para
   comprobar si funciona, y escribirla en un log la deja en un sitio
   más del que hay que acordarse de borrar después.

   Por eso va por variable de entorno, y por eso aquí solo se dice si
   funciona o no. */
require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

(async () => {
  const nueva = process.env.NUEVA_CLAVE;

  if (!nueva) {
    console.log("\n  Falta NUEVA_CLAVE.\n");
    console.log("  Es la clave nueva de Evolution, y se pasa por entorno para no");
    console.log("  dejarla escrita en un fichero:\n");
    console.log("    $env:NUEVA_CLAVE=\"...\"");
    console.log("    node db/probar-clave-evolution.js\n");
    process.exit(1);
  }

  const { data: srv } = await db.from("evolution_servers").select("url, api_key").limit(1).single();

  console.log("\n═══ ¿La clave nueva ve las instancias? ═══\n");

  for (const [que, clave] of [
    ["la guardada", srv.api_key],
    ["la nueva", nueva],
  ]) {
    let r;
    try {
      r = await fetch(srv.url + "/instance/fetchInstances", {
        headers: { apikey: clave },
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      console.log("  " + que.padEnd(12) + "no responde: " + e.message.split("\n")[0]);
      continue;
    }

    const texto = await r.text();
    let lista = null;
    try { lista = JSON.parse(texto); } catch (e) { lista = null; }

    console.log("  ── " + que + " ──");
    console.log("    HTTP " + r.status + (Array.isArray(lista) ? "  ·  " + lista.length + " instancia(s)" : ""));
    console.log("");

    if (!Array.isArray(lista)) {
      console.log("    respuesta: " + texto.slice(0, 200));
      console.log("");
      continue;
    }

    if (!lista.length) {
      console.log("    (no ve ninguna instancia)");
      console.log("");
      continue;
    }

    for (const i of lista) {
      console.log("    nombre:   " + i.name);
      console.log("    id:       " + i.id);
      console.log("    estado:   " + i.connectionStatus);
      console.log("    numero:   " + String(i.ownerJid || "").replace("@s.whatsapp.net", ""));
      console.log("");
    }
  }

  /* Lo que el bot necesita: una instancia con ESE nombre. Si la clave
     nueva muestra la instancia pero con otro nombre, el bot no la va a
     encontrar, y buscándola por el nombre viejo tampoco. */
  console.log("  ──────────────────────────────────────────────");
  console.log("\n  El bot busca la instancia por el NOMBRE guardado en la base,");
  console.log("  que ahora mismo es «Boti 1».\n");
  console.log("  Si con la clave nueva aparece con otro nombre, hay dos cosas");
  console.log("  que cambiar: la clave y el nombre. Ojo con esto: el nombre es");
  console.log("  con el que Evolution manda el `instance` en cada webhook.\n");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});