# Despliegue en Coolify

Cómo poner la web y el bot en producción, en dos contenedores, con
subdominio cada uno.

Fecha: 2026-10-05. El código ya está preparado para esto; lo que
faltaba era esto mismo, escrito.

---

## La idea en un párrafo

Tres servicios independientes, un dominio, tres dominios:

| Servicio | Proceso | Dominio | Puerto interno |
|---|---|---|---|
| Web | `server.js` | `tudominio.com` | 3000 |
| Panel | `server.js` (mismo proceso) | `panel.tudominio.com` | 3000 |
| Bot | `bot.js` | `bot.tudominio.com` | 3200 |

El panel **no** es un contenedor aparte: `server.js` monta la web
pública y `/panel` en el mismo proceso. Son dos dominios apuntando
al mismo servicio.

Lo que sí justifica el subdominio del panel es la cookie *host-only*:
separado de la web pública, un XSS en la web no puede leer la sesión
del panel, que es donde están todos los clientes. Partirlo en dos
procesos no aporta nada; `panel.js` existe por si algún día lo
necesitas, pero con el panel en subdominio no hace falta usarlo.

El bot **sí** es un contenedor aparte, porque tiene su propia cookie
host-only y sus propias rutas.

---

## POR QUÉ EL BOT VA EN SUBDOMINIO Y NO EN UNA RUTA

Esto no es una preferencia estética, es seguridad:

La cookie de sesión es **host-only**. Con el panel en
`panel.tudominio.com`, un XSS en la web pública (`tudominio.com`) no
puede leer la cookie del panel. Si el panel viviera en
`tudominio.com/panel`, sería el mismo host y esa protección desaparecería.

Lo mismo aplica al bot: su cookie es `nexo_bot`, distinta de
`nexo_panel`, y cada una existe solo en su host.

Consecuencia práctica: **si algún día añades un subdominio nuevo, no
lo pongas con `Domain=.tudominio.com`**. Eso compartiría las cookies
entre todos los subdominios y se llevaría por delante justo la
propiedad que justifica separarlos.

---

## ⚠️ `server.js` tiene que escuchar en 0.0.0.0

Es el tercer error que aparece al desplegar, y el más confuso de
diagnosticar. Si `server.js` se ata a `127.0.0.1`, **dentro del
contenedor todo funciona**: los logs dicen que escucha, una prueba
desde dentro devuelve 200, el health check pasa. Pero Traefik entra
desde fuera de la red del contenedor y no lo alcanza, así que desde
el navegador sale **502**.

El `502` con la aplicación sana es la pista: significa "el proxy no
llega", no "la aplicación está caída".

La aplicación ahora usa `HOST` si está puesto y `0.0.0.0` si no. **No
hay que declarar `HOST` en Coolify.** Si algún día se declara con
`127.0.0.1`, avisa al arrancar y el servicio queda inaccesible.

## Variables de entorno

### Servicio web (el que sirve web + panel)

```env
NODE_ENV=production
SITE_URL=https://tudominio.com
PANEL_URL=https://panel.tudominio.com
PORT=3000

DATABASE_URL=postgresql://...
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_PUBLISHABLE_KEY=anon-key
SUPABASE_SECRET_KEY=service-role-key
SESSION_SECRET=<generar>
SERVICE_SECRET=<generar>
```

**Ojo con `PORT`:** `server.js` lo lee igual que `panel.js`, y en
`.env.example` vale `3100` (que es el del panel). Si lo copias tal
cual al servicio web, `server.js` escucha en 3100 y Coolify, que espera
el puerto que le has declarado, no recibe nada. Ponlo a 3000 o al que
hayas puesto en la interfaz.

Lo mismo con el bot: por defecto escucha en `3200`, y `BOT_PORT` **no**
lo lee nadie (está en `.env.example` solo por claridad). El que manda
es `PORT`.

### Servicio bot

```env
NODE_ENV=production
PORT=3200
BOT_HOST=0.0.0.0

# El bot NECESITA estas dos, aunque no envíe nada. Sin ellas no sabe
# dónde está el panel y todos sus enlaces apuntan a
# midominio.com (ver "el bot y el dominio" más abajo).
SITE_URL=https://tudominio.com
PANEL_URL=https://panel.tudominio.com

DATABASE_URL=postgresql://...            # la MISMA base
SUPABASE_URL=https://xxxx.supabase.co    # el MISMO proyecto
SUPABASE_PUBLISHABLE_KEY=anon-key
SUPABASE_SECRET_KEY=service-role-key

SESSION_SECRET=<el MISMO que el web>
SERVICE_SECRET=<el MISMO que el web>
```

