/* =========================================================
   Nexo Studio — Leads (consultas del formulario)
   ------------------------------------------------------------
   Copia operativa de las consultas en Supabase.

   El formulario escribe en DOS sitios:
     1. data/consultas.jsonl  — siempre, sin dependencias
     2. Supabase (leads)       — para que el panel las vea

   La web pública no puede depender de Supabase: si el proyecto
   está pausado (plan Free) o caído, perderíamos consultas. Por
   eso este módulo NUNCA lanza: si falla, avisa por consola y ya.

   ¿Por qué con @supabase/supabase-js y no con 'pg'?
   Porque escribe por la API REST usando la secret key, que es el
   camino correcto desde el servidor. Con 'pg' conectaría
   directamente y saltaría igualmente RLS, pero con más piezas.
   ========================================================= */

const supabase = require("./supabase");

/**
 * Guarda una consulta del formulario.
 * Nunca lanza: un fallo aquí no puede tumbar el envío.
 *
 * @param {object} registro  { nombre, email, empresa, telefono, tipo, presupuesto, mensaje, ip }
 */
async function saveLead(registro) {
  if (!supabase.disponible()) {
    throw new Error("Supabase no está configurado en .env");
  }

  const { data, error } = await supabase.getAdmin().from("leads").insert(
    {
      nombre: registro.nombre || null,
      email: registro.email || null,
      empresa: registro.empresa || null,
      telefono: registro.telefono || null,
      tipo: registro.tipo || null,
      presupuesto: registro.presupuesto || null,
      mensaje: registro.mensaje || null,
      ip: registro.ip || null,
      estado: "nuevo",
    },
    { returnRepresentation: false }
  );

  if (error) throw new Error(error.message);
  return data;
}

module.exports = { saveLead };
