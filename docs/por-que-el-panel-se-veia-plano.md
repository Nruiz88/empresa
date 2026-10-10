# Por qué el panel se veía plano, y qué lo arregla

Este texto explica el paso 4 del rediseño: color y superficie. No es
una lista de cambios, es el razonamiento, porque lo primero que se
intentó falló y el motivo importa para no volver a intentarlo.

## El síntoma

El panel no «se veía feo». Se veía **plano**: todo estaba a la misma
altura visual, nada se separaba de nada, y por más que se cambiaran
los colores el resultado no se movía.

## Lo que se midió primero

El panel tiene tres superficies: el fondo de la página, la tarjeta, y
la tabla. Para que dos superficies se lean como planos distintos la
razón de luminancia tiene que ser de al menos 1.3. Medido:

| par | antes | lectura |
|---|---|---|
| fondo ↔ tarjeta | 1,226 | se leen iguales |
| tarjeta ↔ tabla | 1,141 | se leen iguales |
| fondo ↔ tabla | 1,399 | justo |

Las tres se leían como el mismo plano. Eso era el problema: no
faltaban colores, faltaba separación.

## El intento que falló: aclarar las superficies

Lo primero que se probó fue subir el tono de las tarjetas hasta llegar
a 1.5:1 con el fondo (`db/buscar-paleta.js`, cuatro paletas).
**Ninguna llegó.**

El motivo es la forma de la curva de luminancia. En la parte baja de
la escala —que es donde vive un panel oscuro, entre 0.003 y 0.09— cada
paso perceptible cuesta el doble que el anterior. Para llegar a 1.5
la tarjeta tiene que volverse un gris medio, se ve más clara que el
texto y compite con él. En oscuro caben bien dos planos; tres, apretados.

También se probó un panel claro, y sale **peor**: 1,064:1 entre fondo y
tarjeta (`db/claro-vs-oscuro.js`).

## El hallazgo

Stripe separa sus superficies con el **borde**, no con el tono. Su
panel es claro y sus tarjetas se distinguen por un 1px, no por un gris
distinto. El gris da profundidad; el borde da el contorno.

Así que el tono se queda en un rango estrecho y cómodo, y el trabajo
se hace en el borde y en la sombra. Menos cajas dibujadas y mejor
dibujadas.

## Lo que se cambió

**Los tres planos**, con el fondo un gris azulado casi negro y la
tarjeta un poco más clara. El contraste del texto subió de 13,29:1 a
14,50:1 como efecto secundario.

**El borde**, de 9% a 7% de blanco. Menos peso, más presencia. Y el
borde fuerte, de 16% a 11%: era un salto grande, y con 0.16 el borde
de un campo se veía como una caja negra alrededor de la caja, que es
justo lo que se quería quitar. Los 29 usos bajan solos con el token.

**La sombra de tarjeta**, de `0 0 2rem` a `0 0 0.5rem`. El criterio
—una tarjeta está pegada al lienzo, así que no lleva desplazamiento—
ya estaba bien escrito en el CSS. Lo que sobraba era la cantidad: 32px
de difuminación no se leen como una tarjeta apoyada, se leen como un
resplandor. Y la opacidad bajó a 0.06: la sombra tiene que ser más
tenue que la diferencia de tono, no más fuerte, o se ve la sombra en
lugar de la superficie.

**El radio**, de 16px a 8px en el panel. 16px es de la web pública,
donde las tarjetas llevan imágenes y esquinas blandas. En un panel
son cajas de datos, y a 16px cada una parece una burbuja. Con la
sombra corta se nota más: el radio grande y el halo pequeño se pelean.
El panel declara su propio radio en `html[data-panel]`, así que la
portada no se entera.

**La etiqueta de sección**, de amarillo a gris. Había dos colores de
marca vivos a la vez diciendo «esto es importante»: el verde del
botón principal y el amarillo de cada rótulo. Cuando todo es acento no
hay acento, y el ojo aprende que el amarillo no significa nada. Ahora
el verde es la marca y la acción, y el amarillo es solo estado.

## Herramientas

    db/contraste-colores.js       contraste del texto sobre cada plano
    db/separacion-superficies.js  separación entre planos
    db/buscar-paleta.js           prueba paletas candidatas (falló)
    db/claro-vs-oscuro.js         por qué en claro tampoco funciona
    db/repartir-planos.js         verifica la paleta finalmente elegida

Las tres primeras son de diagnóstico y la cuarta verifica. El orden
importa: se diagnostica, se prueban alternativas, y solo entonces se
verifica lo elegido. Invertirlo fue el error del primer intento, que
buscaba el tono «calculando» en vez de elegirlo y comprobarlo después.

## Verificación

    contraste por debajo de 4.5:1   0
    separación mínima entre planos   1,352 (la que sí importa:
                                     fondo ↔ tabla)
    páginas con problema             0 de 18
    textos fuera de caja             0 de 25 pantallas
