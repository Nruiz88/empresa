/* =========================================================
   /panel/salud — cómo están las máquinas
   ---------------------------------------------------------
   Solo para el personal del equipo. Un cliente que llegue aquí
   vería los nombres de los servicios y si funcionan, que no es
   información suya.

   Lo que enseña `lib/salud.js`:

     · si cada microservicio responde
     · si el panel y cada uno comparten el mismo SERVICE_SECRET
     · si el catálogo vende algo que no tiene software detrás
     · si hay migraciones sin aplicar

   ── LO QUE HACE FALTA DE `comunes`, Y POR QUÉ ──
   `comunes` lleva { db, sitio, csrf, requiereStaff }. La primera vez
   que se escribió esto se pidieron dos cosas que ahí no están, y las
   dos fallaron en silencio:

     · `requiereLogin` — no existe en `comunes`; el arranque muere con
       "Route.get() requires a callback function but got a
       [object Undefined]". Y `requiereStaff` es además lo correcto:
       esta pantalla es del equipo, no de cualquiera con sesión.

     · `site` — sí está, pero hay que leerlo de `comunes`. Si no se
       pasa al render, la cabecera revienta con "site is not defined"
       y la pantalla devuelve un 500 con una plantilla a medio hacer.
   ========================================================= */

const express = require("express");
const salud = require("../lib/salud");
const supabase = require("../lib/supabase");
const L = require("../lib/labels");

const BASE = "/panel";

/* ── El juego de variables, siempre el mismo ──
 *
 * La plantilla usa estas ocho sin comprobar nada. Si la ruta se deja
 * una en algún camino, la pantalla devuelve un 500 con el nombre de la
 * variable en el cuerpo, en vez de avisar de lo que fuera.
 *
 * ── POR QUÉ NO SE DEFINE EN LA PLANTILLA ──
 * Se intentò con un bloque `<% %>` y `typeof`, y no funciona: EJS
 * envuelve CADA bloque de scriptlet en su propia función, así que un
 * `var` puesto ahí no llega al siguiente bloque. La pantalla seguía
 * dando "fallo is not defined" con los valores por defecto puestos.
 *
 * Antes de que esto existiera, el bug era al revés: la ruta de error
 * no pasaba `esStaff` ni `nombreCliente`, que la plantilla de
 * mis-servicios usa sin comprobar. Mismo idioma, mismo sitio.
 *
 * Con esta función, los dos caminos llaman a la misma y no hay forma
 * de que se desincronicen. */
function escena({ fallo = false, mensaje = "", resultado = null, dinero = null } = {}) {
  const r = resultado || {};

  return {
    fallo,
    mensaje,

    micros: r.micros || [],
    avisos: r.avisos || [],
    nuestroMd5: r.nuestroMd5 || null,
    resumen: r.resumen || { rojos: 0, ambares: 0, verdes: 0, total: 0 },

    dinero: dinero || {
      pendientes: 0,
      pendienteImporte: 0,
      vencidos: 0,
      vencidoImporte: 0,
    },
  };
}

/* ── Las rutas van SIN el prefijo /panel ──
 *
 * routes/panel.js monta esto con `router.use("/panel", ...)`, de modo
 * que declarar `BASE + "/salud"` deja la ruta real en
 * /panel/panel/salud y devuelve un 404 sin más pista. El aviso está
 * en el propio routes/panel.js, junto al resto de sub-paneles. */
module.exports = function panelSalud(comunes) {
  const { requiereStaff, sitio: site } = comunes;
  const router = express.Router();

  router.get("/salud", requiereStaff, async (req, res) => {
    /* Es una pantalla de diagnóstico, y su dato principal es que todo
       esté bien. Cachearla es pedirle que enseñe cosas viejas justo
       cuando peor viene. */
    res.set("Cache-Control", "no-store");

    const db = supabase.getAdmin();

    /* `revisar` tarda lo que tarden los servicios en contestar. Si uno
       se cuelga, el AbortController de dentro lo corta: esta pantalla
       nunca se queda esperando sin fin. */
    let resultado;
    try {
      resultado = await salud.revisar(db);
    } catch (e) {
      /* Si la propia pantalla de salud revienta, al menos tiene que
         decirlo claro en vez de dejar un error vacío. Se pinta la
         MISMA plantilla, en modo fallo, para que quien la abra sepa
         que el problema es la comprobación y no la página. */
      return res.status(500).render("panel/salud", {
        ...res.locals,
        site,
        base: BASE,
        titulo: "Salud del sistema",
        labels: L,

        ...escena({
          fallo: true,
          mensaje:
            "No se pudo hacer la comprobación: " +
            ((e && e.message) || "error desconocido") +
            ". Si pasa siempre, mira la conexión con la base.",
          resultado: { resumen: { rojos: 1, ambares: 0, verdes: 0, total: 0 } },
        }),
      });
    }

    /* El dinero. No hay función para esto todavía y esta pantalla es de
       otra cosa, así que se calcula aquí. Va en la misma pantalla a
       propósito: quien viene a ver si las máquinas están sanas tiene
       que ver también qué se le debe, porque es lo único que no tiene
       arreglo técnico. */
    const { data: cobros } = await db
      .from("cobros")
      .select("importe,estado,vence_en")
      .eq("estado", "pendiente");

    const hoy = new Date().toISOString().slice(0, 10);
    const vencidos = (cobros || []).filter((c) => c.vence_en < hoy);
    const suma = (lista) => lista.reduce((s, c) => s + (Number(c.importe) || 0), 0);

    res.render("panel/salud", {
      ...res.locals,
      site,
      base: BASE,
      titulo: "Salud del sistema",
      labels: L,

      ...escena({
        resultado,
        dinero: {
          pendientes: (cobros || []).length,
          pendienteImporte: suma(cobros || []),
          vencidos: vencidos.length,
          vencidoImporte: suma(vencidos),
        },
      }),
    });
  });

  return router;
};