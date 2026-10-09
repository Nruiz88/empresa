/* Las dos cosas que faltan: euros en el panel, y poder asignar un
   servicio con vencimiento y marcarlo pagado.
   ─────────────────────────────────────────────────────────────
   Se mira primero qué EXISTE, antes de decir que no se puede.

   Porque «no puedo asignarle un servicio» puede ser tres cosas
   distintas, y cada una se arregla distinto:

     · la pantalla no existe;
     · existe pero no deja poner la fecha de vencimiento;
     · existe y hace todo, pero no se encuentra.

   Y la tercera es la más común, y la más fácil de no notar: si la
   función está pero dispersa en tres pantallas, el que la busca no la
   encuentra y concluye que no existe. */
require("../lib/env").load();

const fs = require("fs");
const path = require("path");

const db = require("../lib/supabase").getAdmin();

(async () => {
  console.log("\n═══ 1. Qué tablas hay y qué guardan ═══\n");

  const { data: tablas } = await db.rpc("ejecutar_sql", {
    consulta:
      "select table_name, column_name, data_type from information_schema.columns " +
      "where table_schema = 'public' " +
      "and table_name in ('services','suscripciones','cobros','modules','clients','plans') " +
      "order by table_name, ordinal_position",
    args: [],
  });

  let actual = null;
  for (const t of tablas || []) {
    if (t.table_name !== actual) {
      actual = t.table_name;
      console.log("  " + actual + ":");
    }
    console.log("    " + t.column_name.padEnd(24) + t.data_type);
  }

  /* ---- 2. Las pantallas del panel ---- */
  console.log("\n\n═══ 2. Qué pantallas hay en el panel ═══\n");

  const dir = path.join(process.cwd(), "views", "panel");
  const pantallas = fs.readdirSync(dir).filter((f) => f.endsWith(".ejs"));
  pantallas.forEach((p) => console.log("  " + p));

  /* ---- 3. Dónde se habla de servicios, vencimiento y pagado ---- */
  console.log("\n\n═══ 3. Dónde se toca cada cosa ═══\n");

  const buscar = (carpeta, patrones, etiqueta) => {
    const base = path.join(process.cwd(), carpeta);
    if (!fs.existsSync(base)) return [];

    const halls = [];
    const recorrer = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (e.name === "node_modules") continue;
          recorrer(p);
        } else if (/\.(ejs|js)$/.test(e.name)) {
          const texto = fs.readFileSync(p, "utf8");
          patrones.forEach(({ patron, que }) => {
            texto.split("\n").forEach((linea, i) => {
              if (patron.test(linea)) {
                halls.push({ donde: p.replace(process.cwd() + path.sep, ""), linea: i + 1, que, texto: linea.trim() });
              }
            });
          });
        }
      }
    };
    recorrer(base);
    return halls;
  };

  const TEMAS = [
    { patron: /vence|vencimiento|expira|alta|baja_autom|activo_hasta|fin_de/i, que: "vencimiento" },
    { patron: /\bpagado\b|pago_confirmado|paid|fecha_pago/i, que: "marcado como pagado" },
    { patron: /assign|asignar|activar.*servicio|servicio.*activar/i, que: "asignar un servicio" },
    { patron: /services/, que: "tabla services" },
  ];

  const hits = buscar("routes", TEMAS, "routes").concat(buscar("views", TEMAS, "views"));

  const porTema = {};
  for (const h of hits) {
    if (!porTema[h.que]) porTema[h.que] = [];
    porTema[h.que].push(h);
  }

  for (const [que, lista] of Object.entries(porTema)) {
    const donde = [...new Set(lista.map((h) => h.donde))];
    console.log("  " + que + ":");
    console.log("    " + donde.join("\n    "));
    console.log("    (" + lista.length + " menciones)\n");
  }

  /* ---- 4. La tabla services, con datos ---- */
  console.log("\n═══ 4. Qué hay en services ═══\n");

  const { data: services, error: eS } = await db.rpc("ejecutar_sql", {
    consulta: "select * from services limit 5",
    args: [],
  });

  if (eS) {
    console.log("  x no se pudo leer: " + eS.message);
  } else if (!services || !services.length) {
    console.log("  (vacía)");
  } else {
    console.log("  filas: " + services.length + "\n");
    Object.keys(services[0]).forEach((k) => {
      const v = services[0][k];
      console.log("    " + k.padEnd(24) +
        (v === null ? "(null)" : String(v).slice(0, 34)));
    });
  }

  console.log("");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});