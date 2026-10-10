# El panel, para ser un MVP

Este informe responde a una pregunta sola: **¿se puede cobrar
hoy?** No «qué falta por gusto», sino qué impide que entre la
primera plata real.

Todo está medido con `node db/herramientas/estado-mvp.js`.

---

## El veredicto

**No.** El panel está terminado y es bueno, pero el negocio no
arranca. Todo lo que falta es de contenido y de un servicio
externo, no de código del panel.

Y esa es una buena noticia: no hay un solo fallo en el panel. Lo
que hay son tres huecos y una decisión de negocio.

---

## Los tres huecos, por lo que bloquean

### 1. Ningún plan tiene precio

    Inicial     A CONSULTAR   visible   1 aplicación
    Comercio    A CONSULTAR   visible   0 aplicaciones
    Full / Pro  A CONSULTAR   visible   0 aplicaciones

Los tres están en «A consultar», que es un estado legítimo: vacío
significa «A consultar» y un 0 publicaría «gratis».

Con los tres sin cifra, la web pública no puede cobrar nada. Es el
hueco más grande y es el más fácil de cerrar: son tres números.

**Además, dos de los tres no dan acceso a nada.** «Comercio» y
«Full / Pro» tienen cero aplicaciones marcadas, así que un cliente
que los contrate recibe una promesa y nada detrás.

**Y los tres microservicios están marcados como no vendibles.**
`0 vendibles` de 3. El bot de WhatsApp aparece en las casillas con
un «no se está vendiendo» al lado.

O sea: el catálogo de aplicaciones y los planes cuentan historias
distintas, y la web pública junta las dos.

### 2. No hay correo

Es lo único que es un bloqueo técnico de verdad.

```
node server.js → 0 envíos
```

Busqué `nodemailer`, `smtp`, `sendMail` y `transporter` en todo el
código: **tres menciones, y las tres son el comentario del TODO**
en `routes/panel-accesos.js:21`.

Lo que sí existe son las variables vacías en `.env.example`
(`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`,
`MAIL_FROM`).

El propio código lo dice:

> `TODO(correo): sigue en pie. No hay nodemailer ni nada que envíe
> correo: ni alta de cliente, ni aviso al equipo, ni "olvidé mi
> contraseña". […] el modo "vacío = se registra en consola" que
> allí se describe TAMPOCO existe todavía: habría que escribirlo.`

Esto significa que hoy **un cliente puede darse de alta y no
recibir nada**, y que **no hay forma de recuperar una contraseña**.

No es una función que falte. Es una pieza entera que no se ha
empezado.

### 3. No hay ningún bot dado de alta

    0 bots dados de alta
    1 instancias en la Evolution
    1 cajas, 1 activas

Hay una caja con 15 sitios y una instancia (`Server 1`) esperando
en Evolution. No hay ni un bot que la use.

Mientras tanto, la pantalla de Cajas muestra el sitio 1 en ámbar
como «Sin asignar», que es exactamente la verdad: **hay un número
ocupado en Evolution que no lo paga nadie y no corresponde a
ningún cliente.**

---

## Lo que NO falta

Conviene decirlo, porque es fácil quedarse mirando lo que falta:

- **El panel está completo.** 70 rutas, 73 vistas, ninguna rota. Las comprobaciones dan 0 de 18 páginas con problema y 0 de 25
  pantallas con texto fuera de caja.
- **La caja funciona.** La Evolution responde y hay 15 sitios.
- **Los planes se editan y se guardan.** Probado de punta a punta.
- **El CSS está dividido en doce módulos** y verificado idéntico
  al original carácter a carácter.
- **El bot se da de alta solo**, con reparto de caja y validación de
  que quepa.

---

## Lo que hay que decidir, y no puedo decidir yo

Tres cosas que son tuyas:

**Los precios.** Cuánto cuesta cada plan, y si el de 14 días es de
prueba o va en serio. Sin eso no hay MVP.

**Qué entra en «Comercio» y «Full / Pro».** Hoy no dan acceso a
nada. ¿Son más meses del bot? ¿Inventario? ¿Reservas? Las tres
casillas existen y están sin marcar.

**Si el bot se cobra.** Los tres microservicios dicen «no se está
vendiendo», lo cual puede ser correcto (están en construcción) o
puede que se te haya olvidado quitarlo.

---

## El orden que yo seguiría

1. **Correo.** Es lo único que no se puede hacer fuera de casa, y
   sin él un alta de cliente es un cliente que no sabe que existe.
2. **Los precios de los tres planes.** Media hora, y es lo que
   convierte el panel en algo que cobra.
3. **Dar de alta el bot de Adri.** Con eso el sitio 1 de la caja
   deja de estar «Sin asignar» y hay un caso real de punta a
   punta.
4. **Marcar las aplicaciones de los planes.** O se marcan, o se
   quitan de los planes que no dan nada, para que la web no
   prometa lo que no está.

Los tres primeros son datos. El cuarto es una decisión.

---

## Lo que no es del MVP pero conviene no perder de vista

- **Dominio y HTTPS.** `lib/site.js` tiene `midominio.com` como
  marcador. No es solo el correo: de ahí se deducen los
  subdominios del bot y la dirección del webhook, así que el bot no
 mandaría nada.
- **Rotar las credenciales de Supabase** que han pasado por chats.
