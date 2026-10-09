/* =========================================================
   Shopcito — Contenido de caso (para /proyectos/<slug>)
   ------------------------------------------------------------
   ⚠️  DATOS DE EJEMPLO — NO SON REALES ⚠️
   El reto, la solución, el resultado y las cifras son
   inventados. Antes de publicar un caso:

     1. Que el cliente valide el texto (sobre todo las métricas).
     2. Pide permiso escrito para publicar nombre y logotipo.
     3. Guarda pruebas: capturas de GA4, del panel, del contrato.

   Un caso con métricas que el cliente no reconoce es peor que
   no publicar el caso: es la parte que más credibility aporta
   y la que más daño hace si falla.

   Se separa de projects.js a propósito: content/projects.js es
   la ficha corta (tarjetas), este archivo es la historia larga
   (página de detalle). Un proyecto puede tener ficha sin caso
   completo, y aquí solo se documentan los que lo tienen.

   La clave de cada objeto es el `slug` de projects.js.

   Cada caso:
     sector      {string}   Sector y país
     heroTitle   {string}   Titular del caso
     heroLead    {string}   Entradilla
     challenge   {string}   El punto de partida
     solution    {string[]} Qué hicimos
     outcome     {string[]} Qué consiguió
     metrics     [{value,label}]
     duration    {string}   Plazo de ejecución
     stack       {string[]} Tecnologías
     testimonial {quote,name,role}
   ========================================================= */