### El bot y el dominio

`urlDelPanel()` (en `lib/acceso-servicio.js`) saca de dónde está el
panel, y `urlDeServicio()` (en `lib/site.js`) saca de dónde está cada
servicio. **Las dos leen de variables que tienen que existir en el
servicio que las usa**, y no de las de otro.

Si el bot no tiene `SITE_URL` ni `PANEL_URL`, no cae en un error
visible: cae en el valor por defecto de `lib/site.js`, que es
`https://midominio.com`. El bot arranca, `/entrar` responde 200, el
health check pasa, y solo cuando un cliente entra se ve que al
volver al panel lo manda a un sitio que no existe.

Es un fallo silencioso porque todo lo que se comprueba sin navegador
funciona.

Si un día se separan los dominios (panel en un subdominio y bot en
otro), `PANEL_URL` y `SITE_URL` dejan de ser iguales y hay que poner
los dos a mano en cada servicio.

### ⚠️ Los nombres de las claves de Supabase

Fíjate en el sufijo, porque es la trampa fácil:

- `SUPABASE_PUBLISHABLE_KEY` → la clave `anon` (va también en el
  navegador)
- `SUPABASE_SECRET_KEY` → la clave `service role`, la que salta RLS

No es `SUPABASE_KEY` ni `SUPABASE_SECRET`. Si te equivocas, `env.require()`
no encuentra la que falta y la app no arranca. Los nombres exactos están
en `.env.example`, que es la referencia: cópialo de ahí en lugar de
escribirlos de memoria.

---

## ⚠️ LO QUE MATA EL ACCESO AL BOT

Cuatro cosas. Las cuatro son fallos silenciosos: el bot arranca, el
panel funciona, y solo falla el salto entre ambos.

### 0. `node bot.js`, no `npm start`

El comando de arranque del bot **no** puede ser `npm start`, porque
ese script es `node server.js`. Con `npm start` levantas el servidor
web otra vez y acabas con dos servicios sirviendo la web pública,
con la misma cookie de panel. En Coolify, en el campo de start
command: `node bot.js`.

### 1. `SERVICE_SECRET` tiene que ser IDÉNTICO en los dos

Es lo primero que se olvida. Si difieren:

- el panel firma un ticket con su secreto
- el bot lo verifica con el suyo
- la firma no cuadra → "Ese enlace no vale o ha caducado"

Y lo que se ve en pantalla es un mensaje de enlace caducado, que no
dice nada de secretos. Sale en `panel-portal` logs, no en el del bot.

**Cómo comprobarlo:** generar con `openssl rand -base64 32` y pegar
el mismo texto en los dos servicios. Si usas la variable de entorno
de Coolify (`Resource` → `Shared Variable`), eso ya está resuelto.

### 2. `SITE_URL` tiene que ser el dominio real

`SITE_URL` no es solo para los correos. De ahí se deducen los
subdominios de los servicios:

```
SITE_URL=https://tudominio.com
   └─> bot.tudominio.com
```

Si `SITE_URL` se queda en `http://127.0.0.1:3000`, el botón "Abrir"
del portal lleva a `127.0.0.1:3200`, que en el navegador del
cliente es *su* localhost. No da error visible: el enlace parece
correcto y simplemente no carga nada.

### 3. `NODE_ENV=production`

Sin esto, la cookie va sin `Secure` y sin `SameSite=None`. En HTTPS
el navegador la rechaza o la degrada, y parece un problema de
dominio cuando el problema es la cookie.

---

## La entrada: cómo llega el cliente al bot

El flujo es de dos saltos, con un ticket firmado de por medio:

```
1. panel.tudominio.com/panel/servicios/bot_whatsapp/entrar
   └─> el panel firma un ticket de 60 s con los datos del usuario
   └─> redirige a bot.tudominio.com/entrar#ticket=...

2. bot.tudominio.com/entrar  (el JS lee el # y hace POST)
   └─> el bot verifica la firma
   └─> comprueba que el cliente tiene el módulo contratado
   └─> pone su propia cookie (nexo_bot)
   └─> devuelve la URL del panel para volver
```

