/* =========================================================
   Nexo Studio — La salud del sistema
   ---------------------------------------------------------
   Un panel que dice únicamente cómo van las personas: cuántos
   clientes, cuántas consultas, cuántos servicios. Y nada de cómo
   van las máquinas.

   Esta es la parte que responde a lo otro, y que no se ve en ninguna
   otra pantalla:

     · ¿responde cada microservicio, o solo parece desplegado?
     · ¿el catálogo vende algo que no tiene software detrás?
     · ¿el panel y cada servicio comparten el mismo secreto?
     · ¿las variables que cada servicio necesita, están puestas?

   ── POR QUÉ ESTA PANTALLA Y NO UN MONITOR ──

   Los fallos que de verdad duelen en este proyecto no han sido de
   código. Han sido de configuración:

     · El panel y `inventario` tenían SERVICE_SECRET distinto en una
       de las dos filas duplicadas de Coolify. El botón "Abrir"
       firmaba con uno y el servicio verificaba con el otro. El
       síntoma era un 401 "ese enlace no vale", que es el mismo texto
       que un ticket manipulado. Se estuvo buscando un ataque que no
       había, y comparando secretos que eran idénticos.

     · `bot_whatsapp` estaba "a la venta" con la url
       `https://proveedor-externo.example`, que no existe. Nadie se
       enteró porque la url es un dato y el catálogo no la valida.

     · La pantalla del cliente reventaba con "nombreCliente is not
       defined" cuando caducaba el token. Un 500 por una variable que
       no se pasaba por un camino que nadie miraba.

   Los tres se habrían visto en esta pantalla. Y los tres son del
   mismo tipo: algo que alguien configuró, que quedó a medias, y que
   no falla al desplegar sino cuando ya lo usa un cliente.

   ── POR QUÉ NO ES UN SISTEMA DE MONITORIZACIÓN ──

   Deliberadamente. Un monitor te avisa cuando algo se rompe; esto te
   dice si algo está BIEN PUESTO. La diferencia importa: lo que se
   rompe solo cuando alguien lo usa no se rompe nunca durante un
   despliegue, así que un monitor normal nunca lo pilla. Y lo que
   importa aquí es la configuración equivocada, no el proceso caído.

   ── SOBRE COMPARTIR SECRETOS ──

   El secreto NO se guarda en la base. Se compara preguntando a cada
   servicio: la pantalla pide su `/api/salud` y compara el md5 que
   devuelve con el suyo. Un md5 de un secreto de 64 caracteres
   aleatorios no se deshace, y así el secreto sigue viviendo
   únicamente en el entorno de cada despliegue.
   ========================================================= */

const crypto = require("node:crypto");

/* Cuánto se concede a cada microservicio antes de darlo por caído.
 *
 * Corto a propósito. Esta pantalla se abre para mirar algo rápido, y
 * si un servicio está colgado del todo, esperar diez segundos por
 * servicio es peor que saying "no responde". */
const TIEMPO_MS = 4000;

/* Dominios que son de ejemplo y no existen de verdad. No hace falta
 * comprobarlos: `.example` está reservado por la RFC 2606 justamente
 * para esto. Marcarlos evita gastar un timeout en un dominio que no
 * va a responder nunca. */
const EJEMPLO = /\.(example|test|invalid|localhost)$/i;

const md5 = (texto) => crypto.createHash("md5").update(String(texto)).digest("hex");

/* ── Consultar sin que la pantalla se caiga ──
 *
 * `db.from(x).select()` devuelve un objeto `{ data, error }`, no una
 * promesa: no tiene `.then` ni `.catch`. La primera versión de este
 * fichero encadenaba `.catch(() => ({ data: null }))` esperando que
 * existiera, y reventaba con
 *
 *   db.from(...).select(...).catch is not a function
 *
 * que es un error de JavaScript, no de la base. Así que ahora se
 * espera y se mira el `error` a mano.
 *
 * Que devuelva null en vez de reventar es lo correcto: si una tabla no
 * existe, esta pantalla tiene que decir "no pude comprobar esto", no
 * caerse ella. Una pantalla de salud que se cae no sirve de nada. */
