/* Prueba de las rutas nuevas por HTTP, con sesión de staff de verdad.

   Va contra el servidor que esté levantado (npm start). Hace lo que haría
   una persona: abrir la pantalla, darle a Probar, mirar el resultado.

     node db/probar-bots.js
*/

const env = require("../lib/env");
env.load();

const supabase = require("../lib/supabase");
const db = supabase.getAdmin();
const crypto = require("crypto");

const BASE = process.env.TEST_PANEL || "http://127.0.0.1:3000";
const COOKIE = "nexo_panel";
const CSRF = "probandobots";
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");

let fallos = 0;
const comprobar = (texto, cond) => {
  if (!cond) fallos++;
  console.log("  " + (cond ? "✓" : "✗") + " " + texto);
};

async function sesionDePrueba(userId, rol) {
  const token = crypto.randomBytes(24).toString("hex");
  const { error } = await db.from("sessions").insert({
    token_hash: hash(token),
    user_id: userId,
    rol,
    csrf_token: CSRF,
    expira_en: new Date(Date.now() + 3600e3).toISOString(),
  });
  if (error) throw new Error(error.message);
  return token;
}

async function pedir(ruta, token, metodo = "GET", cuerpo = null) {
  const res = await fetch(BASE + ruta, {
    method: metodo,
    redirect: "manual",
    headers: {
      cookie: COOKIE + "=" + token,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: cuerpo,
  });
  return { status: res.status, loc: res.headers.get("location"), texto: await res.text() };
}

/* Lo que se ve en la pantalla, para poder decir "el panel lo enseña" y no
   solo "la ruta devuelve 200". */
const tiene = (texto, aguja) => texto.includes(aguja);

(async () => {
  const { data: usuarios } = await supabase.getAdmin().auth.admin.listUsers({ perPage: 200 });
  const staffId = (usuarios.users.find((u) => u.email === "admin@nexostudio.es") || {}).id;
  if (!staffId) throw new Error("no se encuentra el usuario staff");
  const staff = await sesionDePrueba(staffId, "staff");

  console.log("\n═══ Bots y cajas, por HTTP ═══\n");

  /* ---------- La lista de bots ---------- */
  console.log("── /panel/bots ──\n");
  {
    const { status, texto } = await pedir("/panel/bots", staff);
    comprobar("responde 200", status === 200);
    comprobar("enseña el titular Bots", tiene(texto, "<h1>Bots</h1>"));
    comprobar("el menú tiene la entrada Bots", tiene(texto, "/panel/bots"));
    comprobar("y la de Cajas de bots", tiene(texto, "/panel/servidores"));

    /* Los datos reales tienen que aparecer. La caja y el bot existen, así
       que si la pantalla sale vacía es que la consulta no cruzó el
       cliente. */
    const { data: unBot } = await db
      .from("bots")
      .select("name,instance_name,slug,clients(empresa,email)")
      .limit(1)
      .maybeSingle();

    if (unBot) {
      comprobar("enseña el nombre del bot (" + unBot.name + ")", tiene(texto, unBot.name));
      comprobar("enseña el nombre de la instancia (" + unBot.instance_name + ")", tiene(texto, unBot.instance_name));
      const empresa = unBot.clients && unBot.clients.empresa;
      if (empresa) comprobar("enseña la empresa del cliente (" + empresa + ")", tiene(texto, empresa));
      const email = unBot.clients && unBot.clients.email;
      if (email) comprobar("enseña su email (" + email + ")", tiene(texto, email));
      comprobar("enseña la dirección de reservas", tiene(texto, "agendar/" + unBot.slug));
    }
  }

  /* ---------- El filtro ---------- */
  console.log("\n── El filtro por texto ──\n");
  {
    const { status, texto } = await pedir("/panel/bots?q=" + encodeURIComponent("panaderia"), staff);
    comprobar("responde 200", status === 200);

    const { data: unBot } = await db.from("bots").select("name").ilike("name", "%panaderia%").limit(1).maybeSingle();
    if (unBot) comprobar("encuentra el bot por el nombre", tiene(texto, unBot.name));

    const { texto: sinNada } = await pedir("/panel/bots?q=zzzznoexistenada", staff);
    comprobar("con algo que no existe dice que no hay nada", tiene(sinNada, "Nada con ese filtro"));
  }

  /* ---------- Revisar el estado (esto habla con la Evolution) ---------- */
  console.log("\n── Revisar el estado de un bot (llama a la caja real) ──\n");
  {
    /* Se pide `status_checked_at` ANTES de preguntar a la caja, porque es
       lo que se compara después: si la caja no responde, la fecha tiene
       que seguir igual. Sin pedirla aquí, la comparación era contra
       `undefined` y siempre salía distinta. */
    const { data: unBot } = await db
      .from("bots")
      .select("id,status,status_checked_at")
      .limit(1)
      .maybeSingle();

    if (!unBot) {
      console.log("  (no hay bots)");
    } else {
      const cuerpo = new URLSearchParams({ _csrf: CSRF }).toString();
      const { status, loc } = await pedir("/panel/bots/" + unBot.id + "/revisar", staff, "POST", cuerpo);

      comprobar("responde con redirección (no se queda colgada)", status === 302);
      comprobar("vuelve a la lista de bots", String(loc).includes("/panel/bots"));

      /* Lo que de verdad importa: si la Evolution respondió, el estado se
         guardó y la fecha se puso. Si no respondió, tiene que decirlo en
         la pantalla en vez de fingir que todo bien. */
      const { data: despues } = await db
        .from("bots")
        .select("status,status_checked_at")
        .eq("id", unBot.id)
        .maybeSingle();

      if (String(loc).includes("aviso=bot:revisado")) {
        comprobar("la caja respondió y se avisó", true);
        comprobar("se guardó el estado que dijo la caja", Boolean(despues.status));
        comprobar("y cuándo se preguntó", Boolean(despues.status_checked_at));
        console.log("     estado ahora: " + despues.status);
      } else {
        console.log("     la caja no respondió (se espera en local)");
        comprobar("eso se dice en la pantalla, no se disimula", String(loc).includes("servidor:no-contesta"));
        comprobar(
          "y no se finge que se comprobó",
          String(despues.status_checked_at) === String(unBot.status_checked_at)
        );
      }
    }
  }

  /* ---------- La lista de cajas ---------- */
  console.log("\n── /panel/servidores ──\n");
  {
    const { status, texto } = await pedir("/panel/servidores", staff);
    comprobar("responde 200", status === 200);
    comprobar("enseña el titular", tiene(texto, "<h1>Servidores de bots</h1>"));

    const { data: caja } = await db
      .from("evolution_servers")
      .select("name,url,webhook_secret")
      .limit(1)
      .maybeSingle();

    if (caja) {
      comprobar("enseña el nombre de la caja (" + caja.name + ")", tiene(texto, caja.name));
      comprobar("enseña la url (el equipo la necesita)", tiene(texto, caja.url));

      /* La comprobación de que no se escapa la clave va contra el VALOR
         real de la base, no contra la palabra "api_key". Con lo segundo
         saltaba siempre que hubiera un formulario de cambiar la clave
         (el atributo `name="api_key"`), y daba un falso positivo que
         hacía dudar de algo que estaba bien.

         Y el secreto del webhook también, que es el otro. */
      const { data: claves } = await db
        .from("evolution_servers")
        .select("api_key,webhook_secret");
      const fugas = (claves || []).filter(
        (c) =>
          (c.api_key && tiene(texto, c.api_key)) ||
          (c.webhook_secret && tiene(texto, c.webhook_secret))
      );
      comprobar("NO sale ninguna clave ni secreto en el HTML", fugas.length === 0);

      comprobar(
        caja.webhook_secret ? "dice que el secreto está puesto" : "avisa de que falta el secreto",
        caja.webhook_secret ? tiene(texto, "Puesto") : tiene(texto, "Falta")
      );
    }
  }

  /* ---------- Probar la caja (llama a la Evolution real) ---------- */
  console.log("\n── Probar una caja (llama a la Evolution real) ──\n");
  {
    const { data: caja } = await db.from("evolution_servers").select("id").limit(1).maybeSingle();

    if (!caja) {
      console.log("  (no hay cajas)");
    } else {
      const cuerpo = new URLSearchParams({ _csrf: CSRF }).toString();
      const { status, loc } = await pedir("/panel/servidores/" + caja.id + "/probar", staff, "POST", cuerpo);

      comprobar("responde con redirección", status === 302);

      const { texto } = await pedir(String(loc).split("#")[0], staff);
      const respondio = String(loc).includes("servidor:probado");

      if (respondio) {
        comprobar("la caja responde y el panel lo dice", tiene(texto, "Caja probada"));
        const n = /instancias=(\d+)/.exec(String(loc));
        console.log("     instancias en la caja: " + (n ? n[1] : "?"));
        /* Si la caja tiene instancias y el webhook de alguna no cuadra,
           tiene que decirlo. Con una caja sana sale limpio. */
        console.log("     avisos: " + (tiene(texto, "no tienen el webhook preparado") ? "SÍ" : "ninguno"));
      } else {
        console.log("     la caja no respondió: " + String(loc));
        comprobar("eso se dice con el motivo, no se disimula", tiene(texto, "no respondió") || tiene(texto, "rechazó la clave"));
      }
    }
  }

  /* ---------- Formularios ---------- */
  console.log("\n── Formularios ──\n");
  {
    /* Las claves se leen de la base, no se escriben aquí.

       Estaba el texto de la clave pegado en estas dos comprobaciones, y
       eso era malo por dos motivos a la vez: subía una clave real a
       git, y el día que la clave se rotara el test empezaría a fallar
       sin que hubiera cambiado nada (daría "correcto" con cualquier
       otra clave en pantalla, que es justo lo contrario de lo que
       comprueba). */
    const { data: cajas } = await db.from("evolution_servers").select("id,api_key,webhook_secret");
    const caja = (cajas || [])[0];
    const secretos = (cajas || [])
      .flatMap((c) => [c.api_key, c.webhook_secret])
      .filter((v) => typeof v === "string" && v.length > 8);

    const nuevo = await pedir("/panel/bots/nuevo", staff);
    comprobar("el alta de bot se abre", nuevo.status === 200);
    comprobar(
      "el alta de bot no enseña ninguna clave",
      secretos.every((s) => !tiene(nuevo.texto, s))
    );

    if (caja) {
      const editando = await pedir("/panel/servidores/" + caja.id + "/editar", staff);
      comprobar("la edición de caja se abre", editando.status === 200);
      comprobar(
        "la edición tampoco enseña la clave ni el secreto",
        secretos.every((s) => !tiene(editando.texto, s))
      );
    }
  }

  /* ---------- Un cliente no llega ---------- */
  console.log("\n── Un cliente no puede dar de alta bots ──\n");
  {
    const { data: cliente } = await db.from("profiles").select("id,rol").eq("rol", "client").limit(1).maybeSingle();
    if (!cliente) {
      console.log("  (no hay cliente de prueba)");
    } else {
      const cli = await sesionDePrueba(cliente.id, cliente.rol);

      for (const r of ["/panel/bots", "/panel/bots/nuevo", "/panel/servidores", "/panel/servidores/nuevo"]) {
        const { status, texto } = await pedir(r, cli);
        comprobar(r + " → 403", status === 403);
      }

      /* Y por POST tampoco: el 403 del GET no dice nada del POST, que es
         donde se tocaría la base de verdad. El CSRF que se manda es el de
         la sesión del cliente, así que si el middleware lo aceptara, la
         ruta de abajo llegaría a ejecutar. */
      const cuerpo = new URLSearchParams({ _csrf: CSRF, name: "Intruso", client_id: "x" }).toString();
      const { status } = await pedir("/panel/bots/nuevo", cli, "POST", cuerpo);
      comprobar("POST /panel/bots/nuevo → 403", status === 403);

      const cuerpo2 = new URLSearchParams({ _csrf: CSRF, name: "Intruso", url: "https://x.example" }).toString();
      const { status: s2 } = await pedir("/panel/servidores/nuevo", cli, "POST", cuerpo2);
      comprobar("POST /panel/servidores/nuevo → 403", s2 === 403);
    }
  }

  await db.from("sessions").delete().eq("csrf_token", CSRF);

  console.log("\n" + "─".repeat(50));
  console.log(fallos ? "  ✗ " + fallos + " fallo(s)" : "  ✓ todo correcto");
  console.log("");
  process.exit(fallos ? 1 : 0);
})().catch((e) => {
  console.error("error: " + (e && e.message ? e.message : e));
  process.exit(1);
});