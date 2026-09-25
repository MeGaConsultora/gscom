-- =====================================================================
-- GScom — Poner el stock de todos los productos en 0.
-- Se hace con movimientos de ajuste (no un UPDATE directo) para que
-- quede en el historial de cada producto ("Ver movimientos") y no
-- rompa el criterio de que todo cambio de stock pasa por
-- stock_movimientos.
-- Correr una sola vez en el SQL Editor de Supabase.
-- =====================================================================

insert into stock_movimientos (producto_id, cantidad, tipo, nota)
select id, -stock, 'ajuste', 'Reseteo general de stock a 0'
  from productos
 where not es_servicio and stock <> 0;
