/* ¿Dónde quedan euros?
   ─────────────────────────────────────────────────────────────
   El panel muestra euros. La web pública ya no — MONEDA pasó a ARS y
   los planes se siembran en pesos—, pero el panel quedó atrás.

   ── POR QUÉ NO ES SOLO CAMBIAR UNA MONEDA ──

   Porque "el panel muestra euros" puede ser tres cosas distintas, y
   arreglar la primera no arregla las otras:

     · la lista de monedas ofrece euros y el valor por defecto es EUR;
     · hay filas en la base con `moneda = 'EUR'`;
     · hay un formato que pone el símbolo € fijo.

   Y si solo se cambia la primera, lo que sigue viendo el usuario es un
   precio con el símbolo de euros y un código que no corresponde. O peor:
   un importe correcto con el símbolo que no es.

   ── LO QUE SE MIRA ──

     1. Qué monedas ofrece el panel y cuál está marcada por defecto;
     2. Qué monedas hay DE VERDAD guardadas, en cada tabla con dinero;
     3. Si hay algún formato con el símbolo € puesto a mano. */
require("../lib/env").load();

const db = require("../lib/supabase").getAdmin();

/* Las tablas donde hay dinero. */
const TABLAS = [
  ["modules", "precio"],
  ["services", "precio"],
  ["plans", "precio"],
  ["suscripciones", "monto"],
  ["cobros", "importe"],
];

(async () => {
  console.log("\n═══ ¿Dónde quedan euros? ═══\n");

  /* ---- 1. La lista de monedas ---- */
  const { MONEDAS } = require("../lib/monedas");

  console.log("  ── monedas que ofrece el panel ──\n");
  MONEDAS.forEach((m) => {
    console.log("    " + m.valor + "   " + m.label.padEnd(16) + m.titulo);
  });

  const tieneEur = MONEDAS.some((m) => m.valor === "EUR");
  console.log("");
  console.log("  euros en la lista: " + (tieneEur ? "sí" : "no"));
  console.log("");

  /* ---- 2. Qué hay guardado de verdad ---- */
  console.log("  ── monedas guardadas, por tabla ──\n");

  for (const [tabla, columna] of TABLAS) {
    const { data, error } = await db.rpc("ejecutar_sql", {
      consulta:
        "select " + columna + "::text as importe, coalesce(moneda, '(sin columna)') as moneda, count(*) as c " +
        "from " + tabla + " group by 1, 2 order by c desc limit 8",
      args: [],
    });

    if (error) {
      console.log("  " + tabla.padEnd(16) + "no se pudo leer: " + error.message.split("\n")[0]);
      continue;
    }

    if (!data || !data.length) {
      console.log("  " + tabla.padEnd(16) + "(vacía)");
      continue;
    }

    const monedas = [...new Set(data.map((r) => r.moneda))];

    console.log("  " + tabla + ":");
    data.slice(0, 5).forEach((r) => {
      console.log("    " + String(r.moneda).padEnd(8) +
        String(r.c).padStart(4) + "  con " + String(r.importe).slice(0, 14));
    });

    if (monedas.includes("EUR")) {
      console.log("    → tiene filas en EUROS");
    }
    console.log("");
  }

  /* ---- 3. Símbolos puestos a mano ---- */
  console.log("  ── símbolos € escritos a mano ──\n");

  const fs = require("fs");
  const path = require("path");

  /* Se recorre el proyecto buscando el símbolo suelto, que es distinto
     de la palabra EUR. Un «€» pegado en una vista no aparece en ningún
     listado de monedas y por eso se escapa siempre. */
  const carpetas = ["views", "lib", "routes"];
  const encontrados = [];

  const buscar = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules") continue;
        buscar(p);
      } else if (/\.(ejs|js|ts|jsx|tsx)$/.test(e.name)) {
        const texto = fs.readFileSync(p, "utf8");
        texto.split("\n").forEach((linea, i) => {
          if (linea.includes("€")) {
            encontrados.push({ donde: p.replace(process.cwd() + path.sep, ""), linea: i + 1, texto: linea.trim() });
          }
        });
      }
    }
  };

  for (const c of carpetas) {
    const p = path.join(process.cwd(), c);
    if (fs.existsSync(p)) buscar(p);
  }

  if (!encontrados.length) {
    console.log("    (ninguno)");
  } else {
    encontrados.forEach((x) => {
      console.log("    " + x.donde + ":" + x.linea);
      console.log("      " + x.texto.slice(0, 100));
    });
  }

  console.log("");
  console.log("  ──────────────────────────────────────────────\n");
  console.log("  Lo que hay que decidir NO es solo quitar EUR de la lista:\n");
  console.log("    · si quedan filas en euros, hay que convertirlas o migrarlas;");
  console.log("    · quitar una moneda que alguien usó deja ese precio sin moneda,");
  console.log("      que es peor que dejarlo en euros: queda un número suelto.\n");
})().catch((e) => {
  console.log("\n  x " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
});