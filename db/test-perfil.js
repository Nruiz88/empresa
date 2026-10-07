/* =========================================================
   Nexo Studio — Perfil: validación y aislamiento
   ------------------------------------------------------------
   Comprueba dos cosas distintas:

   1. QUE LA VALIDACIÓN CORTA (db/test-modulos.js ya cubre el
      aislamiento de suscripciones; aquí el aislamiento de fichas y
      facturación, que son las tablas nuevas).

   2. QUE UN CLIENTE NO PUEDA TOCAR EL RÉGIMEN DE IVA. Esa es la
      regla de negocio más importante del perfil: si no, un cliente
      se cambia a 'exento' y deja de pagar IVA.

   No toca el servidor: es lógica pura más llamadas a la base con el
   cliente admin. La parte de HTTP (que el POST llegue bien) la cubre
   db/test-panel.js.
   ========================================================= */

const supabase = require("../lib/supabase");
const perfil = require("../lib/perfil");
require("../lib/env").load();
const db = supabase.getAdmin();

let ok = 0;
let fallos = 0;
const MARCA = "-test-perfil-";

function comprobar(desc, cond) {
  if (cond) {
    console.log("  ✓ " + desc);
    ok++;
  } else {
    console.log("  ✗ " + desc);
    fallos++;
  }
}
const seccion = (t) => console.log("\n── " + t + " " + "─".repeat(Math.max(0, 46 - t.length)));

let clienteId = null;
let userId = null;