module.exports = {
  "mercado-norte": {
    sector: "Alimentación · España",
    heroTitle: "De tienda de barrio a canal de medio pedido",
    heroLead: "Una tienda de alimentación con 1.200 referencias necesitaba vender online sin perder el reparto de siempre.",
    challenge: "Recibían pedidos por teléfono y WhatsApp, pero la gestión era manual: hojillas, cobros sin seguimiento y ninguna visibilidad sobre qué producto se vendía de verdad. La web anterior cargaba en once segundos y perdía la mitad de las visitas en celular.",
    solution: [
      "Catálogo de 1.200 referencias con búsqueda por categoría, marca y precio, pensado para usarse con el pulgar.",
      "Carrito y pago con tarjeta, Bizum y Apple Pay, con confirmación automática por correo y SMS.",
      "Suscripción de compra semanal para que el cliente no rehaga el pedido cada vez.",
      "Envíos por franja horaria conectados con su gestor de reparto.",
    ],
    outcome: [
      "La compra media se alarga: el cliente pide con calma y sin llamar.",
      "El equipo de tienda deja de teclear pedidos y se dedica a atender en mostrador.",
      "Los datos de venta sirven para decidir qué comprar cada semana.",
    ],
    metrics: [
      { value: "+40 %", label: "conversiones en 3 meses" },
      { value: "1,9 s", label: "tiempo de carga" },
      { value: "0", label: "incidencias en 12 meses" },
    ],
    duration: "9 semanas",
    stack: ["Shopify", "Stripe", "Bizum", "GA4", "Cloudflare"],
    testimonial: {
      quote:
        "Pasamos de una web que nadie visitaba a un canal que nos aporta la mitad de los pedidos. El proceso fue claro y entregaron en la fecha prometida.",
      name: "Laura Méndez",
      role: "Directora · Mercado Norte",
    },
  },

  "clinica-salud": {
    sector: "Salud · España",
    heroTitle: "El teléfono dejó de ser la puerta de entrada",
    heroLead: "Una clínica con cuatro centros perdía horas al día en llamadas para dar citas, y eso era el cuello de botella de recepción.",
    challenge: "Casi todas las citas se pedían por teléfono. El equipo de recepción no podía atender a los pacientes que ya estaban en la sala, y muchos colgaban antes de que les dieran hora.",
    solution: [
      "Portal de pacientes con cita online disponible las 24 horas, integrado con el software de gestión que ya usaban.",
      "Historial clínico accesible para el paciente, previo consentimiento.",
      "Recordatorios por SMS 48 horas antes de cada cita, con opción de confirmar o anular.",
      "Facturación a aseguradoras desde el mismo panel.",
    ],
    outcome: [
      "Recepción vuelve a atender a quien está físicamente en la clínica.",
      "Menos ausencias gracias al recordatorio previo.",
      "El paciente ve su historial sin llamar por teléfono.",
    ],
    metrics: [
      { value: "−60 %", label: "llamadas de reserva" },
      { value: "−23 %", label: "ausencias" },
      { value: "24 h", label: "disponibilidad" },
    ],
    duration: "11 semanas",
    stack: ["Laravel", "MySQL", "Twilio", "HubSpot"],
    testimonial: {
      quote:
        "La app de reservas nos quitó un trabajo enorme de encima. Nuestro equipo de recepción ahora dedica su tiempo a los pacientes, no al teléfono.",
      name: "Dr. Rubén Ortiz",
      role: "Fundador · Clínica Salud+",
    },
  },

  logitrack: {
    sector: "Logística · España",
    heroTitle: "Control de flota en tiempo real, sin perseguir camiones",
    heroLead: "Una empresa de transporte necesitaba saber dónde estaba cada vehículo sin llamar a cada conductor.",
    challenge: "La oficina de control se enteraba de dónde estaba cada camión por radio. Sin datos en vivo no se podía ni prometer una hora de llegada ni detectar pronto una avería.",
    solution: [
      "Tablero con la posición de cada vehículo actualizada en tiempo real, visible para la oficina y para el cliente.",
      "Gestión de incidencias de conductor con foto y hora, desde el propio celular.",
      "Facturación automática por viaje, calculada según distancia y tipo de servicio.",
      "Roles y permisos diferenciados para administración, dirección y conductor.",
    ],
    outcome: [
      "El control deja de ser una llamada: se ve en la pantalla.",
      "Las incidencias se resuelven antes de que el cliente se queje.",
      "La facturación se cierra sin trabajo manual en la oficina.",
    ],
    metrics: [
      { value: "15 h", label: "ahorradas cada semana" },
      { value: "−45 %", label: "tiempo de resposta en incidencias" },
      { value: "120", label: "vehículos monitorizados" },
    ],
    duration: "14 semanas",
    stack: ["Node.js", "PostgreSQL", "Redis", "WebSocket"],
  },

  "bruma-cafe": {
    sector: "Hostelería · España",
    heroTitle: "Carta escaneable y mesa reservada desde el celular",
    heroLead: "Cuatro cafeterías con público jeune y suelto, pero sin sistema para pedir ni para fidelizar.",
    challenge: "La carta estaba en un PDF que se descargaba mal en celular, las mesas se reservaban por Instagram y no había forma de saber si un clientemvuelvenía o no.",
    solution: [
      "Carta digital accesible por QR en cada mesa y en la web, siempre actualizada sin reprintedir nada.",
      "Reserva de mesa online con confirmación automática y recordatorio por SMS.",
      "Programa de fidelización con puntos y nivel de cliente, acumulables entre los cuatro locales.",
      "SEO local optimizado para búsquedas del tipo «cafetería cerca de mí».",
    ],
    outcome: [
      "El cliente pide desde la mesa sin esperar al camarero.",
      "Se conoce por fin cuántos clientes vuelven y cuáles no.",
      "Los locales aparecen en el mapa cuando alguien busca cerca.",
    ],
    metrics: [
      { value: "+2.000", label: "reservas online al año" },
      { value: "×4", label: "mesas reservadas por día" },
      { value: "4", label: "locales conectados" },
    ],
    duration: "6 semanas",
    stack: ["Node.js", "PostgreSQL", "Brevo", "Cloudflare"],
    testimonial: {
      quote:
        "Presupuesto cerrado, comunicación excelente y un producto que nuestro equipo adoptó desde el primer día. Repetiremos.",
      name: "Carla Vidal",
      role: "COO · Finvia",
    },
  },

  finvia: {
    sector: "Fintech · España",
    heroTitle: "Gastar mejor no es una app, es un flujo de aprobaciones",
    heroLead: "Una empresa de 90 empleados gestionaba gastos a mano, con tres personas solo en controlarlo.",
    challenge: "Las notas de gasto llegaban por correo, se aprobaban en el grupo de WhatsApp y luego había que pasarlas al sistema contable una a una. Nadie sabía el gasto real hasta el cierre de mes.",
    solution: [
      "App con flujos de aprobación encadenados según el importe y el área.",
      "Categorías automáticas por comerciante, con learnde las reglas de uso.",
      "Tarjetas de equipo con límite por persona y avisos en tiempo real.",
      "Exportación contable directa al formato que usa su asesoría.",
    ],
    outcome: [
      "El gasto se ve mientras ocurre, no al cierre.",
      "Desaparece el trabajo manual de transcripción.",
      "Se detecta el gasto fuera de política antes de que crezca.",
    ],
    metrics: [
      { value: "85 %", label: "adopción en la plantilla" },
      { value: "−9 h", label: "de administración al mes" },
      { value: "90", label: "empleados conectados" },
    ],
    duration: "16 semanas",
    stack: ["React", "Node.js", "PostgreSQL", "Stripe"],
  },

  rutaverde: {
    sector: "Turismo · España",
    heroTitle: "Reservar naturaleza desde un hueco en la agenda",
    heroLead: "Una oferta de experiencias de montaña que sobrevivía solo en temporada alta y por teléfono.",
    challenge: "El 70 % de las reservas llegaban por WhatsApp entre mayo y septiembre, y el resto del año la web no aparecía en ninguna búsqueda. Además, en zonas sin cobertura los guías perdían las reservas.",
    solution: [
      "Reserva de plaza con pago en línea y confirmación inmediata.",
      "Check-in por código QR que funciona sin conexión, para cuando no hay cobertura.",
      "Avisos meteorológicos automáticos que avisan al guía y al cliente.",
      "Disponibilidad por franja y número de plazas en tiempo real.",
    ],
    outcome: [
      "La temporada se llena sin depender del teléfono.",
      "El guía confirma la plaza en el punto de acceso sin internet.",
      "El cliente recibe el aviso de cambio de tiempo sin preguntar.",
    ],
    metrics: [
      { value: "+35 %", label: "reservas celular" },
      { value: "12", label: "meses al año con actividad" },
      { value: "0", label: "reservas perdidas por falta de cobertura" },
    ],
    duration: "10 semanas",
    stack: ["React", "PWA", "Node.js", "Stripe"],
  },

  "estudio-vega": {
    sector: "Industria · España",
    heroTitle: "Tres idiomas y un catálogo que los distribuidores se descargan solos",
    heroLead: "Un fabricante español exportaba a Europa con una web que solo estaba en español y sin nada descargable.",
    challenge: "Los distribuidores de otros países no tenían forma de consultar precios ni fichas técnicas, así que cada consulta acababa en un correo que alguien tenía que responder a mano.",
    solution: [
      "Sitio corporativo en español, inglés y alemán, con cambio de idioma sin recargar.",
      "Catálogo de producto con fichas técnicas en PDF descargables y versionadas.",
      "Formularios de consulta recibidos directamente en el CRM, sin correo de por medio.",
      "Portfolio interactivo de las instalaciones de referencia.",
    ],
    outcome: [
      "Los distribuidores se sirven de la información sin llamar.",
      "El correo deja de ser el canal de entrada único.",
      "El equipo comercial dedica el tiempo a cerrar en vez de responder.",
    ],
    metrics: [
      { value: "×3", label: "leads cualificados" },
      { value: "3", label: "idiomas en el mismo gestor de contenidos" },
      { value: "−80 %", label: "consultas repetidas por correo" },
    ],
    duration: "8 semanas",
    stack: ["WordPress", "PHP", "HubSpot", "Cloudflare"],
  },

  "ambar-lino": {
    sector: "Moda · España",
    heroTitle: "Vender por talla sinpras ni devoluciones",
    heroLead: "Una marca de moda sostenible vendía online, pero la devolución por talla se comía el margen de cada venta.",
    challenge: "El 38 % de los pedidos se devolvían, casi siempre por talla, y cada devolución suponía dosenvíos y dos semanas de espera.",
    solution: [
      "Guía de tallas generada con las medidas reales de cada prenda y el feedback de las devoluciones.",
      "Previsualización de la ficha con fotos reales y notas de corte.",
      "Devoluciones automatizadas con etiqueta y seguimiento, sin correo de por medio.",
      "Catálogo sincronizado con tres marketplaces y un único stock.",
    ],
    outcome: [
      "Menos devoluciones porque el cliente acierta la talla a la primera.",
      "Ventas más altas: el margen deja de evaporarse en el retorno.",
      "Un solo stock para la web y para los marketplaces.",
    ],
    metrics: [
      { value: "+52 %", label: "ticket medio" },
      { value: "−34 %", label: "devoluciones" },
      { value: "3", label: "marketplaces sincronizados" },
    ],
    duration: "9 semanas",
    stack: ["Shopify", "Stripe", "ERP propio", "GA4"],
  },

  "campus-forja": {
    sector: "Formación · España",
    heroTitle: "Formar a la empresa sin que nadie llame por teléfono",
    heroLead: "Un centro de formación con cursos de empresa que gestionaba matrículas a mano.",
    challenge: "Cada curso se rellenaba en un PDF, se comprobaba a mano si había plazas y el alumno recibía el acceso por correo. En el centro de formación presencial funcionaba, pero nada de eso servía para formación remota.",
    solution: [
      "Plataforma de cursos con vídeo protegido y certificados verificables.",
      "Matriculación en línea con control de plazas en tiempo real.",
      "Panel para empresas: seguimiento del progreso de su equipo.",
      "Facturación y acceso con SSO para clientes corporativos.",
    ],
    outcome: [
      "El alumno se matricula solo y entra en la plataforma.",
      "La empresa ve el progreso sin pedir informes.",
      "El certificado es verificable por quien lo recibe.",
    ],
    metrics: [
      { value: "1.400", label: "alumnos activos" },
      { value: "−70 %", label: "consultas de matrícula" },
      { value: "24/7", label: "acceso a los cursos" },
    ],
    duration: "13 semanas",
    stack: ["Laravel", "MySQL", "Vimeo", "Auth0"],
  },
};
