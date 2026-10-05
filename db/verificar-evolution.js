/* Comprobación contra el Evolution API REAL. Lee y no escribe.
   ------------------------------------------------------------
   Deliberadamente NO forma parte de `npm test`. Esta prueba habla
   con el servidor que manda los WhatsApp, y con la clave que da
   acceso a los números. Un test que se puede ejecutar por accidente,
   o en una cadena de integración continua que no lo debería, no
   debería poder tocar eso.

   Es de solo lectura: llama a `/instance/fetchInstances`, que no crea
   ni modifica nada. Para lo que escribe, hay que ir a propósito.

   USO
     npm run verificar:evolution */

require("../lib/env").load();
const evo = require("../lib/evolution");

(async () => {
  console.log("\n═══ Evolution API real (solo lectura) ═══\n");

  const { data: servidores, error } = await require("../lib/supabase")
    .getAdmin()
    .from("evolution_servers")
    .select("id,name,url,api_key")
    .order("created_at");

  if (error) {
    console.error("No se pudieron leer los servidores: " + error.message);
    process.exit(1);
  }

  if (!servidores || !servidores.length) {
    console.log("No hay ningún servidor de Evolution dado de alta.");
    process.log("Se añade con una migración o a mano; el panel todavía no lo hace.");
    process.exit(1);
  }

  for (const s of servidores) {
    console.log("── " + s.name);
    console.log("   url:  " + s.url);
    console.log("   key:  " + (s.api_key ? s.api_key.length + " caracteres" : "VACÍA"));

    const t0 = Date.now();
    const r = await evo.probarConexion(s.url, s.api_key);
    const ms = Date.now() - t0;

    if (r.ok) {
      const instancias = Array.isArray(r.data) ? r.data : [];
      console.log("   ✓ responde (" + ms + " ms, HTTP " + r.status + ")");
      console.log("   instancias: " + instancias.length);
      for (const i of instancias.slice(0, 10)) {
        /* Solo lo no sensible: nombre, estado y las tres últimas
           cifras del número. La clave de la instancia no se enseña. */
        console.log(
          "     · " +
            (i.name || "(sin nombre)") +
            "  " +
            (i.connectionStatus || i.state || "?") +
            (i.number ? "  ··" + String(i.number).slice(-3) : "")
        );
      }
    } else {
      console.log("   ✗ NO responde: " + r.message + "  (HTTP " + r.status + ")");
      if (r.status === 401) {
        console.log("     401 casi siempre es la api_key equivocada.");
      }
      if (r.status === null) {
        console.log("     Sin status es un problema de red, no de configuración:");
        console.log("     la URL no resuelve, el puerto está cerrado o hay algo");
        console.log("     en medio cortando. Con el plan de pago no debería haber");
        console.log("     esperas por hibernación.");
      }
    }
    console.log("");
  }

  process.exit(0);
})().catch((e) => {
  console.error("\n✗ " + e.message);
  process.exit(1);
});
