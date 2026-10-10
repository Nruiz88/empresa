/* =========================================================
   Nexo Studio — Crear un usuario
   ------------------------------------------------------------
   El panel NO tiene registro abierto, a propósito. Las cuentas
   se crean aquí, desde la línea de comandos.

   Uso:
     node db/create-user.js --email tucorreo@dominio.com --nombre "Tu Nombre" --staff
     node db/create-user.js --email cliente@empresa.com --nombre "Cliente" --empresa "Empresa SL" --cliente

   Opciones:
     --email     obligatorio
     --nombre    obligatorio
     --password  si se omite, se genera una segura y se imprime
     --staff     cuenta del equipo (ve todo)
     --cliente   cuenta de cliente (solo lo suyo)
     --empresa   nombre de la empresa, solo con --cliente
                 Crea la ficha en 'clients' si no existe

   Por qué por consola y no con un formulario: un alta por web
   sería una puerta abierta. Quien puede crear usuarios puede
   crear administradores.
   ========================================================= */

const crypto = require("crypto");
const env = require("../../lib/env");

function arg(nombre) {
  const i = process.argv.indexOf("--" + nombre);
  if (i === -1) return null;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

function generarPassword() {
  /* 18 caracteres sin vocales ambiguas ni símbolos que den problemas */
  const alfabeto = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(18);
  let out = "";
  for (const b of bytes) out += alfabeto[b % alfabeto.length];
  return out;
}

async function main() {
  const carga = env.load();
  if (!carga.ok) {
    console.error("\n✗ " + carga.error + "\n");
    process.exit(1);
  }

  env.require("SUPABASE_URL", "SUPABASE_SECRET_KEY");

  const email = String(arg("email") || "").trim().toLowerCase();
  const nombre = String(arg("nombre") || "").trim();
  const empresa = arg("empresa");
  const quiereStaff = Boolean(arg("staff"));
  const quiereCliente = Boolean(arg("cliente"));
  const resetear = Boolean(arg("resetear"));

  if (!email) {
    console.error("\nUso:\n  node db/create-user.js --email correo@dominio.com --nombre \"Nombre\" --staff\n");
    console.error("  node db/create-user.js --email correo@dominio.com --resetear --password nueva\n");
    process.exit(1);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    console.error("\n✗ El email no tiene un formato válido\n");
    process.exit(1);
  }

  /* -------------------------------------------------------------
     Resetear contraseña de un usuario que YA existe.
     No toca el perfil ni el rol: solo la contraseña.
     ------------------------------------------------------------- */
  if (resetear) {
    const supabaseR = require("../../lib/supabase");
    const cliente = supabaseR.getAdmin();

    // Buscar por email: la API no filtra, hay que traer la página
    let encontrado = null;
    for (let pagina = 1; pagina <= 10 && !encontrado; pagina++) {
      const { data, error } = await cliente.auth.admin.listUsers({ page: pagina, perPage: 200 });
      if (error) {
        console.error("\n✗ No se pudo listar usuarios: " + error.message + "\n");
        process.exit(1);
      }
      encontrado = (data.users || []).find(
        (u) => String(u.email || "").toLowerCase() === email
      );
      if (!(data.users || []).length) break;
    }

    if (!encontrado) {
      console.error("\n✗ No existe ningún usuario con el email " + email + "\n");
      process.exit(1);
    }

    const nueva = String(arg("password") || generarPassword());
    const { error: errUp } = await cliente.auth.admin.updateUserById(encontrado.id, {
      password: nueva,
    });

    if (errUp) {
      console.error("\n✗ No se pudo cambiar la contraseña: " + errUp.message + "\n");
      process.exit(1);
    }

    console.log("\n✓ Contraseña actualizada: " + email);
    if (!arg("password")) {
      console.log("\n──────────────────────────────────────────────");
      console.log("  Nueva contraseña: " + nueva);
      console.log("  (se muestra una sola vez)");
      console.log("──────────────────────────────────────────────\n");
    }
    process.exit(0);
  }

  if (!nombre) {
    console.error("\n✗ Falta --nombre\n");
    process.exit(1);
  }
  if (quiereStaff === quiereCliente) {
    console.error("\n✗ Indica UNO de estos dos: --staff o --cliente\n");
    process.exit(1);
  }

  const password = String(arg("password") || generarPassword());
  const generada = !arg("password");

  const supabase = require("../../lib/supabase");
  const admin = supabase.getAdmin();

  /* --- Usuario en Supabase Auth --- */
  const { data: creado, error: errAuth } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // sin esto habría que confirmar por email
  });

  if (errAuth) {
    if (/already/i.test(errAuth.message)) {
      console.error("\n✗ Ya existe un usuario con ese email.\n");
    } else {
      console.error("\n✗ No se pudo crear el usuario: " + errAuth.message + "\n");
    }
    process.exit(1);
  }

  const userId = creado.user.id;
  console.log("✓ Usuario creado en Auth");

  /* --- Ficha de cliente, si aplica --- */
  let clientId = null;
  if (quiereCliente) {
    const nombreEmpresa = String(empresa || nombre).trim();

    // Buscar si ya existe la empresa antes de duplicarla
    const { data: existentes } = await admin
      .from("clients")
      .select("id")
      .ilike("empresa", nombreEmpresa)
      .limit(1);

    if (existentes && existentes.length) {
      clientId = existentes[0].id;
      console.log("✓ Empresa reutilizada: " + nombreEmpresa);
    } else {
      const { data: nuevoCliente, error: errCli } = await admin
        .from("clients")
        .insert({ nombre: nombre, empresa: nombreEmpresa, email })
        .select("id")
        .single();

      if (errCli) {
        console.error("\n✗ Se creó el usuario pero falló la ficha de cliente: " + errCli.message);
        console.error("  El usuario existe en Auth pero sin perfil. Revísalo a mano.\n");
        process.exit(1);
      }
      clientId = nuevoCliente.id;
      console.log("✓ Ficha de cliente creada: " + nombreEmpresa);
    }
  }

  /* --- Perfil con el rol --- */
  const { error: errPerfil } = await admin.from("profiles").insert({
    id: userId,
    rol: quiereStaff ? "staff" : "client",
    client_id: clientId,
    nombre,
    activo: true,
  });

  if (errPerfil) {
    console.error("\n✗ No se pudo crear el perfil: " + errPerfil.message);
    console.error("  El usuario existe en Auth pero sin rol, así que no puede entrar al panel.");
    console.error("  Solución: borra el usuario de Auth y vuelve a ejecutar el comando.\n");
    process.exit(1);
  }

  console.log("✓ Perfil creado con rol: " + (quiereStaff ? "staff" : "client"));

  console.log("\n──────────────────────────────────────────────");
  console.log("  Email:      " + email);
  console.log("  Contraseña: " + password);
  if (generada) {
    console.log("\n  ⚠️  Esta contraseña se muestra UNA sola vez.");
    console.log("     Guárdala ahora o créala tú con --password");
  }
  console.log("──────────────────────────────────────────────\n");
  console.log("  Entra en:  http://127.0.0.1:3000/panel/login\n");

  process.exit(0);
}

main().catch((err) => {
  console.error("\n✗ " + err.message + "\n");
  process.exit(1);
});
