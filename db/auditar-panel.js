/* Auditoria del panel: que paginas hay, que piezas usa cada una, y que
   reglas del css no las usa nadie.

   node db/auditar-panel.js

   ── POR QUE ESTA ES UN POCO MAS LARGA DE LO QUE PARECE ──

   Una cuenta ingenua de "clases del css que no aparecen en el HTML"
   da falsos positivos por dos motivos que hay que cubrir:

   1. LOS NOMBRES DINAMICOS. Hay media docena de clases que se
      construyen en la vista con un `--<%= %>`:
      `panel-dist-trozo--<%= c.estado %>`, `panel-hacer-item--<%= p.nivel %>`,
      `panel-serv--<%= nivel %>`... Esas nunca aparecen escritas y
      aun asi se pintan. Sin contemplarlas, el informe dice que
      estan sin usar y es mentira.

   2. LAS CLASES DEL PORTAL. Un monton de reglas de `panel-*-*` viven
      en portal.css y se usan desde vistas de panel. Si solo se mira
      panel.css y las vistas, tambien salen como muertas.

   Por eso se lee TODO —vistas de panel, vistas publicas, parciales,
   los dos css y el js— y se buscan tanto el nombre entero como el
   prefijo sin el sufijo, que es lo que cubre los nombres
   construidos a trozos. */
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const VISTAS_PANEL = path.join(RAIZ, "views", "panel");

const leerTodo = (dir, ext) => {
  /* Devuelve SIEMPRE un string, tambien al bajar a subcarpetas.

     La primera version acumulaba en un array y hacia
     `lista.concat(leerTodo(p, ext))`, que mete el contenido de la
     subcarpeta como UN elemento mas del array. Luego el map hacia
     readFileSync sobre cada elemento, y al llegar a ese, intentaba
     leer como fichero un trozo de HTML: ENOENT con la ruta
     apuntando a "<%# El panel nunca debe indexarse %>". */
  let salida = "";
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) salida += leerTodo(p, ext) + "\n";
    else if (e.name.endsWith(ext)) salida += fs.readFileSync(p, "utf8") + "\n";
  }
  return salida;
};

const js = fs.readdirSync(path.join(RAIZ, "public", "js"))
  .map((n) => fs.readFileSync(path.join(RAIZ, "public", "js", n), "utf8")).join("\n");

/* Para la busqueda de nombres dinamicos: si en algun sitio aparece
   `algo--<%=` o `algo--${`, el prefijo `algo--` esta en uso. */
const dinamicos = new Set();
for (const fuente of [leerTodo(path.join(RAIZ, "views"), ".ejs"), js]) {
  for (const m of fuente.matchAll(/([a-z-]+)--\s*(?:<%=|\$\{)/g)) dinamicos.add(m[1] + "--");
}

const VISTAS = fs.readdirSync(VISTAS_PANEL).filter((n) => n.endsWith(".ejs")).sort();

const VOCABULARIO = [
  "panel-card", "panel-card-head", "panel-card-cintillo", "panel-card-titulo",
  "panel-card-cuerpo", "panel-rejilla", "panel-stat", "panel-stat-icono",
  "panel-dist", "panel-meter", "panel-tendencia", "panel-segmented", "panel-timeline",
];

const VIEJAS = ["panel-bloque", "panel-subtitle", "panel-clear"];

const todo = leerTodo(path.join(RAIZ, "views"), ".ejs") + "\n" + js;

const resumen = VISTAS.map((nombre) => {
  const t = fs.readFileSync(path.join(VISTAS_PANEL, nombre), "utf8");
  return {
    nombre,
    usa: VOCABULARIO.filter((c) => t.includes(c)),
    vieja: VIEJAS.filter((c) => t.includes(c)),
    lineas: t.split(/\r?\n/).length,
  };
});

console.log("=== LAS PAGINAS DEL PANEL Y QUE VOCABULARIO USAN ===");
console.log("  (hay " + VISTAS.length + " vistas)");
console.log("");

console.log("  --- SIN NADA DEL VOCABULARIO NUEVO ---");
for (const r of resumen) {
  if (r.usa.length === 0) {
    console.log("  " + r.nombre.padEnd(26) + String(r.lineas).padStart(4) + " lineas" +
      (r.vieja.length ? "   aun: " + r.vieja.join(", ") : ""));
  }
}

console.log("");
console.log("  --- CON PARTE DEL VOCABULARIO NUEVO ---");
for (const r of resumen) {
  if (r.usa.length) {
    console.log("  " + r.nombre.padEnd(26) + r.usa.join(", "));
    if (r.vieja.length) console.log("  " + " ".repeat(26) + "y aun usan: " + r.vieja.join(", "));
  }
}

console.log("");
console.log("=== LAS PIEZAS, EN CUANTAS PAGINAS SE USAN ===");
for (const c of VOCABULARIO) {
  const n = resumen.filter((r) => r.usa.includes(c)).length;
  console.log("  " + c.padEnd(22) + String(n).padStart(3) + " de " + VISTAS.length + (n === 0 ? "   SIN USAR" : ""));
}

console.log("");
console.log("=== LAS VIEJAS, EN CUANTAS PAGINAS SE USAN AUN ===");
for (const c of VIEJAS) {
  console.log("  " + c.padEnd(22) + String(resumen.filter((r) => r.vieja.includes(c)).length).padStart(3) + " de " + VISTAS.length);
}

/* Las reglas muertas, ahora sin falsos positivos. */
console.log("");
console.log("=== CLASES DEL PANEL QUE NO USA NADIE ===");

const enUso = (clase) => {
  if (todo.includes(clase)) return true;
  const prefijo = clase.endsWith("--") ? null : clase + "--";
  if (prefijo && (todo.includes(prefijo) || dinamicos.has(clase))) return true;
  /* Un nombre montado con una interpolacion en medio:
     `panel-chip--<%= nivel %>-algo` deja vivo el prefijo corto. */
  const corte = clase.match(/^([a-z-]+)--/);
  if (corte && dinamicos.has(corte[1] + "--")) return true;
  return false;
};

for (const hoja of ["panel.css", "portal.css"]) {
  const css = fs.readFileSync(path.join(RAIZ, "public", "css", hoja), "utf8");
  const clases = [...new Set((css.match(/\.panel-[\w-]+/g) || []).map((c) => c.slice(1)))].sort();
  const muertas = clases.filter((c) => !enUso(c));
  console.log("");
  console.log("  " + hoja + ": " + clases.length + " clases, " + muertas.length + " sin uso");
  muertas.forEach((c) => console.log("    " + c));
}

console.log("");
console.log("  (las que salen como muertas aqui son de las dos hojas, y solo se");
console.log("   declaran una vez: si esta en panel.css no se repite en portal.css.)");