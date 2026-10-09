require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();
const { staff, staffOParar } = require("../lib/staff");

/* ¿Existe la cuenta de pruebas del panel?

   Se creó a mano para poder probar los formularios por HTTP: hace
   falta un login de verdad, y no se puede autenticar contra Supabase
   con la clave de servicio.

   ── POR QUÉ ESTO ES UNA PREGUNTA Y NO UN BORRADO ──

   Porque hay dos finales posibles y son distintos:

   · Si la prueba ya terminó y no se va a repetir, la cuenta sobra. Es
     una dirección de correo real en la tabla de usuarios, con una
     contraseña que alguien podría intentar.

   · Si se van a seguir probando los formularios, borrarla rompe las
     pruebas y hay que volver a crearla.

   Borrarla sin preguntar es la opción que deja algo sin hacer; preguntar
   es la que hace falta.
   ───────────────────────────────────────────────────────────── */

(async () => {
  console.log("\n═══ Cuenta de pruebas ═══\n");

  /* Se resuelve DENTRO del async. Un `await` en el nivel de módulo no
     vale en CommonJS: el archivo ni siquiera carga. */
  const CORREO = process.env.TEST_EMAIL || (await staffOParar()).email;

  console.log("  buscando: " + CORREO + "\n");

  /* ─────────────────────────────────────────────────────────
     POR QUÉ SE BUSCA EN `auth.users` Y NO EN `profiles`

     Porque el correo no está en `profiles`. Esa tabla tiene el `id`,
     el `rol` y el `client_id`, pero no el correo: es el perfil de
     negocio, no la identidad.

     La identidad —correo, contraseña, fecha de alta— está en
     `auth.users`, que es de Supabase y no tiene política de RLS. Se
     llega con la clave de servicio, por `auth.admin`.

     ── POR QUÉ NO SE ESCRIBE UN `.select` A MANO ──

     La primera versión buscó `profiles.email` y falló con «column
     profiles.email does not exist». Un error así no dice «esa columna
     no está, mira dónde está de verdad»: dice que la columna no
     existe, y lo hace sonar como si la base estuviera rota.
     ───────────────────────────────────────────────────────── */
  const { data: lista, error } = await db.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (error) {
    console.log("  x " + error.message + "\n");
    process.exit(1);
  }

  const usuarios = (lista && lista.users ? lista.users : []).filter(
    (u) => String(u.email || "").toLowerCase() === CORREO.toLowerCase()
  );

  if (!usuarios.length) {
    console.log("  no existe. Nada que limpiar.\n");
    return;
  }

  for (const u of usuarios) {
    console.log("  id:      " + u.id);
    console.log("  correo:  " + u.email);
    console.log("  creada:  " + String(u.created_at).slice(0, 10));
    console.log("  acceso:  " + (u.last_sign_in_at
      ? String(u.last_sign_in_at).slice(0, 10)
      : "nunca entró"));
    console.log("");
  }

  /* El rol, que en `profiles` es donde está. */
  const ids = usuarios.map((u) => u.id);

  const { data: perfiles } = await db
    .from("profiles")
    .select("id,rol,client_id")
    .in("id", ids);

  for (const p of perfiles || []) {
    console.log("  rol de " + String(p.id).slice(0, 8) + ": " + p.rol);
  }
  console.log("");

  /* ─────────────────────────────────────────────────────────
     QUÉ SE COMPRUEBA ANTES DE DECIR QUE SE PUEDE BORRAR

     Una cuenta de pruebas que compartía fila con datos reales no se
     borra y ya: primero hay que ver qué tiene.

     Y hay un orden que importa. Los servicios tienen `client_id` con
     una política de borrado en cascada; borrarlos primero y la cuenta
     después deja la base igual, y al revés también. Pero avisar qué
     se va a llevar antes es lo que evita el sorpresa.
     ───────────────────────────────────────────────────────── */
  const { data: servicios } = await db.rpc("ejecutar_sql", {
    consulta:
      "select count(*) as c from services where notas like 'PRUEBA%'",
    args: [],
  });

  const pruebas = servicios && servicios[0] ? Number(servicios[0].c) : 0;

  console.log("  filas de prueba en `services`: " + pruebas);
  console.log("");
  console.log("  Para borrarla:");
  console.log("    node db/limpiar-cuenta-pruebas.js");
  console.log("");

  /* El correo sin confirmar es una cuenta que alguien no puede usar
     pero que tampoco se puede quitar. Queda ahí ocupando. */
  const sinConfirmar = usuarios.filter((u) => !u.email_confirmed_at);

  if (sinConfirmar.length) {
    console.log("  ojo: sin email confirmado. No se puede entrar con ella,");
    console.log("       y sigue ocupando fila hasta que se borre.");
    console.log("");
  }
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});