async function consultar(db, tabla, columnas, orden) {
  try {
    let q = db.from(tabla).select(columnas);
    if (orden) q = q.order(orden);
    const { data, error } = await q;
    if (error) {
      return { data: null, error: error.message };
    }
    return { data: data || null, error: null };
  } catch (e) {
    /* Una excepción de verdad, no un error de la consulta. */
    return { data: null, error: (e && e.message) || String(e) };
  }
}

/* ── El nuestro ── */
function nuestroSecreto() {
  return (process.env.SERVICE_SECRET || "").trim();
}

/* ── Preguntar a un microservicio ──
 *
 * Un `fetch` sin timeout se queda colgado si el otro acepta la
 * conexión y no contesta, que es justo lo que hace un proceso parado
 * a medias detrás de un proxy. Por eso el AbortController no es
 * opcional: sin él, esta pantalla se queda esperando y parece
 * colgada ella. */
async function preguntar(urlBase) {
  const url = urlBase.replace(/\/+$/, "") + "/api/salud";

  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), TIEMPO_MS);

  try {
    const r = await fetch(url, {
      signal: control.signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    const cuerpo = await r.json().catch(() => ({}));

    return {
      responde: r.ok,
      estado: r.status,
      cuerpo,
      ms: r.headers.get("X-Tiempo-Ms") || null,
    };
  } catch (e) {
    /* AbortError es "no contestó a tiempo"; el resto es "no llegó".
     * Se distinguen porque uno es un problema del servicio y el otro
     * del sitio donde vive. */
    const porTimeout = e && (e.name === "AbortError" || /abort/i.test(String(e.message || "")));
    return {
      responde: false,
      estado: porTimeout ? "TARDÓ" : "NO LLEGA",
      error: porTimeout
        ? `no contestó en ${TIEMPO_MS / 1000} s`
        : String((e && e.message) || e),
    };
  } finally {
    clearTimeout(reloj);
  }
}

/* ── La comprobación grande ──
 *
 * Devuelve una lista de avisos. Cada uno lleva `nivel`: `rojo` si
 * algo está roto ahora, `ambar` si es un riesgo, `verde` si todo lo
 * comprobable lo está.
 *
 * Se separa en "comprobado" y "no comprobado" a propósito. Decir
 * "todo bien" cuando tres cosas no se pudieron mirar es peor que no
 * decir nada: el todo bien se lee, la ausencia de dato no. */
async function revisar(db) {
  const avisos = [];

  const nuestro = nuestroSecreto();
  const nuestroMd5 = nuestro ? md5(nuestro).slice(0, 16) : null;

  /* ═══ 1. ¿TENEMOS SECRETO NOSOTROS? ═══════════════════════════
   *
   * Si falta, esto para: sin él no hay nada que comparar y todo lo
   * de abajo daría "correcto" sin haber comprobado nada. */
  if (!nuestro) {
    avisos.push({
      nivel: "rojo",
      titulo: "El panel no tiene SERVICE_SECRET",
      detalle:
        "Sin él no se puede comprobar que los servicios compartan secreto. " +
        "Es lo primero que se mira: sin él, todo lo demás de esta pantalla es teatro.",
      como: "En Coolify, Web Empresa → Environment → SERVICE_SECRET.",
    });

    return avisos;
  }

  /* ═══ 2. MIGRACIONES PENDIENTES ════════════════════════════════
   *
   * Un despliegue que se queda a medio camino deja el código nuevo
   * con la base vieja. La app aguanta —no falla al arrancar— y
   * rompe la primera vez que toca algo nuevo. */
  /* La columna es `nombre`, no `name`. Con `name` la consulta no da
   error: devuelve una lista de objetos sin esa propiedad, y el Set
   queda vacío. El resultado era "16 migraciones sin aplicar" con las
   dieciséis ya aplicadas, y un rojo permanente en una pantalla que
   no miente nunca. Por eso está el comentario. */
  const aplicadas = (await consultar(db, "schema_migrations", "nombre")).data;

  const aplicadasNombres = new Set((aplicadas || []).map((m) => m.nombre));

  /* Se leen los ficheros del disco. En el contenedor están, porque
   * van dentro de la imagen; si no están, se dice y no se inventa. */
  const fs = require("node:fs");
  const path = require("node:path");

  const dirMigraciones = path.join(__dirname, "..", "db", "migrations");

  if (!fs.existsSync(dirMigraciones)) {
    avisos.push({
      nivel: "ambar",
      titulo: "No se pueden comprobar las migraciones",
      detalle:
        "Los ficheros .sql no están en el contenedor. Puede ser que el despliegue " +
        "los excluya; si es así, la base no se puede actualizar sola y eso hay que saberlo.",
    });
  } else {
    const ficheros = fs.readdirSync(dirMigraciones).filter((f) => f.endsWith(".sql"));
    const pendientes = ficheros.filter((f) => !aplicadasNombres.has(f));

    if (pendientes.length) {
      avisos.push({
        nivel: "rojo",
        titulo: `Hay ${pendientes.length} migración(es) sin aplicar`,
        detalle:
          "El código del despliegue es más nuevo que la base. La app sigue arrancando, " +
          "pero la primera operación que use lo nuevo fallará.",
        como: `node db/migrate.js   →  ${pendientes.join(", ")}`,
      });
    }
  }

  /* ═══ 3. CADA MICROSERVICIO ═══════════════════════════════════ */
  const micros = (
    await consultar(db, "microservicios", "modulo,nombre,url_base,activo,nota", "nombre")
  ).data;

  if (!micros) {
    avisos.push({
      nivel: "ambar",
      titulo: "No se puede leer el registro de microservicios",
      detalle: "La tabla `microservicios` no existe o no es legible. ¿Falta la migración 016?",
      como: "node db/migrate.js",
    });
  }

  const modulos = (await consultar(db, "modules", "id,url,disponible,retirado")).data;

  const modulosPorId = new Map((modulos || []).map((m) => [m.id, m]));

  const comprobados = [];

  for (const m of micros || []) {
    const modulo = modulosPorId.get(m.modulo);
    const linea = { ...m, estado: "verde", notas: [] };

    /* 3a. ¿El catálogo vende esto? */
    if (modulo && modulo.disponible && !modulo.retirado) {
      if (!modulo.url) {
        linea.estado = "rojo";
        linea.notas.push(
          "Está a la venta en el catálogo pero sin url: el botón «Abrir» no lleva a ninguna parte."
        );
      } else if (EJEMPLO.test(modulo.url)) {
        linea.estado = "rojo";
        linea.notas.push(
          `A la venta con una url de ejemplo (${modulo.url}): ese dominio no existe. ` +
            "Un cliente que lo contrate llega a la nada."
        );
      } else if (modulo.url.replace(/^https?:\/\//, "").replace(/\/.*$/, "") !== m.url_base.replace(/^https?:\/\//, "").replace(/\/.*$/, "")) {
        /* El catálogo y el registro apuntan a sitios distintos. */
        linea.estado = "ambar";
        linea.notas.push(
          `El catálogo apunta a ${modulo.url} y el registro a ${m.url_base}. ` +
            "Uno de los dos está viejo."
        );
      }
    }

    /* 3b. ¿Y el microservicio? */
    if (!m.activo) {
      linea.estado = linea.estado === "rojo" ? "rojo" : "ambar";
      linea.notas.push("Marcado como inactivo en el registro: no se le pregunta si responde.");
    } else if (!m.url_base) {
      linea.estado = "rojo";
      linea.notas.push("Activo pero sin url_base: no hay a quién preguntar.");
    } else {
      const r = await preguntar(m.url_base);
      linea.respuesta = r;

      if (!r.responde) {
        linea.estado = "rojo";
        linea.notas.push(`No responde: ${r.estado}. ${r.error || ""}`.trim());
      } else {
        /* El secreto compartido, que es lo importante. */
        if (!r.cuerpo || r.cuerpo.secret_md5 === undefined) {
          linea.estado = "ambar";
          linea.notas.push(
            "Responde, pero sin secret_md5: es un despliegue viejo. " +
              "Falta /api/salud con el endpoint de esta versión."
          );
        } else if (r.cuerpo.secret_md5 !== nuestroMd5) {
          linea.estado = "rojo";
          linea.notas.push(
            `EL SECRETO NO COINCIDE. Este servicio tiene md5 ${r.cuerpo.secret_md5} ` +
              `y el panel ${nuestroMd5}. El botón «Abrir» firmará con uno y el ` +
              "servicio verificará con el otro: el canje dará 401 «ese enlace no vale», " +
              "que es el mismo texto que un ticket manipulado."
          );
        }

        /* Las variables que dice tener. */
        const conf = r.cuerpo.configuracion || {};
        const faltan = Object.entries(conf)
          .filter(([, v]) => v !== true)
          .map(([k]) => k);

        if (faltan.length) {
          if (linea.estado === "verde") linea.estado = "ambar";
          linea.notas.push(`Le faltan variables en su entorno: ${faltan.join(", ")}`);
        }

        /* Y si contesta, pero diciendo que no. */
        if (r.cuerpo.ok === false) {
          linea.estado = "rojo";
          linea.notas.push(`Contesta con un error: ${r.cuerpo.error || "sin detalle"}`);
        }
      }
    }

    comprobados.push(linea);
  }

  /* ═══ 4. MÓDULOS A LA VENTA SIN NADA DETRÁS ════════════════════
   *
   * Un módulo del catálogo que no aparece en el registro no tiene
   * software, o se olvidó de apuntarlo. Lo primero es un cliente que
   * paga por nada; lo segundo es que esta pantalla va a mintiendo. */
  if (micros && modulos) {
    const registrados = new Set(micros.map((m) => m.modulo));

    for (const mod of modulos || []) {
      if (mod.retirado) continue;
      if (!mod.disponible) continue;
      if (registrados.has(mod.id)) continue;

      avisos.push({
        nivel: "ambar",
        titulo: `«${mod.id}» está a la venta y no está en el registro`,
        detalle:
          "No hay ningún microservicio apuntado para este módulo. O falta el software, " +
          "o falta la fila en `microservicios`. Si es lo segundo, esta pantalla va a " +
          "decir que todo bien sin haber mirado este módulo.",
      });
    }
  }

  /* ═══ RESUMEN ═════════════════════════════════════════════════
   *
   * Solo se cuentan los malos a propósito. Un "12 de 15 bien" en una
   * pantalla de salud invita a leer el número grande y pasar del
   * pequeño. Lo que importa es cuántos están rotos, y son los que se
   * enumerate. */
  const rojos =
    avisos.filter((a) => a.nivel === "rojo").length +
    comprobados.filter((c) => c.estado === "rojo").length;

  const ambares =
    avisos.filter((a) => a.nivel === "ambar").length +
    comprobados.filter((c) => c.estado === "ambar").length;

  const verdes = comprobados.filter((c) => c.estado === "verde").length;

  return {
    avisos,
    micros: comprobados,
    resumen: { rojos, ambares, verdes, total: comprobados.length },
    nuestroMd5,
  };
}

module.exports = { revisar, preguntar, md5, nuestroSecreto, TIEMPO_MS, EJEMPLO };