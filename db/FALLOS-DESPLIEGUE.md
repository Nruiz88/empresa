/* =========================================================
   Fallos de despliegue del panel — 2026-10-06
   =========================================================

   ── 19. ⭐ UN DESPLIEGUE PUEDE DECIR "healthy" Y DEJAR EL PANEL CAÍDO ──

   Cosas que dicen cosas distintas, y ninguna es mentira:

       New container is healthy.
       Rolling update completed.
       status: finished          ← la cola de despliegue

   y a la vez:

       $ docker ps | grep dl9ftl
       (nada)

       SELECT status FROM applications WHERE ...
         Web Empresa | exited

   El despliegue crea el contenedor, lo ve sano, y luego desaparece.
   La tabla de Coolify apunta a "salió bien", así que no lo relanza:
   da el despliegue por hecho y el panel se queda caído hasta que
   alguien se da cuenta.

   ── CÓMO SE NOTA A DISTANCIA ──

   La pantalla de salud devuelve **503 en todo**, incluidas rutas que
   antes funcionaban. Un 503 general no es un error de una ruta: es
   que la aplicación no está sirviendo. Una ruta no da 503 en todo.

   ── CÓMO SE LEVANTA ──

   El helper que usa la API, con force_rebuild en false —la imagen ya
   está construida y está bien; lo que falta es el contenedor, no el
   código—:

       queue_application_deployment(
           application: $app,
           deployment_uuid: new_public_id(),
           force_rebuild: false,
           is_api: false,
           no_questions_asked: true
       );

   Ese redeploy funcionó a la primera y en ocho segundos.

   ── LO QUE SE APUNTA ──

   El patrón "dice healthy y no hay contenedor" ya apareció dos veces:
   aquí y con el router duplicado de Traefik. Cuando algo dé 503 en
   todo, mirar el contenedor antes que la ruta:

       docker ps -a | grep <uuid-de-la-app>

   ── 20. ⭐ RUTAS DUPLICADAS DE UNA VARIABLE, Y SOLO UNA EN EL CONTENEDOR ──

   El 2026-10-06, `SERVICE_SECRET` del panel tenía dos filas en Coolify
   con valores DISTINTOS:

       is_preview = false    b2cfc6dc82e6    la buena
       is_preview = true     266c112bdaf4    la vieja

   El botón "Abrir" firmaba con la vieja y `inventario` verificaba con
   la buena. El canje daba:

       401 "Ese enlace no vale o ha caducado"

   que es el mismo texto que un ticket manipulado. Durante horas se
   buscó un ataque que no había, comparando secretos que eran
   idénticos en local.

   Para verlo:

       SELECT is_preview, left(md5(value), 12), length(value)
         FROM environment_variables
         JOIN applications USING (resourceable_id)
        WHERE applications.uuid = '<uuid>' AND key = 'SERVICE_SECRET';

   Las dos filas deben dar el mismo md5. La pantalla de salud lo
   comprueba sola: `https://empresa.panel-niconqn.duckdns.org/panel/salud`

   ── ROTAR UN SECRETO COMPARTIDO ──

   Si hay que rotar `SERVICE_SECRET`, hay que cambiarlo en las CUATRO
   filas: panel preview y producción, servicio preview y producción.
   Cambiar solo las de producción deja el despliegue siguiente
   firmando con la vieja, que es exactamente el fallo de arriba.

   ── 21. ⭐ LA PANTALLA DEL CLIENTE REVENTABA CON EL TOKEN CADUCADO ──

   `mis-servicios` se renderiza en dos sitios: el normal, y el de error
   (503) cuando caduca el access_token de Supabase. El de error no
   pasaba dos variables que la plantilla usa sin comprobar:

       esStaff is not defined        (views/panel/mis-servicios.ejs:179)
       nombreCliente is not defined  (views/panel/mis-servicios.ejs:40)

   El cliente veía un error de servidor en vez del mensaje que le dice
   "vuelve a entrar". Ese camino no lo probaba nadie: para verlo hay
   que tener una sesión SIN token, que es lo que no pasa al usar la
   aplicación. Sale de hora en hora, a los clientes.

   Esto ya no puede volver: `db/test-render-completo.mjs` compara los
   dos render y falla si uno se queda corto, y
   `db/probar-camino-sin-token.mjs` fuerza ese camino a propósito.
   Ambos en `npm test`.

   ── UNA LECIÓN QUE COSTA MÁS DE UNA VEZ ──

   En EJS, cada bloque `<% %>` se compila en su propia función. Una
   variable declarada en un scriptlet NO llega al siguiente:

       <% var fallo = false %>     ← solo existe en ese bloque
       <% if (fallo) { %>          ← ReferenceError

   Los valores por defecto van en la RUTA, que es quien tiene que
   mandar el mismo juego de variables por los dos caminos. Ver
   `escena()` en routes/panel-salud.js.

   Y otra: no escribir marcas de EJS dentro de un comentario `<%# %>`.
   EJS las lee como apertura de etiqueta y falla con

       Could not find matching close tag for "<%#".

   Costó dos reinicios. La segunda vez, escribiendo el comentario que
   explicaba justo el error anterior.
   ========================================================= */