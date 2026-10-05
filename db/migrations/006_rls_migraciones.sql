-- =====================================================================
-- Nexo Studio — Cerrar schema_migrations (migración 006)
-- =====================================================================
-- POR QUÉ HACE FALTA UNA MIGRACIÓN ENTERA PARA UNA LÍNEA
-- ------------------------------------------------------
-- Porque queda registrado en schema_migrations, y esa tabla es la
-- que lleva la cuenta. Ponerlo a mano se pierde en el historial, y
-- dentro de seis meses nadie sabrá por qué esa tabla no tiene RLS.
--
-- EL PROBLEMA
-- -----------
-- schema_migrations se creó sola al aplicar la primera migración y
-- se quedó sin RLS. No guarda datos de clientes: solo nombres de
-- archivo. El riesgo real es bajo.
--
-- Pero "riesgo bajo" no es "riesgo cero", y sobre todo es incoherente:
-- si el resto de tablas está cerradas y esta no, la siguiente persona
-- que añada una tabla copiando el patrón se copiará el ejemplo
-- equivocado. Cerrarla deja el patrón limpio.
--
-- INSERT y SELECT los hace db/migrate.js con la secret key, que va
-- como service_role y se salta RLS. El panel no la consulta nunca.
-- =====================================================================

alter table schema_migrations enable row level security;

drop policy if exists "leer migraciones" on schema_migrations;

comment on table schema_migrations is
  'Historial de migraciones aplicadas. Solo la escribe db/migrate.js con la secret key.';
