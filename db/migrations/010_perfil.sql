-- =====================================================================
-- Nexo Studio — Ficha del negocio y datos de facturación (010)
-- =====================================================================
-- POR QUÉ DOS TABLAS Y NO UNA
-- ----------------------------
-- "Los datos de mi negocio" y "a quién le facturamos" casi siempre
-- coinciden, pero NO siempre. Los casos reales:
--
--   · Una panadería que factura a la sociedad que la posee
--   · Un autónomo que factura con su nombre pero emite desde una SL
--   · Una holding con tres marcas, cada una con su web
--   · Alguien que aún factura por Bankinter y luego cambia de banco
--
-- Si esto fuera una tabla con todos los campos, habría que decidir en
-- qué columnas se guarda cada caso y luego se acabaría escribiendo en
-- la que no toca. Con dos tablas 1:1, cada cliente tiene las suyas y
-- se rellenan cuando hacen falta.
--
-- LO QUE NO SE GUARDA AQUÍ
-- ------------------------
-- · Los cobros y las facturas. Eso ya existe (tabla cobros).
-- · El usuario del portal. Eso es profiles.
-- · El CIF para validar. Se guarda, pero VALIDARLO es otra historia:
--   hay una API de la AEAT y no se monta aquí. Ver PENDIENTES.md.
--
-- RUIDO QUE NO ENTRA
-- ------------------
-- Deliberadamente NO hay: logo, paleta de colores, banners, sliders.
-- Eso es de la web pública de cada cliente (que es otro proyecto) y no
-- del panel de gestión. Meterlo aquí sería guardar algo que no se usa.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Ficha del negocio
--
-- 1:1 con clients. Se crea sola la primera vez que se rellena, no
-- antes: una ficha vacía es ruido en las consultas.
--
-- OJO con `enlaces`: es un array de {etiqueta, url} para los enlaces
-- que no son redes sociales (su web de reservas, su carta, su
-- Google Business). Las redes que sí sabemos cuáles son (Instagram,
-- Facebook, LinkedIn) van en columna, porque de ellas se puede sacar
-- el icono y el nombre sin que nadie lo escriba a mano.
-- ---------------------------------------------------------------------
create table if not exists fichas (
  client_id     uuid primary key references clients on delete cascade,

  -- Identificación
  cif           text,   -- NIF/CIF. Se guarda sin validar.

  -- Dirección del negocio
  direccion     text,
  codigo_postal text check (codigo_postal is null or codigo_postal ~ '^\d{5}$'),
  ciudad        text,
  provincia     text,
  pais          text not null default 'España',

  -- Para qué nos ayuda a saber con quién hablamos
  sector        text,   -- 'panadería', 'taller'...
  web           text,

  -- Redes
  instagram     text,
  facebook      text,
  linkedin      text,
  whatsapp      text,

  -- Enlaces que no son redes: [{etiqueta, url}, ...]
  -- El CHECK es a propósito: si alguien metiera un string suelto aquí,
  -- la vista reventaría al hacer .map(). Fallar al escribir es mejor
  -- que reventar al leer.
  enlaces       jsonb not null default '[]'::jsonb
                check (jsonb_typeof(enlaces) = 'array'),

  actualizado_en timestamptz not null default now()
);

comment on table fichas is
  'Ficha del negocio: lo que hay que saber para trabajar con él. 1:1 con clients.';
comment on column fichas.cif is
  'NIF/CIF del negocio. SE GUARDA SIN VALIDAR: comprobarlo contra la AEAT es otra cosa, ver PENDIENTES.md.';
comment on column fichas.enlaces is
  'Enlaces libres, array de {etiqueta, url}. Para lo que no es red social: Google Business, carta, web de reservas...';
comment on column fichas.whatsapp is
  'Número con prefijo internacional y sin espacios ni +, tipo 34600111222. Así se puede abrir el chat con un clic.';

