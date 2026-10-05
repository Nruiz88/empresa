/* =========================================================
   Nexo Studio — ¿A qué cliente pertenece este usuario?
   ------------------------------------------------------------
   Una función que estaba copiada en routes/panel-portal.js y que hace
   falta también en panel-perfil.js. Copiada dos veces ya es deuda:
   la tercera copia es la que se desincroniza.

   ⚠️  POR QUÉ VA CON LA SECRET KEY
   --------------------------------
   Porque esto NO es acceder a los datos del cliente. Es resolver una
   identidad: "este id de usuario de Auth, ¿a qué empresa pertenece?".
   La respuesta es un uuid, y va dentro de la sesión.

   La línea que hay que tener clara: los DATOS del cliente (sus
   servicios, sus cobros, su ficha) se leen SIEMPRE por
   getClientForToken y RLS. Esto solo devuelve el id para poder
   preguntar por ellos en su nombre.

   Si algún día esto devolviera más cosas (el nombre, el email), dejaría
   de ser inocuo y habría que pasarlo por RLS.
   ========================================================= */

const supabase = require("./supabase");

/**
 * @param {string} userId  id de auth.users
 * @returns {Promise<string|null>}  id del cliente, o null si es staff
 *                                   o el perfil no existe
 */
async function clientIdDe(userId) {
  if (!userId) return null;

  const { data, error } = await supabase
    .getAdmin()
    .from("profiles")
    .select("client_id")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    /* No se lanza: quien llama casi siempre va a pintar una vista, y
       reventar aquí dejaría al cliente sin portal por un fallo puntual
       de lectura. Se avisa por consola y se sigue como si no tuviera
       ficha. */
    console.error("[clientIdDe] No se pudo leer el perfil:", error.message);
    return null;
  }

  return (data && data.client_id) || null;
}

module.exports = clientIdDe;
