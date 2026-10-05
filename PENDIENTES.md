# Pendientes

Lista de trabajo **compartida**: se sube a git a propósito, para que
cualquiera que abra el repo sepa qué falta sin depender de una
conversación previa.

Este archivo sustituye a la sección 7 de `NOTAS-LOCAL.md`, que era la
única que llevaba esta lista y era local de una máquina. El motivo del
cambio está abajo, en "Por qué esto existe".

Complementos, no sustitutos:

- `npm run estado` — lo que HAY ahora (rutas, tablas, migraciones aplicadas).
- `npm test` — lo que FUNCIONA.
- Los marcadores `TODO` en el código, que apuntan a la línea exacta.

---

## Bloqueantes para producción

- [ ] **Elegir el dominio y sustituir `midominio.com`.** Los dos
      dominios de marcador están en `lib/site.js` (`url` y `panelUrl`),
      que es el sitio a editar. `.env` lo puede sobrescribir
      (`SITE_URL`, `PANEL_URL`). Al arrancar en producción con el
      marcador, `server.js` y `panel.js` avisan por consola.
      ⚠️ `SITE_URL` no es solo para correos: de ahí se deducen los
      subdominios de los servicios (`bot.<dominio>`). Si se queda en
      `127.0.0.1`, el botón "Abrir" del portal lleva al localhost del
      cliente y no da error visible. Ver COOLIFY.md.
      Mientras tanto, el plan es: web en `midominio.com`, panel en
      `panel.midominio.com`, bot en `bot.midominio.com`.
- [ ] **HTTPS.** Todo es `127.0.0.1` sin TLS. La cookie `Secure` ya se
      activa sola con `NODE_ENV=production`.
- [ ] **Rotar las credenciales de Supabase** que se han pegado en chats.
      Borrarlas del historial no sirve: hay que hacerlo en
      Settings > API y las de aquí son distintas de las nuevas.
- [x] **Guía de despliegue.** Hecha: `COOLIFY.md`, con los dos
      servicios (web+panel, bot), sus dominios, qué variables van en
      cada uno y las tres cosas que rompen el acceso al bot en
      silencio.
      Lo que ya estaba: `panel.js` carga el `.env` antes de leer
      `PORT` y respeta `PANEL_HOST`.
      ⚠️ Con el panel en subdominio, `panel.js` no hace falta: la
      cookie host-only ya aísla. La guía explica por qué.
      Lo que sigue pendiente: ejecutar el despliegue de verdad.

## Funcional

- [ ] **Facturas con numeración, IVA y PDF.** El plazo de pago ya está
      resuelto (ver "Plazo de pago" más abajo). Lo que falta es la tabla
      `facturas` y `factura_lineas` encima de `cobros`, la serie de
      numeración y el reparto de IVA.
      El cimiento ya está: la tabla `facturacion` (migración 010) guarda
      razón social, NIF, dirección, email, IBAN y régimen de IVA, y el
      cliente lo rellena y lo corrige en `/panel/perfil`.
      El régimen de IVA ya está como dato guardado, no como porcentaje
      calculado, porque hay tipos (exento, recargo de equivalencia) que
      un número no representa.
      `TODO` en `db/migrations/004_cobros.sql`.
- [ ] **Validar el CIF contra la AEAT.** Ahora se guarda el texto sin
      comprobar nada. La API de la AEAT necesita certificado digital, que
      es un trámite aparte.
- [x] **Plazo de pago de 20 días.** Hecho: vence a 20 días de la
      emisión (no el día 20 del mes), el día del vencimiento se puede
      pagar entero, y no hay recargo ni interés por retraso. Vivía en
      `DIAS_VENCIMIENTO`, que además fijaba un día del mes y por eso
      bloqueaba al instante cuando se generaba tarde.
      `DIAS_VENCIMIENTO` en `lib/cobros-mensuales.js`.
- [ ] **Generar los cobros del mes sin que nadie pulse un botón.**
      `/panel/cobros/generar` ya calcula e inserta; falta el ejecutor
      (cron externo o `node-cron`) y decidir quién firma la auditoría
      cuando no hay `req.sesion`.
      `TODO` en `routes/panel-cobros.js`.
- [ ] **Pago en línea.** El portal es de solo lectura y no cobra. Hay
      que elegir pasarela (Stripe, Redsys, Bizum…) y montar el
      webhook, que tiene que escribir por cliente admin.
      `TODO` en `routes/panel-portal.js`.
