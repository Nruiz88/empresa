/* =========================================================
   Nexo Studio — Parser de cookies (sin dependencias)
   ------------------------------------------------------------
   Solo necesitamos leer una cookie (la de sesión del panel).
   Meter 'cookie-parser' por eso sería una dependencia entera.

   Limitación consciente: no decodifica %XX. Las cookies que
   emitimos son tokens base64url y JWT, que no llevan caracteres
   problemáticos. Si algún día se guarda algo con acentos o
   espacios, hay que usar decodeURIComponent aquí.
   ========================================================= */

module.exports = function cookieParser(req, res, next) {
  req.cookies = Object.create(null);

  const header = req.headers.cookie;
  if (header) {
    for (const part of header.split(";")) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      const key = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (key) {
        try {
          req.cookies[key] = decodeURIComponent(value);
        } catch {
          req.cookies[key] = value;
        }
      }
    }
  }

  /* res.cookie es de Express, pero lo dejamos por si se usa sin él */
  res.cookie = function (name, value, opts) {
    const parts = [name + "=" + encodeURIComponent(value)];
    if (opts && opts.maxAge) parts.push("Max-Age=" + Math.floor(opts.maxAge / 1000));
    if (opts && opts.path) parts.push("Path=" + opts.path);
    if (opts && opts.httpOnly) parts.push("HttpOnly");
    if (opts && opts.secure) parts.push("Secure");
    if (opts && opts.sameSite) parts.push("SameSite=" + opts.sameSite);

    const prev = res.getHeader("Set-Cookie");
    const cookie = parts.join("; ");
    res.setHeader("Set-Cookie", prev ? [].concat(prev, cookie) : cookie);
    return res;
  };

  next();
};
