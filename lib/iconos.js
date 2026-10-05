/* =========================================================
   Nexo Studio — Iconos
   ------------------------------------------------------------
   SVG en línea, dibujados en la misma retícula que Lucide: lienzo
   de 24×24, trazo de 2, remates y uniones redondeados. ES LA FORMA
   en que los dibuja Lucide (ISC), que es la librería que usa shadcn/ui
   y la mayor parte de paneles actuales.

   POR QUÉ ESTE ARCHIVO Y NO LA LIBRERÍA
   --------------------------------------
   Lucide se instala con npm y trae componentes de React. Aquí no hay
   React ni build step, a propósito (ver NOTAS-LOCAL.md). Copiar los
   trazos que hacen falta en un fichero de texto da el mismo resultado
   sin añadir 1600 iconos al repositorio ni un paso de compilación.

   Solo están los que el portal usa. Si hace falta uno nuevo, se copia
   de https://lucide.dev/icons y se añade aquí: no se descargan iconos
   en caliente ni se mete una CDN, porque un panel que depende de una
   red externa para dibujar sus botones no funciona sin conexión.

   LO QUE ESTO ARREGLA
   -------------------
   Antes cada aplicación se identificaba con sus iniciales en un
   cuadrado de color ("BD", "GD", "RO"). Se veía claramente generado:
   es el truco que hace cualquiera cuando no tiene iconos, y encima
  зывало a falso las iniciales ("BD" no significa nada para un panadero).
   Con un icono real, un panadero reconoce su bot de un vistazo.

   ========================================================= */

const TRAZO = {
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "2",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
};

/* Cada entrada es la lista de <path>/<circle>/<rect>. Se pueden
   mezclar: es lo que hace Lucide con los iconos compuestos. */
const ICONOS = {
  /* Bot de WhatsApp: un mensaje con cola, no el logo de WhatsApp.
     El logo es marca registrada y además requiere un graphical
     resource que no tenemos. Un bocadillo dice lo mismo. */
  bot: [
    '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  ],

  /* Inventario: cajas apiladas. */
  inventory: [
    '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>',
    '<path d="m3.3 7 8.7 5 8.7-5"/>',
    '<path d="M12 22V12"/>',
  ],

  /* Agenda / reservas. */
  agenda: [
    '<path d="M8 2v4"/>',
    '<path d="M16 2v4"/>',
    '<rect width="18" height="18" x="3" y="4" rx="2"/>',
    '<path d="M3 10h18"/>',
    '<path d="m9 16 2 2 4-4"/>',
  ],

  /* Abrir en otro sitio. */
  "arrow-up-right": [
    '<path d="M7 7h10v10"/>',
    '<path d="M7 17 17 7"/>',
  ],

  /* Negocio: un edificio de oficinas. */
  negocio: [
    '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/>',
    '<path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/>',
    '<path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/>',
    '<path d="M10 6h4"/>',
    '<path d="M10 10h4"/>',
    '<path d="M10 14h4"/>',
    '<path d="M10 18h4"/>',
  ],

  /* Facturación: una tarjeta. */
  facturacion: [
    '<rect width="20" height="14" x="2" y="5" rx="2"/>',
    '<path d="M2 10h20"/>',
    '<path d="M6 15h4"/>',
  ],

  /* Usuario. */
  usuario: [
    '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>',
    '<circle cx="12" cy="7" r="4"/>',
  ],

  /* Todo correcto. */
  "check-circle": [
    '<path d="M21.8 10A10 10 0 1 1 17 3.34"/>',
    '<path d="m9 11 3 3L22 4"/>',
  ],

  /* Aviso. */
  alerta: [
    '<path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3"/>',
    '<path d="M12 9v4"/>',
    '<path d="M12 17h.01"/>',
  ],

  /* Reloj: para "caduca en N días" y "periodo de prueba". */
  reloj: [
    '<circle cx="12" cy="12" r="10"/>',
    '<path d="M12 6v6l4 2"/>',
  ],

  /* Añadir. */
  mas: [
    '<path d="M5 12h14"/>',
    '<path d="M12 5v14"/>',
  ],

  /* Cerrar sesión. */
  salir: [
    '<path d="m16 17 5-5-5-5"/>',
    '<path d="M21 12H9"/>',
    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>',
  ],

  /* Factura pendiente: un documento con dinero. */
  pendiente: [
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>',
    '<path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
    '<path d="M8 13h8"/>',
    '<path d="M8 17h5"/>',
  ],

  /* Rejilla: el catálogo. */
  catalogo: [
    '<rect width="7" height="7" x="3" y="3" rx="1"/>',
    '<rect width="7" height="7" x="14" y="3" rx="1"/>',
    '<rect width="7" height="7" x="14" y="14" rx="1"/>',
    '<rect width="7" height="7" x="3" y="14" rx="1"/>',
  ],

  /* Herramienta: mantenimiento y trabajos. */
  trabajo: [
    '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9Z"/>',
  ],
};

/**
 * Devuelve el SVG de un icono.
 *
 * @param {string} nombre   clave de ICONOS
 * @param {object} [opciones]
 * @param {number} [opciones.tamano=20]
 * @param {string} [opciones.clase]   clases extra
 * @param {boolean} [opciones.decorativo=true]  Si es true, aria-hidden.
 *                        Si es false, se marca como imagen con nombre,
 *                        para cuando el icono es la única etiqueta.
 * @returns {string} SVG, o '' si el nombre no existe
 */
function icono(nombre, opciones = {}) {
  const partes = ICONOS[nombre];
  if (!partes) {
    /* No se lanza: un icono que falta es un cuadrado vacío, y un
       error al renderizar dejaría la página en blanco. */
    return "";
  }

  const tam = opciones.tamano || 20;
  const clase = opciones.clase ? ' class="' + opciones.clase + '"' : "";

  const a11y = opciones.decorativo === false
    ? ' role="img" aria-label="' + (opciones.texto || nombre) + '"'
    : ' aria-hidden="true" focusable="false"';

  /* TRAZO lleva `fill: none` para que los iconos no se rellenen. Se
     emite UNA vez, aquí, y se saca del recorrido de atributos para no
     duplicarlo en el HTML. */
  const { fill, ...resto } = TRAZO;
  const attrs = Object.entries(resto)
    .map(([k, v]) => k + '="' + v + '"')
    .join(" ");

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + tam + '" height="' + tam +
    '" viewBox="0 0 24 24" fill="' + fill + '" ' + attrs + clase + a11y + ">" +
    partes.join("") +
    "</svg>"
  );
}

/**
 * Qué icono va con cada módulo.
 *
 * Sale del slug, no de un campo en la base. Motivo: un producto nuevo
 * no tiene icono hasta que alguien lo ponga, y un módulo sin icono se
 * vería raro. Con esta tabla, lo que no esté conocido cae en
 * 'catalogo', que siempre funciona.
 *
 * Si un día un módulo trae su propio icono (un SVG subido por el
 * cliente), esto se sustituye por una columna `icono` en `modules` y
 * el `if` de aquí pasa a mirarla primero.
 */
const ICONO_DE_MODULO = {
  bot_whatsapp: "bot",
  bot: "bot",
  whatsapp: "bot",
  inventario: "inventory",
  stock: "inventory",
  reservas_web: "agenda",
  agenda: "agenda",
  turnos: "agenda",
  reservas: "agenda",
  facturacion: "facturacion",
  nomina: "facturacion",
};

const iconoDeModulo = (moduloId) => ICONO_DE_MODULO[moduloId] || "catalogo";

module.exports = { icono, iconoDeModulo, ICONOS };
