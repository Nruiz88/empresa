require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

/* =========================================================
   Shopcito - Borrar SOLO los clientes de prueba
   ------------------------------------------------------------
   node db/borrar-pruebas-clientes.js          cuenta y no toca nada
   node db/borrar-pruebas-clientes.js --si     borra de verdad

   ── POR QUÉ ESTE SCRIPT Y NO EL OTRO ──

   `borrar-pruebas.js` borra cuentas de Auth y todo lo que no sea el
   admin, con el criterio de «no es el admin, se borra». Con ese
   criterio se lleva por delante a `adri.ruiz.nqn@gmail.com`, que es un
   cliente real: su correo no lleva marca de prueba, así que el
   criterio no lo distingue de un robot.

   Este script usa el criterio contrario y explícito: se borra solo lo
   que lleva una marca de prueba en su nombre, empresa o correo. Un
   cliente real nunca la lleva, porque el nombre lo puso una persona.

   ── LA SALVAGUARDA ──

   Antes de borrar nada, cuenta cuántos clientes hay y cuántos son de
   prueba, y para si no queda ningún cliente real. Borrar las pruebas y
   quedarse con la base vacía no es limpiar: es borrar el trabajo del
   cliente. Y si algún día no queda ninguno real, para.

   ── POR QUÉ NO SE BORRAN LOS HIJOS A MANO ──

   La primera versión de este script borraba primero `charges` y
   `services` y luego `clients`. Falló: no existe una tabla `charges`,
   y aunque existiera, la lista estaba incompleta.

   `ver-enganches.js` dice que de `clients` cuelgan 17 tablas, todas
   con `CASCADE` menos `profiles`, que queda en `SET NULL`. Es decir:
   la base ya se encarga de arrastrar a los hijos, y hacerlo a mano
   además de innecesario es peligroso, porque basta con que falte un
   nombre en la lista para dejar filas apuntando a un cliente que ya no
   existe.

   Así que aquí solo se borra `clients` y se cuenta después qué cayó,
   que es la forma de comprobar que la base hizo su trabajo.
   ========================================================= */

const SEGURO = process.argv.includes("--si");

/* Las tablas que cuelgan de `clients` por `client_id`, tal como las
   devuelve `ver-enganches.js`. Todas están en CASCADE menos `profiles`,
   que queda en SET NULL y por eso no se cuenta aquí: sus filas
   sobreviven sin cliente, que es justo lo que dice la base que quiere. */
const HIJOS = [
  "bots",
  "bot_sesiones",
  "facturacion",
  "fichas",
  "inv_arqueos",
  "inv_caja",
  "inv_clientes",
  "inv_compras",
  "inv_productos",
  "inv_proveedores",
  "inv_ventas",
  "inventario_sesiones",
  "services",
  "soporte_tickets",
  "suscripciones",
];

/* Marcas que delatan una fila creada por un test.

   `ejemplo` está porque los tests usan @ejemplo.com: es un dominio
   reservado por la RFC y nunca puede ser real. */
const MARCAS = ["test", "prueba", "demo", "ejemplo", "example", "fixture", "seed"];

const esDePrueba = (v) => {
  const t = String(v || "").toLowerCase();
  return MARCAS.some((m) => t.includes(m));
};

(async () => {
  console.log("\n═══ Borrar clientes de prueba ═══\n");

  if (!SEGURO) {
    console.log("  SIMULACRO. No se borra nada. Para hacerlo de verdad:");
    console.log("");
    console.log("      node db/borrar-pruebas-clientes.js --si");
    console.log("");
  }

  const { data: clientes, error } = await db
    .from("clients")
    .select("id, nombre, empresa, email, creado_en")
    .order("creado_en");

  if (error) {
    console.log("  no se pudo leer la lista de clientes: " + error.message);
    process.exit(1);
  }

  const dePrueba = clientes.filter(
    (c) => esDePrueba(c.empresa) || esDePrueba(c.email) || esDePrueba(c.nombre)
  );
  const reales = clientes.filter((c) => !dePrueba.includes(c));

  console.log("  clientes en total:   " + clientes.length);
  console.log("  de prueba:           " + dePrueba.length);
  console.log("  reales (se quedan):  " + reales.length);
  console.log("");

  for (const c of reales) {
    console.log("    se queda:  " + String(c.empresa || "(sin empresa)").padEnd(26) + c.email);
  }

  /* ── La comprobación que para todo ── */

  if (!reales.length) {
    console.log("");
    console.log("  - no queda ningún cliente real.");
    console.log("    Borrar todo dejaría la base vacía, y eso no es limpiar.");
    console.log("    No se borra nada.");
    console.log("");
    process.exit(1);
  }

  if (!dePrueba.length) {
    console.log("");
    console.log("  No hay clientes de prueba. No se borra nada.");
    console.log("");
    process.exit(0);
  }

  if (!SEGURO) {
    console.log("");
    console.log("  ──────────────────────────────────────────────");
    console.log("  SIMULACRO. No se ha borrado nada.");
    console.log("");
    return;
  }

  console.log("\n  ES BORRADO REAL.\n");

  const ids = dePrueba.map((c) => c.id);

  const { error: eCliente } = await db.from("clients").delete().in("id", ids);

  if (eCliente) {
    console.log("  no se pudieron borrar los clientes: " + eCliente.message);
    process.exit(1);
  }

  console.log("  clients   " + String(ids.length).padStart(3) + " clientes borrados");

  /* ── Contar lo que cayó con ellos ──

     Las 17 tablas que cuelgan de `clients` están en CASCADE, así que
     sus filas deberían haber desaparecido con el cliente. Se comprueba
     en vez de suponer: si alguna queda, es que la base no hizo su
     trabajo y hay que saberlo. */
  console.log("\n  Lo que cayó con ellos (todo en CASCADE salvo profiles):\n");

  for (const tabla of HIJOS) {
    const { count } = await db
      .from(tabla)
      .select("*", { count: "exact", head: true })
      .in("client_id", ids);

    if (count) {
      console.log("    " + tabla.padEnd(22) + " " + count + " filas sin borrar  ← REVISAR");
    }
  }

  console.log("    (sin nada escrito = todas las filas se fueron con su cliente)\n");

  const { data: quedan } = await db.from("clients").select("id");
  console.log("\n  quedan " + (quedan || []).length + " clientes:");
  for (const c of quedan || []) {
    const { data: uno } = await db.from("clients").select("empresa, email").eq("id", c.id).single();
    console.log("    " + String(uno.empresa || "(sin empresa)").padEnd(26) + uno.email);
  }
  console.log("");
})();