(async () => {
  console.log("\n═══ Perfil: validación y aislamiento ═══\n");

  /* ---------- Validación pura (sin base) ---------- */
  seccion("limpiar los datos antes de guardarlos");

  /* El móvil local: 11 1234-5678 son 10 dígitos y NO llevan el 9 de
     troncal, así que hay que ponérselo. Sin él, wa.me abre el fijo. */
  const { datos: whatsapp } = perfil.prepararFicha({ whatsapp: "11 1234-5678" });
  comprobar("un móvil de 10 dígitos se guarda con el 54 y el 9", whatsapp.whatsapp === "5491112345678");

  /* Y con el 9 ya puesto, que es como lo escribe media gente. Los dos
     tienen que acabar EXACTAMENTE igual: son el mismo número escrito
     de dos maneras. */
  const { datos: conNueve } = perfil.prepararFicha({ whatsapp: "9 11 1234-5678" });
  comprobar("con el 9 de troncal puesto da el mismo número", conNueve.whatsapp === "5491112345678");

  const { datos: conPlus } = perfil.prepararFicha({ whatsapp: "+54 9 11 1234-5678" });
  comprobar("con +54 y espacios también", conPlus.whatsapp === "5491112345678");

  const { datos: conGuion } = perfil.prepararFicha({ whatsapp: "0054-9-11-1234-5678" });
  comprobar("con guiones y prefijo internacional 00", conGuion.whatsapp === "5491112345678");

  const { datos: pegado } = perfil.prepararFicha({ whatsapp: "54 9 11 1234 5678" });
  comprobar("con el 54 pegado y espacios", pegado.whatsapp === "5491112345678");

  const { datos: sinEspacios } = perfil.prepararFicha({ whatsapp: "5491112345678" });
  comprobar("si ya viene completo, no se toca", sinEspacios.whatsapp === "5491112345678");

  /* Un teléfono de casa de otro país no debe llevar el 54 por delante. */
  const { datos: extranjero } = perfil.prepararFicha({ whatsapp: "+44 20 7123 4567" });
  comprobar("un número extranjero no se le cuela el 54",
    extranjero.whatsapp === "442071234567");

  /* Y el fijo con su código de área, que son 12 dígitos y ya es
     internacional: es el 54 sin el 9 de troncal. Esta línea es la
     que NO hay que "arreglar": si alguien le mete un 9, wa.me
     abre un número que no es el de ese cliente. */
  const { datos: fijo } = perfil.prepararFicha({ whatsapp: "+54 11 4321-1234" });
  comprobar("un fijo con el 54 y sin el 9 se deja como está",
    fijo.whatsapp === "541143211234");

  /* Un fijo sin código de área son 8 dígitos y no hay forma de saber
     a qué zona es. Se guarda tal cual, que es lo menos malo:
     inventar un área sería peor. */
  const { datos: fijoSinArea } = perfil.prepararFicha({ whatsapp: "4321-1234" });
  comprobar("un fijo sin área se guarda tal cual",
    fijoSinArea.whatsapp === "43211234");

  seccion("rechazar lo que no es una dirección");

  const { errores: e1 } = perfil.prepararFicha({ web: "no es una web" });
  comprobar("una web basura da error", Boolean(e1.web));

  const { errores: e2 } = perfil.prepararFicha({ instagram: "hola que tal" });
  comprobar("un Instagram con espacios da error", Boolean(e2.instagram));

  const { errores: e3 } = perfil.prepararFicha({ web: "panaderia.com" });
  comprobar("una web sin https vale igual", !e3.web);

  seccion("los enlaces libres");

  const { datos: enlacesOk, errores: e4 } = perfil.prepararFicha({
    enlaces: "Google|https://g.page/x\nCarta|https://ejemplo.com/carta",
  });
  comprobar("acepta varios, uno por línea", enlacesOk.enlaces.length === 2);
  comprobar("guarda etiqueta y url", enlacesOk.enlaces[0].etiqueta === "Google");
  comprobar("y no da error", !e4.enlaces);

  const { errores: e5 } = perfil.prepararFicha({ enlaces: "Sin barravertical" });
  comprobar("una línea sin | da error", Boolean(e5.enlaces));

  const { errores: e6 } = perfil.prepararFicha({ enlaces: "X|no-es-una-url" });
  comprobar("una url mala da error", Boolean(e6.enlaces));

  const { errores: e7 } = perfil.prepararFicha({ enlaces: "|https://x.com" });
  comprobar("sin etiqueta da error", Boolean(e7.enlaces));

  const muchos = Array.from({ length: 25 }, (_, i) => "E" + i + "|https://x.com").join("\n");
  const { errores: e8 } = perfil.prepararFicha({ enlaces: muchos });
  comprobar("más de 20 enlaces da error (no se traga un textarea enorme)", Boolean(e8.enlaces));

  seccion("ignorar campos que no existen");

  const { datos: basura } = perfil.prepararFicha({
    ciudad: "Madrid",
    hack: "<script>alert(1)</script>",
    role: "admin",
    client_id: "otro-cliente",
  });
  comprobar("un campo desconocido no se guarda", basura.hack === undefined);
  comprobar("ni intenta cambiar de cliente", basura.client_id === undefined);

  /* ---------- Facturación ---------- */
  seccion("facturación: lo obligatorio");

  const { errores: f1 } = perfil.prepararFacturacion({ email: "a@b.com" }, false);
  comprobar("sin razón social da error", Boolean(f1.razon_social));

  const { errores: f2 } = perfil.prepararFacturacion({ razon_social: "X S.L." }, false);
  comprobar("sin email da error", Boolean(f2.email));

  const { errores: f3 } = perfil.prepararFacturacion(
    { razon_social: "X S.L.", email: "esto-no-es-un-email" },
    false
  );
  comprobar("con email malo da error", Boolean(f3.email));

  const { errores: f4 } = perfil.prepararFacturacion(
    { razon_social: "X", email: "a@b.com", codigo_postal: "2801" },
    false
  );
  comprobar("con CP de 4 cifras da error", Boolean(f4.codigo_postal));

  const { errores: f5 } = perfil.prepararFacturacion(
    { razon_social: "X", email: "a@b.com", codigo_postal: "28013" },
    false
  );
  comprobar("con CP de 5 no da error", !f5.codigo_postal);

  /* ---------- EL IVA ---------- */
  seccion("el IVA solo lo cambia el equipo");

  const { datos: ivaCliente, aviso: aviso1 } = perfil.prepararFacturacion(
    { razon_social: "X", email: "a@b.com", regimen_iva: "exento" },
    false
  );
  comprobar("un cliente NO puede poner 'exento'", ivaCliente.regimen_iva === undefined);
  comprobar("pero se guarda el resto y se le avisa", Boolean(aviso1));

  const { datos: ivaStaff } = perfil.prepararFacturacion(
    { razon_social: "X", email: "a@b.com", regimen_iva: "exento" },
    true
  );
  comprobar("el staff sí puede ponerlo", ivaStaff.regimen_iva === "exento");

  const { datos: ivaBasura } = perfil.prepararFacturacion(
    { razon_social: "X", email: "a@b.com", regimen_iva: "no-existe" },
    true
  );
  comprobar("un régimen que no está en la lista se ignora", ivaBasura.regimen_iva === undefined);

  /* ---------- RLS en la base ---------- */
  seccion("RLS sobre fichas y facturación");

  const { data: cli, error: eCli } = await db
    .from("clients")
    .insert({ nombre: "P " + MARCA, empresa: "P " + MARCA, email: MARCA + "x@ejemplo.com" })
    .select("id")
    .single();
  if (eCli) throw new Error("cliente: " + eCli.message);
  clienteId = cli.id;

  const { data: usr, error: eUsr } = await db.auth.admin.createUser({
    email: MARCA + "x@ejemplo.com",
    password: "PruebaPerfil123",
    email_confirm: true,
  });
  if (eUsr) throw new Error("auth: " + eUsr.message);
  userId = usr.user.id;

  await db.from("profiles").insert({
    id: userId, rol: "client", client_id: clienteId, nombre: "P", activo: true,
  });

  /* Un segundo cliente, para ver si el primero se cuela en sus datos. */
  const { data: cli2 } = await db
    .from("clients")
    .insert({ nombre: "P2 " + MARCA, empresa: "P2 " + MARCA, email: MARCA + "y@ejemplo.com" })
    .select("id")
    .single();
  await db.from("fichas").insert({ client_id: cli2.id, ciudad: "Ciudad del otro" });

  /* Sesión real del cliente, para que RLS la aplique. */
  const { data: link } = await db.auth.admin.generateLink({
    type: "magiclink",
    email: MARCA + "x@ejemplo.com",
  });
  const { data: verif, error: eVerif } = await supabase
    .getPublico()
    .auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (eVerif) throw new Error("verifyOtp: " + eVerif.message);

  const comoCliente = supabase.getClientForToken(verif.session.access_token);

  await db.from("fichas").insert({ client_id: clienteId, ciudad: "Mi ciudad", cif: "B99999999" });

  const { data: ve } = await comoCliente.from("fichas").select("ciudad,cif");
  comprobar("el cliente ve su ficha", (ve || []).length === 1);
  comprobar("y es la suya", ve && ve[0].ciudad === "Mi ciudad");
  comprobar("no ve la del otro (solo hay una fila)", ve && ve[0].ciudad !== "Ciudad del otro");

  /* Puede editar la suya: son sus datos. */
  const { data: upd } = await comoCliente
    .from("fichas")
    .update({ ciudad: "Corregida" })
    .eq("client_id", clienteId)
    .select();
  comprobar("puede corregir su propia ficha", (upd || []).length === 1);

  /* Pero no puede meter datos en la ficha de otro. */
  const { data: intruso } = await comoCliente
    .from("fichas")
    .upsert({ client_id: cli2.id, ciudad: "Mia ahora" }, { onConflict: "client_id" })
    .select();
  comprobar("no puede escribir en la ficha de otro", (intruso || []).length === 0);

  const { data: comprueba } = await db
    .from("fichas")
    .select("ciudad")
    .eq("client_id", cli2.id)
    .single();
  comprobar("y de verdad no se cambió", comprueba && comprueba.ciudad === "Ciudad del otro");

  /* Facturación: ve la suya, no la de otro. */
  await db.from("facturacion").insert({ client_id: clienteId, razon_social: "A", email: "a@b.com" });
  await db.from("facturacion").insert({ client_id: cli2.id, razon_social: "B", email: "b@b.com" });

  const { data: fac } = await comoCliente.from("facturacion").select("razon_social");
  comprobar("ve su facturación", (fac || []).length === 1);
  comprobar("y solo la suya", fac && fac[0].razon_social === "A");

  const { data: facIntruso } = await comoCliente
    .from("facturacion")
    .update({ razon_social: "Robada" })
    .eq("client_id", cli2.id)
    .select();
  comprobar("no puede cambiar la facturación de otro", (facIntruso || []).length === 0);

  /* La función de perfil completo. */
  seccion("perfil_completo()");

  const { data: completo, error: eCompleto } = await db.rpc("perfil_completo", {
    cliente_uuid: clienteId,
  });
  comprobar("no da error", !eCompleto);
  comprobar("trae el cliente", completo && completo.cliente && completo.cliente.id === clienteId);
  comprobar("trae la ficha", completo && completo.ficha && completo.ficha.ciudad === "Corregida");
  comprobar("trae la facturación", completo && completo.facturacion && completo.facturacion.razon_social === "A");
  comprobar("dice que está completo", completo && completo.completo === true);
  comprobar("no se cuela el client_id de la ficha", !completo.ficha.client_id);

  /* Un cliente sin ficha no debe reventar. */
  const { data: vacio, error: eVacio } = await db.rpc("perfil_completo", {
    cliente_uuid: "00000000-0000-0000-0000-000000000000",
  });
  comprobar("sin cliente devuelve null, no error", eVacio === null || vacio === null);

  /* Lo que falta por rellenar. */
  seccion("pendientes()");

  const { data: completo2 } = await db.rpc("perfil_completo", { cliente_uuid: clienteId });
  const faltan = perfil.pendientes(completo2);
  comprobar("faltan cosas que no se rellenaron", Array.isArray(faltan) && faltan.length > 0);
  comprobar("y avisa del CIF si no está", completo2.ficha.cif === null ? faltan.includes("el CIF") : true);

  console.log("\n" + "─".repeat(54));
  if (fallos) {
    console.log(`✗ ${fallos} de ${ok + fallos} fallan.\n`);
    process.exit(1);
  }
  console.log(`✓ Las ${ok} comprobaciones pasan.`);
  console.log("  Un cliente solo ve lo suyo y no puede tocar el IVA.\n");
})()
  .catch((e) => {
    console.error("\n✗ " + e.message + "\n");
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      if (clienteId) {
        await db.from("fichas").delete().eq("client_id", clienteId);
        await db.from("facturacion").delete().eq("client_id", clienteId);
        await db.from("clients").delete().eq("id", clienteId);
      }
      const { data: otros } = await db
        .from("clients")
        .select("id")
        .ilike("empresa", "%" + MARCA + "%");
      for (const o of otros || []) {
        await db.from("fichas").delete().eq("client_id", o.id);
        await db.from("facturacion").delete().eq("client_id", o.id);
        await db.from("clients").delete().eq("id", o.id);
      }
      if (userId) await db.auth.admin.deleteUser(userId);
    } catch (e) {
      console.error("(limpieza: " + e.message + ")");
    }
  });