- [ ] **Correo.** No hay nada: ni `nodemailer`, ni SMTP en el código. Las
      contraseñas se dan en mano, mostradas una sola vez. Las variables
      ya están en `.env.example`, y el modo "consola" que se describe
      ahí **todavía no existe**.
      `TODO` en `routes/panel-accesos.js`.
- [ ] **Conectar el bot de verdad.** Acceso, aislamiento de cookies y
      renovación del token: hechos y con tests (37 comprobaciones en
      `db/test-acceso-servicio.js`). El destino ya se deduce del
      dominio (`bot.<tu-dominio>`), sin dominio inventado guardado en
      la base.
      Falta lo de dentro: sustituir la ruta de ejemplo `/mi-bot` por
      las del bot real (Evolution API, agenda de turnos). Las tablas
      `bots_*` de la migración 011 ya existen con RLS cerrada.
      Para desplegar, ver `COOLIFY.md`. Ojo con el `SERVICE_SECRET`
      compartido: es lo que más silenciosamente rompe el acceso.
- [ ] **Caducar suscripciones.** Las que no tienen `termina_en` se
      renuevan solas para siempre. Hay que poner algo que cierre las no
      pagadas, o decidir que es manual.
- [ ] **Documentos y credenciales del cliente** (dominio, analítica,
      hosting). Requiere decidir almacenamiento aparte de Supabase.
- [ ] **Pantalla de historial.** `audit_log` se escribe desde
      `lib/auth.js` (`auditar()`) y no hay ninguna ruta ni vista que la
      lea. El índice ya existe.
      `TODO` en `routes/panel.js`.

## Limpieza

- [ ] **Borrar los datos `[demo]`** y el cliente de prueba.
      `npm run seed:limpiar` ya los busca por la marca `[demo]` **y
      por los emails de ejemplo**, así que también se lleva el
      `cliente@ejemplo.com` que se creó a mano. Ojo: no borra las
      cuentas de Supabase Auth, quedan inactivas sin empresa.
- [ ] **Sustituir todo el contenido inventado**: textos, casos,
      testimonios y métricas. Los testimonios tienen aviso de riesgo
      legal en `content/testimonials.js`: publicar uno sin permiso real
      de quien aparece es publicidad engañosa (art. 137 LSSI-CE).
- [ ] **Sacar de las vistas lo que está en `content/`.** Hay cifras y
      precios hardcodeados en `views/index.ejs`,
      `views/partials/page-hero.ejs` y `views/precios.ejs`, duplicando
      `content/stats.js`. Contradice lo que dice `content/tech.js`.
- [ ] **Crear `content/precios.js`.** Los precios no están en `content/`,
      así que el contenido más comercial es el menos editable.

---

## Por qué esto existe

Hasta ahora el backlog vivía solo en la sección 7 de `NOTAS-LOCAL.md`,
un archivo en `.gitignore`. Dos consecuencias:

1. Se quedó viejo sin que nadie se diera cuenta. Daba por pendientes la
   generación de cobros mensuales y el cambio de contraseña del
   cliente, **los dos hechos y probados**.
2. Si ese archivo se hubiera perdido, la lista de trabajo se habría
   perdido con él. En el código no había ni un `TODO`.

Por eso está aquí, versionado, y por eso hay marcadores `TODO` en los
sitios donde el trabajo se haría.

## Decisiones de negocio ya tomadas

No son pendientes: son cosas que alguien decidió y que el código ya
respeta. Están aquí para que no se vuelva a abrir en una conversación.

- **Plazo de pago: 20 días desde la emisión.** Vencimiento = fecha de
  emisión + 20 días, no el día 20 del mes. Y el día del vencimiento se
  puede pagar entero: el bloqueo llega al día siguiente.
- **El retraso no cuesta dinero.** Pasado el plazo se bloquea el
  acceso, pero el importe no crece: ni recargo ni interés por días de
  retraso. El bloqueo es para que el pendiente se vea y se pague, no
  una penalización. Si algún día se quisiera lo contrario, el sitio
  donde se decide está en `lib/acceso.js`.
- **Sin fecha de vencimiento no hay bloqueo.** Un cobro sin `vence_en`
  no vence nunca; se avisa del pendiente en vez de cortar el acceso.

## Cómo se usa

Cuando termines algo, **borra la casilla y el `TODO` correspondiente**.
Un pendiente tachado vale más que un pendiente olvidado: dice que ahí se
trabajó. Si algo ya no aplica, bórralo sin más.
