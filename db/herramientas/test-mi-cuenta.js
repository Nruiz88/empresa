/* Prueba del cambio de contraseña del cliente.

   Importa que NO acepte cualquier cosa: se cambia una contraseña
   real, así que hay que comprobar que se rechazan las nuevas
   demasiado cortas, las que no coinciden y la actual incorrecta.

   Al final deja la contraseña como estaba, para no dejar la cuenta
   del cliente de ejemplo con una clave que nadie sabe. */
const env = require("../../lib/env");
env.load();
const supabase = require("../../lib/supabase");
const db = supabase.getAdmin();
const crypto = require("crypto");

const BASE = "http://127.0.0.1:3000";
const EMAIL = "cliente@ejemplo.com";
const ORIGINAL = "ClienteDemo123";
const CSRF = "pruebacuenta";

let fallos = 0;
const ok = (c, n, extra) => {
  console.log(`  ${c ? "✓" : "✗"} ${n}${extra ? "  → " + extra : ""}`);
  if (!c) fallos++;
};

(async () => {
  const admin = supabase.getAdmin();

  /* Si el test revienta a mitad, la contraseña del cliente de ejemplo
     se queda cambiada y el siguiente que abra el panel no puede
     entrar. Por eso la restauración va en un finally, no al final
     del guion. */
  let pendienteRestaurar = true;

  try {
    await guionar();
  } catch (err) {
    console.error("\n  error: " + err.message);
    fallos++;
  } finally {
    if (pendienteRestaurar) {
      const { data: u } = await admin.auth.admin.listUsers({ perPage: 200 });
      const c = (u.users || []).find((x) => x.email === EMAIL);
      if (c) {
        await admin.auth.admin.updateUserById(c.id, { password: ORIGINAL });
        console.log("  contraseña del cliente de ejemplo restaurada");
      }
    }
    await db.from("sessions").delete().eq("csrf_token", CSRF);
  }

  console.log(fallos ? `\n  ${fallos} fallo(s)\n` : "\n  Todo correcto\n");
  process.exit(fallos ? 1 : 0);
})().catch((e) => {
  console.error("error: " + e.message);
  process.exit(1);
});