-- ---------------------------------------------------------------------
-- 2. Datos de facturación
--
-- Lo que va en la factura. Separado de la ficha porque puede ser otro
-- negocio distinto (ver la cabecera de la migración).
-- ---------------------------------------------------------------------
create table if not exists facturacion (
  client_id     uuid primary key references clients on delete cascade,

  -- Quién aparece como emisor de la factura. Puede ser el negocio de
  -- la ficha u otro (una sociedad, un holding).
  razon_social  text not null,
  nif           text,

  -- Dirección a la que se envía la factura. Puede ser distinta de la
  -- del negocio: es lo normal cuando hay un almacén o un despacho.
  direccion         text,
  codigo_postal     text check (codigo_postal is null or codigo_postal ~ '^\d{5}$'),
  ciudad            text,
  provincia         text,
  pais              text not null default 'España',

  -- A dónde se manda la factura
  email          text not null,

  -- Para el IVA. OJO: esto es el dato que hay que introducir a mano
  -- hasta que haya facturación real (ver PENDIENTES.md, "Facturas").
  -- Guardar el porcentaje aquí y no calcularlo en la vista es a
  -- propósito: hay tipos de IVA que no son un número (exento,
  -- recargo de equivalencia) y un percentage no los representa.
  regimen_iva   text check (
    regimen_iva is null or regimen_iva in (
      'general', 'reducido', 'superreducido', 'exento', 'equivalencia'
    )
  ),

  -- IBAN o cuenta, para pagar por transferencia sin escribirla a mano.
  iban           text,

  notas          text,

  actualizado_en timestamptz not null default now()
);

comment on table facturacion is
  'A quién y dónde se factura. 1:1 con clients. Puede ser un negocio distinto al de la ficha.';

-- ---------------------------------------------------------------------
-- 3. Función que devuelve el "perfil completo"
--
-- El panel del cliente pinta tres cosas: la ficha, la facturación y
-- los módulos. Juntas en una fila, porque la vista siempre las quiere
-- todas y hacer tres selects por página es tres viajes a la base por
-- lo mismo.
--
-- left join, no join: un cliente sin ficha sigue teniendo perfil (el
-- que viene en clients), y la vista dice "completa tus datos" en vez
-- de romperse.
-- ---------------------------------------------------------------------
create or replace function perfil_completo(cliente_uuid uuid)
  returns jsonb
  language sql stable security definer
  set search_path = public
  as $$
    select jsonb_build_object(
      'cliente', jsonb_build_object(
        'id', c.id,
        'nombre', c.nombre,
        'empresa', c.empresa,
        'email', c.email,
        'telefono', c.telefono,
        'notas', c.notas,
        'archivado', c.archivado
      ),
      'ficha', to_jsonb(f) - 'client_id' - 'actualizado_en',
      'facturacion', to_jsonb(fa) - 'client_id' - 'actualizado_en',
      /* Si no hay ficha, el perfil está "sin completar". Lo decide
         la función para que la vista no tenga que contarlo: el mismo
         criterio en un solo sitio, como con las etiquetas. */
      'completo', f.client_id is not null
    )
    from clients c
    left join fichas f on f.client_id = c.id
    left join facturacion fa on fa.client_id = c.id
    where c.id = cliente_uuid;
  $$;

comment on function perfil_completo is
  'Cliente + ficha + facturación en una fila. left join para que un cliente sin ficha no dé error.';

-- ---------------------------------------------------------------------
-- 4. RLS
--
-- Las dos son datos del cliente, así que las dos se cierran. El
-- cliente ve y EDITA las suyas (son sus datos y tiene que poder
-- corregirlos); el staff ve todas.
--
-- Lo que NO puede es tocar `facturacion.regimen_iva`: eso lo pone
-- el equipo, porque un cliente que se cambia a 'exento' se está
-- quitando a sí mismo el IVA. Se controla en la ruta, no con una
-- política, porque el RLS no distingue columnas dentro de un UPDATE.
-- ---------------------------------------------------------------------
alter table fichas enable row level security;

drop policy if exists "leer propias fichas" on fichas;
create policy "leer propias fichas"
  on fichas for select to authenticated
  using (es_staff() or es_cliente_de(client_id));

drop policy if exists "gestionar propias fichas" on fichas;
create policy "gestionar propias fichas"
  on fichas for all to authenticated
  using (es_staff() or es_cliente_de(client_id))
  with check (es_staff() or es_cliente_de(client_id));

alter table facturacion enable row level security;

drop policy if exists "leer propia facturacion" on facturacion;
create policy "leer propia facturacion"
  on facturacion for select to authenticated
  using (es_staff() or es_cliente_de(client_id));

/* OJO: aquí el cliente SÍ puede escribir, a diferencia de las
   suscripciones. Los datos de facturación son suyos: si el banco le
   cambia la cuenta, o se equivoca al escribir el IBAN, tiene que
   poder corregirlo sin llamarnos. Lo que no puede cambiar es el
   régimen de IVA, y eso se comprueba en la ruta. */
drop policy if exists "gestionar propia facturacion" on facturacion;
create policy "gestionar propia facturacion"
  on facturacion for all to authenticated
  using (es_staff() or es_cliente_de(client_id))
  with check (es_staff() or es_cliente_de(client_id));
