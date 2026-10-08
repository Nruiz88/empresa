# Nexo Studio

Web pública y panel privado de gestión, en un solo repositorio.
Express + EJS, sin build step. Los datos y el login están en Supabase.

Esto es software en desarrollo. Hay datos de ejemplo y textos
inventados; ver **Antes de publicar** abajo.

---

## Qué hay dentro

| | |
|---|---|
| Web pública | `routes/web.js` — home, servicios, precios, proyectos, blog, contacto, legales |
| Panel del equipo y portal de clientes | `routes/panel*.js` |
| Microservicio del bot | `bot.js` (proceso aparte) |
| Lógica reutilizable | `lib/` |
| Migraciones y comprobaciones | `db/` |
| Textos editables sin tocar código | `content/` |

**El bot tiene su propio proceso** y su propio subdominio. El acceso
entre el panel y el bot va con tickets firmados de 60 s, en el
fragmento de la URL para que el token no acabe en los logs.

---

## Arrancar

```bash
npm install
cp .env.example .env      # y rellena
npm run migrate
npm run seed              # datos de INVENTAR
npm start
```

Panel en `/panel`. El alta de cliente no tiene registro abierto; el
primer usuario de equipo se crea a mano:

```bash
node db/create-user.js --email tu@correo.com --nombre "Tu Nombre" --staff
```

Sin `--password` genera una de 18 caracteres y la imprime una vez.

---

## Comandos

```bash
npm run estado      # lo que hay AHORA: rutas, tablas, migraciones aplicadas
npm test            # lo que FUNCIONA: sintaxis, RLS, aislamiento, fechas
npm run check       # rápido: sintaxis y vistas, sin servidor
npm run test:panel  # rutas del panel contra el servidor (necesita npm start)
npm run log         # últimos errores
```

`npm run estado` es el que manda: no depende de que nadie mantenga un
papel al día.

### Comprobaciones sueltas

```bash
npm run test:fechas       # zonas horarias
npm run test:dominios     # deducción de subdominios
npm run test:env          # arranque sin fichero .env (caso contenedor)
npm run test:vencimientos # cálculo de renovaciones
npm run test:acceso       # reglas de bloqueo por impago
npm run test:cobros       # qué cobros crearía el generador
npm run test:aislamiento  # que un cliente no vea datos de otro
npm run test:bot:vuelta   # que el bot devuelva al panel (necesita el bot arriba)
```

### El flujo contra un despliegue real

`test-acceso-servicio.js` levanta dos servidores en `127.0.0.1` y
prueba la lógica. `test-flujo.js` va a los servicios de verdad, por
su dominio, con TLS, y salta de un host a otro. Comprueba lo que no
se puede probar en local: que el subdominio exista, que el
certificado valga, y que las cookies no crucen entre hosts.

```bash
TEST_PANEL=https://tudominio.com \
TEST_BOT=https://bot.tudominio.com \
  npm run test:flujo
```

Sin esas variables apunta a localhost y **avisa de que eso no valida
un despliegue**. Es un aviso a propósito: una prueba que pasa en el
sitio donde no importa es peor que no tenerla.

---

## Despliegue

Ver **[COOLIFY.md](COOLIFY.md)**. Resumen:

| Servicio | Proceso | Dominio | Puerto |
|---|---|---|---|
| Web + panel | `server.js` | `tudominio.com`, `panel.tudominio.com` | 3000 |
| Bot | `bot.js` | `bot.tudominio.com` | 3200 |

`SERVICE_SECRET` tiene que ser **idéntico** en los dos servicios. Es
lo que más silenciosamente rompe el acceso.

---

## Cómo está construido, y por qué

Cuatro reglas que no conviene romper. Están en los ficheros, pero
resumidas aquí porque un cambio que las rompa no falla de forma
visible:

1. **El aislamiento lo decide RLS, no el código.** Una tabla nueva sin
   RLS es un agujero: la clave publicable lee todo desde fuera.
   Ejecuta `npm run rls` cuando añadas una tabla.

