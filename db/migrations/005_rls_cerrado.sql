-- =====================================================================
-- Nexo Studio — Cerrar tablas sin RLS (migración 005)
-- =====================================================================
-- POR QUÉ
-- -------
-- Una comprobación routinely (db/rls.js) encontró tres tablas
-- accessible desde fuera sin ningún filtro:
--
--   cobros            -> importes y facturación de TODOS los clientes
--   sessions          -> hash de token y access_token de Supabase
--   login_attempts    -> emails y IPs de intentos de acceso
--
-- Con Row Level Security apagado, la tabla se lee y se escribe
-- desde PostgREST con la clave publicable. Y esa clave va en el
-- código del cliente: no es un secreto, es una puerta con la llave
-- puesta al lado.
--
-- El riesgo es concreto: alguien que abra la consola del navegador
-- en tu web podría leer la facturación completa. Con `sessions`, leer
-- los tokens de sesión.
--
-- sessions y login_attempts NO llevan política: no son datos de
-- cliente, los usa solo el servidor con la secret key, así que lo
-- correcto es cerrarlas por completo (RLS activado y sin políticas
-- = nadie entra, ni siquiera un usuario autenticado).
--
-- La secret key de Supabase se salta RLS porque acts como
-- postgres/service_role. Por eso el servidor sigue funcionando.
-- =====================================================================

-- ---------------------------------------------------------------------
-- sessions: solo el servidor. Sin políticas, con RLS encendido,
-- significa que nadie puede leerla ni desde un usuario autenticado.
-- ---------------------------------------------------------------------
alter table sessions enable row level security;

drop policy if exists "leer sesiones" on sessions;

-- ---------------------------------------------------------------------
-- login_attempts: igual. Solo la usa lib/auth.js para contar intentos.
-- ---------------------------------------------------------------------
alter table login_attempts enable row level security;

drop policy if exists "leer intentos" on login_attempts;

-- ---------------------------------------------------------------------
-- cobros: aquí sí hay datos de cliente, con la misma regla que el
-- resto. Un cliente ve los cobros de SU empresa; el equipo, todos.
-- ---------------------------------------------------------------------
alter table cobros enable row level security;

-- Se usa el mismo criterio que en "services": el cobro pertenece a un
-- servicio, y el servicio pertenece a un cliente.
drop policy if exists "leer cobros" on cobros;
create policy "leer cobros"
  on cobros for select to authenticated
  using (
    es_staff()
    or exists (
      select 1 from services s
      where s.id = cobros.service_id
        and s.client_id = (select client_id from profiles where id = auth.uid())
    )
  );

-- El cliente NO puede tocar la facturación: ni crear cobros, ni
-- marcarlos como pagados, ni borrarlos. Que pueda decidir que ha
-- pagado desde su propio panel sería un agujero de negocio, no de
-- seguridad.
drop policy if exists "gestionar cobros" on cobros;
create policy "gestionar cobros"
  on cobros for all to authenticated
  using (es_staff())
  with check (es_staff());

-- Las vistas heredan la seguridad de la tabla base: no necesitan
-- política propia. Se deja dicho aquí para que no parezca un olvido.
comment on view v_cobros_mensual is
  'Solo la consultan el servidor con la secret key, que ve todo. No expone RLS propia.';

-- ---------------------------------------------------------------------
-- Comprobación de que no se ha dejado ninguna tabla suelta. Esta
-- vista sirve también como aviso futuro: si algún día se crea una
-- tabla sin RLS, salta en rojo en db/rls.js.
-- ---------------------------------------------------------------------
create or replace view v_tablas_sin_rls as
select
  c.relname as tabla,
  'esta tabla no tiene RLS'::text as problema
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and not c.relrowsecurity;
