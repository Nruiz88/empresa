const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/* ═══════════════════════════════════════════════════════════════
   REVISAR LO QUE VA A SUBIRSE

   ── POR QUÉ ESTO EXISTE ──

   Coolify despliega solo cuando hay un push. Eso significa que un
   push no es un experimento: entra en producción sin que nadie mire
   nada. Y los 22 archivos de hoy son el resultado de una sesión con
   varios scripts de arreglo, uno de los cuales escribió archivos con
   PowerShell yuo los dejó con la codificación tocada.

   ── LAS CUATRO COSAS QUE MIRA ──

     1. Secretos. Que no haya ninguna clave ni token en lo que se
        sube. El `.env` nunca se sube, pero un script de mañana
        podría haber dejado una variable dentro.

     2. Texto en otro alfabeto o con el carácter de reemplazo. Son
        los restos de los archivos que PowerShell tocó, y son
        invisibles al leer el diff con detenimiento.

     3. Marcas de prueba. Cadenas que seReconocen como prueba, que
        un despliegue no debería llevar dentro.

     4. Rutas rotas. Que lo que se sube apunte a archivos que
        existen: es el fallo que ya apareció varias veces hoy.

   ═══════════════════════════════════════════════════════════════ */

const RAIZ = "D:/webs/empresa";

/* ── LOS ARCHIVOS QUE HAN CAMBIADO ── */

const salida = execSync("git status --porcelain", { cwd: RAIZ, maxBuffer: 1e8 }).toString("utf8");

const archivos = [];
for (const linea of salida.split("\n")) {
  if (!linea.trim()) continue;
  const estado = linea.slice(0, 2);
  const rel = linea.slice(3).trim();
  if (rel.includes(" -> ")) {
    archivos.push(rel.split(" -> ")[1].trim());
  } else {
    archivos.push(rel);
  }
}

console.log("\n═══ Lo que va a subirse ═══\n");
console.log("  " + archivos.length + " archivos\n");

/* ═══════════════════════════════════════════════════════════════
   1. SECRETOS
   ═══════════════════════════════════════════════════════════════ */

/* Formas que un segredo toma y que no son código. Los nombres de las
   variables se buscan con su valor al lado: `SITE_URL` solo es una
   palabra, `SITE_URL=https://...` es una configuración. */
const SECRETO = [
  /([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD|PASSWD)[A-Z0-9_]*)\s*=\s*\S+/gi,
  /eyJ[A-Za-z0-9_-]{20,}/g,                       // JWT
  /\bsk-[A-Za-z0-9]{20,}/g,                       // claves con prefijo
  /ghp_[A-Za-z0-9]{20,}/g,                        // GitHub
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /supabase\.co\/[a-z]{20}/g,                     // URL de proyecto con clave
];

const secretos = [];

for (const rel of archivos) {
  const abs = path.join(RAIZ, rel);
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) continue;

  const t = fs.readFileSync(abs, "utf8");
  for (const re of SECRETO) {
    for (const m of t.matchAll(re)) {
      const linea = t.slice(0, m.index).split("\n").length;
      secretos.push({ rel, linea, trozo: m[0].slice(0, 46) });
    }
  }
}

console.log("═══ 1. Secretos ═══\n");
if (secretos.length) {
  for (const s of secretos) {
    console.log("  ✗ " + s.rel + " L" + s.linea + "  " + s.trozo);
  }
  console.log("\n  " + secretos.length + " posibles secretos. NO SUBIR.\n");
} else {
  console.log("  ninguno\n");
}

/* ═══════════════════════════════════════════════════════════════
   2. TEXTO EN OTRO ALFABETO O DAÑADO
   ═══════════════════════════════════════════════════════════════ */

console.log("═══ 2. Texto que no es castellano ═══\n");

