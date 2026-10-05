/* =========================================================
   Nexo Studio — Altas de acceso y usuarios del panel
   ------------------------------------------------------------
   Crear el acceso de un cliente, quitarlo, reactivarlo.

   POR QUÉ ESTO EXISTE
   -------------------
   Hasta ahora, darle acceso a alguien era abrir una terminal y
   escribir un comando con el email y una contraseña. Eso no es
   una herramienta de trabajo: es un ritual que hay que recordar, y
   se hace mal en cuanto hay más de dos personas.

   DECISIÓN: NO SE ENVÍA CORREO
   ---------------------------
   El alta devuelve la contraseña provisional para que se la
   pases al cliente por el canal que Uses (WhatsApp, llamada). No se
   manda ningún email porque no hay SMTP configurado, y montar uno
   solo para esto sería trabajo sin final. Cuando haya proveedor de
   correo, esta es la pantalla que se le enchufa detrás.

   TODO(correo): sigue en pie. No hay nodemailer ni nada que envíe
   correo: ni alta de cliente, ni aviso al equipo, ni "olvidé mi
   contraseña". Las variables SMTP_* y MAIL_FROM están declaradas en
   .env.example, pero el modo "vacío = se registra en consola" que
   allí se describe TAMPOCO existe todavía: habría que escribirlo.
   Ver PENDIENTES.md.

   LA CONTRASEÑA SE MUESTRA UNA VEZ
   -------------------------------
   Supabase guarda hashes, no contraseñas, así que no se puede volver
   a mostrar después. Por eso se enseña una sola vez y el cliente
   tiene que cambiarla. Si se pierde, se genera otra: para eso está
   "restablecer contraseña" más abajo.

   SEGURIDAD
   ---------
   - Solo staff (aquí se lo comprueba requiereStaff).
   - El email es obligatorio y se usa para detectar duplicados:
     un mismo correo no puede tener dos cuentas.
   - La contraseña se genera en el servidor si el campo va vacío. No
     se acepta ninguna cosa: se elige la strength y se la valida.
   ========================================================= */

const express = require("express");
const auth = require("../lib/auth");
const supabase = require("../lib/supabase");
const { validar, vacioANull } = require("../lib/validate");

/* Passwords temporal: 12 caracteres de algo que no se adivina. */
function passwordTemporal() {
  const minus = "abcdefghijkmnpqrstuvwxyz"; // sin l ni o: evitar confusiones
  const mayus = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const nums = "23456789";
  const todos = minus + mayus + nums;
  const crypto = require("crypto");

  const letra = (conjunto) => conjunto[crypto.randomInt(conjunto.length)];
  let clave = "";
  /* Se garantiza al menos uno de cada tipo: una contraseña solo de
     minúsculas pasa muchos validadores pero es peor. */
  clave += letra(minus) + letra(mayus) + letra(nums);
  while (clave.length < 12) clave += letra(todos);
  return clave;
}

const CUENTA = { mail: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/ };

