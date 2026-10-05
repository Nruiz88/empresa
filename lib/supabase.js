/* =========================================================
   Nexo Studio — Cliente de Supabase
   ------------------------------------------------------------
   Un único punto donde se instancia Supabase. Lo usan la web
   (para guardar leads) y el panel (para todo lo demás).

   ⚠️  Sobre las claves y RLS:
     - El cliente "admin" usa SUPABASE_SECRET_KEY y SE SALTA las
       políticas RLS. Es el único que debe poder escribir leads
       desde el servidor.
     - El cliente "público" usa la publishable key y SÍ obedece
       las políticas. Es el que usaría el navegador.
     - La secret key NO debe salir nunca de aquí. Si acaba en una
       plantilla EJS, queda expuesta en el HTML de la web.
   ========================================================= */

const env = require("./env");

let admin = null;
let publico = null;

/** Cliente con permisos totales. SOLO en el servidor. */
function getAdmin() {
  if (!admin) {
    const carga = env.load();
    if (!carga.ok) throw new Error("Falta el .env: " + carga.error);

    const [url, key] = env.require("SUPABASE_URL", "SUPABASE_SECRET_KEY");
    const { createClient } = require("@supabase/supabase-js");

    admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}

/** Cliente sujeto a RLS. Es el que podría usarse en el navegador. */
function getPublico() {
  if (!publico) {
    const carga = env.load();
    if (!carga.ok) throw new Error("Falta el .env: " + carga.error);

    const [url, key] = env.require("SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY");
    const { createClient } = require("@supabase/supabase-js");

    publico = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return publico;
}

/** ¿Hay Supabase configurado? Sirve para no romper la web sin .env */
function disponible() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

/**
 * Cliente que actúa COMO un usuario concreto.
 *
 * Es lo que hace que RLS funcione en el portal de clientes: en vez de
 * consultar con la secret key (que se salta las políticas), se
 * construye un cliente normal y se le pone el access_token del
 * usuario. La base de datos comprueba quién es y decide.
 *
 * Si en algún sitio del portal se usa getAdmin() en lugar de esto,
 * se pierde el aislamiento: es el fallo más grave posible aquí.
 *
 * @param {string} accessToken  Token de Supabase Auth del usuario
 * @param {string} refreshToken  Por si hay que renovarlo
 */
function getClientForToken(accessToken, refreshToken) {
  const [url, key] = env.require("SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY");
  const { createClient } = require("@supabase/supabase-js");

  return createClient(url, key, {
    global: {
      headers: { Authorization: "Bearer " + accessToken },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      // El servidor no gestiona cookies: si Supabase intenta
      // refrescar por su cuenta se lía con el cookie-parser.
      storage: {
        getItem: async () => null,
        setItem: async () => {},
        removeItem: async () => {},
      },
    },
  });
}

module.exports = { getAdmin, getPublico, disponible, getClientForToken };
