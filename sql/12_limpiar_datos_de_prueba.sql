-- =====================================================================
-- GScom — Borrar datos de prueba antes de empezar a usar la app en serio.
-- BORRA: productos, categorías, ventas, compras, caja, service, fichero y
--        movimientos de stock. Reinicia la numeración (venta #1, orden #1).
-- CONSERVA: clientes y sus equipos, proveedores, usuarios, datos del negocio.
-- ¡NO SE PUEDE DESHACER! (el plan Free de Supabase no tiene backups)
-- =====================================================================

truncate table
  caja_movimientos, caja_cierres, cc_movimientos,
  venta_items, ventas,
  compra_items, compras,
  orden_items, orden_estados, ordenes_servicio,
  stock_movimientos, productos, categorias
restart identity;   -- sin CASCADE: si algo más dependiera de estas tablas, da error en vez de borrarlo

alter sequence ventas_numero_seq  restart with 1;
alter sequence ordenes_numero_seq restart with 1;
alter sequence codigo_interno_seq restart with 1;

-- Verificación: lo borrado debe dar 0; lo conservado, sus cantidades actuales
select 'productos' as tabla, count(*) from productos
union all select 'ventas', count(*) from ventas
union all select 'compras', count(*) from compras
union all select 'ordenes_servicio', count(*) from ordenes_servicio
union all select 'caja_movimientos', count(*) from caja_movimientos
union all select 'cc_movimientos', count(*) from cc_movimientos
union all select 'clientes (se conservan)', count(*) from clientes
union all select 'proveedores (se conservan)', count(*) from proveedores;
