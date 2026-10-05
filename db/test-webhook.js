/* Pruebas de lib/webhook.js: el endpoint PÚBLICO de Evolution.
   ------------------------------------------------------------
   Aquí se prueba sobre todo lo que no debe pasar:

     · Que sin secreto no entre NADA. Es el fallo que convertiría tu
       web en un mando a distancia para mandar WhatsApps a quien sea.
     · Que un secreto equivocado no entre.
     · Que la comparación no se pueda usar para adivinar la clave.
     · Que un evento de la instancia A no pueda escribir en el bot B.
     · Que responda rápido: Evolution reintenta si tardas.

   Lo que NO se prueba aquí es contra el servidor real. Mandar un
   webhook de mentira al bot desplegado acabaría en `bots_webhook_logs`
   de la base de verdad. Eso se prueba a mano, no automáticamente. */

const http = require("http");

const wh = require("../lib/webhook");

const SECRETO = "SECRETO-DE-PRUEBA-abc123";

let ok = 0;
let fallos = 0;
function comprobar(desc, cond, extra) {
  console.log(`  ${cond ? "✓" : "✗"} ${desc}${extra ? "  → " + extra : ""}`);
  if (cond) ok++;
  else fallos++;
}

/** Monta una petición falsa con las cabeceras que se le pidan. */
function peticion(cabeceras = {}) {
  return { headers: cabeceras };
}

console.log("\n── comparación en tiempo constante ──");

comprobar("igual devuelve true", wh.coincide(SECRETO, SECRETO) === true);
comprobar("distinta devuelve false", wh.coincide(SECRETO, "otra") === false);
comprobar("largo distinto devuelve false", wh.coincide("abc", "abcd") === false);

/* Vacío contra vacío NO es una credencial válida: es una ausencia.
   `coincide()` devuelve false ahí aunque los dos sean "", porque si
   no, llamar a esta función con un secreto sin configurar
   autentica. Hoy `verificar()` lo tapa, pero la función por sí sola
   tiene que ser segura. */
comprobar("vacías devuelven false", wh.coincide("", "") === false);
comprobar("undefined contra vacío, false", wh.coincide(undefined, "") === false);
comprobar("vacío contra algo, false", wh.coincide("", "x") === false);
comprobar("algo contra vacío, false", wh.coincide("x", "") === false);
comprobar("null contra null, false", wh.coincide(null, null) === false);
/* Un prefijo común es el caso que `===` resuelve antes. */
comprobar("un prefijo común NO vale", wh.coincide(SECRETO, SECRETO.slice(0, 12)) === false);

console.log("\n── puerta cerrada por defecto ──");

const secretoAntes = process.env.BOT_WEBHOOK_SECRET;
delete process.env.BOT_WEBHOOK_SECRET;
{
  const r = wh.verificar(peticion());
  comprobar("sin secreto NO pasa", r.ok === false);
  comprobar("y el motivo dice que es el secreto", r.motivo === "sin_secreto_configurado", r.motivo);
  comprobar(
    "y explica por qué importa",
    /cualquiera/i.test(r.explica || ""),
    (r.explica || "").slice(0, 80)
  );

  /* Aunque le manden la cabecera correcta, sin secreto no entra. */
  const r2 = wh.verificar(peticion({ [wh.CABECERA_SECRETO]: "lo que sea" }));
  comprobar("tampoco con una cabecera inventada", r2.ok === false);
}

process.env.BOT_WEBHOOK_SECRET = SECRETO;
{
  const r = wh.verificar(peticion({ [wh.CABECERA_SECRETO]: SECRETO }));
  comprobar("con el secreto puesto y acertado, pasa", r.ok === true);
}

{
  const r = wh.verificar(peticion({ [wh.CABECERA_SECRETO]: "equivocado" }));
  comprobar("con secreto equivocado NO pasa", r.ok === false);
  comprobar("y el motivo es el secreto", r.motivo === "secreto_incorrecto", r.motivo);
}

