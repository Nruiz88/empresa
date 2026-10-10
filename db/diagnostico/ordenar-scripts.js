const fs = require("fs");
const path = require("path");

/* ═══════════════════════════════════════════════════════════════
   ORDENAR LOS SCRIPTS DE `db/` SIN ROMPER NADA

   ── EL RIESGO ──

   El `package.json` tiene 82 rutas a scripts de `db/`, y los docs
   más. Si se mueve un archivo sin actualizar quien lo llama, el
   script deja de existir para el mundo: `npm test` falla con «no se
   encontró el módulo» y no queda claro si se rompió el código o se
   mudó un archivo.

   ── LA REGLA ──

   Un script se mueve solo si NADIE lo llama. Y cuando alguien lo
   llama, se actualizan todas las referencias en el mismo paso.

   Por eso esto lee las referencias antes de mover nada, y después
   reescribe `package.json` y los documentos con las rutas nuevas.
   ═══════════════════════════════════════════════════════════════ */

const RAIZ = "D:/webs/empresa";
const DB = path.join(RAIZ, "db");

/* ── DÓNDE ESTÁN LAS REFERENCIAS ── */

function archivosQueHablan() {
  const out = [path.join(RAIZ, "package.json")];

  for (const carpeta of ["docs"]) {
    const d = path.join(RAIZ, carpeta);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".md"))) {
      out.push(path.join(d, f));
    }
  }

  for (const f of fs.readdirSync(RAIZ).filter((x) => x.endsWith(".md"))) {
    out.push(path.join(RAIZ, f));
  }

  return out;
}

const HABLAN = archivosQueHablan();

/* Todas las rutas a `db/xxx` que se mencionan en esos archivos. */
const referenciadas = new Set();

for (const f of HABLAN) {
  const t = fs.readFileSync(f, "utf8");
  for (const m of t.matchAll(/db\/([\w.-]+\.(?:js|mjs))/g)) {
    referenciadas.add(m[1]);
  }
}

/* ── A QUÉ CARPETA VA CADA SCRIPT ──

   El criterio es uno solo, y no es el nombre del archivo: es si
   responde a una pregunta que se puede volver a hacer.

     herramientas/   se usan y se vuelven a usar. Con su npm script.
     diagnostico/    miran el estado de algo. Se usan cuando algo va
                     mal, no en el día a día.
     puntual/        se escribieron para un momento concreto. Ya
                     hicieron su trabajo. Se quedan en el repo pero
                     fuera de la vista del día a día.

   Y hay una cuarta categoría que no es una carpeta: los que están
   mal en la raíz pero no se pueden tocar porque algo los llama.
   Esos se quedan, y se avisa. */
const PUNTUAL = [
  "probar-dominio", "probar-campos-dominio", "quitar-dominios",
  "probar-borrar-dominio", "poner-url-inventario", "arreglar-urls-modulos",
  "probar-webhook", "ver-webhook-real", "depurar-webhook", "registrar-webhook",
  "probar-destino-webhook", "probar-envio-token", "ver-token-donde",
  "ver-rutas-evolution", "calibrar-findmessages", "alinear-nombre-instancia",
  "copiar-token-instancia", "ver-tablas-bot", "convertir-cobros-eur",
  "ver-cobros-tras-convertir", "anotar-migraciones-planes", "repartir-planos",
  "limpieza-prueba-planes", "anotar-migraciones", "coolify", "coolify-sql",
  "coolify-php", "poner-variables-coolify", "sacar-duplicados-coolify",
  "escenario-cliente", "diag-real", "prueba-", "probar-produccion",
  "test-vuelta-bot", "probar-entrega-bot", "test-flujo", "probar-con-segundo-numero",
  "test-catalogo-aplicaciones", "test-alta-aplicacion", "test-marcar-aplicaciones",
  "probar-precios", "medir-marcas", "ver-lid", "quien-tiene-modulos",
  "ver-restos-de-prueba", "entrar-cliente", "verificar-supuestos",
  "actualizar-registro", "pedir", "des-aplicar", "clave", "capturar",
  "estado-real", "arreglar-registro", "probar-bots",
];

