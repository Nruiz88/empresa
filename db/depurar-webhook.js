require("../lib/env").load();
const db = require("../lib/supabase").getAdmin();
const ev = require("../lib/evolution");
const bots = require("../lib/bots");

(async () => {
  const { data: caja } = await db
    .from("evolution_servers")
    .select("id,name,url,api_key,webhook_secret,webhook_url")
    .limit(1)
    .maybeSingle();

  /* El error se mira. Sin él, un `server_id` mal escrito devuelve lista
     vacía sin decir nada y el fallo siguiente es "no hay bots", que
     parece que la caja está vacía y no que la consulta iba mal. */
  const { data: lista, error: eBots } = await db
    .from("bots")
    .select("name,instance_name")
    .eq("server_id", caja.id);

  if (eBots || !lista || !lista.length) {
    console.log(
      "no hay bots en esa caja: " + (eBots ? eBots.message : "lista vacía (id " + caja.id + ")")
    );
    process.exit(1);
  }

  const inst = lista[0].instance_name;
  const url = caja.webhook_url;

  console.log("\ninstancia: " + JSON.stringify(inst));
  console.log("destino:   " + url + "\n");

  console.log("--- 1. fetchWebhook ANTES ---");
  const antes = await ev.pedir(caja.url, caja.api_key, "/webhook/fetchWebhook/" + encodeURIComponent(inst));
  console.log("  HTTP " + antes.status);
  console.log("  " + JSON.stringify(antes.data));

  console.log("\n--- 2. webhook/set, cuerpo v2 (como lo manda el bot) ---");
  const v2 = await ev.engancharWebhook(caja.url, caja.api_key, inst, url, bots.cabecerasDeWebhook(caja));
  console.log("  ok=" + v2.ok + "  HTTP " + v2.status);
  console.log("  " + JSON.stringify(v2.data));

  console.log("\n--- 3. fetchWebhook DESPUÉS ---");
  const despues = await ev.pedir(caja.url, caja.api_key, "/webhook/fetchWebhook/" + encodeURIComponent(inst));
  console.log("  HTTP " + despues.status);
  console.log("  " + JSON.stringify(despues.data));

  console.log("\n--- 4. las instancias que ve la caja ---");
  const insts = await ev.listarInstancias(caja.url, caja.api_key);
  console.log("  " + JSON.stringify(insts.data));

  console.log("\n--- 5. estado de la conexión ---");
  const st = await ev.estadoConexion(caja.url, caja.api_key, inst);
  console.log("  " + JSON.stringify(st.data));

  process.exit(0);
})();