El `#` (fragmento) es deliberado. Si el ticket fuera un `?ticket=...`,
el `access_token` que lleva dentro acabaría en los logs del proxy y
en el historial del navegador. Con `#`, el servidor solo ve un
`GET /entrar` limpio.

**Consecuencia:** los logs del bot no dejan rastro de quién entró. Si
necesitas esa trazabilidad, está en la tabla `bot_sesiones`.

---

## Comprobar que funciona

Después del primer despliegue, en este orden:

```bash
# 1. La web responde
curl -sI https://tudominio.com | head -1
# HTTP/2 200

# 2. El panel redirige al login (no 404)
curl -sI https://panel.tudominio.com/panel/login | head -1
# HTTP/2 200

# 3. El bot responde SU /entrar (no el 404 genérico)
curl -s https://bot.tudominio.com/entrar | grep -q "Comprobando tu acceso"
# echo $?  -> 0
```

Si el paso 3 devuelve la página de "Sin acceso" en vez de la de
entrada, el bot está arrancando pero `acceso.crear()` falló. Revisa
los logs del contenedor.

### La prueba que de verdad importa

Con sesión de cliente real, en el navegador:

1. Entrar al panel como cliente (no staff)
2. `/panel/mis-servicios`
3. Bot de WhatsApp → "Abrir"
4. **Debería** redirigir a `bot.tudominio.com/entrar#ticket=...` y
   devolver a `panel.tudominio.com/panel/mis-servicios`

Si al volver aparece un 404, el problema es la URL de vuelta, no los
permisos. `acceso-servicio.js` la construye con `urlDelPanel()`, que
usa `PANEL_URL`.

---

## Coolify: notas prácticas

### Recursos compartidos

Crea la base de datos y las variables compartidas una vez, en
`Projects` o como `Shared Variable`, y las asignas a los dos
servicios. Así `SERVICE_SECRET` no puede quedar distinto en uno sin
que te des cuenta.

### Health check

No hay endpoint `/healthz`. Usa `/` para el servicio web (responde
200 con la home) y `/entrar` para el bot. Ojo con el bot: `/` cae en
su 404, así que un health check sobre `/` lo daría por caído aunque
esté funcionando.

### Puertos

Coolify asigna puertos internos automáticamente. Si el bot escucha en
3200, ponlo en el campo de puerto del servicio. Si usas un puerto
aleatorio, actualiza `PORT` en las variables del bot.

### Node

Que instale **Node 22 o superior**. Coolify lee `engines.node` de
`package.json`, así que basta con que ahí diga `>=22`.

Con Node 18 (que es lo que instala si pone `>=18`) la aplicación no
arranca: `@supabase/supabase-js` usa el `WebSocket` global, que no
existe hasta Node 22, y revienta dentro de `createClient` con un error
que menciona `realtime-js` y no dice nada de la versión de Node.

### ⚠️ `NODE_ENV=production` en Coolify

Coolify avisa de esto y acierta: con `NODE_ENV=production` en el
build, `npm ci` salta las `devDependencies`. Aquí no importa (no hay
ninguna), pero si algún día las hubiera, déjalas como
"Available at Buildtime" o pon `NODE_ENV=development` solo durante el
build.

### Logs

Los dos servicios escriben a stdout, que Coolify recoge. Para el
bot, mira especialmente mensajes con `tiene_modulo falló` — es la
comprobación de suscripción, y si falla el cliente entra y sale
expulsado.

---

## Rotar secretos

Cuando llegue el momento:

```bash
openssl rand -base64 32
```

- `SESSION_SECRET`: cambia en ambos a la vez. **Invalida todas las
  sesiones** — todo el mundo tiene que volver a entrar.
- `SERVICE_SECRET`: cambia en ambos a la vez. **No invalida sesiones**,
  solo rompe los saltos en curso (tickets de 60 s). Es inocuo.

`SUPABASE_SECRET_KEY` (service role): se cambia en el panel de
Supabase, no aquí. Requiere actualizar en ambos servicios al mismo
tiempo.

---

## Lo que NO cubre esto

- El bot todavía no tiene la lógica real de WhatsApp. `bot.js` tiene
  `/mi-bot` como placeholder. Ver PENDIENTES.md.
- El panel no tiene pantalla de historial (`audit_log` se escribe,
  no se lee).
- Las contraseñas se dan en mano: no hay SMTP configurado.
