/* =========================================================
   Shopcito — El usuario de staff
   ------------------------------------------------------------
   Devuelve el único usuario con rol `staff`, el que ve el panel
   entero.

   ── POR QUÉ NO BUSCARLO POR CORREO ──

   Catorce scripts de prueba lo hacían con `admin@nexostudio.es`
   escrito a mano. Ese correo era de Nexo Studio y dejó de existir;
   el admin ahora es `niconqn.88@gmail.com`, y dentro de un mes será
   otro. Los scripts no fallaban:$Kien no<IP> encontraban a nadie y
   seguían como si nada, y el resultado era una prueba que pasa sin
   haber probado nada.

   Buscar por ROL no depende de quién sea el que está dentro. El rol
   es lo que hace que la cuenta vea el panel entero, y eso no cambia
   con el correo.

   ── Y SI HAY VARIOS ──

   Devuelve el primero, y lo dice. Un panel con dos admins es posible
   y no es un error, pero un script que prueba «el panel» con uno
   cualquiera puede dar un resultado distinto del que espera quien lo
   usa.
   ========================================================= */

const supabase = require("../lib/supabase");

/**
 * El usuario de staff.
 *
 * @returns {Promise<{id: string, email: string}|null>} null si no hay
 */
async function staff() {
  const admin = supabase.getAdmin();

  const { data: perfiles, error } = await admin
    .from("profiles")
    .select("id, rol")
    .eq("rol", "staff")
    .order("creado_en", { ascending: true })
    .limit(2);

  if (error) throw new Error("no se pudo leer 'profiles': " + error.message);
  if (!(perfiles || []).length) return null;

  const { data: usuarios } = await admin.auth.admin.listUsers({ perPage: 200 });
  const porId = Object.fromEntries((usuarios?.users || []).map((u) => [u.id, u]));

  const elegido = perfiles[0];

  return {
    id: elegido.id,
    email: porId[elegido.id] ? porId[elegido.id].email : "(desconocido)",
  };
}

/**
 * El usuario de staff, o el proceso para con un mensaje que dice qué
 * hacer.
 *
 * Para los scripts que sin esto seguirían con un `undefined` y
 * escribirían un error tres pantallas más abajo, donde no se entiende
 * de dónde salió.
 *
 * @returns {Promise<{id: string, email: string}>}
 */
async function staffOParar() {
  const s = await staff();

  if (!s) {
    console.error("\n  x no hay ningún usuario con rol 'staff'.");
    console.error("    Creá uno con:");
    console.error("");
    console.error("      node db/create-user.js --email tucorreo@dominio.com --nombre \"Tu Nombre\" --staff");
    console.error("");
    process.exit(1);
  }

  return s;
}

module.exports = { staff, staffOParar };
