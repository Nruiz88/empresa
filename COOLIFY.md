# Despliegue en Coolify

Cómo poner la web y el bot en producción, en dos contenedores, con
subdominio cada uno.

Fecha: 2026-10-05. El código ya está preparado para esto; lo que
faltaba era esto mismo, escrito.

---

## La idea en un párrafo

Tres servicios independientes, un dominio, tres dominios:

| Servicio | Dónde está el código | Dominio | Puerto interno |
|---|---|---|---|
| Web | este repo, `server.js` | `tucormercio.com.ar` | 3000 |
| Panel | este repo, `server.js` (mismo proceso) | `panel.tucormercio.com.ar` | 3000 |
| Bot | **`D:\webs\wweb`** (Next.js) | `bot.tucormercio.com.ar` | 3000 |

### ⚠️ El bot NO es `bot.js` de este repo

`bot.js` existe y arranca, pero solo tiene `/entrar`, `/mi-bot` y
`/salir`: **no tiene `/api/webhook`**. El motor de verdad —Evolution,
respuestas automáticas, turnos, catálogo y el panel del cliente— está en
`D:\webs\wweb`, que es un Next.js aparte con su propio `Dockerfile` y
su propio dominio.

Por qué importa, y por qué es el fallo más caro de este despliegue: la
Evolution manda los mensajes al webhook. Si `bot.tucormercio.com.ar`
apunta a `bot.js`, cada mensaje recibe un **404**. El bot queda mudo
**sin ningún error visible**: la Evolution devuelve 200 cuando le
configuras el webhook, el panel da el alta por buena, y lo único que pasa
es que no llega nada.

Por eso el panel tiene la URL del webhook a la vista por caja
(`/panel/servidores`) y un botón para comprobar qué tiene la Evolution
realmente configurado. Antes de dar de alta el primer bot, "Probar" tiene
que decir que los webhooks cuadran.

Si algún día se quiere el bot dentro de este repo, hay que escribir en
`bot.js` la ruta `/api/webhook` y el motor. Está en PENDIENTES.md.

---

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
`panel.tucormercio.com.ar`, un XSS en la web pública (`tucormercio.com.ar`) no
puede leer la cookie del panel. Si el panel viviera en
`tucormercio.com.ar/panel`, sería el mismo host y esa protección desaparecería.

Lo mismo aplica al bot: su cookie es `nexo_bot`, distinta de
`nexo_panel`, y cada una existe solo en su host.

Consecuencia práctica: **si algún día añades un subdominio nuevo, no
lo pongas con `Domain=.tucormercio.com.ar`**. Eso compartiría las cookies
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
SITE_URL=https://tucormercio.com.ar
PANEL_URL=https://panel.tucormercio.com.ar
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

El bot es **`D:\webs\wweb`** (Next.js), no este repo. Lo que hay que
declarar en Coolify es lo de ese proyecto:

```env
NODE_ENV=production

SUPABASE_URL=https://xxxx.supabase.co    # el MISMO proyecto
SUPABASE_PUBLISHABLE_KEY=anon-key
SUPABASE_SECRET_KEY=service-role-key

# La caja de Evolution. La url y la clave están en el panel
# (/panel/servidores) y no hacen falta aquí, pero sí hace falta que
# la caja y la Evolution sean la misma.
EVOLUTION_API_URL=https://evolution-....up.railway.app
EVOLUTION_API_KEY=<la de la caja>

# El secreto del webhook. Tiene que ser IGUAL al de cada caja
# (evolution_servers.webhook_secret). Si difieren, la Evolution acepta
# los mensajes y el bot los rechaza al llegar, sin error.
WEBHOOK_SECRET=<el mismo que la caja>

# La URL pública de ESTE servicio: es la que va en el webhook.
APP_URL=https://bot.tucormercio.com.ar
```

`APP_URL` no es un detalle: es la dirección a la que la Evolution manda
los mensajes. Mientras sea un marcador (`tu-dominio.vercel.app`), el
script `npm run secreto:webhook` se niega a guardar una URL, a propósito.

---

### U0001F534 Cloudflare: lo que hay que revisar

El dominio pasa por Cloudflare antes de llegar a Coolify. Eso no rompe
nada por sí solo, pero hay **cuatro cosas que sí se rompen en
silencio**, y las cuatro tienen la misma forma: el bot deja de
contestar y no hay ningún error en ninguna parte.

**1. Bot Fight Mode, apagado o con excepción.**

Cloudflare decide si una petición es de un bot y la corta con un 403. La
Evolution **es** un robot, y su POST a `/api/webhook` es exactamente
lo que ese filtro está pensado para cortar. Si está activo y sin
excepción, el bot queda mudo sin que en el contenedor de la Evolution
aparezca nada.

→ Crear una regla que **permita** los POST a `*/api/webhook`, y
desactivar Bot Fight Mode en ese camino. Es lo primero que hay que
comprobar cuando el bot esté desplegado y no llegue ni un mensaje.

**2. El modo SSL: `Full`, nunca `Flexible`.**

`Flexible` no cifra entre Cloudflare y el origen, y además el origen no
recibe `X-Forwarded-Proto: https`. Con `Full` se cifra, que es lo que
queremos. `Full (strict)` solo si el origen tiene un certificado
válido (Let's Encrypt), que es lo normal con Traefik.

**3. `NODE_ENV=production`, obligatorio.**

Es lo que activa `Secure` en la cookie de sesión. Sin eso el
navegador avisa y el login puede fallar.

**4. La IP que queda en el registro de auditoría.**

Con Cloudflare delante, `req.ip` es la IP del nodo de Cloudflare por el
que entró la petición, no la de la persona. El límite de intentos del
login sigue funcionando (agrupa por email **y** IP), pero el log guarda
una IP que no es de nadie.

Por eso `lib/auth.js` mira primero `CF-Connecting-IP`, que Cloudflare
rellena con la IP real. Si algún día Cloudflare deja de estar
delante, la cabecera no viene y se cae a `req.ip`, que es lo correcto.

**Lo que NO hace falta cambiar:** con la nube naranja encendida el
origen puede quedar en `127.0.0.1`. El único que tiene que seguir
escuchando en `0.0.0.0` es el que Traefik alcanza, y Traefik lo alcanza
por dentro del contenedor.

---

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
SITE_URL=https://tucormercio.com.ar
   └─> bot.tucormercio.com.ar
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
1. panel.tucormercio.com.ar/panel/servicios/bot_whatsapp/entrar
   └─> el panel firma un ticket de 60 s con los datos del usuario
   └─> redirige a bot.tucormercio.com.ar/entrar#ticket=...

2. bot.tucormercio.com.ar/entrar  (el JS lee el # y hace POST)
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
curl -sI https://tucormercio.com.ar | head -1
# HTTP/2 200

# 2. El panel redirige al login (no 404)
curl -sI https://panel.tucormercio.com.ar/panel/login | head -1
# HTTP/2 200

# 3. El bot responde SU /entrar (no el 404 genérico)
curl -s https://bot.tucormercio.com.ar/entrar | grep -q "Comprobando tu acceso"
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
4. **Debería** redirigir a `bot.tucormercio.com.ar/entrar#ticket=...` y
   devolver a `panel.tucormercio.com.ar/panel/mis-servicios`

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
