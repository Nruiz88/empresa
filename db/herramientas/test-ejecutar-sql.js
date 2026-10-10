/* Prueba ejecutar_sql(): que funcione, y sobre todo que NO deje
   escribir. Es la función que el bot va a usar para sus 50 consultas,
   así que importa más cómo falla que cómo funciona. */
const supabase = require("../../lib/supabase");
require("../../lib/env").load();
const db = supabase.getAdmin();

let ok = 0;
let fallos = 0;
function comprobar(desc, cond) {
  console.log((cond ? "  ✓ " : "  ✗ ") + desc);
  cond ? ok++ : fallos++;
}
const seccion = (t) => console.log("\n── " + t + " " + "─".repeat(Math.max(0, 44 - t.length)));

(async () => {
  console.log("\n═══ ejecutar_sql ═══\n");

  const ejecutar = async (sql, args = []) => {
    const { data, error } = await db.rpc("ejecutar_sql", { consulta: sql, args });
    return { data, error };
  };

  seccion("lee");
  {
    const r = await ejecutar("select 1 as n, 'hola' as s");
    comprobar("un SELECT simple devuelve filas", Array.isArray(r.data) && r.data.length === 1);
    comprobar("y con los valores correctos", r.data?.[0]?.n === 1 && r.data?.[0]?.s === "hola");
  }
  {
    const r = await ejecutar("select id, nombre from clients limit 2");
    comprobar("lee de una tabla de empresa", Array.isArray(r.data));
    comprobar("con las columnas pedidas", r.data?.[0] && "nombre" in r.data[0]);
  }
  {
    const r = await ejecutar("select count(*)::int as total from bots");
    comprobar("agrega sobre las tablas del bot", typeof r.data?.[0]?.total === "number");
  }

  seccion("placeholders");
  {
    const r = await ejecutar("select $1::text as a, $2::int as b", ["uno", 2]);
    comprobar("acepta placeholders $1 $2", r.data?.[0]?.a === "uno" && r.data?.[0]?.b === 2);
  }
  {
    const r = await ejecutar("select $1::uuid as id", ["00000000-0000-0000-0000-000000000001"]);
    comprobar("un uuid llega con su tipo", r.data?.[0]?.id === "00000000-0000-0000-0000-000000000001");
  }
  {
    const r = await ejecutar("select $1::text as a, $2::text as b", ["con 'comillas'", "con \\ barra"]);
    comprobar("escapa comillas en los valores", r.data?.[0]?.a === "con 'comillas'");
    comprobar("y barras invertidas", r.data?.[0]?.b === "con \\ barra");
  }
  {
    const r = await ejecutar("select $1::text as a", ["%' OR '1'='1"]);
    comprobar("un intento de inyección llega como texto, no como SQL", r.data?.[0]?.a === "%' OR '1'='1");
  }
  {
    const r = await ejecutar("select $1::text as a", ["'; drop table clients; --"]);
    comprobar("un drop table en un valor es solo texto", r.data?.[0]?.a === "'; drop table clients; --");
  }
  {
    const r = await db.rpc("ejecutar_sql", { consulta: "select 1 as n" });
    comprobar("sin argumentos funciona", r.data?.[0]?.n === 1);
  }

  seccion("NO escribe");
  {
    const r = await ejecutar("delete from clients");
    comprobar("un DELETE se rechaza", Boolean(r.error));
    comprobar("  y el error lo dice", /solo permite SELECT/i.test(r.error?.message || ""));
  }
  {
    const r = await ejecutar("update clients set nombre = 'hackeado'");
    comprobar("un UPDATE se rechaza", Boolean(r.error));
  }
  {
    const r = await ejecutar("insert into clients (nombre, email) values ('x','x@x.com')");
    comprobar("un INSERT se rechaza", Boolean(r.error));
  }
  {
    const r = await ejecutar("drop table clients");
    comprobar("un DROP se rechaza", Boolean(r.error));
  }
  {
    const r = await ejecutar("truncate clients");
    comprobar("un TRUNCATE se rechaza", Boolean(r.error));
  }
  {
    /* El truco clásico: esconder un DELETE detrás de un WITH para que
       la función no lo vea al principio de la cadena. */
    const r = await ejecutar("with x as (delete from clients returning id) select * from x");
    comprobar("un DELETE escondido tras WITH se rechaza", Boolean(r.error));
  }
  {
    const r = await ejecutar("  -- comentario\n  select 1 as n");
    comprobar("un comentario inicial no la salta", r.data?.[0]?.n === 1);
  }
  {
    const r = await ejecutar("/* otro */ select 1 as n");
    comprobar("un comentario de bloque tampoco", r.data?.[0]?.n === 1);
  }
  {
    const r = await ejecutar("select 1 as n; drop table clients");
    comprobar("una segunda sentencia se rechaza", Boolean(r.error));
  }

  seccion("no rompe nada");
  {
    const antes = await db.from("clients").select("id");
    await ejecutar("delete from clients");
    const despues = await db.from("clients").select("id");
    comprobar("los clientes siguen ahí", antes.data?.length === despues.data?.length);
  }

  seccion("solo service_role");
  {
    /* Un usuario autenticado no debe poder llamarla ni aunque tenga
       una sesión válida: la función es del servidor.

       ── POR QUÉ SE CREA LA CUENTA AQUÍ ──

       La primera versión usaba `cliente@ejemplo.com`, una cuenta
       sembrada a mano. Ese día el test pasaba. El día que la cuenta se
       borró, `generateLink` siguió dando éxito —acepta un correo que
       no existe— y el fallo apareció tres líneas más abajo, como un
       `Cannot read properties of null`. Un test que depende de que
       alguien haya dejado una cuenta puesta es un test que deja de
       probar sin avisar.

       Ahora crea la cuenta, prueba y la borra. Lo que hay que probar
       es «un usuario autenticado que no es service_role», y para eso
       no hace falta que sea un cliente real de un negocio real.

       ── Y SI LA CUENTA NO SE PUEDE BORRAR ──

       Se avisa al final, con el correo, para poder buscarla. Dejar una
       cuenta de prueba colgada porque el `finally` falló es peor que
       el fallo original. */
    const CORREO = "prueba-rls@shopcito.invalid";
    const PASSWORD = "Rls-" + require("crypto").randomBytes(12).toString("hex");

    let id = null;

    try {
      const { data: creado, error: eCrear } = await db.auth.admin.createUser({
        email: CORREO,
        password: PASSWORD,
        email_confirm: true,
      });

      if (eCrear) {
        comprobar("se puede crear una cuenta de prueba", false);
        console.log("      " + eCrear.message);
      } else {
        id = creado.user.id;
        comprobar("se puede crear una cuenta de prueba", true);

        /* Con perfil de cliente, que es lo que se quiere comprobar:
           que el RLS lo para aunque tenga sesión. */
        await db.from("profiles").insert({
          id,
          rol: "client",
          nombre: "Prueba RLS",
        });

        const { data: ses, error: eSes } = await supabase
          .getPublico()
          .auth.signInWithPassword({ email: CORREO, password: PASSWORD });

        comprobar("esa cuenta inicia sesión", Boolean(ses && ses.session));

        if (ses && ses.session) {
          const comoCliente = supabase.getClientForToken(ses.session.access_token);
          const r = await comoCliente.rpc("ejecutar_sql", { consulta: "select 1 as n" });
          comprobar("un cliente NO puede llamarla", Boolean(r.error));
        }
      }
    } finally {
      if (id) {
        await db.from("profiles").delete().eq("id", id);
        const { error: eB } = await db.auth.admin.deleteUser(id);

        if (eB) {
          console.log("\n  ⚠ no se pudo borrar la cuenta de prueba: " + CORREO);
          console.log("    " + eB.message);
        }
      }
    }
  }

  console.log("\n" + "─".repeat(50));
  console.log(fallos ? `✗ ${fallos} de ${ok + fallos} fallan.\n` : `✓ Las ${ok} comprobaciones pasan.\n`);
  if (fallos) process.exitCode = 1;
})().catch((e) => {
  console.error("✗ " + e.message + "\n");
  process.exitCode = 1;
});