-- =====================================================================
-- Perfil de solo consulta — COTUCO
--
-- COTUCO quiere ir viendo cómo avanzan los registros antes del evento.
-- Hasta aquí el panel sólo lo abría `admin`, y `admin` también cancela
-- registros, cierra el formulario público y crea cuentas. Una cuenta de
-- cliente no debería poder apagar los registros por accidente la semana
-- del evento.
--
-- `consulta` ve el resumen, el padrón y la exportación. No cambia nada.
--
-- El CHECK de la columna se escribió al crear la tabla, así que volver a
-- correr 001 no lo actualiza: hay que reemplazarlo aquí.
--
-- Idempotente: se puede correr las veces que haga falta.
-- =====================================================================

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;

ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('admin', 'mesa', 'puerta', 'consulta'));