2. **El portal del cliente lee con `getClientForToken()`, nunca con
   `getAdmin()`.** Con la secret key enseñaría todos los clientes. Es
   el fallo más grave posible en ese archivo, por eso va en mayúsculas
   en el código.

3. **Nada de `delete` en clientes ni cobros.** Se archivan y se anulan,
   para que el hueco en la contabilidad se pueda explicar.

4. **Todo POST lleva CSRF.** Sin la comprobación, otra web puede
   enviar formularios en tu nombre.

### Trampas ya pisadas

- Las fechas `YYYY-MM-DD` se parsean como **UTC**. Usa `lib/fechas.js`
  (`aFecha`, `iso`, `vencio`, `sumarDias`) y no `new Date(...)` ni
  `toISOString().slice()`. En zonas negativas sale el día anterior.
  Está explicado en la cabecera de ese módulo.
- "Mensual" son meses naturales, no 30 días: un 31 de enero renueva el
  28 de febrero.
- En `views/panel/` el include es `../partials/`, no `../../`. EJS
  compila igual y solo revienta al renderizar.
- Los sub-routers del panel se montan con `router.use(BASE, sub)`.
  Sin el prefijo, todo cae en el 404 público.

---

## Estado del trabajo

Lo que falta está en **[PENDIENTES.md](PENDIENTES.md)**, versionado a
propósito, con marcadores `TODO` en los ficheros donde el trabajo se
haría. Incluye las decisiones de negocio ya tomadas, para no volver a
abrir debates cerrados.

Lo hecho y verificado:

- Web pública completa con SEO, sitemap y JSON-LD
- Panel del equipo: sesiones revocables, CSRF, límite de intentos, auditoría
- Clientes, servicios, consultas y cobros (nunca se borran, se anulan)
- Portal de cliente de solo lectura, con cuatro niveles de acceso
- Control automático de vencimientos
- Acceso con ticket firmado entre el panel y el bot, con aislamiento
  de cookies entre subdominios
- RLS cerrado en todas las tablas

---

## Node

**Node 22 o superior.** No es arbitrario: `@supabase/supabase-js`
usa el `WebSocket` global, que no existe en Node 18. Con Node 18 el
proceso muere nada más arrancar, dentro de `createClient`, con un
error que habla de `realtime-js` y no de la versión de Node.

Lo declarado en `package.json` (`engines.node`) es lo que le dice a
Coolify qué versión instalar. Si se queda en `>=18`, el despliegue
instala 18 y falla aunque en local todo vaya bien.

---

## Antes de publicar

Esto **no** está listo para producción. Lo que falta:

- [ ] **Contenido inventado.** Todos los textos, cifras, casos,
      testimonios y métricas son inventados y están marcados para
      reemplazo. Los testimonios tienen aviso de riesgo legal en
      `content/testimonials.js`: publicar uno sin permiso real de
      quien aparece es publicidad engañosa (art. 137 LSSI-CE).
- [ ] **Rotar las credenciales de Supabase** si alguna vez se
      compartieron por chat o pantalla. Borrarlas del historial no
      basta: hay que hacerlo en Supabase > Settings > API.
- [ ] **Cambiar las claves de prueba.** Las de `db/seed.js` y
      `NOTAS-LOCAL.md` son de desarrollo.
- [ ] **Elegir dominio** y sustituir `midominio.com` (en `lib/site.js`
      o por `.env`).
- [ ] **HTTPS.** Todo va por `127.0.0.1` sin TLS. La cookie `Secure`
      ya se activa sola con `NODE_ENV=production`.
- [ ] **Borrar los datos `[demo]`** con `npm run seed:limpiar`.
- [ ] **Conectar el bot de verdad.** El motor vive en `D:\webs\wweb`
      y ya funciona con un cliente enlazado. Aquí, `bot.js` sigue con
      `/mi-bot` como ruta de ejemplo. La gestión sí está hecha:
      `/panel/bots` (alta con reparto de caja) y `/panel/servidores`
      (cajas de Evolution: alta, prueba, cupos y clave).
- [ ] **Correo.** No hay SMTP: las contraseñas se dan en mano.

---

## Licencia

Privado. Todos los derechos reservados.
