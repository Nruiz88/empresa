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

## Variables de entorno

### Servicio web (el que sirve web + panel)

```env
NODE_ENV=production
SITE_URL=https://tudominio.com
PANEL_URL=https://panel.tudominio.com

DATABASE_URL=postgresql://...
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_KEY=anon-key
SUPABASE_SECRET=service-role-key
SESSION_SECRET=<generar>
SERVICE_SECRET=<generar>
```

### Servicio bot

```env
NODE_ENV=production
PORT=3200
BOT_HOST=0.0.0.0

DATABASE_URL=postgresql://...          # la MISMA base
SUPABASE_URL=https://xxxx.supabase.co  # el MISMO proyecto
SUPABASE_KEY=anon-key
SUPABASE_SECRET=service-role-key

SESSION_SECRET=<el MISMO que el web>
SERVICE_SECRET=<el MISMO que el web>
```

---

## ⚠️ LO QUE MATA EL ACCESO AL BOT

Tres cosas. Las tres son fallos silenciosos: el bot arranca, el
panel funciona, y solo falla el salto entre ambos.

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

`SUPABASE_SECRET` (service role): se cambia en el panel de Supabase,
no aquí. Requiere actualizar en ambos servicios al mismo tiempo.

---

## Lo que NO cubre esto

- El bot todavía no tiene la lógica real de WhatsApp. `bot.js` tiene
  `/mi-bot` como placeholder. Ver PENDIENTES.md.
- El panel no tiene pantalla de historial (`audit_log` se escribe,
  no se lee).
- Las contraseñas se dan en mano: no hay SMTP configurado.