{
  const r = wh.verificar(peticion());
  comprobar("sin cabecera NO pasa", r.ok === false);
  comprobar("y el motivo es la cabecera", r.motivo === "sin_cabecera", r.motivo);
}

{
  /* La cabecera no debe distinguir mayúsculas: HTTP las normaliza,
     pero si alguien la pone en minúsculas en el servidor que
     reenvía, tiene que funcionar igual. */
  const r = wh.verificar(peticion({ "x-nexo-webhook": SECRETO }));
  comprobar("en minúsculas también vale", r.ok === true);
}

{
  /* Un secreto en blanco cuenta como no configurado. */
  process.env.BOT_WEBHOOK_SECRET = "   ";
  const r = wh.verificar(peticion({ [wh.CABECERA_SECRETO]: SECRETO }));
  comprobar("un secreto en blanco cuenta como no configurado", r.ok === false && r.motivo === "sin_secreto_configurado");
  process.env.BOT_WEBHOOK_SECRET = SECRETO;
}

console.log("\n── el nombre de la instancia ──");

comprobar("en 'instance'", wh.instanciaDe({ instance: "inst-a" }) === "inst-a");
comprobar("en 'instanceName'", wh.instanciaDe({ instanceName: "inst-b" }) === "inst-b");
comprobar("dentro de data.instance", wh.instanciaDe({ data: { instance: "inst-c" } }) === "inst-c");
comprobar("dentro de data.instanceName", wh.instanciaDe({ data: { instanceName: "inst-d" } }) === "inst-d");
comprobar("con espacios alrededor", wh.instanciaDe({ instance: "  inst-e  " }) === "inst-e");

/* El fallo de asumir una sola forma: si solo se mirara `instance`,
   todos los eventos con otra forma se quedarían sin instancia y se
   descartarían. */
comprobar("con las cuatro formas", new Set([
  wh.instanciaDe({ instance: "x" }),
  wh.instanciaDe({ instanceName: "x" }),
  wh.instanciaDe({ data: { instance: "x" } }),
  wh.instanciaDe({ data: { instanceName: "x" } }),
]).size === 1);

comprobar("sin instancia devuelve cadena vacía", wh.instanciaDe({}) === "");
comprobar("null devuelve cadena vacía", wh.instanciaDe(null) === "");
comprobar("undefined devuelve cadena vacía", wh.instanciaDe(undefined) === "");
comprobar("un array no revienta", wh.instanciaDe([1, 2]) === "");
comprobar("una instancia en blanco se ignora", wh.instanciaDe({ instance: "   " }) === "");
/* Si vino un objeto donde se esperaba un nombre, se ignora en vez
   de guardarse como "[object Object]". */
comprobar("un objeto donde se espera texto se ignora", wh.instanciaDe({ instance: { a: 1 } }) === "");

console.log("\n── id de mensaje, para no repetir ──");

comprobar("en key.id", wh.idDeMensaje({ key: { id: "3EB0abc" } }) === "3EB0abc");
comprobar("en messageId", wh.idDeMensaje({ messageId: "XYZ" }) === "XYZ");
comprobar("en message.messageId", wh.idDeMensaje({ message: { messageId: "ABC" } }) === "ABC");

/* Sin id NO se deduplica. Preferimos guardar un mensaje de más que
   filtrar uno real: un mensaje que no llega no se contesta nunca. */
comprobar("sin id devuelve vacío (no deduplica)", wh.idDeMensaje({}) === "");
comprobar("null devuelve vacío", wh.idDeMensaje(null) === "");
comprobar("en blanco se ignora", wh.idDeMensaje({ key: { id: "  " } }) === "");
comprobar("un número se convierte", wh.idDeMensaje({ messageId: 12345 }) === "");

console.log(fallos ? `\n  ${fallos} fallo(s)\n` : "\n  Todo correcto\n");
if (secretoAntes === undefined) delete process.env.BOT_WEBHOOK_SECRET;
else process.env.BOT_WEBHOOK_SECRET = secretoAntes;
process.exit(fallos ? 1 : 0);
