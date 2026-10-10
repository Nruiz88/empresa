# El CSS del panel, dividido en módulos

## Por qué

`panel.css` llegó a **7.323 líneas**. Eso no se abre, y cada cambio
obligaba a recorrer un archivo que nadie puede leer entero para
saber qué había antes.

El detalle que lo hacía peligroso no era el tamaño: era que en CSS
el que gana es el último, y en este panel hay **28 selectores
declarados más de una vez**, tres de ellos tres veces
(`.panel-shell`, `.panel-page`, `.panel-topbar-acciones`). Mover un
bloque de sitio cambia el resultado sin dar ningún error.

Es la forma exacta de romper el CSS, y ya pasó cuatro veces.

## Los doce módulos

| | módulo | líneas | qué lleva |
|---|---|---|---|
| 1 | `00-base.css` | 256 | los planos, la escala de tipografía, las medidas |
| 2 | `01-estructura.css` | 645 | lateral, barra superior, contenido, página |
| 3 | `02-controles.css` | 174 | botones, campos, casillas, la paleta de comandos |
| 4 | `03-datos.css` | 1.018 | tablas, métricas, listas, etiquetas de estado |
| 5 | `04-formularios.css` | 645 | filtros, pestañas, alertas, estados vacíos |
| 6 | `05-portal.css` | 558 | el portal del cliente |
| 7 | `06-responsive.css` | 93 | los cortes por tamaño de pantalla |
| 8 | `07-catalogo.css` | 732 | el catálogo de productos y precios |
| 9 | `08-comandos.css` | 1.145 | la paleta del Ctrl+K y las transiciones |
| 10 | `09-argon.css` | 836 | el vocabulario viejo de componentes |
| 11 | `10-bots.css` | 794 | bots y cajas de Evolution |
| 12 | `11-planes.css` | 660 | la pantalla de planes |

Para cambiar un botón se lee `02-controles.css`, que son 174 líneas.

## El número del principio es su posición

`00` se carga primero y `11` el último, y **como el número es el
orden, mover un archivo es cambiar el aspecto**. Por eso el orden no
está escrito en el HTML, que es donde alguien lo movería sin
querer pensando que solo ordena etiquetas, sino en un manifiesto al
lado de las hojas:

    public/css/panel.orden.json

Y lo lee `lib/modulos-panel.js`, que lo pasa a todas las vistas como
`res.locals` desde un middleware en `server.js`.

## Cómo se garantiza que no cambia nada

    node db/ver-modulos-css.js

Compara la concatenación de los doce, **en el orden del manifiesto**,
contra una copia del archivo único de antes de la división.

Si dan el mismo texto, el aspecto es el mismo por definición: no
puede haber cambiado nada, porque el CSS que recibe el navegador es
idéntico carácter a carácter.

Sale con código 1 si difieren, y dice en qué línea.

**No tolera diferencias que no afectan.** Una versión anterior
aceptaba un salto de línea de más y una diferencia de codificación,
y con eso daba verde en un reparto que estaba mal. Ahora normaliza
los finales de línea —que en CSS son espacio en blanco— y da el
mismo texto exacto o falla.

## Lo que costó

Dos cosas que no son de CSS y que conviene no volver a hacer:

**EJS no expone `require`.** El primer intento pedía el manifiesto
desde la vista con un `require("../lib/...")` dentro de un
`try`/`catch`. El `catch` se tragaba el `require is not defined` y
caía a cargar `panel.css` a secas. El panel se veía **perfecto**,
con todos sus estilos, y la división no estaba funcionando.

Un respaldo es bueno. Un respaldo callado es peor que no tenerlo,
porque tapa el error en vez de dejarlo visible. Por eso ahora el
respaldo avisa por `console.error`.

**Ojo con los finales de línea y la codificación.** La copia de
referencia se hizo con `Out-File`, que escribe en Latin-1 y con
CRLF; el módulo con `writeFileSync`, que escribe UTF-8 y con LF. Las
dos versiones parecían distintas y eran el mismo texto. La
referencia se genera con `execSync("git show ...")` desde Node, que
respeta la codificación.

## Si se toca un módulo

1. Editar solo el módulo.
2. `node db/ver-modulos-css.js` — avisa en qué línea se separó.
3. `node db/ver-css-entero.js` — balance de llaves.
4. `node db/ver-css.js` y `node db/ver-desborde.js` — en navegador.

El paso 2 es el que hace falta. Los otros tres los encuentra igual
por su cuenta; el 2 es el único que sabe si el cambio fue a otro
sitio.
