const url = process.argv[2];
const metodo = process.argv[3] || "GET";
const cuerpo = process.argv[4] || "";

(async () => {
  try {
    const res = await fetch(url, {
      method: metodo,
      headers: cuerpo ? { "content-type": "application/json" } : {},
      body: cuerpo || undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    });
    const texto = await res.text();
    console.log(metodo + " " + url);
    console.log("  -> HTTP " + res.status);
    if (texto) console.log("  -> " + texto.slice(0, 200).replace(/\s+/g, " "));
  } catch (e) {
    console.log(metodo + " " + url);
    console.log("  -> ERROR " + (e && e.message ? e.message : e));
  }
})();