/* El guion va aparte para que el finally de arriba lo rodee entero. */
async function guionar() {
  const admin = supabase.getAdmin();

  const { data: usuarios } = await admin.auth.admin.listUsers({ perPage: 200 });
  const cliente = usuarios.users.find((u) => u.email === EMAIL);
  if (!cliente) throw new Error("no está el cliente de ejemplo");

  /* Sesión propia del panel, con un access_token REAL: el portal
     reconstruye la sesión de Supabase con él, y sin él devolvería un
     error en vez de la página. */
  const publico = supabase.getPublico();
  const { data: sesionSupa } = await publico.auth.signInWithPassword({
    email: EMAIL,
    password: ORIGINAL,
  });
  if (!sesionSupa) throw new Error("no se pudo iniciar sesión como cliente");

  const token = crypto.randomBytes(24).toString("hex");
  await db.from("sessions").insert({
    token_hash: crypto.createHash("sha256").update(token).digest("hex"),
    user_id: cliente.id,
    rol: "client",
    csrf_token: CSRF,
    access_token: sesionSupa.session.access_token,
    expira_en: new Date(Date.now() + 900e3).toISOString(),
  });

  const cookies = { cookie: "nexo_panel=" + token };
  const post = (cuerpo) =>
    fetch(BASE + "/panel/mi-cuenta/password", {
      method: "POST",
      redirect: "manual",
      headers: { ...cookies, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: CSRF, ...cuerpo }).toString(),
    });

  /* ---------- La pantalla existe ---------- */
  console.log("\n── la pantalla ──");
  const pag = await (await fetch(BASE + "/panel/mi-cuenta", { headers: cookies })).text();
  ok(pag.includes("Mi cuenta"), "la página carga");
  ok(pag.includes(EMAIL), "muestra con qué correo se entra");
  ok(pag.includes('name="actual"'), "pide la contraseña actual");
  ok(pag.includes('name="nueva"'), "pide la nueva");
  ok(pag.includes('name="repetida"'), "pide repetirla");
  ok(!pag.includes(ORIGINAL), "NO enseña la contraseña actual en el HTML");

  /* ---------- Rechazos ---------- */
  console.log("\n── lo que debe rechazar ──");

  const entraCon = async (clave) => {
    const r = await supabase.getPublico();
    const { error } = await r.auth.signInWithPassword({ email: EMAIL, password: clave });
    return !error;
  };

  let r = await post({ actual: "no-es-la-buena", nueva: "NuevaClaveLarga1", repetida: "NuevaClaveLarga1" });
  ok(String(r.headers.get("location")).includes("error=actual"), "rechaza si la actual no es correcta");
  ok(await entraCon(ORIGINAL), "y la contraseña sigue siendo la de antes");

  r = await post({ actual: ORIGINAL, nueva: "corta", repetida: "corta" });
  ok(String(r.headers.get("location")).includes("error=larga"), "rechaza una nueva demasiado corta");

  r = await post({ actual: ORIGINAL, nueva: "NuevaClaveLarga1", repetida: "OtraDistinta9" });
  ok(String(r.headers.get("location")).includes("error=distinta"), "rechaza que no coincidan");

  r = await post({ actual: ORIGINAL, nueva: ORIGINAL, repetida: ORIGINAL });
  ok(String(r.headers.get("location")).includes("error=igual"), "rechaza repetir la misma");

  r = await post({ actual: ORIGINAL, nueva: "NuevaClaveLarga1" });
  ok(String(r.headers.get("location")).includes("error=distinta"), "si falta la repetición, también");

  ok(await entraCon(ORIGINAL), "después de todos los rechazos, nada ha cambiado");

  /* ---------- CSRF ---------- */
  const sinCsrf = await fetch(BASE + "/panel/mi-cuenta/password", {
    method: "POST",
    redirect: "manual",
    headers: { ...cookies, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ actual: ORIGINAL, nueva: "NuevaClaveLarga1", repetida: "NuevaClaveLarga1" }).toString(),
  });
  ok(sinCsrf.status === 403, "sin token CSRF lo rechaza", String(sinCsrf.status));
  ok(await entraCon(ORIGINAL), "y no cambia nada");

  /* ---------- El cambio bueno ---------- */
  console.log("\n── el cambio bueno ──");
  const NUEVA = "PortalCliente2026";
  const antes = await db.from("sessions").select("id").eq("user_id", cliente.id);

  r = await post({ actual: ORIGINAL, nueva: NUEVA, repetida: NUEVA });
  ok(String(r.headers.get("location")).includes("hecho=1"), "acepta la nueva contraseña");
  ok(await entraCon(NUEVA), "con la nueva se entra");
  ok(!(await entraCon(ORIGINAL)), "con la vieja ya no se entra");

  /* Cierra las demás sesiones pero no la suya: si se cerrara la
     propia, el cliente se quedaría fuera justo al cambiar la clave. */
  const respSes = await db
    .from("sessions")
    .select("id,revocada_en")
    .eq("user_id", cliente.id);
  /* Si la consulta falla, `data` viene null y el .filter de abajo
     revienta con un error que no dice nada del problema real.
     Pasa: ya se ha visto al leer datos sin mirar el error. */
  if (respSes.error) throw new Error("lectura de sesiones: " + respSes.error.message);
  const propias = (respSes.data || []).filter((s) => s.revocada_en === null);
  ok(propias.length === 1, "deja abierta exactamente una sesión, la suya", "abiertas=" + propias.length);

  /* Sigue viendo su portal sin volver a entrar. */
  const portal = await fetch(BASE + "/panel/mis-servicios", { headers: cookies });
  ok(portal.status === 200, "el portal sigue funcionando sin entrar otra vez", String(portal.status));

  /* ---------- Dejarlo como estaba ----------
     La restauración también la hace el finally de arriba si algo
     revienta antes de llegar aquí. Esto es solo el camino feliz. */
  console.log("\n── limpieza ──");
  await admin.auth.admin.updateUserById(cliente.id, { password: ORIGINAL });
  ok(await entraCon(ORIGINAL), "la contraseña vuelve a la de siempre para el cliente de ejemplo");
}