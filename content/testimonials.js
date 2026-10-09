/* =========================================================
   Shopcito — Testimonios (fuente única de verdad)
   ------------------------------------------------------------
   ⚠️  DATOS DE EJEMPLO — NO SON REALES ⚠️
   Los testimonios, los nombres y los cargos son inventados.

   ⚠️  RIESGO REAL, no teórico: un testimonio falso en una web
   comercial es publicidad engañosa (art. 137 LSSI-CE) y, si el
   cliente existe con otro nombre, falta al honor. Antes de
   publicar:
     1. Consigue el testimonio por escrito (email vale).
     2. Pide permiso para usar nombre, cargo y empresa.
     3. Guarda el email: es la prueba de que la cita es real.

   Campos:
     quote      {string}  La cita textual
     name       {string}  Nombre y apellido
     role       {string}  Cargo y empresa
     avatar     {number}  1-3, variante de color .avatar-N
     initials   {string}  Letras del avatar
   ========================================================= */

module.exports = [
  {
    quote:
      "Pasamos de una web que nadie visitaba a un canal que nos aporta la mitad de los pedidos. El proceso fue claro y entregaron en la fecha prometida.",
    name: "Laura Méndez",
    role: "Directora · Mercado Norte",
    avatar: 1,
    initials: "LM",
  },
  {
    quote:
      "Presupuesto cerrado, comunicación excelente y un producto que nuestro equipo adoptó desde el primer día. Repetiremos.",
    name: "Carla Vidal",
    role: "COO · Finvia",
    avatar: 3,
    initials: "CV",
  },
  {
    quote:
      "Nos ocupasteis de las actualizaciones, las copias y las incidencias. Esos problemas ya no son los nuestros.",
    name: "Dr. Rubén Ortiz",
    role: "Fundador · Clínica Salud+",
    avatar: 2,
    initials: "DR",
  },
];