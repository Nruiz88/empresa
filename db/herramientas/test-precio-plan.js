const assert = require("assert");
const express = require("express");
const rutasPlanes = require("../../routes/panel-planes");
const precioPlan = require("../../lib/precio-plan");

const validos = [
  ["25000", 25000],
  ["25.000", 25000],
  ["25.000,50", 25000.5],
  ["25000,50", 25000.5],
  ["25000.50", 25000.5],
  ["1.234.567,89", 1234567.89],
  ["1,234.56", 1234.56],
  ["0", 0],
];

for (const [entrada, esperado] of validos) {
  assert.strictEqual(precioPlan(entrada), esperado, `precio inválido para "${entrada}"`);
}

for (const entrada of ["", "1.2.3", "25,00.50", "abc", "1,23,45"]) {
  assert.strictEqual(precioPlan(entrada), null, `se aceptó el importe inválido "${entrada}"`);
}

async function verificarGuardadoDeRuta() {
  const planes = [{
    id: "inicial",
    nombre: "Inicial",
    precio: null,
    moneda: "ARS",
    periodo: "mes",
    aplicaciones: [],
    destacado: false,
    orden: 1,
    activo: true,
  }];

  const db = {
    from(tabla) {
      const consulta = {
        select() { return this; },
        order() {
          return Promise.resolve({ data: tabla === "plans" ? planes : [], error: null });
        },
        update(cambios) {
          this.cambios = cambios;
          return this;
        },
        eq(_columna, id) {
          this.id = id;
          return this;
        },
        maybeSingle() {
          const plan = planes.find((fila) => fila.id === this.id);
          if (plan) Object.assign(plan, this.cambios);
          return Promise.resolve({ data: plan ? { id: plan.id } : null, error: null });
        },
        insert() {
          return Promise.resolve({ error: null });
        },
      };
      return consulta;
    },
  };

  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.sesion = { user_id: "staff-test", csrf_token: "csrf-test" };
    res.render = (_vista, datos) => res.json(datos);
    next();
  });
  app.use("/panel", rutasPlanes({
    db,
    sitio: {},
    requiereStaff: (_req, _res, next) => next(),
  }));

  const servidor = app.listen(0);
  try {
    await new Promise((resolve) => servidor.once("listening", resolve));
    const url = `http://127.0.0.1:${servidor.address().port}/panel/planes`;
    const respuesta = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ precio_inicial: "25.000" }),
    });
    const resultado = await respuesta.json();

    assert.strictEqual(respuesta.status, 200);
    assert.strictEqual(planes[0].precio, 25000);
    assert.match(resultado.aviso, /Guardado: 1 plan/);
    assert.deepStrictEqual(resultado.errores, {});
  } finally {
    await new Promise((resolve, reject) => {
      servidor.close((error) => error ? reject(error) : resolve());
    });
  }
}

verificarGuardadoDeRuta()
  .then(() => console.log("Formato y guardado de precios de planes: correctos."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
