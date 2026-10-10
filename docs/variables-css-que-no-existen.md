# Las variables que se usan y no existen

## Qué pasó

Al reescribir el bloque de `:root` de `styles.css` —para mover los
planos del panel a `html[data-panel]` y no teñir la portada— se
llevó por delante un grupo entero de declaraciones. Entre ellas:

  --danger          99 usos
  --warning         53 usos
  --success         33 usos
  --accent         105 usos
  --accent-2        81 usos
  --brand            7 usos
  --warning-text     8 usos
  --fs-body          3 usos
  --fs-h2            4 usos
  --btn-glow         5 usos
  --urgent           1 uso

Más de 300 referencias, y ninguna daba error.

## Por qué no se veía ningún aviso

Una declaración con una variable que no existe no está mal: el
navegador la descarta entera y sigue. No hay error de sintaxis, no
hay aviso en la consola, y la comprobación `ver-css-entero.js` —que
cuenta llaves— pasa.

Lo único que se ve es el síntoma: el botón principal sin sombra, los
chips de estado sin color, los textos que deberían ser rojos y
amarillos en negro, y la portada sin títulos.

## Por qué los tokens de tipografía también se perdieron

Porque se escribieron en el mismo bloque. Cuando se hizo el mapa de
la escala del panel se decidió NO tocar `styles.css`, porque la
carga la portada y sus `--fs-*` son otros. La herramienta lo
respetó, pero la reescritura manual del bloque de `:root` que vino
después no tuvo ese cuidado: se reescribió entero en vez de tocar
solo las seis líneas de los planos.

## La herramienta

    node db/ver-variables-roto.js

Busca lo que se usa y no está declarado, en las hojas de
`public/css`. Distingue los `var(--x, reserva)`, que sí funcionan
sin declaración, de los `var(--x)` pelados, que no.

Sale con código 1 si encuentra alguna, así que se puede poner en la
suite igual que las otras.

## Cómo se evita

1. Al tocar `:root`, editar solo las líneas necesarias. Un bloque
   reescrito entero es donde se pierden cosas que no estaban a la
   vista.
2. Después de tocar un archivo de tokens, correr
   `ver-variables-roto.js` antes que nada. Tarda un segundo.
3. La comparación con el commit anterior ayuda: `git show HEAD~1:archivo`
   y comparar el conjunto de nombres declarados.

## Lo que queda

Catorce referencias rotas en `styles.css`, todas de la web pública y
del trabajo anterior a este:

  --cta-bg   --cta-border   --featured-bg   --featured-glow
  --grid-line   --h   --header-bg   --header-bg-solid
  --menu-bg   --page-glow   --stats-bg   --text-grad
  --thumb-overlay   --w

No se han tocado porque el encargo es el panel, y porque hay que
decidir para cada una si es un resto de una versión anterior o una
variable que debería existir. `--h` y `--w` son un hallazgo aparte:
son de un eje de la rejilla de la portada.