module.exports = function rutasAccesos({ db, sitio, requiereStaff }) {
  const router = express.Router();

  /* ---------- Listado de accesos ---------- */
  router.get("/accesos", requiereStaff, async (req, res) => {
    /* Los perfiles guardan el rol; el email vive en Auth. Se piden
       los dos y se cruzan en el servidor, porque no hay forma de
       traer el email con un JOIN de PostgREST entre auth.users y
       una tabla propia. */
    const { data: perfiles } = await db
      .from("profiles")
      .select("id,rol,nombre,activo,cliente_id,ultimo_acceso,creado_en,clients(id,empresa,nombre)")
      .order("rol")
      .order("nombre");

    const ids = (perfiles || []).map((p) => p.id);
    const emailDe = new Map();
    if (ids.length) {
      const { data: usuarios } = await supabase.getAdmin().auth.admin.listUsers({ perPage: 200 });
      for (const u of usuarios.users) if (ids.includes(u.id)) emailDe.set(u.id, u.email);
    }

    const accesos = (perfiles || []).map((p) => {
      const cli = p.clients || {};
      return {
        id: p.id,
        email: emailDe.get(p.id) || "(sin email)",
        nombre: p.nombre || "(sin nombre)",
        rol: p.rol,
        activo: p.activo,
        ultimoAcceso: p.ultimo_acceso,
        empresa: cli.empresa || cli.nombre || null,
        clienteId: cli.id || null,
      };
    });

    res.render("panel/accesos", {
      title: "Accesos",
      site: sitio,
      base: "/panel",
      current: "accesos",
      accesos,
      /* Para poder marcar "eres tú" y no ofrecerte desactivarte. */
      yo: req.sesion.user_id,
      error: req.query.error || null,
      counts: {
        staff: accesos.filter((a) => a.rol === "staff").length,
        client: accesos.filter((a) => a.rol === "client").length,
        inactivos: accesos.filter((a) => !a.activo).length,
      },
    });
  });

  /* ---------- Alta ---------- */
  router.get("/accesos/nuevo", requiereStaff, async (req, res) => {
    const { data: clientes } = await db
      .from("clients")
      .select("id,empresa,nombre")
      .eq("archivado", false)
      .order("empresa");

    res.render("panel/acceso-form", {
      title: "Nuevo acceso",
      site: sitio,
      base: "/panel",
      current: "accesos",
      clientes: clientes || [],
      modo: "nuevo",
      acceso: {
        email: String(req.query.cliente_email || ""),
        nombre: String(req.query.cliente_nombre || ""),
        client_id: String(req.query.cliente || ""),
        rol: "client",
        password: "",
      },
      errores: {},
      passwordGenerada: null,
    });
  });

  router.post("/accesos/nuevo", requiereStaff, async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const nombre = String(req.body.nombre || "").trim();
    const rol = String(req.body.rol || "client").trim();
    const clientId = vacioANull(req.body.client_id);
    let password = String(req.body.password || "").trim();

    const errores = {};
    if (!email) errores.email = "Falta el email.";
    else if (!CUENTA.mail.test(email)) errores.email = "Ese email no parece válido.";
    if (!nombre || nombre.length < 2) errores.nombre = "Falta el nombre.";
    if (!["staff", "client"].includes(rol)) errores.rol = "Rol no permitido.";

    /* Un cliente SIEMPRE necesita empresa: sin ella RLS no tiene con
       qué filtrar y no vería nada. Y un staff nunca debe llevarla:
       un miembro del equipo con empresa asignada queda limitado a
       esa empresa por RLS, que no es lo que se espera de "equipo". */
    if (rol === "client" && !clientId) errores.client_id = "Elige la empresa a la que pertenece.";
    if (rol === "staff" && clientId) errores.client_id = "Una cuenta de equipo no lleva empresa.";

    /* Si no escribe contraseña, se genera una. Escrita a mano, se
       comprueba que sea suficientemente seria. */
    if (!password) {
      password = passwordTemporal();
    } else if (password.length < 10) {
      errores.password = "Mínimo 10 caracteres.";
    }

    /* ¿Ya existe ese email en Auth? Se comprueba antes de crear, no
       después: un error aquí es confuso de leer. */
    if (!errores.email) {
      const { data: usuarios } = await supabase.getAdmin().auth.admin.listUsers({ perPage: 200 });
      if (usuarios.users.some((u) => String(u.email).toLowerCase() === email)) {
        errores.email = "Ya hay una cuenta con ese email.";
      }
    }

    if (Object.keys(errores).length) {
      const { data: clientes } = await db
        .from("clients").select("id,empresa,nombre").eq("archivado", false).order("empresa");
      return res.status(400).render("panel/acceso-form", {
        title: "Nuevo acceso",
        site: sitio,
        base: "/panel",
        current: "accesos",
        clientes: clientes || [],
        modo: "nuevo",
        acceso: req.body,
        errores,
        passwordGenerada: null,
      });
    }

    /* ---------- Crear la cuenta en Auth ----------
       Si esto falla, no se crea el perfil: un perfil sin usuario
       sería un acceso que nunca va a poder entrar. */
    let userId;
    try {
      const { data, error } = await supabase.getAdmin().auth.admin.createUser({
        email,
        password,
        email_confirm: true, // el panel es cerrado: nadie se registra solo
        user_metadata: { nombre },
      });
      if (error) throw new Error(error.message);
      userId = data.user.id;
    } catch (err) {
      const { data: clientes } = await db
        .from("clients").select("id,empresa,nombre").eq("archivado", false).order("empresa");
      return res.status(500).render("panel/acceso-form", {
        title: "Nuevo acceso",
        site: sitio,
        base: "/panel",
        current: "accesos",
        clientes: clientes || [],
        modo: "nuevo",
        acceso: req.body,
        errores: { general: "No se pudo crear la cuenta: " + err.message },
        passwordGenerada: null,
      });
    }

    /* El trigger de la base de datos crea el perfil al insertar el
       usuario, pero con rol 'client' y sin empresa. Se corrige. */
    const { error: errPerfil } = await db
      .from("profiles")
      .update({ rol, nombre, client_id: rol === "client" ? clientId : null })
      .eq("id", userId);

    if (errPerfil) {
      /* Si falla el perfil se deshace el usuario: dejar medio alta es
         peor que no hacer nada. */
      await supabase.getAdmin().auth.admin.deleteUser(userId);
      return res.status(500).send("No se pudo guardar el perfil: " + errPerfil.message);
    }

    await auth.auditar(db, {
      actor: { id: req.sesion.user_id, email: null },
      accion: "crear-acceso",
      entidad: "profiles",
      entidadId: userId,
      /* No se guarda la contraseña en el log. NUNCA. */
      detalle: { email, rol, client_id: clientId },
      req,
    });

    /* Se vuelve a pintar el formulario con la contraseña a la vista.
       Es la única vez que sale de aquí. */
    res.render("panel/acceso-form", {
      title: "Acceso creado",
      site: site,
      base: "/panel",
      current: "accesos",
      clientes: [],
      modo: "creado",
      acceso: { email, nombre, rol },
      errores: {},
      passwordGenerada: password,
    });
  });

  /* ---------- Desactivar / reactivar ----------
     Desactivar, no borrar: el historial de ese usuario (sesiones,
     auditoría) se queda, y reactivarlo es un clic. Borrarlo sería
     perder datos y no se puede deshacer. */
  router.post("/accesos/:id/activo", requiereStaff, async (req, res) => {
    const nuevo = String(req.body.activo || "") === "1";

    /* No permitir quitarse el acceso a uno mismo: es la forma
       más fácil de dejar el panel sin nadie dentro. */
    if (req.params.id === req.sesion.user_id && !nuevo) {
      return res.redirect("/panel/accesos?error=autodesactivado");
    }

    const { data: antes } = await db
      .from("profiles").select("rol,activo").eq("id", req.params.id).maybeSingle();

    const { error } = await db.from("profiles").update({ activo: nuevo }).eq("id", req.params.id);

    /* Si se desactiva, se cierran sus sesiones abiertas ahora mismo.
       Si no, el cambio no surte efecto hasta que su cookie caduque. */
    if (!nuevo && !error) {
      await auth.revocarTodas(db, req.params.id);
    }

    await auth.auditar(db, {
      actor: { id: req.sesion.user_id, email: null },
      accion: nuevo ? "reactivar-acceso" : "desactivar-acceso",
      entidad: "profiles",
      entidadId: req.params.id,
      detalle: { antes: antes && antes.activo },
      req,
    });

    res.redirect("/panel/accesos");
  });

  /* ---------- Restablecer contraseña ----------
     Necesario porque las contraseñas no se pueden recuperar, solo
     cambiar. Genera una nueva y la enseña. */
  router.post("/accesos/:id/password", requiereStaff, async (req, res) => {
    const nueva = passwordTemporal();
    const { error } = await supabase.getAdmin().auth.admin.updateUserById(req.params.id, {
      password: nueva,
    });

    if (error) return res.redirect("/panel/accesos");

    /* Se invalidan las sesiones abiertas: si la contraseña se
       restablece por sospecha, dejar su sesión viva la dejaría
       dentro de todas formas. */
    await auth.revocarTodas(db, req.params.id);

    await auth.auditar(db, {
      actor: { id: req.sesion.user_id, email: null },
      accion: "reset-password",
      entidad: "profiles",
      entidadId: req.params.id,
      req,
    });

    res.render("panel/acceso-form", {
      title: "Contraseña restablecida",
      site: site,
      base: "/panel",
      current: "accesos",
      clientes: [],
      modo: "creado",
      acceso: { email: req.body.email || "el usuario", nombre: "", rol: "" },
      errores: {},
      passwordGenerada: nueva,
    });
  });

  return router;
};