const extrinsic = [];
for (const rel of archivos) {
  const abs = path.join(RAIZ, rel);
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) continue;

  const t = fs.readFileSync(abs, "utf8").split("\n");
  t.forEach((l, i) => {
    /* Otro alfabeto: cirílico, chino, japonés, coreano, árabe. */
    if (/[\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF\u0600-\u06FF]/.test(l)) {
      extrinsic.push({ rel, linea: i + 1, tipo: "alfabeto", trozo: l.trim().slice(0, 50) });
    }
    /* El carácter de reemplazo: un UTF-8 leído con otro juego de
       caracteres y guardado otra vez. Es el rastro de los archivos
       que PowerShell tocó. */
    else if (l.includes("\uFFFD")) {
      extrinsic.push({ rel, linea: i + 1, tipo: "dañado", trozo: l.trim().slice(0, 50) });
    }
  });
}

if (extrinsic.length) {
  for (const e of extrinsic) {
    console.log("  ✗ " + e.rel + " L" + e.linea + "  [" + e.tipo + "]  " + e.trozo);
  }
  console.log("\n  " + extrinsic.length + " líneas. NO SUBIR.\n");
} else {
  console.log("  ninguna\n");
}

/* ═══════════════════════════════════════════════════════════════
   3. MARCAS DE PRUEBA
   ═══════════════════════════════════════════════════════════════ */

/* Solo las que de verdad no deberían llegar a producción: datos de
   prueba dentro del código, no la palabra «prueba» en un nombre de
   función o un script de diagnóstico, que sí son legítimos. */
const MARCA = [
  /[\w.+-]+@[\w-]+\.(?:com|net|org|io)\b/g,
  /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g,          // tarjeta
  /(?:\+\d{2,3}[\s-]?)?\d{2,4}[\s-]?\d{3,4}[\s-]?\d{4}\b/g,
];

const marcas = [];
const CORREO_PERMITIDO = /niconqn\.88@gmail\.com|adri\.ruiz\.nqn@gmail\.com/;

for (const rel of archivos) {
  const abs = path.join(RAIZ, rel);
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) continue;

  const t = fs.readFileSync(abs, "utf8");
  for (const m of t.matchAll(MARCA[0])) {
    if (CORREO_PERMITIDO.test(m[0])) continue;
    marcas.push({ rel, tipo: "correo", trozo: m[0] });
  }
}

console.log("═══ 3. Marcas de prueba ═══\n");
if (marcas.length) {
  for (const m of marcas) console.log("  ? " + m.rel + "  " + m.tipo + ": " + m.trozo);
  console.log("\n  " + marcas.length + " para mirar a mano.\n");
} else {
  console.log("  ninguna\n");
}

/* ═══════════════════════════════════════════════════════════════
   4. RUTAS ROTAS
   ═══════════════════════════════════════════════════════════════ */

console.log("═══ 4. Rutas que no existen ═══\n");

const rotas = [];
for (const rel of archivos) {
  if (!rel.endsWith(".js") && !rel.endsWith(".mjs")) continue;

  const abs = path.join(RAIZ, rel);
  if (!fs.existsSync(abs)) continue;

  const t = fs.readFileSync(abs, "utf8");
  const dir = path.dirname(abs);

  for (const m of t.matchAll(/require\(["'](\.\.?\/[^"']+)["']\)/g)) {
    const d = path.resolve(dir, m[1].replace(/\.(js|mjs)$/, ""));
    const existe =
      fs.existsSync(d + ".js") || fs.existsSync(d + ".mjs") ||
      fs.existsSync(d) || fs.existsSync(path.join(d, "index.js"));
    if (!existe) rotas.push({ rel, trozo: m[1] });
  }
}

if (rotas.length) {
  for (const r of rotas) console.log("  ✗ " + r.rel + "  →  " + r.trozo);
  console.log("\n  " + rotas.length + " rotas. NO SUBIR.\n");
} else {
  console.log("  ninguna\n");
}

/* ── EL VEREDICTO ── */

const bloqueos = secretos.length + extrinsic.length + rotas.length;

console.log("═══ ═══\n");
if (bloqueos) {
  console.log("  HAY " + bloqueos + " PROBLEMAS QUE IMPIDEN SUBIR.\n");
} else {
  console.log("  Se puede subir. Las marcas por mirar son " + marcas.length + ".\n");
}