const DIAGNOSTICO = [
  "ver-config", "ver-migraciones", "ver-logs-de-prueba", "ver-campos-logs",
  "ver-ultimas-entradas", "ver-telefonos-log", "ver-auditoria", "ver-rls-tablas",
  "rls", "list-users", "aplicar-migracion", "ver-enganches", "sonda-anchura",
  "ver-zoom", "ver-bienvenida", "ver-proteccion-servidor", "ver-volumen",
  "ver-lista-aplicaciones", "ver-portal", "ver-modulos", "ver-cabecera",
  "ver-dominios", "sondar-rutas", "buscar-desborde", "buscar-css-roto",
  "limpiar-css-muerto", "escala-tipografia", "dividir-css", "ver-tokens",
  "medir-comentarios", "capturar-home", "captura-cliente", "demo-portal",
  "demo-bot", "ver-og", "generar-og", "ver-reveal", "test-navegador",
  "limpiar-pruebas-bot", "limpiar-servicios-de-prueba", "ordenar-scripts",
  "medir-comentarios", "capturar-panel", "sonda-css-servido", "sonda-probar",
  "sonda-servidores", "test-guardar-plan", "auditar-css",
];

const CARPETAS = { "puntual": PUNTUAL, "diagnostico": DIAGNOSTICO };

/* ── DECIDIR ── */

const movibles = [];
const bloqueados = [];

for (const f of fs.readdirSync(DB)) {
  if (!f.endsWith(".js") && !f.endsWith(".mjs")) continue;
  const base = f.replace(/\.(js|mjs)$/, "");

  const destino = Object.entries(CARPETAS)
    .find(([, prefijos]) => prefijos.some((p) => base === p || base.startsWith(p)));

  if (!destino) continue;
  if (referenciadas.has(f)) {
    bloqueados.push({ f, motivo: "lo llama alguien" });
  } else {
    movibles.push({ f, destino: destino[0] });
  }
}

console.log("\n═══ Los scripts, antes de tocar nada ═══\n");
console.log("  se pueden mover:  " + movibles.length);
console.log("  no se mueven:     " + bloqueados.length + "  (los llama alguien)");
console.log("");

for (const [carpeta, n] of Object.entries(
  movibles.reduce((a, m) => ({ ...a, [m.destino]: (a[m.destino] || 0) + 1 }), {})
)) {
  console.log("  " + ("db/" + carpeta + "/").padEnd(20) + n);
}

if (bloqueados.length) {
  console.log("\n  ── los que se quedan en la raíz, y por qué ──\n");
  for (const b of bloqueados) console.log("    " + b.f.padEnd(28) + b.motivo);
}
console.log("");

/* ── MOVER, Y ACTUALIZAR QUIEN LOS LLAMA ── */

if (process.argv.includes("--si")) {
  const movidos = new Map();

  for (const m of movibles) {
    const origen = path.join(DB, m.f);
    if (!fs.existsSync(origen)) continue;

    const carpeta = path.join(DB, m.destino);
    if (!fs.existsSync(carpeta)) fs.mkdirSync(carpeta, { recursive: true });

    fs.renameSync(origen, path.join(carpeta, m.f));
    movidos.set(m.f, m.destino + "/" + m.f);
  }

  /* Cada referencia se reescribe con la ruta nueva. Se busca el
     nombre suelto, no `db/xxx`, porque algunos sitios lo escriben
     solo con el nombre y otros con la carpeta delante. */
  let corregidas = 0;

  for (const f of HABLAN) {
    let t = fs.readFileSync(f, "utf8");
    const antes = t;

    for (const [viejo, nuevo] of movidos) {
      const base = viejo.replace(/\.(js|mjs)$/, "");
      const ext = viejo.replace(base, "");
      t = t.split("db/" + viejo).join("db/" + nuevo);
      t = t.split("node db/" + base).join("node db/" + nuevo.replace(ext, ""));
    }

    if (t !== antes) {
      fs.writeFileSync(f, t, "utf8");
      corregidas++;
    }
  }

  console.log("\n═══ Hecho ═══\n");
  console.log("  movidos:   " + movidos.size);
  console.log("  corregidos: " + corregidas + " archivos con referencias rotas");
  console.log("");
} else {
  console.log("  ── SIMULACRO. Con --si se mueve de verdad.\n");
}